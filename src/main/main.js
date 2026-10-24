'use strict';
const {
  app, BrowserWindow, Tray, Menu, Notification, ipcMain, globalShortcut,
  powerMonitor, screen, nativeImage, dialog, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const L = require('../shared/logic');
const { Store } = require('./store');
const { createActions } = require('./actions');
const { tick } = require('./scheduler');

const APP_ID = 'com.questbook.app';
const THEME_BAR = { dark: ['#0E0D14', '#ECE6D8'], light: ['#F1E9D8', '#2A2318'], scroll: ['#271A0F', '#F2E2B8'], arcane: ['#0A0F1E', '#E4ECFF'] };
function themeBar() { return THEME_BAR[store.state.settings.theme] || THEME_BAR.dark; }
const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'build');
const isDev = !app.isPackaged;
const startHidden = process.argv.includes('--hidden');

app.commandLine.appendSwitch('lang', 'ru');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId(isDev ? process.execPath : APP_ID);

let store, actions, tray;
const win = { main: null, hud: null, capture: null, overlay: null };
let lastAlert = null; // mirrored into the HUD so a missed toast is still visible
let overlayHabitId = null;
let quitting = false;

// ---------------------------------------------------------------- helpers
function iconPath(name) { return path.join(ASSETS, name); }
function payload() {
  const view = L.buildView(store.state);
  return {
    state: store.state, view,
    alert: lastAlert && Date.now() - lastAlert.at < 30 * 60000 ? lastAlert : null,
    app: { version: app.getVersion(), update: updateStatus, packaged: app.isPackaged },
  };
}

// ---------------------------------------------------------------- auto-update (GitHub Releases)
let updateStatus = { state: 'idle' };
let autoUpdater = null;
function setUpdate(st) { updateStatus = { ...st, at: Date.now() }; if (store) broadcast(); }

function setupUpdater() {
  if (!app.isPackaged) { updateStatus = { state: 'dev' }; return; }
  try { ({ autoUpdater } = require('electron-updater')); } catch (_) { updateStatus = { state: 'error', message: 'модуль обновлений не найден' }; return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }));
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    setUpdate({ state: 'ready', version: i.version });
    notify({ title: `Обновление ${i.version} готово`, body: 'Установится при следующем запуске. Или: Настройки → Обновить сейчас.', open: 'settings' });
  });
  autoUpdater.on('error', (e) => setUpdate({ state: 'error', message: String((e && e.message) || e).split('\n')[0].slice(0, 160) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* reported via 'error' */ });
  setTimeout(check, 15000);
  setInterval(check, 6 * 3600000);
}
function broadcast() {
  const p = payload();
  for (const w of Object.values(win)) if (w && !w.isDestroyed()) w.webContents.send('state', p);
  updateTray(p.view);
}
function commit(result) { store.save(); broadcast(); return result; }

function webPrefs() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };
}

// ---------------------------------------------------------------- windows
function createMain(show = true) {
  if (win.main && !win.main.isDestroyed()) { if (show) { win.main.show(); win.main.focus(); } return win.main; }
  win.main = new BrowserWindow({
    width: 1120, height: 780, minWidth: 820, minHeight: 600, show: false,
    backgroundColor: themeBar()[0], title: 'Questbook', icon: iconPath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: themeBar()[0], symbolColor: themeBar()[1], height: 40 },
    webPreferences: webPrefs(),
  });
  win.main.loadFile(path.join(RENDERER, 'index.html'));
  win.main.once('ready-to-show', () => { if (show) win.main.show(); });
  win.main.on('close', (e) => { if (!quitting) { e.preventDefault(); win.main.hide(); } });
  return win.main;
}

function openMain(view) {
  const w = createMain(true);
  const send = () => w.webContents.send('nav', view);
  if (view) { if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send(); }
}

function hudDefaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 328, y: wa.y + wa.height - 300, width: 328, height: 300 };
}

const SNAP = 36; // px: closer than this to the taskbar/screen edge -> stick to it

