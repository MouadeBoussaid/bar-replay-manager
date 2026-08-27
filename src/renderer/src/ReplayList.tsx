import { useEffect, useMemo, useRef } from 'react'
import type { ReplayListItem } from '../../shared/types'
import {
  fmtClock,
  fmtDate,
  fmtGigabytes,
  fmtRelative,
  fmtTeamFormat
} from './format'
import { useVirtualRows } from './useVirtualRows'

export type SortKey = 'newest' | 'oldest' | 'duration' | 'map' | 'avgos'

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  duration: 'Duration',
  map: 'Map name',
  avgos: 'Avg OS'
}

const ROW_HEIGHT = 84

interface Props {
  items: ReplayListItem[]
  totalItems: number
  totalBytes: number
  nonFavCount: number
  selectedId: string | null
  folder: string | null
  lastScanAt: number | null
  scanning: boolean
  progress: { done: number; total: number } | null
  firstLoad: boolean
  query: string
  sort: SortKey
  showResults?: boolean
  onQuery: (q: string) => void
  onSort: (s: SortKey) => void
  onSelect: (filePath: string) => void
  onToggleFavourite: (filePath: string) => void
  onRefresh: () => void
  onChooseFolder: () => void
  onClearNonFavourites: () => void
  onKeyNav: (dir: 'up' | 'down' | 'home' | 'end' | 'play' | 'delete') => void
}

