// Regression check for the demo command-stream byte layout.
// Run: node scripts/stream-smoke.mjs
//
// Mirrors src/main/demo-stream.ts (kept in sync by hand — the two test scripts
// can't import the extensionless-relative src chain under Node's type stripper).
// The real reader is also exercised end-to-end by scripts/inspect-stream.mjs on
// actual replays.
import { gzipSync, gunzipSync } from 'node:zlib'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const NETMSG_COMMAND = 11
const NETMSG_AICOMMAND = 14
const NETMSG_AICOMMAND_TRACKED = 76

/** The parse under test — a copy of readDemoStream()'s stream walk. */
function walkStream(buf, teamByPlayer) {
  const headerSize = buf.readInt32LE(20)
  const scriptSize = buf.readInt32LE(304)
  const demoStreamSize = buf.readInt32LE(308)
  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const start = scriptStart + scriptSize
  const end = Math.min(buf.length, start + demoStreamSize)
  const orders = []
  let p = start
  while (p + 8 <= end) {
    const modGameTime = buf.readFloatLE(p)
    const length = buf.readUInt32LE(p + 4)
    p += 8
    if (length === 0 || p + length > end) break
    const msg = buf.readUInt8(p)
    if (msg === NETMSG_COMMAND) {
      const playerNum = buf.readUInt8(p + 3)
      const cmdId = buf.readInt32LE(p + 4)
      if (cmdId < 0) {
        orders.push({ t: modGameTime, teamId: teamByPlayer.get(playerNum) ?? null, unitDefId: -cmdId })
      }
    } else if (msg === NETMSG_AICOMMAND || msg === NETMSG_AICOMMAND_TRACKED) {
      const aiTeamId = buf.readUInt8(p + 5)
      const cmdId = buf.readInt32LE(p + 8)
      if (cmdId < 0) orders.push({ t: modGameTime, teamId: aiTeamId, unitDefId: -cmdId })
    }
    p += length
  }
  return orders
}

// ---- build a synthetic .sdfz with a real stream --------------------------
const HEADER = 352
const script = '[GAME]{[PLAYER0]{name=A;team=0;}[PLAYER1]{name=B;team=1;}}\0'
const scriptBuf = Buffer.from(script, 'utf-8')

function chunk(t, packet) {
  const h = Buffer.alloc(8)
  h.writeFloatLE(t, 0)
  h.writeUInt32LE(packet.length, 4)
  return Buffer.concat([h, packet])
}
function cmd(playerNum, cmdId) {
  const p = Buffer.alloc(17)
  p.writeUInt8(NETMSG_COMMAND, 0)
  p.writeUInt16LE(17, 1)
  p.writeUInt8(playerNum, 3)
  p.writeInt32LE(cmdId, 4)
  return p
}
function aicmd(aiTeamId, cmdId) {
  const p = Buffer.alloc(20)
  p.writeUInt8(NETMSG_AICOMMAND, 0)
  p.writeUInt16LE(20, 1)
  p.writeUInt8(aiTeamId, 5)
  p.writeInt32LE(cmdId, 8)
  return p
}
const stream = Buffer.concat([
  chunk(1.0, Buffer.from([2])), // NEWFRAME
  chunk(12.5, cmd(0, -42)), // team 0 builds unitDef 42
  chunk(20.0, cmd(0, 100)), // positive cmdId -> ignored
  chunk(33.0, cmd(1, -7)), // team 1 builds unitDef 7
  chunk(41.0, aicmd(1, -99)) // team 1 via AI path builds unitDef 99
])

const buf = Buffer.alloc(HEADER + scriptBuf.length + stream.length)
buf.write('spring demofile\0', 0, 'ascii')
buf.writeInt32LE(HEADER, 20)
buf.writeInt32LE(scriptBuf.length, 304)
buf.writeInt32LE(stream.length, 308)
scriptBuf.copy(buf, HEADER)
stream.copy(buf, HEADER + scriptBuf.length)

// round-trip through gzip + disk, like the real reader sees it
const file = join(mkdtempSync(join(tmpdir(), 'sdfz-stream-')), 'test.sdfz')
writeFileSync(file, gzipSync(buf))
const back = gunzipSync(readFileSync(file))

const orders = walkStream(back, new Map([[0, 0], [1, 1]]))

let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++
    console.error(`  FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  } else {
    console.log(`  ok   ${label}`)
  }
}

check('order count', orders.length, 3)
check('order 0 (NETMSG_COMMAND)', orders[0], { t: 12.5, teamId: 0, unitDefId: 42 })
check('order 1', orders[1], { t: 33, teamId: 1, unitDefId: 7 })
check('order 2 (NETMSG_AICOMMAND)', orders[2], { t: 41, teamId: 1, unitDefId: 99 })
check('positive cmdId not counted', orders.some((o) => o.unitDefId === 100), false)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
