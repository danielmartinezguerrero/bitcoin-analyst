/**
 * The bridge between the sandboxed UI and the main process.
 * Only these four calls exist — the renderer cannot reach anything else.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runAnalysis: (options) => ipcRenderer.invoke('run-analysis', options),
  getPositioning: () => ipcRenderer.invoke('get-positioning'),
  getValidation: () => ipcRenderer.invoke('get-validation'),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_e, message) => callback(message));
  },
});
