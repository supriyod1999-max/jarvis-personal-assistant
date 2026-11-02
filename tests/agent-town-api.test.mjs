import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplication } from '../server/index.mjs';
import { createAgentTownReader } from '../server/agent-town-state.mjs';
import { createPhoneCoding } from '../server/coding-sessions.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';

// This file is installed in JARVIS/tests. Every store and snapshot is synthetic
// and below its .test-data directory; no live PIN or session store is accessed.
const fixture = () => ({ version: 1, mode: 'live', collectedAt: '2026-10-29T12:00:00.000Z', projects: [{ id: 'project:fixture', name: 'Synthetic office' }], agents: [], events: [], tasks: [], sources: [] });
const headers = { 'Content-Type': 'application/json', 'X-Second-Brain': '1' };
async function setup(t, port, options = {}) {
  const cleanups = [], path = directory({ after: fn => cleanups.push(fn) });
  const file = join(path, 'town.json');
  await writeFile(file, JSON.stringify({ ...fixture(), privateExtra: 'MUST_NOT_APPEAR' }));
  const coding = createPhoneCoding({ directory: path, sessions: { clear() {}, scan: async () => ({ sessions: [] }) } });
  const app = createApplication({ directory: path, port, hermes: fixtureHermes(), coding, agentTown: createAgentTownReader({ snapshotPath: file }), ...options });
  t.after(async () => { await app.close(); for (const clean of cleanups) clean(); });
  app.listen(); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${port}`;
  const post = (route, body, cookie) => fetch(base + route, { method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const unlock = async () => {
    const response = await post('/api/lock/setup', { newPin: '654321', confirmPin: '654321' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { app, path, file, base, coding, unlock, post };
}

test('Agent Town endpoint requires real primary PIN and returns sanitized uncached observations', async t => {
  const s = await setup(t, 14641), endpoint = s.base + '/api/agent-town/state';
  assert.equal((await fetch(endpoint)).status, 403); // No configured PIN is not authority.
  const cookie = await s.unlock(), auth = { Cookie: cookie };
  const before = await readFile(s.file);
  const result = await fetch(endpoint, { headers: auth });
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await result.json()).snapshot, fixture());
  assert.deepEqual(await readFile(s.file), before);
  assert.equal((await s.post('/api/agent-town/state', {}, cookie)).status, 405);
  for (const extra of [{ Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await fetch(endpoint, { headers: { ...auth, ...extra } })).status, 403);
  }
  assert.equal((await phoneCall(14641, { Cookie: cookie, Host: 'evil.test' })).status, 403);
  // Query parameters cannot redirect the fixed reader to another file.
  assert.deepEqual((await (await fetch(endpoint + '?path=C:/private', { headers: auth })).json()).snapshot, fixture());
  await mkdir(join(s.path, 'desktop'));
  await writeFile(join(s.path, 'desktop/preferences.json'), '{"codingEnabled":false}');
  assert.equal((await (await fetch(endpoint, { headers: auth })).json()).snapshot, null);
  await writeFile(join(s.path, 'desktop/preferences.json'), '{"codingEnabled":true}');
  assert.deepEqual((await (await fetch(endpoint, { headers: auth })).json()).snapshot, fixture());
  await unlink(s.file);
  assert.equal((await (await fetch(endpoint, { headers: auth })).json()).snapshot, null);
  await s.post('/api/lock/lock', {}, cookie);
  assert.equal((await fetch(endpoint, { headers: auth })).status, 401);
});

test('Agent Town never reads another personal workspace even when it is unlocked', async t => {
  let reads = 0;
  const s = await setup(t, 14642, { profile: { id: 'other', displayName: 'Fixture', addressAs: '' }, agentTown: { snapshot: async () => { reads++; return { snapshot: fixture() }; } } });
  const cookie = await s.unlock();
  assert.equal((await fetch(s.base + '/api/agent-town/state', { headers: { Cookie: cookie } })).status, 403);
  assert.equal(reads, 0);
});

test('Agent Town revokes an in-flight response when its PIN session locks', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const s = await setup(t, 14643, { agentTown: { snapshot: async () => { started(); await new Promise(resolve => { release = resolve; }); return { enabled: true, available: true, snapshot: fixture() }; } } });
  const cookie = await s.unlock();
  const pending = fetch(s.base + '/api/agent-town/state', { headers: { Cookie: cookie } });
  await entered; await s.post('/api/lock/lock', {}, cookie); release();
  const result = await pending; assert.equal(result.status, 401); assert.equal((await result.text()).includes('Synthetic office'), false);
});

test('Agent Town checks monitoring after asynchronous reads and fails closed without an accessor', async t => {
  let enabled = true, release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const s = await setup(t, 14644, { coding: { clear() {}, isMonitoringEnabled: async () => enabled }, agentTown: { snapshot: async () => { started(); await new Promise(resolve => { release = resolve; }); return { enabled: true, available: true, snapshot: fixture() }; } } });
  const cookie = await s.unlock();
  const pending = fetch(s.base + '/api/agent-town/state', { headers: { Cookie: cookie } });
  await entered; enabled = false; release();
  const result = await pending; assert.equal(result.status, 200); assert.equal((await result.json()).snapshot, null);
  const noAccessor = await setup(t, 14645, { coding: { clear() {} } });
  const otherCookie = await noAccessor.unlock();
  const absent = await fetch(noAccessor.base + '/api/agent-town/state', { headers: { Cookie: otherCookie } });
  assert.equal((await absent.json()).snapshot, null);
});

function phoneCall(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/agent-town/state', headers: extra, agent: false }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => { text += value; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.end();
  });
}
test('Agent Town phone route preserves exact private identity and origin restrictions', async t => {
  const config = { version: 1, origin: 'https://world.tailtest.ts.net', ownerLogin: 'owner@example.test', port: 14647 };
  const s = await setup(t, 14646, { privateAccess: config });
  const cookie = await s.unlock();
  const auth = { Host: 'world.tailtest.ts.net', 'Tailscale-User-Login': config.ownerLogin, Cookie: cookie };
  for (const wrong of [{}, { ...auth, 'Tailscale-User-Login': 'other@example.test' }, { ...auth, Origin: 'https://evil.test' }, { ...auth, 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await phoneCall(config.port, wrong)).status, 403);
  }
  const valid = await phoneCall(config.port, auth);
  assert.equal(valid.status, 200); assert.deepEqual(JSON.parse(valid.text).snapshot, fixture());
});
