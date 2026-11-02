import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
test('computer controls require primary PIN sessions, private owner identity, correct Origin and local pairing review', async t => {
  const cleanups = [], path = directory({ after: fn => cleanups.push(fn) }), origin = 'https://laptop.tailtest.ts.net';
  const app = createApplication({ directory: path, port: 14374, hermes: fixtureHermes(), privateAccess: { version: 1, origin, ownerLogin: 'owner@example.test', port: 14375 }, computerNative: { available: () => true, status: async () => ({ local: true, locked: false, sessionId: 2, accountSid: 'S-1-5-21-1-2-3-1001' }) } });
  t.after(async () => { await app.close(); for (const cleanup of cleanups) cleanup(); }); app.listen(); await once(app.server, 'listening');
  const local = 'http://127.0.0.1:14374', headers = { 'Content-Type': 'application/json', 'X-Second-Brain': '1' };
  assert.equal((await fetch(local + '/api/computer/status')).status, 403); // Unconfigured PIN is not enrollment authority.
  const configured = await fetch(local + '/api/lock/setup', { method: 'POST', headers, body: JSON.stringify({ newPin: '654321', confirmPin: '654321' }) });
  const cookie = configured.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(local + '/api/computer/status', { headers: { Cookie: cookie } })).status, 200);
  async function phone(extra = {}, method = 'GET', path = '/api/computer/status', body) {
    return new Promise((done, reject) => { const req = request({ host: '127.0.0.1', port: 14375, path, method, headers: { Host: 'laptop.tailtest.ts.net', 'Tailscale-User-Login': 'owner@example.test', Cookie: cookie, ...extra } }, response => { response.resume(); response.on('end', () => done(response.statusCode)); }); req.on('error', reject); req.end(body && JSON.stringify(body)); });
  }
  assert.equal(await phone(), 200); assert.equal(await phone({ 'Tailscale-User-Login': 'attacker@example.test' }), 403);
  assert.equal(await phone({ Origin: 'https://evil.test', ...headers }, 'POST', '/api/computer/revoke', { deviceId: 'x' }), 403);
  assert.equal(await phone({ Origin: origin, ...headers }, 'POST', '/api/computer/approve-pair', {}), 403);
  assert.equal((await fetch(local + '/api/computer/challenge', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ deviceId: 'x', operation: 'windows.lock' }) })).status, 403);
  await fetch(local + '/api/lock/lock', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
  assert.equal(await phone(), 401);
});
