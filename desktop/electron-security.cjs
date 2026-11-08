const path = require('path')
const { fileURLToPath } = require('url')

function isTrustedRenderer(sender, senderFrame, mainWindow, isDev, resourcesPath) {
  if (sender !== mainWindow?.webContents || senderFrame !== sender.mainFrame) return false
  const rendererUrl = senderFrame.url
  if (isDev) {
    try { return new URL(rendererUrl).origin === 'http://127.0.0.1:5173' } catch { return false }
  }
  try {
    return path.resolve(fileURLToPath(rendererUrl)) === path.resolve(resourcesPath, 'frontend', 'index.html')
  } catch {
    return false
  }
}

function assertTrustedRenderer(event, mainWindow, isDev, resourcesPath) {
  if (!isTrustedRenderer(event.sender, event.senderFrame, mainWindow, isDev, resourcesPath)) {
    throw new Error('This action is only available to the Nova application.')
  }
}

function assertProjectId(selectedProjectId, requestProjectId) {
  if (!selectedProjectId || requestProjectId !== selectedProjectId) {
    throw new Error('The selected project changed. Refresh and retry.')
  }
}

module.exports = { assertProjectId, assertTrustedRenderer, isTrustedRenderer }
