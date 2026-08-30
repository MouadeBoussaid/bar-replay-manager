import { UNIT_DEF_TABLES, type UnitDefTable } from './data/unitDefTables.generated'

export interface UnitDef {
  metalCost: number
  offensive: boolean
}

const cache = new Map<string, Map<number, UnitDef> | null>()

/**
 * Best bundled unit-def table for a replay's `GameType` string, as a
 * `unitDefID -> { metalCost, offensive }` map. Exact version match wins; else the
 * newest table that isn't newer than the replay; else null.
 *
 * `null` means "no offensive classification available" — callers must fall back
 * to counting every unit type. No tables are bundled until a dump is generated
 * (see src/main/data/README.md), so this returns null today.
 */
export function loadUnitDefs(gameVersion: string): Map<number, UnitDef> | null {
  const key = gameVersion || '(none)'
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const table = pickTable(gameVersion)
  const map = table ? toMap(table) : null
  cache.set(key, map)
  return map
}

function pickTable(gameVersion: string): UnitDefTable | null {
  if (UNIT_DEF_TABLES.length === 0) return null
  const exact = UNIT_DEF_TABLES.find((t) => t.gameVersion === gameVersion)
  if (exact) return exact
  const sorted = [...UNIT_DEF_TABLES].sort((a, b) => cmpVersion(a.gameVersion, b.gameVersion))
  const notNewer = sorted.filter((t) => cmpVersion(t.gameVersion, gameVersion) <= 0)
  return notNewer[notNewer.length - 1] ?? sorted[sorted.length - 1] ?? null
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
