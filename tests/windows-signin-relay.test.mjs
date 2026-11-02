import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { directory } from './helpers.mjs';
import { windowsApprovalPayload, phoneKeyIdentity } from '../server/windows-signin-approval.mjs';
import { createWindowsSigninRelay } from '../server/windows-signin-relay.mjs';
test('native relay transports only exact unexpired public challenges and a single signature', async t => {
  const folder = directory(t); mkdirSync(join(folder, 'responses'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const value = { operation: 'windows.unlock', deviceId: phoneKeyIdentity(publicKey), computerId: randomUUID(), accountSid: 'S-1-5-21-1-2-3-1001', sessionId: 2, bootId: randomUUID(), requestId: randomUUID(), nonce: 'a'.repeat(43), expiresAtMs: Date.now() + 30000 };
  const payload = windowsApprovalPayload(value), relay = createWindowsSigninRelay({ directory: folder }); writeFileSync(join(folder, 'challenge.txt'), payload);
  const expected = { deviceId: value.deviceId, computerId: value.computerId, accountSid: value.accountSid, sessionId: 2 };
  const challenge = await relay.challenge(expected), signature = sign('sha256', Buffer.from(payload), keys.privateKey).toString('base64');
  await assert.rejects(relay.challenge({ ...expected, sessionId: 3 }));
  await assert.rejects(relay.submit({ ...challenge, payload: payload + 'tampered', signature }, expected));
  await relay.submit({ ...challenge, signature }, expected); assert.equal(readFileSync(join(folder, 'responses', value.requestId + '.sig'), 'ascii'), signature);
  await assert.rejects(relay.submit({ ...challenge, signature }, expected));
  const expired = createWindowsSigninRelay({ directory: folder, now: () => value.expiresAtMs }); await assert.rejects(expired.challenge(expected));
  const checker = resolve('output/windows-signin/build/Release/jarvis-proof-test.exe');
  if (process.platform === 'win32' && existsSync(checker)) {
    const file = join(folder, 'synthetic-proof.txt'); writeFileSync(file, [publicKey, Buffer.from(payload).toString('base64'), signature].join('\n'));
    execFileSync(checker, [file], { windowsHide: true, timeout: 5000, stdio: 'pipe' });
    const notifier = resolve('output/windows-signin/build/Release/jarvis-notifier-test.exe');
    if (existsSync(notifier)) {
      writeFileSync(file + '.sig', signature);
      execFileSync(notifier, [file], { windowsHide: true, timeout: 5000, stdio: 'pipe' });
    }
  }
});
