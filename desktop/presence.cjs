const path = require('node:path');
const { presenceBounds, springStep } = require('./presence-layout.cjs');
const { createPreferences } = require('./preferences.cjs');
const { watchFullscreen } = require('./fullscreen.cjs');

module.exports.createPresence = ({ win, tray, origin, settingsPath, running, onOpen = () => {}, requestWake, readCoding, clearCoding, setCoding, openCoding, preferences = createPreferences(settingsPath), root = path.resolve(__dirname, '..'), observeFullscreen = watchFullscreen, electron = require('electron') }) => {
  const { BrowserWindow, dialog, ipcMain, screen, powerMonitor } = electron;
  let window, enabled = false, error = '', mode = preferences.mode(), awake = false, frame, armed = false, phase = 'off';
  let fullscreen = true, locked = false, generation = 0, enabling = false;
  let presentation = 'compact', detail = 'regular', panel = 'assistant', reducedMotion = false, displayId, target, motion, lastFrame = 0;
  const config = () => ({ enabled, mode });
  function applyBounds(bounds) {
    window.setBounds(bounds);
  }
  function disable({ keepVisible = false } = {}) {
    generation++;
    // A locked overlay periodically rechecks access. Repeated microphone-off
    // reports must not shrink the native window while its UI remains expanded.
    if (!enabled && keepVisible && mode === 'island' && !locked && window && !window.isDestroyed()) {
      window.webContents.send('jarvis:presence-config', config()); position(); return;
    }
    enabled = false; awake = false; armed = false; phase = 'off'; clearInterval(frame);
    frame = null; motion = null; target = null; presentation = 'compact';
    if (keepVisible && mode === 'island' && !locked) { window?.webContents.send('jarvis:presence-config', config()); position(); }
    else { const old = window; window = null; if (old && !old.isDestroyed()) old.destroy(); }
    tray()?.setToolTip('JARVIS — wake microphone off');
  }
  function position() {
    if (!window || window.isDestroyed()) return;
    if (fullscreen || locked) { clearInterval(frame); frame = null; motion = null; target = null; window.hide(); return; }
    const display = screen.getAllDisplays().find(item => item.id === displayId) || screen.getDisplayMatching(win().getBounds());
    displayId = display.id;
    const next = presenceBounds(display, mode, presentation, detail, panel);
    if (!awake && mode === 'orb') { clearInterval(frame); frame = null; motion = null; target = next; window.hide(); return; }
    if (reducedMotion || !window.isVisible() || !target || next.y !== target.y) {
      clearInterval(frame); frame = null; motion = null; target = next;
      applyBounds(next); if (!window.isVisible()) window.showInactive(); window.moveTop?.(); return;
    }
    if (target && Object.keys(next).every(key => next[key] === target[key])) return;
    target = next;
    window.moveTop?.();
    if (frame) return; // The running spring reads the new destination on its next frame.
    const start = window.getBounds();
    motion = { width: start.width, height: start.height, vw: 0, vh: 0 }; lastFrame = Date.now();
    frame = setInterval(() => {
      if (!window || window.isDestroyed()) { clearInterval(frame); frame = null; return; }
      const now = Date.now(), dt = (now - lastFrame) / 1000; lastFrame = now;
      const w = springStep(motion.width, motion.vw, target.width, dt), h = springStep(motion.height, motion.vh, target.height, dt);
      motion = { width: w.position, height: h.position, vw: w.velocity, vh: h.velocity };
      const width = Math.round(w.position), height = Math.round(h.position);
      // Keep the bezel anchor and centre fixed while the surface grows downwards.
      applyBounds({ x: Math.round(target.x + (target.width - width) / 2), y: target.y, width, height });
      if (Math.abs(width - target.width) < 1 && Math.abs(height - target.height) < 1 && Math.abs(w.velocity) + Math.abs(h.velocity) < 2) {
        applyBounds(target); clearInterval(frame); frame = null; motion = null;
      }
    }, 16);
  }
  async function ensureWindow() {
    if (window && !window.isDestroyed()) return;
    presentation = 'compact'; displayId = screen.getDisplayMatching(win().getBounds()).id;
    window = new BrowserWindow({ width: 560, height: 610, frame: false, thickFrame: false, roundedCorners: false, transparent: true, backgroundColor: '#00000000', resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'presence-preload.cjs'), partition: 'persist:jarvis-app', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
    window.on('will-resize', event => event.preventDefault());
    window.setAlwaysOnTop(true, 'screen-saver');
    window.on('close', event => { event.preventDefault(); disable(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => { error = 'Wake listening stopped. Enable it again when ready.'; disable(); });
    position();
    try { await window.loadURL(origin + '/#/voice-overlay'); tray()?.setToolTip(enabled ? 'JARVIS — wake microphone listening locally' : 'JARVIS — island ready, microphone off'); }
    catch { error = 'The floating assistant could not open. Restart JARVIS and try again.'; disable(); }
  }
  async function toggle() {
    if (enabled) { disable({ keepVisible: true }); return; }
    if (!running() || locked || enabling) return;
    enabling = true; const attempt = generation;
    try {
      if (!preferences.allowed('wake', origin)) {
        const choice = await dialog.showMessageBox(win(), { type: 'question', title: 'Wake JARVIS by voice', message: 'Allow background wake listening for this workspace?', detail: 'Speech is recognised locally. Only a wake phrase starts a conversation. Listening stops on lock, sleep, workspace switch or exit, and starts off when JARVIS opens. Remembering permission does not turn the microphone on automatically.', buttons: ['Enable wake listening', 'Cancel'], checkboxLabel: 'Remember my permission on this laptop', checkboxChecked: true, defaultId: 1, cancelId: 1 });
        if (choice.response !== 0 || attempt !== generation || !running() || locked) return;
        if (choice.checkboxChecked) preferences.allow('wake', origin);
      }
      if (attempt !== generation || !running() || locked) return;
      enabled = true; error = ''; awake = false; armed = false; phase = 'preparing';
      await ensureWindow(); window?.webContents.send('jarvis:presence-config', config()); position();
    } finally { enabling = false; }
  }
  function authorize(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== origin + '/#/voice-overlay') throw new Error('Access denied.');
  }
  ipcMain.handle('jarvis:presence-ready', event => { authorize(event); return config(); });
  ipcMain.handle('jarvis:presence-off', event => { authorize(event); clearCoding?.(); disable({ keepVisible: true }); });
  ipcMain.handle('jarvis:presence-open', event => { authorize(event); onOpen(); });
  ipcMain.handle('jarvis:presence-wake', async event => { authorize(event); if (requestWake) await requestWake(); });
  ipcMain.handle('jarvis:coding-read', async event => {
    authorize(event); if (locked || !readCoding) return { enabled: true, locked: true, sessions: [], message: 'Unlock JARVIS to view coding sessions.' };
    const result = await readCoding(); authorize(event);
    return locked ? { enabled: true, locked: true, sessions: [] } : result;
  });
  ipcMain.handle('jarvis:coding-enabled', async (event, value) => { authorize(event); if (locked || !setCoding || typeof value !== 'boolean') throw new Error('Coding controls are unavailable.'); return setCoding(value); });
  ipcMain.handle('jarvis:coding-open', async (event, id) => { authorize(event); if (locked || !openCoding || typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error('Coding session is unavailable.'); await openCoding(id); });
  ipcMain.handle('jarvis:presence-state', (event, value) => {
    authorize(event);
    if (typeof value?.awake !== 'boolean' || !['off','preparing','listening','transcribing','thinking','speaking','muted'].includes(value.phase) || typeof value.error !== 'string' || value.error.length > 1000 || (value.presentation !== undefined && !['compact','peek','expanded'].includes(value.presentation)) || (value.reducedMotion !== undefined && typeof value.reducedMotion !== 'boolean')) throw new Error('Invalid voice state.');
    if (value.detail !== undefined && !['short','regular','long'].includes(value.detail)) throw new Error('Invalid voice layout.');
    if (value.panel !== undefined && !['assistant','coding','unlock'].includes(value.panel)) throw new Error('Invalid island panel.');
    panel = value.panel || 'assistant';
    if (!enabled) { awake = false; phase = 'off'; presentation = value.presentation || 'compact'; reducedMotion = value.reducedMotion === true; position(); return; }
    awake = value.awake; error = value.error; phase = value.phase; detail = value.detail || 'regular';
    presentation = value.presentation || (awake ? 'expanded' : 'compact'); reducedMotion = value.reducedMotion === true;
    if (value.phase !== 'off') armed = true;
    if (value.error || (value.phase === 'off' && armed)) { if (!value.error) error = 'Wake listening ended. Enable it again when ready.'; disable(); }
    else position();
  });
  powerMonitor.on('lock-screen', () => { locked = true; disable(); }); powerMonitor.on('suspend', () => { locked = true; disable(); });
  powerMonitor.on('unlock-screen', () => { locked = false; }); powerMonitor.on('resume', () => { locked = false; });
  screen.on('display-removed', position); screen.on('display-metrics-changed', position);
  const observer = observeFullscreen({ root, changed: value => { fullscreen = value; position(); } });
  return { toggle, disable, owns: wc => !!window && wc === window.webContents && enabled, status: () => ({ wakeEnabled: enabled, wakeIssue: error, wakePhase: phase, mode, fullscreenHidden: fullscreen, islandVisible: !!window && window.isVisible() }),
    setOrigin(value) { disable(); origin = value; },
    async showIdle() { if (locked) return; mode = 'island'; preferences.setMode(mode); await ensureWindow(); window?.webContents.send('jarvis:presence-config', config()); position(); },
    close() { disable(); observer.close(); },
    setMode(value) { preferences.setMode(value); mode = value; window?.webContents.send('jarvis:presence-config', config()); position(); },
  };
};
