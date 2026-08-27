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

  if (Array.isArray(s.AllyTeams) && s.AllyTeams.length > 0) {
    merged.allyTeams = s.AllyTeams.map((at: any, idx: number) => ({
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
            skillOS: numOrUndef(p.skill),
            skillSigma: numOrUndef(p.skillUncertainty),
            rgbColor: str(p.rgbColor) || undefined
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
        skillOS: numOrUndef(p.skill)
      })
    )
  }

  return merged
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
