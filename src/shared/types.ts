/** Shared type contracts between the Electron main process and the renderer. */

export type Faction =
  | 'Armada'
  | 'Cortex'
  | 'Legion'
  | 'Raptors'
  | 'Scavengers'
  | (string & {})

export interface Settings {
  /** Absolute path to the replays folder, or null if not chosen yet. */
  replaysFolder: string | null
  /** When true, the detail view also queries api.bar-rts.com for enriched data. */
  onlineEnrich: boolean
  /** Width in px of the left list pane; clamped to [320, 520] by the renderer. */
  listPaneWidth: number
  /**
   * The "perspective" the manager is viewed from — a specific player. When set,
   * the replay list splits into "My replays" (this player took part) and
   * "Watched replays". Only changed from the settings dialog. Empty = no split.
   */
  perspectivePlayerName: string
}

/** Per-player end-game statistics from the demo trailer (offline). */
export interface PlayerStats {
  metalProduced: number
  metalExcess: number
  energyProduced: number
  energyExcess: number
  damageDealt: number
  damageReceived: number
  unitsProduced: number
  unitsKilled: number
  unitsLost: number
  /** Engine command count / game minutes — close to APM. Humans only. */
  cmdPerMin?: number
}

export interface PlayerMeta {
  name: string
  faction?: Faction
  countryCode?: string
  rank?: number
  /** OpenSkill ("OS") rating. */
  skillOS?: number
  skillSigma?: number
  rgbColor?: string
  isAi?: boolean
  /** Start position in world coords (elmos): x east, z south. Renderer normalises. */
  startPos?: { x: number; z: number }
  /** Curated start-position role (air / front / tech / sea, …) when the map is covered. */
  role?: string
  /** Total metal produced, in raw units (renderer formats to "N.Nk"). */
  metal?: number
  /** Full per-player end-game stat line, when the demo has a stats trailer. */
  stats?: PlayerStats
}

export interface AllyTeamMeta {
  id: number
  won?: boolean
  startBox?: { left: number; top: number; right: number; bottom: number }
  players: PlayerMeta[]
}

/** Fully-resolved metadata for one replay, shown in the detail view. */
export interface ReplayMeta {
  gameId: string | null
  filePath: string
  fileName: string
  fileSize: number
  map: { name: string; fileName?: string; width?: number; height?: number }
  /** ISO 8601 string, or null if unknown. */
  startTime: string | null
  durationMs: number
  engineVersion: string
  gameVersion: string
  endedNormally: boolean
  allyTeams: AllyTeamMeta[]
  spectators: PlayerMeta[]
  hostSettings: Record<string, string>
  gameSettings: Record<string, string>
  mapSettings: Record<string, string>
  spadsSettings: Record<string, string>
  awards?: unknown
  /**
   * Match-wide aggregate stats for the Overview cards, summed across both sides.
   * From the demo's per-team trailer (offline); bar-rts awards fill gaps.
   */
  stats?: {
    metalProduced?: number
    energyProduced?: number
    unitsLost?: number
    unitsKilled?: number
    damageDealt?: number
  }
  source: 'local' | 'local+online'
  /** Populated when the local file could not be parsed at all. */
  parseError?: string
  /** Populated when online enrichment was attempted but failed. */
  enrichError?: string
}

/** One row in the replay list. Rich fields come from the parse cache, populated on scan. */
export interface ReplayListItem {
  filePath: string
  fileName: string
  fileSize: number
  mtimeMs: number
  gameId: string | null
  startTime: string | null
  mapName: string
  durationMs: number | null
  engineTag: string | null
  playerNames: string[]
  /** Player names grouped by ally team, same order as `teamSizes` — lets the UI
   *  tell which side a given player (e.g. the perspective player) was on. */
  teamPlayerNames: string[][]
  playerCount: number | null
  /** Ally-team sizes, e.g. [8, 8] — drives the "8v8" format label. */
  teamSizes: number[]
  /** Mean OS across rated human players, or null when unrated / unparsed. */
  avgOs: number | null
  /** Ordinal (0-based) of the winning ally team, or null. */
  winnerTeamOrdinal: number | null
  /** BAR blue/red label for the winning team, when it can be told apart. */
  winnerTeamColor: 'blue' | 'red' | null
  endedNormally: boolean | null
  /** A game against AI (a bot participant / a player name ending "AI"). */
  isAiGame: boolean
  /** True once the local file has been parsed (rich fields are trustworthy). */
  parsed: boolean
  /** True when parsing was attempted and failed (show the filename in place of the map). */
  parseError: boolean
  isFavourite: boolean
  tags: string[]
  note: string
}

/** Time-series data for the Graphs tab. One line per team (= player). */
export interface ReplayGraph {
  /** Seconds from game start for each sample (x axis). */
  times: number[]
  /** Seconds between samples. */
  periodSeconds: number
  teams: {
    teamId: number
    allyTeamId: number
    name: string
    /** "rgb(r, g, b)"; falls back to a palette colour. */
    color: string
  }[]
  /** Field key → per-team series; `series[teamIndex][sampleIndex]`. */
  fields: Record<string, number[][]>
}

