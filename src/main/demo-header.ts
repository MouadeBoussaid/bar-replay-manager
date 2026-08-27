import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

/**
 * Reads the header + start script of a Spring/Recoil demo file (`.sdfz` = gzip,
 * `.sdf` = raw). Layout of `DemoFileHeader` (all ints little-endian int32):
 *
 *   0    char     magic[16]        "spring demofile\0"
 *   16   int32    version
 *   20   int32    headerSize       (byte offset where the start script begins)
 *   24   char     versionString[256]
 *   280  uint8    gameID[16]
 *   296  uint64   unixTime         (game start)
 *   304  int32    scriptSize
 *   308  int32    demoStreamSize   (0 if the game crashed / no proper end)
 *   312  int32    gameTime         (seconds)
 *   316  int32    wallclockTime    (seconds)
 *   320  int32    numPlayers
 *   324  int32    playerStatChunkSize
 *   328  int32    playerStatElemSize
 *   332  int32    numTeams
 *   336  int32    teamStatChunkSize
 *   340  int32    teamStatElemSize
 *   344  int32    teamStatPeriod
 *   348  int32    winningAllyTeamsSize
 */

const MAGIC = 'spring demofile'

/** Final cumulative economy/combat totals for one in-game team (usually one player). */
export interface TeamStat {
  teamId: number
  metalProduced: number
  metalUsed: number
  energyProduced: number
  energyUsed: number
  damageDealt: number
  damageReceived: number
  unitsProduced: number
  unitsKilled: number
  unitsDied: number
}

export interface RawDemo {
  engineVersion: string
  gameId: string | null
  startTimeUnix: number
  scriptText: string
  gameTimeSeconds: number
  wallclockSeconds: number
  demoStreamSize: number
  winningAllyTeams: number[]
  /** Per-team final statistics, indexed by teamId. Empty when the demo has none. */
  teamStats: TeamStat[]
}

// `struct TeamStatistics` is `#pragma pack(1)`: int frame, 12 floats, 7 ints = 80 bytes.
const TEAM_STAT_ELEM = 80

export function readDemoFile(path: string): RawDemo {
  const fileBuf = readFileSync(path)
  const buf =
    fileBuf.length > 1 && fileBuf[0] === 0x1f && fileBuf[1] === 0x8b
      ? gunzipSync(fileBuf)
      : fileBuf

  if (buf.length < 360) {
    throw new Error('File is too small to be a Spring demo')
  }

  const magic = buf.toString('ascii', 0, MAGIC.length)
  if (magic !== MAGIC) {
    throw new Error(`Not a Spring demo file (bad magic: ${JSON.stringify(magic)})`)
  }

  const headerSize = buf.readInt32LE(20)
  const engineVersion = cString(buf, 24, 256)

  const gameIdBuf = buf.subarray(280, 296)
  const gameId = gameIdBuf.every((b) => b === 0) ? null : gameIdBuf.toString('hex')

  const startTimeUnix = Number(buf.readBigUInt64LE(296))
  const scriptSize = buf.readInt32LE(304)
  const demoStreamSize = buf.readInt32LE(308)
  const gameTimeSeconds = buf.readInt32LE(312)
  const wallclockSeconds = buf.readInt32LE(316)
  const playerStatSize = buf.readInt32LE(324)
  const numTeams = buf.readInt32LE(332)
  const teamStatSize = buf.readInt32LE(336)
  const teamStatElemSize = buf.readInt32LE(340)
  const winningAllyTeamsSize = buf.readInt32LE(348)

  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const scriptText = cString(buf, scriptStart, Math.max(0, scriptSize))

  const teamStatsStart = scriptStart + scriptSize + demoStreamSize + playerStatSize
  const teamStats = readTeamStats(
    buf,
    teamStatsStart,
    teamStatSize,
    numTeams,
    teamStatElemSize
  )

  // The winning ally-team list is a trailer after everything else.
  const winStart = teamStatsStart + teamStatSize
  const winningAllyTeams: number[] = []
  if (
    winningAllyTeamsSize > 0 &&
    winStart >= 0 &&
    winStart + winningAllyTeamsSize <= buf.length
  ) {
    for (let k = 0; k < winningAllyTeamsSize; k++) {
      winningAllyTeams.push(buf.readUInt8(winStart + k))
    }
  }

  return {
    engineVersion,
    gameId,
    startTimeUnix,
    scriptText,
    gameTimeSeconds,
    wallclockSeconds,
    demoStreamSize,
    winningAllyTeams,
    teamStats
  }
}

/**
 * Team-stat chunk layout (Spring `CDemoRecorder::WriteTeamStats`):
 *   numTeams × int32  — snapshot count per team
 *   then, per team, `count` × TeamStatistics (80 bytes each)
 * We keep only each team's last (final, cumulative) snapshot.
 */
function readTeamStats(
  buf: Buffer,
  start: number,
  chunkSize: number,
  numTeams: number,
  elemSize: number
): TeamStat[] {
  if (
    chunkSize <= 0 ||
    numTeams <= 0 ||
    numTeams > 256 ||
    (elemSize !== 0 && elemSize !== TEAM_STAT_ELEM) ||
    start < 0 ||
    start + chunkSize > buf.length ||
    start + numTeams * 4 > buf.length
  ) {
    return []
  }

  let off = start
  const counts: number[] = []
  for (let t = 0; t < numTeams; t++) {
    counts.push(buf.readInt32LE(off))
    off += 4
  }

  const total = counts.reduce((a, c) => a + Math.max(0, c), 0)
  if (off + total * TEAM_STAT_ELEM > start + chunkSize) return []

  const out: TeamStat[] = []
  for (let t = 0; t < numTeams; t++) {
    const count = counts[t]!
    if (count <= 0) continue
    // Jump straight to the last snapshot for this team.
    const lastOff = off + (count - 1) * TEAM_STAT_ELEM
    if (lastOff + TEAM_STAT_ELEM > buf.length) return out
    out.push({
      teamId: t,
      metalUsed: buf.readFloatLE(lastOff + 4),
      energyUsed: buf.readFloatLE(lastOff + 8),
      metalProduced: buf.readFloatLE(lastOff + 12),
      energyProduced: buf.readFloatLE(lastOff + 16),
      damageDealt: buf.readFloatLE(lastOff + 44),
      damageReceived: buf.readFloatLE(lastOff + 48),
      unitsProduced: buf.readInt32LE(lastOff + 52),
      unitsDied: buf.readInt32LE(lastOff + 56),
      unitsKilled: buf.readInt32LE(lastOff + 76)
    })
    off += count * TEAM_STAT_ELEM
  }
  return out
}

function cString(buf: Buffer, offset: number, maxLen: number): string {
  const slice = buf.subarray(offset, Math.min(offset + maxLen, buf.length))
  const nul = slice.indexOf(0)
  return slice.toString('utf-8', 0, nul === -1 ? slice.length : nul)
}
