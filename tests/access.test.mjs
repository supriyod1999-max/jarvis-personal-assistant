import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/index.mjs';
import { loadPrivateAccess, validatePrivateAccess } from '../server/access.mjs';
import { configFromStatus, routeOwned } from '../scripts/phone-access.mjs';
import { directory, entry, mutation } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';

const config = { version: 1, origin: 'https://brain.tailtest.ts.net', ownerLogin: 'owner@example.test', port: 14323 };
const auth = { Host: 'brain.tailtest.ts.net', 'Tailscale-User-Login': config.ownerLogin };
async function call(port, path, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', data => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const post = { ...auth, Origin: config.origin, 'Content-Type': 'application/json', 'X-Second-Brain': '1' };

test('private configuration rejects unsafe addresses and fails closed on a damaged file', t => {
  for (const origin of ['http://brain.tailtest.ts.net', 'https://example.com', 'https://brain.tailtest.ts.net.evil.test', 'https://brain.tailtest.ts.net/path', 'https://me:pass@brain.tailtest.ts.net', 'https://brain.tailtest.ts.net:9443']) assert.throws(() => validatePrivateAccess({ ...config, origin }));
  assert.equal(validatePrivateAccess({ ...config, origin: 'https://brain.tailtest.ts.net:8443' }).origin, 'https://brain.tailtest.ts.net:8443');
  assert.throws(() => validatePrivateAccess({ ...config, ownerLogin: 'owner,other' }));
  const path = directory(t); assert.deepEqual(loadPrivateAccess(path), { config: null, error: false });
  writeFileSync(join(path, 'private-access.json'), '{broken');
  assert.deepEqual(loadPrivateAccess(path), { config: null, error: true });
  assert.throws(() => configFromStatus({ BackendState: 'NeedsLogin' }));
  const status = { BackendState: 'Running', Self: { DNSName: 'brain.tailtest.ts.net.', UserID: 1 }, User: { 1: { LoginName: config.ownerLogin } } };
  assert.equal(configFromStatus(status).origin, config.origin);
  assert.throws(() => configFromStatus({ ...status, Self: { ...status.Self, Tags: ['tag:server'] } }));
  const serve = { TCP: { 443: { HTTPS: true } }, Web: { 'brain.tailtest.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${config.port}` } } } } };
  assert.equal(routeOwned(config, serve), true);
  assert.equal(routeOwned(config, { ...serve, AllowFunnel: { 'brain.tailtest.ts.net:443': true } }), false);
});

test('the phone listener protects all routes and cannot bypass identity using local or forwarded hosts', async t => {
  const cleanups = []; const path = directory({ after: fn => cleanups.push(fn) });
  const app = createApplication({ port: 14322, directory: path, hermes: fixtureHermes(), privateAccess: config });
  app.listen(); await once(app.phoneServer, 'listening');
  t.after(async () => { await app.close(); for (const cleanup of cleanups) cleanup(); });
  assert.equal(app.phoneServer.address().address, '127.0.0.1');
  for (const path of ['/', '/manifest.webmanifest', '/api/state', '/api/health', '/api/export', '/api/access', '/api/voice/status', '/api/voice/speak', '/api/voice/transcribe', '/api/voice/warm', '/api/voice/input-status', '/api/chat/export', `/api/chat/events?id=${randomUUID()}`]) {
    for (const headers of [{}, { Host: '127.0.0.1:14322' }, { Host: 'localhost:14323' }, { ...auth, 'Tailscale-User-Login': 'other@example.test' }, { ...auth, 'Tailscale-User-Login': [config.ownerLogin, 'other'] }, { 'X-Forwarded-Host': '127.0.0.1:14322', 'X-Forwarded-For': '127.0.0.1' }]) assert.equal((await call(config.port, path, { headers })).status, 403, path);
  }
  for (const path of ['/api/whatsapp/status', '/api/whatsapp/chats', '/api/whatsapp/messages', '/api/whatsapp/receipts', '/api/whatsapp/prepare', '/api/whatsapp/send', '/api/whatsapp-monitor/state', '/api/whatsapp-monitor/run', '/api/whatsapp-monitor/configure', '/api/whatsapp-monitor/alert', '/api/memory/reviews', '/api/memory/prepare', '/api/memory/approve', '/api/memory/cancel']) {
    assert.equal((await call(config.port, path, { headers: { ...auth, 'Tailscale-User-Login': 'other@example.test' } })).status, 403);
  }
  assert.equal((await call(config.port, '/api/state', { headers: { ...auth, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await call(config.port, '/api/state', { headers: { ...auth, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(config.port, '/api/state', { headers: { ...auth, Host: 'evil.test' } })).status, 403);
  assert.equal((await call(14322, '/api/state', { headers: auth })).status, 403);
  assert.equal((await call(config.port, '/api/mutations', { method: 'POST', headers: { ...post, Origin: '' }, body: {} })).status, 403);
  const access = await call(config.port, '/api/access', { headers: auth });
  assert.equal(access.json().connection, 'private'); assert.equal(access.json().phoneUrl, config.origin);
  assert.equal(access.headers['strict-transport-security'], 'max-age=31536000');
});

test('private and desktop clients share receipts, restart identity and streaming chat without duplicate writes', async t => {
  const cleanups = []; const path = directory({ after: fn => cleanups.push(fn) }); let app = createApplication({ port: 14324, directory: path, hermes: fixtureHermes(), privateAccess: { ...config, port: 14325 } });
  app.listen(); await once(app.phoneServer, 'listening');
  t.after(async () => { if (app) await app.close(); for (const cleanup of cleanups) cleanup(); });
  const state = (await call(14325, '/api/state', { headers: auth })).json();
  const change = mutation(state, entry({ title: 'Phone restart test' }));
  const saved = (await call(14325, '/api/mutations', { method: 'POST', headers: post, body: change })).json();
  assert.equal((await call(14324, '/api/state')).json().records[0].id, saved.record.id);
  const input = { id: randomUUID(), conversationId: randomUUID(), serverId: state.serverId, message: 'TEST_SLOW', sources: [], afterTurnId: null };
  assert.equal((await call(14325, '/api/chat/send', { method: 'POST', headers: post, body: input })).status, 202);
  await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: 14325, path: `/api/chat/events?id=${input.conversationId}`, headers: auth }, res => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.once('data', data => { assert.match(data.toString(), new RegExp(input.id)); res.destroy(); resolve(); });
    }); req.on('error', reject); req.end();
  });
  assert.equal((await call(14325, '/api/chat/cancel', { method: 'POST', headers: post, body: { id: input.id, serverId: state.serverId } })).status, 200);
  await app.close(); app = null;
  app = createApplication({ port: 14324, directory: path, hermes: fixtureHermes(), privateAccess: { ...config, port: 14325 } });
  app.listen(); await once(app.phoneServer, 'listening');
  const restored = (await call(14325, '/api/state', { headers: auth })).json();
  assert.equal(restored.serverId, state.serverId); assert.equal(restored.records.length, 1);
  assert.deepEqual((await call(14325, '/api/mutations', { method: 'POST', headers: post, body: change })).json(), saved);
  assert.equal((await call(14325, `/api/chat/conversation?id=${input.conversationId}`, { headers: auth })).json().turns[0].status, 'cancelled');
});

test('ChatGPT account changes require local app origin and cannot interrupt an active reply', async t => {
  const path = directory(t); let signins = 0;
  const account = { status: async () => ({ state: 'signin', accounts: [] }), start: async () => { signins++; return { url: 'https://auth.openai.com/' }; }, signOut: async () => ({}), close: async () => {} };
  const app = createApplication({ port: 14345, directory: path, hermes: fixtureHermes(), auth: account, privateAccess: { ...config, port: 14346 } });
  app.listen(); await once(app.phoneServer, 'listening');
  try {
    const local = { 'Content-Type': 'application/json', 'X-Second-Brain': '1' };
    assert.equal((await call(14345, '/api/chatgpt/signin', { method: 'POST', headers: { ...local, Origin: 'https://evil.test' }, body: {} })).status, 403);
    assert.equal((await call(14345, '/api/chatgpt/signin', { method: 'POST', headers: { ...local, 'X-Second-Brain': '' }, body: {} })).status, 403);
    assert.equal((await call(14346, '/api/chatgpt/signin', { method: 'POST', headers: post, body: {} })).status, 403);
    assert.equal(signins, 0);
    assert.equal((await call(14345, '/api/chatgpt/signin', { method: 'POST', headers: local, body: {} })).status, 200);
    const turn = { id: randomUUID(), conversationId: randomUUID(), serverId: app.store.serverId, afterTurnId: null, message: 'TEST_SLOW', sources: [] };
    app.chat.send(turn);
    assert.equal((await call(14345, '/api/chatgpt/signout', { method: 'POST', headers: local, body: {} })).status, 409);
    assert.equal(signins, 1);
  } finally { await app.close(); }
});