/** ---- Player comparison drawer ---------------------------------------- */

export interface ComparisonRequest {
  filePath: string
  /** Exactly two player names from this replay. */
  players: [string, string]
}

/**
 * Per-15-s series for two players in one match, for the comparison drawer.
 * All arrays are the same length as `times`; `[a, b]` order matches the request.
 *
 * `onField` is an **estimate**, not true army value — see `caveat`:
 *   spent(t)   = cumulative metal spent on everything (exact, engine-reported)
 *   onField(t) = spent(t) × surviving-unit share × offensive share
 * The offensive share is 1 until demo build-order parsing lands (`source`
 * distinguishes the two).
 */
export interface ComparisonSeries {
  /** Seconds from game start for each sample. */
  times: number[]
  periodSeconds: number
  /** Cumulative metal + energy produced (energy weighted ×1/100, so ~83% metal). */
  economy: [number[], number[]]
  /** Cumulative metal spent (all unit types). */
  spent: [number[], number[]]
  /** Estimated metal value of units still on the field (all unit types). */
  onField: [number[], number[]]
  /** Cumulative metal excess — feeds the "banked vs spent" read-out. */
  excess: [number[], number[]]
  /** `trailer-estimate` = offensive share not yet applied; `stream-estimate` = build orders parsed. */
  source: 'trailer-estimate' | 'stream-estimate'
  /** One-line provenance note for the drawer footer. */
  caveat: string
}

/** ---- User analytics ---------------------------------------------------- */

export type GameResult = 'win' | 'loss' | 'undecided'
/** `all`, `last50`, or a BAR season key like `s3` (see `shared/seasons.ts`). */
export type AnalyticsScope = 'all' | 'last50' | `s${number}`

export interface FingerprintAxis {
  key: 'metal' | 'energy' | 'dmgDealt' | 'dmgTaken' | 'units' | 'dmgPerMetal'
  label: string
  /** Plotted value: 0–100 percentile against all indexed games. */
  percentile: number
  /** The player's mean raw value (already formatted for display). */
  rawLabel: string
  /** Percentile of the population's own mean — the dashed reference polygon. */
  baselinePercentile: number
}

export interface PlayerFingerprint {
  /** One of a fixed set of archetype names, or "All-Rounder". */
  archetype: string
  /** One-line, template-generated description. */
  blurb: string
  /** Clockwise from top: metal, energy, dmgDealt, dmgTaken, units, dmgPerMetal. */
  axes: FingerprintAxis[]
}

export interface ReportInsight {
  /** Short uppercase kicker, e.g. "LATE GAME". */
  tag: string
  /** good = strength (green), watch = concern (red), neutral = observation (yellow). */
  tone: 'good' | 'watch' | 'neutral'
  /** One or two template-filled sentences. */
  text: string
}

export interface ReportAverage {
  key: string
  label: string
  /** Pre-formatted display value, e.g. "11.4k" or "128%". */
  value: string
  /** Signed delta vs the indexed-population baseline, pre-formatted ("+8%", "−12pt"). */
  delta: string | null
  /** true = delta direction is good for this metric, false = bad, null = neutral/none. */
  good: boolean | null
}

export interface ReportFormGame {
  date: string
  map: string
  result: GameResult
  filePath: string
  /** metric key -> value (raw units); keys match `form.metrics`. */
  values: Record<string, number | null>
}

export interface ReportBar {
  label: string
  letter?: string
  color?: string
  games: number
  winRate: number | null
  /** 0..1 share of the player's games (for the bar width). */
  share: number
}

export interface ReportDurationBucket {
  label: string
  games: number
  winRate: number | null
}

export interface ReportMap {
  name: string
  games: number
  winRate: number | null
}

export interface ReportStartSpot {
  /** Normalised map coords, 0..1: x east, y south. */
  x: number
  y: number
  games: number
  winRate: number | null
  /** Curated role for this spot (air / front / tech / sea, …), when the map is covered. */
  role?: string
  /** Community name for this spot, when one is mapped — shown instead of the role. */
  name?: string
}

export interface ReportStartMap {
  /** Version-stripped display name. */
  name: string
  /** Full map name (latest version seen) — for the minimap texture. */
  scriptName: string
  /** Games on this map that had a usable per-player start position. */
  games: number
  /** Clustered deploy spots, most-used first. */
  spots: ReportStartSpot[]
}

export interface ReportCompanyRow {
  name: string
  color: string
  games: number
  winRate: number | null
}

export interface ReportAppearance {
  date: string
  map: string
  fmt: string
  side: 'blue' | 'red' | null
  faction: string
  result: GameResult
  durationMs: number
  metal: number | null
  dmg: number | null
  eff: number | null
  cmd: number | null
  /** Curated start-position role, or null when unknown / map not covered. */
  role: string | null
  filePath: string
}

