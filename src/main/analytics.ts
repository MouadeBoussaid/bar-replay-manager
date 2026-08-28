import type {
  AnalyticsScope,
  GameResult,
  PlayerReport,
  ReplayMeta,
  ReportAppearance,
  ReportAverage,
  ReportBar,
  ReportCompanyRow,
  ReportStartMap,
  ReportStartSpot
} from '../shared/types'
import { teamColorNames } from '../shared/team-colors'
import { roleForPosition } from './map-roles'
import { store } from './store'

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
  /** Normalised per-player start position from a cached bar-rts record, 0..1. */
  startNX?: number
  startNY?: number
  /** Curated start-position role (air / front / tech / sea, …), when resolvable. */
  role?: string
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

/** True when any participant is an AI — flagged in the script, or a name ending "AI". */
export function isAiReplay(meta: ReplayMeta): boolean {
  return meta.allyTeams.some((t) =>
    t.players.some((p) => p.isAi || p.name.trim().endsWith('AI'))
  )
}

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
  if (meta.parseError || meta.allyTeams.length === 0 || isAiReplay(meta)) return []
  const colors = teamColorNames(meta)
  const fmt = meta.allyTeams.map((t) => t.players.length).join('v')
  const serverPos = serverStartPositions(meta.gameId)
  const mapName = stripMapVersion(meta.map?.name ?? 'Unknown')
  const teamCount = meta.allyTeams.length
  const out: Appearance[] = []

  meta.allyTeams.forEach((team, ti) => {
    const humans = team.players.filter((p) => !p.isAi).map((p) => p.name)
    const enemies = meta.allyTeams
      .filter((_, j) => j !== ti)
      .flatMap((t) => t.players.filter((p) => !p.isAi).map((p) => p.name))
    const ppt = humans.length || team.players.length

    for (const p of team.players) {
      if (p.isAi) continue
      const s = p.stats
      const pos = serverPos.get(p.name.toLowerCase())
      const role =
        pos != null
          ? (roleForPosition(mapName, ppt, teamCount, pos.ex, pos.ez) ?? undefined)
          : undefined
      out.push({
        name: p.name,
        nameKey: p.name.toLowerCase(),
        filePath: meta.filePath,
        startTime: meta.startTime,
        mapName,
        durationMs: meta.durationMs || 0,
        fmt,
        side: colors[ti] ?? null,
        faction: normFaction(p.faction),
        result: team.won === true ? 'win' : team.won === false ? 'loss' : 'undecided',
        os: typeof p.skillOS === 'number' ? p.skillOS : null,
        rgb: p.rgbColor ?? null,
        startNX: pos?.nx,
        startNY: pos?.ny,
        role,
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

/**
 * Per-player start positions for one game, normalised to 0..1 map coords, read
 * from the cached bar-rts.com record (populated when the user opens the replay
 * with online enrichment on). Empty when nothing is cached for this game. The
 * local demo has only the shared ally-team box, so this is the only source of
 * spot-level positions.
 */
function serverStartPositions(
  gameId: string | null
): Map<string, { nx: number; ny: number; ex: number; ez: number }> {
  const out = new Map<string, { nx: number; ny: number; ex: number; ez: number }>()
  if (!gameId) return out
  const data = store.getApiCache(gameId)?.data as
    | { Map?: { width?: unknown; height?: unknown }; AllyTeams?: unknown }
    | null
    | undefined
  if (!data || typeof data !== 'object') return out
  const w = Number(data.Map?.width)
  const h = Number(data.Map?.height)
  if (!(w > 0) || !(h > 0)) return out
  const allyTeams = Array.isArray(data.AllyTeams) ? data.AllyTeams : []
  for (const at of allyTeams) {
    const players = Array.isArray((at as { Players?: unknown })?.Players)
      ? (at as { Players: unknown[] }).Players
      : []
    for (const p of players) {
      const rec = p as { name?: unknown; startPos?: unknown; startpos?: unknown }
      const raw = (rec.startPos ?? rec.startpos) as { x?: unknown; z?: unknown; y?: unknown } | undefined
      if (!raw || typeof rec.name !== 'string') continue
      const px = Number(raw.x)
      const pz = Number(raw.z ?? raw.y)
      if (!Number.isFinite(px) || !Number.isFinite(pz) || (px === 0 && pz === 0)) continue
      out.set(rec.name.toLowerCase(), {
        nx: clamp01(px / (w * 512)),
        ny: clamp01(pz / (h * 512)),
        ex: px,
        ez: pz
      })
    }
  }
  return out
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
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

/** Display order for start-position roles (unknowns sort last). */
const ROLE_ORDER = [
  'air',
  'air/front',
  'front',
  'front/tech',
  'front/sea',
  'tech',
  'sea/tech',
  'sea'
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
    roles: [],
    roleUnknown: 0,
    durations: [],
    startMaps: [],
    startNoData: 0,
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
  empty.form = { metrics: FORM_METRICS, games: scoped.slice(-50).map(formGame) }
  empty.factions = groupBars(scoped, (a) => a.faction, {
    order: ['Armada', 'Cortex', 'Legion', 'Random'],
    meta: (label) => FACTION_META[label] ?? { letter: label[0] ?? '?', color: '#9aa0ac' }
  })
  empty.sizes = groupBars(scoped, (a) => a.fmt, {
    order: ['8v8', '4v4', '3v3', '2v2', '1v1', 'FFA'],
    meta: () => ({})
  })
  const classified = scoped.filter((a) => a.role)
  empty.roles = groupBars(classified, (a) => a.role!, { order: ROLE_ORDER, meta: () => ({}) })
  empty.roleUnknown = scoped.length - classified.length
  empty.durations = DURATION_BUCKETS.map(([label, lo, hi]) => {
    const g = scoped.filter((a) => a.durationMs >= lo && a.durationMs < hi)
    return { label, games: g.length, winRate: winRateOf(g) }
  })

  empty.startMaps = buildStartMaps(scoped)
  empty.startNoData = scoped.filter((a) => a.startNX == null || a.startNY == null).length

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

// ---- start positions ----------------------------------------------------

/** Merge distance for clustering deploy points, in normalised map units. */
const SPOT_MERGE_DIST = 0.055
/** A map needs this many positioned games before it earns a heatmap. */
const START_MAP_MIN_GAMES = 8
/** Show at most this many maps. */
const START_MAP_LIMIT = 4

function buildStartMaps(scoped: Appearance[]): ReportStartMap[] {
  const positioned = scoped.filter((a) => a.startNX != null && a.startNY != null)
  return [...groupCount(positioned, (a) => a.mapName).entries()]
    .filter(([, g]) => g.length >= START_MAP_MIN_GAMES)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, START_MAP_LIMIT)
    .map(([name, g]) => ({ name, games: g.length, spots: clusterStartSpots(g) }))
}

/**
 * Greedy proximity clustering of a player's deploy points on one map, followed
 * by a merge pass for clusters that drift together. Each spot carries the games
 * played from it and the win rate there.
 */
function clusterStartSpots(rows: Appearance[]): ReportStartSpot[] {
  interface C {
    x: number
    y: number
    rows: Appearance[]
  }
  const clusters: C[] = []
  const recentre = (c: C): void => {
    c.x = mean(c.rows.map((r) => r.startNX!))
    c.y = mean(c.rows.map((r) => r.startNY!))
  }

  for (const a of rows) {
    const x = a.startNX!
    const y = a.startNY!
    let best: C | null = null
    let bestD = SPOT_MERGE_DIST
    for (const c of clusters) {
      const d = Math.hypot(c.x - x, c.y - y)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (best) {
      best.rows.push(a)
      recentre(best)
    } else {
      clusters.push({ x, y, rows: [a] })
    }
  }

  for (let pass = 0; pass < 6; pass++) {
    let merged = false
    for (let i = 0; i < clusters.length && !merged; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = Math.hypot(clusters[i]!.x - clusters[j]!.x, clusters[i]!.y - clusters[j]!.y)
        if (d < SPOT_MERGE_DIST) {
          clusters[i]!.rows.push(...clusters[j]!.rows)
          recentre(clusters[i]!)
          clusters.splice(j, 1)
          merged = true
          break
        }
      }
    }
    if (!merged) break
  }

  return clusters
    .map((c) => ({
      x: round3(c.x),
      y: round3(c.y),
      games: c.rows.length,
      winRate: winRateOf(c.rows),
      role: majorityRole(c.rows)
    }))
    .sort((a, b) => b.games - a.games)
}

/** The role most rows in a cluster agree on, or undefined when none is tagged. */
function majorityRole(rows: Appearance[]): string | undefined {
  const tally = new Map<string, number>()
  for (const r of rows) if (r.role) tally.set(r.role, (tally.get(r.role) ?? 0) + 1)
  let best: string | undefined
  let bestN = 0
  for (const [role, n] of tally) if (n > bestN) ((bestN = n), (best = role))
  return best
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
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
    role: a.role ?? null,
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
