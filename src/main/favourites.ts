import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { parseLocal } from './replay-parser'
import { store } from './store'

/**
 * Favourites are keyed by gameId when known (stable across renames/moves), and
 * fall back to the file name otherwise.
 */
export function favouriteKeyForGameId(gameId: string | null, fileName: string): string {
  return gameId ? `game:${gameId}` : `file:${fileName}`
}

/** Cheap key: uses whatever gameId we already have cached, no parsing. */
export function favouriteKeyForFile(filePath: string, knownGameId?: string | null): string {
  const gameId = knownGameId ?? store.getCache(filePath)?.gameId ?? null
  return favouriteKeyForGameId(gameId, basename(filePath))
}

/**
 * Authoritative key: parses the file once (and caches the result) if we do not
 * yet know its gameId. Used by favourite writes and the clear operation.
 */
export function resolveFavouriteKey(filePath: string): string {
  const fileName = basename(filePath)
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return favouriteKeyForFile(filePath)
  }

  const cached = store.getCache(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return favouriteKeyForGameId(cached.gameId, fileName)
  }

  const meta = parseLocal(filePath, stat.size)
  store.setCache(filePath, { mtimeMs: stat.mtimeMs, gameId: meta.gameId, meta })
  return favouriteKeyForGameId(meta.gameId, fileName)
}
