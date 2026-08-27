import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Known locations where Beyond All Reason keeps its `.sdfz` replays on Windows. */
export function candidateReplayFolders(): string[] {
  const home = app.getPath('home')
  const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
  const documents = app.getPath('documents')
  return [
    join(localAppData, 'Programs', 'Beyond-All-Reason', 'data', 'demos'),
    join(documents, 'Beyond All Reason', 'data', 'demos'),
    join(localAppData, 'Programs', 'Beyond-All-Reason', 'demos'),
    join(home, 'Beyond All Reason', 'data', 'demos')
  ]
}

export function detectDefaultFolder(): string | null {
  for (const dir of candidateReplayFolders()) {
    if (existsSync(dir)) return dir
  }
  return null
}
