/**
 * Beyond All Reason competitive seasons. Newest first. `start` is the first day
 * of the season (inclusive, treated as UTC midnight); a season runs until the
 * next one starts, and the newest season runs to now. The oldest entry uses
 * `start: null` — everything before the season after it.
 *
 * Add a new season at the top when BAR announces one.
 */
export interface Season {
  id: number
  label: string
  start: string | null
}

export const SEASONS: Season[] = [
  { id: 3, label: 'Season 3', start: '2026-01-08' },
  { id: 2, label: 'Season 2', start: null }
]

/** The current (newest) season. */
export const CURRENT_SEASON = SEASONS[0]!

/** Analytics scope key for a season, e.g. `s3`. */
export const seasonScope = (id: number): `s${number}` => `s${id}`

/**
 * Epoch-ms bounds for a season: `[start, end)`. `start` is null for the
 * open-ended oldest season; `end` is null for the newest (runs to now).
 */
export function seasonBounds(id: number): { start: number | null; end: number | null } {
  const i = SEASONS.findIndex((s) => s.id === id)
  if (i === -1) return { start: null, end: null }
  const startStr = SEASONS[i]!.start
  const newer = SEASONS[i - 1] // list is newest-first, so the next season is the previous index
  return {
    start: startStr ? Date.parse(startStr) : null,
    end: newer?.start ? Date.parse(newer.start) : null
  }
}
