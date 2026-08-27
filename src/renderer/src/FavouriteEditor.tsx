import { useEffect, useState } from 'react'

interface Props {
  /** Stable identity so drafts reset when a different replay is selected. */
  resetKey: string
  note: string
  tags: string[]
  onSave: (data: { note: string; tags: string[] }) => void
}

/** Note + tags editor for a favourited replay. Renders nothing unless favourited. */
export function FavouriteEditor({ resetKey, note, tags, onSave }: Props): JSX.Element {
  const [draftNote, setDraftNote] = useState(note)
  const [draftTags, setDraftTags] = useState(tags.join(', '))

  useEffect(() => {
    setDraftNote(note)
    setDraftTags(tags.join(', '))
  }, [resetKey, note, tags])

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
      <h3>Notes</h3>
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
