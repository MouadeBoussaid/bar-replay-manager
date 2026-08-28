import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayGraph, ReplayMeta } from '../../shared/types'
import { fmtClock, fmtCompact } from './format'

interface Props {
  meta: ReplayMeta
}

const FIELD_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: 'Metal',
    items: [
      { key: 'metalProduced', label: 'Metal produced' },
      { key: 'metalUsed', label: 'Metal used' },
      { key: 'metalExcess', label: 'Metal excess' },
      { key: 'metalReceived', label: 'Metal received' },
      { key: 'metalSent', label: 'Metal sent' }
    ]
  },
  {
    group: 'Energy',
    items: [
      { key: 'energyProduced', label: 'Energy produced' },
      { key: 'energyUsed', label: 'Energy used' },
      { key: 'energyExcess', label: 'Energy excess' },
      { key: 'energyReceived', label: 'Energy received' },
      { key: 'energySent', label: 'Energy sent' }
    ]
  },
  {
    group: 'Units',
    items: [
      { key: 'unitsProduced', label: 'Units produced' },
      { key: 'unitsKilled', label: 'Units killed' },
      { key: 'unitsDied', label: 'Units lost' },
      { key: 'unitsReceived', label: 'Units received' },
      { key: 'unitsSent', label: 'Units sent' },
      { key: 'unitsCaptured', label: 'Units captured' },
      { key: 'unitsOutCaptured', label: 'Units stolen' }
    ]
  },
  {
    group: 'Combat',
    items: [
      { key: 'damageDealt', label: 'Damage dealt' },
      { key: 'damageReceived', label: 'Damage received' }
    ]
  }
]
const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))
)

const MIN_H = 240
const M = { top: 14, right: 14, bottom: 26, left: 58 }

