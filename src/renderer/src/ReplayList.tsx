import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayListItem } from '../../shared/types'
import {
  OS_TIER_LABEL,
  fmtClock,
  fmtDate,
  fmtGigabytes,
  fmtRelative,
  fmtTeamFormat,
  osTier
} from './format'
import { useVirtualRows } from './useVirtualRows'

export type SortKey = 'newest' | 'oldest' | 'duration' | 'map' | 'avgos' | 'ostier'

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  duration: 'Duration',
  map: 'Map name',
  avgos: 'Avg OS',
  ostier: 'OS tier'
}

const ROW_HEIGHT = 78
const GROUP_HEADER_H = 36

type RenderRow =
  | { type: 'header'; key: string; label: string; count: number; collapsed: boolean }
  | { type: 'row'; key: string; item: ReplayListItem }

interface Props {
  items: ReplayListItem[]
  totalItems: number
  totalBytes: number
  nonFavCount: number
  drawCount: number
  aiCount: number
  /** When non-empty, split the list into "My replays" / "Spectated replays". */
  groupByPlayer: string
  selectedId: string | null
  folder: string | null
  lastScanAt: number | null
  scanning: boolean
  progress: { done: number; total: number } | null
  firstLoad: boolean
  query: string
  sort: SortKey
  onQuery: (q: string) => void
  onSort: (s: SortKey) => void
  onSelect: (filePath: string) => void
  onToggleFavourite: (filePath: string) => void
  onRefresh: () => void
  onChooseFolder: () => void
  onClearNonFavourites: () => void
  onDeleteDraws: () => void
  onDeleteAi: () => void
  onKeyNav: (dir: 'up' | 'down' | 'home' | 'end' | 'play' | 'delete') => void
}

export function ReplayList(props: Props): JSX.Element {
  const {
    items,
    totalItems,
    totalBytes,
    nonFavCount,
    drawCount,
    aiCount,
    groupByPlayer,
    selectedId,
    folder,
    lastScanAt,
    scanning,
    progress,
    firstLoad,
    query,
    sort,
    onQuery,
    onSort,
    onSelect,
    onToggleFavourite,
    onRefresh,
    onChooseFolder,
    onClearNonFavourites,
    onDeleteDraws,
    onDeleteAi,
    onKeyNav
  } = props

  const searchRef = useRef<HTMLInputElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (label: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  // Flat render list — optionally split into "My replays" / "Watched replays".
  const rows = useMemo<RenderRow[]>(() => {
    const name = groupByPlayer.trim().toLowerCase()
    if (!name) return items.map((i) => ({ type: 'row', key: i.filePath, item: i }))
    const mine: ReplayListItem[] = []
    const watched: ReplayListItem[] = []
    for (const i of items) {
      if (i.playerNames.some((p) => p.toLowerCase() === name)) mine.push(i)
      else watched.push(i)
    }
    const out: RenderRow[] = []
    for (const [label, list] of [
      ['My replays', mine],
      ['Spectated replays', watched]
    ] as const) {
      const isCollapsed = collapsed.has(label)
      out.push({ type: 'header', key: `h:${label}`, label, count: list.length, collapsed: isCollapsed })
      if (!isCollapsed) for (const i of list) out.push({ type: 'row', key: i.filePath, item: i })
    }
    return out
  }, [items, groupByPlayer, collapsed])

  const heights = useMemo(
    () => rows.map((r) => (r.type === 'header' ? GROUP_HEADER_H : ROW_HEIGHT)),
    [rows]
  )
  const virtual = useVirtualRows(heights)

  // Keep the selected row in view as the user arrows through the list.
  useEffect(() => {
    const idx = rows.findIndex((r) => r.type === 'row' && r.item.filePath === selectedId)
    const el = virtual.ref.current
    if (idx < 0 || !el) return
    const top = virtual.offsets[idx]!
    const bottom = virtual.offsets[idx + 1]!
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [selectedId, rows, virtual.ref, virtual.offsets])

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

  const slice = rows.slice(virtual.start, virtual.end)
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
              {slice.map((r, i) =>
                r.type === 'header' ? (
                  <button
                    className="list-group-header"
                    key={r.key}
                    style={{ height: GROUP_HEADER_H }}
                    onClick={() => toggleGroup(r.label)}
                  >
                    <span className={`list-group-chevron ${r.collapsed ? 'collapsed' : ''}`}>▾</span>
                    {r.label}
                    <span className="list-group-count">{r.count}</span>
                  </button>
                ) : (
                  <Row
                    key={r.key}
                    item={r.item}
                    selected={r.item.filePath === selectedId}
                    zebra={(virtual.start + i) % 2 === 1}
                    onSelect={() => onSelect(r.item.filePath)}
                    onToggleFavourite={() => onToggleFavourite(r.item.filePath)}
                  />
                )
              )}
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
        <button
          className="delete-nonfav"
          disabled={!folder || drawCount === 0}
          title={
            drawCount === 0
              ? 'No undecided games (excluding favourites)'
              : `${drawCount} undecided game${drawCount === 1 ? '' : 's'}`
          }
          onClick={onDeleteDraws}
        >
          <span aria-hidden>🗑</span> Delete draws
        </button>
        <button
          className="delete-nonfav"
          disabled={!folder || aiCount === 0}
          title={
            aiCount === 0
              ? 'No AI games (excluding favourites)'
              : `${aiCount} game${aiCount === 1 ? '' : 's'} against AI`
          }
          onClick={onDeleteAi}
        >
          <span aria-hidden>🗑</span> Delete AI games
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
  onSelect,
  onToggleFavourite
}: {
  item: ReplayListItem
  selected: boolean
  zebra: boolean
  onSelect: () => void
  onToggleFavourite: () => void
}): JSX.Element {
  const format = fmtTeamFormat(item.teamSizes)
  const showWinner = item.winnerTeamOrdinal != null && item.winnerTeamOrdinal >= 0
  const winTone = item.winnerTeamColor
  const winLabel = winTone
    ? `TEAM ${winTone.toUpperCase()}`
    : `TEAM ${(item.winnerTeamOrdinal ?? 0) + 1}`
  const tier = osTier(item.avgOs)
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
            <span
              className={`row-badge ${
                showWinner ? `row-badge-${winTone ?? 'win'}` : ''
              }`}
            >
              {showWinner ? winLabel : format}
            </span>
          )}
          {tier && (
            <span className={`os-pill os-pill-${tier}`}>
              {OS_TIER_LABEL[tier]}
              <span className="os-pill-num">{item.avgOs!.toFixed(1)}</span>
            </span>
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
