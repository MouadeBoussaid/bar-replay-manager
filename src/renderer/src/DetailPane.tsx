import { useEffect, useState } from 'react'
import type { ReplayListItem, ReplayMeta, Settings } from '../../shared/types'
import { DetailsTab } from './DetailsTab'
import { GraphsTab } from './GraphsTab'
import { OverviewTab } from './OverviewTab'
import { StatsTab } from './StatsTab'
import { fmtClock, fmtHeroDateTime, fmtTeamFormat } from './format'
import { useMapImage } from './useMapImage'

interface Props {
  meta: ReplayMeta | null
  loading: boolean
  listItem: ReplayListItem | null
  settings: Settings | null
  launchError: string | null
  playState: 'idle' | 'launching' | 'ok'
  onPlay: (filePath: string) => void
  onDismissLaunchError: () => void
  onToggleSetting: (patch: Partial<Settings>) => void
  onToggleFavourite: () => void
  onSaveFavourite: (data: { note: string; tags: string[] }) => void
  onOpenInFolder: () => void
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stats', label: 'Stats' },
  { id: 'graphs', label: 'Graphs' },
  { id: 'details', label: 'Details' }
] as const
type TabId = (typeof TABS)[number]['id']

export function DetailPane(props: Props): JSX.Element {
  const {
    meta,
    loading,
    listItem,
    settings,
    launchError,
    playState,
    onPlay,
    onDismissLaunchError,
    onToggleSetting,
    onToggleFavourite,
    onSaveFavourite,
    onOpenInFolder
  } = props

  const [tab, setTab] = useState<TabId>('overview')
  useEffect(() => setTab('overview'), [listItem?.filePath])

  const mapName = meta?.map.name ?? listItem?.mapName ?? null
  const heroPhoto = useMapImage(mapName, 'mq')

  if (!listItem || !mapName) {
    return (
      <section className="detail-pane">
        <div className="detail-empty">Select a replay</div>
      </section>
    )
  }
  const { title: mapTitle, version: mapVersion } = splitMapVersion(mapName)
  const teamFormat = meta
    ? fmtTeamFormat(meta.allyTeams.map((t) => t.players.length))
    : fmtTeamFormat(listItem.teamSizes)
  const parseFailed = !!meta?.parseError

  return (
    <section className="detail-pane">
      <div className="hero">
        {heroPhoto && (
          <img
            className="hero-photo"
            src={heroPhoto}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
        <div className="hero-scrim" />
        <button
          className={`play-btn no-drag play-btn-${playState} ${
            launchError ? 'play-btn-error' : ''
          }`}
          disabled={playState === 'launching'}
          title={
            playState === 'launching'
              ? 'Starting Beyond All Reason…'
              : 'Launch this replay in Beyond All Reason'
          }
          onClick={() => onPlay(listItem.filePath)}
        >
          <span className="play-glyph" aria-hidden />
          {playState === 'launching'
            ? 'LAUNCHING…'
            : playState === 'ok'
              ? 'LAUNCHED ✓'
              : launchError
                ? 'RETRY'
                : 'PLAY REPLAY'}
        </button>

        <div className="hero-caption">
          <div className="hero-title">
            {parseFailed ? listItem.fileName : mapTitle}
            {!parseFailed && mapVersion && <span className="hero-version">{mapVersion}</span>}
          </div>
          <div className="hero-sub">
            {meta
              ? [
                  fmtHeroDateTime(meta.startTime),
                  fmtClock(meta.durationMs),
                  teamFormat,
                  meta.engineVersion ? `engine ${meta.engineVersion}` : null
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Loading…'}
          </div>
        </div>

        {launchError && (
          <div className="hero-error no-drag">
            <span>{launchError}</span>
            <button onClick={onDismissLaunchError} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className="tab-bar-spacer" />
        <label
          className="tab-toggle"
          title="Also look this game up on bar-rts.com for verified ratings, player colours, country flags and start positions. Adds one network request per replay."
        >
          <input
            type="checkbox"
            checked={settings?.onlineEnrich ?? false}
            onChange={(e) => onToggleSetting({ onlineEnrich: e.target.checked })}
          />
          Online lookup
        </label>
      </div>

      <div className="tab-panel">
        {parseFailed ? (
          <div className="parse-error-panel">
            <p className="parse-error-title">Could not parse this replay</p>
            <p className="parse-error-detail">{meta?.parseError}</p>
          </div>
        ) : loading && !meta ? (
          <div className="detail-loading">Loading replay…</div>
        ) : !meta ? null : tab === 'overview' ? (
          <OverviewTab meta={meta} listItem={listItem} onSaveFavourite={onSaveFavourite} />
        ) : tab === 'stats' ? (
          <StatsTab meta={meta} />
        ) : tab === 'graphs' ? (
          <GraphsTab meta={meta} />
        ) : (
          <DetailsTab
            meta={meta}
            listItem={listItem}
            onToggleFavourite={onToggleFavourite}
            onOpenInFolder={onOpenInFolder}
          />
        )}
      </div>
    </section>
  )
}

/** "All That Glitters v2.2.3" -> { title: "All That Glitters", version: "v2.2.3" } */
function splitMapVersion(name: string): { title: string; version: string } {
  const m = name.match(/^(.*?)[\s_]+(v?\d[\w.]*)$/i)
  if (m) return { title: m[1]!.trim(), version: m[2]! }
  return { title: name, version: '' }
}
