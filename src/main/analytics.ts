import type {
  AnalyticsScope,
  GameResult,
  PlayerReport,
  ReplayMeta,
  ReportAppearance,
  ReportAverage,
  ReportBar,
  ReportCompanyRow
} from '../shared/types'
import { teamColorNames } from '../shared/team-colors'

/** One player's line in one replay — the unit the analytics tab aggregates over. */
interface Appearance {
  name: string
  nameKey: string
  filePath: string
  startTime: string | null
  mapName: string
  durationMs: number
  fmt: string
  side: 'blue' | 'red' | null
  faction: string
  result: GameResult
  os: number | null
  rgb: string | null
  startCell: number | null
  metalProduced?: number
  metalExcess?: number
  energyProduced?: number
  energyExcess?: number
  damageDealt?: number
  damageReceived?: number
  unitsProduced?: number
  cmdPerMin?: number
  allies: string[]
  enemies: string[]
}

let INDEX: Appearance[] = []

/** Rebuild the in-memory index from the metadata the scanner already has in hand. */
export function setAnalyticsIndex(metas: ReplayMeta[]): void {
  const rows: Appearance[] = []
  for (const meta of metas) {
    for (const a of extractAppearances(meta)) rows.push(a)
  }
  INDEX = rows
}

export function indexedPlayerNames(): string[] {
  const seen = new Map<string, string>()
  for (const a of INDEX) if (!seen.has(a.nameKey)) seen.set(a.nameKey, a.name)
  return [...seen.values()].sort((x, y) => x.localeCompare(y))
}

// ---- extraction -------------------------------------------------------------

function extractAppearances(meta: ReplayMeta): Appearance[] {
  if (meta.parseError || meta.allyTeams.length === 0) return []
  const colors = teamColorNames(meta)
  const fmt = meta.allyTeams.map((t) => t.players.length).join('v')
  const out: Appearance[] = []

  meta.allyTeams.forEach((team, ti) => {
    const humans = team.players.filter((p) => !p.isAi).map((p) => p.name)
    const enemies = meta.allyTeams
      .filter((_, j) => j !== ti)
      .flatMap((t) => t.players.filter((p) => !p.isAi).map((p) => p.name))
    const cell = cellFromBox(team.startBox)

    for (const p of team.players) {
      if (p.isAi) continue
      const s = p.stats
      out.push({
        name: p.name,
        nameKey: p.name.toLowerCase(),
        filePath: meta.filePath,
        startTime: meta.startTime,
        mapName: stripMapVersion(meta.map?.name ?? 'Unknown'),
        durationMs: meta.durationMs || 0,
        fmt,
        side: colors[ti] ?? null,
        faction: normFaction(p.faction),
        result: team.won === true ? 'win' : team.won === false ? 'loss' : 'undecided',
        os: typeof p.skillOS === 'number' ? p.skillOS : null,
        rgb: p.rgbColor ?? null,
        startCell: cellFromStartPos(p.startPos, meta.map) ?? cell,
        metalProduced: s?.metalProduced,
        metalExcess: s?.metalExcess,
        energyProduced: s?.energyProduced,
        energyExcess: s?.energyExcess,
        damageDealt: s?.damageDealt,
        damageReceived: s?.damageReceived,
        unitsProduced: s?.unitsProduced,
        cmdPerMin: s?.cmdPerMin,
        allies: humans.filter((n) => n !== p.name),
        enemies
      })
    }
  })
  return out
}

function normFaction(f: string | undefined): string {
  const s = (f ?? '').toLowerCase()
  if (s.startsWith('arm')) return 'Armada'
  if (s.startsWith('cor')) return 'Cortex'
  if (s.startsWith('leg')) return 'Legion'
  if (!s || s === 'random') return 'Random'
  return f![0]!.toUpperCase() + f!.slice(1)
}

function stripMapVersion(name: string): string {
  const m = name.match(/^(.*?)[\s_]+v?\d[\w.]*$/i)
  return (m ? m[1]! : name).trim()
}

