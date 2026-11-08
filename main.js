'use strict';
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  screen,
  desktopCapturer,
  nativeImage,
  shell,
  dialog,
  session,
  clipboard,
  Notification,
} = require('electron');
const fs = require('fs');
const path = require('path');

const ocr = require('./src/ocr');
const mouse = require('./src/mouse');
const tts = require('./src/tts');
const T = require('./src/text-tools');

const APP_ID = 'id.hendrayana.bacalayar';
const ASSETS = path.join(__dirname, 'assets');

// ---------------- Pengaturan ----------------
const DEFAULTS = {
  ocrEngine: 'tesseract',
  ocrLang: 'ind+eng',
  cleanWatermark: true,
  watermarkThreshold: 170,
  tidyText: true,
  autoSpeak: true,
  appendText: false,
  voiceId: '',
  rate: 1.0,
  scrollNotches: 5,
  scrollDelayMs: 900,
  autoScrollNotches: 1,
  autoScrollIntervalMs: 1500,
  recSystemAudio: true,
  recMic: false,
  recQuality: 'standard',
  recFps: 30,
  recCountdown: true,
  recHideWindow: true,
  recFolder: '',
  closeToTray: true,
  trayHintShown: false,
  openAtLogin: false,
};
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'pengaturan.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (_) {
    settings = { ...DEFAULTS };
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Gagal simpan pengaturan', e);
  }
}
function recFolder() {
  return settings.recFolder || path.join(app.getPath('videos'), 'Baca Layar');
}

// ---------------- Jendela utama ----------------
let mainWindow = null;
let tray = null;
let quitting = false;
let uiState = { reading: false, continuous: false, autoScroll: false, recording: false };

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    title: 'Baca Layar',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#14171f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    if (quitting || !settings.closeToTray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!settings.trayHintShown && Notification.isSupported()) {
      new Notification({
        title: 'Baca Layar tetap berjalan',
        body: 'Aplikasi ada di tray (pojok kanan bawah). Hotkey tetap aktif. Klik kanan ikon untuk keluar.',
        icon: path.join(ASSETS, 'icon.png'),
      }).show();
      settings.trayHintShown = true;
      saveSettings();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^ms-settings:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function showMain(inactive = false) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (inactive) mainWindow.showInactive();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Sembunyikan jendela utama bila menutupi area yang mau ditangkap. */
async function hideMainIfCovering(areaAbs) {
  if (!mainWindow || !mainWindow.isVisible() || mainWindow.isMinimized()) return false;
  if (areaAbs && !rectsOverlap(mainWindow.getBounds(), areaAbs)) return false;
  mainWindow.hide();
  await sleep(260); // tunggu animasi tutup jendela Windows selesai
  return true;
}

// ---------------- Tangkap layar & pilih area ----------------
let lastRegion = null; // { displayId, rect (DIP, relatif ke layar) }
let prevContinuousLines = null;

async function captureDisplay(display) {
  const s = display.scaleFactor || 1;
  const thumbnailSize = { width: Math.round(display.size.width * s), height: Math.round(display.size.height * s) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const src = sources.find((x) => x.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) throw new Error('Layar tidak bisa ditangkap.');
  return src.thumbnail;
}

function cropDip(thumb, display, rect) {
  const size = thumb.getSize();
  const rx = size.width / display.bounds.width;
  const ry = size.height / display.bounds.height;
  const x = Math.max(0, Math.round(rect.x * rx));
  const y = Math.max(0, Math.round(rect.y * ry));
  const w = Math.min(size.width - x, Math.round(rect.width * rx));
  const h = Math.min(size.height - y, Math.round(rect.height * ry));
  return thumb.crop({ x, y, width: w, height: h });
}

let overlayWin = null;

function pickArea(display, thumb) {
  return new Promise((resolve) => {
    const b = display.bounds;
    overlayWin = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    const win = overlayWin;
    win.setAlwaysOnTop(true, 'screen-saver');
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('overlay:done', onDone);
      if (!win.isDestroyed()) win.destroy();
      overlayWin = null;
      resolve(rect);
    };
    const onDone = (e, rect) => {
      if (e.sender === win.webContents) finish(rect);
    };
    ipcMain.on('overlay:done', onDone);
    win.on('closed', () => finish(null));
    win.on('blur', () => {
      // Tetap di depan; batal bila pengguna pindah aplikasi dengan Alt+Tab
      setTimeout(() => !done && !win.isDestroyed() && !win.isFocused() && finish(null), 400);
    });
    win.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    win.webContents.once('did-finish-load', () => {
      win.setBounds(b); // dua kali agar pas di layar dengan skala berbeda
      win.setBounds(b);
      win.webContents.send('overlay:init', {
        image: 'data:image/jpeg;base64,' + thumb.toJPEG(90).toString('base64'),
        width: b.width,
        height: b.height,
      });
      win.show();
      win.focus();
    });
  });
}

