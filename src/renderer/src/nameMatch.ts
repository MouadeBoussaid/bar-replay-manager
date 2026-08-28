/**
 * Rank player-name matches for the autocomplete inputs. Exact match first, then
 * prefix, then substring (earlier position wins), then shortest — so a short
 * name like "Rde" isn't buried under longer names that merely contain it.
 */
export function rankPlayerNames(names: string[], query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { n: string; s: number }[] = []
  for (const n of names) {
    const l = n.toLowerCase()
    let s = -1
    if (l === q) s = 0
    else if (l.startsWith(q)) s = 1
    else {
      const i = l.indexOf(q)
      if (i >= 0) s = 2 + i / 1000
    }
    if (s >= 0) scored.push({ n, s })
  }
  scored.sort((a, b) => a.s - b.s || a.n.length - b.n.length || a.n.localeCompare(b.n))
  return scored.slice(0, limit).map((x) => x.n)
}
