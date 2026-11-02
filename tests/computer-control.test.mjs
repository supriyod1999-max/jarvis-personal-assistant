import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { windowsApprovalPayload } from '../server/windows-signin-approval.mjs';
import { createComputerControl } from '../server/computer-control.mjs';
import { directory } from './helpers.mjs';
function fixture(t, relay) {
  const cleanups = [], path = directory({ after: fn => cleanups.push(fn) }), keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  let facts = { sessionId: 2, accountSid: 'S-1-5-21-1-2-3-1001', local: true, locked: false }, clock = Date.now(), locks = 0, ambiguous = false;
  const native = { available: () => true, status: async () => ({ ...facts }), lock: async value => { assert.equal(value.sessionId, facts.sessionId); locks++; if (ambiguous) throw Error('Unknown'); facts.locked = true; return { initiated: true }; } };
  const create = () => createComputerControl({ directory: path, native, relay, now: () => clock });
  const opened = []; const open = () => { const value = create(); opened.push(value); return value; };
  const control = open(); t.after(async () => { for (const item of opened) await item.close(); for (const cleanup of cleanups) cleanup(); });
  const signed = challenge => sign('sha256', Buffer.from(challenge.payload), keys.privateKey).toString('base64');
  async function pair() {
    const value = await control.action('pair', { publicKey, name: 'Synthetic phone' }, false);
    await control.action('pair-proof', { pairId: value.pairId, signature: signed(value) }, false);
    await control.action('approve-pair', { pairId: value.pairId, deviceId: value.deviceId, code: value.code }, true); return value;
  }
  return { control, create: open, pair, signed, publicKey, locks: () => locks, tick: ms => { clock += ms; }, set: value => Object.assign(facts, value), ambiguous: () => { ambiguous = true; } };
}
test('phone key possession, matching local review and exact session are required before lock', async t => {
  const f = fixture(t), c = f.control;
  const pair = await c.action('pair', { publicKey: f.publicKey, name: '<untrusted phone>' }, false);
  await assert.rejects(c.action('approve-pair', { pairId: pair.pairId, deviceId: pair.deviceId, code: pair.code }, true));
  await assert.rejects(c.action('pair-proof', { pairId: pair.pairId, signature: Buffer.alloc(256).toString('base64') }, false));
  await c.action('pair-proof', { pairId: pair.pairId, signature: f.signed(pair) }, false);
  assert.equal((await c.status(false)).pending.length, 0); assert.equal((await c.status(true)).pending.length, 1);
  await assert.rejects(c.action('approve-pair', { pairId: pair.pairId, deviceId: pair.deviceId, code: pair.code }, false), /laptop/);
  await assert.rejects(c.action('approve-pair', { pairId: pair.pairId, deviceId: pair.deviceId, code: 'wrong' }, true));
  await c.action('approve-pair', { pairId: pair.pairId, deviceId: pair.deviceId, code: pair.code }, true);
  const challenge = await c.action('challenge', { deviceId: pair.deviceId, operation: 'windows.lock' }, false);
  const proof = { requestId: challenge.requestId, signature: f.signed(challenge) };
  const result = await c.action('approve', proof, false); assert.equal(result.locked, true); assert.equal(f.locks(), 1);
  f.set({ locked: false }); await assert.rejects(c.action('approve', proof, false)); assert.equal(f.locks(), 1);
  await assert.rejects(c.action('challenge', { deviceId: pair.deviceId, operation: 'windows.unlock' }, false), /not enrolled/);
  assert.equal((await c.status(true)).unlockReady, false);
});
test('expiry, revoke, account/session changes, restart and ambiguous native outcomes never replay', async t => {
  const f = fixture(t), paired = await f.pair(), c = f.control;
  const issue = () => c.action('challenge', { deviceId: paired.deviceId, operation: 'windows.lock' }, false);
  let value = await issue(); f.tick(30000); await assert.rejects(c.action('approve', { requestId: value.requestId, signature: f.signed(value) }, false));
  value = await issue(); f.set({ sessionId: 4 }); await assert.rejects(c.action('approve', { requestId: value.requestId, signature: f.signed(value) }, false)); f.set({ sessionId: 2 });
  f.set({ accountSid: 'S-1-5-21-9-9-9-1001' }); await assert.rejects(issue()); f.set({ accountSid: 'S-1-5-21-1-2-3-1001' });
  f.ambiguous(); value = await issue(); const proof = { requestId: value.requestId, signature: f.signed(value) };
  await assert.rejects(c.action('approve', proof, false), /not be resent/); await assert.rejects(c.action('approve', proof, false)); assert.equal(f.locks(), 1);
  value = await issue(); const restarted = f.create(); await assert.rejects(restarted.action('approve', { requestId: value.requestId, signature: f.signed(value) }, false));
  await c.action('revoke', { deviceId: paired.deviceId }, true); await assert.rejects(issue());
});
test('remote sessions and arbitrary commands fail closed; expired pairing cannot be approved', async t => {
  const f = fixture(t), c = f.control;
  await assert.rejects(c.action('pair', { publicKey: f.publicKey, name: 'Phone', password: 'must never enter' }, false));
  const value = await c.action('pair', { publicKey: f.publicKey, name: 'Phone' }, false); f.tick(300001);
  await assert.rejects(c.action('pair-proof', { pairId: value.pairId, signature: f.signed(value) }, false));
  f.set({ local: false }); assert.equal((await c.status(true)).available, false);
  await assert.rejects(c.action('pair', { publicKey: f.publicKey, name: 'Phone' }, false));
});
test('staged unlock forwards only a verified one-use phone signature and never treats delivery as successful Windows logon', async t => {
  let current, deliveries = 0;
  const relay = { challenge: async expected => {
    current ||= { ...expected, operation: 'windows.unlock', bootId: randomUUID(), requestId: randomUUID(), nonce: 'a'.repeat(43), expiresAtMs: Date.now() + 30000 };
    return { requestId: current.requestId, expiresAtMs: current.expiresAtMs, payload: windowsApprovalPayload(current) };
  }, submit: async value => { assert.equal(value.requestId, current.requestId); deliveries++; return { initiated: true, locked: true, message: 'Approval delivered; confirm Windows state.' }; } };
  const f = fixture(t, relay), paired = await f.pair(), c = f.control; f.set({ locked: true });
  assert.equal((await c.status(false)).unlockReady, true);
  const challenge = await c.action('challenge', { deviceId: paired.deviceId, operation: 'windows.unlock' }, false);
  await assert.rejects(c.action('approve', { requestId: challenge.requestId, signature: Buffer.alloc(256).toString('base64') }, false));
  const proof = { requestId: challenge.requestId, signature: f.signed(challenge) }, result = await c.action('approve', proof, false);
  assert.equal(result.initiated, true); assert.equal(result.locked, true); assert.equal(deliveries, 1); assert.equal(f.locks(), 0);
  await assert.rejects(c.action('approve', proof, false));
  await assert.rejects(c.action('challenge', { deviceId: paired.deviceId, operation: 'windows.unlock' }, false), /already been submitted/);
});
