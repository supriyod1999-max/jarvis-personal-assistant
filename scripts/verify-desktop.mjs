import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const env = { ...process.env, NODE_ENV: 'test', JARVIS_DESKTOP_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ ...(process.argv.includes('--packaged')
  ? { executablePath: resolve('output/desktop/JARVIS-win32-x64/JARVIS.exe'), args: [] }
  : { args: [resolve('desktop')] }), env });
try {
  const toolbar = await desktop.firstWindow();
  const mainWindowId = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await toolbar.waitForURL('jarvis-desktop://shell/index.html');
  assert.equal(await toolbar.locator('header').evaluate(element => element.getBoundingClientRect().height), 52);
  await toolbar.getByRole('button', { name: 'Controls', exact: true }).waitFor();
  await desktop.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
  await toolbar.locator('#server').filter({ hasText: /^Server (online|stopped)$/ }).waitFor();
  if (await toolbar.locator('#server').textContent() === 'Server stopped') {
    await toolbar.evaluate(() => window.jarvisDesktop.mode('island'));
    await toolbar.locator('#presence-status').filter({ hasText: 'Start the server, unlock your workspace' }).waitFor({ state: 'attached' });
    assert.equal(await toolbar.getByRole('button', { name: 'Wake off', exact: true }).isDisabled(), true);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(await toolbar.evaluate(() => typeof window.require), 'undefined');
    await mkdir('output/desktop-check', { recursive: true });
    await toolbar.screenshot({ path: 'output/desktop-check/controls.png' });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 650));
    assert.equal(await toolbar.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toolbar.screenshot({ path: 'output/desktop-check/controls-compact.png' });
    console.log('Desktop verified while server stopped: startup guidance is visible, wake remains disabled, style selection does not open a microphone, controls fit at minimum width.');
  } else {
  const app = desktop.windows().find(page => page !== toolbar) || await desktop.waitForEvent('window', { predicate: page => page !== toolbar }).catch(() => null);
  if (!app) throw new Error('No JARVIS application renderer opened.');
  await app.waitForURL('http://127.0.0.1:4317/**');
  const locked = await app.evaluate(async () => !(await (await fetch('/api/lock/status')).json()).unlocked);
  if (locked) {
    await app.getByRole('button', { name: 'Unlock workspace', exact: true }).waitFor();
    assert.equal(await app.locator('.app-shell').count(), 0);
  } else {
    await app.getByLabel('Message JARVIS').waitFor();
    await app.getByRole('button', { name: 'Start Talk', exact: true }).waitFor();
  }
  await toolbar.getByRole('button', { name: 'Show island' }).waitFor();
  await toolbar.evaluate(() => window.jarvisDesktop.mode('island'));
  await toolbar.locator('#presence-status').filter({ hasText: 'Microphone off' }).waitFor({ state: 'attached' });
  assert.equal(await toolbar.getByRole('button', { name: 'Wake off', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Choosing a style must not start the microphone or an overlay');
  if (locked) {
    await toolbar.getByRole('button', { name: 'Wake off', exact: true }).click();
    await toolbar.locator('#presence-status').filter({ hasText: 'Unlock this workspace before enabling wake listening.' }).waitFor({ state: 'attached' });
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  }
  assert.equal(await toolbar.evaluate(() => typeof window.require), 'undefined');
  const result = await desktop.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const child = win.contentView.children[0];
    if (!child?.webContents) throw new Error('The app view was not attached.');
    const prefs = child.webContents.getLastWebPreferences();
    const appBridge = await child.webContents.executeJavaScript('typeof window.jarvisDesktop');
    return { url: child.webContents.getURL(), nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, appBridge, image: (await child.webContents.capturePage()).toPNG().toString('base64') };
  });
  assert.equal(result.nodeIntegration, false); assert.equal(result.sandbox, true); assert.equal(result.contextIsolation, true); assert.equal(result.appBridge, 'undefined');
  await mkdir('output/desktop-check', { recursive: true });
  await writeFile('output/desktop-check/app.png', Buffer.from(result.image, 'base64'));
  await toolbar.screenshot({ path: 'output/desktop-check/controls.png' });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 650));
  assert.equal(await toolbar.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await toolbar.screenshot({ path: 'output/desktop-check/controls-compact.png' });
  await toolbar.getByRole('button', { name: 'Show island' }).click();
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainWindowId)).toBe(false);
  assert.equal(await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).contentView.children.length, mainWindowId), 0);
  assert.equal((await (await fetch('http://127.0.0.1:4317/api/health')).json()).ok, true);
  console.log('Desktop verified: style selection explains wake activation without starting the microphone; locked workspace error is visible; controls fit at minimum width; isolated app view; closing view releases renderer and microphone; server remains running.');
  }
} finally { await desktop.close(); }
