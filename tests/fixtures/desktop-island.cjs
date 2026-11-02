// Isolated Electron acceptance fixture. Never opens the owner's data directory.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
mkdirSync(path.join(root, '.test-data'), { recursive: true });
const directory = mkdtempSync(path.join(root, '.test-data/native-island-'));
app.setPath('userData', directory);
app.enableSandbox();
let server, presence, main, lock, exitCode = 0, unlocked = false, openedCoding = '', monitoring = true, unlockRequests = 0;
const codingId = '0199c836-c000-7000-8000-000000000001';
const codingSnapshot = () => ({ enabled: monitoring, locked: !unlocked, available: true,
  sessions: unlocked && monitoring ? [{ id: codingId, title: 'Synthetic coding task', project: 'Fixture only', status: 'working', stale: false, preview: 'Checking the synthetic build.', updatedAt: new Date().toISOString() }] : [], message: '' });
const wait = ms => new Promise(done => setTimeout(done, ms));
function assertTransparentMargin(image) {
  const { width, height } = image.getSize(), pixels = image.toBitmap();
  for (let y = height - 2; y < height; y++) for (let x = 0; x < width; x++) {
    assert.equal(pixels[(y * width + x) * 4 + 3], 0, 'The empty bottom margin must be transparent, not a native rectangle');
  }
  assert.equal(pixels[(Math.floor(height / 4) * width + Math.floor(width / 2)) * 4 + 3], 255, 'The island itself must remain opaque');
}
app.whenReady().then(async () => {
  const { createWorkspaceLock } = await import('../../server/workspace-lock.mjs');
  lock = createWorkspaceLock({ directory, id: 'island_fixture' });
  // Configure only this temporary store. The setup session cookie is discarded.
  await lock.action('setup', { newPin: '654321', confirmPin: '654321' }, { headers: {} }, { setHeader() {} }, false);
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/lock/status') { const status = lock.status(request); unlocked = status.unlocked; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ...status, label: 'Synthetic fixture' })); return; }
    if (['/api/lock/unlock', '/api/lock/lock'].includes(url.pathname) && request.method === 'POST') {
      let body = ''; request.on('data', chunk => { body += chunk; });
      request.on('end', async () => {
        response.setHeader('Content-Type', 'application/json');
        try {
          assert.equal(request.headers['x-second-brain'], '1');
          if (url.pathname.endsWith('/unlock')) unlockRequests++;
          const value = await lock.action(url.pathname.split('/').at(-1), JSON.parse(body), request, response, false);
          response.end(JSON.stringify(value));
        } catch (error) { response.writeHead(error.status || 400); response.end(JSON.stringify({ error: error.message })); }
      }); return;
    }
    if (url.pathname.startsWith('/api/')) { response.writeHead(404); response.end('{}'); return; }
    const file = path.resolve(root, 'dist', '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return; }
    try { response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(readFileSync(file)); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  main = new BrowserWindow({ show: false });
  let fullscreen;
  presence = require('../../desktop/presence.cjs').createPresence({ root, origin: `http://127.0.0.1:${server.address().port}`, settingsPath: path.join(directory, 'preferences.json'),
    win: () => main, tray: () => null, running: () => true,
    readCoding: async () => codingSnapshot(), setCoding: async value => { monitoring = value; return codingSnapshot(); }, openCoding: async id => { openedCoding = id; },
    observeFullscreen: ({ changed }) => { fullscreen = changed; changed(false); return { close() {} }; },
  });
  await presence.showIdle();
  const overlay = BrowserWindow.getAllWindows().find(window => window !== main);
  await wait(700);
  // The real cursor may already be over the bezel when the fixture appears.
  await overlay.webContents.executeJavaScript("window.dispatchEvent(new Event('blur'))");
  await wait(500);
  const compact = overlay.getBounds(); assert.equal(compact.width, 252);
  const output = path.join(root, 'output/desktop-check'); mkdirSync(output, { recursive: true });
  const compactImage = await overlay.webContents.capturePage(); assertTransparentMargin(compactImage);
  writeFileSync(path.join(output, 'native-locked-compact.png'), compactImage.toPNG());
  await overlay.webContents.executeJavaScript("document.querySelector('.presence-header').click()");
  await wait(1000);
  const expanded = overlay.getBounds();
  const layout = await overlay.webContents.executeJavaScript("({width:innerWidth,height:innerHeight,shapeHeight:document.querySelector('.presence-shape').getBoundingClientRect().height,text:document.querySelector('.presence-state').textContent,scroll:document.documentElement.scrollHeight>innerHeight})");
  assert.equal(expanded.width, 552); assert.equal(expanded.height, 218);
  assert.equal(layout.width, 552); assert.equal(layout.height, 218); assert.equal(layout.shapeHeight, 202);
  assert.equal(layout.text, 'Locked'); assert.equal(layout.scroll, false); assert.equal(presence.status().wakeEnabled, false);
  const expandedImage = await overlay.webContents.capturePage(); assertTransparentMargin(expandedImage);
  writeFileSync(path.join(output, 'native-locked-expanded.png'), expandedImage.toPNG());
  assert.equal((await overlay.webContents.executeJavaScript('window.jarvisPresence.coding()')).sessions.length, 0);
  await overlay.webContents.executeJavaScript("document.querySelector('[aria-label=\"Unlock JARVIS\"]').click()"); await wait(800);
  assert.equal(overlay.getBounds().height, 300);
  assert.equal(await overlay.webContents.executeJavaScript("document.activeElement.id"), 'island-pin');
  const unlockImage = await overlay.webContents.capturePage(); assertTransparentMargin(unlockImage);
  writeFileSync(path.join(output, 'native-island-unlock.png'), unlockImage.toPNG());
  // Fixed synthetic PIN, isolated HTTP fixture and temporary browser profile only.
  await overlay.webContents.executeJavaScript(`(() => { const input = document.getElementById('island-pin'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '654321'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(100); await overlay.webContents.executeJavaScript("document.querySelector('form.island-unlock').requestSubmit()"); await wait(500);
  assert.equal(unlockRequests, 1); assert.equal(unlocked, true);
  assert.notEqual(await overlay.webContents.executeJavaScript("document.querySelector('.presence-state').textContent"), 'Locked');
  assert.equal(presence.status().wakeEnabled, false);
  await overlay.webContents.executeJavaScript("document.querySelector('[aria-label=\"View coding sessions\"]').click()"); await wait(800);
  assert.equal(overlay.getBounds().height, 390);
  assert.equal(await overlay.webContents.executeJavaScript("document.querySelector('.coding-session h3').textContent"), 'Synthetic coding task');
  const codingImage = await overlay.webContents.capturePage(); assertTransparentMargin(codingImage);
  writeFileSync(path.join(output, 'native-coding.png'), codingImage.toPNG());
  await overlay.webContents.executeJavaScript("document.querySelector('[aria-label=\"Open Synthetic coding task in Codex\"]').click()"); await wait(150);
  assert.equal(openedCoding, codingId); // Stubbed native jump-back; never opens a real chat.
  await overlay.webContents.executeJavaScript("fetch('/api/lock/lock', { method:'POST', headers:{'Content-Type':'application/json','X-Second-Brain':'1'}, body:'{}' }).then(() => window.dispatchEvent(new Event('jarvis-lock-updated')))"); await wait(400);
  assert.equal(await overlay.webContents.executeJavaScript("document.querySelectorAll('.coding-session').length"), 0);
  fullscreen(true); assert.equal(presence.status().islandVisible, false);
  fullscreen(false); assert.equal(presence.status().islandVisible, true);
  writeFileSync(path.join(output, 'native-island-acceptance.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), compact, expanded, layout, transparentMargins: true, inlinePinUnlock: true, codingViewAndJumpStub: true, codingClearsOnLock: true, microphoneOff: true, fullscreenHideRestore: true, fixtureOnly: true }, null, 2));
  console.log('Native island acceptance passed: inline synthetic PIN unlock, transparent margins, coding view and jump-back stub, lock privacy, microphone off, fullscreen visibility callbacks.');
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => { presence?.close(); main?.destroy(); server?.close(); lock?.close(); app.exit(exitCode); });