/** Where the HUD grows from and whether it is "docked" to the taskbar edge. */
function hudLayout(b) {
  const wa = screen.getDisplayMatching(b).workArea;
  let anchor = store.state.settings.hudAnchor || 'auto';
  if (anchor === 'auto') anchor = b.y + b.height / 2 > wa.y + wa.height / 2 ? 'bottom' : 'top';
  const bottomGap = wa.y + wa.height - (b.y + b.height);
  const rightGap = wa.x + wa.width - (b.x + b.width);
  return { wa, anchor, dockBottom: anchor === 'bottom' && bottomGap <= SNAP, dockRight: rightGap <= SNAP };
}

function sendHudLayout(l) {
  if (win.hud && !win.hud.isDestroyed()) win.hud.webContents.send('hud:layout', { anchor: l.anchor, dockBottom: l.dockBottom, dockRight: l.dockRight });
}

/** Snap to the taskbar / right edge after a drag. */
function snapHud() {
  if (!win.hud || win.hud.isDestroyed()) return;
  const b = win.hud.getBounds();
  const l = hudLayout(b);
  const nb = { ...b };
  if (l.dockBottom) nb.y = l.wa.y + l.wa.height - b.height;
  if (l.dockRight) nb.x = l.wa.x + l.wa.width - b.width;
  if (nb.x !== b.x || nb.y !== b.y) win.hud.setBounds(nb);
  store.state.settings.hudBounds = nb;
  store.save();
  sendHudLayout(l);
}

/** Resize to content height, keeping the anchored edge in place. */
function resizeHud(height) {
  if (!win.hud || win.hud.isDestroyed()) return;
  const b = win.hud.getBounds();
  const h = Math.max(48, Math.min(720, Math.round(height)));
  if (b.height === h) return;
  const l = hudLayout(b);
  let y = b.y;
  if (l.dockBottom) y = l.wa.y + l.wa.height - h;
  else if (l.anchor === 'bottom') y = b.y + b.height - h;
  y = Math.max(l.wa.y, Math.min(y, l.wa.y + l.wa.height - h));
  const nb = { x: b.x, y, width: b.width, height: h };
  win.hud.setBounds(nb);
  store.state.settings.hudBounds = nb;
  store.save();
}

function createHud() {
  if (win.hud && !win.hud.isDestroyed()) return win.hud;
  const s = store.state.settings;
  let b = s.hudBounds || hudDefaultBounds();
  // keep on a visible display
  const visible = screen.getAllDisplays().some((d) => b.x >= d.workArea.x - 50 && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y - 50 && b.y < d.workArea.y + d.workArea.height);
  if (!visible) b = hudDefaultBounds();
  win.hud = new BrowserWindow({
    ...b, width: 328, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    skipTaskbar: true, alwaysOnTop: s.hudOnTop, show: false, hasShadow: false, focusable: true,
    title: 'Questbook HUD', webPreferences: webPrefs(),
  });
  if (s.hudOnTop) win.hud.setAlwaysOnTop(true, 'floating');
  win.hud.loadFile(path.join(RENDERER, 'hud.html'));
  win.hud.once('ready-to-show', () => { if (store.state.settings.hudEnabled) win.hud.showInactive(); });
  win.hud.webContents.on('did-finish-load', () => sendHudLayout(hudLayout(win.hud.getBounds())));
  win.hud.on('moved', snapHud);
  win.hud.on('closed', () => { win.hud = null; });
  return win.hud;
}

function setHudVisible(v) {
  store.state.settings.hudEnabled = v;
  const h = createHud();
  if (v) h.showInactive(); else h.hide();
  commit();
}

function createCapture() {
  if (win.capture && !win.capture.isDestroyed()) return win.capture;
  win.capture = new BrowserWindow({
    width: 640, height: 330, frame: false, transparent: true, resizable: false, show: false,
    skipTaskbar: true, alwaysOnTop: true, center: true, title: 'Новый квест', webPreferences: webPrefs(),
  });
  win.capture.loadFile(path.join(RENDERER, 'capture.html'));
  win.capture.on('blur', () => { if (win.capture && !win.capture.webContents.isDevToolsOpened()) win.capture.hide(); });
  return win.capture;
}

function showCapture() {
  const c = createCapture();
  const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  c.setPosition(Math.round(cur.x + (cur.width - 640) / 2), Math.round(cur.y + cur.height * 0.2));
  c.show(); c.focus();
  c.webContents.send('capture:open');
}

