import type { AllyTeamMeta, MapInfo, PlayerMeta, ReplayMeta } from '../../shared/types'

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

/** The colour of a team's captain (highest-OS player) — BAR's "team blue / red". */
function teamColor(team: AllyTeamMeta): TeamColor {
  const byOs = [...team.players].sort((a, b) => (b.skillOS ?? -1) - (a.skillOS ?? -1))
  for (const p of byOs) {
    const c = classifyColor(p.rgbColor)
    if (c) return c
  }
  return null
}

/**
 * Blue / red label per ally-team, BAR-style. A 2-team game always resolves to one
 * blue + one red (defaulting team 1 → blue); FFA only labels teams we can classify.
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

export interface RosterEntry {
  player: PlayerMeta
  color: string
  /** Fraction 0..1 of the highest damage-dealt figure in the whole match (for the bar). */
  valueShare: number
}

/**
 * Flatten the match into per-team roster entries with a shared colour index and a
 * value bar scaled to the single highest damage-dealt figure across every player.
 */
export function buildRosters(meta: ReplayMeta): RosterEntry[][] {
  let gi = 0
  let maxDmg = 0
  for (const t of meta.allyTeams)
    for (const p of t.players) {
      const d = p.stats?.damageDealt ?? 0
      if (d > maxDmg) maxDmg = d
    }

  return meta.allyTeams.map((team) =>
    team.players.map((player) => ({
      player,
      color: playerColor(player, gi++),
      valueShare: maxDmg > 0 ? (player.stats?.damageDealt ?? 0) / maxDmg : 0
    }))
  )
}

type Box = { left: number; top: number; right: number; bottom: number }

export interface Pip {
  x: number // 0..1 across the (square) minimap
  y: number // 0..1 down
  name: string
  color: string
  /** true when the spot is inferred (team box / canonical spot), not the real one. */
  approx: boolean
}

/**
 * One pip per player. Uses the player's real world start position when we have it
 * (needs map dimensions to normalise), else the map's canonical start spots that
 * fall in the team's box, else an even spread across the team box.
 */
export function buildPips(meta: ReplayMeta, mapInfo: MapInfo | null): Pip[][] {
  const rosters = buildRosters(meta)
  const worldW = mapInfo ? mapInfo.width * 512 : 0
  const worldH = mapInfo ? mapInfo.height * 512 : 0
  const anyReal =
    worldW > 0 && meta.allyTeams.some((t) => t.players.some((p) => p.startPos))

  // Canonical spots normalised, kept for teams that have no real positions.
  const canon =
    worldW > 0
      ? (mapInfo?.startPositions ?? []).map((s) => ({ x: s.x / worldW, y: s.z / worldH }))
      : []
  const canonUsed = new Set<number>()

  return meta.allyTeams.map((team, ti) => {
    const box = team.startBox ?? defaultBox(ti, Math.max(2, meta.allyTeams.length))
    // Canonical spots inside this team's box, nearest-first isn't needed — order is fine.
    const boxSpots = canon
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => !canonUsed.has(i) && inBox(p, box))

    let boxCursor = 0
    return (rosters[ti] ?? []).map(({ player, color }, pi) => {
      if (anyReal && player.startPos && worldW > 0) {
        return {
          x: clamp01(player.startPos.x / worldW),
          y: clamp01(player.startPos.z / worldH),
          name: player.name,
          color,
          approx: false
        }
      }
      const spot = boxSpots[boxCursor++]
      if (spot) {
        canonUsed.add(spot.i)
        return { x: spot.p.x, y: spot.p.y, name: player.name, color, approx: true }
      }
      const spread = spreadInBox(box, pi, team.players.length)
      return { x: spread.x, y: spread.y, name: player.name, color, approx: true }
    })
  })
}

function inBox(p: { x: number; y: number }, b: Box): boolean {
  return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function spreadInBox(box: Box, i: number, count: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const col = i % cols
  const row = Math.floor(i / cols)
  return {
    x: box.left + ((col + 1) / (cols + 1)) * (box.right - box.left),
    y: box.top + ((row + 1) / (rows + 1)) * (box.bottom - box.top)
  }
}

/** Ally teams without an explicit start rect get a horizontal band, top to bottom. */
function defaultBox(ordinal: number, total: number): Box {
  const band = 1 / Math.max(1, total)
  const top = Math.min(ordinal, total - 1) * band
  return { left: 0.04, right: 0.96, top: top + band * 0.12, bottom: top + band * 0.88 }
}
