// Validate the demo command-stream parsing against a real replay.
//   node scripts/inspect-stream.mjs "C:\path\to\game.sdfz"
//
// Self-contained (mirrors src/main/demo-stream.ts) so it doesn't drag in the
// extensionless-import chain that Node's type stripper can't resolve.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readDemoFile } from '../src/main/demo-header.ts'
import { parseTdf, findSection, collectIndexed } from '../src/main/tdf.ts'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/inspect-stream.mjs <path-to-.sdfz>')
  process.exit(1)
}

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
  [...perDef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join('  '))
