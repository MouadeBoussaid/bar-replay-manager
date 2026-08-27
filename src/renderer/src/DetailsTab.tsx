import type { ReplayListItem, ReplayMeta } from '../../shared/types'
import { fmtBytes, fmtDateTime, fmtDuration, flagEmoji } from './format'

interface Props {
  meta: ReplayMeta
  listItem: ReplayListItem
  onToggleFavourite: () => void
  onOpenInFolder: () => void
}

export function DetailsTab({
  meta,
  listItem,
  onToggleFavourite,
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

