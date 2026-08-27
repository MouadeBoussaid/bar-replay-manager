import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shell } from 'electron'
import type { PlayLaunchResult } from '../shared/types'
import { candidateReplayFolders } from './paths'
import { store } from './store'

const LAUNCHER_NAMES = [
  'Beyond-All-Reason.exe',
  'Beyond All Reason.exe',
  'beyond-all-reason.exe'
]

/**
 * Resolve the Beyond All Reason install directory (the folder that holds the
 * launcher executable). Tries the configured replay folder's ancestors and the
 * known default install locations.
 */
export function detectBarInstallDir(): string | null {
  const roots = new Set<string>()
  const folder = store.getSettings().replaysFolder

  // Walk up from the replays folder — the launcher lives 1-3 levels above
  // `.../<install>/data/demos`.
  if (folder) {
    let dir = folder
    for (let i = 0; i < 4; i++) {
      roots.add(dir)
      dir = dirname(dir)
    }
  }
  for (const demos of candidateReplayFolders()) {
    roots.add(dirname(dirname(demos)))
  }
  const lad = process.env['LOCALAPPDATA']
  if (lad) {
    roots.add(join(lad, 'Programs', 'Beyond-All-Reason'))
    roots.add(join(lad, 'Beyond-All-Reason'))
  }
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  roots.add(join(pf, 'Beyond-All-Reason'))

  for (const root of roots) {
    if (root && findLauncher(root)) return root
  }
  return null
}

function findLauncher(installDir: string): string | null {
  for (const name of LAUNCHER_NAMES) {
    const p = join(installDir, name)
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Launch a replay. Prefers spawning the detected BAR client directly; falls back
 * to the OS file association (what double-clicking the `.sdfz` would do).
 */
export async function playReplay(filePath: string): Promise<PlayLaunchResult> {
  if (!existsSync(filePath)) {
    return { ok: false, error: 'That replay file no longer exists on disk.' }
  }

  const installDir = detectBarInstallDir()
  const launcher = installDir ? findLauncher(installDir) : null

  if (launcher) {
    const spawned = await spawnLauncher(launcher, installDir!, filePath)
    if (spawned.ok) return spawned
    console.error('[launch] direct spawn failed:', spawned.error)
  }

  // Fallback: hand the file to Windows' default handler for `.sdfz`.
  let openErr = ''
  try {
    openErr = await shell.openPath(filePath)
    if (!openErr) return { ok: true }
  } catch (err) {
    openErr = err instanceof Error ? err.message : String(err)
  }
  console.error('[launch] shell.openPath failed:', openErr)

  return {
    ok: false,
    error: launcher
      ? `Beyond All Reason wouldn't start. Check the client at ${launcher}.`
      : 'Could not find the Beyond All Reason client, and Windows has no app ' +
        'set to open .sdfz replay files. Install BAR, or set the replays folder ' +
        'to a path inside your BAR install so the client can be located.'
  }
}

/** Spawn the launcher, waiting briefly to catch an immediate spawn error (ENOENT etc.). */
function spawnLauncher(
  launcher: string,
  cwd: string,
  filePath: string
): Promise<PlayLaunchResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: PlayLaunchResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    try {
      const child = spawn(launcher, [filePath], { cwd, detached: true, stdio: 'ignore' })
      child.once('error', (err) => done({ ok: false, error: err.message }))
      child.unref()
      // No error within a short window → treat as launched.
      setTimeout(() => done({ ok: true }), 600)
    } catch (err) {
      done({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
