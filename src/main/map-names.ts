import rawData from './map-names.data.json'

/**
 * Community names for specific start positions, layered on top of BAR's generic
 * roles (air / front / tech / sea). The metagame calls certain spots by their own
 * names — often *asymmetrically*, where two mirror-image positions get different
 * names — so this table is hand-maintained, never fetched. Keyed by
 * version-stripped lower-case map name; each entry is `[x, z, name]` in world
 * elmos (the same space as a demo / bar-rts start position and as map-roles).
 */
const DATA = rawData as unknown as Record<string, [number, number, string][]>

/**
 * How close a position must be to a named anchor to take its name (elmos).
 * Tighter than the role snap (2600): a nearby spot the community hasn't named
 * should keep showing its generic role, not borrow a neighbour's name.
 */
const MAX_SNAP_DIST = 1000

/** Mirror of stripMapVersion() in analytics.ts, for keying into the table. */
function mapKey(name: string): string {
  const m = name.match(/^(.*?)[\s_]+v?\d[\w.]*$/i)
  return (m ? m[1]! : name).trim().toLowerCase()
}

/** True when we have any community names for this map. */
export function mapHasNames(mapName: string): boolean {
  return mapKey(mapName) in DATA
}

/**
 * The community name for a start position, or null when the map has no names or
 * the position is not close enough to a named anchor. `x`/`z` are world elmos.
 */
export function nameForPosition(mapName: string, x: number, z: number): string | null {
  const anchors = DATA[mapKey(mapName)]
  if (!anchors || anchors.length === 0) return null
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  let best: string | null = null
  let bestD = MAX_SNAP_DIST
  for (const [ax, az, name] of anchors) {
    const d = Math.hypot(ax - x, az - z)
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}
