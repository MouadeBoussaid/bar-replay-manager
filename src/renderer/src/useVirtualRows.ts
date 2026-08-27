import { useEffect, useRef, useState } from 'react'

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
}

/**
 * Minimal fixed-row-height virtualiser — enough for a few thousand replay rows
 * without pulling in a dependency. `rowHeight` must match the CSS row height.
 */
export function useVirtualRows(count: number, rowHeight: number, overscan = 6): VirtualWindow {
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

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visible = Math.ceil((viewport || 700) / rowHeight) + overscan * 2
  const end = Math.min(count, start + visible)

  return { ref, totalHeight: count * rowHeight, offsetY: start * rowHeight, start, end }
}
