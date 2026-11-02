import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: [resolve('tests/fixtures/presence-native.cjs')], env });
try {
  await desktop.firstWindow();
  await expect.poll(() => desktop.evaluate(() => !!global.presenceHarness)).toBe(true);
  await desktop.evaluate(() => global.presenceHarness.presence.toggle());
  const overlay = desktop.windows().find(page => page.url().includes('voice-overlay'));
  assert.ok(overlay);
  const bounds = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w !== global.presenceHarness.owner).getBounds());
  const display = await desktop.evaluate(() => global.presenceHarness.display().bounds);
  const report = (presentation, reducedMotion = false) => overlay.evaluate(value => window.jarvisPresence.report({ awake: false, phase: 'listening', error: '', ...value }), { presentation, reducedMotion });
  await report('compact');
  const compact = await bounds();
  assert.equal(compact.y, display.y); assert.equal(compact.width, 252); assert.equal(compact.height, 56);
  await report('expanded');
  await new Promise(done => setTimeout(done, 80));
  const between = await bounds(); assert.ok(between.width > 252 && between.width < 552); assert.equal(between.y, display.y);
  await report('compact'); // Reverse before the opening finishes.
  await expect.poll(async () => (await bounds()).width).toBe(252);
  assert.equal((await bounds()).height, 56);
  await report('peek', true);
  assert.equal((await bounds()).width, 368); assert.equal((await bounds()).height, 112);
  await report('expanded', true);
  const expanded = await bounds(); assert.equal(expanded.width, 552); assert.equal(expanded.height, 218);
  assert.equal(expanded.y, display.y); assert.ok(Math.abs(expanded.x + expanded.width / 2 - (display.x + display.width / 2)) <= .5);
  for (const [detail, height] of [['short', 174], ['long', 286]]) {
    await overlay.evaluate(detail => window.jarvisPresence.report({ awake: true, phase: 'speaking', error: '', presentation: 'expanded', detail, reducedMotion: true }), detail);
    assert.equal((await bounds()).height, height); assert.equal((await bounds()).y, display.y);
  }
  await assert.rejects(report('fullscreen'), /Invalid voice state/);
  await Promise.all([overlay.waitForEvent('close'), overlay.evaluate(() => window.jarvisPresence.disable()).catch(error => {
    if (!error.message.includes('has been closed')) throw error;
  })]);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  console.log('Native notch verified: flush display-top placement, fixed centre, intermediate spring frames, interrupted reversal, instant reduced motion, bounded IPC states, microphone-off cleanup. No microphone or live data used.');
} finally { await desktop.close(); }
