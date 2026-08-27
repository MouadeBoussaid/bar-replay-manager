import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { stopWatch } from './folder-watcher'
import { registerIpc } from './ipc'
import { store } from './store'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    frame: false,
    title: 'BAR Replay Browser',
    backgroundColor: '#0d0e10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const emitMaximizeState = (): void =>
    mainWindow?.webContents.send('window:maximize-changed', mainWindow.isMaximized())
  mainWindow.on('maximize', emitMaximizeState)
  mainWindow.on('unmaximize', emitMaximizeState)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatch()
  store.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => store.flush())