function showOverlay(habitId) {
  overlayHabitId = habitId;
  if (!win.overlay || win.overlay.isDestroyed()) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.overlay = new BrowserWindow({
      ...d.bounds, frame: false, transparent: true, resizable: false, movable: false, show: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, title: 'Questbook', webPreferences: webPrefs(),
    });
    win.overlay.setAlwaysOnTop(true, 'screen-saver');
    win.overlay.loadFile(path.join(RENDERER, 'overlay.html'));
    win.overlay.on('closed', () => { win.overlay = null; overlayHabitId = null; });
    win.overlay.webContents.once('did-finish-load', () => {
      win.overlay.webContents.send('overlay:habit', habitId);
      win.overlay.webContents.send('state', payload());
      win.overlay.show(); win.overlay.focus();
    });
  } else {
    win.overlay.webContents.send('overlay:habit', habitId);
    win.overlay.show(); win.overlay.focus();
  }
}

// ---------------------------------------------------------------- tray
function updateTray(view) {
  if (!tray) return;
  const n = view.next;
  const bed = view.bedtime ? `\n${view.bedtime.title}: ${view.bedtime.time}` : '';
  tray.setToolTip(`Questbook · ур. ${view.level.level}\n${n ? n.action : ''}${bed}`.slice(0, 127));
}

function buildTray() {
  const img = nativeImage.createFromPath(iconPath(process.platform === 'win32' ? 'tray.ico' : 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(iconPath('icon.png')).resize({ width: 16 }) : img);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Открыть книгу квестов', click: () => openMain('today') },
    { label: 'Новый квест…', accelerator: store.state.settings.hotkeyCapture, click: showCapture },
    { label: store.state.settings.hudEnabled ? 'Скрыть HUD' : 'Показать HUD', click: () => setHudVisible(!store.state.settings.hudEnabled) },
    { type: 'separator' },
    { label: 'Пауза активного квеста', enabled: !!store.state.activeQuestId, click: () => commit(actions.questPause()) },
    { label: 'Спланировать день', click: () => openMain('briefing') },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.on('click', () => setHudVisible(!store.state.settings.hudEnabled));
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
  tray.setContextMenu(null);
  if (process.platform !== 'win32') tray.setContextMenu(menu());
}

// ---------------------------------------------------------------- hotkeys & autostart
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const s = store.state.settings;
  const bad = [];
  try { if (!globalShortcut.register(s.hotkeyCapture, showCapture)) bad.push(s.hotkeyCapture); } catch (_) { bad.push(s.hotkeyCapture); }
  try { if (!globalShortcut.register(s.hotkeyHud, () => setHudVisible(!store.state.settings.hudEnabled))) bad.push(s.hotkeyHud); } catch (_) { bad.push(s.hotkeyHud); }
  return bad;
}

function applyAutostart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (isDev) return; // don't register electron.exe from node_modules
  app.setLoginItemSettings({ openAtLogin: !!store.state.settings.autostart, args: ['--hidden'] });
}

// ---------------------------------------------------------------- scheduler
function notify(ev) {
  lastAlert = { at: Date.now(), title: ev.title, body: ev.body, urgent: !!ev.urgent, soft: !!ev.soft };
  if (Notification.isSupported()) {
    const n = new Notification({ title: ev.title, body: ev.body, icon: iconPath('icon.png'), urgency: ev.urgent ? 'critical' : 'normal', timeoutType: ev.urgent ? 'never' : 'default' });
    n.on('click', () => {
      if (ev.open === 'hud') setHudVisible(true);
      else openMain(ev.open);
    });
    n.show();
  }
  if (win.hud && !win.hud.isDestroyed() && store.state.settings.hudEnabled) win.hud.showInactive();
}

function runTick() {
  const events = tick(store.state, {
    now: Date.now(),
    idleSec: powerMonitor.getSystemIdleTime(),
    overlayOpen: !!(win.overlay && !win.overlay.isDestroyed() && win.overlay.isVisible()),
  });
  for (const ev of events) {
    if (ev.kind === 'notify') notify(ev);
    else if (ev.kind === 'overlay') showOverlay(ev.habitId);
    else if (ev.kind === 'briefing') {
      store.state.meta.lastBriefing = L.dayKey(Date.now(), store.state.settings.dayStartHour);
      openMain('briefing');
    }
  }
  store.save();
  broadcast();
}

