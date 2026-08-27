import { useEffect, useState } from 'react'

// Module-level memo so flipping between replays on the same map is instant and
// doesn't re-hit the main process (which would re-read + re-encode the file).
const memo = new Map<string, string | null>()

/**
 * Resolve a map's minimap texture to a `data:` URL (or null). `thumb` for the
 * Overview map panel, `mq` for the detail hero.
 */
export function useMapImage(
  mapName: string | null | undefined,
  size: 'thumb' | 'mq'
): string | null {
  const key = mapName ? `${size}:${mapName}` : null
  const [url, setUrl] = useState<string | null>(() => (key ? memo.get(key) ?? null : null))

  useEffect(() => {
    if (!mapName || !key) {
      setUrl(null)
      return
    }
    if (memo.has(key)) {
      setUrl(memo.get(key) ?? null)
      return
    }
    let cancelled = false
    window.api
      .getMapImage(mapName, size)
      .then((result) => {
        memo.set(key, result)
        if (!cancelled) setUrl(result)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [mapName, size, key])

  return url
}
