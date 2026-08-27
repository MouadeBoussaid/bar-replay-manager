import { useEffect, useState } from 'react'
import type { ReplayListItem, ReplayMeta } from '../../shared/types'
import { fmtBytes, fmtDateTime, fmtDuration, flagEmoji } from './format'

interface Props {
  meta: ReplayMeta | null
  loading: boolean
  listItem: ReplayListItem | null
  spoilResults: boolean
  onToggleSpoil: (v: boolean) => void
  onToggleFavourite: () => void
  onSaveFavourite: (data: { note: string; tags: string[] }) => void
  onOpenInFolder: () => void
}

export function DetailPane({
  meta,
  loading,
  listItem,
  spoilResults,
  onToggleSpoil,
  onToggleFavourite,
  onSaveFavourite,
  onOpenInFolder
}: Props): JSX.Element {
  if (!listItem) {
    return (
      <div className="detail empty">
        <p>Select a replay to see its details.</p>
      </div>
    )
  }

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-title">
          <button
            className={`star ${listItem.isFavourite ? 'on' : ''}`}
            title={listItem.isFavourite ? 'Remove favourite' : 'Add favourite'}
            onClick={onToggleFavourite}
          >
            {listItem.isFavourite ? '★' : '☆'}
          </button>
          <span className="fname">{meta?.fileName ?? listItem.fileName}</span>
        </div>
        <label className="spoil">
          <input
            type="checkbox"
            checked={spoilResults}
            onChange={(e) => onToggleSpoil(e.target.checked)}
          />
          Spoil results
        </label>
      </div>

      {loading && <p className="muted">Loading…</p>}

      {meta && (
        <>
          {meta.enrichError && (
            <p className="badge warn">Local data only — {meta.enrichError}</p>
          )}
          {meta.source === 'local' && !meta.enrichError && (
            <p className="badge">Local data only</p>
          )}
          {meta.source === 'local+online' && (
            <p className="badge ok">Enriched from bar-rts.com</p>
          )}

          <table className="kv">
            <tbody>
              <tr>
                <th>Map</th>
                <td>{meta.map.name}</td>
              </tr>
              <tr>
                <th>Duration</th>
                <td>{fmtDuration(meta.durationMs)}</td>
              </tr>
              <tr>
                <th>Date &amp; time</th>
                <td>{fmtDateTime(meta.startTime)}</td>
              </tr>
              <tr>
                <th>Engine</th>
                <td>{meta.engineVersion || '—'}</td>
              </tr>
              <tr>
                <th>Game</th>
                <td>{meta.gameVersion || '—'}</td>
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

          {meta.allyTeams.map((team, i) => (
            <div className="team" key={team.id}>
              <h3>
                Team {i + 1}
                {spoilResults && team.won === true && (
                  <span className="win-badge">Winner</span>
                )}
                {spoilResults && team.won === false && (
                  <span className="loss-badge">Lost</span>
                )}
              </h3>
              <ul className="players">
                {team.players.map((p, j) => (
                  <li key={`${p.name}-${j}`}>
                    <span className="flag">{flagEmoji(p.countryCode)}</span>
                    <span
                      className="dot"
                      style={p.rgbColor ? { background: p.rgbColor } : undefined}
                    />
                    <span className="pname">
                      {p.name}
                      {p.isAi && <span className="ai-tag">AI</span>}
                    </span>
                    {p.faction && <span className="faction">{p.faction}</span>}
                    {typeof p.skillOS === 'number' && (
                      <span className="os">[{p.skillOS.toFixed(2)}]OS</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {meta.spectators.length > 0 && (
            <div className="team">
              <h3>Spectators</h3>
              <ul className="players">
                {meta.spectators.map((p, j) => (
                  <li key={`${p.name}-${j}`}>
                    <span className="flag">{flagEmoji(p.countryCode)}</span>
                    <span className="pname">{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SettingsBlock title="Host Settings" data={meta.hostSettings} />
          <SettingsBlock title="SPADS Settings" data={meta.spadsSettings} />
          <SettingsBlock title="Game Settings" data={meta.gameSettings} />
          <SettingsBlock title="Map Settings" data={meta.mapSettings} />

          <FavouriteEditor
            key={meta.gameId ?? meta.filePath}
            enabled={listItem.isFavourite}
            note={listItem.note}
            tags={listItem.tags}
            onSave={onSaveFavourite}
          />

          <div className="detail-foot">
            <span className="mono">{meta.filePath}</span>
            <span>{fmtBytes(meta.fileSize)}</span>
            <button onClick={onOpenInFolder}>Open containing folder</button>
          </div>
        </>
      )}
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
        Add this replay to favourites to attach a note and tags.
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