/** 3×2 grid cell (0..5) from a normalised start rect centroid, or null. */
function cellFromBox(
  box: { left: number; top: number; right: number; bottom: number } | undefined
): number | null {
  if (!box) return null
  return cellFromXY((box.left + box.right) / 2, (box.top + box.bottom) / 2)
}

function cellFromStartPos(
  pos: { x: number; z: number } | undefined,
  map: ReplayMeta['map']
): number | null {
  if (!pos || !map?.width || !map?.height) return null
  return cellFromXY(pos.x / (map.width * 512), pos.z / (map.height * 512))
}

function cellFromXY(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const col = x < 1 / 3 ? 0 : x < 2 / 3 ? 1 : 2
  const row = y < 0.5 ? 0 : 1
  return row * 3 + col
}

// ---- report ---------------------------------------------------------------

const FACTION_META: Record<string, { letter: string; color: string }> = {
  Armada: { letter: 'A', color: '#6db8ff' },
  Cortex: { letter: 'C', color: '#ff6b5e' },
  Legion: { letter: 'L', color: '#7bd88f' },
  Random: { letter: 'R', color: '#b98cff' }
}

const FORM_METRICS = [
  { key: 'metalPerMin', label: 'Metal / min' },
  { key: 'energyPerMin', label: 'Energy / min' },
  { key: 'damageDealt', label: 'Damage dealt' },
  { key: 'damageTaken', label: 'Damage taken' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'cmdPerMin', label: 'CMD / min' },
  { key: 'unitsMade', label: 'Units made' },
  { key: 'os', label: 'OS' }
]

const DURATION_BUCKETS: [string, number, number][] = [
  ['<15m', 0, 15 * 60_000],
  ['15–25m', 15 * 60_000, 25 * 60_000],
  ['25–40m', 25 * 60_000, 40 * 60_000],
  ['40m+', 40 * 60_000, Infinity]
]

export function buildPlayerReport(name: string, scope: AnalyticsScope): PlayerReport {
  const key = name.trim().toLowerCase()
  const all = INDEX.filter((a) => a.nameKey === key)
  all.sort((x, y) => (x.startTime ?? '').localeCompare(y.startTime ?? ''))

  const scoped = applyScope(all, scope)
  const empty: PlayerReport = {
    name: name.trim(),
    found: all.length > 0,
    scope,
    totalGames: scoped.length,
    wins: 0,
    losses: 0,
    undecided: 0,
    winRate: null,
    firstSeen: all[0]?.startTime ?? null,
    lastSeen: all[all.length - 1]?.startTime ?? null,
    os: null,
    thinSample: scoped.length < 20,
    averages: [],
    form: { metrics: FORM_METRICS, games: [] },
    factions: [],
    sizes: [],
    durations: [],
    startCells: [0, 0, 0, 0, 0, 0],
    startSplits: { north: 0, south: 0, flank: 0, centre: 0 },
    startExcluded: 0,
    maps: [],
    mapsHasMore: false,
    company: { withP: [], vsP: [] },
    appearances: []
  }
  if (scoped.length === 0) return empty

  const wins = scoped.filter((a) => a.result === 'win').length
  const losses = scoped.filter((a) => a.result === 'loss').length
  const undecided = scoped.length - wins - losses
  const decided = wins + losses

  empty.wins = wins
  empty.losses = losses
  empty.undecided = undecided
  empty.winRate = decided > 0 ? wins / decided : null
  empty.os = [...scoped].reverse().find((a) => a.os != null)?.os ?? null

  empty.averages = buildAverages(scoped)
  empty.form = { metrics: FORM_METRICS, games: scoped.slice(-40).map(formGame) }
  empty.factions = groupBars(scoped, (a) => a.faction, {
    order: ['Armada', 'Cortex', 'Legion', 'Random'],
    meta: (label) => FACTION_META[label] ?? { letter: label[0] ?? '?', color: '#9aa0ac' }
  })
  empty.sizes = groupBars(scoped, (a) => a.fmt, {
    order: ['8v8', '4v4', '3v3', '2v2', '1v1', 'FFA'],
    meta: () => ({})
  })
  empty.durations = DURATION_BUCKETS.map(([label, lo, hi]) => {
    const g = scoped.filter((a) => a.durationMs >= lo && a.durationMs < hi)
    return { label, games: g.length, winRate: winRateOf(g) }
  })

  const withCell = scoped.filter((a) => a.startCell != null)
  const cellCounts = [0, 0, 0, 0, 0, 0]
  for (const a of withCell) cellCounts[a.startCell!]!++
  const cn = withCell.length || 1
  empty.startCells = cellCounts.map((c) => c / cn)
  const north = (cellCounts[0]! + cellCounts[1]! + cellCounts[2]!) / cn
  const centre = (cellCounts[1]! + cellCounts[4]!) / cn
  empty.startSplits = { north, south: 1 - north, centre, flank: 1 - centre }
  empty.startExcluded = scoped.length - withCell.length

  const byMap = groupCount(scoped, (a) => a.mapName)
  const maps = [...byMap.entries()]
    .filter(([, g]) => g.length >= 20)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name2, g]) => ({ name: name2, games: g.length, winRate: winRateOf(g) }))
  empty.maps = maps.slice(0, 6)
  empty.mapsHasMore = maps.length > 6

  empty.company = {
    withP: companyRows(scoped, 'allies'),
    vsP: companyRows(scoped, 'enemies')
  }

  empty.appearances = [...scoped].reverse().map(appearanceRow)
  return empty
}

