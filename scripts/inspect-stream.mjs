// Validate the demo command-stream parsing against a real replay.
//   node scripts/inspect-stream.mjs "C:\path\to\game.sdfz"
//
// Self-contained (mirrors src/main/demo-stream.ts) so it doesn't drag in the
// extensionless-import chain that Node's type stripper can't resolve.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readDemoFile } from '../src/main/demo-header.ts'
import { parseTdf, findSection, collectIndexed } from '../src/main/tdf.ts'
import { UNIT_DEF_TABLES } from '../src/main/data/unitDefTables.generated.ts'

const path = process.argv[2]
const infologPath = process.argv[3]
if (!path) {
  console.error('usage: node scripts/inspect-stream.mjs <path-to-.sdfz> [path-to-infolog.txt]')
  process.exit(1)
}

// optional id -> unit name map, from a BRM dump in infolog.txt
const nameById = new Map()
if (infologPath) {
  for (const line of readFileSync(infologPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/\bBRM\|(\d+)\|([^|]*)\|/)
    if (m) nameById.set(Number(m[1]), m[2])
  }
}
const nm = (id) => (nameById.get(id) ? `${id}(${nameById.get(id)})` : String(id))

const raw = readFileSync(path)
const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw

const headerSize = buf.readInt32LE(20)
const scriptSize = buf.readInt32LE(304)
const demoStreamSize = buf.readInt32LE(308)
const gameTime = buf.readInt32LE(312)
const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
const streamStart = scriptStart + scriptSize
const streamEnd = Math.min(buf.length, streamStart + demoStreamSize)

const demo = readDemoFile(path)
const root = parseTdf(demo.scriptText)
const game = findSection(root, 'game') ?? root
const players = collectIndexed(game, 'player')
const teamByPlayer = new Map()
for (const [pnum, sec] of Object.entries(players)) {
  const team = Number(sec.keys['team'])
  if (Number.isInteger(team)) teamByPlayer.set(Number(pnum), team)
}
const trailerTeams = demo.teamStats.map((t) => t.teamId).sort((a, b) => a - b)

console.log('gameType   ', JSON.stringify(game.keys['gametype']))
console.log('header     scriptSize', scriptSize, 'demoStreamSize', demoStreamSize, 'gameTime(s)', gameTime)
console.log('stream     [', streamStart, '..', streamEnd, ') =', streamEnd - streamStart, 'bytes')
console.log('players->team', [...teamByPlayer.entries()].map(([p, t]) => `p${p}:t${t}`).join(' '))
console.log('trailer teamIds', trailerTeams.join(' '), '\n')

const NAMES = {
  1: 'KEYFRAME', 2: 'NEWFRAME', 4: 'STARTPLAYING', 6: 'PLAYERNAME', 7: 'CHAT',
  8: 'RANDSEED', 9: 'GAMEID', 10: 'PATH_CHECKSUM', 11: 'COMMAND', 12: 'SELECT',
  13: 'PAUSE', 14: 'AICOMMAND', 15: 'AICOMMANDS', 16: 'AISHARE', 19: 'USER_SPEED',
  20: 'INTERNAL_SPEED', 21: 'CPU_USAGE', 35: 'SYSTEMMSG', 36: 'STARTPOS',
  50: 'LUAMSG', 51: 'TEAM', 52: 'GAMEDATA', 76: 'AICOMMAND_TRACKED'
}
const NETMSG_COMMAND = 11
const NETMSG_AICOMMAND = 14
const NETMSG_AICOMMAND_TRACKED = 76

const hist = new Map()
const orders = []
let chunks = 0
let stoppedEarly = false
let firstT = null
let lastT = null

let p = streamStart
while (p + 8 <= streamEnd) {
  const t = buf.readFloatLE(p)
  const len = buf.readUInt32LE(p + 4)
  p += 8
  if (len === 0 || p + len > streamEnd) {
    stoppedEarly = true
    break
  }
  if (firstT === null) firstT = t
  lastT = t
  const id = buf.readUInt8(p)
  hist.set(id, (hist.get(id) ?? 0) + 1)
  chunks++

  if (id === NETMSG_COMMAND) {
    const playerNum = buf.readUInt8(p + 3)
    const cmdId = buf.readInt32LE(p + 4)
    if (cmdId < 0) orders.push({ t, teamId: teamByPlayer.get(playerNum) ?? null, unitDefId: -cmdId, via: 'CMD' })
  } else if (id === NETMSG_AICOMMAND || id === NETMSG_AICOMMAND_TRACKED) {
    const aiTeamId = buf.readUInt8(p + 5)
    const cmdId = buf.readInt32LE(p + 8)
    if (cmdId < 0) orders.push({ t, teamId: aiTeamId, unitDefId: -cmdId, via: 'AI' })
  }
  p += len
}

