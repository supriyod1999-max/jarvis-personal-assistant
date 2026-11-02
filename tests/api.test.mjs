import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { directory, entry, mutation } from './helpers.mjs';

test('HTTP API enforces the local boundary and preserves conflict semantics', async t => {
  const cleanups = []; const path = directory({ after: fn => cleanups.push(fn) }); const port = 14319;
  const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), BRAIN_DATA_DIR: path }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
    for (const cleanup of cleanups) cleanup();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API fixture did not start')), 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('error', reject);
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/api/state`, { headers: { Origin: 'https://example.com' } })).status, 403);
  // Fetch owns its Host header. A raw HTTP client checks the DNS-rebinding guard below.
  const { request } = await import('node:http');
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/state`, { headers: { Host: `evil.test:${port}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${base}/api/mutations`, { method: 'POST', body: '{}' })).status, 403);
  const state = await (await fetch(`${base}/api/state`)).json();
  const post = value => fetch(`${base}/api/mutations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(value) });
  const change = mutation(state, entry()); const first = await post(change);
  assert.equal(first.status, 200); assert.equal((await first.json()).record.rev, 1);
  assert.equal((await post(change)).status, 200);
  assert.equal((await post(mutation(state, { ...change.record, title: 'Stale' }, 0))).status, 409);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).records.length, 1);
});