export function GraphsTab({ meta }: Props): JSX.Element {
  const [data, setData] = useState<ReplayGraph | null | undefined>(undefined)
  const [field, setField] = useState('metalProduced')
  const [mode, setMode] = useState<'total' | 'delta'>('total')
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [hoverI, setHoverI] = useState<number | null>(null)
  const [width, setWidth] = useState(760)
  const [plotH, setPlotH] = useState(360)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setData(undefined)
    setHidden(new Set())
    setHoverI(null)
    window.api
      .getReplayGraph(meta.filePath)
      .then((g) => !cancelled && setData(g && g.times.length >= 2 ? g : null))
      .catch(() => !cancelled && setData(null))
    return () => {
      cancelled = true
    }
  }, [meta.filePath])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = (): void => {
      setWidth(el.clientWidth)
      setPlotH(el.clientHeight)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [data])

  // Per-team series for the current field + mode.
  const series = useMemo(() => {
    if (!data) return []
    const raw = data.fields[field] ?? []
    return raw.map((arr) =>
      mode === 'total'
        ? arr
        : arr.map((v, i) => (i === 0 ? Math.max(0, v) : Math.max(0, v - arr[i - 1]!)))
    )
  }, [data, field, mode])

  if (data === undefined) {
    return (
      <div className="graphs-tab">
        <p className="stats-empty">Loading time series…</p>
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="graphs-tab">
        <p className="stats-empty">
          This replay has no time-series data — the game crashed or ended before the first
          stats snapshot.
        </p>
      </div>
    )
  }

  const times = data.times
  const n = times.length
  const tMax = times[n - 1] || 1
  const H = Math.max(MIN_H, plotH)
  const pw = Math.max(120, width - M.left - M.right)
  const ph = H - M.top - M.bottom

  const visible = data.teams
    .map((t, ti) => ({ t, ti }))
    .filter(({ t }) => !hidden.has(t.teamId))

  let vMax = 0
  let vMinPos = Infinity
  for (const { ti } of visible) {
    for (const v of series[ti] ?? []) {
      if (v > vMax) vMax = v
      if (v > 0 && v < vMinPos) vMinPos = v
    }
  }
  if (!Number.isFinite(vMinPos)) vMinPos = 1
  const yMax = vMax > 0 ? vMax : 1
  const yMin = scale === 'log' ? Math.max(vMinPos, yMax / 1e4) : 0

  const xAt = (i: number): number => M.left + (times[i]! / tMax) * pw
  const yAt = (v: number): number => {
    const nrm =
      scale === 'log'
        ? (Math.log(Math.max(v, yMin)) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin) || 1)
        : v / (yMax || 1)
    return M.top + ph - Math.max(0, Math.min(1, nrm)) * ph
  }

  const yTicks = niceTicks(yMin, yMax, scale, 5)
  const xTicks = xTickTimes(tMax)

  const linePath = (arr: number[]): string => {
    let d = ''
    for (let i = 0; i < arr.length && i < n; i++) {
      d += `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(arr[i]!).toFixed(1)}`
    }
    return d
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - M.left
    if (px < -8 || px > pw + 8) {
      setHoverI(null)
      return
    }
    const frac = Math.max(0, Math.min(1, px / pw))
    // nearest sample by time
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(times[i]! / tMax - frac)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    setHoverI(best)
  }

  const hoverRows =
    hoverI == null
      ? []
      : visible
          .map(({ t, ti }) => ({ t, v: series[ti]?.[hoverI] ?? null }))
          .filter((r) => r.v != null)
          .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))

  const tooltipX = hoverI == null ? 0 : xAt(hoverI)
  const tipRight = tooltipX > M.left + pw * 0.6

  return (
    <div className="graphs-tab">
      <div className="graph-controls">
        <select
          className="sort-select"
          value={field}
          onChange={(e) => setField(e.target.value)}
          aria-label="Stat"
        >
          {FIELD_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as 'total' | 'delta')}
          options={[
            ['total', 'Total'],
            ['delta', 'Per interval']
          ]}
        />
        <Segmented
          value={scale}
          onChange={(v) => setScale(v as 'linear' | 'log')}
          options={[
            ['linear', 'Linear'],
            ['log', 'Log']
          ]}
        />
      </div>

      <div className="graph-plot" ref={wrapRef}>
        <svg
          width={width}
          height={H}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverI(null)}
          role="img"
          aria-label={`${FIELD_LABEL[field]} over time, per player`}
        >
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line
                className="graph-grid"
                x1={M.left}
                x2={M.left + pw}
                y1={yAt(v)}
                y2={yAt(v)}
              />
              <text className="graph-axis" x={M.left - 8} y={yAt(v) + 3} textAnchor="end">
                {fmtCompact(v)}
              </text>
            </g>
          ))}
          {xTicks.map((sec) => (
            <g key={`x${sec}`}>
              <line
                className="graph-grid"
                x1={M.left + (sec / tMax) * pw}
                x2={M.left + (sec / tMax) * pw}
                y1={M.top}
                y2={M.top + ph}
              />
              <text
                className="graph-axis"
                x={M.left + (sec / tMax) * pw}
                y={M.top + ph + 16}
                textAnchor="middle"
              >
                {fmtClock(sec * 1000)}
              </text>
            </g>
          ))}

          {visible.map(({ t, ti }) => (
            <path key={`c${t.teamId}`} className="graph-line-casing" d={linePath(series[ti] ?? [])} />
          ))}
          {visible.map(({ t, ti }) => (
            <path
              key={`l${t.teamId}`}
              d={linePath(series[ti] ?? [])}
              fill="none"
              stroke={t.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hoverI != null && (
            <>
              <line
                className="graph-crosshair"
                x1={tooltipX}
                x2={tooltipX}
                y1={M.top}
                y2={M.top + ph}
              />
              {visible.map(({ t, ti }) => {
                const v = series[ti]?.[hoverI]
                if (v == null) return null
                return (
                  <circle
                    key={`d${t.teamId}`}
                    cx={tooltipX}
                    cy={yAt(v)}
                    r={3}
                    fill={t.color}
                    stroke="var(--bg-app)"
                    strokeWidth={1}
                  />
                )
              })}
            </>
          )}
        </svg>

        {hoverI != null && hoverRows.length > 0 && (
          <div
            className="graph-tooltip"
            style={
              tipRight
                ? { right: `${width - tooltipX + 12}px` }
                : { left: `${tooltipX + 12}px` }
            }
          >
            <div className="graph-tooltip-time">{fmtClock(times[hoverI]! * 1000)}</div>
            {hoverRows.map(({ t, v }) => (
              <div key={t.teamId} className="graph-tooltip-row">
                <span className="graph-swatch" style={{ background: t.color }} />
                <span className="graph-tooltip-name">{t.name}</span>
                <span className="graph-tooltip-val">{fmtCompact(v ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="graph-legend">
        {data.teams.map((t, ti) => {
          const off = hidden.has(t.teamId)
          const final = lastFinite(series[ti])
          return (
            <button
              key={t.teamId}
              className={`graph-chip ${off ? 'graph-chip-off' : ''}`}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(t.teamId)) next.delete(t.teamId)
                  else next.add(t.teamId)
                  return next
                })
              }
            >
              <span className="graph-swatch" style={{ background: t.color }} />
              {t.name}
              <span className="graph-chip-val">{final == null ? '—' : fmtCompact(final)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={value === v ? 'seg-on' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function lastFinite(arr: number[] | undefined): number | null {
  if (!arr) return null
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i]!
  return null
}

/** Round, evenly-spaced y-axis tick values. */
function niceTicks(min: number, max: number, scale: 'linear' | 'log', count: number): number[] {
  if (max <= min) return [min, max]
  if (scale === 'log') {
    const out: number[] = []
    const lo = Math.floor(Math.log10(min))
    const hi = Math.ceil(Math.log10(max))
    for (let e = lo; e <= hi; e++) out.push(10 ** e)
    return out.filter((v) => v >= min * 0.999 && v <= max * 1.001)
  }
  const step = niceStep((max - min) / count)
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(v)
  return out
}

function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const s = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return s * mag
}

/** mm:ss gridline positions across the game. */
function xTickTimes(tMax: number): number[] {
  const target = 6
  const step = niceStep(tMax / target)
  const out: number[] = []
  for (let s = 0; s <= tMax + 1; s += step) out.push(Math.round(s))
  return out
}
