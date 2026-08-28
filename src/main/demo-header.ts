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
  metalExcess: number
  energyProduced: number
  energyUsed: number
  energyExcess: number
  damageDealt: number
  damageReceived: number
  unitsProduced: number
  unitsKilled: number
  unitsDied: number
}

/** Per-player input activity (`struct PlayerStatistics`: 5 ints = 20 bytes). */
export interface PlayerStat {
  playerId: number
  mousePixels: number
  mouseClicks: number
  keyPresses: number
  numCommands: number
  unitCommands: number
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
  /** Per-player input stats, indexed by playerId. Empty when the demo has none. */
  playerStats: PlayerStat[]
}

/**
 * `struct TeamStatistics` (`#pragma pack(1)`) is 12 floats + 7 ints = 76 bytes,
 * or 80 with the leading `int frame` that newer Recoil prepends. We derive the
 * actual per-record size from the chunk instead of trusting the header.
 */
const TEAM_STAT_MIN = 76
const PLAYER_STAT_ELEM = 20

/** All numeric fields of one team-stats snapshot (a Spring `TeamStatistics`). */
export interface TeamSample {
  frame: number
  metalUsed: number
  energyUsed: number
  metalProduced: number
  energyProduced: number
  metalExcess: number
  energyExcess: number
  metalReceived: number
  energyReceived: number
  metalSent: number
  energySent: number
  damageDealt: number
  damageReceived: number
  unitsProduced: number
  unitsDied: number
  unitsReceived: number
  unitsSent: number
  unitsCaptured: number
  unitsOutCaptured: number
  unitsKilled: number
}

export interface DemoSeries {
  scriptText: string
  /** Seconds between snapshots (`teamStatPeriod`). */
  periodSeconds: number
  /** Full snapshot history per team, indexed by teamId. */
  teams: { teamId: number; samples: TeamSample[] }[]
}

/** Read one TeamStatistics record; `base` already includes the `f` frame offset. */
function readSample(buf: Buffer, base: number, frame: number): TeamSample {
  const fl = (o: number): number => buf.readFloatLE(base + o)
  const it = (o: number): number => buf.readInt32LE(base + o)
  return {
    frame,
    metalUsed: fl(0),
    energyUsed: fl(4),
    metalProduced: fl(8),
    energyProduced: fl(12),
    metalExcess: fl(16),
    energyExcess: fl(20),
    metalReceived: fl(24),
    energyReceived: fl(28),
    metalSent: fl(32),
    energySent: fl(36),
    damageDealt: fl(40),
    damageReceived: fl(44),
    unitsProduced: it(48),
    unitsDied: it(52),
    unitsReceived: it(56),
    unitsSent: it(60),
    unitsCaptured: it(64),
    unitsOutCaptured: it(68),
    unitsKilled: it(72)
  }
}

interface TeamStatsGeom {
  /** Byte offset of the first record (after the numTeams dword count array). */
  recordsStart: number
  /** Bytes per record (76 or 80). */
  rec: number
  /** Offset of the economy fields inside a record (4 when `int frame` is present). */
  f: number
  /** Snapshot count for each team. */
  counts: number[]
  layout: 'A' | 'B'
}

/**
 * Locate the team-stats block in the post-stream trailer. Tries the two known
 * block orderings and accepts whichever divides evenly into
 * `numTeams` dword counts + Σcounts × recordSize.
 */