let ocrBusy = false;

async function selectAndRecognize() {
  if (ocrBusy || overlayWin) return { error: 'Masih memproses, tunggu sebentar.' };
  ocrBusy = true;
  let hidden = false;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    hidden = await hideMainIfCovering(display.bounds);
    const thumb = await captureDisplay(display);
    const rect = await pickArea(display, thumb);
    if (!rect || rect.width < 6 || rect.height < 6) return { cancelled: true };
    lastRegion = { displayId: display.id, rect };
    prevContinuousLines = null;
    send('region:changed', regionInfo());
    send('ocr:progress', 'Membaca teks…');
    const res = await ocr.recognize(nativeImage, cropDip(thumb, display, rect), settings);
    return { text: res.text, engine: res.engine, note: res.note, lineCount: res.lines.length };
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    if (hidden) showMain(true);
    ocrBusy = false;
  }
}

function regionDisplay() {
  if (!lastRegion) return null;
  return screen.getAllDisplays().find((d) => d.id === lastRegion.displayId) || null;
}
function regionAbs() {
  const d = regionDisplay();
  if (!d) return null;
  const r = lastRegion.rect;
  return { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.width, height: r.height };
}
function regionInfo() {
  const a = regionAbs();
  return a ? { width: Math.round(a.width), height: Math.round(a.height) } : null;
}

/**
 * Baca ulang area terakhir.
 * opt.continuous: mode Baca Terus -> buang baris yang sudah dibaca, deteksi akhir halaman.
 * opt.reset: mulai sesi Baca Terus baru.
 * opt.keepHidden: biarkan jendela tersembunyi setelah selesai.
 */
async function recognizeLast(opt = {}) {
  if (!lastRegion) return { error: 'NO_REGION' };
  const display = regionDisplay();
  if (!display) return { error: 'Layar untuk area ini tidak ditemukan. Pilih area lagi.' };
  if (ocrBusy) return { error: 'Masih memproses, tunggu sebentar.' };
  ocrBusy = true;
  let hidden = false;
  try {
    hidden = await hideMainIfCovering(regionAbs());
    const thumb = await captureDisplay(display);
    const img = cropDip(thumb, display, lastRegion.rect);
    const res = await ocr.recognize(nativeImage, img, settings, { dropEdges: !!opt.continuous });
    if (!opt.continuous) return { text: res.text, engine: res.engine, note: res.note, lineCount: res.lines.length };

    if (opt.reset) prevContinuousLines = null;
    let lines = res.lines;
    let same = false;
    let anchored = true;
    if (prevContinuousLines) {
      const d = T.newLinesAfterScroll(prevContinuousLines, res.lines);
      lines = d.lines;
      same = d.same;
      anchored = d.anchored;
    }
    prevContinuousLines = res.lines;
    const text = T.linesToText(lines, { tidy: settings.tidyText, removeNoise: settings.cleanWatermark });
    return { text, same, anchored, engine: res.engine, note: res.note };
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    if (hidden && !opt.keepHidden) showMain(true);
    ocrBusy = false;
  }
}

// ---------------- Gulir mouse ----------------
function toPhysical(p) {
  if (typeof screen.dipToScreenPoint === 'function') return screen.dipToScreenPoint(p);
  return p;
}

async function doScroll({ at, notches, keepHidden }) {
  let point = null;
  let hidden = false;
  if (at === 'region') {
    const a = regionAbs();
    if (!a) return { error: 'NO_REGION' };
    // Jendela kita menutupi tengah area -> sembunyikan dulu agar roda mouse sampai ke halaman
    const c = { x: a.x + a.width / 2, y: a.y + a.height / 2, width: 1, height: 1 };
    hidden = await hideMainIfCovering(c);
    point = toPhysical({ x: Math.round(c.x), y: Math.round(c.y) });
  }
  try {
    const via = await mouse.scroll(point, notches, true);
    return { ok: true, via };
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    if (hidden && !keepHidden) {
      await sleep(150);
      showMain(true);
    }
  }
}

