import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  detectDefaultFolder: () => ipcRenderer.invoke('folder:detectDefault'),
  listReplays: (folder) => ipcRenderer.invoke('replays:list', folder),
  getReplayDetail: (filePath) => ipcRenderer.invoke('replay:detail', filePath),
  playReplay: (filePath) => ipcRenderer.invoke('replay:play', filePath),
  trashReplay: (filePath) => ipcRenderer.invoke('replay:trash', filePath),
  getInstalledEngines: () => ipcRenderer.invoke('engines:list'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onWindowMaximizeChange: (cb) => {
    const listener = (_e: unknown, isMaximized: boolean): void => cb(isMaximized)
    ipcRenderer.on('window:maximize-changed', listener)
    return () => ipcRenderer.removeListener('window:maximize-changed', listener)
  },
  toggleFavourite: (filePath) => ipcRenderer.invoke('favourite:toggle', filePath),
  updateFavourite: (filePath, data) => ipcRenderer.invoke('favourite:update', filePath, data),
  previewClear: (folder) => ipcRenderer.invoke('replays:clearPreview', folder),
  confirmClear: (folder) => ipcRenderer.invoke('replays:clearConfirm', folder),
  startWatch: (folder) => ipcRenderer.invoke('watch:start', folder),
  stopWatch: () => ipcRenderer.invoke('watch:stop'),
  onReplaysChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('replays:changed', listener)
    return () => ipcRenderer.removeListener('replays:changed', listener)
  },
  onScanProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on('replays:scan-progress', listener)
    return () => ipcRenderer.removeListener('replays:scan-progress', listener)
  },
  openInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath)
}

contextBridge.exposeInMainWorld('api', api)
