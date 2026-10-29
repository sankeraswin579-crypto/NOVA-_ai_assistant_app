const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('novaDesktop', {
  platform: process.platform,
  desktop: true,
  getApiUrl: () => ipcRenderer.invoke('nova:get-api-url'),
  setApiUrl: (url) => ipcRenderer.invoke('nova:set-api-url', url),
})