function applyScope(rows: Appearance[], scope: AnalyticsScope): Appearance[] {
  if (scope === 'last50') return rows.slice(-50)
  if (scope === '90d') {
    const cutoff = Date.now() - 90 * 86_400_000
    return rows.filter((a) => a.startTime && new Date(a.startTime).getTime() >= cutoff)
  }
  return rows
}

function winRateOf(rows: Appearance[]): number | null {
  const w = rows.filter((a) => a.result === 'win').length
  const l = rows.filter((a) => a.result === 'loss').length
  return w + l > 0 ? w / (w + l) : null
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}

// ---- averages + baseline --------------------------------------------------

interface MetricDef {
  key: string
  label: string
  /** raw per-appearance value */
  pick: (a: Appearance) => number | undefined
  fmt: (v: number) => string
  /** true when a higher value is good */
  higherBetter: boolean
  /** show delta as percentage points, not percent */
  pts?: boolean
}

const METRICS: MetricDef[] = [
  { key: 'metal', label: 'Metal / game', pick: (a) => a.metalProduced, fmt: fmtK, higherBetter: true },
  { key: 'energy', label: 'Energy / game', pick: (a) => a.energyProduced, fmt: fmtK, higherBetter: true },
  { key: 'mexcess', label: 'Metal excess', pick: (a) => a.metalExcess, fmt: fmtK, higherBetter: false },
  { key: 'dmg', label: 'Damage dealt', pick: (a) => a.damageDealt, fmt: fmtK, higherBetter: true },
  { key: 'dmgt', label: 'Damage taken', pick: (a) => a.damageReceived, fmt: fmtK, higherBetter: false },
  {
    key: 'eff',
    label: 'Efficiency',
    pick: (a) =>
      a.damageDealt != null && a.damageReceived
        ? (a.damageDealt / a.damageReceived) * 100
        : undefined,
    fmt: (v) => `${Math.round(v)}%`,
    higherBetter: true,
    pts: true
  },
  { key: 'units', label: 'Units made', pick: (a) => a.unitsProduced, fmt: (v) => `${Math.round(v)}`, higherBetter: true },
  { key: 'cmd', label: 'CMD / min', pick: (a) => a.cmdPerMin, fmt: (v) => `${Math.round(v)}`, higherBetter: true }
]

