import { useEffect, useMemo, useState } from 'react'

interface Props {
  /** Current perspective player (persisted). */
  player: string
  onSave: (name: string) => void
  onClose: () => void
}

/** App settings. For now: the "perspective" player that drives My / Watched replays. */
export function SettingsDialog({ player, onSave, onClose }: Props): JSX.Element {
  const [value, setValue] = useState(player)
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    window.api.getIndexedPlayerNames().then(setNames).catch(() => setNames([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q || names.includes(value)) return []
    return names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8)
  }, [value, names])

  const save = (): void => {
    onSave(value.trim())
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-field">
          <label htmlFor="perspective-input">Perspective player</label>
          <p className="settings-hint">
            The player this manager is viewed as. Splits the replay list into{' '}
            <strong>My replays</strong> and <strong>Watched replays</strong>. Leave empty for
            no split.
          </p>
          <div className="settings-autocomplete">
            <input
              id="perspective-input"
              value={value}
              placeholder="e.g. your BAR name"
              spellCheck={false}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            {value && (
              <button className="settings-clear" title="Clear" onClick={() => setValue('')}>
                ✕
              </button>
            )}
            {matches.length > 0 && (
              <div className="settings-pop">
                {matches.map((n) => (
                  <button key={n} onClick={() => setValue(n)}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
