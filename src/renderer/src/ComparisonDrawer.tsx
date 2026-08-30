import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComparisonSeries, PlayerMeta, ReplayMeta } from '../../shared/types'
import { teamColorNames } from '../../shared/team-colors'
import { fmtCompact } from './format'

/* Line colours are fixed to the comparison, never the in-game team — two allies
 * would otherwise be indistinguishable. A = blue, B = red, always. */
const LINE_A = '#5b9cd6'
const LINE_B = '#e2504a'
const NEUTRAL = 'rgba(255,255,255,.4)'
/* Energy is ~20× metal in BAR, so a raw sum is an energy chart. Weight energy to
 * metal-equivalent at the rough in-game exchange rate and state it in the caption. */
const ENERGY_WEIGHT = 1 / 20
/* Enforced minimum window, in samples (~3 min at 15 s). */
const MIN_SPAN = 12

const FACTION_COLOR: Record<string, string> = {
  A: '#6db8ff',
  C: '#ff6b5e',
  L: '#7bd88f',
  R: '#b98cff'
}

interface Props {
  meta: ReplayMeta
  /** The manager's perspective player — pre-selected as A when they're in the match. */
  perspectivePlayer: string
  onClose: () => void
}

/** Second chart's mode. `field` = estimated value on field (heuristic), `spent` = cumulative metal spent. */
type ArmyMode = 'field' | 'spent'

interface DPlayer {
  name: string
  allyIdx: number
  os: number | null
  faction: string
  side: 'blue' | 'red' | null
  result: 'win' | 'loss' | 'undecided'
  meta: PlayerMeta
}

