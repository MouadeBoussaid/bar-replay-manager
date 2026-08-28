import type { ReplayGraph } from '../shared/types'
import { readDemoSeries, type TeamSample } from './demo-header'
import { collectIndexed, findSection, parseTdf } from './tdf'

const GAME_SPEED = 30 // sim frames per second

const FIELD_KEYS: (keyof TeamSample)[] = [
  'metalProduced',
  'metalUsed',
  'metalExcess',
  'metalReceived',
  'metalSent',
  'energyProduced',
  'energyUsed',
  'energyExcess',
  'energyReceived',
  'energySent',
  'unitsProduced',
  'unitsKilled',
  'unitsDied',
  'unitsReceived',
  'unitsSent',
  'unitsCaptured',
  'unitsOutCaptured',
  'damageDealt',
  'damageReceived'
]

const FALLBACK_COLORS = [
  'rgb(90, 212, 106)',
  'rgb(255, 210, 74)',
  'rgb(104, 182, 255)',
  'rgb(255, 122, 209)',
  'rgb(155, 140, 255)',
  'rgb(255, 155, 82)',
  'rgb(99, 224, 208)',
  'rgb(224, 92, 92)'
]

/** Build the Graphs-tab payload for one replay, or null when it has no series. */
export function buildReplayGraph(filePath: string): ReplayGraph | null {
  let series: ReturnType<typeof readDemoSeries>
  try {
    series = readDemoSeries(filePath)
  } catch {
    return null
  }
  if (!series || series.teams.length === 0) return null

  const root = parseTdf(series.scriptText)
  const game = findSection(root, 'game') ?? root
  const players = collectIndexed(game, 'player')
  const ais = collectIndexed(game, 'ai')
  const teamSecs = collectIndexed(game, 'team')

  const nameByTeam = new Map<number, string>()
  for (const p of Object.values(players)) {
    const tid = num(p.keys['team'])
    if (tid !== undefined && p.keys['spectator'] !== '1' && !nameByTeam.has(tid)) {
      nameByTeam.set(tid, p.keys['name'] ?? `Team ${tid}`)
    }
  }
  for (const a of Object.values(ais)) {
    const tid = num(a.keys['team'])
    if (tid !== undefined && !nameByTeam.has(tid)) {
      nameByTeam.set(tid, a.keys['name'] ?? a.keys['shortname'] ?? `AI ${tid}`)
    }
  }

  const teams = series.teams.map((t, i) => {
    const sec = teamSecs[t.teamId]
    return {
      teamId: t.teamId,
      allyTeamId: num(sec?.keys['allyteam']) ?? 0,
      name: nameByTeam.get(t.teamId) ?? `Team ${t.teamId}`,
      color: rgbFromTdf(sec?.keys['rgbcolor']) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!
    }
  })

  // Time axis from whichever team logged the most snapshots.
  const longest = series.teams.reduce((a, b) => (b.samples.length > a.samples.length ? b : a))
  const times = longest.samples.map((s) => round2(s.frame / GAME_SPEED))

  const fields: Record<string, number[][]> = {}
  for (const key of FIELD_KEYS) {
    fields[key] = series.teams.map((t) => t.samples.map((s) => s[key]))
  }

  return { times, periodSeconds: series.periodSeconds, teams, fields }
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** "0.1 0.3 0.9" or "0 84 255" -> "rgb(r, g, b)". */
function rgbFromTdf(v: string | undefined): string | undefined {
  if (!v) return undefined
  const parts = v.trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return undefined
  const [r, g, b] = parts.map((x) => Math.round(x <= 1 ? x * 255 : x))
  return `rgb(${r}, ${g}, ${b})`
}