function locateTeamStats(
  buf: Buffer,
  trailerStart: number,
  playerStatSize: number,
  winSize: number,
  numTeams: number,
  teamStatSize: number
): TeamStatsGeom | null {
  if (teamStatSize <= 0 || numTeams <= 0 || numTeams > 512) return null

  const tryAt = (start: number, layout: 'A' | 'B'): TeamStatsGeom | null => {
    if (start < 0 || start + teamStatSize > buf.length || numTeams * 4 > teamStatSize) return null
    const counts: number[] = []
    let off = start
    for (let t = 0; t < numTeams; t++) {
      const c = buf.readInt32LE(off)
      off += 4
      if (c < 0 || c > 1_000_000) return null
      counts.push(c)
    }
    const sum = counts.reduce((a, c) => a + c, 0)
    if (sum === 0) return null
    const rec = (teamStatSize - numTeams * 4) / sum
    if (!Number.isInteger(rec) || rec < TEAM_STAT_MIN || rec > 4096) return null
    return { recordsStart: off, rec, f: rec >= TEAM_STAT_MIN + 4 ? 4 : 0, counts, layout }
  }

  // A: [playerStats][teamStats][winners]   B: [winners][playerStats][teamStats]
  return (
    tryAt(trailerStart + playerStatSize, 'A') ??
    tryAt(trailerStart + winSize + playerStatSize, 'B')
  )
}

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
  const numPlayers = buf.readInt32LE(320)
  const playerStatSize = buf.readInt32LE(324)
  const playerStatElemSize = buf.readInt32LE(328)
  const numTeams = buf.readInt32LE(332)
  const teamStatSize = buf.readInt32LE(336)
  const teamStatElemSize = buf.readInt32LE(340)
  const winningAllyTeamsSize = buf.readInt32LE(348)

  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const scriptText = cString(buf, scriptStart, Math.max(0, scriptSize))

  const { teamStats, playerStats, winningAllyTeams } = readTrailer(buf, {
    trailerStart: scriptStart + scriptSize + demoStreamSize,
    demoStreamSize,
    numPlayers,
    playerStatSize,
    playerStatElemSize,
    numTeams,
    teamStatSize,
    teamStatElemSize,
    winSize: winningAllyTeamsSize
  })

  return {
    engineVersion,
    gameId,
    startTimeUnix,
    scriptText,
    gameTimeSeconds,
    wallclockSeconds,
    demoStreamSize,
    winningAllyTeams,
    teamStats,
    playerStats
  }
}

interface TrailerLayout {
  trailerStart: number
  demoStreamSize: number
  numPlayers: number
  playerStatSize: number
  playerStatElemSize: number
  numTeams: number
  teamStatSize: number
  teamStatElemSize: number
  winSize: number
}

interface Trailer {
  teamStats: TeamStat[]
  playerStats: PlayerStat[]
  winningAllyTeams: number[]
}

/**
 * After the demo stream come three blocks — player stats, team stats and the
 * winning-ally-team list — whose order has varied across engine versions. We try
 * the known orderings and accept the one whose team-stats block divides evenly
 * into `numTeams` dword counts + Σcounts × recordSize.
 */
function readTrailer(buf: Buffer, o: TrailerLayout): Trailer {
  const { trailerStart, playerStatSize, numTeams, teamStatSize, winSize } = o
  const empty: Trailer = { teamStats: [], playerStats: [], winningAllyTeams: [] }
  if (trailerStart < 0 || trailerStart > buf.length) return empty

  const readWinners = (start: number): number[] | null => {
    if (winSize <= 0) return []
    if (winSize > 64 || start < 0 || start + winSize > buf.length) return null
    const ids: number[] = []
    for (let k = 0; k < winSize; k++) {
      const v = buf.readUInt8(start + k)
      if (v > 250) return null // ally-team ids are small
      ids.push(v)
    }
    return ids
  }

  const readPlayers = (start: number): PlayerStat[] => {
    const elem = o.playerStatElemSize >= PLAYER_STAT_ELEM ? o.playerStatElemSize : PLAYER_STAT_ELEM
    if (
      o.numPlayers <= 0 ||
      playerStatSize <= 0 ||
      playerStatSize !== o.numPlayers * elem ||
      start < 0 ||
      start + playerStatSize > buf.length
    ) {
      return []
    }
    const out: PlayerStat[] = []
    for (let p = 0; p < o.numPlayers; p++) {
      const b = start + p * elem
      out.push({
        playerId: p,
        mousePixels: buf.readInt32LE(b + 0),
        mouseClicks: buf.readInt32LE(b + 4),
        keyPresses: buf.readInt32LE(b + 8),
        numCommands: buf.readInt32LE(b + 12),
        unitCommands: buf.readInt32LE(b + 16)
      })
    }
    return out
  }

  const lastSamples = (geom: TeamStatsGeom): TeamStat[] => {
    const { recordsStart, rec, f, counts } = geom
    let off = recordsStart
    const out: TeamStat[] = []
    for (let t = 0; t < numTeams; t++) {
      const c = counts[t]!
      if (c > 0) {
        const last = off + (c - 1) * rec
        if (last + f + TEAM_STAT_MIN <= buf.length) {
          const s = readSample(buf, last + f, 0)
          out.push({
            teamId: t,
            metalUsed: s.metalUsed,
            energyUsed: s.energyUsed,
            metalProduced: s.metalProduced,
            energyProduced: s.energyProduced,
            metalExcess: s.metalExcess,
            energyExcess: s.energyExcess,
            damageDealt: s.damageDealt,
            damageReceived: s.damageReceived,
            unitsProduced: s.unitsProduced,
            unitsDied: s.unitsDied,
            unitsKilled: s.unitsKilled
          })
        }
      }
      off += c * rec
    }
    return out
  }

  // A crashed game (demoStreamSize 0) has its stream running to EOF — no
  // dependable trailer offsets, so only a best-effort winner read from the tail.
  if (o.demoStreamSize > 0) {
    const geom = locateTeamStats(buf, trailerStart, playerStatSize, winSize, numTeams, teamStatSize)
    if (geom) {
      const teamStats = lastSamples(geom)
      if (geom.layout === 'A') {
        return {
          teamStats,
          playerStats: readPlayers(trailerStart),
          winningAllyTeams:
            readWinners(geom.recordsStart - numTeams * 4 + teamStatSize) ??
            readWinners(trailerStart) ??
            []
        }
      }
      return {
        teamStats,
        playerStats: readPlayers(trailerStart + winSize),
        winningAllyTeams: readWinners(trailerStart) ?? []
      }
    }
  }

  const w =
    readWinners(trailerStart + playerStatSize + teamStatSize) ??
    readWinners(trailerStart) ??
    (winSize > 0 ? readWinners(buf.length - winSize) : null) ??
    []
  return { teamStats: [], playerStats: [], winningAllyTeams: w }
}

