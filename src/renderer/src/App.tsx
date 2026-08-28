import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClearDialog } from './ClearDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { DetailPane } from './DetailPane'
import { fmtGigabytes, osTierRank } from './format'
import { ReplayList, type SortKey } from './ReplayList'
import { TitleBar } from './TitleBar'
import type { ReplayListItem, ReplayMeta, Settings } from '../../shared/types'

const MIN_PANE = 320
const MAX_PANE = 520

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [items, setItems] = useState<ReplayListItem[]>([])
  const [firstLoad, setFirstLoad] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [lastScanAt, setLastScanAt] = useState<number | null>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReplayMeta | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [showClear, setShowClear] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ReplayListItem | null>(null)
  const [pendingDrawDelete, setPendingDrawDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [playState, setPlayState] = useState<'idle' | 'launching' | 'ok'>('idle')

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const [paneWidth, setPaneWidth] = useState(392)

  const prevCount = useRef<number | null>(null)

  const flashToast = useCallback((msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500)
  }, [])

  const scan = useCallback(
    async (f: string | null): Promise<void> => {
      if (!f) {
        setItems([])
        prevCount.current = null
        return
      }
      setScanning(true)
      try {
        const next = await window.api.listReplays(f)
        const before = prevCount.current
        if (before != null && next.length !== before) {
          const delta = next.length - before
          flashToast(
            delta > 0
              ? `${delta} new replay${delta === 1 ? '' : 's'}`
              : `${-delta} replay${delta === -1 ? '' : 's'} removed`
          )
        }
        prevCount.current = next.length
        setItems(next)
        setLastScanAt(Date.now())
        // Drop a selection whose file is gone (deleted here or externally).
        setSelected((cur) => (cur && next.some((i) => i.filePath === cur) ? cur : null))
      } finally {
        setScanning(false)
        setProgress(null)
        setFirstLoad(false)
      }
    },
    [flashToast]
  )

  // Bootstrap: settings -> folder -> first scan -> watch.
  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await window.api.getSettings()
      if (!active) return
      setSettings(s)
      setPaneWidth(clamp(s.listPaneWidth ?? 392))
      let f = s.replaysFolder
      if (!f) f = await window.api.detectDefaultFolder()
      if (!active) return
      setFolder(f)
      await scan(f)
      if (f) await window.api.startWatch(f)
    })()
    return () => {
      active = false
      void window.api.stopWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => window.api.onReplaysChanged(() => void scan(folder)), [folder, scan])
  useEffect(() => window.api.onScanProgress((p) => setProgress(p)), [])

  // Load detail for the selected replay.
  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetail(null)
    setLaunchError(null)
    setPlayState('idle')
    window.api
      .getReplayDetail(selected)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {
        // File may have been deleted between selection and fetch — ignore.
        if (!cancelled) setDetail(null)
      })
      .finally(() => !cancelled && setDetailLoading(false))
    return () => {
      cancelled = true
    }
  }, [selected, settings?.onlineEnrich])

  const patchSettings = async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await window.api.setSettings(patch))
  }

  const changeFolder = async (): Promise<void> => {
    const f = await window.api.pickFolder()
    if (!f) return
    setFolder(f)
    setSelected(null)
    setFirstLoad(true)
    prevCount.current = null
    await scan(f)
    await window.api.startWatch(f)
  }

  const toggleFavourite = async (filePath: string): Promise<void> => {
    await window.api.toggleFavourite(filePath)
    await scan(folder)
  }

  const saveFavourite = async (data: { note: string; tags: string[] }): Promise<void> => {
    if (!selected) return
    await window.api.updateFavourite(selected, data)
    await scan(folder)
  }

  const play = async (filePath: string): Promise<void> => {
    if (playState === 'launching') return
    setLaunchError(null)
    setPlayState('launching')
    try {
      const res = await window.api.playReplay(filePath)
      if (res.ok) {
        setPlayState('ok')
        window.setTimeout(() => setPlayState((s) => (s === 'ok' ? 'idle' : s)), 4000)
      } else {
        setPlayState('idle')
        setLaunchError(res.error ?? 'Beyond All Reason could not be launched.')
      }
    } catch (e) {
      setPlayState('idle')
      setLaunchError(e instanceof Error ? e.message : String(e))
    }
  }

  const confirmDeleteOne = async (): Promise<void> => {
    if (!pendingDelete) return
    const victim = pendingDelete
    setPendingDelete(null)
    try {
      await window.api.trashReplay(victim.filePath)
      if (selected === victim.filePath) setSelected(null)
      await scan(folder)
      flashToast(`Moved “${victim.mapName}” to the Recycle Bin`)
    } catch (e) {
      flashToast(`Could not delete: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const confirmDeleteDraws = async (): Promise<void> => {
    setPendingDrawDelete(false)
    const victims = drawItems.map((i) => i.filePath)
    if (victims.length === 0) return
    try {
      const { moved, failed } = await window.api.trashReplays(victims)
      if (selected && victims.includes(selected)) setSelected(null)
      await scan(folder)
      flashToast(
        `Moved ${moved} undecided game${moved === 1 ? '' : 's'} to the Recycle Bin` +
          (failed.length ? ` — ${failed.length} could not be moved` : '')
      )
    } catch (e) {
      flashToast(`Could not delete: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = items
    if (q) {
      out = items.filter(
        (i) =>
          i.mapName.toLowerCase().includes(q) ||
          i.fileName.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)) ||
          i.playerNames.some((n) => n.toLowerCase().includes(q))
      )
    }
    const by = [...out]
    by.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return (a.startTime ?? '').localeCompare(b.startTime ?? '')
        case 'duration':
          return (b.durationMs ?? 0) - (a.durationMs ?? 0)
        case 'map':
          return a.mapName.localeCompare(b.mapName)
        case 'avgos':
          return (b.avgOs ?? -1) - (a.avgOs ?? -1)
        case 'ostier':
          return (
            osTierRank(a.avgOs) - osTierRank(b.avgOs) ||
            (b.avgOs ?? -1) - (a.avgOs ?? -1)
          )
        case 'newest':
        default:
          return (b.startTime ?? '').localeCompare(a.startTime ?? '')
      }
    })
    return by
  }, [items, query, sort])

  const totalBytes = useMemo(() => items.reduce((s, i) => s + i.fileSize, 0), [items])
  const nonFavCount = useMemo(() => items.filter((i) => !i.isFavourite).length, [items])
  // Finished games with no recorded winner, favourites excluded.
  const drawItems = useMemo(
    () =>
      items.filter(
        (i) =>
          !i.isFavourite &&
          i.parsed &&
          i.endedNormally === true &&
          i.winnerTeamOrdinal == null
      ),
    [items]
  )

  const selectedItem = useMemo(
    () => items.find((i) => i.filePath === selected) ?? null,
    [items, selected]
  )

  // Keyboard navigation over the visible list.
  const onListKeyNav = useCallback(
    (dir: 'up' | 'down' | 'home' | 'end' | 'play' | 'delete') => {
      if (filtered.length === 0) return
      const idx = filtered.findIndex((i) => i.filePath === selected)
      if (dir === 'play') {
        if (selectedItem) void play(selectedItem.filePath)
        return
      }
      if (dir === 'delete') {
        if (selectedItem) setPendingDelete(selectedItem)
        return
      }
      let next = idx
      if (dir === 'up') next = idx <= 0 ? 0 : idx - 1
      if (dir === 'down') next = idx < 0 ? 0 : Math.min(filtered.length - 1, idx + 1)
      if (dir === 'home') next = 0
      if (dir === 'end') next = filtered.length - 1
      const target = filtered[next]
      if (target) setSelected(target.filePath)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selected, selectedItem]
  )

  // Divider drag.
  const dragging = useRef(false)
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      setPaneWidth(clamp(e.clientX))
    }
    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('dragging-divider')
      setPaneWidth((w) => {
        void window.api.setSettings({ listPaneWidth: w })
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <div className="workspace" style={{ ['--pane-width' as string]: `${paneWidth}px` }}>
        <ReplayList
          items={filtered}
          totalItems={items.length}
          totalBytes={totalBytes}
          nonFavCount={nonFavCount}
          drawCount={drawItems.length}
          groupByPlayer={settings?.analyticsPlayerName ?? ''}
          selectedId={selected}
          folder={folder}
          lastScanAt={lastScanAt}
          scanning={scanning}
          progress={progress}
          firstLoad={firstLoad}
          query={query}
          sort={sort}
          onQuery={setQuery}
          onSort={setSort}
          onSelect={setSelected}
          onToggleFavourite={(fp) => void toggleFavourite(fp)}
          onRefresh={() => void scan(folder)}
          onChooseFolder={() => void changeFolder()}
          onClearNonFavourites={() => setShowClear(true)}
          onDeleteDraws={() => setPendingDrawDelete(true)}
          onKeyNav={onListKeyNav}
        />

        <div
          className="divider no-drag"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            dragging.current = true
            document.body.classList.add('dragging-divider')
          }}
        />

        <DetailPane
          meta={detail}
          loading={detailLoading}
          listItem={selectedItem}
          settings={settings}
          launchError={launchError}
          playState={playState}
          onPlay={(fp) => void play(fp)}
          onDismissLaunchError={() => setLaunchError(null)}
          onToggleSetting={(patch) => void patchSettings(patch)}
          onToggleFavourite={() => selected && void toggleFavourite(selected)}
          onSaveFavourite={(d) => void saveFavourite(d)}
          onOpenInFolder={() => selected && void window.api.openInFolder(selected)}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}

      {showClear && folder && (
        <ClearDialog
          folder={folder}
          onClose={() => setShowClear(false)}
          onDone={(result) => {
            setShowClear(false)
            setSelected(null)
            void scan(folder)
            const failed = result.failed.length
            flashToast(
              `Moved ${result.movedCount} replay${result.movedCount === 1 ? '' : 's'} to the Recycle Bin` +
                (failed ? ` — ${failed} could not be moved` : '')
            )
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this replay?"
          body={
            <>
              Move <strong>{pendingDelete.fileName}</strong> to the Windows Recycle Bin? You
              can restore it from there.
            </>
          }
          confirmLabel="Move to Recycle Bin"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDeleteOne()}
        />
      )}

      {pendingDrawDelete && (
        <ConfirmDialog
          title="Delete undecided games?"
          body={
            <>
              Move <strong>{drawItems.length}</strong> game
              {drawItems.length === 1 ? '' : 's'} that ended without a winner (
              <strong>{fmtGigabytes(drawItems.reduce((s, i) => s + i.fileSize, 0))}</strong>)
              to the Windows Recycle Bin? Favourited replays are kept.
            </>
          }
          confirmLabel="Move to Recycle Bin"
          danger
          onCancel={() => setPendingDrawDelete(false)}
          onConfirm={() => void confirmDeleteDraws()}
        />
      )}
    </div>
  )
}

function clamp(x: number): number {
  return Math.max(MIN_PANE, Math.min(MAX_PANE, Math.round(x)))
}
