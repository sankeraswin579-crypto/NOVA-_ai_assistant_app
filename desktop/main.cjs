const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const https = require('https')
const fs = require('fs')
const crypto = require('crypto')
const projectAccess = require('./project-access.cjs')
const { assertProjectId, assertTrustedRenderer } = require('./electron-security.cjs')

let mainWindow
let backendProcess
let selectedProjectRoot
let selectedProjectId
const isDev = !app.isPackaged
const apiPort = 8765
const defaultApiUrl = `http://127.0.0.1:${apiPort}`
let apiUrl = defaultApiUrl

function guardProjectAction(event, projectId) {
  assertTrustedRenderer(event, mainWindow, isDev, process.resourcesPath)
  if (!selectedProjectRoot || !selectedProjectId) throw new Error('Choose a project folder first.')
  assertProjectId(selectedProjectId, projectId)
  return selectedProjectRoot
}

function loadApiUrl() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).apiUrl
    const parsed = new URL(saved)
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.host) apiUrl = saved.replace(/\/+$/, '')
  } catch {}
}

ipcMain.handle('nova:get-api-url', event => {
  assertTrustedRenderer(event, mainWindow, isDev, process.resourcesPath)
  return apiUrl
})
ipcMain.handle('nova:set-api-url', async (event, value) => {
  assertTrustedRenderer(event, mainWindow, isDev, process.resourcesPath)
  const url = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Enter a valid URL starting with http:// or https://') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('Enter a valid URL starting with http:// or https://')
  apiUrl = url
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ apiUrl }, null, 2))
  return url
})

ipcMain.handle('nova:choose-project', async event => {
  assertTrustedRenderer(event, mainWindow, isDev, process.resourcesPath)
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  const projectRoot = await fs.promises.realpath(result.filePaths[0])
  const project = await projectAccess.scanProject(projectRoot)
  selectedProjectRoot = projectRoot
  selectedProjectId = crypto.randomUUID()
  return { ...project, id: selectedProjectId }
})

ipcMain.handle('nova:refresh-project', async (event, projectId) => {
  const projectRoot = guardProjectAction(event, projectId)
  return { ...await projectAccess.scanProject(projectRoot), id: projectId }
})

ipcMain.handle('nova:read-project-files', async (event, projectId, paths) => {
  const projectRoot = guardProjectAction(event, projectId)
  return projectAccess.readProjectFiles(projectRoot, paths)
})

ipcMain.handle('nova:search-project-files', async (event, projectId, files, query) => {
  const projectRoot = guardProjectAction(event, projectId)
  if (!Array.isArray(files) || files.length > 1000 || typeof query !== 'string' || query.length > 1000) {
    throw new Error('Invalid project search request.')
  }
  return projectAccess.searchProjectFiles(projectRoot, files, query)
})

ipcMain.handle('nova:retrieve-project-context', async (event, projectId, files, query, selectedPaths) => {
  const projectRoot = guardProjectAction(event, projectId)
  if (!Array.isArray(files) || files.length > 1000 || !Array.isArray(selectedPaths) || selectedPaths.length > 8 ||
      typeof query !== 'string' || query.length > 12000) {
    throw new Error('Invalid project context request.')
  }
  return projectAccess.retrieveRelevantFiles(projectRoot, files, query, selectedPaths)
})

ipcMain.handle('nova:sanitize-project-text', (event, projectId, text) => {
  guardProjectAction(event, projectId)
  if (typeof text !== 'string' || text.length > 100000) throw new Error('Text is too large to sanitize.')
  return projectAccess.sanitizeContent(text).content
})

ipcMain.handle('nova:apply-project-change', async (event, projectId, change, approved) => {
  const projectRoot = guardProjectAction(event, projectId)
  if (approved !== true) throw new Error('File changes require explicit approval.')
  await projectAccess.validateProposedChange(projectRoot, change)
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Create backup and apply'],
    defaultId: 0,
    cancelId: 0,
    message: `Apply Nova's proposed change to ${change?.path || 'this file'}?`,
    detail: 'Nova will create a backup first. The write will be cancelled if the file changed since the proposal.',
  })
  if (result.response !== 1) return { applied: false }
  assertProjectId(selectedProjectId, projectId)
  const backupRoot = path.join(app.getPath('userData'), 'project-backups')
  const applied = await projectAccess.applyApprovedChange(projectRoot, backupRoot, change, approved)
  return { applied: true, ...applied }
})

ipcMain.handle('nova:list-project-tests', async (event, projectId) => {
  const projectRoot = guardProjectAction(event, projectId)
  const project = await projectAccess.scanProject(projectRoot)
  return projectAccess.detectTestCommands(projectRoot, project.files)
})

ipcMain.handle('nova:run-project-test', async (event, projectId, commandId, approved) => {
  const projectRoot = guardProjectAction(event, projectId)
  const project = await projectAccess.scanProject(projectRoot)
  const commands = projectAccess.detectTestCommands(projectRoot, project.files)
  const command = projectAccess.approvedTestCommand(commands, commandId, approved)
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Run approved test'],
    defaultId: 0,
    cancelId: 0,
    message: `Run ${command.label}?`,
    detail: 'Project test commands may execute project code. Nova does not run commands automatically.',
  })
  if (confirmation.response !== 1) return { approved: false, output: '' }
  assertProjectId(selectedProjectId, projectId)

  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32'
    const child = spawn(windows ? `${command.executable}.cmd` : command.executable, command.args, {
      cwd: projectRoot,
      windowsHide: true,
      shell: windows,
      env: projectAccess.testEnvironment(process.env),
    })
    let output = ''
    let settled = false
    let outputTruncated = false
    const terminate = () => {
      if (windows && child.pid) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', error => {
          console.error('Could not terminate the test process tree:', error.message)
          child.kill()
        })
      } else {
        child.kill()
      }
    }
    const append = chunk => {
      if (outputTruncated) return
      output += chunk.toString()
      if (output.length > 1_000_000) {
        output = `${output.slice(0, 1_000_000)}\n[Output truncated at 1 MB.]`
        outputTruncated = true
        terminate()
      }
    }
    const timeout = setTimeout(() => {
      append('\n[Test command timed out after 5 minutes.]')
      terminate()
    }, 5 * 60 * 1000)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ approved: true, command: command.label, exitCode: code, output: projectAccess.sanitizeContent(output).content })
    })
  })
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
  backendProcess = spawn(executable, args, {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NOVA_DATABASE_URL: process.env.NOVA_DATABASE_URL || `sqlite:///${path.join(app.getPath('userData'), 'nova.db').replace(/\\/g, '/')}`,
      NOVA_LOCAL_PROJECT_TOOLS: '1',
    },
  })
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
