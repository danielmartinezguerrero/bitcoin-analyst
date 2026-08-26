/**
 * The bridge between the sandboxed UI and the main process.
 * Only these calls exist — the renderer cannot reach anything else.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runAnalysis: (options) => ipcRenderer.invoke('run-analysis', options),
  getPositioning: () => ipcRenderer.invoke('get-positioning'),
  getValidation: () => ipcRenderer.invoke('get-validation'),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_e, message) => callback(message));
  },
  getCollectorHealth: () => ipcRenderer.invoke('get-collector-health'),
  /**
   * Startup collection reports its outcome here. The renderer only listens —
   * it cannot start a collection, which keeps a reload from firing one.
   */
  onCollector: (callback) => {
    ipcRenderer.on('collector', (_e, payload) => callback(payload));
  },
});
