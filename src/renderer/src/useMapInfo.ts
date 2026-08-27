import { useEffect, useState } from 'react'
import type { MapInfo } from '../../shared/types'

const memo = new Map<string, MapInfo | null>()

/** Map dimensions + canonical start spots, for plotting start pips. */
export function useMapInfo(mapName: string | null | undefined): MapInfo | null {
  const [info, setInfo] = useState<MapInfo | null>(() =>
    mapName ? memo.get(mapName) ?? null : null
  )

  useEffect(() => {
    if (!mapName) {
      setInfo(null)
      return
    }
    if (memo.has(mapName)) {
      setInfo(memo.get(mapName) ?? null)
      return
    }
    let cancelled = false
    window.api
      .getMapInfo(mapName)
      .then((result) => {
        memo.set(mapName, result)
        if (!cancelled) setInfo(result)
      })
      .catch(() => {
        if (!cancelled) setInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [mapName])

  return info
}
