const { app, BrowserWindow, WebContentsView, Tray, Menu, nativeImage, ipcMain, session, shell, dialog, protocol, powerMonitor } = require('electron');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { createHost } = require('./host.cjs');
const { createPresence } = require('./presence.cjs');
const { createPreferences } = require('./preferences.cjs');
const { createCodexSessions } = require('./codex-sessions.cjs');
let origin = 'http://127.0.0.1:4317';
const root = app.isPackaged ? JSON.parse(readFileSync(path.join(__dirname, 'runtime.json'), 'utf8')).root : path.resolve(__dirname, '..');
const testMode = process.env.NODE_ENV === 'test' && process.env.JARVIS_DESKTOP_TEST === '1';
const backgroundLaunch = process.argv.includes('--background');
app.setPath('userData', path.join(root, testMode ? '.test-data/desktop' : 'data/desktop'));
protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis-desktop', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let win, view, tray, presence, quitting = false, lastUrl = origin + '/#/command', polling = false;
  let workspaceId = 'owner', desktopLocked = false;
  const workspaces = [{ id: 'owner', label: 'Owner', origin }];
  try {
    const config = JSON.parse(readFileSync(path.join(root, 'data/instances.json'), 'utf8'));
    for (const p of config.profiles || []) if (/^[a-z][a-z0-9-]{0,39}$/.test(p.id) && p.id !== 'owner' && Number.isInteger(p.port) && p.port > 1024 && p.port < 65536 && ![4317,4318].includes(p.port)) workspaces.push({ id: p.id, label: p.displayName, origin: `http://127.0.0.1:${p.port}` });
  } catch {}
  const host = createHost({ root });
  const coding = createCodexSessions();
  let current = { running: false };
  const external = async url => {
    let parsed; try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return;
    const response = await dialog.showMessageBox(win, { type: 'question', title: 'Open in your browser', message: `Open ${parsed.hostname} in your browser?`, detail: 'JARVIS will stay open here.', buttons: ['Open browser', 'Cancel'], defaultId: 1, cancelId: 1 });
    if (response.response === 0) await shell.openExternal(url);
  };
  function trusted(url) { try { return new URL(url).origin === origin; } catch { return false; } }
  function disposeView() {
    if (!view) return;
    if (!view.webContents.isDestroyed()) { if (trusted(view.webContents.getURL())) lastUrl = view.webContents.getURL(); view.webContents.close(); }
    win.contentView.removeChildView(view); view = null;
  }
  function layout() { if (view) { const [width, height] = win.getContentSize(); view.setBounds({ x: 0, y: 52, width, height: Math.max(0, height - 52) }); } }
  function openView() {
    if (view || !win.isVisible() || !current.running) return;
    view = new WebContentsView({ webPreferences: { partition: 'persist:jarvis-app', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.contentView.addChildView(view); layout();
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => { void external(url); return { action: 'deny' }; });
    const navigation = (event, url) => {
      const target = workspaces.find(space => { try { return new URL(url).origin === space.origin && new URL(url).searchParams.get('switch') === '1'; } catch { return false; } });
      if (target) { event.preventDefault(); void switchWorkspace(target.id).catch(e => dialog.showErrorBox('JARVIS', e.message)); }
      else if (!trusted(url)) { event.preventDefault(); void external(url); }
    };
    contents.on('will-navigate', navigation); contents.on('will-redirect', navigation);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('render-process-gone', () => { disposeView(); });
    void contents.loadURL(lastUrl).catch(() => { if (view?.webContents === contents) disposeView(); });
  }
  function hide() { disposeView(); win.hide(); if (current.running) void presence.showIdle(); }
  function show() { win.show(); win.focus(); openView(); }
  async function refresh() {
    if (polling) return current; polling = true;
    try {
      const health = await host.status();
      if (health.running) await Promise.all(workspaces.map(async space => { try { const r = await fetch(space.origin + '/api/lock/status', { signal: AbortSignal.timeout(1000) }); if (r.ok) { const s = await r.json(); if (typeof s.label === 'string') space.label = s.label; } } catch {} }));
      current = { ...health, ...presence?.status(), workspaceId, workspaces: workspaces.map(({ id, label }) => ({ id, label })) };
      if (quitting || win.isDestroyed()) return current; if (current.running && !['stop', 'restart'].includes(current.busy)) openView(); else { disposeView(); presence?.disable(); } return current;
    }
    finally { polling = false; }
  }
  async function control(value) {
    if (value !== 'start') { presence?.disable(); coding.clear(); disposeView(); }
    try { return await host.action(value); } finally { await refresh(); }
  }
  function authorize(event) {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== 'jarvis-desktop://shell/index.html') throw new Error('Access denied.');
  }
  async function switchWorkspace(id) {
    const target = workspaces.find(item => item.id === id); if (!target) throw new Error('Unknown workspace.');
    presence.disable(); coding.clear(); disposeView();
    const appSession = session.fromPartition('persist:jarvis-app');
    for (const base of new Set([origin, target.origin])) {
      const response = await appSession.fetch(base + '/api/lock/lock', { method: 'POST', credentials: 'include', headers: { 'X-Second-Brain': '1', 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('The workspace could not be locked. Try again when the server is ready.');
    }
    origin = target.origin; workspaceId = id; lastUrl = origin + '/?setup=pin#/command'; presence.setOrigin(origin); openView(); return refresh();
  }
  app.on('second-instance', (_event, argv) => { if (win && !argv.includes('--background')) show(); });
  app.on('before-quit', () => { quitting = true; coding.clear(); presence?.close(); if (win) disposeView(); });
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    if (!existsSync(path.join(root, 'server/index.mjs'))) { dialog.showErrorBox('JARVIS workspace missing', 'Keep this desktop app with the original JARVIS workspace.'); app.quit(); return; }
    protocol.handle('jarvis-desktop', request => {
      const u = new URL(request.url), files = { '/index.html': 'text/html', '/renderer.js': 'text/javascript', '/shell.css': 'text/css' };
      if (u.host !== 'shell' || !files[u.pathname]) return new Response('Not found', { status: 404 });
      return new Response(readFileSync(path.join(__dirname, u.pathname.slice(1))), { headers: { 'Content-Type': files[u.pathname], 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'" } });
    });
    win = new BrowserWindow({ width: 1340, height: 930, minWidth: 880, minHeight: 650, title: 'JARVIS', backgroundColor: '#080e17', autoHideMenuBar: true, show: !testMode && !backgroundLaunch, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.on('resize', layout); win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const preferences = createPreferences(path.join(app.getPath('userData'), 'preferences.json'));
    powerMonitor.on('lock-screen', () => { desktopLocked = true; coding.clear(); });
    powerMonitor.on('suspend', () => { desktopLocked = true; coding.clear(); });
    powerMonitor.on('unlock-screen', () => { desktopLocked = false; });
    powerMonitor.on('resume', () => { desktopLocked = false; });
    const appSession = session.fromPartition('persist:jarvis-app');
    // Electron depends on the local server. Refresh cached executable web code on
    // desktop launch; preserve cookies, PIN sessions, local records and IndexedDB.
    await appSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    const toggleWake = async () => {
      if (!presence.status().wakeEnabled) {
        const response = await appSession.fetch(origin + '/api/lock/status', { credentials: 'include' });
        if (!response.ok || !(await response.json()).unlocked) throw new Error('Unlock this workspace before enabling wake listening.');
      }
      await presence.toggle(); return refresh();
    };
    async function codingAllowed() {
      const requestedOrigin = origin;
      if (workspaceId !== 'owner' || desktopLocked) return false;
      try {
        const response = await appSession.fetch(requestedOrigin + '/api/lock/status', { credentials: 'include', signal: AbortSignal.timeout(1200) });
        return response.ok && (await response.json()).unlocked === true && requestedOrigin === origin && workspaceId === 'owner' && !desktopLocked;
      } catch { return false; }
    }
    const readCoding = async () => {
      if (!(await codingAllowed())) { coding.clear(); return { enabled: preferences.codingEnabled(), locked: true, sessions: [], message: 'Unlock the primary JARVIS workspace to view coding sessions.' }; }
      if (!preferences.codingEnabled()) { coding.clear(); return { enabled: false, locked: false, sessions: [], message: 'Codex monitoring is paused.' }; }
      const result = await coding.scan();
      if (!(await codingAllowed())) { coding.clear(); return { enabled: true, locked: true, sessions: [], message: 'Unlock JARVIS to view coding sessions.' }; }
      if (!preferences.codingEnabled()) { coding.clear(); return { enabled: false, locked: false, sessions: [], message: 'Codex monitoring is paused.' }; }
      return { ...result, enabled: true, locked: false };
    };
    presence = createPresence({ win: () => win, tray: () => tray, origin, root, preferences, onOpen: show, requestWake: toggleWake,
      readCoding, clearCoding: () => coding.clear(), setCoding: async value => { if (!(await codingAllowed())) throw new Error('Unlock the primary JARVIS workspace first.'); preferences.setCodingEnabled(value); coding.clear(); return readCoding(); },
      openCoding: async id => { if (!(await codingAllowed()) || !preferences.codingEnabled() || !(await coding.openable(id))) throw new Error('This session is unavailable. Refresh the coding view.'); if (!(await codingAllowed()) || !preferences.codingEnabled()) throw new Error('Unlock JARVIS and resume monitoring first.'); await shell.openExternal('codex://threads/' + id.toLowerCase()); },
      running: () => current.running, settingsPath: path.join(app.getPath('userData'), 'preferences.json') });
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    appSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (permission !== 'media' || details.mediaType !== 'audio' || !trusted(requestingOrigin)) return false;
      if (presence.owns(wc)) return true;
      if (wc === view?.webContents && preferences.allowed('microphone', origin) && win.isVisible()) { presence.disable(); return true; }
      return false;
    });
    appSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      if (permission !== 'media' || !trusted(details.requestingUrl || wc.getURL()) || !details.mediaTypes?.length || details.mediaTypes.some(t => t !== 'audio')) return callback(false);
      if (presence.owns(wc)) return callback(true);
      if (wc !== view?.webContents || !win.isVisible()) return callback(false);
      presence.disable();
      const requestedOrigin = origin;
      let allowed = preferences.allowed('microphone', requestedOrigin);
      if (!allowed) {
        const choice = await dialog.showMessageBox(win, { type: 'question', title: 'JARVIS microphone', message: 'Allow JARVIS to use your microphone for Talk and dictation?', detail: 'Closing the main window stops its Talk capture. Separately enabled wake listening can continue in the island. Microphone access still starts only when you choose Talk or Wake.', buttons: ['Allow microphone', 'Cancel'], checkboxLabel: 'Remember my permission on this laptop', checkboxChecked: true, defaultId: 1, cancelId: 1 });
        allowed = choice.response === 0;
        if (allowed && choice.checkboxChecked && requestedOrigin === origin && wc === view?.webContents && win.isVisible()) preferences.allow('microphone', requestedOrigin);
      }
      callback(allowed && requestedOrigin === origin && wc === view?.webContents && win.isVisible());
    });
    ipcMain.handle('jarvis:status', event => { authorize(event); return refresh(); });
    ipcMain.handle('jarvis:action', (event, value) => { authorize(event); return control(value); });
    ipcMain.handle('jarvis:hide', event => { authorize(event); hide(); });
    ipcMain.handle('jarvis:wake', async event => {
      authorize(event);
      return toggleWake();
    });
    ipcMain.handle('jarvis:forget-microphone', event => { authorize(event); presence.disable(); preferences.forget(); return refresh(); });
    ipcMain.handle('jarvis:mode', (event, value) => { authorize(event); presence.setMode(value); return refresh(); });
    ipcMain.handle('jarvis:workspace', async (event, id) => {
      authorize(event); return switchWorkspace(id);
    });
    // Fixed native menu, available only to the trusted desktop toolbar. The
    // network-loaded app view has no preload or administrative bridge.
    ipcMain.handle('jarvis:controls', event => {
      authorize(event);
      const action = name => void control(name).catch(e => dialog.showErrorBox('JARVIS', e.message));
      Menu.buildFromTemplate([
        { label: 'Floating assistant', submenu: ['island', 'orb'].map(mode => ({ label: mode === 'island' ? 'Dynamic island' : 'Floating orb', type: 'radio', checked: presence.status().mode === mode, click: () => { presence.setMode(mode); void refresh(); } })) },
        { type: 'separator' },
        { label: 'Start server', enabled: !current.running && !current.busy, click: () => action('start') },
        { label: 'Restart server', enabled: current.running && !current.busy, click: () => action('restart') },
        { label: 'Stop server', enabled: current.running && !current.busy, click: () => action('stop') },
        { type: 'separator' },
        { label: 'Refresh app', enabled: !!view, click: () => view?.webContents.reload() },
        { label: 'Quit desktop (keep server running)', click: () => app.quit() },
      ]).popup({ window: win });
    });
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const i = (y * 32 + x) * 4, radius = Math.hypot(x - 15.5, y - 15.5); pixels[i] = 217; pixels[i + 1] = 221; pixels[i + 2] = 141; pixels[i + 3] = radius < 12 ? 255 : radius < 15 ? 90 : 0; }
    const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }); win.setIcon(icon); tray = new Tray(icon); tray.setToolTip('JARVIS — your private assistant');
    const trayAction = name => void control(name).catch(e => dialog.showErrorBox('JARVIS', e.message));
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open JARVIS', click: show }, { label: 'Show island', click: hide }, { label: 'Forget microphone permissions', click: () => { presence.disable(); preferences.forget(); } }, { type: 'separator' }, { label: 'Start server', click: () => trayAction('start') }, { label: 'Restart server', click: () => trayAction('restart') }, { label: 'Stop server', click: () => trayAction('stop') }, { type: 'separator' }, { label: 'Quit desktop (keep server running)', click: () => app.quit() }, { label: 'Stop server and quit', click: async () => { try { await control('stop'); app.quit(); } catch (e) { dialog.showErrorBox('JARVIS', e.message); } } }]));
    tray.on('double-click', show);
    await win.loadURL('jarvis-desktop://shell/index.html');
    setInterval(() => void refresh(), 2500).unref();
    await refresh();
    if (!testMode && !current.running) { try { await control('start'); } catch {} }
    if (!testMode && backgroundLaunch && current.running) await presence.showIdle();
  });
}
