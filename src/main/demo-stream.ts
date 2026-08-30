import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { collectIndexed, findSection, parseTdf } from './tdf'

/**
 * Reader for the demo's command stream (the bytes between the start script and
 * the stats trailer). Pulls out build orders so the comparison drawer can weight
 * "value on field" toward combat units.
 *
 * Message ids and layouts are from RecoilEngine `rts/Net/Protocol`
 * (NetMessageTypes.h / BaseNetProtocol.cpp). Confirmed against the source but
 * NOT yet against a corpus of real replays — treat the numbers as provisional.
 */

const MAGIC = 'spring demofile'

const NETMSG_COMMAND = 11
const NETMSG_AICOMMAND = 14
const NETMSG_AICOMMAND_TRACKED = 76

export interface BuildOrder {
  /** Game time in seconds (the demo chunk's modGameTime). */
  t: number
  /** In-game team of the ordering player, or null when it can't be resolved. */
  teamId: number | null
  /** unitDefID being built (`-cmdId` of a negative build command). */
  unitDefId: number
}

export interface DemoStream {
  /** The replay's `[GAME] { GameType }` string, for unit-def table selection. */
  gameVersion: string
  orders: BuildOrder[]
}

/**
 * Walk the demo stream and collect every build order (a command whose id is
 * negative — `unitDefID = -cmdId`). NETMSG_COMMAND is attributed to the sending
 * player's team without tracking selection, which is enough for a per-team
 * ratio. Returns null when the demo has no usable stream.
 */
export function readDemoStream(path: string): DemoStream | null {
  let buf: Buffer
  try {
    const raw = readFileSync(path)
    buf = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  } catch {
    return null
  }
  if (buf.length < 360 || buf.toString('ascii', 0, MAGIC.length) !== MAGIC) return null

  const headerSize = buf.readInt32LE(20)
  const scriptSize = buf.readInt32LE(304)
  const demoStreamSize = buf.readInt32LE(308)
  if (demoStreamSize <= 0) return null

  const scriptStart = headerSize > 0 && headerSize < buf.length ? headerSize : 352
  const scriptText = cString(buf, scriptStart, Math.max(0, scriptSize))
  const root = parseTdf(scriptText)
  const game = findSection(root, 'game') ?? root
  const gameVersion = game.keys['gametype'] ?? ''

  const teamByPlayer = new Map<number, number>()
  for (const [pnum, sec] of Object.entries(collectIndexed(game, 'player'))) {
    const team = Number(sec.keys['team'])
    if (Number.isInteger(team)) teamByPlayer.set(Number(pnum), team)
  }

  const start = scriptStart + scriptSize
  const end = Math.min(buf.length, start + demoStreamSize)
  const orders: BuildOrder[] = []

  let p = start
  while (p + 8 <= end) {
    const modGameTime = buf.readFloatLE(p)
    const length = buf.readUInt32LE(p + 4)
    p += 8
    if (length === 0 || p + length > end) break

    const msg = buf.readUInt8(p)
    if (msg === NETMSG_COMMAND) {
      // [u8 id][u16 size][u8 playerNum][i32 cmdId][i32 timeout][u8 options]...
      const playerNum = buf.readUInt8(p + 3)
      const cmdId = buf.readInt32LE(p + 4)
      if (cmdId < 0) {
        orders.push({
          t: modGameTime,
          teamId: teamByPlayer.get(playerNum) ?? null,
          unitDefId: -cmdId
        })
      }
    } else if (msg === NETMSG_AICOMMAND || msg === NETMSG_AICOMMAND_TRACKED) {
      // [u8 id][u16 size][u8 playerNum][u8 aiInstId][u8 aiTeamId][i16 unitId][i32 cmdId]...
      const aiTeamId = buf.readUInt8(p + 5)
      const cmdId = buf.readInt32LE(p + 8)
      if (cmdId < 0) orders.push({ t: modGameTime, teamId: aiTeamId, unitDefId: -cmdId })
    }

    p += length
  }

  return orders.length > 0 ? { gameVersion, orders } : null
}

function cString(buf: Buffer, offset: number, maxLen: number): string {
  const slice = buf.subarray(offset, Math.min(offset + maxLen, buf.length))
  const nul = slice.indexOf(0)
  return slice.toString('utf-8', 0, nul === -1 ? slice.length : nul)
}