/**
 * Full per-team snapshot history for time-series graphs. Parsed on demand (not
 * cached with the rest of the metadata). Returns null when the demo has no
 * usable team-stats trailer (crash / early exit).
 */
export function readDemoSeries(path: string): DemoSeries | null {
  const fileBuf = readFileSync(path)
  const buf =
    fileBuf.length > 1 && fileBuf[0] === 0x1f && fileBuf[1] === 0x8b
      ? gunzipSync(fileBuf)
      : fileBuf
  if (buf.length < 360 || buf.toString('ascii', 0, MAGIC.length) !== MAGIC) return null

  const headerSize = buf.readInt32LE(20)
  const scriptSize = buf.readInt32LE(304)
  const demoStreamSize = buf.readInt32LE(308)
  const playerStatSize = buf.readInt32LE(324)
  const numTeams = buf.readInt32LE(332)
  const teamStatSize = buf.readInt32LE(336)
  const teamStatPeriod = buf.readInt32LE(344)
  const winSize = buf.readInt32LE(348)

  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const scriptText = cString(buf, scriptStart, Math.max(0, scriptSize))
  if (demoStreamSize <= 0) return null

  const trailerStart = scriptStart + scriptSize + demoStreamSize
  const geom = locateTeamStats(buf, trailerStart, playerStatSize, winSize, numTeams, teamStatSize)
  if (!geom) return null

  const period = teamStatPeriod > 0 && teamStatPeriod < 3600 ? teamStatPeriod : 15
  const { recordsStart, rec, f, counts } = geom

  let off = recordsStart
  const teams: DemoSeries['teams'] = []
  for (let t = 0; t < numTeams; t++) {
    const c = counts[t]!
    const samples: TeamSample[] = []
    for (let i = 0; i < c; i++) {
      const base = off + i * rec
      if (base + f + TEAM_STAT_MIN > buf.length) break
      const frame = f === 4 ? buf.readInt32LE(base) : Math.round(i * period * 30)
      samples.push(readSample(buf, base + f, frame))
    }
    off += c * rec
    if (samples.length > 0) teams.push({ teamId: t, samples })
  }
  if (teams.length === 0) return null
  return { scriptText, periodSeconds: period, teams }
}

function cString(buf: Buffer, offset: number, maxLen: number): string {
  const slice = buf.subarray(offset, Math.min(offset + maxLen, buf.length))
  const nul = slice.indexOf(0)
  return slice.toString('utf-8', 0, nul === -1 ? slice.length : nul)
}
