import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PlayLaunchResult } from '../shared/types'
import { candidateReplayFolders } from './paths'
import { store } from './store'

/**
 * Resolve the Beyond All Reason install directory (the folder that holds the
 * launcher executable and the `data/` tree). Derived from the configured replay
 * folder when possible, otherwise from the known install locations.
 */
export function detectBarInstallDir(): string | null {
  const folder = store.getSettings().replaysFolder
  const roots = new Set<string>()

  if (folder) {
    // .../<install>/data/demos  ->  .../<install>
    const dataDir = dirname(folder)
    roots.add(dirname(dataDir))
    roots.add(dataDir)
  }
  for (const demos of candidateReplayFolders()) {
    const dataDir = dirname(demos)
    roots.add(dirname(dataDir))
  }

  for (const root of roots) {
    if (root && existsSync(root) && findLauncher(root)) return root
  }
  return null
}

const LAUNCHER_NAMES = [
  'Beyond-All-Reason.exe',
  'Beyond All Reason.exe',
  'beyond-all-reason.exe'
]

function findLauncher(installDir: string): string | null {
  for (const name of LAUNCHER_NAMES) {
    const p = join(installDir, name)
    if (existsSync(p)) return p
  }
  return null
}

export function playReplay(filePath: string): PlayLaunchResult {
  if (!existsSync(filePath)) {
    return { ok: false, error: 'Replay file no longer exists on disk.' }
  }
  const installDir = detectBarInstallDir()
  const launcher = installDir ? findLauncher(installDir) : null
  if (!launcher) {
    return {
      ok: false,
      error:
        'Could not find the Beyond All Reason client. Launch a game once so the ' +
        'replay folder is set, or reinstall BAR to its default location.'
    }
  }

  try {
    const child = spawn(launcher, [filePath], {
      cwd: installDir ?? dirname(launcher),
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', (err) => console.error('[launch] spawn error:', err))
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
