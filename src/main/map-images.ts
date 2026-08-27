import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
