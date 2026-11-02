import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPresence } = require('../desktop/presence.cjs');
const { createPreferences } = require('../desktop/preferences.cjs');

function fixture(preferences, choice = { response: 0, checkboxChecked: true }, coding = {}) {
  const windows = [], handlers = new Map(), powerMonitor = new EventEmitter(), screen = new EventEmitter();
  let observe, questions = 0;
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  screen.getAllDisplays = () => [display]; screen.getDisplayMatching = () => display;
  class Window extends EventEmitter {
    constructor() { super(); this.visible = false; this.bounds = {}; this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; this.webContents.mainFrame = { url: '' }; windows.push(this); }
    setAlwaysOnTop() {} isDestroyed() { return !!this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
    hide() { this.visible = false; } showInactive() { this.visible = true; } isVisible() { return this.visible; }
    setBounds(bounds) { this.bounds = bounds; } getBounds() { return this.bounds; }
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  const origin = 'http://127.0.0.1:4317';
  const presence = createPresence({ origin, root: resolve('.'), preferences, running: () => true, ...coding, win: () => ({ getBounds: () => display.bounds }), tray: () => null,
    observeFullscreen: ({ changed }) => { observe = changed; changed(false); return { close() {} }; },
    electron: { BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, screen, powerMonitor, dialog: { showMessageBox: async () => { questions++; return choice; } } },
  });
  const event = () => { const sender = windows.at(-1).webContents; return { sender, senderFrame: sender.mainFrame }; };
  return { presence, windows, powerMonitor, fullscreen: value => observe(value), questions: () => questions, invoke: (name, value, forged) => handlers.get(name)(forged || event(), value), report: state => handlers.get('jarvis:presence-state')(event(), { awake: false, error: '', presentation: 'compact', phase: 'listening', ...state }) };
}
function prefs() { mkdirSync('.test-data', { recursive: true }); return join(mkdtempSync(resolve('.test-data/desktop-presence-')), 'preferences.json'); }

test('microphone-off island opens without consent, hides for fullscreen, and restores without enabling capture', async () => {
  const f = fixture(createPreferences(prefs()));
  try {
    await f.presence.showIdle(); assert.equal(f.presence.status().islandVisible, true); assert.equal(f.presence.status().wakeEnabled, false); assert.equal(f.questions(), 0);
    f.report({ presentation: 'expanded', reducedMotion: true });
    assert.equal(f.windows.at(-1).bounds.width, 552);
    f.presence.disable({ keepVisible: true });
    assert.equal(f.windows.at(-1).bounds.width, 552); // Repeated lock checks preserve the visible UI layout.
    f.fullscreen(true); assert.equal(f.presence.status().islandVisible, false);
    f.fullscreen(false); assert.equal(f.presence.status().islandVisible, true); assert.equal(f.presence.status().wakeEnabled, false);
    f.powerMonitor.emit('lock-screen'); assert.equal(f.presence.status().islandVisible, false);
    await f.presence.showIdle(); assert.equal(f.presence.status().islandVisible, false);
    f.powerMonitor.emit('unlock-screen'); await f.presence.showIdle(); assert.equal(f.presence.status().wakeEnabled, false);
  } finally { f.presence.close(); }
});

test('remembered wake consent survives restart, never starts capture, and is separate per origin and permission kind', async () => {
  const path = prefs(), preferences = createPreferences(path), first = fixture(preferences);
  await first.presence.toggle(); assert.equal(first.questions(), 1); assert.equal(first.presence.status().wakeEnabled, true);
  first.report({ phase: 'listening' }); first.fullscreen(true); assert.equal(first.presence.status().islandVisible, false); assert.equal(first.presence.status().wakeEnabled, true);
  first.fullscreen(false); assert.equal(first.presence.status().islandVisible, true);
  await first.presence.toggle(); assert.equal(first.presence.status().wakeEnabled, false); assert.equal(first.presence.status().islandVisible, true);
  await first.presence.toggle(); assert.equal(first.questions(), 1);
  first.presence.close();
  const restored = createPreferences(path), second = fixture(restored);
  try {
    assert.equal(second.presence.status().wakeEnabled, false);
    await second.presence.toggle(); assert.equal(second.questions(), 0);
    assert.equal(restored.allowed('wake', 'http://127.0.0.1:4327'), false);
    assert.equal(restored.allowed('microphone', 'http://127.0.0.1:4317'), false);
    second.powerMonitor.emit('suspend'); assert.equal(second.presence.status().wakeEnabled, false);
    second.powerMonitor.emit('resume'); assert.equal(second.presence.status().wakeEnabled, false);
    restored.forget(); assert.equal(createPreferences(path).allowed('wake', 'http://127.0.0.1:4317'), false);
    assert.throws(() => restored.allow('wake', 'https://evil.test'), /Unknown/);
  } finally { second.presence.close(); }
});

test('cancelled consent is not persisted and locking during a consent prompt cancels activation', async () => {
  const preferences = createPreferences(prefs()), f = fixture(preferences, { response: 1, checkboxChecked: true });
  try { await f.presence.toggle(); assert.equal(f.presence.status().wakeEnabled, false); assert.equal(preferences.allowed('wake', 'http://127.0.0.1:4317'), false); }
  finally { f.presence.close(); }
  const delayed = fixture(preferences, { get response() { delayed.powerMonitor.emit('lock-screen'); return 0; }, checkboxChecked: true });
  try { await delayed.presence.toggle(); assert.equal(delayed.presence.status().wakeEnabled, false); assert.equal(preferences.allowed('wake', 'http://127.0.0.1:4317'), false); }
  finally { delayed.presence.close(); }
});

test('coding bridge accepts only its overlay frame, validates targets and hides details when Windows locks', async () => {
  let reads = 0, opened = '', release, cleared = 0;
  const f = fixture(createPreferences(prefs()), undefined, {
    readCoding: async () => { reads++; return { enabled: true, sessions: [{ title: 'Synthetic coding session' }] }; },
    openCoding: async id => { opened = id; }, setCoding: async enabled => ({ enabled, sessions: [] }),
    clearCoding: () => { cleared++; },
  });
  try {
    await f.presence.showIdle();
    await assert.rejects(f.invoke('jarvis:coding-read', undefined, { sender: {}, senderFrame: {} }), /Access denied/);
    assert.equal(reads, 0);
    assert.equal((await f.invoke('jarvis:coding-read')).sessions.length, 1);
    await f.invoke('jarvis:presence-off'); assert.equal(cleared, 1);
    await assert.rejects(f.invoke('jarvis:coding-open', 'https://example.com/execute'), /unavailable/);
    await f.invoke('jarvis:coding-open', '0199c836-c000-7000-8000-000000000001'); assert.match(opened, /^0199/);
    await assert.rejects(f.invoke('jarvis:coding-enabled', 'true'), /unavailable/);
    f.report({ panel: 'coding', presentation: 'expanded', reducedMotion: true }); assert.equal(f.windows.at(-1).bounds.height, 390);
    f.report({ panel: 'unlock', presentation: 'expanded', reducedMotion: true }); assert.equal(f.windows.at(-1).bounds.height, 300);
    assert.throws(() => f.report({ panel: 'admin' }), /Invalid island panel/);
    f.powerMonitor.emit('lock-screen'); await assert.rejects(f.invoke('jarvis:coding-read'), /Access denied/);
    assert.equal(reads, 1);
  } finally { f.presence.close(); }
  const pending = fixture(createPreferences(prefs()), undefined, { readCoding: () => new Promise(done => { release = done; }) });
  try {
    await pending.presence.showIdle(); const result = pending.invoke('jarvis:coding-read'); pending.powerMonitor.emit('lock-screen');
    release({ sessions: [{ title: 'Must not escape after lock' }] }); await assert.rejects(result, /Access denied/);
  } finally { pending.presence.close(); }
});
