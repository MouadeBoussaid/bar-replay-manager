import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplayMeta, Settings } from '../shared/types'

export interface Favourite {
  note: string
  tags: string[]
  addedAt: string
}

/** Bump when the shape/range of parsed fields changes so stale entries are re-parsed. */
export const CACHE_VERSION = 5

export interface CacheEntry {
  mtimeMs: number
  gameId: string | null
  /** Parser version that produced `meta`; entries below CACHE_VERSION are ignored. */
  v?: number
  /** Cached local-only ReplayMeta (never the online-merged version). */
  meta: ReplayMeta | null
}

interface ApiCacheEntry {
  fetchedAt: string
  data: unknown
}

interface DbShape {
  settings: Settings
  /** Keyed by `game:<gameId>` when known, else `file:<fileName>`. */
  favourites: Record<string, Favourite>
  /** Keyed by absolute file path. */
  cache: Record<string, CacheEntry>
  /** Keyed by gameId. */
  apiCache: Record<string, ApiCacheEntry>
}

const DEFAULTS: DbShape = {
  settings: {
    replaysFolder: null,
    onlineEnrich: true,
    listPaneWidth: 392,
    perspectivePlayerName: ''
  },
  favourites: {},
  cache: {},
  apiCache: {}
}

class Store {
  private readonly file: string
  private data: DbShape
  private writeTimer: NodeJS.Timeout | null = null

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'store.json')
    this.data = this.load()
  }

  private load(): DbShape {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<DbShape>
        return {
          settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
          favourites: parsed.favourites ?? {},
          cache: parsed.cache ?? {},
          apiCache: parsed.apiCache ?? {}
        }
      }
    } catch (err) {
      console.error('[store] failed to load, starting fresh:', err)
    }
    return structuredClone(DEFAULTS)
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[store] failed to write:', err)
    }
  }

  // ---- settings -----------------------------------------------------------
  getSettings(): Settings {
    return { ...this.data.settings }
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleWrite()
    return this.getSettings()
  }

  // ---- favourites -------------------------------------------------------
  getFavourite(key: string): Favourite | undefined {
    return this.data.favourites[key]
  }

  isFavourite(key: string): boolean {
    return key in this.data.favourites
  }

  addFavourite(key: string): void {
    if (!this.data.favourites[key]) {
      this.data.favourites[key] = { note: '', tags: [], addedAt: new Date().toISOString() }
      this.scheduleWrite()
    }
  }

  removeFavourite(key: string): void {
    if (this.data.favourites[key]) {
      delete this.data.favourites[key]
      this.scheduleWrite()
    }
  }

  updateFavourite(key: string, data: { note?: string; tags?: string[] }): void {
    const cur =
      this.data.favourites[key] ?? { note: '', tags: [], addedAt: new Date().toISOString() }
    this.data.favourites[key] = {
      ...cur,
      note: data.note ?? cur.note,
      tags: data.tags ?? cur.tags
    }
    this.scheduleWrite()
  }

  // ---- parsed-metadata cache -------------------------------------------
  getCache(path: string): CacheEntry | undefined {
    return this.data.cache[path]
  }

  /** Cache entry for `path` only if it is fresh (mtime match) and current-version. */
  getFreshCache(path: string, mtimeMs: number): CacheEntry | undefined {
    const e = this.data.cache[path]
    return e && e.mtimeMs === mtimeMs && e.v === CACHE_VERSION && e.meta ? e : undefined
  }

  setCache(path: string, entry: Omit<CacheEntry, 'v'>): void {
    this.data.cache[path] = { ...entry, v: CACHE_VERSION }
    this.scheduleWrite()
  }

  pruneCache(existingPaths: Set<string>): void {
    let changed = false
    for (const p of Object.keys(this.data.cache)) {
      if (!existingPaths.has(p)) {
        delete this.data.cache[p]
        changed = true
      }
    }
    if (changed) this.scheduleWrite()
  }

  // ---- bar-rts.com response cache ------------------------------------
  getApiCache(gameId: string): ApiCacheEntry | undefined {
    return this.data.apiCache[gameId]
  }

  setApiCache(gameId: string, data: unknown): void {
    this.data.apiCache[gameId] = { fetchedAt: new Date().toISOString(), data }
    this.scheduleWrite()
  }
}

export const store = new Store()
