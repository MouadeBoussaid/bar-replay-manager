import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AnalyticsScope,
  BackfillProgress,
  PlayerReport,
  ReportBar,
  ReportStartMap
} from '../../shared/types'
import { CURRENT_SEASON, SEASONS, seasonScope } from '../../shared/seasons'
import { fmtClock, fmtCompact } from './format'
import { rankPlayerNames } from './nameMatch'
import { useMapImage } from './useMapImage'

interface Props {
  /** Player whose all-replays profile to show. Empty = show the picker. */
  playerName: string
  onSetPlayer: (name: string) => void
  /** Jump to a replay in the list view. */
  onOpenReplay: (filePath: string) => void
  /** Optional one-click suggestion for the empty state (e.g. the perspective player). */
  suggestedPlayer?: string
}

const SCOPES: [AnalyticsScope, string][] = [
  ...SEASONS.map((s): [AnalyticsScope, string] => [seasonScope(s.id), s.label]),
  ['all', 'All time'],
  ['last50', 'Last 50 games']
]
const DEFAULT_SCOPE: AnalyticsScope = seasonScope(CURRENT_SEASON.id)

export function AnalyticsView({
  playerName,
  onSetPlayer,
  onOpenReplay,
  suggestedPlayer
}: Props): JSX.Element {
  const [scope, setScope] = useState<AnalyticsScope>(DEFAULT_SCOPE)
  const [report, setReport] = useState<PlayerReport | null | 'loading'>(
    playerName ? 'loading' : null
  )
  const [names, setNames] = useState<string[]>([])
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null)

  useEffect(() => {
    window.api.getIndexedPlayerNames().then(setNames).catch(() => setNames([]))
  }, [])

  useEffect(() => window.api.onAnalyticsBackfill(setBackfill), [])

  useEffect(() => {
    if (!playerName.trim()) {
      setReport(null)
      return
    }
    let cancelled = false
    setReport('loading')
    window.api
      .getPlayerReport(playerName, scope)
      .then((r) => !cancelled && setReport(r))
      .catch(() => !cancelled && setReport(null))
    return () => {
      cancelled = true
    }
  }, [playerName, scope])

  // Silently swap in a fresh report each time the background backfill rebuilds
  // the index — no skeleton flash.
  const rev = backfill?.indexRev ?? 0
  const prevRev = useRef(0)
  useEffect(() => {
    if (rev === prevRev.current) return
    prevRev.current = rev
    if (!playerName.trim()) return
    let cancelled = false
    window.api
      .getPlayerReport(playerName, scope)
      .then((r) => !cancelled && r.found && setReport(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [rev, playerName, scope])

  const suggestions = suggestedPlayer ? [suggestedPlayer] : []
  if (!playerName.trim()) {
    return (
      <EmptyState
        suggested={suggestions}
        names={names}
        onSetPlayer={onSetPlayer}
        notFound={false}
        query=""
      />
    )
  }
  if (report === null || (report !== 'loading' && !report.found)) {
    return (
      <EmptyState
        suggested={suggestions}
        names={names}
        onSetPlayer={onSetPlayer}
        notFound={report !== null}
        query={playerName}
      />
    )
  }

  return (
    <div className="analytics-tab">
      <Header
        report={report}
        playerName={playerName}
        names={names}
        scope={scope}
        onScope={setScope}
        onSetPlayer={onSetPlayer}
      />

      {backfill?.active && (
        <div className="an-sync">
          <span className="an-sync-dot" />
          Syncing bar-rts data — {backfill.done.toLocaleString()} / {backfill.total.toLocaleString()}{' '}
          games. Faction, start positions and roles fill in as this runs; the page refreshes
          itself.
        </div>
      )}

      {report === 'loading' ? (
        <SkeletonBlocks />
      ) : report.thinSample ? (
        <>
          <p className="an-thin">
            Only {report.totalGames} game{report.totalGames === 1 ? '' : 's'} indexed for this
            player — not enough for a reliable profile.
          </p>
          <AveragesGrid report={report} />
          <Appearances report={report} onOpenReplay={onOpenReplay} />
        </>
      ) : (
        <>
          <AveragesGrid report={report} />
          <FormOverTime report={report} onOpenReplay={onOpenReplay} />
          <BreakdownRow report={report} />
          <StartHeatCard report={report} />
          <MapsCompanyRow report={report} />
          <Appearances report={report} onOpenReplay={onOpenReplay} />
        </>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- header */

function Header({
  report,
  playerName,
  names,
  scope,
  onScope,
  onSetPlayer
}: {
  report: PlayerReport | 'loading'
  playerName: string
  names: string[]
  scope: AnalyticsScope
  onScope: (s: AnalyticsScope) => void
  onSetPlayer: (n: string) => void
}): JSX.Element {
  const r = report === 'loading' ? null : report
  const meta =
    r && r.found
      ? [
          `${r.totalGames.toLocaleString()} replays`,
          `${r.wins} W – ${r.losses} L`,
          r.winRate != null ? `${(r.winRate * 100).toFixed(1)}%` : '—',
          `first seen ${fmtDay(r.firstSeen)}`,
          `last seen ${fmtDay(r.lastSeen)}`
        ].join(' · ')
      : report === 'loading'
        ? 'Aggregating…'
        : ''

  return (
    <div className="an-header">
      <div className="an-initial">{(playerName[0] ?? '?').toUpperCase()}</div>
      <div className="an-head-main">
        <div className="an-head-name-row">
          <span className="an-name">{playerName}</span>
          {r?.os != null && (
            <span
              className="an-os-chip"
              title="OpenSkill rating from the player’s most recent rated game. Higher is stronger; the ladder average sits around 20–30."
            >
              {r.os.toFixed(1)} OS
            </span>
          )}
        </div>
        <div
          className="an-meta-line"
          title="Indexed replays this player appears in · wins–losses · win rate (undecided games excluded) · first and last game seen. Scoped by the selector on the right."
        >
          {meta}
        </div>
      </div>
      <div className="an-head-right">
        <PlayerSearch value={playerName} names={names} onPick={onSetPlayer} />
        <div title="Limit every panel below to this window of the player’s games.">
          <Segmented
            value={scope}
            onChange={(v) => onScope(v as AnalyticsScope)}
            options={SCOPES}
          />
        </div>
      </div>
    </div>
  )
}

function PlayerSearch({
  value,
  names,
  onPick
}: {
  value: string
  names: string[]
  onPick: (n: string) => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => rankPlayerNames(names, q, 10), [q, names])

  return (
    <div className="an-search">
      <span className="an-search-icon">⌕</span>
      <input
        value={q || value}
        placeholder="Player…"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQ('')
          setOpen(true)
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {value && (
        <button
          className="an-search-clear"
          title="Clear"
          onMouseDown={(e) => {
            e.preventDefault()
            onPick('')
            setQ('')
          }}
        >
          ✕
        </button>
      )}
      {open && matches.length > 0 && (
        <div className="an-search-pop">
          {matches.map((n) => (
            <button
              key={n}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(n)
                setQ('')
                setOpen(false)
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- averages */

/** Plain-language meaning of each averages-grid metric, keyed by METRICS[].key. */
const METRIC_HELP: Record<string, string> = {
  metal: 'Average total metal your team produced in a game — your raw economy output. Higher is better.',
  energy: 'Average total energy your team produced in a game. Higher is better.',
  mexcess:
    'Average metal wasted while your storage sat full (over-production you never spent). Lower is better.',
  dmg: 'Average total damage your team dealt in a game. Higher is better.',
  dmgt: 'Average total damage your team took in a game. Lower is better.',
  eff: 'Damage dealt ÷ damage taken, averaged per game. Over 100% means you out-trade your opponents. Higher is better.',
  units: 'Average number of units your team produced in a game. Higher is better.',
  cmd: 'Engine command count per game-minute — a rough stand-in for APM, not the same as BAR’s in-game APM figure.'
}

const BASELINE_HELP =
  'Your average compared with the mean across every player in every indexed replay (the “baseline”). ' +
  'Green means better for this metric, red means worse. Shown as a percent — or percentage points (pt) for Efficiency.'

/** Meaning of each "Form over time" metric, keyed by FORM_METRICS[].key. */
const FORM_METRIC_HELP: Record<string, string> = {
  metalPerMin: 'Metal produced ÷ game length (minutes) — economy pace, comparable across games of any length.',
  energyPerMin: 'Energy produced ÷ game length (minutes).',
  damageDealt: 'Total damage dealt in the game.',
  damageTaken: 'Total damage taken in the game.',
  efficiency: 'Damage dealt ÷ damage taken × 100. Over 100% means you out-traded the enemy that game.',
  cmdPerMin: 'Engine commands per game-minute — a rough APM proxy.',
  unitsMade: 'Units produced in the game.',
  os: 'Your OpenSkill rating at that game.'
}

function AveragesGrid({ report }: { report: PlayerReport }): JSX.Element {
  return (
    <div className="an-avgs">
      {report.averages.map((a) => (
        <div className="an-avg" key={a.key} title={METRIC_HELP[a.key] ?? a.label}>
          <div className="an-kicker">{a.label}</div>
          <div className="an-avg-val">{a.value}</div>
          <div className="an-avg-delta" title={BASELINE_HELP}>
            <span className={deltaClass(a.good, report.thinSample)}>{a.delta ?? '—'}</span>
            <span className="an-avg-vs">vs baseline</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------- form over time */

function FormOverTime({
  report,
  onOpenReplay
}: {
  report: PlayerReport
  onOpenReplay: (f: string) => void
}): JSX.Element {
  const [metric, setMetric] = useState(report.form.metrics[0]?.key ?? 'metalPerMin')
  const [mode, setMode] = useState<'game' | 'roll'>('game')
  const [hover, setHover] = useState<number | null>(null)

  const games = report.form.games
  const series = games.map((g) => g.values[metric] ?? null)
  const rolled = rolling(series, 10)
  const max = Math.max(1, ...series.filter((v): v is number => v != null), ...rolled.filter((v): v is number => v != null))
  const n = games.length
  const W = 640
  const Hh = 180
  const x = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const y = (v: number): number => Hh - (v / max) * Hh
  const line = (arr: (number | null)[]): string => {
    let d = ''
    let pen = false
    arr.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }

  const shown = mode === 'roll' ? rolled : series
  const yTicks = [max, max * 0.75, max * 0.5, max * 0.25, 0]

  return (
    <div className="an-card an-form">
      <div className="an-card-head">
        <span
          className="an-section-title"
          title="The chosen stat game-by-game across the player’s most recent games, oldest on the left. The strip under the chart marks win / loss; click a point or tick to open that replay."
        >
          Form over time
        </span>
        <span className="an-sub">last {n} games</span>
        <div className="an-spacer" />
        <select
          className="sort-select"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          title={FORM_METRIC_HELP[metric] ?? 'Which per-game stat to plot.'}
        >
          {report.form.metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <div title="Per game: the raw value each game. Rolling 10: a trailing average over the last 10 games, which smooths out single-game swings.">
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'game' | 'roll')}
            options={[
              ['game', 'Per game'],
              ['roll', 'Rolling 10']
            ]}
          />
        </div>
      </div>

      <div className="an-form-body">
        <div className="an-form-yaxis">
          {yTicks.map((t, i) => (
            <span key={i}>{fmtCompact(t)}</span>
          ))}
        </div>
        <div className="an-form-plot">
          <svg
            viewBox={`0 0 ${W} ${Hh}`}
            preserveAspectRatio="none"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))
              setHover(Math.max(0, Math.min(n - 1, i)))
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover != null && games[hover] && onOpenReplay(games[hover]!.filePath)}
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={Hh * f}
                y2={Hh * f}
                className="an-grid"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {mode === 'game' && (
              <path
                d={`${line(series)} L${x(n - 1)},${Hh} L0,${Hh} Z`}
                fill="rgba(255,225,77,.08)"
                stroke="none"
              />
            )}
            <path
              d={line(series)}
              fill="none"
              stroke="rgba(255,225,77,.55)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line(rolled)}
              fill="none"
              stroke="#ffe14d"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {hover != null && shown[hover] != null && (
              <circle cx={x(hover)} cy={y(shown[hover]!)} r={3} fill="#ffe14d" />
            )}
          </svg>

          <div className="an-form-strip">
            {games.map((g, i) => (
              <div
                key={i}
                className={`an-wl ${g.result === 'win' ? 'an-wl-w' : g.result === 'loss' ? 'an-wl-l' : 'an-wl-u'}`}
                onMouseEnter={() => setHover(i)}
                onClick={() => onOpenReplay(g.filePath)}
              />
            ))}
          </div>

          <div className="an-form-foot">
            <span>← {fmtDay(games[0]?.date ?? null)}</span>
            <span className="an-spacer" />
            <span className="an-wl-key">
              <span className="an-wl an-wl-w" /> win
            </span>
            <span className="an-wl-key">
              <span className="an-wl an-wl-l" /> loss
            </span>
            <span className="an-spacer" />
            <span>{fmtDay(games[n - 1]?.date ?? null)} →</span>
          </div>

          {hover != null && games[hover] && (
            <div className="an-form-tip">
              {games[hover]!.map} · {fmtDay(games[hover]!.date)} ·{' '}
              {games[hover]!.result} ·{' '}
              {shown[hover] != null ? fmtCompact(shown[hover]!) : '—'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- breakdown row */

function BreakdownRow({ report }: { report: PlayerReport }): JSX.Element {
  return (
    <div className="an-breakdown">
      <BarCard
        title="Faction"
        titleHelp="How often you played each faction, from games where the in-game pick is confirmed via bar-rts. “g” = games; the right-hand figure is your win rate on that faction; bar width is share of games."
        bars={report.factions}
        thin={report.thinSample}
        accent
        footNote={factionNote(report)}
      />
      <DurationCard report={report} />
    </div>
  )
}

function factionNote(report: PlayerReport): string | undefined {
  const { factionConfirmed: n, totalGames: total } = report
  if (n === 0) {
    return 'In-game faction isn’t in local replay files — turn on Online lookup and open replays to confirm it.'
  }
  if (n < total) {
    return `From ${n.toLocaleString()} of ${total.toLocaleString()} games with a confirmed in-game faction.`
  }
  return undefined
}

function BarCard({
  title,
  titleHelp,
  bars,
  thin,
  accent,
  footNote
}: {
  title: string
  titleHelp?: string
  bars: ReportBar[]
  thin: boolean
  accent?: boolean
  footNote?: string
}): JSX.Element {
  return (
    <div className="an-card">
      <div className="an-section-title" title={titleHelp}>
        {title}
      </div>
      <div className="an-bars">
        {bars.map((b) => (
          <div
            key={b.label}
            className="an-bar-row"
            title={`${b.label}: ${b.games} game${b.games === 1 ? '' : 's'} · ${fmtWr(b.winRate)} win rate`}
          >
            <div className="an-bar-line">
              {b.letter && (
                <span className="an-bar-letter" style={{ color: b.color }}>
                  {b.letter}
                </span>
              )}
              <span className="an-bar-label">{b.label}</span>
              <span className="an-spacer" />
              <span className="an-bar-games">{b.games} g</span>
              <span className={`an-bar-wr ${wrClass(b.winRate, thin)}`}>{fmtWr(b.winRate)}</span>
            </div>
            <div className="an-bar-track">
              <div
                className="an-bar-fill"
                style={{
                  width: `${Math.round(b.share * 100)}%`,
                  background: accent ? b.color : '#ffe14d'
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {footNote && <div className="an-foot-note">{footNote}</div>}
    </div>
  )
}

function DurationCard({ report }: { report: PlayerReport }): JSX.Element {
  return (
    <div className="an-card">
      <div
        className="an-section-title"
        title="Your win rate split by how long the game lasted. Bar height = win rate; the count under each bucket is how many games fell in it."
      >
        Win rate by length
      </div>
      <div className="an-dur">
        {report.durations.map((d) => (
          <div
            key={d.label}
            className="an-dur-col"
            title={`${d.label}: ${d.games} game${d.games === 1 ? '' : 's'} · ${fmtWr(d.winRate)} win rate`}
          >
            <span className={`an-dur-wr ${wrClass(d.winRate, report.thinSample)}`}>
              {fmtWr(d.winRate)}
            </span>
            <div className="an-dur-track">
              <div
                className={`an-dur-fill ${wrClass(d.winRate, report.thinSample)}`}
                style={{ height: `${Math.round((d.winRate ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="an-dur-labels">
        {report.durations.map((d) => (
          <div key={d.label}>
            <div className="an-dur-name">{d.label}</div>
            <div className="an-dur-games">{d.games} g</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StartHeatCard({ report }: { report: PlayerReport }): JSX.Element {
  const noteNoData =
    report.startNoData > 0
      ? `${report.startNoData} game${report.startNoData === 1 ? '' : 's'} without a start position`
      : ''

  if (report.startMaps.length === 0) {
    return (
      <div className="an-card">
        <div className="an-card-head">
          <span className="an-section-title">Start positions</span>
          <span className="an-sub">by map</span>
        </div>
        <div className="an-empty-line">
          No per-map start data yet. Positions come from bar-rts.com records, cached when you
          open a replay with online enrichment on — browse a few and they fill in here.
          {noteNoData && ` (${noteNoData})`}
        </div>
      </div>
    )
  }

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span
          className="an-section-title"
          title="Where you deploy on each of your most-played maps, from the bar-rts start positions. Spots are your own deploy points clustered together and ranked by use — spot 1 is where you go most on that map. Mirror positions are counted as one. Labels are the community name for that spot, or BAR’s role (air / front / tech / sea) when it has no name. Everything is compared within one map only."
        >
          Start positions
        </span>
        <span className="an-sub">where you deploy — each map compared only against its own spots</span>
      </div>
      <div className="an-startmap-list">
        {report.startMaps.map((m) => (
          <StartMapRow key={m.name} map={m} thin={report.thinSample} />
        ))}
      </div>
      {noteNoData && <div className="an-foot-note">{noteNoData} — not shown</div>}
    </div>
  )
}

function StartMapRow({ map, thin }: { map: ReportStartMap; thin: boolean }): JSX.Element {
  const photo = useMapImage(map.scriptName, 'thumb')
  const maxGames = Math.max(1, ...map.spots.map((s) => s.games))
  const spotLabel = (s: ReportStartMap['spots'][number], i: number): string =>
    s.name ?? s.role ?? `Spot ${i + 1}`
  // Minimap tag: community name, else the BAR role; a bare number only when
  // neither exists.
  const tagText = (s: ReportStartMap['spots'][number]): string | null => s.name ?? s.role ?? null

  // Where two tags land on the same place (mirror positions that carry different
  // labels) stack them vertically instead of overprinting.
  const tagBump = new Map<number, number>()
  const tagAt: { x: number; y: number; level: number }[] = []
  map.spots.forEach((s, i) => {
    if (!tagText(s)) return
    let level = 0
    while (tagAt.some((t) => t.level === level && Math.hypot(t.x - s.x, t.y - s.y) < 0.06)) level++
    tagAt.push({ x: s.x, y: s.y, level })
    if (level > 0) tagBump.set(i, level)
  })

  return (
    <div className="an-startmap-row">
      <div className="an-startmap-frame">
        {photo ? (
          <img src={photo} alt="" className="an-startmap-img" />
        ) : (
          <div className="an-startmap-img an-startmap-noimg" />
        )}
        {map.spots.map((s, i) => {
          const size = 15 + Math.round((s.games / maxGames) * 26)
          const flip = s.x > 0.62
          return (
            <span
              key={i}
              className={`an-startdot ${wrClass(s.winRate, thin)}`}
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: size, height: size }}
              title={`${spotLabel(s, i)} · ${s.games} game${s.games === 1 ? '' : 's'} · ${fmtWr(s.winRate)} win rate`}
            >
              <span className="an-startdot-n">{i + 1}</span>
              {tagText(s) && (
                <span
                  className={`an-startdot-tag${s.name ? '' : ' role'}${flip ? ' flip' : ''}`}
                  style={{ marginTop: (tagBump.get(i) ?? 0) * 15 }}
                >
                  {tagText(s)}
                </span>
              )}
            </span>
          )
        })}
      </div>

      <div className="an-startmap-side">
        <div className="an-startmap-cap">
          <span className="an-map-name">{map.name}</span>
          <span className="an-startmap-games">{map.games} g positioned</span>
        </div>
        <div className="an-startspots">
          {map.spots.map((s, i) => (
            <div
              key={i}
              className="an-startspot"
              title={`${spotLabel(s, i)} — ${s.games} of ${map.games} positioned games on ${map.name} (${Math.round(
                (s.games / map.games) * 100
              )}%) · ${fmtWr(s.winRate)} win rate from this spot`}
            >
              <span className="an-startspot-rank">{i + 1}</span>
              <span className="an-startspot-label">{spotLabel(s, i)}</span>
              <span className="an-spacer" />
              <span className="an-startspot-share">
                {Math.round((s.games / map.games) * 100)}%
              </span>
              <span className="an-startspot-games">{s.games} g</span>
              <span className="an-startspot-bar">
                <span
                  className={`an-startspot-fill ${wrClass(s.winRate, thin)}`}
                  style={{ width: `${Math.round((s.winRate ?? 0) * 100)}%` }}
                />
              </span>
              <span className={`an-startspot-wr ${wrClass(s.winRate, thin)}`}>
                {fmtWr(s.winRate)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- maps + company */

function MapsCompanyRow({ report }: { report: PlayerReport }): JSX.Element {
  return (
    <div className="an-maps-company">
      <div className="an-card">
        <div className="an-card-head">
          <span
            className="an-section-title"
            title="Your most-played maps (20+ games each). Bar and figure are your win rate on that map."
          >
            Maps
          </span>
          <span className="an-sub">most played · min 20 games</span>
        </div>
        <div className="an-map-rows">
          {report.maps.length === 0 && <div className="an-empty-line">No map with 20+ games yet.</div>}
          {report.maps.map((m, i) => (
            <div
              key={m.name}
              className={`an-map-row ${i % 2 ? 'an-zebra' : ''}`}
              title={`${m.name}: ${m.games} games · ${fmtWr(m.winRate)} win rate`}
            >
              <span className="an-map-thumb" />
              <span className="an-map-name">{m.name}</span>
              <span className="an-spacer" />
              <span className="an-map-bar">
                <span
                  className={`an-map-bar-fill ${wrClass(m.winRate, report.thinSample)}`}
                  style={{ width: `${Math.round((m.winRate ?? 0) * 100)}%` }}
                />
              </span>
              <span className="an-map-games">{m.games} g</span>
              <span className={`an-map-wr ${wrClass(m.winRate, report.thinSample)}`}>
                {fmtWr(m.winRate)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="an-card">
        <div className="an-card-head">
          <span
            className="an-section-title"
            title="Team-mates you’ve played alongside most, and opponents you’ve faced most (15+ shared games each). The figure is your win rate in those shared games — so “Allied with” near 50% is normal for a frequent duo; well above means you win together, and for “Against” it’s how often you beat them."
          >
            Company
          </span>
          <span className="an-sub">win rate with / against</span>
        </div>
        <div className="an-company">
          <CompanyCol title="Allied with" rows={report.company.withP} thin={report.thinSample} />
          <CompanyCol title="Against" rows={report.company.vsP} thin={report.thinSample} />
        </div>
      </div>
    </div>
  )
}

function CompanyCol({
  title,
  rows,
  thin
}: {
  title: string
  rows: PlayerReport['company']['withP']
  thin: boolean
}): JSX.Element {
  return (
    <div>
      <div className="an-kicker">{title}</div>
      <div className="an-company-rows">
        {rows.length === 0 && <div className="an-empty-line">No pairing with 15+ games.</div>}
        {rows.map((p) => (
          <div key={p.name} className="an-company-row" style={{ borderLeftColor: p.color }}>
            <span className="an-company-name">{p.name}</span>
            <span className="an-spacer" />
            <span className="an-company-games">{p.games} g</span>
            <span className={`an-company-wr ${wrClass(p.winRate, thin)}`}>{fmtWr(p.winRate)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- appearances */

function Appearances({
  report,
  onOpenReplay
}: {
  report: PlayerReport
  onOpenReplay: (f: string) => void
}): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all')
  const [limit, setLimit] = useState(10)
  const allRows = report.appearances.filter((a) =>
    filter === 'all' ? true : a.result === filter
  )
  const capped = limit < 25
  const rows = capped ? allRows.slice(0, limit) : allRows
  const avgEff =
    mean(report.appearances.map((a) => a.eff).filter((v): v is number => v != null)) || 0

  const changeFilter = (v: 'all' | 'win' | 'loss'): void => {
    setFilter(v)
    setLimit(10)
  }

  return (
    <div className="an-card an-appear">
      <div className="an-card-head">
        <span
          className="an-section-title"
          title="Every scoped game for this player, newest first. Metal / Dmg are that game’s team totals; Eff is damage dealt ÷ taken (green when at or above your own average, red below); Pos is the start-position role; CMD/min ≈ APM."
        >
          Appearances
        </span>
        <span className="an-sub">click a row to open that replay</span>
        <div className="an-spacer" />
        <Segmented
          value={filter}
          onChange={(v) => changeFilter(v as 'all' | 'win' | 'loss')}
          options={[
            ['all', 'All'],
            ['win', 'Wins'],
            ['loss', 'Losses']
          ]}
        />
      </div>
      <div className={`an-appear-scroll ${capped ? '' : 'an-appear-scroll-all'}`}>
        <div className="an-appear-grid an-appear-head">
          <span>Date</span>
          <span>Map</span>
          <span title="Team format — ally-team sizes, e.g. 8v8.">Fmt</span>
          <span title="BAR team colour of your side (blue / red).">Side</span>
          <span title="Faction — first letter (A / C / L). Confirmed from bar-rts where available, else the lobby default.">
            Fac
          </span>
          <span title="Start-position role for that game: air / front / tech / sea (from BAR map metadata), or — when unknown.">
            Pos
          </span>
          <span>Result</span>
          <span className="r">Length</span>
          <span className="r" title="Total metal your team produced that game.">
            Metal
          </span>
          <span className="r" title="Total damage your team dealt that game.">
            Dmg
          </span>
          <span className="r" title="Damage dealt ÷ damage taken. Green ≥ your own average across all games, red below.">
            Eff
          </span>
          <span className="r" title="Engine commands per game-minute — a rough APM proxy.">
            CMD/min
          </span>
        </div>
        {rows.map((a, i) => (
          <div
            key={a.filePath + i}
            className={`an-appear-grid an-appear-row ${i % 2 ? 'an-zebra' : ''}`}
            onClick={() => onOpenReplay(a.filePath)}
          >
            <span className="mono dim">{fmtDay(a.date)}</span>
            <span className="an-map-name">{a.map}</span>
            <span className="mono dim">{a.fmt}</span>
            <span
              className="an-side"
              style={{ color: a.side === 'red' ? '#e2504a' : a.side === 'blue' ? '#5b9cd6' : undefined }}
            >
              {a.side ? a.side.toUpperCase() : '—'}
            </span>
            <span className="an-fac">{a.faction[0] ?? '·'}</span>
            <span className="an-pos mono dim">{a.role ?? '—'}</span>
            <span
              className={`an-res ${a.result === 'win' ? 'an-res-w' : a.result === 'loss' ? 'an-res-l' : ''}`}
            >
              {a.result === 'win' ? 'Victory' : a.result === 'loss' ? 'Defeat' : '—'}
            </span>
            <span className="r mono dim">{fmtClock(a.durationMs)}</span>
            <span className="r mono">{a.metal == null ? '—' : fmtCompact(a.metal)}</span>
            <span className="r mono">{a.dmg == null ? '—' : fmtCompact(a.dmg)}</span>
            <span
              className="r mono"
              style={{ color: a.eff == null ? undefined : a.eff >= avgEff ? '#8fd870' : '#e2726c' }}
            >
              {a.eff == null ? '—' : `${a.eff}%`}
            </span>
            <span className="r mono dim">{a.cmd == null ? '—' : Math.round(a.cmd)}</span>
          </div>
        ))}
      </div>
      <div className="an-appear-foot">
        <span>
          showing {rows.length} of {allRows.length} · aggregates from locally indexed replays
          only. CMD/min ≈ APM (engine command count over game time).
        </span>
        {capped && allRows.length > rows.length && (
          <button className="an-load-more" onClick={() => setLimit(25)}>
            Load {Math.min(15, allRows.length - rows.length)} more
          </button>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- states */

function EmptyState({
  suggested,
  names,
  onSetPlayer,
  notFound,
  query
}: {
  suggested: string[]
  names: string[]
  onSetPlayer: (n: string) => void
  notFound: boolean
  query: string
}): JSX.Element {
  return (
    <div className="analytics-tab an-empty">
      <div className="an-empty-inner">
        <PlayerSearch value="" names={names} onPick={onSetPlayer} />
        <p className="an-empty-help">
          {notFound
            ? `No indexed replays for “${query.trim()}”.`
            : 'Look up a player to see their performance across every indexed replay.'}
        </p>
        {suggested.length > 0 && (
          <div className="an-empty-picks">
            {suggested.map((n) => (
              <button key={n} onClick={() => onSetPlayer(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SkeletonBlocks(): JSX.Element {
  return (
    <div className="an-skeleton">
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="an-skel-card" key={i} />
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- shared */

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
        <button key={v} className={value === v ? 'seg-on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function rolling(arr: (number | null)[], w: number): (number | null)[] {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null)
    return slice.length ? slice.reduce((s, n) => s + n, 0) / slice.length : null
  })
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}

function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .toLowerCase()
}

function fmtWr(wr: number | null): string {
  return wr == null ? '—' : `${Math.round(wr * 100)}%`
}

function wrClass(wr: number | null, thin: boolean): string {
  if (thin || wr == null) return 'wr-neutral'
  if (wr >= 0.54) return 'wr-good'
  if (wr <= 0.46) return 'wr-bad'
  return 'wr-neutral'
}

function deltaClass(good: boolean | null, thin: boolean): string {
  if (thin || good == null) return 'an-delta-neutral'
  return good ? 'an-delta-good' : 'an-delta-bad'
}
