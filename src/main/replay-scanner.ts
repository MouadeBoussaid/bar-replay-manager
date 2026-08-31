import { BrowserWindow } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplayListItem, ReplayMeta } from '../shared/types'
import { teamColorNames } from '../shared/team-colors'
import { isAiReplay, setAnalyticsIndex } from './analytics'
import { mergeServerData } from './bar-api'
import { favouriteKeyForFile } from './favourites'
import { parseLocal } from './replay-parser'
import { scheduleServerBackfill } from './server-backfill'
import { store } from './store'

// 2026-08-26_22-56-46-123_All That Glitters v2.2.3_2026.07.04.sdfz
const NAME_RE =
  /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-\d+)?_(.+)_([^_]+)\.sdfz$/i

function broadcastProgress(done: number, total: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('replays:scan-progress', { done, total })
  }
}

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
  const metas: ReplayMeta[] = []
  let processed = 0

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

    // Parse-on-scan: reuse the cache when the file is unchanged, otherwise parse
    // the local file now (no network) so rows carry OS / winner / format.
    const cached = store.getFreshCache(filePath, mtimeMs)
    let meta: ReplayMeta
    if (cached?.meta) {
      meta = cached.meta
    } else {
      meta = parseLocal(filePath, fileSize)
      store.setCache(filePath, { mtimeMs, gameId: meta.gameId, meta })
    }

    metas.push(meta)
    processed++
    if (processed % 25 === 0) broadcastProgress(processed, names.length)

    const parseError = !!meta.parseError
    const parsed = !parseError

    // A crashed / force-ended game leaves the .sdfz trailer unwritten — no
    // winner, no end-game stats. When bar-rts.com has already been fetched for
    // this game, overlay that record (no network here — cache only) so the row
    // still gets a result, duration and roster.
    let view = meta
    if (!meta.allyTeams.some((t) => t.won === true) && meta.gameId) {
      const server = store.getApiCache(meta.gameId)?.data
      if (server && typeof server === 'object') {
        view = mergeServerData(meta, server as Record<string, unknown>)
      }
    }

    const players = view.allyTeams.flatMap((t) => t.players)
    const rated = players.filter((p) => typeof p.skillOS === 'number')
    const avgOs =
      rated.length > 0
        ? rated.reduce((sum, p) => sum + (p.skillOS ?? 0), 0) / rated.length
        : null
    const winnerTeamOrdinal = view.allyTeams.findIndex((t) => t.won === true)
    const winnerTeamColor =
      winnerTeamOrdinal >= 0
        ? (teamColorNames(view)[winnerTeamOrdinal] ?? null)
        : null

    const gameId = view.gameId ?? cached?.gameId ?? null
    const favKey = favouriteKeyForFile(filePath, gameId)
    const fav = store.getFavourite(favKey)

    items.push({
      filePath,
      fileName,
      fileSize,
      mtimeMs,
      gameId,
      startTime: view.startTime ?? startTime,
      mapName: view.map?.name && view.map.name !== 'Unknown' ? view.map.name : mapName,
      durationMs: view.durationMs || null,
      engineTag: view.engineVersion || engineTag,
      playerNames: players.map((p) => p.name),
      teamPlayerNames: view.allyTeams.map((t) => t.players.map((p) => p.name)),
      playerCount: players.length || null,
      teamSizes: view.allyTeams.map((t) => t.players.length),
      avgOs,
      winnerTeamOrdinal: winnerTeamOrdinal >= 0 ? winnerTeamOrdinal : null,
      winnerTeamColor,
      endedNormally: parsed ? view.endedNormally : null,
      isAiGame: parsed && isAiReplay(view),
      parsed,
      parseError,
      isFavourite: !!fav,
      tags: fav?.tags ?? [],
      note: fav?.note ?? ''
    })
  }

  broadcastProgress(names.length, names.length)
  setAnalyticsIndex(metas)
  scheduleServerBackfill(metas)

  items.sort(
    (a, b) =>
      (b.startTime ?? '').localeCompare(a.startTime ?? '') || b.mtimeMs - a.mtimeMs
  )
  return items
}
