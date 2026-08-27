import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplayListItem } from '../shared/types'
import { favouriteKeyForFile } from './favourites'
import { store } from './store'

// 2026-08-26_22-56-46-123_All That Glitters v2.2.3_2026.07.04.sdfz
const NAME_RE =
  /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-\d+)?_(.+)_([^_]+)\.sdfz$/i

export function listReplays(folder: string): ReplayListItem[] {
  let names: string[]
  try {
    names = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.sdfz'))
  } catch {
    return []
  }

  const paths = new Set(names.map((f) => join(folder, f)))
  store.pruneCache(paths)

  const items: ReplayListItem[] = []
  for (const fileName of names) {
    const filePath = join(folder, fileName)
    let fileSize = 0
    let mtimeMs = 0
    try {
      const st = statSync(filePath)
      fileSize = st.size
      mtimeMs = st.mtimeMs
    } catch {
      continue
    }

    const m = NAME_RE.exec(fileName)
    let startTime: string | null = null
    let mapName = 'Unknown'
    let engineTag: string | null = null
    if (m) {
      const [, y, mo, d, h, mi, s, map, eng] = m
      startTime = `${y}-${mo}-${d}T${h}:${mi}:${s}`
      mapName = map!.replace(/_/g, ' ').trim()
      engineTag = eng!
    }

    const cache = store.getCache(filePath)
    const fresh = cache && cache.mtimeMs === mtimeMs ? cache.meta : null
    let gameId: string | null = cache?.gameId ?? null
    let durationMs: number | null = null
    let playerNames: string[] = []

    if (fresh) {
      gameId = fresh.gameId ?? gameId
      durationMs = fresh.durationMs || null
      mapName = fresh.map?.name ?? mapName
      startTime = fresh.startTime ?? startTime
      engineTag = fresh.engineVersion || engineTag
      playerNames = fresh.allyTeams.flatMap((t) => t.players.map((p) => p.name))
    }

    const favKey = favouriteKeyForFile(filePath, gameId)
    const fav = store.getFavourite(favKey)

    items.push({
      filePath,
      fileName,
      fileSize,
      mtimeMs,
      gameId,
      startTime,
      mapName,
      durationMs,
      engineTag,
      playerNames,
      playerCount: playerNames.length || null,
      isFavourite: !!fav,
      tags: fav?.tags ?? [],
      note: fav?.note ?? ''
    })
  }

  items.sort(
    (a, b) =>
      (b.startTime ?? '').localeCompare(a.startTime ?? '') || b.mtimeMs - a.mtimeMs
  )
  return items
}
