import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory } from './helpers.mjs';
import { evergreenStorage } from '../server/evergreen-storage.mjs';
import { createEvergreenReleaseLoader, evergreenReleasePath } from '../server/evergreen-release-loader.mjs';
import { reviewedBridgePublic, reviewedBridgeAuthorizationDigest } from '../server/evergreen-reviewed-bridge-production.mjs';
import { CAPABILITIES } from '../server/evergreen-contract.mjs';
import { EVERGREEN_BASE } from '../server/evergreen-transport.mjs';
import { createApplication } from '../server/index.mjs';
import { openStore } from '../server/store.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
import { once } from 'node:events';

function fixture(t) {
  const cleanup = [], root = directory({ after: fn => cleanup.push(fn) }), path = evergreenReleasePath(root);
  mkdirSync(dirname(path), { recursive: true });
  let time = 1791936000000, io = 0, unlocked = true, intercept = async (_url, _init, send) => send();
  const keys = new Map(), calls = [], registries = [];
  const release = { version: 3, enabled: true, mode: 'household', origin: EVERGREEN_BASE,
    bindingSource: 'verified-evergreen-settings', bridge: reviewedBridgePublic(),
    evidence: Object.fromEntries(['securityReleaseReviewed', 'sessionBindingsReviewed', 'tenancyAuthorityVerified',
      'bridgeOutputIsolationVerified', 'sourceReviewIntegrityVerified', 'confirmedWritesVerified',
      'receiptsRevocationVerified', 'nativeContinuityOrHoldVerified'].map(k => [k, true])),
    rulesSha256: 'a'.repeat(64), bridgeEvidenceSha256: 'b'.repeat(64), deploymentId: 'synthetic-never-install',
    verifiedAtMs: time, householdId: 'HH-SYNTHETIC-loader', ownerUid: 'synthetic-owner',
    bindingDigest: 'c'.repeat(64), authorizationRevision: 1,
    members: ['owner', 'partner'].map((profileId, i) => ({ profileId, memberUid: i ? 'synthetic-member' : 'synthetic-owner',
      sessionSubject: `jarvis-workspace:${randomUUID()}:${profileId}`, scopes: ['tasks:read', 'tasks:write', 'planner:read', 'planner:write'] })) };
  release.authorizationDigest = reviewedBridgeAuthorizationDigest(release);
  const document = () => ({ format: 'jarvis-reviewed-bridge-installation-v1', operatorReviewed: true, release: structuredClone(release) });
  const write = value => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  const storageFactory = p => evergreenStorage(p, { vault: {
    acquire: async () => {}, release: async () => {}, read: async () => { io++; return structuredClone(keys.get(p)); },
    write: async v => { io++; keys.set(p, structuredClone(v)); },
  } });
  const fetcher = async (url, init) => intercept(url, init, async () => {
    calls.push({ path: url.slice(EVERGREEN_BASE.length), body: init.body });
    const body = url.endsWith('/capabilities') ? { version: 1, release: reviewedBridgePublic(),
      capabilities: CAPABILITIES.map(c => ({ ...c, rolloutEnabled: ['tasks', 'planner'].includes(c.domain) })) }
      : { release: reviewedBridgePublic(), pairingId: randomUUID(), expiresAt: new Date(time + 600000).toISOString() };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const loader = () => createEvergreenReleaseLoader({ directory: root, storageFactory, fetcher, now: () => time });
  const options = i => ({ directory: i ? join(root, 'profiles', 'partner') : root,
    profileId: release.members[i].profileId, subject: release.members[i].sessionSubject,
    authenticate: () => unlocked ? { profileId: release.members[i].profileId, subject: release.members[i].sessionSubject, sessionId: 'synthetic-session' } : null });
  const register = (l, i, patch = {}) => { const r = l.registryFactory({ ...options(i), ...patch }); registries.push(r); return r; };
  async function open(r) { const [{ handle }] = await r.connections({}), c = r.channel(), token = await c.select({}, handle);
    return { run: (op, input) => c.run(token, op, input), consent: () => c.privacy(token, { processWithAI: true, retainChat: false, confirm: true }) }; }
  t.after(async () => { for (const r of registries) await r.close(); for (const fn of cleanup) await fn(); });
  return { root, path, release, document, write, loader, register, open, calls, options,
    beforeCleanup: fn => cleanup.unshift(fn),
    io: () => io, advance: ms => { time += ms; }, lock: () => { unlocked = false; }, intercept: fn => { intercept = fn; } };
}

test('operator loader defaults held and rejects malformed, oversized, unreviewed, stale or foreign evidence without I/O', async t => {
  const h = fixture(t);
  const bad = [null, '{bad', ' '.repeat(32769), {}, { ...h.document(), operatorReviewed: false },
    { ...h.document(), extra: true }];
  for (const change of [r => { r.verifiedAtMs -= 86400000; }, r => { r.verifiedAtMs++; },
    r => { r.members[1].profileId = 'secondary'; }, r => { r.members.reverse(); }, r => { r.authorizationDigest = 'f'.repeat(64); },
    r => { r.bridge.rolloutDomains.push('expenses'); }, r => { r.enabled = false; }]) {
    const d = h.document(); change(d.release); bad.push(d);
  }
  for (const value of bad) {
    if (value !== null) h.write(value);
    const l = h.loader(); assert.throws(() => h.register(l, 0), { code: 'release_held' }); assert.equal(l.seal().held, true);
  }
  assert.equal(h.io(), 0); assert.equal(h.calls.length, 0);
});

test('both actual server subjects and directories must register before use; mismatch holds both workspaces', async t => {
  for (const patch of [{ subject: `jarvis-workspace:${randomUUID()}:partner` }, { directory: 'elsewhere' }, { profileId: 'owner' }]) {
    const h = fixture(t); h.write(h.document()); const l = h.loader(), a = h.register(l, 0);
    await assert.rejects(a.connections({}), { code: 'release_held' });
    assert.throws(() => h.register(l, 1, patch), { code: 'release_held' }); assert.equal(l.seal().held, true);
    await assert.rejects(a.connections({}), { code: 'release_held' }); assert.equal(h.io(), 0); assert.equal(h.calls.length, 0);
  }
  const h = fixture(t); h.write(h.document()); const l = h.loader(), a = h.register(l, 0); l.seal();
  await assert.rejects(a.connections({}), { code: 'release_held' });
});

test('file installation never supplies a PIN session or privacy consent and never pairs on startup', async t => {
  const h = fixture(t); h.write(h.document()); const l = h.loader(), a = h.register(l, 0); h.register(l, 1);
  assert.equal(l.seal().held, false); assert.equal(h.io(), 0); assert.equal(h.calls.length, 0);
  const c = await h.open(a); await assert.rejects(c.run('pair'), { code: 'privacy_required' });
  h.lock(); await assert.rejects(a.connections({}), { code: 'denied' }); assert.equal(h.calls.length, 0);
});

test('file removal or replacement suspends existing registries; renewal requires a fresh sealed loader', async t => {
  const h = fixture(t); h.write(h.document()); const l = h.loader(), a = h.register(l, 0); h.register(l, 1); l.seal();
  const c = await h.open(a); await c.consent(); unlinkSync(h.path);
  await assert.rejects(c.run('pair'), { code: 'release_held' }); assert.equal(h.calls.length, 0);
  h.advance(1000); const renewed = h.document(); renewed.release.verifiedAtMs += 1000; h.write(renewed);
  await assert.rejects(c.run('status'), { code: 'release_held' });
  await a.close(); const next = h.loader(), restored = h.register(next, 0); h.register(next, 1); next.seal();
  const again = await h.open(restored); assert.equal((await again.run('status')).connection, null);
  assert.equal(h.calls.length, 0); h.advance(86400000);
  await assert.rejects(again.run('pair'), { code: 'release_held' }); assert.equal(h.calls.length, 0);
});

test('lost pairing response preserves original proof through operator-loader restart without automatic retry', async t => {
  const h = fixture(t); h.write(h.document()); let lost = true;
  h.intercept(async (url, _init, send) => { const r = await send(); if (url.endsWith('/pair') && lost) { lost = false; throw new Error('lost'); } return r; });
  const l = h.loader(), a = h.register(l, 0); h.register(l, 1); l.seal(); const c = await h.open(a); await c.consent();
  await assert.rejects(c.run('pair'), { code: 'uncertain' }); const body = h.calls.find(r => r.path === '/pair').body;
  await a.close(); const next = h.loader(), restored = h.register(next, 0); h.register(next, 1); next.seal();
  assert.equal(h.calls.filter(r => r.path === '/pair').length, 1);
  await (await h.open(restored)).run('pair'); assert.equal(h.calls.filter(r => r.path === '/pair').at(-1).body, body);
});

test('removal during capabilities preflight prevents proof transmission', async t => {
  const h = fixture(t); h.write(h.document());
  h.intercept(async (url, _init, send) => { const r = await send(); if (url.endsWith('/capabilities')) unlinkSync(h.path); return r; });
  const l = h.loader(), a = h.register(l, 0); h.register(l, 1); l.seal(); const c = await h.open(a); await c.consent();
  await assert.rejects(c.run('pair'), { code: 'release_held' }); assert.equal(h.calls.filter(r => r.path === '/pair').length, 0);
});

test('mounted owner and partner hosts supply actual stable principals and retain PIN and Origin guards', async t => {
  const h = fixture(t), dirs = [h.root, join(h.root, 'profiles', 'partner')], apps = [];
  for (const [i, dir] of dirs.entries()) {
    const store = openStore(dir);
    h.release.members[i].sessionSubject = `jarvis-workspace:${store.serverId}:${h.release.members[i].profileId}`;
    store.close();
  }
  h.write(h.document()); const loader = h.loader();
  for (const [i, dir] of dirs.entries()) apps.push(createApplication({ directory: dir, port: 14971 + i,
    profile: { id: h.release.members[i].profileId, displayName: 'Same display label', addressAs: '' },
    privateAccess: null, hermes: fixtureHermes(), evergreenMemberRegistryFactory: loader.registryFactory }));
  assert.equal(loader.seal().held, false);
  h.beforeCleanup(async () => { for (const app of apps) await app.close(); });
  for (const app of apps) { app.listen(); await once(app.server, 'listening'); }
  const req = (i, route, body, cookie, extra = {}) => fetch(`http://127.0.0.1:${14971 + i}/api/${route}`, {
    headers: { Connection: 'close', 'X-Second-Brain': '1', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const cookies = [];
  for (let i = 0; i < 2; i++) {
    assert.equal((await req(i, 'evergreen/pair', {})).status, 403, 'No configured PIN/session cannot create proof');
    const unlock = await req(i, 'lock/setup', { newPin: '938271', confirmPin: '938271' });
    assert.equal(unlock.status, 200); cookies[i] = unlock.headers.get('set-cookie').split(';')[0];
    const state = await req(i, 'evergreen/status', undefined, cookies[i]); assert.equal(state.status, 200);
    assert.equal((await state.json()).state, 'disconnected');
    assert.equal((await req(i, 'evergreen/pair', {}, cookies[i], { Origin: 'https://foreign.invalid' })).status, 403);
  }
  await req(0, 'lock/lock', {}, cookies[0]);
  assert.equal((await req(0, 'evergreen/status', undefined, cookies[0])).status, 401);
  assert.equal((await req(1, 'evergreen/status', undefined, cookies[1])).status, 200);
  assert.equal(h.calls.length, 0);
});
