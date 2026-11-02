import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createWindowsApprovalBroker, phoneKeyIdentity } from '../server/windows-signin-approval.mjs';

function fixture() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const deviceId = phoneKeyIdentity(publicKey), computerId = randomUUID(), bootId = randomUUID(), accountSid = 'S-1-5-21-1-2-3-1001';
  mkdirSync('.test-data', { recursive: true }); const file = join(mkdtempSync(resolve('.test-data/windows-approval-')), 'synthetic.json');
  writeFileSync(file, JSON.stringify({ devices: { [deviceId]: { publicKey } }, requests: {} }));
  let current = { id: 2, accountSid, locked: true }, clock = 1000000, failWrite = false;
  const storage = { transaction(fn) { const state = JSON.parse(readFileSync(file)); const output = fn(state); if (failWrite) throw new Error('Synthetic disk failure'); writeFileSync(file + '.tmp', JSON.stringify(state)); renameSync(file + '.tmp', file); return output; } };
  const options = { storage, computerId, accountSid, bootId, session: () => current, now: () => clock };
  return { options, storage, deviceId, keys, sign: challenge => ({ requestId: challenge.requestId, signature: sign('sha256', Buffer.from(challenge.payload), keys.privateKey).toString('base64') }),
    setSession(value) { current = { ...current, ...value }; }, tick(ms) { clock += ms; }, failWrite(value) { failWrite = value; } };
}
test('signed approval is bound to target, survives broker reconstruction and is consumed exactly once', () => {
  const f = fixture(); let broker = createWindowsApprovalBroker(f.options);
  const challenge = broker.challenge({ deviceId: f.deviceId, operation: 'windows.unlock' });
  broker = createWindowsApprovalBroker(f.options);
  assert.equal(broker.consume(f.sign(challenge)).operation, 'windows.unlock');
  assert.throws(() => createWindowsApprovalBroker(f.options).consume(f.sign(challenge)), /rejected/);
});
test('forged signatures, stale requests, replaced proposals, different boot/session and revoked phones fail closed', () => {
  const f = fixture(), broker = createWindowsApprovalBroker(f.options);
  const issue = () => broker.challenge({ deviceId: f.deviceId, operation: 'windows.unlock' });
  const first = issue(), replaced = issue();
  assert.throws(() => broker.consume(f.sign(first)), /rejected/);
  assert.throws(() => broker.consume({ ...f.sign(replaced), signature: Buffer.alloc(256).toString('base64') }), /rejected/);
  f.setSession({ id: 3 }); assert.throws(() => broker.consume(f.sign(replaced)), /rejected/); f.setSession({ id: 2 });
  assert.throws(() => createWindowsApprovalBroker({ ...f.options, bootId: randomUUID() }).consume(f.sign(replaced)), /rejected/);
  f.tick(30000); assert.throws(() => broker.consume(f.sign(replaced)), /rejected/);
  const revoked = issue(); f.storage.transaction(s => { s.devices[f.deviceId].revoked = true; });
  assert.throws(() => broker.consume(f.sign(revoked)), /rejected/);
});
test('wrong authority and write failure never yield an approval; no arbitrary computer action is accepted', () => {
  const f = fixture(), broker = createWindowsApprovalBroker(f.options);
  assert.throws(() => broker.challenge({ deviceId: f.deviceId, operation: 'shell.exec' }), /rejected/);
  assert.throws(() => broker.challenge({ deviceId: f.deviceId, operation: 'windows.lock' }), /rejected/);
  const value = broker.challenge({ deviceId: f.deviceId, operation: 'windows.unlock' });
  f.failWrite(true); assert.throws(() => broker.consume(f.sign(value)), /disk failure/); f.failWrite(false);
  f.setSession({ accountSid: 'S-1-5-21-9-9-9-1001' }); assert.throws(() => broker.consume(f.sign(value)), /rejected/);
  f.setSession({ accountSid: f.options.accountSid, remote: true }); assert.throws(() => broker.consume(f.sign(value)), /rejected/);
});
