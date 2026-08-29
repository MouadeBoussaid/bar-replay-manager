import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shell } from 'electron'
import type { PlayLaunchResult } from '../shared/types'
import { readDemoFile } from './demo-header'
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
 * Pick the `spring.exe` engine build to run a demo with. BAR keeps every engine
 * it has downloaded under `<install>/data/engine/<name>/`, where `<name>` is
 * either `recoil_<version>` (e.g. `recoil_2026.07.04`) or the raw version string
 * for old 105 builds (`105.1.1-1767-gaaf2cc3 bar`).
 *
 * We match the demo's engine version to a build; if that exact build isn't
 * installed we fall back to the most recently modified one, which will usually
 * still replay a recent demo. Returns null when no engine build exists at all.
 */
function resolveEngineExe(installDir: string, demoEngineVersion: string): string | null {
  const engineRoot = join(installDir, 'data', 'engine')
  let names: string[]
  try {
    names = readdirSync(engineRoot).filter((n) => existsSync(join(engineRoot, n, 'spring.exe')))
  } catch {
    return null
  }
  if (names.length === 0) return null

  const wanted = demoEngineVersion.trim().toLowerCase()
  const norm = (n: string): string => n.replace(/^recoil[_-]/i, '').trim().toLowerCase()

  const exact =
    wanted &&
    names.find((n) => {
      const a = norm(n)
      return a === wanted || wanted.includes(a) || a.includes(wanted)
    })
  if (exact) return join(engineRoot, exact, 'spring.exe')

  // No matching build — use the newest one we have.
  const newest = names
    .map((n) => ({ n, mtime: safeMtime(join(engineRoot, n)) }))
    .sort((a, b) => b.mtime - a.mtime)[0]!.n
  return join(engineRoot, newest, 'spring.exe')
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

function readEngineVersion(filePath: string): string {
  try {
    return readDemoFile(filePath).engineVersion.trim()
  } catch {
    return ''
  }
}

/**
 * Launch a replay. Prefers spawning the BAR engine (`spring.exe`) directly on the
 * demo file so it drops straight into the in-game replay; falls back to the BAR
 * launcher (which makes you start the replay from its menu), then to the OS file
 * association for `.sdfz`.
 */
export async function playReplay(filePath: string): Promise<PlayLaunchResult> {
  if (!existsSync(filePath)) {
    return { ok: false, error: 'That replay file no longer exists on disk.' }
  }

  const installDir = detectBarInstallDir()
  const launcher = installDir ? findLauncher(installDir) : null

  // 1. Straight into the game via the engine.
  if (installDir) {
    const engineExe = resolveEngineExe(installDir, readEngineVersion(filePath))
    if (engineExe) {
      const dataDir = join(installDir, 'data')
      const args = ['--write-dir', dataDir, filePath]
      const spawned = await spawnDetached(engineExe, dirname(engineExe), args, {
        // The engine bails out quickly when the replay needs a map or game
        // version that isn't downloaded yet (the launcher would have fetched
        // it). If that happens, fall the user back to the launcher.
        onEarlyExit: launcher
          ? (code) => {
              console.error(`[launch] engine exited early (code ${code}); opening launcher`)
              void spawnDetached(launcher, installDir, [filePath])
            }
          : undefined
      })
      if (spawned.ok) return spawned
      console.error('[launch] engine spawn failed:', spawned.error)
    }
  }

  // 2. The BAR launcher — opens its menu with the replay queued up.
  if (launcher) {
    const spawned = await spawnDetached(launcher, installDir!, [filePath])
    if (spawned.ok) return spawned
    console.error('[launch] launcher spawn failed:', spawned.error)
  }

  // 3. Hand the file to Windows' default handler for `.sdfz`.
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

interface SpawnOpts {
  /**
   * Called once if the process exits with a non-zero code (or a signal) within
   * ~30s of starting — i.e. it launched but then fell over. Not called for a
   * clean exit (the user just quitting) or an immediate spawn error.
   */
  onEarlyExit?: (code: number | null) => void
}

/** Spawn a process detached, waiting briefly to catch an immediate error (ENOENT etc.). */
function spawnDetached(
  exe: string,
  cwd: string,
  args: string[],
  opts: SpawnOpts = {}
): Promise<PlayLaunchResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: PlayLaunchResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    try {
      const startedAt = Date.now()
      const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore' })
      child.once('error', (err) => done({ ok: false, error: err.message }))
      if (opts.onEarlyExit) {
        let fired = false
        child.once('exit', (code, signal) => {
          if (fired || Date.now() - startedAt > 30_000) return
          if (code === 0 && !signal) return // clean quit — nothing to recover
          fired = true
          opts.onEarlyExit!(code)
        })
      }
      child.unref()
      // No error within a short window → treat as launched.
      setTimeout(() => done({ ok: true }), 600)
    } catch (err) {
      done({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