// ---------------- Hotkey ----------------
const HOTKEYS = {
  select: 'Ctrl+Alt+O',
  reread: 'Ctrl+Alt+L',
  continuous: 'Ctrl+Alt+B',
  scrollDown: 'Ctrl+Alt+PageDown',
  scrollUp: 'Ctrl+Alt+PageUp',
  autoScroll: 'Ctrl+Alt+G',
  record: 'Ctrl+Alt+R',
  stopAll: 'Ctrl+Alt+X',
};
const hotkeyStatus = {};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  for (const [action, accel] of Object.entries(HOTKEYS)) {
    const accelerator = accel.replace('Ctrl', 'CommandOrControl');
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => onHotkey(action));
    } catch (_) {
      ok = false;
    }
    hotkeyStatus[action] = ok;
  }
}

function onHotkey(action) {
  if (action === 'scrollDown' || action === 'scrollUp') {
    // Hotkey gulir: langsung di posisi mouse, tanpa lewat jendela
    const n = Math.max(1, settings.scrollNotches);
    doScroll({ at: 'cursor', notches: action === 'scrollUp' ? -n : n });
    return;
  }
  send('hotkey', action);
}

// ---------------- Tray ----------------
function trayIcon(recording) {
  const img = nativeImage.createFromPath(path.join(ASSETS, recording ? 'tray-rec.png' : 'tray.png'));
  return img.isEmpty() ? nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16 }) : img;
}

function buildTrayMenu() {
  if (!tray) return;
  const s = uiState;
  const menu = Menu.buildFromTemplate([
    { label: 'Pilih area & baca\t' + HOTKEYS.select, click: () => send('hotkey', 'select') },
    { label: 'Baca ulang area\t' + HOTKEYS.reread, click: () => send('hotkey', 'reread'), enabled: !!lastRegion },
    {
      label: (s.continuous ? 'Hentikan Baca Terus' : 'Baca Terus (baca + gulir)') + '\t' + HOTKEYS.continuous,
      click: () => send('hotkey', 'continuous'),
    },
    {
      label: (s.autoScroll ? 'Hentikan gulir otomatis' : 'Gulir otomatis') + '\t' + HOTKEYS.autoScroll,
      click: () => send('hotkey', 'autoScroll'),
    },
    { type: 'separator' },
    { label: (s.recording ? 'Stop rekam' : 'Rekam layar') + '\t' + HOTKEYS.record, click: () => send('hotkey', 'record') },
    { label: 'Hentikan semua\t' + HOTKEYS.stopAll, click: () => send('hotkey', 'stopAll') },
    { type: 'separator' },
    { label: 'Tampilkan Baca Layar', click: () => showMain() },
    {
      label: 'Keluar',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  let tip = 'Baca Layar';
  if (s.recording) tip += ' — sedang merekam';
  else if (s.continuous) tip += ' — Baca Terus aktif';
  else if (s.reading) tip += ' — membacakan';
  else if (s.autoScroll) tip += ' — gulir otomatis';
  tray.setToolTip(tip);
  tray.setImage(trayIcon(s.recording));
}

function createTray() {
  tray = new Tray(trayIcon(false));
  tray.on('click', () => showMain());
  buildTrayMenu();
}

// ---------------- Rekam layar ----------------
let pendingSource = null; // { id, audio }
let recStream = null;
let recPath = null;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const want = pendingSource && pendingSource.id;
        const src = sources.find((s) => s.id === want) || sources.find((s) => s.id.startsWith('screen:'));
        if (!src) return callback({});
        const resp = { video: src };
        if (pendingSource && pendingSource.audio && request.audioRequested && process.platform === 'win32') {
          resp.audio = 'loopback';
        }
        callback(resp);
      } catch (e) {
        console.error(e);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission));
  });
}