function buildAverages(scoped: Appearance[]): ReportAverage[] {
  return METRICS.map((m): ReportAverage => {
    const vals = scoped.map(m.pick).filter((v): v is number => v != null)
    const baseVals = INDEX.map(m.pick).filter((v): v is number => v != null)
    if (vals.length === 0) {
      return { key: m.key, label: m.label, value: '—', delta: null, good: null }
    }
    const avg = mean(vals)
    const base = baseVals.length ? mean(baseVals) : avg
    let delta: string | null = null
    let good: boolean | null = null
    if (base > 0) {
      if (m.pts) {
        const dp = avg - base
        delta = `${sign(dp)}${Math.abs(Math.round(dp))}pt`
        good = dp === 0 ? null : dp > 0 === m.higherBetter
      } else {
        const pct = ((avg - base) / base) * 100
        delta = `${sign(pct)}${Math.abs(Math.round(pct))}%`
        good = Math.round(pct) === 0 ? null : pct > 0 === m.higherBetter
      }
    }
    return { key: m.key, label: m.label, value: m.fmt(avg), delta, good }
  })
}

function sign(n: number): string {
  return n > 0 ? '+' : n < 0 ? '−' : ''
}

// ---- form / bars / company / appearances --------------------------------

function formGame(a: Appearance): PlayerReport['form']['games'][number] {
  const min = a.durationMs / 60_000 || 1
  return {
    date: a.startTime ?? '',
    map: a.mapName,
    result: a.result,
    filePath: a.filePath,
    values: {
      metalPerMin: a.metalProduced != null ? a.metalProduced / min : null,
      energyPerMin: a.energyProduced != null ? a.energyProduced / min : null,
      damageDealt: a.damageDealt ?? null,
      damageTaken: a.damageReceived ?? null,
      efficiency:
        a.damageDealt != null && a.damageReceived
          ? (a.damageDealt / a.damageReceived) * 100
          : null,
      cmdPerMin: a.cmdPerMin ?? null,
      unitsMade: a.unitsProduced ?? null,
      os: a.os
    }
  }
}

function groupBars(
  rows: Appearance[],
  keyOf: (a: Appearance) => string,
  opts: { order: string[]; meta: (label: string) => { letter?: string; color?: string } }
): ReportBar[] {
  const g = groupCount(rows, keyOf)
  const maxGames = Math.max(1, ...[...g.values()].map((x) => x.length))
  return [...g.entries()]
    .sort((a, b) => {
      const ia = opts.order.indexOf(a[0])
      const ib = opts.order.indexOf(b[0])
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return b[1].length - a[1].length
    })
    .map(([label, list]) => ({
      label,
      ...opts.meta(label),
      games: list.length,
      winRate: winRateOf(list),
      share: list.length / maxGames
    }))
}

function groupCount<T>(rows: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

function companyRows(rows: Appearance[], field: 'allies' | 'enemies'): ReportCompanyRow[] {
  const acc = new Map<string, { games: number; wins: number; losses: number; rgb: string | null }>()
  for (const a of rows) {
    for (const other of a[field]) {
      const e = acc.get(other) ?? { games: 0, wins: 0, losses: 0, rgb: null }
      e.games++
      if (a.result === 'win') e.wins++
      else if (a.result === 'loss') e.losses++
      if (a.rgb) e.rgb = a.rgb
      acc.set(other, e)
    }
  }
  return [...acc.entries()]
    .filter(([, e]) => e.games >= 15)
    .sort((x, y) => y[1].games - x[1].games)
    .slice(0, 4)
    .map(([name, e]) => ({
      name,
      color: e.rgb ?? '#8d8f96',
      games: e.games,
      winRate: e.wins + e.losses > 0 ? e.wins / (e.wins + e.losses) : null
    }))
}

function appearanceRow(a: Appearance): ReportAppearance {
  return {
    date: a.startTime ?? '',
    map: a.mapName,
    fmt: a.fmt,
    side: a.side,
    faction: a.faction,
    result: a.result,
    durationMs: a.durationMs,
    metal: a.metalProduced ?? null,
    dmg: a.damageDealt ?? null,
    eff:
      a.damageDealt != null && a.damageReceived
        ? Math.round((a.damageDealt / a.damageReceived) * 100)
        : null,
    cmd: a.cmdPerMin ?? null,
    filePath: a.filePath
  }
}

function fmtK(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return `${Math.round(v)}`
}
