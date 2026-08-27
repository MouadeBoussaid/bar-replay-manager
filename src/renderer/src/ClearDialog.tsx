import { useEffect, useState } from 'react'
import type { ClearPreview, ClearResult } from '../../shared/types'
import { fmtBytes } from './format'

interface Props {
  folder: string
  onClose: () => void
  onDone: (result: ClearResult) => void
}

export function ClearDialog({ folder, onClose, onDone }: Props): JSX.Element {
  const [preview, setPreview] = useState<ClearPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .previewClear(folder)
      .then((p) => {
        if (!cancelled) setPreview(p)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [folder])

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.confirmClear(folder)
      onDone(result)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Clear non-favourited replays</h2>

        {!preview && !error && <p>Scanning folder…</p>}

        {error && <p className="error">{error}</p>}

        {preview && (
          <>
            {preview.count === 0 ? (
              <p>Nothing to clear — every replay in this folder is favourited.</p>
            ) : (
              <>
                <p>
                  Move <strong>{preview.count}</strong> replay
                  {preview.count === 1 ? '' : 's'} (
                  <strong>{fmtBytes(preview.totalBytes)}</strong>) to the Windows
                  Recycle Bin? Favourited replays are kept.
                </p>
                {preview.sampleNames.length > 0 && (
                  <ul className="sample-list">
                    {preview.sampleNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                    {preview.count > preview.sampleNames.length && (
                      <li>…and {preview.count - preview.sampleNames.length} more</li>
                    )}
                  </ul>
                )}
              </>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-danger"
            onClick={confirm}
            disabled={busy || !preview || preview.count === 0}
          >
            {busy ? 'Moving…' : 'Move to Recycle Bin'}
          </button>
        </div>
      </div>
    </div>
  )
}
