import { useEffect, useState } from 'react'
import type { ReplayListItem, ReplayMeta, Settings } from '../../shared/types'
import { DetailsTab } from './DetailsTab'
import { OverviewTab } from './OverviewTab'
import { fmtClock, fmtHeroDateTime, fmtTeamFormat } from './format'

interface Props {
  meta: ReplayMeta | null
  loading: boolean
  listItem: ReplayListItem | null
  settings: Settings | null
  installedEngines: string[]
  launchError: string | null
  onPlay: (filePath: string) => void
  onDismissLaunchError: () => void
  onToggleSetting: (patch: Partial<Settings>) => void
  onToggleFavourite: () => void
  onSaveFavourite: (data: { note: string; tags: string[] }) => void
  onOpenInFolder: () => void
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Details' }
] as const
type TabId = (typeof TABS)[number]['id']

export function DetailPane(props: Props): JSX.Element {
  const {
    meta,
    loading,
    listItem,
    settings,
    installedEngines,
    launchError,
    onPlay,
    onDismissLaunchError,
    onToggleSetting,
    onToggleFavourite,
    onSaveFavourite,
    onOpenInFolder
  } = props

  const [tab, setTab] = useState<TabId>('overview')
  useEffect(() => setTab('overview'), [listItem?.filePath])

  if (!listItem) {
    return (
      <section className="detail-pane">
        <div className="detail-empty">Select a replay</div>
      </section>
    )
  }

  const spoil = settings?.spoilResults ?? false
  const mapName = meta?.map.name ?? listItem.mapName
  const { title: mapTitle, version: mapVersion } = splitMapVersion(mapName)
  const teamFormat = meta
    ? fmtTeamFormat(meta.allyTeams.map((t) => t.players.length))
    : fmtTeamFormat(listItem.teamSizes)
  const engineOk = isEngineInstalled(meta?.engineVersion ?? listItem.engineTag ?? '', installedEngines)
  const parseFailed = !!meta?.parseError

  return (
    <section className="detail-pane">
      <div className="hero">
        <div className="hero-scrim" />
        <button
          className="play-btn no-drag"
          disabled={!engineOk}
          title={
            engineOk
              ? 'Launch this replay in Beyond All Reason'
              : `Engine build ${meta?.engineVersion || listItem.engineTag || '?'} is not installed`
          }
          onClick={() => onPlay(listItem.filePath)}
        >
          <span className="play-glyph" aria-hidden />
          PLAY REPLAY
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
        <label className="tab-toggle" title="Fetch OS ratings & stats from bar-rts.com">
          <input
            type="checkbox"
            checked={settings?.onlineEnrich ?? false}
            onChange={(e) => onToggleSetting({ onlineEnrich: e.target.checked })}
          />
          Online
        </label>
        <label className="tab-toggle" title="Reveal winners and result badges">
          <input
            type="checkbox"
            checked={spoil}
            onChange={(e) => onToggleSetting({ spoilResults: e.target.checked })}
          />
          Spoil
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
          <OverviewTab meta={meta} spoil={spoil} />
        ) : (
          <DetailsTab
            meta={meta}
            listItem={listItem}
            onToggleFavourite={onToggleFavourite}
            onSaveFavourite={onSaveFavourite}
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

function isEngineInstalled(tag: string, installed: string[]): boolean {
  if (installed.length === 0) return true
  const want = tag.trim().toLowerCase()
  if (!want) return true
  return installed.some((name) => {
    const have = name.toLowerCase()
    return have === want || have.startsWith(want) || want.startsWith(have)
  })
}
