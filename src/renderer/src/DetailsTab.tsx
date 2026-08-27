import { useEffect, useState } from 'react'
import type { ReplayListItem, ReplayMeta } from '../../shared/types'
import { fmtBytes, fmtDateTime, fmtDuration, flagEmoji } from './format'

interface Props {
  meta: ReplayMeta
  listItem: ReplayListItem
  onToggleFavourite: () => void
  onSaveFavourite: (data: { note: string; tags: string[] }) => void
  onOpenInFolder: () => void
}

export function DetailsTab({
  meta,
  listItem,
  onToggleFavourite,
  onSaveFavourite,
  onOpenInFolder
}: Props): JSX.Element {
  return (
    <div className="details-tab">
      <div className="source-row">
        {meta.enrichError ? (
          <span className="chip chip-warn">Local data only — {meta.enrichError}</span>
        ) : meta.source === 'local+online' ? (
          <span className="chip chip-ok">Enriched from bar-rts.com</span>
        ) : (
          <span className="chip">Local data only</span>
        )}
        <button
          className={`star ${listItem.isFavourite ? 'star-on' : ''}`}
          title={listItem.isFavourite ? 'Remove favourite' : 'Add favourite'}
          onClick={onToggleFavourite}
        >
          {listItem.isFavourite ? '★ Favourited' : '☆ Favourite'}
        </button>
      </div>

      <table className="kv">
        <tbody>
          <tr>
            <th>Date &amp; time</th>
            <td>{fmtDateTime(meta.startTime)}</td>
          </tr>
          <tr>
            <th>Duration</th>
            <td>{fmtDuration(meta.durationMs)}</td>
          </tr>
          <tr>
            <th>Engine</th>
            <td className="mono">{meta.engineVersion || '—'}</td>
          </tr>
          <tr>
            <th>Game</th>
            <td className="mono">{meta.gameVersion || '—'}</td>
          </tr>
          <tr>
            <th>Ended normally</th>
            <td>{meta.endedNormally ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <th>Game ID</th>
            <td className="mono">{meta.gameId ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      {meta.spectators.length > 0 && (
        <div className="spectators">
          <h3>Spectators ({meta.spectators.length})</h3>
          <ul>
            {meta.spectators.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <span className="player-flag">{flagEmoji(p.countryCode) || '🏳'}</span>
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SettingsBlock title="Host settings" data={meta.hostSettings} />
      <SettingsBlock title="SPADS settings" data={meta.spadsSettings} />
      <SettingsBlock title="Game settings" data={meta.gameSettings} />
      <SettingsBlock title="Map settings" data={meta.mapSettings} />

      <FavouriteEditor
        key={meta.gameId ?? meta.filePath}
        enabled={listItem.isFavourite}
        note={listItem.note}
        tags={listItem.tags}
        onSave={onSaveFavourite}
      />

      <div className="details-foot">
        <span className="mono details-path">{meta.filePath}</span>
        <span>{fmtBytes(meta.fileSize)}</span>
        <button className="btn-ghost" onClick={onOpenInFolder}>
          Open containing folder
        </button>
      </div>
    </div>
  )
}

function SettingsBlock({
  title,
  data
}: {
  title: string
  data: Record<string, string>
}): JSX.Element {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  return (
    <details className="settings-block">
      <summary>
        {title} <span className="count">({entries.length})</span>
      </summary>
      {entries.length === 0 ? (
        <p className="muted">Not available from this source.</p>
      ) : (
        <table className="kv small">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  )
}

function FavouriteEditor({
  enabled,
  note,
  tags,
  onSave
}: {
  enabled: boolean
  note: string
  tags: string[]
  onSave: (data: { note: string; tags: string[] }) => void
}): JSX.Element {
  const [draftNote, setDraftNote] = useState(note)
  const [draftTags, setDraftTags] = useState(tags.join(', '))

  useEffect(() => {
    setDraftNote(note)
    setDraftTags(tags.join(', '))
  }, [note, tags])

  if (!enabled) {
    return (
      <div className="fav-editor muted">
        Favourite this replay to attach a note and tags.
      </div>
    )
  }

  const save = (): void => {
    onSave({
      note: draftNote.trim(),
      tags: draftTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    })
  }

  return (
    <div className="fav-editor">
      <h3>Favourite</h3>
      <label>
        Note
        <textarea
          rows={2}
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          onBlur={save}
          placeholder="e.g. great comeback"
        />
      </label>
      <label>
        Tags (comma separated)
        <input
          value={draftTags}
          onChange={(e) => setDraftTags(e.target.value)}
          onBlur={save}
          placeholder="tourney, 1v1"
        />
      </label>
    </div>
  )
}