export interface PlayerReport {
  name: string
  found: boolean
  scope: AnalyticsScope
  totalGames: number
  wins: number
  losses: number
  undecided: number
  winRate: number | null
  firstSeen: string | null
  lastSeen: string | null
  os: number | null
  /** < 20 games — hide win-rate colouring and derived blocks. */
  thinSample: boolean
  averages: ReportAverage[]
  /** Playstyle radar — 6 percentile axes + a derived archetype. Null under the
   *  thin-sample cutoff or when the stat fields needed aren't available. */
  fingerprint: PlayerFingerprint | null
  /** Rule-generated callouts shown beside the fingerprint. Up to 3, strongest
   *  effect first; empty under the thin-sample cutoff. */
  insights: ReportInsight[]
  form: {
    metrics: { key: string; label: string }[]
    games: ReportFormGame[]
  }
  factions: ReportBar[]
  /**
   * Scoped games whose faction is the confirmed in-game pick (from bar-rts), not
   * the lobby default. When 0 < this < totalGames the Faction card is built from
   * the confirmed subset; when 0 it falls back to the (unreliable) local `side`.
   */
  factionConfirmed: number
  sizes: ReportBar[]
  durations: ReportDurationBucket[]
  /** Per-map start-position heatmaps, most-played map first. */
  startMaps: ReportStartMap[]
  /** Scoped games with no known per-player start position (no bar-rts record cached). */
  startNoData: number
  maps: ReportMap[]
  mapsHasMore: boolean
  company: { withP: ReportCompanyRow[]; vsP: ReportCompanyRow[] }
  appearances: ReportAppearance[]
}

/** Progress of the slow background bar-rts.com cache backfill. */
export interface BackfillProgress {
  /** True while requests are still in flight. */
  active: boolean
  /** Games with a cached server record so far. */
  done: number
  /** Games with a gameId (the target). */
  total: number
  /** Records fetched during the current pass. */
  fetched: number
  /** Bumps each time the analytics index is rebuilt — a cue to re-fetch reports. */
  indexRev: number
}

export interface MapInfo {
  /** Map size in map units; multiply by 512 for world elmos. */
  width: number
  height: number
  /** Canonical start spots in world elmos. */
  startPositions: { x: number; z: number }[]
}

export interface ClearPreview {
  count: number
  totalBytes: number
  sampleNames: string[]
}

export interface ClearResult {
  movedCount: number
  failed: { fileName: string; error: string }[]
}

export interface PlayLaunchResult {
  ok: boolean
  /** Present when `ok` is false: a human-readable reason the launch failed. */
  error?: string
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickFolder(): Promise<string | null>
  detectDefaultFolder(): Promise<string | null>
  listReplays(folder: string): Promise<ReplayListItem[]>
  /** Full metadata for one replay; null when the file no longer exists. */
  getReplayDetail(filePath: string): Promise<ReplayMeta | null>
  /** Play this replay: spawns the BAR engine straight into the in-game replay. */
  playReplay(filePath: string): Promise<PlayLaunchResult>
  /** Move a single replay file to the Recycle Bin. */
  trashReplay(filePath: string): Promise<void>
  /** Move several replay files to the Recycle Bin. */
  trashReplays(filePaths: string[]): Promise<{ moved: number; failed: string[] }>
  /**
   * Minimap texture for a map (by script name) as a `data:` URL, fetched from the
   * bar-rts map API and cached on disk. Null when unknown or offline.
   */
  getMapImage(mapName: string, size: 'thumb' | 'mq'): Promise<string | null>
  /** Map dimensions + canonical start spots (world elmos), for plotting pips. */
  getMapInfo(mapName: string): Promise<MapInfo | null>
  /** Full per-team time-series (parsed on demand). Null when the demo has none. */
  getReplayGraph(filePath: string): Promise<ReplayGraph | null>
  /**
   * Two-player economy / value-on-field series for the comparison drawer. Null
   * when the demo has no time series or a named player isn't in it.
   */
  getComparisonSeries(req: ComparisonRequest): Promise<ComparisonSeries | null>
  /** Distinct player names across every indexed replay (for the analytics picker). */
  getIndexedPlayerNames(): Promise<string[]>
  /** Aggregated playstyle report for one player. */
  getPlayerReport(name: string, scope: AnalyticsScope): Promise<PlayerReport>
  /** Progress of the background bar-rts backfill. Returns an unsubscribe function. */
  onAnalyticsBackfill(cb: (p: BackfillProgress) => void): () => void
  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  /** Subscribe to window maximize-state changes. Returns an unsubscribe function. */
  onWindowMaximizeChange(cb: (isMaximized: boolean) => void): () => void
  toggleFavourite(filePath: string): Promise<boolean>
  updateFavourite(
    filePath: string,
    data: { note?: string; tags?: string[] }
  ): Promise<void>
  previewClear(folder: string): Promise<ClearPreview>
  confirmClear(folder: string): Promise<ClearResult>
  startWatch(folder: string): Promise<void>
  stopWatch(): Promise<void>
  /** Subscribe to "the folder changed" events. Returns an unsubscribe function. */
  onReplaysChanged(cb: () => void): () => void
  /** Progress during a scan/parse pass. Returns an unsubscribe function. */
  onScanProgress(cb: (p: { done: number; total: number }) => void): () => void
  openInFolder(filePath: string): Promise<void>
}