// ---------------------------------------------------------------- IPC
function setupIpc() {
  ipcMain.handle('get', () => payload());
  ipcMain.handle('act', (_e, name, args = []) => {
    if (typeof actions[name] !== 'function') return { ok: false, error: 'unknown action' };
    const r = actions[name](...args);
    if (name === 'settingsUpdate') {
      const s = store.state.settings;
      if (win.hud && !win.hud.isDestroyed()) { win.hud.setAlwaysOnTop(!!s.hudOnTop, 'floating'); snapHud(); }
      if (win.main && !win.main.isDestroyed()) {
        const [c, sc] = themeBar();
        try { win.main.setTitleBarOverlay({ color: c, symbolColor: sc, height: 40 }); } catch (_) { /* not supported on this OS */ }
        win.main.setBackgroundColor(c);
      }
      applyAutostart();
      const bad = registerHotkeys();
      if (bad.length) r.error = `Не удалось занять сочетание: ${bad.join(', ')}`;
    }
    if (r && r.levelUp) notify({ title: `Новый уровень: ${r.levelUp}`, body: `Звание: ${L.levelTitle(r.levelUp)}`, open: 'chronicle' });
    return commit(r);
  });
  ipcMain.on('ui', (e, cmd, arg) => {
    switch (cmd) {
      case 'openMain': openMain(arg); break;
      case 'hudToggle': setHudVisible(!store.state.settings.hudEnabled); break;
      case 'hudHide': setHudVisible(false); break;
      case 'hudHeight': resizeHud(arg); break;
      case 'capture': showCapture(); break;
      case 'captureClose': if (win.capture) win.capture.hide(); break;
      case 'captureHeight':
        if (win.capture && !win.capture.isDestroyed()) {
          const b = win.capture.getBounds();
          const h = Math.max(160, Math.min(560, Math.round(arg)));
          if (b.height !== h) win.capture.setBounds({ ...b, height: h });
        }
        break;
      case 'overlayClose': if (win.overlay && !win.overlay.isDestroyed()) win.overlay.close(); break;
      case 'dismissAlert': lastAlert = null; broadcast(); break;
      case 'openDataDir': shell.openPath(app.getPath('userData')); break;
      case 'openUrl':
        try { const u = new URL(String(arg)); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch (_) { /* ignore invalid */ }
        break;
      case 'updateCheck': if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {}); break;
      case 'updateInstall': if (autoUpdater && updateStatus.state === 'ready') { quitting = true; store.save(true); autoUpdater.quitAndInstall(true, true); } break;
      default: break;
    }
  });
  ipcMain.handle('export', async () => {
    const r = await dialog.showSaveDialog(win.main, { defaultPath: `questbook-${L.dayKey(Date.now())}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify(store.state, null, 1));
    return { ok: true, toast: 'Экспорт сохранён' };
  });
  ipcMain.handle('import', async () => {
    const r = await dialog.showOpenDialog(win.main, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { ok: false };
    try {
      const { migrate } = require('./store');
      store.state = migrate(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
      return commit({ ok: true, toast: 'Данные загружены' });
    } catch (err) { return { ok: false, error: 'Файл не читается: ' + err.message }; }
  });
}

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => openMain('today'));
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { quitting = true; if (store) store.save(true); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  actions = createActions(() => store.state);
  // avoid an instant nudge right after boot
  store.state.meta.lastNudgeAt = Date.now() - Math.max(0, store.state.settings.nudgeIdleMin - 5) * 60000;
  if (store.state.activeQuestId && !store.state.activeSince) store.state.activeSince = Date.now();
  setupIpc();
  buildTray();
  registerHotkeys();
  applyAutostart();
  setupUpdater();
  createHud();
  if (!startHidden) openMain('today');
  global.__qb = { showOverlay, showCapture, openMain, broadcast, get store() { return store; } };
  setInterval(runTick, 30000);
  setTimeout(runTick, 4000);
  for (const ev of ['resume', 'unlock-screen', 'user-did-become-active']) powerMonitor.on(ev, () => setTimeout(runTick, 2000));
  powerMonitor.on('suspend', () => store.save(true));
  powerMonitor.on('lock-screen', () => { store.save(true); });
});
