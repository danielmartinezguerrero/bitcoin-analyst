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
  collectOnStartup();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * DERIVATIVES COLLECTION ON EVERY START.
 *
 * Binance keeps roughly 30 days of large-trader ratios, open interest and
 * taker ratio. They cannot be backtested today, and the only way to ever
 * measure them is to start accumulating now — a day not collected is a day
 * lost for good. Running it here means the dataset grows by simply using the
 * app, with no scheduled task to install and nothing to remember.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO:
 *
 * It does not block the window. createWindow() has already returned; this
 * runs afterwards and the UI never waits on the network for a dataset it does
 * not use to draw anything.
 *
 * It does not run inside the renderer. A page reload would fire it again, and
 * the collector would be at the mercy of the window's lifetime.
 *
 * It does not let a failure reach the user. A missing ancillary snapshot is
 * not worth an error dialog, and it must never be worth a window that fails
 * to open — so the promise is fully contained here. It is still reported to
 * the UI as a status line, because silence is how a broken collector goes
 * unnoticed for months.
 */
async function collectOnStartup() {
  try {
    const { collectDerivatives, seriesHealth } = await import('../core/collector.mjs');
    const r = await collectDerivatives({ onProgress: progress });

    const health = seriesHealth();
    if (win && !win.isDestroyed()) {
      win.webContents.send('collector', { ...r, health });
    }
    console.log('[collector] ' + r.status + ' ' + r.day
      + ' | records=' + health.records + ' days=' + health.days
      + (health.gaps ? ' gaps=' + health.gaps : '')
      + (r.error ? ' error=' + r.error : ''));
  } catch (err) {
    // Last line of defence: nothing about this dataset may break startup.
    console.error('[collector] unexpected failure:', err.message);
  }
}

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

/** Lets the UI ask about the collected series without triggering a collection. */
ipcMain.handle('get-collector-health', async () => {
  try {
    const { seriesHealth } = await import('../core/collector.mjs');
    return { ok: true, health: seriesHealth() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
