import type { ReplayMeta } from '../shared/types'
import rawData from './map-roles.data.json'

/**
 * Start-position "roles" (air / front / tech / sea, plus slashed combos) curated
 * by the BAR maps team, keyed by version-stripped lower-case map name. Each spot
 * is `[x, z, role]` in world elmos. Regenerate with `scripts/fetch-map-roles.mjs`.
 */
interface RoleConfig {
  ppt: number
  tc: number
  spots: [number, number, string][]
}
const DATA = rawData as unknown as Record<string, RoleConfig[]>

/** Farther than this from any known spot ⇒ we don't guess a role (elmos). */
const MAX_SNAP_DIST = 2600

/** Mirror of stripMapVersion() in analytics.ts, for keying into the table. */
function mapKey(name: string): string {
  const m = name.match(/^(.*?)[\s_]+v?\d[\w.]*$/i)
  return (m ? m[1]! : name).trim().toLowerCase()
}

/** True when we have any role data for this map (used to explain gaps in the UI). */
export function mapHasRoles(mapName: string): boolean {
  return mapKey(mapName) in DATA
}

/**
 * Classify a start position. `x`/`z` are world elmos (as stored in a demo /
 * bar-rts record). Picks the team-size config, snaps to the nearest labelled
 * spawn point, and returns its role — or null when the map is not covered or the
 * position is nowhere near a known spot.
 */
export function roleForPosition(
  mapName: string,
  playersPerTeam: number,
  teamCount: number,
  x: number,
  z: number
): string | null {
  const configs = DATA[mapKey(mapName)]
  if (!configs || configs.length === 0) return null
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  const cfg =
    configs.find((c) => c.ppt === playersPerTeam && c.tc === teamCount) ??
    configs.find((c) => c.tc === teamCount) ??
    configs.find((c) => c.ppt === playersPerTeam) ??
    configs[0]!

  let bestRole: string | null = null
  let bestD = MAX_SNAP_DIST
  for (const [sx, sz, role] of cfg.spots) {
    const d = Math.hypot(sx - x, sz - z)
    if (d < bestD) {
      bestD = d
      bestRole = role
    }
  }
  return bestRole
}

/**
 * Fill `PlayerMeta.role` for every player whose start position is known and
 * whose map is covered. Mutates and returns `meta`.
 */
export function annotateRoles(meta: ReplayMeta): ReplayMeta {
  if (!meta.map?.name || !mapHasRoles(meta.map.name)) return meta
  const teamCount = meta.allyTeams.length
  for (const team of meta.allyTeams) {
    const ppt = team.players.filter((p) => !p.isAi).length || team.players.length
    for (const p of team.players) {
      if (!p.startPos) continue
      const role = roleForPosition(meta.map.name, ppt, teamCount, p.startPos.x, p.startPos.z)
      if (role) p.role = role
    }
  }
  return meta
}
