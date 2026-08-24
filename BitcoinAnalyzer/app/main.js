/**
 * Electron main process.
 *
 * The renderer never touches the network or the filesystem directly: it asks
 * this process through a narrow, explicit IPC surface defined in preload.js.
 * That is the standard Electron security model — context isolation on, node
 * integration off — and it keeps a bug in the UI from becoming a bug with
 * filesystem access.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let win = null;

// Writable data location: works both from source and inside a packaged .exe.
process.env.BTC_DATA_DIR = path.join(app.getPath('userData'), 'data');

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'Bitcoin Analyzer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // External links open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/** Progress messages stream back to the UI while work is in flight. */
function progress(message) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', message);
}

// ------------------------------------------------------------------ IPC

ipcMain.handle('run-analysis', async (_event, options = {}) => {
  try {
    const { runAnalysis, explain } = await import('../core/engine.mjs');
    const result = await runAnalysis({ ...options, onProgress: progress });
    return { ok: true, result, explanation: explain(result) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-positioning', async () => {
  try {
    const { fetchPositioning, fetchFunding } = await import('../core/data.mjs');
    const [positioning, funding] = await Promise.all([fetchPositioning(), fetchFunding()]);
    return { ok: true, positioning, funding };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-validation', async () => {
  const { VALIDATION } = await import('../core/engine.mjs');
  return VALIDATION;
});
