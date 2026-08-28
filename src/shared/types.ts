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
   * Player name for the User analytics tab. When set, the replay list splits into
   * "My replays" (this player took part) and "Watched replays". Empty = no split.
   */
  analyticsPlayerName: string
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

/** ---- User analytics ---------------------------------------------------- */

export type GameResult = 'win' | 'loss' | 'undecided'
export type AnalyticsScope = 'all' | '90d' | 'last50'

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
  form: {
    metrics: { key: string; label: string }[]
    games: ReportFormGame[]
  }
  factions: ReportBar[]
  sizes: ReportBar[]
  durations: ReportDurationBucket[]
  /** 6 fractions (0..1), row-major: N-left, N-centre, N-right, S-left, S-centre, S-right. */
  startCells: number[]
  startSplits: { north: number; south: number; flank: number; centre: number }
  /** Replays excluded from the start grid for unreadable boxes. */
  startExcluded: number
  maps: ReportMap[]
  mapsHasMore: boolean
  company: { withP: ReportCompanyRow[]; vsP: ReportCompanyRow[] }
  appearances: ReportAppearance[]
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
  /** Launch the local BAR client with this replay file. */
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
  /** Distinct player names across every indexed replay (for the analytics picker). */
  getIndexedPlayerNames(): Promise<string[]>
  /** Aggregated playstyle report for one player. */
  getPlayerReport(name: string, scope: AnalyticsScope): Promise<PlayerReport>
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