export function ComparisonDrawer({ meta, perspectivePlayer, onClose }: Props): JSX.Element {
  const players = useMemo(() => listPlayers(meta), [meta])

  // User picks override the derived defaults; fall back to a default whenever the
  // override isn't a real player in this match (or hasn't been set).
  const [aPick, setAPick] = useState<string | null>(null)
  const [bPick, setBPick] = useState<string | null>(null)
  const [armyMode, setArmyMode] = useState<ArmyMode>(() => {
    try {
      return sessionStorage.getItem('cmp.armyMode') === 'spent' ? 'spent' : 'field'
    } catch {
      return 'field'
    }
  })
  const [series, setSeries] = useState<ComparisonSeries | null | 'loading'>('loading')
  /** Window as inclusive sample indices, or null until the timeline loads. */
  const [win, setWin] = useState<[number, number] | null>(null)
  const [cursor, setCursor] = useState(0)

  // Default pair: perspective player (or top OS) vs. the best of the other side.
  const [defA, defB] = useMemo(() => {
    if (players.length < 2) return ['', '']
    const byOs = (x: DPlayer, y: DPlayer): number => (y.os ?? -1) - (x.os ?? -1)
    const persp = players.find(
      (p) => p.name.toLowerCase() === perspectivePlayer.trim().toLowerCase()
    )
    const a = persp ?? [...players].sort(byOs)[0]!
    const opp = players.filter((p) => p.name !== a.name && p.allyIdx !== a.allyIdx)
    const pool = opp.length ? opp : players.filter((p) => p.name !== a.name)
    return [a.name, [...pool].sort(byOs)[0]!.name]
  }, [players, perspectivePlayer])

  const has = (name: string | null): boolean => !!name && players.some((p) => p.name === name)
  const aName = has(aPick) ? aPick! : defA
  const bRaw = has(bPick) ? bPick! : defB
  const bName = bRaw === aName ? otherThan(players, aName, defB) : bRaw

  useEffect(() => {
    try {
      sessionStorage.setItem('cmp.armyMode', armyMode)
    } catch {
      /* private mode — fine */
    }
  }, [armyMode])

  // Refetch when the pair changes; keep the current chart visible until it lands
  // (the sample grid is identical, so window/cursor stay put).
  useEffect(() => {
    if (!aName || !bName) return
    let cancelled = false
    window.api
      .getComparisonSeries({ filePath: meta.filePath, players: [aName, bName] })
      .then((s) => !cancelled && setSeries(s && s.times.length >= 2 ? s : null))
      .catch(() => !cancelled && setSeries(null))
    return () => {
      cancelled = true
    }
  }, [meta.filePath, aName, bName])

  const times = series && series !== 'loading' ? series.times : []
  const n = times.length

  useEffect(() => {
    if (n >= 2) {
      setWin([0, n - 1])
      setCursor(Math.floor((n - 1) / 2))
    } else {
      setWin(null)
    }
  }, [n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const period = series && series !== 'loading' ? series.periodSeconds : 15
  const [lo, hi] = win ?? [0, Math.max(0, n - 1)]
  const cur = Math.min(hi, Math.max(lo, cursor))

  const aP = players.find((p) => p.name === aName) ?? null
  const bP = players.find((p) => p.name === bName) ?? null

  const missingSeries = series !== 'loading' && series === null
  const shortMatch = n > 0 && n < MIN_SPAN

  const model = useMemo(() => {
    if (!series || series === 'loading' || !win || !aP || !bP) return null
    return buildModel(series, aP.name, bP.name, lo, hi, armyMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, aName, bName, lo, hi, armyMode])

  const fmt = meta.allyTeams.map((t) => t.players.length).join('v')
  const matchLine = `${meta.map.name} · ${fmt} · ${mmss(meta.durationMs / 1000)}`

  const changeA = (name: string): void => {
    setAPick(name)
    if (name === bName) setBPick(otherThan(players, name, defB))
  }
  const changeB = (name: string): void => setBPick(name)

  return (
    <>
      <div className="cmp-scrim" onClick={onClose} />
      <aside className="cmp-drawer" role="dialog" aria-label="Compare players">
        <div className="cmp-head">
          <span className="cmp-chevron">›</span>
          <span className="cmp-title">Compare</span>
          <span className="cmp-match">{matchLine}</span>
          <div className="an-spacer" />
          <button className="cmp-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="cmp-pair">
          <PlayerRow slot="A" color={LINE_A} value={aName} players={players} onPick={changeA} />
          <PlayerRow slot="B" color={LINE_B} value={bName} players={players} onPick={changeB} />

          {win && n >= 2 && !missingSeries && (
            <div className="cmp-window">
              <div className="cmp-window-head">
                <span className="an-kicker">Window</span>
                <span className="cmp-window-range">
                  {mmss(times[lo]!)} – {mmss(times[hi]!)}
                </span>
                <span className="cmp-window-qual">
                  {lo === 0 && hi === n - 1
                    ? 'full match'
                    : `${mmss(times[hi]! - times[lo]!)} window`}
                </span>
                <div className="an-spacer" />
                <button className="cmp-reset" onClick={() => setWin([0, n - 1])}>
                  Reset
                </button>
              </div>
              <RangeSlider
                n={n}
                lo={lo}
                hi={hi}
                onChange={(next) => {
                  setWin(next)
                  setCursor((c) => Math.min(next[1], Math.max(next[0], c)))
                }}
              />
              <div className="cmp-window-ticks">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>{mmss(times[Math.round((n - 1) * f)]!)}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="cmp-body">
          {series === 'loading' && <p className="cmp-note">Loading match timeline…</p>}

          {missingSeries && (
            <p className="cmp-note">
              No per-player time series for this match — older engine builds don’t record
              resource ticks, or a selected player isn’t in it. The cards below fall back to
              end-of-game totals.
            </p>
          )}

          {model && (
            <div
              className="cmp-charts"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
                setCursor((c) => Math.max(lo, Math.min(hi, c + step)))
              }}
            >
              <ChartBlock
                title="Economy"
                caption="metal + energy produced, cumulative · energy weighted ×1/20"
                seriesA={model.ecoA}
                seriesB={model.ecoB}
                fillA
                times={model.wt}
                yMax={model.ecoYMax}
                rel={cur - lo}
                pointsOnly={shortMatch}
                onScrub={(r) => setCursor(lo + r)}
                headRight={
                  <>
                    <span className="cmp-legend-val" style={{ color: LINE_A }}>
                      {fmtCompact(model.ecoTotalA)}
                    </span>
                    <span className="cmp-legend-vs">vs</span>
                    <span className="cmp-legend-val" style={{ color: LINE_B }}>
                      {fmtCompact(model.ecoTotalB)}
                    </span>
                  </>
                }
                tooltip={{
                  time: mmss(model.wt[Math.min(model.wt.length - 1, cur - lo)]!),
                  aName: aP!.name,
                  bName: bP!.name,
                  aVal: fmtCompact(model.ecoA[cur - lo] ?? 0),
                  bVal: fmtCompact(model.ecoB[cur - lo] ?? 0),
                  gap: signedCompact((model.ecoA[cur - lo] ?? 0) - (model.ecoB[cur - lo] ?? 0)),
                  gapColor:
                    (model.ecoA[cur - lo] ?? 0) >= (model.ecoB[cur - lo] ?? 0) ? LINE_A : LINE_B
                }}
              />

              <ChartBlock
                title="Investment"
                caption={
                  armyMode === 'field'
                    ? 'estimated value on field · metal spent × surviving-unit share · all unit types'
                    : 'cumulative metal spent · all unit types'
                }
                seriesA={model.armyA}
                seriesB={model.armyB}
                times={model.wt}
                yMax={model.armyYMax}
                rel={cur - lo}
                pointsOnly={shortMatch}
                onScrub={(r) => setCursor(lo + r)}
                timestampChip={mmss(model.wt[Math.min(model.wt.length - 1, cur - lo)]!)}
                headRight={
                  <div className="segmented">
                    <button
                      className={armyMode === 'field' ? 'seg-on' : ''}
                      onClick={() => setArmyMode('field')}
                    >
                      On field
                    </button>
                    <button
                      className={armyMode === 'spent' ? 'seg-on' : ''}
                      onClick={() => setArmyMode('spent')}
                    >
                      Spent
                    </button>
                  </div>
                }
              />

              <div className="cmp-axis">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>
                    {mmss(model.wt[Math.round((model.wt.length - 1) * f)] ?? 0)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="cmp-deltas">
            {(model
              ? model.cards
              : missingSeries
                ? fallbackCards(aP?.meta.stats, bP?.meta.stats)
                : []
            ).map((c) => (
              <div className="cmp-delta" key={c.key}>
                <div className="an-kicker">{c.key}</div>
                <div className="cmp-delta-vals">
                  <span style={{ color: LINE_A }}>{c.a}</span>
                  <span className="cmp-delta-slash">/</span>
                  <span style={{ color: LINE_B }}>{c.b}</span>
                </div>
                <div
                  className="cmp-delta-d"
                  style={{ color: c.tone === 'a' ? LINE_A : c.tone === 'b' ? LINE_B : NEUTRAL }}
                >
                  {c.delta}
                </div>
              </div>
            ))}
          </div>

          {model && !shortMatch && (
            <div className="cmp-readouts">
              {model.readouts.length === 0 ? (
                <div className="cmp-readout">
                  <span className="cmp-readout-tag" style={{ color: NEUTRAL }}>
                    Read
                  </span>
                  <span className="cmp-readout-text">
                    Nothing separates these two over this window — widen the range for a
                    verdict.
                  </span>
                </div>
              ) : (
                model.readouts.map((r, i) => (
                  <div className="cmp-readout" key={i} style={{ borderLeftColor: r.color }}>
                    <span className="cmp-readout-tag" style={{ color: r.color }}>
                      {r.tag}
                    </span>
                    <span className="cmp-readout-text">{r.text}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="cmp-foot">
          drag across a chart to scrub · sampled every {period}s ·{' '}
          {series && series !== 'loading'
            ? series.caveat
            : '“on field” is an estimate, not true army value'}
        </div>
      </aside>
    </>
  )
}

/* --------------------------------------------------------------- player row */

function PlayerRow({
  slot,
  color,
  value,
  players,
  onPick
}: {
  slot: 'A' | 'B'
  color: string
  value: string
  players: DPlayer[]
  onPick: (name: string) => void
}): JSX.Element {
  const p = players.find((x) => x.name === value)
  return (
    <div className={`cmp-prow cmp-prow-${slot.toLowerCase()}`} style={{ borderLeftColor: color }}>
      <span className="cmp-swatch" style={{ background: color }}>
        {slot}
      </span>
      <select className="cmp-select" value={value} onChange={(e) => onPick(e.target.value)}>
        {players.map((x) => (
          <option key={x.name} value={x.name}>
            {x.name}
          </option>
        ))}
      </select>
      {p && (
        <>
          <span className="cmp-prow-os">{p.os != null ? `${p.os.toFixed(1)} OS` : '—'}</span>
          <div className="an-spacer" />
          <span
            className="cmp-prow-fac"
            style={{ color: FACTION_COLOR[p.faction] ?? 'rgba(255,255,255,.55)' }}
          >
            {p.faction}
          </span>
          <span className="cmp-prow-meta" style={{ color }}>
            {p.side ? p.side[0]!.toUpperCase() + p.side.slice(1) : '—'} ·{' '}
            {p.result === 'win' ? 'victory' : p.result === 'loss' ? 'defeat' : '—'}
          </span>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- range slider */

function RangeSlider({
  n,
  lo,
  hi,
  onChange
}: {
  n: number
  lo: number
  hi: number
  onChange: (next: [number, number]) => void
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<'lo' | 'hi' | null>(null)
  const disabled = n - 1 <= MIN_SPAN

  useEffect(() => {
    const idxAt = (clientX: number): number => {
      const r = trackRef.current?.getBoundingClientRect()
      if (!r || r.width === 0) return lo
      return Math.round(((clientX - r.left) / r.width) * (n - 1))
    }
    const move = (e: PointerEvent): void => {
      if (!drag.current) return
      let i = Math.max(0, Math.min(n - 1, idxAt(e.clientX)))
      if (drag.current === 'lo') {
        i = Math.min(i, hi - MIN_SPAN)
        if (i !== lo) onChange([Math.max(0, i), hi])
      } else {
        i = Math.max(i, lo + MIN_SPAN)
        if (i !== hi) onChange([lo, Math.min(n - 1, i)])
      }
    }
    const up = (): void => {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [n, lo, hi, onChange])

  const pct = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * 100)

  return (
    <div className={`cmp-slider ${disabled ? 'cmp-slider-off' : ''}`} ref={trackRef}>
      <div className="cmp-slider-rail" />
      <div
        className="cmp-slider-fill"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <div
        className="cmp-slider-handle"
        style={{ left: `${pct(lo)}%` }}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = 'lo'
        }}
      />
      <div
        className="cmp-slider-handle"
        style={{ left: `${pct(hi)}%` }}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = 'hi'
        }}
      />
    </div>
  )
}

/* --------------------------------------------------------------- chart block */

interface Tooltip {
  time: string
  aName: string
  bName: string
  aVal: string
  bVal: string
  gap: string
  gapColor: string
}

function ChartBlock({
  title,
  caption,
  seriesA,
  seriesB,
  fillA,
  times,
  yMax,
  rel,
  pointsOnly,
  onScrub,
  headRight,
  tooltip,
  timestampChip
}: {
  title: string
  caption: string
  seriesA: number[]
  seriesB: number[]
  fillA?: boolean
  times: number[]
  yMax: number
  rel: number
  pointsOnly: boolean
  onScrub: (rel: number) => void
  headRight?: JSX.Element
  tooltip?: Tooltip
  timestampChip?: string
}): JSX.Element {
  const L = times.length
  const W = 560
  const H = 150
  const x = (i: number): number => (L <= 1 ? 0 : (i / (L - 1)) * W)
  const y = (v: number): number => H - Math.max(0, Math.min(1, v / yMax)) * H
  const line = (arr: number[]): string =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')

  const relC = Math.max(0, Math.min(L - 1, rel))
  const cursorPct = L <= 1 ? 0 : (relC / (L - 1)) * 100
  const tipRight = cursorPct > 58

  const scrub = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width === 0) return
    const i = Math.round(((e.clientX - r.left) / r.width) * (L - 1))
    onScrub(Math.max(0, Math.min(L - 1, i)))
  }

  const yTicks = [yMax, yMax * (2 / 3), yMax / 3, 0]

  return (
    <div className="cmp-chart">
      <div className="cmp-chart-head">
        <span className="an-section-title">{title}</span>
        <span className="cmp-chart-cap">{caption}</span>
        <div className="an-spacer" />
        {headRight}
      </div>
      <div className="cmp-chart-body">
        <div className="cmp-yaxis">
          {yTicks.map((t, i) => (
            <span key={i}>{fmtCompact(t)}</span>
          ))}
        </div>
        <div
          className="cmp-plot"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrub(e)
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="cmp-svg">
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={H * f}
                y2={H * f}
                className="cmp-grid"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {!pointsOnly && fillA && L > 1 && (
              <path
                d={`${line(seriesA)}L${x(L - 1)},${H}L0,${H}Z`}
                fill="rgba(91,156,214,.09)"
                stroke="none"
              />
            )}
            {pointsOnly ? (
              <>
                {seriesA.map((v, i) => (
                  <circle key={`a${i}`} cx={x(i)} cy={y(v)} r={2.4} fill={LINE_A} />
                ))}
                {seriesB.map((v, i) => (
                  <circle key={`b${i}`} cx={x(i)} cy={y(v)} r={2.4} fill={LINE_B} />
                ))}
              </>
            ) : (
              <>
                <path
                  d={line(seriesA)}
                  fill="none"
                  stroke={LINE_A}
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={line(seriesB)}
                  fill="none"
                  stroke={LINE_B}
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
            <line
              x1={x(relC)}
              x2={x(relC)}
              y1="0"
              y2={H}
              stroke="#ffe14d"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(relC)}
              cy={y(seriesA[relC] ?? 0)}
              r={3.2}
              fill={LINE_A}
              stroke="#0f1115"
              strokeWidth={1.4}
            />
            <circle
              cx={x(relC)}
              cy={y(seriesB[relC] ?? 0)}
              r={3.2}
              fill={LINE_B}
              stroke="#0f1115"
              strokeWidth={1.4}
            />
          </svg>

          <div className="cmp-grip" style={{ left: `${cursorPct}%` }}>
            <span />
            <span />
            <span />
          </div>

          {timestampChip && (
            <div className="cmp-tschip" style={{ left: `${cursorPct}%` }}>
              {timestampChip}
            </div>
          )}

          {tooltip && (
            <div className={`cmp-tip ${tipRight ? 'cmp-tip-left' : ''}`} style={{ left: `${cursorPct}%` }}>
              <div className="cmp-tip-time">{tooltip.time}</div>
              <div className="cmp-tip-row">
                <span className="cmp-tip-sw" style={{ background: LINE_A }} />
                <span className="cmp-tip-name">{tooltip.aName}</span>
                <span className="cmp-tip-val">{tooltip.aVal}</span>
              </div>
              <div className="cmp-tip-row">
                <span className="cmp-tip-sw" style={{ background: LINE_B }} />
                <span className="cmp-tip-name">{tooltip.bName}</span>
                <span className="cmp-tip-val">{tooltip.bVal}</span>
              </div>
              <div className="cmp-tip-sep" />
              <div className="cmp-tip-row">
                <span className="cmp-tip-name">gap</span>
                <span className="cmp-tip-val" style={{ color: tooltip.gapColor }}>
                  {tooltip.gap}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- model calc */

interface DeltaCard {
  key: string
  a: string
  b: string
  delta: string
  tone: 'a' | 'b' | 'neutral'
}
interface Readout {
  tag: string
  color: string
  text: string
}

function buildModel(
  series: ComparisonSeries,
  aName: string,
  bName: string,
  lo: number,
  hi: number,
  armyMode: ArmyMode
): {
  wt: number[]
  ecoA: number[]
  ecoB: number[]
  ecoTotalA: number
  ecoTotalB: number
  ecoYMax: number
  armyA: number[]
  armyB: number[]
  armyYMax: number
  cards: DeltaCard[]
  readouts: Readout[]
} {
  const times = series.times
  const wt = times.slice(lo, hi + 1)

  // `clip` windows a series: cumulative ones are rebased to the window start,
  // fluctuating levels are just sliced.
  const clip = (arr: number[], cumulative: boolean): number[] => {
    const base = cumulative ? (arr[lo] ?? 0) : 0
    return arr.slice(lo, hi + 1).map((v) => Math.max(0, v - base))
  }

  const ecoA = clip(series.economy[0], true)
  const ecoB = clip(series.economy[1], true)
  const ecoTotalA = ecoA[ecoA.length - 1] ?? 0
  const ecoTotalB = ecoB[ecoB.length - 1] ?? 0
  const ecoYMax = niceMax(Math.max(ecoTotalA, ecoTotalB, 1))

  // `spent` is cumulative; `onField` is a fluctuating level. Both are estimates —
  // see series.caveat / comparison.ts.
  const chartFullA = armyMode === 'spent' ? series.spent[0] : series.onField[0]
  const chartFullB = armyMode === 'spent' ? series.spent[1] : series.onField[1]
  const armyA = clip(chartFullA, armyMode === 'spent')
  const armyB = clip(chartFullB, armyMode === 'spent')
  const armyYMax = niceMax(Math.max(...armyA, ...armyB, 1))

  // Delta cards always read the fluctuating "on field" view, whatever the toggle.
  const fieldA = clip(series.onField[0], false)
  const fieldB = clip(series.onField[1], false)
  const peakA = Math.max(...fieldA)
  const peakB = Math.max(...fieldB)
  const avgA = mean(fieldA)
  const avgB = mean(fieldB)
  const ratioA = peakA > 0 ? ecoTotalA / peakA : 0
  const ratioB = peakB > 0 ? ecoTotalB / peakB : 0

  const rampRel = (arr: number[]): number => {
    const thr = 0.2 * Math.max(...arr, 1)
    const i = arr.findIndex((v) => v >= thr)
    return i < 0 ? arr.length - 1 : i
  }
  const tRampA = wt[rampRel(fieldA)] ?? 0
  const tRampB = wt[rampRel(fieldB)] ?? 0

  const cards: DeltaCard[] = [
    delta('Economy total', fmtCompact(ecoTotalA), fmtCompact(ecoTotalB), ecoTotalA, ecoTotalB),
    delta('Peak on field', fmtCompact(peakA), fmtCompact(peakB), peakA, peakB),
    delta('Avg on field', fmtCompact(avgA), fmtCompact(avgB), avgA, avgB),
    delta('Eco ÷ on-field', ratioA.toFixed(1), ratioB.toFixed(1), ratioA, ratioB),
    {
      key: 'Investment ramp',
      a: mmss(tRampA),
      b: mmss(tRampB),
      delta: fmtGap(tRampB - tRampA),
      tone: tRampB < tRampA ? 'b' : tRampA < tRampB ? 'a' : 'neutral'
    }
  ]
  if (times[lo]! <= 1200 && times[hi]! >= 1200) {
    let gi = lo
    for (let i = lo; i <= hi; i++) {
      if (Math.abs(times[i]! - 1200) < Math.abs(times[gi]! - 1200)) gi = i
    }
    const v20A = series.onField[0][gi] ?? 0
    const v20B = series.onField[1][gi] ?? 0
    cards.push(delta('On field at 20:00', fmtCompact(v20A), fmtCompact(v20B), v20A, v20B))
  }

  // --- read-outs: template only, each renders when its threshold is crossed.
  const readouts: Readout[] = []
  const leadEco = ecoTotalA >= ecoTotalB ? aName : bName
  const trailEco = ecoTotalA >= ecoTotalB ? bName : aName
  const ecoPct =
    Math.max(ecoTotalA, ecoTotalB) > 0
      ? Math.abs(ecoTotalA - ecoTotalB) / Math.max(ecoTotalA, ecoTotalB)
      : 0
  if (ecoPct >= 0.08) {
    const openIdx = ecoA.findIndex(
      (v, i) => Math.abs(v - (ecoB[i] ?? 0)) >= 0.08 * Math.max(v, ecoB[i] ?? 0, 1)
    )
    const openAt = openIdx > 0 ? ` — the gap opens around ${mmss(wt[openIdx]!)}` : ''
    readouts.push({
      tag: 'Economy',
      color: LINE_A,
      text: `${leadEco} out-produces ${trailEco} by ${Math.round(ecoPct * 100)}% over this window${openAt}.`
    })
  }

  const aAhead = fieldA.filter((v, i) => v > (fieldB[i] ?? 0)).length / Math.max(1, fieldA.length)
  if (aAhead >= 0.6 || aAhead <= 0.4) {
    const holder = aAhead >= 0.6 ? aName : bName
    readouts.push({
      tag: 'On field',
      color: LINE_B,
      text: `${holder} keeps more value on the field for most of the window (estimated, all unit types).`
    })
  } else {
    readouts.push({
      tag: 'On field',
      color: LINE_B,
      text: `Value on the field trades back and forth across the window (estimated, all unit types).`
    })
  }

  const windowExcess = (arr: number[]): number => Math.max(0, (arr[hi] ?? 0) - (arr[lo] ?? 0))
  const excA = windowExcess(series.excess[0])
  const excB = windowExcess(series.excess[1])
  if (Math.abs(excA - excB) >= 2000) {
    const hiName = excA >= excB ? aName : bName
    const loName = excA >= excB ? bName : aName
    readouts.push({
      tag: 'Read',
      color: '#ffe14d',
      text: `${hiName} banked what ${loName} spent — ${fmtCompact(Math.max(excA, excB))} metal excess against ${fmtCompact(Math.min(excA, excB))}.`
    })
  }

  return {
    wt,
    ecoA,
    ecoB,
    ecoTotalA,
    ecoTotalB,
    ecoYMax,
    armyA,
    armyB,
    armyYMax,
    cards,
    readouts: readouts.slice(0, 3)
  }
}

function fallbackCards(
  a: PlayerMeta['stats'] | undefined,
  b: PlayerMeta['stats'] | undefined
): DeltaCard[] {
  const eco = (s: PlayerMeta['stats'] | undefined): number =>
    s ? s.metalProduced + s.energyProduced * ENERGY_WEIGHT : 0
  const ea = eco(a)
  const eb = eco(b)
  return [
    delta('Economy total', a ? fmtCompact(ea) : '—', b ? fmtCompact(eb) : '—', ea, eb),
    delta('Damage dealt', a ? fmtCompact(a.damageDealt) : '—', b ? fmtCompact(b.damageDealt) : '—', a?.damageDealt ?? 0, b?.damageDealt ?? 0),
    delta('Damage taken', a ? fmtCompact(a.damageReceived) : '—', b ? fmtCompact(b.damageReceived) : '—', a?.damageReceived ?? 0, b?.damageReceived ?? 0, true),
    delta('Units made', a ? String(a.unitsProduced) : '—', b ? String(b.unitsProduced) : '—', a?.unitsProduced ?? 0, b?.unitsProduced ?? 0),
    { key: 'Peak on field', a: '—', b: '—', delta: 'no time series', tone: 'neutral' },
    { key: 'Investment ramp', a: '—', b: '—', delta: 'no time series', tone: 'neutral' }
  ]
}

/* --------------------------------------------------------------- helpers */

function listPlayers(meta: ReplayMeta): DPlayer[] {
  const sides = teamColorNames(meta)
  const out: DPlayer[] = []
  meta.allyTeams.forEach((t, ti) => {
    for (const p of t.players) {
      if (p.isAi || p.name.trim().endsWith('AI')) continue
      out.push({
        name: p.name,
        allyIdx: ti,
        os: typeof p.skillOS === 'number' ? p.skillOS : null,
        faction: (p.faction ?? '').trim()[0]?.toUpperCase() ?? '·',
        side: sides[ti] ?? null,
        result: t.won === true ? 'win' : t.won === false ? 'loss' : 'undecided',
        meta: p
      })
    }
  })
  return out
}

function delta(
  key: string,
  a: string,
  b: string,
  av: number,
  bv: number,
  lowerBetter = false
): DeltaCard {
  let d = '—'
  if (bv !== 0) {
    const p = ((av - bv) / Math.abs(bv)) * 100
    d = `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(Math.round(p))}%`
  } else if (av !== 0) {
    d = '—'
  } else {
    d = '0%'
  }
  const leader = av === bv ? 'neutral' : (av > bv) !== lowerBetter ? 'a' : 'b'
  return { key, a, b, delta: d, tone: leader }
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
}

/** First player that isn't `name`, preferring `pref` when it qualifies. */
function otherThan(players: DPlayer[], name: string, pref: string): string {
  if (pref && pref !== name && players.some((p) => p.name === pref)) return pref
  return players.find((p) => p.name !== name)?.name ?? name
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const nrm = v / mag
  const step = nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 5 ? 5 : 10
  return step * mag
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function fmtGap(sec: number): string {
  const s = Math.round(Math.abs(sec))
  return `${sec < 0 ? '−' : sec > 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function signedCompact(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v))}`
}
