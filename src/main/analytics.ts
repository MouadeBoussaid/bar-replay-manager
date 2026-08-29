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
  ReportStartSpot,
  FingerprintAxis,
  PlayerFingerprint,
  ReportInsight
} from '../shared/types'
import { teamColorNames } from '../shared/team-colors'
import { seasonBounds } from '../shared/seasons'
import { roleForPosition } from './map-roles'
import { mapHasNames, nameForPosition } from './map-names'
import { store } from './store'

/** One player's line in one replay — the unit the analytics tab aggregates over. */
interface Appearance {
  name: string
  nameKey: string
  filePath: string
  startTime: string | null
  mapName: string
  /** Full map name (unstripped) — for fetching the right minimap texture. */
  scriptName: string
  durationMs: number
  fmt: string
  side: 'blue' | 'red' | null
  faction: string
  /** True when `faction` is the confirmed in-game pick (from bar-rts), not the lobby default. */
  factionConfirmed: boolean
  result: GameResult
  os: number | null
  rgb: string | null
  /** Normalised per-player start position from a cached bar-rts record, 0..1. */
  startNX?: number
  startNY?: number
  /** Curated start-position role (air / front / tech / sea, …), when resolvable. */
  role?: string
  /** Community name for the deploy spot, when one is mapped for this map. */
  spotName?: string
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

/** Smallest per-side player count that still counts as a big-team game. */
const MIN_TEAM_SIZE = 6

/**
 * True for a large 2-team game (8v8 and the odd 6v6 / 7v7). Duels, small-team
 * modes (1v1 … 5v5) and FFA are a different game and are kept out of analytics.
 */
function isBigTeamGame(meta: ReplayMeta): boolean {
  return (
    meta.allyTeams.length === 2 &&
    meta.allyTeams.every((t) => t.players.length >= MIN_TEAM_SIZE)
  )
}

function extractAppearances(meta: ReplayMeta): Appearance[] {
  if (meta.parseError || isAiReplay(meta) || !isBigTeamGame(meta)) return []
  const colors = teamColorNames(meta)
  const fmt = meta.allyTeams.map((t) => t.players.length).join('v')
  const serverData = serverPlayerData(meta.gameId)
  const scriptName = meta.map?.name ?? 'Unknown'
  const mapName = stripMapVersion(scriptName)
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
      const sd = serverData.get(p.name.toLowerCase())
      const pos = sd?.pos
      const role =
        pos != null
          ? (roleForPosition(mapName, ppt, teamCount, pos.ex, pos.ez) ?? undefined)
          : undefined
      const spotName =
        pos != null ? (nameForPosition(mapName, pos.ex, pos.ez) ?? undefined) : undefined
      out.push({
        name: p.name,
        nameKey: p.name.toLowerCase(),
        filePath: meta.filePath,
        startTime: meta.startTime,
        mapName,
        scriptName,
        durationMs: meta.durationMs || 0,
        fmt,
        side: colors[ti] ?? null,
        // The local script's `side` is the pre-game pick (~always "Armada"); the
        // in-game faction only exists in the cached bar-rts record.
        faction: normFaction(sd?.faction ?? p.faction),
        factionConfirmed: !!sd?.faction,
        result: team.won === true ? 'win' : team.won === false ? 'loss' : 'undecided',
        os: typeof p.skillOS === 'number' ? p.skillOS : null,
        rgb: p.rgbColor ?? null,
        startNX: pos?.nx,
        startNY: pos?.ny,
        role,
        spotName,
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

interface ServerPlayer {
  /** Normalised (0..1) + raw (elmos) start position, when the record has one. */
  pos?: { nx: number; ny: number; ex: number; ez: number }
  /** The real in-game faction — the local script only has the lobby default. */
  faction?: string
}

/**
 * Per-player data for one game from the cached bar-rts.com record (populated when
 * the user opens the replay with online enrichment on). Empty when nothing is
 * cached. This is the only trustworthy source for the in-game faction (the local
 * script's `side` is the pre-game pick, ~always "Armada") and for spot-level
 * start positions (the local demo has only the shared ally-team box).
 */
function serverPlayerData(gameId: string | null): Map<string, ServerPlayer> {
  const out = new Map<string, ServerPlayer>()
  if (!gameId) return out
  const data = store.getApiCache(gameId)?.data as
    | { Map?: { width?: unknown; height?: unknown }; AllyTeams?: unknown }
    | null
    | undefined
  if (!data || typeof data !== 'object') return out
  const w = Number(data.Map?.width)
  const h = Number(data.Map?.height)
  const dims = w > 0 && h > 0
  const allyTeams = Array.isArray(data.AllyTeams) ? data.AllyTeams : []
  for (const at of allyTeams) {
    const players = Array.isArray((at as { Players?: unknown })?.Players)
      ? (at as { Players: unknown[] }).Players
      : []
    for (const p of players) {
      const rec = p as {
        name?: unknown
        faction?: unknown
        startPos?: unknown
        startpos?: unknown
      }
      if (typeof rec.name !== 'string') continue
      const entry: ServerPlayer = {}
      if (typeof rec.faction === 'string' && rec.faction) entry.faction = rec.faction

      const raw = (rec.startPos ?? rec.startpos) as
        | { x?: unknown; z?: unknown; y?: unknown }
        | undefined
      if (dims && raw) {
        const px = Number(raw.x)
        const pz = Number(raw.z ?? raw.y)
        if (Number.isFinite(px) && Number.isFinite(pz) && !(px === 0 && pz === 0)) {
          entry.pos = {
            nx: clamp01(px / (w * 512)),
            ny: clamp01(pz / (h * 512)),
            ex: px,
            ez: pz
          }
        }
      }
      if (entry.faction || entry.pos) out.set(rec.name.toLowerCase(), entry)
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
  { key: 'metalPerSec', label: 'Metal / s' },
  { key: 'energyPerSec', label: 'Energy / s' },
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
    fingerprint: null,
    insights: [],
    form: { metrics: FORM_METRICS, games: [] },
    factions: [],
    factionConfirmed: 0,
    sizes: [],
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
  empty.fingerprint = empty.thinSample ? null : buildFingerprint(scoped)
  empty.form = { metrics: FORM_METRICS, games: scoped.slice(-50).map(formGame) }
  // The local `side` is the lobby default (~always Armada), so build the faction
  // mix from games with a confirmed bar-rts faction when we have any.
  const confirmed = scoped.filter((a) => a.factionConfirmed)
  empty.factionConfirmed = confirmed.length
  empty.factions = groupBars(confirmed.length > 0 ? confirmed : scoped, (a) => a.faction, {
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

  empty.insights = empty.thinSample ? [] : buildInsights(scoped, empty)

  empty.appearances = [...scoped].reverse().map(appearanceRow)
  return empty
}

function applyScope(rows: Appearance[], scope: AnalyticsScope): Appearance[] {
  if (scope === 'last50') return rows.slice(-50)
  if (scope === 'all') return rows
  const m = /^s(\d+)$/.exec(scope)
  if (m) {
    const { start, end } = seasonBounds(Number(m[1]))
    return rows.filter((a) => {
      if (!a.startTime) return false
      const t = new Date(a.startTime).getTime()
      return (start == null || t >= start) && (end == null || t < end)
    })
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

// ---- playstyle fingerprint ---------------------------------------------------

interface FpMetric {
  key: FingerprintAxis['key']
  label: string
  /** per-game value, null when inputs missing. Economy axes are per game-second
   *  (matching BAR's in-game m/s · e/s); the rest are per game-minute. */
  val: (a: Appearance) => number | null
  fmt: (v: number) => string
}

const minutesOf = (a: Appearance): number => (a.durationMs > 0 ? a.durationMs / 60_000 : 1)
const secondsOf = (a: Appearance): number => (a.durationMs > 0 ? a.durationMs / 1000 : 1)

/** Clockwise from top — the order the radar plots them. Each axis is the raw
 *  metric itself (higher = further out), no inversion. */
const FP_METRICS: FpMetric[] = [
  {
    key: 'metal',
    label: 'M/s',
    val: (a) => (a.metalProduced != null ? a.metalProduced / secondsOf(a) : null),
    fmt: (v) => `${Math.round(v)} metal/s`
  },
  {
    key: 'energy',
    label: 'E/s',
    val: (a) => (a.energyProduced != null ? a.energyProduced / secondsOf(a) : null),
    fmt: (v) => `${fmtK(v)} energy/s`
  },
  {
    key: 'dmgDealt',
    label: 'Dmg dealt',
    val: (a) => (a.damageDealt != null ? a.damageDealt / minutesOf(a) : null),
    fmt: (v) => `${fmtK(v)} dmg/min`
  },
  {
    key: 'dmgTaken',
    label: 'Dmg taken',
    val: (a) => (a.damageReceived != null ? a.damageReceived / minutesOf(a) : null),
    fmt: (v) => `${fmtK(v)} dmg/min`
  },
  {
    key: 'units',
    label: 'Units/min',
    val: (a) => (a.unitsProduced != null ? a.unitsProduced / minutesOf(a) : null),
    fmt: (v) => `${v.toFixed(1)} units/min`
  },
  {
    key: 'dmgPerMetal',
    label: 'Dmg/metal',
    val: (a) =>
      a.damageDealt != null && a.metalProduced ? a.damageDealt / a.metalProduced : null,
    fmt: (v) => `${v.toFixed(2)} dmg/metal`
  }
]

/** Percentile (0–100) of `v` within a pre-sorted ascending array. */
function percentileOf(sortedAsc: number[], v: number): number {
  if (sortedAsc.length === 0) return 50
  let lo = 0
  let hi = sortedAsc.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedAsc[mid]! <= v) lo = mid + 1
    else hi = mid
  }
  return (lo / sortedAsc.length) * 100
}

function buildFingerprint(scoped: Appearance[]): PlayerFingerprint | null {
  if (scoped.filter((a) => a.damageDealt != null).length < 10) return null

  const axes: FingerprintAxis[] = FP_METRICS.map((m) => {
    const mine: number[] = []
    for (const a of scoped) {
      const v = m.val(a)
      if (v != null && Number.isFinite(v)) mine.push(v)
    }
    const pop: number[] = []
    for (const a of INDEX) {
      const v = m.val(a)
      if (v != null && Number.isFinite(v)) pop.push(v)
    }
    pop.sort((x, y) => x - y)

    if (mine.length < 3 || pop.length < 20) {
      return {
        key: m.key,
        label: m.label,
        percentile: 50,
        rawLabel: mine.length ? m.fmt(mean(mine)) : '—',
        baselinePercentile: 50
      }
    }
    const raw = mean(mine)
    return {
      key: m.key,
      label: m.label,
      percentile: Math.round(percentileOf(pop, raw)),
      rawLabel: m.fmt(raw),
      baselinePercentile: Math.round(percentileOf(pop, mean(pop)))
    }
  })

  const p = Object.fromEntries(axes.map((a) => [a.key, a.percentile])) as Record<
    FingerprintAxis['key'],
    number
  >
  return { ...archetypeFor(p), axes }
}

const FP_RULES: {
  archetype: string
  blurb: string
  when: (p: Record<FingerprintAxis['key'], number>) => boolean
}[] = [
  {
    archetype: 'Macro Titan',
    blurb: 'Metal, energy and army all outscale the lobby — sheer output',
    when: (p) => p.metal >= 68 && p.energy >= 64 && p.units >= 62
  },
  {
    archetype: 'Economic Anchor',
    blurb: 'High income, low aggression, scales into the late game',
    when: (p) => p.metal >= 62 && p.energy >= 58 && p.dmgDealt <= 52
  },
  {
    archetype: 'Energy Merchant',
    blurb: 'Energy well ahead of metal — air and tech leaning',
    when: (p) => p.energy >= 68 && p.energy - p.metal >= 16
  },
  {
    archetype: 'Metal Grinder',
    blurb: 'Metal-heavy — mass and bots over tech',
    when: (p) => p.metal >= 68 && p.metal - p.energy >= 16
  },
  {
    archetype: 'Precision Striker',
    blurb: 'Wrings a lot of damage out of every unit of metal',
    when: (p) => p.dmgDealt >= 58 && p.dmgPerMetal >= 64
  },
  {
    archetype: 'Brawler',
    blurb: 'Trades constantly — deals and eats heavy damage',
    when: (p) => p.dmgDealt >= 64 && p.dmgTaken >= 62
  },
  {
    archetype: 'Glass Cannon',
    blurb: 'Heavy damage out, takes little back',
    when: (p) => p.dmgDealt >= 62 && p.dmgTaken <= 38
  },
  {
    archetype: 'Meat Shield',
    blurb: 'Soaks damage without dealing much in return',
    when: (p) => p.dmgTaken >= 66 && p.dmgDealt <= 52
  },
  {
    archetype: 'Swarm Commander',
    blurb: 'A constant stream of cheap units',
    when: (p) => p.units >= 66 && p.dmgPerMetal >= 55
  },
  {
    archetype: 'Turtler',
    blurb: 'Economy up, quiet on both sides of the fight',
    when: (p) => p.metal >= 55 && p.dmgDealt <= 40 && p.dmgTaken <= 44
  }
]

function archetypeFor(p: Record<FingerprintAxis['key'], number>): {
  archetype: string
  blurb: string
} {
  const hit = FP_RULES.find((r) => r.when(p))
  if (hit) return { archetype: hit.archetype, blurb: hit.blurb }
  const vals = Object.values(p)
  return Math.max(...vals) - Math.min(...vals) <= 18
    ? { archetype: 'All-Rounder', blurb: 'No axis runs away from the rest' }
    : { archetype: 'Generalist', blurb: 'A bit of everything, nothing at the extremes' }
}

// ---- insight callouts -----------------------------------------------------

type InsightCandidate = ReportInsight & { effect: number }

const pctStr = (v: number): string => `${Math.round(v * 100)}%`

/**
 * Rule-generated callouts shown beside the fingerprint. Each rule fires only
 * when its threshold is crossed; the strongest three by `effect` are kept.
 */
function buildInsights(scoped: Appearance[], r: PlayerReport): ReportInsight[] {
  const out: InsightCandidate[] = []
  const overall = r.winRate

  // 1. Match-length skew — shortest vs longest duration bucket with a sample.
  {
    const buckets = r.durations.filter((d) => d.games >= 5 && d.winRate != null)
    const short = buckets[0]
    const long = buckets[buckets.length - 1]
    if (short && long && short !== long) {
      const gap = (long.winRate! - short.winRate!) * 100
      if (Math.abs(gap) >= 8) {
        const up = gap > 0
        out.push({
          tag: up ? 'LATE GAME' : 'EARLY GAME',
          tone: 'good',
          text: up
            ? `Win rate climbs with match length — ${pctStr(long.winRate!)} in ${long.label} games against ${pctStr(short.winRate!)} in ${short.label}.`
            : `Strongest in shorter games — ${pctStr(short.winRate!)} in ${short.label} against ${pctStr(long.winRate!)} in ${long.label}.`,
          effect: Math.abs(gap)
        })
      }
    }
  }

  // 2. Metal excess vs. the lobby — floating resources.
  {
    const mine = scoped.map((a) => a.metalExcess).filter((v): v is number => v != null)
    const pop = INDEX.map((a) => a.metalExcess).filter((v): v is number => v != null)
    if (mine.length >= 10 && pop.length >= 50) {
      const avg = mean(mine)
      const base = mean(pop)
      if (base > 0 && avg >= base * 1.6 && avg >= 400) {
        out.push({
          tag: 'WATCH',
          tone: 'watch',
          text: `Metal excess averages ${fmtK(avg)} per game, ${(avg / base).toFixed(1)}× the lobby average. Income outruns spending.`,
          effect: (avg / base) * 6
        })
      }
    }
  }

  // 3. Best ally — a pairing that beats the solo win rate.
  if (overall != null) {
    const ally = [...r.company.withP]
      .filter((c) => c.games >= 20 && c.winRate != null)
      .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0]
    if (ally?.winRate != null) {
      const lift = (ally.winRate - overall) * 100
      if (lift >= 5) {
        out.push({
          tag: 'PAIRING',
          tone: 'neutral',
          text: `Best allied with ${ally.name}: ${pctStr(ally.winRate)} across ${ally.games} games, ${Math.round(lift)} points above your ${pctStr(overall)} baseline.`,
          effect: lift + 4
        })
      }
    }
  }

  // 4. Recent form — last 15 scoped games vs. everything before.
  if (scoped.length >= 35) {
    const lw = winRateOf(scoped.slice(-15))
    const pw = winRateOf(scoped.slice(0, -15))
    if (lw != null && pw != null) {
      const d = (lw - pw) * 100
      if (Math.abs(d) >= 10) {
        out.push({
          tag: 'FORM',
          tone: d > 0 ? 'good' : 'watch',
          text:
            d > 0
              ? `Trending up — ${pctStr(lw)} over the last 15 games vs ${pctStr(pw)} before.`
              : `Cooling off — ${pctStr(lw)} over the last 15 games vs ${pctStr(pw)} before.`,
          effect: Math.abs(d) * 0.9
        })
      }
    }
  }

  // 5. Faction gap — best vs. worst faction win rate.
  {
    const f = r.factions.filter((b) => b.games >= 15 && b.winRate != null)
    if (f.length >= 2) {
      const best = f.reduce((a, b) => ((b.winRate ?? 0) > (a.winRate ?? 0) ? b : a))
      const worst = f.reduce((a, b) => ((b.winRate ?? 1) < (a.winRate ?? 1) ? b : a))
      const gap = ((best.winRate ?? 0) - (worst.winRate ?? 0)) * 100
      if (best !== worst && gap >= 12) {
        out.push({
          tag: 'FACTION',
          tone: 'neutral',
          text: `${best.label} ${pctStr(best.winRate!)} vs ${worst.label} ${pctStr(worst.winRate!)} — a ${Math.round(gap)}-point gap over ${best.games + worst.games} games.`,
          effect: gap * 0.8
        })
      }
    }
  }

  // ---- averages-vs-baseline rules (same deltas the Averages grid shows) ----
  const pctD = (v: number): string => `${sign(v)}${Math.round(Math.abs(v))}%`
  const eco = (pick: (a: Appearance) => number | undefined): number | null => {
    const mineV = scoped.map(pick).filter((v): v is number => v != null)
    const popV = INDEX.map(pick).filter((v): v is number => v != null)
    if (mineV.length < 10 || popV.length < 50) return null
    const b = mean(popV)
    return b > 0 ? ((mean(mineV) - b) / b) * 100 : null
  }
  const dM = eco((a) => a.metalProduced)
  const dE = eco((a) => a.energyProduced)
  const dDmg = eco((a) => a.damageDealt)
  const dTaken = eco((a) => a.damageReceived)

  // Trade efficiency in points (damage dealt ÷ taken) vs. the pool.
  let tradePt: number | null = null
  {
    const perGame = (a: Appearance): number | undefined =>
      a.damageDealt != null && a.damageReceived
        ? (a.damageDealt / a.damageReceived) * 100
        : undefined
    const mineV = scoped.map(perGame).filter((v): v is number => v != null)
    const popV = INDEX.map(perGame).filter((v): v is number => v != null)
    if (mineV.length >= 10 && popV.length >= 50) {
      const m = mean(mineV)
      const base = mean(popV)
      const pt = m - base
      tradePt = pt
      if (Math.abs(pt) >= 12) {
        out.push({
          tag: 'DAMAGE TRADES',
          tone: pt > 0 ? 'good' : 'watch',
          text:
            pt > 0
              ? `Damage trades land well — deals ${Math.round(m)} damage for every 100 taken, against ${Math.round(base)} for the average player.`
              : `Damage trades could be more efficient — deals only ${Math.round(m)} damage for every 100 taken, against ${Math.round(base)} for the average player.`,
          effect: Math.abs(pt) * 1.1
        })
      }
    }
  }

  // 6. Economy size vs. the lobby — both resources up, or an energy tilt.
  if (dM != null && dE != null) {
    if (dE - dM >= 14 && dE >= 12) {
      out.push({
        tag: 'ENERGY TILT',
        tone: 'neutral',
        text: `Energy runs well ahead of metal — ${pctD(dE)} vs ${pctD(dM)} against the baseline. An air / tech lean.`,
        effect: (dE - dM) * 0.9
      })
    } else if (dM >= 10 && dE >= 10) {
      out.push({
        tag: 'BIG ECONOMY',
        tone: 'good',
        text: `Runs a bigger economy than the lobby — metal ${pctD(dM)}, energy ${pctD(dE)} over baseline.`,
        effect: ((dM + dE) / 2) * 1.1
      })
    }
  }

  // 7. Damage soaked — takes noticeably more than the pool. Skipped when the
  //    negative TRADES insight already tells this story.
  if (dTaken != null && dTaken >= 18 && !(tradePt != null && tradePt <= -12)) {
    out.push({
      tag: 'DAMAGE SOAKED',
      tone: 'watch',
      text: `Takes ${pctD(dTaken)} more damage than the lobby${
        dDmg != null && dDmg > 0 ? `, only ${pctD(dDmg)} more dealt` : ''
      }. Trades happen on the back foot.`,
      effect: dTaken * 0.7
    })
  }

  return out
    .sort((a, b) => b.effect - a.effect)
    .slice(0, 3)
    .map((c) => ({ tag: c.tag, tone: c.tone, text: c.text }))
}

// ---- form / bars / company / appearances --------------------------------

function formGame(a: Appearance): PlayerReport['form']['games'][number] {
  const sec = a.durationMs / 1000 || 1
  return {
    date: a.startTime ?? '',
    map: a.mapName,
    result: a.result,
    filePath: a.filePath,
    values: {
      metalPerSec: a.metalProduced != null ? a.metalProduced / sec : null,
      energyPerSec: a.energyProduced != null ? a.energyProduced / sec : null,
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
/** An un-named deploy spot needs this many games before it earns its own point. */
const START_SPOT_MIN_GAMES = 3
/** A map needs this many positioned games before it earns a heatmap. */
const START_MAP_MIN_GAMES = 4
/** Show at most this many maps. */
const START_MAP_LIMIT = 6

function buildStartMaps(scoped: Appearance[]): ReportStartMap[] {
  const positioned = scoped.filter((a) => a.startNX != null && a.startNY != null)
  return [...groupCount(positioned, (a) => a.mapName).entries()]
    .filter(([, g]) => g.length >= START_MAP_MIN_GAMES)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, START_MAP_LIMIT)
    .map(([name, g]) => ({
      name,
      // Latest full name in the group — for the right minimap texture version.
      scriptName: g[g.length - 1]!.scriptName,
      games: g.length,
      spots: clusterStartSpots(g, name)
    }))
}

/**
 * Turn a player's deploy points on one map into a handful of stat points.
 *
 * Games at a *named* position (the community-name table) group straight by that
 * name — one point per name, so mirror halves and a few split deploy spots all
 * count together. Everything else gets greedy proximity clustering plus a merge
 * pass for clusters that drift together. On curated maps the two ally sides are
 * 180° rotations, so un-named points are also folded into one half first — a
 * mirror pair then lands in one cluster instead of two.
 */
function clusterStartSpots(rows: Appearance[], mapName: string): ReportStartSpot[] {
  const fold = mapHasNames(mapName)
  const cx = (a: Appearance): number => (fold && a.startNY! < 0.5 ? 1 - a.startNX! : a.startNX!)
  const cy = (a: Appearance): number => (fold && a.startNY! < 0.5 ? 1 - a.startNY! : a.startNY!)

  interface Spot {
    x: number
    y: number
    rows: Appearance[]
    name?: string
  }
  const recentre = (c: Spot): void => {
    c.x = mean(c.rows.map(cx))
    c.y = mean(c.rows.map(cy))
  }

  const byName = new Map<string, Spot>()
  const spots: Spot[] = []
  const loose: Appearance[] = []
  for (const a of rows) {
    if (a.spotName) {
      const g = byName.get(a.spotName)
      if (g) {
        g.rows.push(a)
      } else {
        const fresh: Spot = { x: 0, y: 0, rows: [a], name: a.spotName }
        byName.set(a.spotName, fresh)
        spots.push(fresh)
      }
    } else {
      loose.push(a)
    }
  }

  const clusters: Spot[] = []
  for (const a of loose) {
    const x = cx(a)
    const y = cy(a)
    let best: Spot | null = null
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

  for (const g of byName.values()) recentre(g)
  spots.push(...clusters)

  return spots
    .filter((g) => g.name != null || g.rows.length >= START_SPOT_MIN_GAMES)
    .map((g) => ({
      x: round3(g.x),
      y: round3(g.y),
      games: g.rows.length,
      winRate: winRateOf(g.rows),
      role: majorityRole(g.rows, (r) => r.role),
      name: g.name
    }))
    .sort((a, b) => b.games - a.games)
}

/** The value most rows in a cluster agree on, or undefined when none is tagged. */
function majorityRole(
  rows: Appearance[],
  pick: (r: Appearance) => string | undefined
): string | undefined {
  const tally = new Map<string, number>()
  for (const r of rows) {
    const v = pick(r)
    if (v) tally.set(v, (tally.get(v) ?? 0) + 1)
  }
  let best: string | undefined
  let bestN = 0
  for (const [v, n] of tally) if (n > bestN) ((bestN = n), (best = v))
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
