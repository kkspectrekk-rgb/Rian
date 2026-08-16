const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('settings:save-key', apiKey),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-key'),
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
  onQuotaUpdated: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('quota:updated', listener);
    return () => ipcRenderer.removeListener('quota:updated', listener);
  },
});
