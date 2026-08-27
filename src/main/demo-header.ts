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

export interface RawDemo {
  engineVersion: string
  gameId: string | null
  startTimeUnix: number
  scriptText: string
  gameTimeSeconds: number
  wallclockSeconds: number
  demoStreamSize: number
  winningAllyTeams: number[]
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
  const playerStatSize = buf.readInt32LE(324)
  const teamStatSize = buf.readInt32LE(336)
  const winningAllyTeamsSize = buf.readInt32LE(348)

  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const scriptText = cString(buf, scriptStart, Math.max(0, scriptSize))

  // The winning ally-team list is a trailer after everything else.
  const winStart =
    scriptStart + scriptSize + demoStreamSize + playerStatSize + teamStatSize
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
    winningAllyTeams
  }
}

function cString(buf: Buffer, offset: number, maxLen: number): string {
  const slice = buf.subarray(offset, Math.min(offset + maxLen, buf.length))
  const nul = slice.indexOf(0)
  return slice.toString('utf-8', 0, nul === -1 ? slice.length : nul)
}