export function ReplayList(props: Props): JSX.Element {
  const {
    items,
    totalItems,
    totalBytes,
    nonFavCount,
    selectedId,
    folder,
    lastScanAt,
    scanning,
    progress,
    firstLoad,
    query,
    sort,
    showResults,
    onQuery,
    onSort,
    onSelect,
    onToggleFavourite,
    onRefresh,
    onChooseFolder,
    onClearNonFavourites,
    onKeyNav
  } = props

  const searchRef = useRef<HTMLInputElement>(null)
  const virtual = useVirtualRows(items.length, ROW_HEIGHT)

  // Keep the selected row in view as the user arrows through the list.
  useEffect(() => {
    const idx = items.findIndex((i) => i.filePath === selectedId)
    const el = virtual.ref.current
    if (idx < 0 || !el) return
    const top = idx * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [selectedId, items, virtual.ref])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'F5') {
        e.preventDefault()
        onRefresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRefresh])

  const rowsKeyHandler = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        onKeyNav('up')
        break
      case 'ArrowDown':
        e.preventDefault()
        onKeyNav('down')
        break
      case 'Home':
        e.preventDefault()
        onKeyNav('home')
        break
      case 'End':
        e.preventDefault()
        onKeyNav('end')
        break
      case 'Enter':
        onKeyNav('play')
        break
      case 'Delete':
        onKeyNav('delete')
        break
    }
  }

  const slice = items.slice(virtual.start, virtual.end)
  const folderLabel = useMemo(() => middleEllipsis(folder ?? '', 46), [folder])

  return (
    <section className="list-pane" style={{ width: 'var(--pane-width)' }}>
      <div className="list-toolbar no-drag">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchRef}
            className="search-input"
            type="text"
            placeholder="Search"
            value={query}
            spellCheck={false}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="sort-wrap">
          <select
            className="sort-select"
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            aria-label="Sort replays"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <button
          className={`refresh-btn ${scanning ? 'spinning' : ''}`}
          title="Rescan replay folder"
          disabled={scanning || !folder}
          onClick={onRefresh}
        >
          ⟳
        </button>
      </div>

      <div className="folder-strip">
        <span className="folder-path" title={folder ?? ''}>
          {folder ? folderLabel : 'No folder set'}
        </span>
        <span className="folder-scan">
          {scanning
            ? progress
              ? `scanning ${progress.done}/${progress.total}`
              : 'scanning…'
            : `scanned ${fmtRelative(lastScanAt)}`}
        </span>
      </div>

      <div
        className="list-rows"
        ref={virtual.ref}
        tabIndex={0}
        role="listbox"
        aria-activedescendant={selectedId ? `row-${hash(selectedId)}` : undefined}
        onMouseDown={(e) => e.currentTarget.focus()}
        onKeyDown={rowsKeyHandler}
      >
        {firstLoad && scanning ? (
          <SkeletonRows />
        ) : items.length === 0 ? (
          <EmptyState folder={folder} query={query} onChooseFolder={onChooseFolder} />
        ) : (
          <div className="list-rows-inner" style={{ height: virtual.totalHeight }}>
            <div style={{ transform: `translateY(${virtual.offsetY}px)` }}>
              {slice.map((item, i) => (
                <Row
                  key={item.filePath}
                  item={item}
                  selected={item.filePath === selectedId}
                  zebra={(virtual.start + i) % 2 === 1}
                  showResults={showResults}
                  onSelect={() => onSelect(item.filePath)}
                  onToggleFavourite={() => onToggleFavourite(item.filePath)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="list-footer">
        <button
          className="delete-nonfav"
          disabled={!folder || nonFavCount === 0}
          title={
            nonFavCount === 0
              ? 'Every replay here is favourited'
              : `${nonFavCount} non-favourite replays`
          }
          onClick={onClearNonFavourites}
        >
          <span aria-hidden>🗑</span> Delete non-favourites
        </button>
        <span className="list-total">
          {totalItems} files · {fmtGigabytes(totalBytes)}
        </span>
      </div>
    </section>
  )
}

function Row({
  item,
  selected,
  zebra,
  showResults,
  onSelect,
  onToggleFavourite
}: {
  item: ReplayListItem
  selected: boolean
  zebra: boolean
  showResults?: boolean
  onSelect: () => void
  onToggleFavourite: () => void
}): JSX.Element {
  const format = fmtTeamFormat(item.teamSizes)
  const showWinner =
    showResults && item.winnerTeamOrdinal != null && item.winnerTeamOrdinal >= 0
  const title = item.parseError ? item.fileName : item.mapName

  return (
    <div
      id={`row-${hash(item.filePath)}`}
      className={`row ${selected ? 'row-selected' : ''} ${zebra ? 'row-zebra' : ''} ${
        item.parseError ? 'row-error' : ''
      }`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
    >
      <div className="row-thumb" aria-hidden />
      <div className="row-body">
        <div className="row-line1">
          <span className="row-map" title={title}>
            {title}
          </span>
          <button
            className={`star ${item.isFavourite ? 'star-on' : ''}`}
            title={item.isFavourite ? 'Remove favourite' : 'Add favourite'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavourite()
            }}
          >
            {item.isFavourite ? '★' : '☆'}
          </button>
        </div>
        <div className="row-line2">
          {fmtDate(item.startTime)} · {fmtClock(item.durationMs)} · {fileSize(item.fileSize)}
        </div>
        <div className="row-line3">
          {item.teamSizes.length > 0 && (
            <span className={`row-badge ${showWinner ? 'row-badge-win' : ''}`}>
              {showWinner ? `TEAM ${item.winnerTeamOrdinal! + 1}` : format}
            </span>
          )}
          {item.avgOs != null && (
            <span className="row-os">avg {item.avgOs.toFixed(1)} OS</span>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonRows(): JSX.Element {
  return (
    <div className="skeletons">
      {Array.from({ length: 8 }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton-thumb shimmer" />
          <div className="skeleton-lines">
            <div className="shimmer skeleton-bar w70" />
            <div className="shimmer skeleton-bar w40" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  folder,
  query,
  onChooseFolder
}: {
  folder: string | null
  query: string
  onChooseFolder: () => void
}): JSX.Element {
  if (query.trim()) {
    return <div className="list-empty">No replays match “{query.trim()}”.</div>
  }
  return (
    <div className="list-empty">
      <p className="list-empty-title">No replays found</p>
      {folder && <p className="list-empty-path">{folder}</p>}
      <button className="choose-folder" onClick={onChooseFolder}>
        Choose folder…
      </button>
    </div>
  )
}

function fileSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = Math.floor((max - 1) / 2)
  return `${text.slice(0, keep)}…${text.slice(-keep)}`
}

// Small deterministic id for aria-activedescendant wiring.
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
