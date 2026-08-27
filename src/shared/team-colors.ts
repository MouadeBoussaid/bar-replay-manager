import type { AllyTeamMeta, ReplayMeta } from './types'

/** BAR's "team blue / team red" — the colour of each side's captain, when clear. */
export type TeamColor = 'blue' | 'red' | null

function parseRgb(rgb: string | undefined): [number, number, number] | null {
  if (!rgb) return null
  const m = rgb.match(/(\d+)\D+(\d+)\D+(\d+)/)
  return m ? [+m[1]!, +m[2]!, +m[3]!] : null
}

function classifyColor(rgb: string | undefined): TeamColor {
  const c = parseRgb(rgb)
  if (!c) return null
  const [r, g, b] = c
  if (b > r + 25 && b > 90) return 'blue'
  if (r > b + 25 && r > g + 10 && r > 90) return 'red'
  return null
}

/** The colour of a team's captain (highest-OS player). */
function teamColor(team: AllyTeamMeta): TeamColor {
  const byOs = [...team.players].sort((a, b) => (b.skillOS ?? -1) - (a.skillOS ?? -1))
  for (const p of byOs) {
    const c = classifyColor(p.rgbColor)
    if (c) return c
  }
  return null
}

/**
 * Blue / red label per ally-team. A 2-team game always resolves to one blue +
 * one red (defaulting team 1 → blue); FFA only labels teams we can classify.
 */
export function teamColorNames(meta: ReplayMeta): TeamColor[] {
  const raw = meta.allyTeams.map(teamColor)
  if (meta.allyTeams.length !== 2) return raw
  const [a, b] = raw
  if (a === 'red' || b === 'blue') return ['red', 'blue']
  return ['blue', 'red']
}

/** "Team Blue" / "Team Red" / "Team 3" for a header. */
export function teamLabel(ordinal: number, color: TeamColor): string {
  if (color === 'blue') return 'Team Blue'
  if (color === 'red') return 'Team Red'
  return `Team ${ordinal + 1}`
}
