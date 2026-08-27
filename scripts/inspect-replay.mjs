// Dump a real .sdfz's header + trailer so we can confirm the team-stats layout.
// Usage: node scripts/inspect-replay.mjs "C:\path\to\some.sdfz"
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readDemoFile } from '../src/main/demo-header.ts'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/inspect-replay.mjs <path-to-.sdfz>')
  process.exit(1)
}

const raw0 = readFileSync(path)
const buf = raw0[0] === 0x1f && raw0[1] === 0x8b ? gunzipSync(raw0) : raw0

const h = (o) => buf.readInt32LE(o)
const fields = {
  version: h(16),
  headerSize: h(20),
  scriptSize: h(304),
  demoStreamSize: h(308),
  gameTime: h(312),
  numPlayers: h(320),
  playerStatSize: h(324),
  playerStatElemSize: h(328),
  numTeams: h(332),
  teamStatSize: h(336),
  teamStatElemSize: h(340),
  teamStatPeriod: h(344),
  winningAllyTeamsSize: h(348),
  fileLen: buf.length
}
console.log('HEADER', fields)

const scriptStart = fields.headerSize > 0 && fields.headerSize < buf.length ? fields.headerSize : 352
const trailerStart = scriptStart + fields.scriptSize + fields.demoStreamSize
console.log('scriptStart', scriptStart, 'trailerStart', trailerStart, 'bytesAfterTrailer', buf.length - trailerStart)
console.log(
  'sum of blocks =',
  fields.playerStatSize + fields.teamStatSize + fields.winningAllyTeamsSize,
  '(should ~= bytesAfterTrailer)'
)

// Try to read the numTeams dword counts at each candidate team-stats offset.
for (const [label, start] of [
  ['A: trailerStart + playerStatSize', trailerStart + fields.playerStatSize],
  ['B: trailerStart + winSize + playerStatSize', trailerStart + fields.winningAllyTeamsSize + fields.playerStatSize]
]) {
  if (start < 0 || start + 4 * fields.numTeams > buf.length) {
    console.log(label, '-> out of range')
    continue
  }
  const counts = []
  for (let t = 0; t < fields.numTeams; t++) counts.push(buf.readInt32LE(start + t * 4))
  const sum = counts.reduce((a, c) => a + c, 0)
  const rec = sum > 0 ? (fields.teamStatSize - fields.numTeams * 4) / sum : NaN
  console.log(label, '@', start, 'counts', counts, 'sum', sum, 'derivedRecSize', rec)
}

const parsed = readDemoFile(path)
console.log('\nparsed.winningAllyTeams', parsed.winningAllyTeams)
console.log('parsed.teamStats length', parsed.teamStats.length)
console.log('parsed.teamStats (first 3):', parsed.teamStats.slice(0, 3))
console.log('parsed.playerStats length', parsed.playerStats.length)
console.log('parsed.playerStats (first 3):', parsed.playerStats.slice(0, 3))
