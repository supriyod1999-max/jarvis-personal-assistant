import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createWorkspaceLock } from '../server/workspace-lock.mjs';
import { createApplication } from '../server/index.mjs';
import { createMonitorMailbox } from '../server/monitor-ipc.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
import { directory } from './helpers.mjs';

const req = cookie => ({ headers: { cookie: cookie || '' } });
function response() { const headers = {}; return { headers, setHeader: (key, value) => headers[key] = value, cookie: () => headers['Set-Cookie']?.split(';')[0] }; }
test('PIN sessions are workspace-specific, hashed, persistent, expiring and invalidated by PIN changes', async t => {
  const root = directory(t); let time = 1000, lock = createWorkspaceLock({ directory: root, id: 'owner', now: () => time });
  assert.equal(lock.allowed(req()), true);
  const first = response(); await lock.action('setup', { newPin: '135790', confirmPin: '135790' }, req(), first, true);
  assert.match(first.headers['Set-Cookie'], /HttpOnly; SameSite=Strict.*Secure/);
  assert.equal(lock.allowed(req()), false); assert.equal(lock.allowed(req(first.cookie())), true);
  assert.equal(lock.allowed(req(first.cookie().replace('owner=', 'second='))), false);
  assert.equal(readFileSync(join(root, 'lock.sqlite-wal')).includes(Buffer.from('135790')), false);
  const second = response(); await lock.action('unlock', { pin: '135790' }, req(), second, false);
  await assert.rejects(lock.action('change', { currentPin: '111111', newPin: '246802', confirmPin: '246802' }, req(first.cookie()), response(), false), /Incorrect/);
  const changed = response(); await lock.action('change', { currentPin: '135790', newPin: '246802', confirmPin: '246802' }, req(first.cookie()), changed, false);
  assert.equal(lock.allowed(req(first.cookie())), false); assert.equal(lock.allowed(req(second.cookie())), false);
  lock.close(); lock = createWorkspaceLock({ directory: root, id: 'owner', now: () => time });
  assert.equal(lock.allowed(req(changed.cookie())), true);
  time += 8 * 60 * 60 * 1000; assert.equal(lock.allowed(req(changed.cookie())), false);
  const again = response(); await lock.action('unlock', { pin: '246802' }, req(), again, false);
  await lock.action('lock', {}, req(again.cookie()), response(), false); assert.equal(lock.allowed(req(again.cookie())), false); lock.close();
});
test('incorrect PIN attempts trigger a durable cooldown, including correct PINs during cooldown', async t => {
  const root = directory(t); let time = 1000, lock = createWorkspaceLock({ directory: root, id: 'owner', now: () => time });
  await lock.action('setup', { newPin: '123456', confirmPin: '123456' }, req(), response(), false);
  for (let i = 0; i < 5; i++) await assert.rejects(lock.action('unlock', { pin: '000000' }, req(), response(), false), e => e.status === (i === 4 ? 429 : 401));
  lock.close(); lock = createWorkspaceLock({ directory: root, id: 'owner', now: () => time });
  await assert.rejects(lock.action('unlock', { pin: '123456' }, req(), response(), false), e => e.status === 429);
  time += 15 * 60 * 1000; const allowed = response(); await lock.action('unlock', { pin: '123456' }, req(), allowed, false); assert.equal(lock.allowed(req(allowed.cookie())), true); lock.close();
});
test('server enforces PIN on records, exports, chats, reviews, voice and monitoring, retaining origin protection', async t => {
  const cleanups = [], root = directory({ after: f => cleanups.push(f) });
  const app = createApplication({ directory: root, port: 14363, hermes: fixtureHermes(), privateAccess: null });
  app.listen(); await once(app.server, 'listening');
  t.after(async () => { await app.close(); cleanups.forEach(f => f()); });
  const call = (path, data, cookie, extra = {}) => fetch('http://127.0.0.1:14363/api/' + path, { headers: { 'X-Second-Brain': '1', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}) });
  assert.equal((await call('lock/setup', { newPin: '123456', confirmPin: '123456' }, null, { Origin: 'https://evil.test' })).status, 403);
  const setup = await call('lock/setup', { newPin: '123456', confirmPin: '123456' }); assert.equal(setup.status, 200); const cookie = setup.headers.get('set-cookie').split(';')[0];
  for (const path of ['connections/health','instagram/status','instagram/library','state','export','chat/conversations','chat/export','memory/reviews','whatsapp/accounts','whatsapp-monitor/state','profile','voice/status','evergreen/status','evergreen/records']) assert.equal((await call(path)).status, 401, path);
  for (const path of ['instagram/signin','instagram/configure','instagram/sync','instagram/queue','instagram/analyse','mutations','chat/send','memory/approve','voice/speak','voice/transcribe','whatsapp-monitor/run','profile/update','evergreen/pair','evergreen/exchange','evergreen/sync','evergreen/rotate','evergreen/recover','evergreen/disconnect','evergreen/privacy','evergreen/redact-chat','evergreen/check']) assert.equal((await call(path, {})).status, 401, path);
  assert.equal((await call('state', null, cookie)).status, 200);
  assert.equal((await call('health')).status, 200); assert.equal((await call('runtime')).status, 200);
  await call('lock/lock', {}, cookie); assert.equal((await call('state', null, cookie)).status, 401);
});
test('background mailbox uses only the saved monitoring scope while PIN is locked and ignores stale requests', async t => {
  const root = directory(t); let runs = 0;
  const lock = createWorkspaceLock({ directory: root, id: 'owner' });
  await lock.action('setup', { newPin: '123456', confirmPin: '123456' }, req(), response(), false);
  const mailbox = createMonitorMailbox({ directory: root, interval: 100000, monitor: { run: async (...args) => { assert.equal(args.length, 0); runs++; return { settings: { enabled: true, scope: 'selected' }, report: { newAlerts: 0 }, alerts: [] }; } } });
  const id = randomUUID(); writeFileSync(join(root, 'monitor-request.json'), JSON.stringify({ id, at: Date.now(), scope: 'all', send: true }));
  await mailbox.poll(); assert.equal(runs, 1); assert.equal(lock.allowed(req()), false);
  assert.equal(JSON.parse(readFileSync(join(root, 'monitor-response.json'), 'utf8')).id, id);
  await mailbox.poll(); assert.equal(runs, 1);
  writeFileSync(join(root, 'monitor-request.json'), JSON.stringify({ id: randomUUID(), at: 0 })); await mailbox.poll(); assert.equal(runs, 1);
  await mailbox.close(); lock.close();
});

