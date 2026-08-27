import type { AllyTeamMeta, PlayerMeta, ReplayMeta } from '../../shared/types'

/** Fallback player palette from the design tokens, used when a replay has no rgbColor. */
export const PLAYER_PALETTE = [
  '#5ad46a',
  '#ffd24a',
  '#68b6ff',
  '#ff7ad1',
  '#9b8cff',
  '#ff9b52',
  '#63e0d0',
  '#e05c5c'
]

/** One stable colour per player — the single colour source for roster + map pip. */
export function playerColor(p: PlayerMeta, globalIndex: number): string {
  return p.rgbColor || PLAYER_PALETTE[globalIndex % PLAYER_PALETTE.length]!
}

/** Average OS across a team's human players, or null if none are rated. */
export function teamAvgOs(team: AllyTeamMeta): number | null {
  const rated = team.players.filter((p) => typeof p.skillOS === 'number')
  if (rated.length === 0) return null
  return rated.reduce((sum, p) => sum + (p.skillOS ?? 0), 0) / rated.length
}

export interface RosterEntry {
  player: PlayerMeta
  color: string
  /** Fraction 0..1 of the highest metal value in the whole match (for the bar). */
  valueShare: number
}

/**
 * Flatten the match into per-team roster entries with a shared colour index and a
 * value bar scaled to the single highest metal figure across every player.
 */
export function buildRosters(meta: ReplayMeta): RosterEntry[][] {
  let gi = 0
  let maxMetal = 0
  for (const t of meta.allyTeams)
    for (const p of t.players) if ((p.metal ?? 0) > maxMetal) maxMetal = p.metal ?? 0

  return meta.allyTeams.map((team) =>
    team.players.map((player) => ({
      player,
      color: playerColor(player, gi++),
      valueShare: maxMetal > 0 ? (player.metal ?? 0) / maxMetal : 0
    }))
  )
}

type Box = { left: number; top: number; right: number; bottom: number }

/** Normalised start position for a pip: the player's own, else spread inside the team box. */
export function pipPosition(
  player: PlayerMeta,
  team: AllyTeamMeta,
  indexInTeam: number,
  teamSize: number,
  teamOrdinal: number,
  zoneCount: number
): { x: number; y: number } {
  if (player.startPos) return player.startPos

  const box = team.startBox ?? defaultBox(teamOrdinal, zoneCount)
  const cols = Math.max(1, Math.ceil(Math.sqrt(teamSize)))
  const rows = Math.max(1, Math.ceil(teamSize / cols))
  const col = indexInTeam % cols
  const row = Math.floor(indexInTeam / cols)
  const x = box.left + ((col + 1) / (cols + 1)) * (box.right - box.left)
  const y = box.top + ((row + 1) / (rows + 1)) * (box.bottom - box.top)
  return { x, y }
}

/** Ally teams without an explicit start rect get a horizontal band, top to bottom. */
function defaultBox(ordinal: number, total: number): Box {
  const band = 1 / Math.max(1, total)
  const top = Math.min(ordinal, total - 1) * band
  return { left: 0.04, right: 0.96, top: top + band * 0.12, bottom: top + band * 0.88 }
}
