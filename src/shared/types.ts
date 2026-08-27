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
  /** When true, winners are highlighted / win badges are shown in the detail view. */
  spoilResults: boolean
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
  source: 'local' | 'local+online'
  /** Populated when online enrichment was attempted but failed. */
  enrichError?: string
}

/** Lightweight row for the replay list — cheap to build (filename + cache only). */
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
  isFavourite: boolean
  tags: string[]
  note: string
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

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickFolder(): Promise<string | null>
  detectDefaultFolder(): Promise<string | null>
  listReplays(folder: string): Promise<ReplayListItem[]>
  getReplayDetail(filePath: string): Promise<ReplayMeta>
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
  openInFolder(filePath: string): Promise<void>
}
