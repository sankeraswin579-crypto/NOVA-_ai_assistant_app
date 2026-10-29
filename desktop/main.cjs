const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const https = require('https')
const fs = require('fs')

let mainWindow
let backendProcess
const isDev = !app.isPackaged
const apiPort = 8765
const defaultApiUrl = `http://127.0.0.1:${apiPort}`
let apiUrl = defaultApiUrl

function loadApiUrl() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).apiUrl
    const parsed = new URL(saved)
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.host) apiUrl = saved.replace(/\/+$/, '')
  } catch {}
}

ipcMain.handle('nova:get-api-url', () => apiUrl)
ipcMain.handle('nova:set-api-url', async (_event, value) => {
  const url = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Enter a valid URL starting with http:// or https://') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('Enter a valid URL starting with http:// or https://')
  apiUrl = url
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ apiUrl }, null, 2))
  return url
})

function healthCheck(url = defaultApiUrl) {
  return new Promise(resolve => {
    let target
    try { target = new URL(`${url}/api/health`) } catch { resolve(false); return }
    const client = target.protocol === 'https:' ? https : http
    const req = client.get(target, res => resolve(res.statusCode === 200))
    req.on('error', () => resolve(false))
    req.setTimeout(600, () => { req.destroy(); resolve(false) })
  })
}

async function startBackend() {
  if (apiUrl !== defaultApiUrl) return
  if (await healthCheck(apiUrl)) return
  const executable = isDev
    ? path.join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(process.resourcesPath, 'backend', 'nova-api.exe')
  const args = isDev
    ? ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(apiPort)]
    : []
  const cwd = isDev ? path.join(__dirname, '..', 'backend') : path.join(app.getPath('userData'))
  if (isDev && !fs.existsSync(executable)) {
    console.error(`Nova backend Python environment not found at ${executable}`)
    return
  }
  if (!isDev && !fs.existsSync(executable)) {
    console.error(`Nova backend sidecar not found at ${executable}`)
    return
  }
  if (!isDev) {
    // Keep user data and SQLite DB in the user's application data directory.
    process.env.NOVA_DATABASE_URL = `sqlite:///${path.join(app.getPath('userData'), 'nova.db').replace(/\\/g, '/')}`
  }
  backendProcess = spawn(executable, args, { cwd, windowsHide: true, stdio: 'ignore', env: { ...process.env, NOVA_DATABASE_URL: process.env.NOVA_DATABASE_URL || `sqlite:///${path.join(app.getPath('userData'), 'nova.db').replace(/\\/g, '/')}` } })
  backendProcess.on('error', err => console.error('Nova backend could not start:', err))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 620,
    backgroundColor: '#080b14',
    title: 'Nova AI Desktop',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  })
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173')
  else mainWindow.loadFile(path.join(process.resourcesPath, 'frontend', 'index.html'))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
}
app.whenReady().then(async () => {
  loadApiUrl()
  await startBackend()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { if (backendProcess && !backendProcess.killed) backendProcess.kill() })
