// Standalone native-window fixture: no app data, server actions, mic or model calls.
const { app, BrowserWindow, dialog, screen } = require('electron');
const { createServer } = require('node:http');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createPresence } = require('../../desktop/presence.cjs');
const root = path.resolve('.test-data/presence-native'); mkdirSync(root, { recursive: true });
app.setPath('userData', root); app.enableSandbox();
app.whenReady().then(async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Isolated notch window</title><body style="margin:0;background:transparent"></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const owner = new BrowserWindow({ width: 880, height: 650, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await owner.loadURL('about:blank');
  dialog.showMessageBox = async () => ({ response: 0 }); // Consent fixture only; no audio is requested.
  const presence = createPresence({ win: () => owner, tray: () => null, origin: `http://127.0.0.1:${server.address().port}`, settingsPath: path.join(root, 'preferences.json'), running: () => true });
  presence.setMode('island');
  global.presenceHarness = { owner, presence, display: () => screen.getDisplayMatching(owner.getBounds()) };
  app.on('before-quit', () => { presence.disable(); server.close(); });
});
