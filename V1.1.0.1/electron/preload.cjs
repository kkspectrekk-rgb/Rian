const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('musicBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('settings:save-key', apiKey),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-key'),
  saveCloseAction: (closeAction) => ipcRenderer.invoke('settings:save-close-action', closeAction),
  resolveClose: (decision) => ipcRenderer.invoke('app:resolve-close', decision),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  getLocalFilePath: (file) => webUtils.getPathForFile(file),
  readLocalMetadata: (filePath) => ipcRenderer.invoke('local:metadata', filePath),
  apiRequest: (path, params) => ipcRenderer.invoke('api:request', { path, params }),
  fetchCover: (url) => ipcRenderer.invoke('cover:fetch', url),
  getCachedTrack: (key) => ipcRenderer.invoke('cache:get-track', key),
  putCachedTrack: (key, track) => ipcRenderer.invoke('cache:put-track', key, track),
  hydrateCachedTracks: (items) => ipcRenderer.invoke('cache:hydrate-tracks', items),
  cacheAudio: (key, url) => ipcRenderer.invoke('cache:audio', key, url),
  getCachedSearch: (key) => ipcRenderer.invoke('cache:get-search', key),
  putCachedSearch: (key, results) => ipcRenderer.invoke('cache:put-search', key, results),
  getQuotaStatus: () => ipcRenderer.invoke('quota:get'),
  openQuotaLogin: () => ipcRenderer.invoke('quota:open-login'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onQuotaUpdated: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('quota:updated', listener);
    return () => ipcRenderer.removeListener('quota:updated', listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});