console.log('chunks', chunks, '| stoppedEarly', stoppedEarly,
  '| stream clock', firstT?.toFixed(1), '->', lastT?.toFixed(1), 's')
console.log('top message ids:')
;[...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([id, n]) =>
  console.log(`   ${String(id).padStart(3)} ${(NAMES[id] ?? '?').padEnd(18)} ${n}`))

const clockOk = lastT != null && Math.abs(lastT - gameTime) < gameTime * 0.15 + 30
const newframeDominant = (hist.get(2) ?? 0) + (hist.get(1) ?? 0) > chunks * 0.2
console.log(`\nFRAMING   clock end ${lastT?.toFixed(0)}s vs header ${gameTime}s -> ${clockOk ? 'OK' : 'MISMATCH'}` +
  ` | NEWFRAME/KEYFRAME dominant -> ${newframeDominant ? 'OK' : 'NO'}`)

// ---- build orders --------------------------------------------------------
console.log(`\nBUILD ORDERS  count ${orders.length}`)
if (orders.length === 0) {
  console.log('  (none — NETMSG_COMMAND id/offset likely wrong)')
  process.exit(0)
}
const viaCmd = orders.filter((o) => o.via === 'CMD').length
console.log(`  via NETMSG_COMMAND ${viaCmd}  |  via NETMSG_AICOMMAND ${orders.length - viaCmd}`)
const ids = orders.map((o) => o.unitDefId).sort((a, b) => a - b)
console.log('  unitDefId range', ids[0], '..', ids[ids.length - 1], '| distinct', new Set(ids).size)
const plausibleIds = ids[ids.length - 1] < 5000 && ids[0] > 0
console.log('  unitDefIds plausible (0 < id < 5000):', plausibleIds ? 'OK' : 'NO')

const perTeam = new Map()
for (const o of orders) perTeam.set(o.teamId, (perTeam.get(o.teamId) ?? 0) + 1)
console.log('  per teamId:', [...perTeam.entries()].sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1))
  .map(([k, v]) => `${k}:${v}`).join('  '))
const stray = [...perTeam.keys()].filter((k) => k != null && !trailerTeams.includes(k))
console.log('  order teamIds not in trailer:', stray.length ? stray.join(',') : 'none')
console.log('  order time span', orders[0].t.toFixed(1), '->', orders[orders.length - 1].t.toFixed(1),
  's  (match', gameTime, 's)')
const perDef = new Map()
for (const o of orders) perDef.set(o.unitDefId, (perDef.get(o.unitDefId) ?? 0) + 1)
console.log('  top ordered ids (id:count):',
  [...perDef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${nm(k)}:${v}`).join('  '))

// ---- offensive share (the actual Option C output) ----------------------
const table = UNIT_DEF_TABLES[0]
if (!table) {
  console.log('\nOFFENSIVE SHARE  no unit-def table generated — skipping')
  process.exit(0)
}
const defs = new Map(Object.entries(table.units).map(([id, p]) => [Number(id), { cost: p[0], off: p[1] === 1 }]))
console.log(`\nOFFENSIVE SHARE  using table ${JSON.stringify(table.gameVersion)} (${defs.size} units)`)

let matched = 0, unmatched = 0, unmatchedIds = new Set()
const cumOff = new Map(), cumTot = new Map()
for (const o of orders) {
  const d = defs.get(o.unitDefId)
  if (!d || d.cost <= 0) { unmatched++; unmatchedIds.add(o.unitDefId); continue }
  matched++
  cumTot.set(o.teamId, (cumTot.get(o.teamId) ?? 0) + d.cost)
  if (d.off) cumOff.set(o.teamId, (cumOff.get(o.teamId) ?? 0) + d.cost)
}
console.log(`  orders resolved ${matched} / ${matched + unmatched}  (unmatched ids: ${[...unmatchedIds].slice(0, 15).join(',')}${unmatchedIds.size > 15 ? '…' : ''})`)
console.log('  final offensive metal share per team:')
const shares = []
for (const [team, tot] of [...cumTot.entries()].sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1))) {
  if (team === 255) continue
  const s = (cumOff.get(team) ?? 0) / tot
  shares.push(s)
  console.log(`    t${team}: ${(s * 100).toFixed(1)}%  (offensive ${Math.round((cumOff.get(team) ?? 0) / 1000)}k / total ${Math.round(tot / 1000)}k metal)`)
}
const lo = Math.min(...shares), hi = Math.max(...shares), avg = shares.reduce((a, b) => a + b, 0) / shares.length
console.log(`  range ${(lo * 100).toFixed(0)}%..${(hi * 100).toFixed(0)}%  avg ${(avg * 100).toFixed(0)}%`)
console.log(`  SANITY: all in (0,1) -> ${shares.every((s) => s > 0 && s < 1) ? 'OK' : 'FAIL'}` +
  ` | plausible band 20-85% -> ${lo > 0.15 && hi < 0.9 ? 'OK' : 'CHECK'}`)
