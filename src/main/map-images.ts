import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MapInfo } from '../shared/types'

/**
 * Minimap textures come from the public bar-rts map API and are cached forever
 * under `userData/map-cache`. Returns a `data:` URL the renderer can drop into an
 * <img>, or null when the map is unknown / the network is unavailable.
 */

const API = 'https://api.bar-rts.com'
const TIMEOUT_MS = 8000
export type MapImageSize = 'thumb' | 'mq'

let dir: string | null = null
function cacheDir(): string {
  if (!dir) {
    dir = join(app.getPath('userData'), 'map-cache')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** "All That Glitters v2.2.3" -> "all_that_glitters_v2.2.3" (bar-rts fileName form). */
function toFileName(scriptName: string): string {
  return scriptName.trim().toLowerCase().replace(/\s+/g, '_')
}

const inflight = new Map<string, Promise<string | null>>()

export function getMapImage(
  scriptName: string,
  size: MapImageSize
): Promise<string | null> {
  const key = `${toFileName(scriptName)}|${size}`
  let p = inflight.get(key)
  if (!p) {
    p = resolve(scriptName, size).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

async function resolve(scriptName: string, size: MapImageSize): Promise<string | null> {
  const fileName = toFileName(scriptName)
  const hit = join(cacheDir(), `${fileName}.${size}.jpg`)
  const miss = join(cacheDir(), `${fileName}.${size}.miss`)

  if (existsSync(hit)) return toDataUrl(readFileSync(hit))
  if (existsSync(miss)) return null

  let bytes = await fetchTexture(fileName, size)
  if (!bytes) {
    const alt = await searchFileName(scriptName)
    if (alt && alt !== fileName) bytes = await fetchTexture(alt, size)
  }

  if (!bytes) {
    try {
      writeFileSync(miss, '')
    } catch {
      /* ignore */
    }
    return null
  }
  try {
    writeFileSync(hit, bytes)
  } catch {
    /* ignore */
  }
  return toDataUrl(bytes)
}

async function fetchTexture(
  fileName: string,
  size: MapImageSize
): Promise<Buffer | null> {
  const url = `${API}/maps/${encodeURIComponent(fileName)}/texture-${size}.jpg`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const infoInflight = new Map<string, Promise<MapInfo | null>>()

export function getMapInfo(scriptName: string): Promise<MapInfo | null> {
  const key = toFileName(scriptName)
  let p = infoInflight.get(key)
  if (!p) {
    p = resolveInfo(scriptName).finally(() => infoInflight.delete(key))
    infoInflight.set(key, p)
  }
  return p
}

async function resolveInfo(scriptName: string): Promise<MapInfo | null> {
  const fileName = toFileName(scriptName)
  const hit = join(cacheDir(), `${fileName}.info.json`)
  const miss = join(cacheDir(), `${fileName}.info.miss`)
  if (existsSync(hit)) {
    try {
      return JSON.parse(readFileSync(hit, 'utf-8')) as MapInfo
    } catch {
      /* fall through and refetch */
    }
  }
  if (existsSync(miss)) return null

  let raw = await fetchMapJson(fileName)
  if (!raw) {
    const alt = await searchFileName(scriptName)
    if (alt && alt !== fileName) raw = await fetchMapJson(alt)
  }

  const info = normalizeMapInfo(raw)
  if (!info) {
    try {
      writeFileSync(miss, '')
    } catch {
      /* ignore */
    }
    return null
  }
  try {
    writeFileSync(hit, JSON.stringify(info))
  } catch {
    /* ignore */
  }
  return info
}

async function fetchMapJson(fileName: string): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API}/maps/${encodeURIComponent(fileName)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function normalizeMapInfo(raw: any): MapInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const width = Number(raw.width)
  const height = Number(raw.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const startPositions = Array.isArray(raw.startPositions)
    ? raw.startPositions
        .map((s: any) => ({ x: Number(s?.x), z: Number(s?.z) }))
        .filter((s: { x: number; z: number }) => Number.isFinite(s.x) && Number.isFinite(s.z))
    : []
  return { width, height, startPositions }
}

/** Fall back to the search endpoint when the derived fileName 404s. */
async function searchFileName(scriptName: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `${API}/maps?search=${encodeURIComponent(scriptName)}&limit=1`,
      { signal: ctrl.signal, headers: { accept: 'application/json' } }
    )
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { fileName?: string }[] }
    return body.data?.[0]?.fileName ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function toDataUrl(buf: Buffer): string {
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}
