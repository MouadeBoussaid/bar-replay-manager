import type { PlayerMeta, ReplayMeta } from '../shared/types'
import { store } from './store'

const BASE = 'https://api.bar-rts.com'
const TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 6000

type ServerReplay = Record<string, any>

/**
 * Fetch the bar-rts.com record for a game. Returns `null` when the replay is not
 * on the server (404). Throws on network / timeout / other HTTP errors so the
 * caller can surface a "local data only" state.
 */
export async function fetchServerReplay(gameId: string): Promise<ServerReplay | null> {
  const cached = store.getApiCache(gameId)
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) {
    return (cached.data as ServerReplay | null) ?? null
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/replays/${gameId}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    })
    if (res.status === 404) {
      store.setApiCache(gameId, null)
      return null
    }
    if (!res.ok) throw new Error(`bar-rts.com returned HTTP ${res.status}`)
    const data = (await res.json()) as ServerReplay
    store.setApiCache(gameId, data)
    return data
  } finally {
    clearTimeout(timer)
  }
}

/** Overlay authoritative server fields onto the locally-parsed metadata. */
export function mergeServerData(local: ReplayMeta, s: ServerReplay): ReplayMeta {
  const merged: ReplayMeta = { ...local }

  merged.engineVersion = str(s.engineVersion) || merged.engineVersion
  merged.gameVersion = str(s.gameVersion) || merged.gameVersion
  merged.startTime = str(s.startTime) || merged.startTime
  if (typeof s.durationMs === 'number') merged.durationMs = s.durationMs
  if (typeof s.gameEndedNormally === 'boolean') merged.endedNormally = s.gameEndedNormally

  if (s.Map) {
    merged.map = {
      name: str(s.Map.scriptName) || str(s.Map.fileName) || merged.map.name,
      fileName: str(s.Map.fileName) || merged.map.fileName,
      width: numOrUndef(s.Map.width),
      height: numOrUndef(s.Map.height)
    }
  }

  if (isRecord(s.hostSettings)) merged.hostSettings = stringifyValues(s.hostSettings)
  if (isRecord(s.gameSettings)) merged.gameSettings = stringifyValues(s.gameSettings)
  if (isRecord(s.mapSettings)) merged.mapSettings = stringifyValues(s.mapSettings)
  if (isRecord(s.spadsSettings)) merged.spadsSettings = stringifyValues(s.spadsSettings)
  if (s.awards !== undefined) merged.awards = s.awards

  const serverAlly: any[] = Array.isArray(s.AllyTeams) ? s.AllyTeams : []

  if (merged.allyTeams.length > 0 && serverAlly.length > 0) {
    // Overlay server fields onto the locally-parsed roster (local stays the base
    // so the demo trailer's per-player metal and SPADS skill are never lost).
    const serverPlayers = new Map<string, any>()
    for (const at of serverAlly)
      for (const p of toArray<any>(at.Players)) serverPlayers.set(str(p.name), p)

    merged.allyTeams = merged.allyTeams.map((team, idx) => {
      const sat = serverAlly[idx]
      return {
        ...team,
        won:
          typeof sat?.winningTeam === 'boolean' ? sat.winningTeam : team.won,
        startBox: team.startBox ?? parseStartBox(sat?.startBox),
        players: team.players.map((pl) => {
          const sp = serverPlayers.get(pl.name)
          if (!sp) return pl
          return {
            ...pl,
            countryCode: pl.countryCode ?? (str(sp.countryCode) || undefined),
            rank: pl.rank ?? numOrUndef(sp.rank),
            skillOS: pl.skillOS ?? parseServerSkill(sp.skill),
            skillSigma: pl.skillSigma ?? numOrUndef(sp.skillUncertainty),
            rgbColor: pl.rgbColor ?? rgbFromServer(sp.rgbColor),
            startPos: pl.startPos ?? serverStartPos(sp)
          }
        })
      }
    })
  } else if (serverAlly.length > 0) {
    // No usable local roster — build one from the server.
    merged.allyTeams = serverAlly.map((at: any, idx: number) => ({
      id: numOrUndef(at.allyTeamId) ?? numOrUndef(at.id) ?? idx,
      won: typeof at.winningTeam === 'boolean' ? at.winningTeam : undefined,
      startBox: parseStartBox(at.startBox),
      players: [
        ...toArray(at.Players).map(
          (p: any): PlayerMeta => ({
            name: str(p.name),
            faction: str(p.faction) || undefined,
            countryCode: str(p.countryCode) || undefined,
            rank: numOrUndef(p.rank),
            skillOS: parseServerSkill(p.skill),
            skillSigma: numOrUndef(p.skillUncertainty),
            rgbColor: rgbFromServer(p.rgbColor),
            startPos: serverStartPos(p)
          })
        ),
        ...toArray(at.AIs).map(
          (a: any): PlayerMeta => ({
            name: str(a.name) || str(a.shortName) || 'AI',
            faction: str(a.faction) || undefined,
            isAi: true
          })
        )
      ]
    }))
  }

  if (Array.isArray(s.Spectators)) {
    merged.spectators = s.Spectators.map(
      (p: any): PlayerMeta => ({
        name: str(p.name),
        countryCode: str(p.countryCode) || undefined,
        rank: numOrUndef(p.rank),
        skillOS: parseServerSkill(p.skill)
      })
    )
  }

  return merged
}

/** bar-rts stores skill as a bracketed string like `"[13.87]"` (or occasionally a number). */
function parseServerSkill(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const m = v.match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : undefined
}

/** bar-rts stores player colour as `{ r, g, b }` (0..255). */
function rgbFromServer(v: unknown): string | undefined {
  if (!isRecord(v)) return undefined
  const r = numOrUndef(v.r)
  const g = numOrUndef(v.g)
  const b = numOrUndef(v.b)
  if (r === undefined || g === undefined || b === undefined) return undefined
  return `rgb(${r}, ${g}, ${b})`
}

/** A server player's start position in world elmos (`{x, z}`), if present. */
function serverStartPos(p: any): { x: number; z: number } | undefined {
  const raw = p?.startPos ?? p?.startpos
  if (!raw) return undefined
  const x = numOrUndef(raw.x)
  const z = numOrUndef(raw.z ?? raw.y)
  if (x === undefined || z === undefined) return undefined
  if (x === 0 && z === 0) return undefined // engine's "unset" sentinel
  return { x, z }
}

function parseStartBox(v: any): AllyBox | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { left, top, right, bottom } = v
  if ([left, top, right, bottom].every((x) => typeof x === 'number')) {
    return { left, top, right, bottom }
  }
  return undefined
}
type AllyBox = { left: number; top: number; right: number; bottom: number }

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function numOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function stringifyValues(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = str(v)
  return out
}
function toArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : []
}
