import chokidar, { type FSWatcher } from 'chokidar'

let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

/** Watch `folder` (non-recursive) for `.sdfz` files appearing / disappearing. */
export function startWatch(folder: string, notify: () => void): void {
  stopWatch()

  watcher = chokidar.watch(folder, {
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }
  })

  const trigger = (p: string): void => {
    if (!p.toLowerCase().endsWith('.sdfz')) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(notify, 800)
  }

  watcher.on('add', trigger).on('unlink', trigger)
}

export function stopWatch(): void {
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  if (watcher) {
    void watcher.close()
    watcher = null
  }
}
