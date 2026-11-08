const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('novaDesktop', {
  platform: process.platform,
  desktop: true,
  getApiUrl: () => ipcRenderer.invoke('nova:get-api-url'),
  setApiUrl: (url) => ipcRenderer.invoke('nova:set-api-url', url),
  chooseProject: () => ipcRenderer.invoke('nova:choose-project'),
  refreshProject: (projectId) => ipcRenderer.invoke('nova:refresh-project', projectId),
  readProjectFiles: (projectId, paths) => ipcRenderer.invoke('nova:read-project-files', projectId, paths),
  searchProjectFiles: (projectId, files, query) => ipcRenderer.invoke('nova:search-project-files', projectId, files, query),
  retrieveProjectContext: (projectId, files, query, selectedPaths) => ipcRenderer.invoke('nova:retrieve-project-context', projectId, files, query, selectedPaths),
  applyProjectChange: (projectId, change, approved) => ipcRenderer.invoke('nova:apply-project-change', projectId, change, approved),
  listProjectTests: (projectId) => ipcRenderer.invoke('nova:list-project-tests', projectId),
  runProjectTest: (projectId, commandId, approved) => ipcRenderer.invoke('nova:run-project-test', projectId, commandId, approved),
  sanitizeProjectText: (projectId, text) => ipcRenderer.invoke('nova:sanitize-project-text', projectId, text),
})
