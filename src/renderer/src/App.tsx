import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClearDialog } from './ClearDialog'
import { DetailPane } from './DetailPane'
import { fmtDate, fmtDuration } from './format'
import type { ReplayListItem, ReplayMeta, Settings } from '../../shared/types'

type SortKey = 'date' | 'map' | 'duration'

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [items, setItems] = useState<ReplayListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReplayMeta | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const refresh = useCallback(async (f: string | null) => {
    if (!f) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      setItems(await window.api.listReplays(f))
    } finally {
      setLoading(false)
    }
  }, [])

  // Bootstrap: load settings, resolve a folder, start watching.
  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await window.api.getSettings()
      if (!active) return
      setSettings(s)
      let f = s.replaysFolder
      if (!f) f = await window.api.detectDefaultFolder()
      if (!active) return
      setFolder(f)
      await refresh(f)
      if (f) await window.api.startWatch(f)
    })()
    return () => {
      active = false
      void window.api.stopWatch()
    }
  }, [refresh])

  // Auto-refresh when the folder contents change.
  useEffect(() => window.api.onReplaysChanged(() => void refresh(folder)), [folder, refresh])

  // Load detail for the selected replay.
  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetail(null)
    window.api
      .getReplayDetail(selected)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, settings?.onlineEnrich])

  const flashToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 4000)
  }

  const changeFolder = async (): Promise<void> => {
    const f = await window.api.pickFolder()
    if (!f) return
    setFolder(f)
    setSelected(null)
    await refresh(f)
    await window.api.startWatch(f)
  }

  const patchSettings = async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await window.api.setSettings(patch))
  }

  const selectedItem = useMemo(
    () => items.find((i) => i.filePath === selected) ?? null,
    [items, selected]
  )

  const toggleFavourite = async (filePath: string): Promise<void> => {
    await window.api.toggleFavourite(filePath)
    await refresh(folder)
  }

  const saveFavourite = async (data: { note: string; tags: string[] }): Promise<void> => {
    if (!selected) return
    await window.api.updateFavourite(selected, data)
    await refresh(folder)
  }

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) for (const t of i.tags) set.add(t)
    return [...set].sort()
  }, [items])

  const filtered = useMemo(() => {
    let out = items
    if (favOnly) out = out.filter((i) => i.isFavourite)
    if (tagFilter) out = out.filter((i) => i.tags.includes(tagFilter))
    const q = query.trim().toLowerCase()
    if (q) {
      out = out.filter(
        (i) =>
          i.mapName.toLowerCase().includes(q) ||
          i.fileName.toLowerCase().includes(q) ||
          i.playerNames.some((n) => n.toLowerCase().includes(q))
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      if (sortKey === 'map') return dir * a.mapName.localeCompare(b.mapName)
      if (sortKey === 'duration') return dir * ((a.durationMs ?? 0) - (b.durationMs ?? 0))
      return dir * (a.startTime ?? '').localeCompare(b.startTime ?? '')
    })
  }, [items, favOnly, tagFilter, query, sortKey, sortDir])

  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'map' ? 'asc' : 'desc')
    }
  }
  const sortArrow = (key: SortKey): string =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="folder">
          <span className="label">Replays folder</span>
          <span className="path" title={folder ?? ''}>
            {folder ?? 'No folder selected'}
          </span>
          <button onClick={changeFolder}>Change…</button>
        </div>
        <div className="topbar-right">
          <label title="Also fetch OpenSkill ratings / win-loss from bar-rts.com">
            <input
              type="checkbox"
              checked={settings?.onlineEnrich ?? false}
              onChange={(e) => patchSettings({ onlineEnrich: e.target.checked })}
            />
            Online enrich
          </label>
          <button
            className="danger"
            disabled={!folder || items.length === 0}
            onClick={() => setShowClear(true)}
          >
            Clear non-favourites
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <input
            className="search"
            placeholder="Search map / player / file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={favOnly}
              onChange={(e) => setFavOnly(e.target.checked)}
            />
            Favourites only
          </label>
          <label className="field">
            Tag
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">All</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="counts">
            {loading ? 'Loading…' : `${filtered.length} / ${items.length} replays`}
          </div>
        </aside>

        <main className="list">
          <div className="list-head">
            <button className="col-star" />
            <button className="col-date" onClick={() => toggleSort('date')}>
              Date{sortArrow('date')}
            </button>
            <button className="col-map" onClick={() => toggleSort('map')}>
              Map{sortArrow('map')}
            </button>
            <button className="col-dur" onClick={() => toggleSort('duration')}>
              Duration{sortArrow('duration')}
            </button>
            <span className="col-players">Players</span>
          </div>
          <div className="list-rows">
            {filtered.map((item) => (
              <div
                key={item.filePath}
                className={`row ${selected === item.filePath ? 'sel' : ''}`}
                onClick={() => setSelected(item.filePath)}
              >
                <button
                  className={`col-star star ${item.isFavourite ? 'on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleFavourite(item.filePath)
                  }}
                >
                  {item.isFavourite ? '★' : '☆'}
                </button>
                <span className="col-date">{fmtDate(item.startTime)}</span>
                <span className="col-map" title={item.fileName}>
                  {item.mapName}
                </span>
                <span className="col-dur">{fmtDuration(item.durationMs)}</span>
                <span className="col-players">
                  {item.playerCount ?? '—'}
                  {item.playerNames.length > 0 && (
                    <span className="players-preview">
                      {' '}
                      {item.playerNames.slice(0, 4).join(', ')}
                      {item.playerNames.length > 4 ? '…' : ''}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {!loading && filtered.length === 0 && (
              <div className="empty-rows">
                {folder ? 'No replays match the current filters.' : 'Choose your replays folder to begin.'}
              </div>
            )}
          </div>
        </main>

        <section className="detail-wrap">
          <DetailPane
            meta={detail}
            loading={detailLoading}
            listItem={selectedItem}
            spoilResults={settings?.spoilResults ?? false}
            onToggleSpoil={(v) => patchSettings({ spoilResults: v })}
            onToggleFavourite={() => selected && void toggleFavourite(selected)}
            onSaveFavourite={(d) => void saveFavourite(d)}
            onOpenInFolder={() => selected && void window.api.openInFolder(selected)}
          />
        </section>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {showClear && folder && (
        <ClearDialog
          folder={folder}
          onClose={() => setShowClear(false)}
          onDone={(result) => {
            setShowClear(false)
            setSelected(null)
            void refresh(folder)
            const failed = result.failed.length
            flashToast(
              `Moved ${result.movedCount} replay${result.movedCount === 1 ? '' : 's'} to the Recycle Bin` +
                (failed ? ` — ${failed} could not be moved` : '')
            )
          }}
        />
      )}
    </div>
  )
}
