import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ClearPreview, ClearResult, Settings } from '../shared/types'
import { buildPlayerReport, indexedPlayerNames } from './analytics'
import { resolveFavouriteKey } from './favourites'
import { startWatch, stopWatch } from './folder-watcher'
import { playReplay } from './launch'
import { getMapImage, getMapInfo, type MapImageSize } from './map-images'
import { buildReplayGraph } from './replay-graph'
import { detectDefaultFolder } from './paths'
import { getReplayDetail } from './replay-parser'
import { listReplays } from './replay-scanner'
import { store } from './store'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => store.setSettings(patch))

  ipcMain.handle('folder:pick', async () => {
    const win = getWindow()
    const opts = {
      title: 'Select your Beyond All Reason replays folder',
      properties: ['openDirectory' as const]
    }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    store.setSettings({ replaysFolder: res.filePaths[0] })
    return res.filePaths[0]
  })

  ipcMain.handle('folder:detectDefault', () => detectDefaultFolder())

  ipcMain.handle('replays:list', (_e, folder: string) => listReplays(folder))

  ipcMain.handle('replay:detail', async (_e, filePath: string) => {
    const { onlineEnrich } = store.getSettings()
    try {
      return await getReplayDetail(filePath, onlineEnrich)
    } catch (err) {
      // The file can vanish between selection and this call (e.g. bulk delete).
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
  })

  ipcMain.handle('replay:play', (_e, filePath: string) => playReplay(filePath))
  ipcMain.handle('map:image', (_e, name: string, size: MapImageSize) =>
    getMapImage(name, size)
  )
  ipcMain.handle('map:info', (_e, name: string) => getMapInfo(name))
  ipcMain.handle('replay:graph', (_e, filePath: string) => buildReplayGraph(filePath))
  ipcMain.handle('analytics:playerNames', () => indexedPlayerNames())
  ipcMain.handle('analytics:playerReport', (_e, name: string, scope) =>
    buildPlayerReport(name, scope)
  )

  ipcMain.handle('replay:trash', async (_e, filePath: string) => {
    await shell.trashItem(filePath)
  })

  ipcMain.handle('replay:trashMany', async (_e, filePaths: string[]) => {
    const failed: string[] = []
    let moved = 0
    for (const p of filePaths) {
      try {
        await shell.trashItem(p)
        moved++
      } catch {
        failed.push(basename(p))
      }
    }
    return { moved, failed }
  })

  ipcMain.on('window:minimize', () => getWindow()?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => getWindow()?.close())

  ipcMain.handle('favourite:toggle', (_e, filePath: string) => {
    const key = resolveFavouriteKey(filePath)
    if (store.isFavourite(key)) {
      store.removeFavourite(key)
      return false
    }
    store.addFavourite(key)
    return true
  })

  ipcMain.handle(
    'favourite:update',
    (_e, filePath: string, data: { note?: string; tags?: string[] }) => {
      store.updateFavourite(resolveFavouriteKey(filePath), data)
    }
  )

  ipcMain.handle('replays:clearPreview', (_e, folder: string): ClearPreview => {
    const victims = nonFavourites(folder)
    let totalBytes = 0
    for (const p of victims) {
      try {
        totalBytes += statSync(p).size
      } catch {
        /* ignore */
      }
    }
    return {
      count: victims.length,
      totalBytes,
      sampleNames: victims.slice(0, 8).map((p) => basename(p))
    }
  })

  ipcMain.handle('replays:clearConfirm', async (_e, folder: string): Promise<ClearResult> => {
    const victims = nonFavourites(folder)
    const failed: ClearResult['failed'] = []
    let movedCount = 0
    for (const p of victims) {
      try {
        await shell.trashItem(p)
        movedCount++
      } catch (err) {
        failed.push({
          fileName: basename(p),
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return { movedCount, failed }
  })

  ipcMain.handle('watch:start', (_e, folder: string) => {
    startWatch(folder, () => getWindow()?.webContents.send('replays:changed'))
  })
  ipcMain.handle('watch:stop', () => stopWatch())

  ipcMain.handle('shell:showItem', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}

function nonFavourites(folder: string): string[] {
  let names: string[]
  try {
    names = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.sdfz'))
  } catch {
    return []
  }
  const out: string[] = []
  for (const f of names) {
    const p = join(folder, f)
    if (!store.isFavourite(resolveFavouriteKey(p))) out.push(p)
  }
  return out
}