// ---------------- IPC ----------------
function registerIpc() {
  ipcMain.handle('settings:get', () => ({ ...settings }));
  ipcMain.handle('settings:set', (e, patch) => {
    settings = { ...settings, ...patch };
    saveSettings();
    if ('openAtLogin' in patch && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, args: ['--hidden'] });
    }
    if ('ocrLang' in patch && settings.ocrEngine === 'tesseract') ocr.warmUp(settings.ocrLang);
    return { ...settings };
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    hotkeys: HOTKEYS,
    hotkeyStatus,
    recFolder: recFolder(),
    region: regionInfo(),
  }));
  ipcMain.handle('app:state', (e, st) => {
    uiState = { ...uiState, ...st };
    buildTrayMenu();
  });

  ipcMain.handle('ocr:select', () => selectAndRecognize());
  ipcMain.handle('ocr:last', (e, opt) => recognizeLast(opt || {}));
  ipcMain.handle('region:info', () => regionInfo());
  ipcMain.handle('region:clear', () => {
    lastRegion = null;
    prevContinuousLines = null;
    return null;
  });
  ipcMain.handle('mouse:scroll', (e, opt) => doScroll(opt || {}));
  ipcMain.handle('cursor:onOwnWindow', () => {
    if (!mainWindow || !mainWindow.isVisible()) return false;
    const p = screen.getCursorScreenPoint();
    return rectsOverlap(mainWindow.getBounds(), { x: p.x, y: p.y, width: 1, height: 1 });
  });

  ipcMain.handle('tts:voices', async () => {
    try {
      return await tts.listVoices();
    } catch (e) {
      return { voices: [], defaultId: '', error: e.message };
    }
  });
  ipcMain.handle('tts:synth', async (e, { text, voiceId, rate }) => {
    try {
      const wav = await tts.synth(text, voiceId, rate);
      return { wav };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('rec:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    const screens = sources.filter((x) => x.id.startsWith('screen:')).length;
    let n = 0;
    return sources
      .filter((s) => !/^Baca Layar$/.test(s.name))
      .map((s) => {
        const isScreen = s.id.startsWith('screen:');
        if (isScreen) n++;
        return {
          id: s.id,
          name: isScreen ? (screens > 1 ? `Layar ${n}` : 'Seluruh layar') : s.name,
          screen: isScreen,
          thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
        };
      });
  });
  ipcMain.handle('rec:useSource', (e, src) => {
    pendingSource = src;
  });
  ipcMain.handle('rec:begin', (e, { ext }) => {
    const dir = recFolder();
    fs.mkdirSync(dir, { recursive: true });
    recPath = path.join(dir, `Rekaman ${stamp()}.${ext === 'mp4' ? 'mp4' : 'webm'}`);
    recStream = fs.createWriteStream(recPath);
    return recPath;
  });
  ipcMain.handle(
    'rec:chunk',
    (e, data) =>
      new Promise((resolve) => {
        if (!recStream) return resolve(false);
        recStream.write(Buffer.from(data), () => resolve(true));
      })
  );
  ipcMain.handle(
    'rec:end',
    () =>
      new Promise((resolve) => {
        if (!recStream) return resolve(recPath);
        const p = recPath;
        recStream.end(() => resolve(p));
        recStream = null;
      })
  );
  ipcMain.handle('rec:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Pilih folder untuk menyimpan rekaman',
      defaultPath: recFolder(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return recFolder();
    settings.recFolder = r.filePaths[0];
    saveSettings();
    return recFolder();
  });

  ipcMain.handle('file:saveText', async (e, text) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Simpan teks',
      defaultPath: path.join(app.getPath('documents'), `Baca Layar ${stamp()}.txt`),
      filters: [{ name: 'Teks', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, '﻿' + String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
    return r.filePath;
  });
  ipcMain.handle('clip:write', (e, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('shell:open', (e, p) => shell.openPath(p));
  ipcMain.handle('shell:showItem', (e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openFolder', () => {
    fs.mkdirSync(recFolder(), { recursive: true });
    return shell.openPath(recFolder());
  });
  ipcMain.handle('shell:external', (e, url) => {
    if (/^(https?:|ms-settings:)/.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('update:install', () => {
    if (!updater) return;
    quitting = true;
    updater.quitAndInstall(true, true);
  });
  ipcMain.handle('win:hide', () => mainWindow && mainWindow.hide());
  ipcMain.handle('win:show', (e, inactive) => showMain(!!inactive));
  ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
}

// ---------------- Update otomatis (GitHub Releases) ----------------
let updater = null;
function setupUpdater() {
  if (!app.isPackaged || process.env.BACA_LAYAR_SELFTEST) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch (_) {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-downloaded', (info) => send('update:ready', info && info.version));
  updater.on('error', (e) => mouse.logError('update: ' + (e && e.message)));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
}

// ---------------- Mulai ----------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    loadSettings();
    registerIpc();
    setupDisplayMedia();
    createMainWindow();
    createTray();
    registerHotkeys();
    setupUpdater();
    if (settings.ocrEngine === 'tesseract') setTimeout(() => ocr.warmUp(settings.ocrLang), 1500);
    if (process.env.BACA_LAYAR_SELFTEST) require('./test/selftest')(mainWindow, { ocr, nativeImage, settings, app });
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    // tetap hidup di tray
  });
}
