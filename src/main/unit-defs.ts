import { UNIT_DEF_TABLES, type UnitDefTable } from './data/unitDefTables.generated'

export interface UnitDef {
  metalCost: number
  offensive: boolean
}

const cache = new Map<string, Map<number, UnitDef> | null>()

/**
 * Bundled unit-def table for a replay's `GameType` string, as a
 * `unitDefID -> { metalCost, offensive }` map. Exact version match, else the
 * closest table within `MAX_BUILD_SKEW` builds, else null.
 *
 * The version match matters: unitDefIDs are assigned from unit-file load order,
 * so they shift whenever units are added/removed. Validation showed a table
 * ~2000 builds off turns "build a mine" into "build a 70k superweapon". `null`
 * means "no offensive classification" — callers count every unit type.
 */
const MAX_BUILD_SKEW = 400

export function loadUnitDefs(gameVersion: string): Map<number, UnitDef> | null {
  const key = gameVersion || '(none)'
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const table = pickTable(gameVersion)
  const map = table ? toMap(table) : null
  cache.set(key, map)
  return map
}

/** BAR dev builds are `... test-<N>-<hash>`; that <N> is the meaningful counter. */
function buildNumber(v: string): number | null {
  const m = v.match(/test-(\d+)/)
  return m ? Number(m[1]) : null
}

function pickTable(gameVersion: string): UnitDefTable | null {
  if (UNIT_DEF_TABLES.length === 0) return null
  const exact = UNIT_DEF_TABLES.find((t) => t.gameVersion === gameVersion)
  if (exact) return exact

  const want = buildNumber(gameVersion)
  if (want != null) {
    let best: UnitDefTable | null = null
    let bestSkew = Infinity
    for (const t of UNIT_DEF_TABLES) {
      const b = buildNumber(t.gameVersion)
      if (b == null) continue
      const skew = Math.abs(b - want)
      if (skew < bestSkew) {
        best = t
        bestSkew = skew
      }
    }
    return bestSkew <= MAX_BUILD_SKEW ? best : null
  }

  // Non-dev version strings (release dates) — fall back to nearest not-newer.
  const sorted = [...UNIT_DEF_TABLES].sort((a, b) => cmpVersion(a.gameVersion, b.gameVersion))
  const notNewer = sorted.filter((t) => cmpVersion(t.gameVersion, gameVersion) <= 0)
  return notNewer[notNewer.length - 1] ?? null
}

function toMap(t: UnitDefTable): Map<number, UnitDef> {
  const m = new Map<number, UnitDef>()
  for (const [id, pair] of Object.entries(t.units)) {
    m.set(Number(id), { metalCost: pair[0], offensive: pair[1] === 1 })
  }
  return m
}

/** Compare BAR GameType strings — usually `YYYY.MM.DD`, sometimes tagged; digit runs decide. */
function cmpVersion(a: string, b: string): number {
  const na = a.match(/\d+/g)?.map(Number) ?? []
  const nb = b.match(/\d+/g)?.map(Number) ?? []
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return a < b ? -1 : a > b ? 1 : 0
}
