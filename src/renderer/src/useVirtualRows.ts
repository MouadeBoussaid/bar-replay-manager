import { useEffect, useMemo, useRef, useState } from 'react'

interface VirtualWindow {
  /** Attach to the scroll container. */
  ref: React.RefObject<HTMLDivElement>
  /** Total scroll height so the scrollbar is the right size. */
  totalHeight: number
  /** Pixel offset to translate the rendered slice by. */
  offsetY: number
  /** Inclusive start / exclusive end indices to render. */
  start: number
  end: number
  /** Cumulative pixel offset of each row; length is `rows + 1`. */
  offsets: number[]
}

/**
 * Minimal windowing virtualiser with per-row heights (so the list can mix full
 * replay rows and shorter group headers). Pass a memoised `heights` array.
 */
export function useVirtualRows(heights: number[], overscan = 6): VirtualWindow {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    const measure = (): void => setViewport(el.clientHeight)
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  const offsets = useMemo(() => {
    const o = new Array<number>(heights.length + 1)
    o[0] = 0
    for (let i = 0; i < heights.length; i++) o[i + 1] = o[i]! + heights[i]!
    return o
  }, [heights])

  const total = offsets[heights.length] ?? 0
  const viewH = viewport || 700

  // last row whose top offset is <= scrollTop
  let s = upperBound(offsets, scrollTop) - 1
  s = Math.max(0, s - overscan)
  // first row whose top offset is > scrollTop + viewport
  let e = upperBound(offsets, scrollTop + viewH)
  e = Math.min(heights.length, e + overscan)

  return { ref, totalHeight: total, offsetY: offsets[s] ?? 0, start: s, end: e, offsets }
}

/** Index of the first element in `arr` strictly greater than `x` (arr is sorted). */
function upperBound(arr: number[], x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}
