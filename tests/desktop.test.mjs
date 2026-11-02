import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createHost } = createRequire(import.meta.url)('../desktop/host.cjs');
test('desktop controls serialize actions, use only fixed hidden launchers and wait for actual state', async () => {
  const calls = []; let running = true;
  const host = createHost({ root: 'C:\\JARVIS', sleep: async () => {}, request: async url => { if (!running) throw new Error('off'); return { ok: true, json: async () => url.endsWith('/health') ? { ok: true, version: '0.1.0' } : { state: 'ready' } }; }, launch: (bin, args, options) => {
    calls.push({ bin, args, options }); const child = new EventEmitter();
    queueMicrotask(() => { running = args.includes('-NoBrowser'); child.emit('exit', 0); }); return child;
  } });
  const restart = host.action('restart'); await assert.rejects(host.action('start'), /already running/); await restart;
  assert.equal((await host.status()).running, true); assert.equal(calls.length, 2);
  assert.ok(calls[0].args.some(x => x.endsWith('stop.ps1'))); assert.ok(calls[1].args.some(x => x.endsWith('start.ps1')));
  assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.shell, false);
  await assert.rejects(host.action('arbitrary command'), /Unknown/); assert.equal(calls.length, 2);
  await host.action('stop'); assert.equal((await host.status()).running, false);
});
