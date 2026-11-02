// Phone control is separate from Windows credential handling. This store holds
// public keys and replay receipts only; it never accepts a Windows password.
import { DatabaseSync } from 'node:sqlite';
import { createPublicKey, randomBytes, randomInt, randomUUID, verify } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createWindowsApprovalBroker, phoneKeyIdentity } from './windows-signin-approval.mjs';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const signatureValid = (payload, signature, publicKey) => typeof signature === 'string' && /^[A-Za-z0-9+/]{342}==$/.test(signature)
  && verify('sha256', Buffer.from(payload), createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64'));
export function createComputerControl({ directory, native, relay, now = Date.now }) {
  const db = new DatabaseSync(join(directory, 'computer-control.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(JSON.stringify({ computerId: randomUUID(), devices: {}, requests: {}, pairs: {} }));
  let chain = Promise.resolve(), facts;
  const bootId = randomUUID();
  function read() { return JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value); }
  const storage = { transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const state = read(); const result = fn(state); db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state)); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  async function context() {
    if (!native?.available()) fail('The Windows computer helper is not ready.', 503);
    const value = await native.status();
    if (!value.local || !Number.isSafeInteger(value.sessionId) || value.sessionId < 1 || !/^S-1-5-(?:\d+-){1,14}\d+$/.test(value.accountSid) || typeof value.locked !== 'boolean') fail('No supported local Windows session is available.', 503);
    facts = value; return value;
  }
  function broker(state) {
    if (!state.accountSid || state.accountSid !== facts.accountSid) fail('The Windows account changed. Pair your phone again.', 409);
    return createWindowsApprovalBroker({ storage, computerId: state.computerId, accountSid: state.accountSid, bootId, now,
      session: () => ({ id: facts.sessionId, accountSid: facts.accountSid, locked: facts.locked, remote: !facts.local }) });
  }
  function prune(state) {
    for (const [id, pair] of Object.entries(state.pairs)) if (pair.expiresAtMs <= now()) delete state.pairs[id];
    for (const [id, request] of Object.entries(state.requests)) if (request.expiresAtMs < now() - 86400000) delete state.requests[id];
    for (const [id, request] of Object.entries(state.nativeRequests || {})) if (request.expiresAtMs < now() - 86400000) delete state.nativeRequests[id];
  }
  function serial(fn) { const result = chain.then(fn); chain = result.catch(() => {}); return result; }
  const status = (local, authorized = () => true) => serial(async () => {
    let live, message = ''; try { live = await context(); } catch (error) { message = error.message; }
    const state = read(); let unlockReady = false;
    if (live?.locked && relay && state.accountSid === live.accountSid) for (const [deviceId, device] of Object.entries(state.devices)) {
      if (device.revoked) continue;
      try { await relay.challenge({ deviceId, computerId: state.computerId, accountSid: live.accountSid, sessionId: live.sessionId }); unlockReady = true; break; } catch {}
    }
    if (!authorized()) fail('Unlock the primary workspace again before using computer controls.', 401);
    return { available: !!live, computerId: state.computerId, computerName: hostname(), accountSid: live?.accountSid,
      locked: live?.locked ?? null, lockReady: !!live, unlockReady, localReview: local,
      unlockMessage: 'Windows sign-in requires the native credential vault, provider and broker to be enrolled and verified.',
      message, devices: Object.entries(state.devices).filter(([, device]) => !device.revoked).map(([id, device]) => ({ id, name: device.name, pairedAt: device.pairedAt })),
      pending: local ? Object.entries(state.pairs).filter(([, pair]) => pair.expiresAtMs > now() && pair.proved).map(([id, pair]) => ({ id, name: pair.name, deviceId: pair.deviceId, code: pair.code, expiresAtMs: pair.expiresAtMs })) : [] };
  });
  const action = (operation, input, local, authorized = () => true) => serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid computer request.');
    const allowed = { pair: ['publicKey','name'], 'pair-proof': ['pairId','signature'], 'approve-pair': ['pairId','deviceId','code'], revoke: ['deviceId'], enrollment: ['deviceId'], challenge: ['deviceId','operation'], approve: ['requestId','signature'] }[operation];
    if (!allowed || Object.keys(input).some(key => !allowed.includes(key))) fail('Unknown computer operation.');
    if (['approve-pair', 'revoke','enrollment'].includes(operation) && !local) fail('Review phone pairing on your laptop.', 403);
    if (['pair','pair-proof','challenge','approve'].includes(operation) && local) fail('Use the paired native phone app for this operation.', 403);
    await context();
    if (!authorized()) fail('Unlock the primary workspace again before using computer controls.', 401);
    if (operation === 'enrollment') {
      const state = read(), device = state.devices[input.deviceId];
      if (!device || device.revoked || state.accountSid !== facts.accountSid || facts.locked) fail('Unlock this laptop and review a paired phone first.');
      return { configuration: [state.computerId, state.accountSid, device.publicKey].join('\n') };
    }
    if (operation === 'pair') return storage.transaction(state => {
      prune(state);
      if (Object.keys(state.pairs).length >= 8 || Object.values(state.devices).filter(d => !d.revoked).length >= 8) fail('Review or revoke an existing phone before pairing another.', 429);
      if (typeof input.publicKey !== 'string' || input.publicKey.length > 1000 || typeof input.name !== 'string' || input.name.length < 1 || input.name.length > 60 || /[\x00-\x1f]/.test(input.name)) fail('Invalid phone identity.');
      const deviceId = phoneKeyIdentity(input.publicKey), pairId = randomUUID(), nonce = randomBytes(32).toString('base64url'), expiresAtMs = now() + 300000;
      const payload = ['JARVIS_PHONE_PAIR_V1', state.computerId, facts.accountSid, deviceId, pairId, nonce, expiresAtMs].join('\n');
      const code = String(randomInt(100000, 1000000));
      state.pairs[pairId] = { publicKey: input.publicKey, name: input.name, deviceId, code, payload, expiresAtMs, accountSid: facts.accountSid, sessionId: facts.sessionId, proved: false };
      return { pairId, deviceId, computerId: state.computerId, accountSid: facts.accountSid, computerName: hostname(), code, payload, expiresAtMs };
    });
    if (operation === 'pair-proof') return storage.transaction(state => {
      const pair = uuid(input.pairId) && state.pairs[input.pairId];
      if (!pair || pair.expiresAtMs <= now() || pair.accountSid !== facts.accountSid || pair.sessionId !== facts.sessionId || !signatureValid(pair.payload, input.signature, pair.publicKey)) fail('Phone pairing proof was rejected.');
      pair.proved = true; return { proved: true };
    });
    if (operation === 'approve-pair') return storage.transaction(state => {
      const pair = uuid(input.pairId) && state.pairs[input.pairId];
      if (!pair || !pair.proved || facts.locked || pair.expiresAtMs <= now() || pair.accountSid !== facts.accountSid || pair.sessionId !== facts.sessionId || input.deviceId !== pair.deviceId || input.code !== pair.code) fail('Phone pairing review expired or changed.');
      if (state.accountSid && state.accountSid !== facts.accountSid && Object.values(state.devices).some(d => !d.revoked)) fail('Revoke old account pairings first.');
      state.accountSid = facts.accountSid; state.devices[pair.deviceId] = { publicKey: pair.publicKey, name: pair.name, pairedAt: new Date(now()).toISOString(), revoked: false };
      delete state.pairs[input.pairId]; return { paired: true, deviceId: pair.deviceId };
    });
    if (operation === 'revoke') return storage.transaction(state => {
      const device = state.devices[input.deviceId]; if (!device) fail('Phone not found.'); device.revoked = true;
      for (const request of Object.values(state.requests)) if (request.deviceId === input.deviceId) request.consumed = true;
      for (const [id, pair] of Object.entries(state.pairs)) if (pair.deviceId === input.deviceId) delete state.pairs[id];
      return { revoked: true };
    });
    if (operation === 'challenge') {
      if (input.operation === 'windows.unlock') {
        const state = read(), device = state.devices[input.deviceId];
        if (!relay || !device || device.revoked || !facts.locked || state.accountSid !== facts.accountSid) fail('Phone Windows unlock is not enrolled yet.', 503);
        let value; try { value = await relay.challenge({ deviceId: input.deviceId, computerId: state.computerId, accountSid: facts.accountSid, sessionId: facts.sessionId }); } catch { fail('The Windows sign-in provider is not active or its challenge expired.', 503); }
        if (!authorized()) fail('Unlock the primary workspace again.', 401);
        storage.transaction(saved => { prune(saved); saved.nativeRequests ||= {}; if (saved.nativeRequests[value.requestId]?.consumed) fail('That Windows request has already been submitted. Refresh status.', 409); saved.nativeRequests[value.requestId] = { ...value, deviceId: input.deviceId, sessionId: facts.sessionId, consumed: false, bootId }; });
        return value;
      }
      if (input.operation !== 'windows.lock') fail('Unknown computer action.');
      storage.transaction(state => { prune(state); });
      return broker(read()).challenge(input);
    }
    const saved = read(), nativeRequest = saved.nativeRequests?.[input.requestId];
    if (nativeRequest) {
      const device = saved.devices[nativeRequest.deviceId];
      if (!relay || nativeRequest.consumed || nativeRequest.bootId !== bootId || nativeRequest.expiresAtMs <= now() || nativeRequest.sessionId !== facts.sessionId || !facts.locked || saved.accountSid !== facts.accountSid || !device || device.revoked || !signatureValid(nativeRequest.payload, input.signature, device.publicKey)) fail('Windows approval rejected.');
      storage.transaction(state => { state.nativeRequests[input.requestId].consumed = true; });
      try { return { requestId: input.requestId, ...await relay.submit({ ...nativeRequest, signature: input.signature }, { deviceId: nativeRequest.deviceId, computerId: saved.computerId, accountSid: facts.accountSid, sessionId: facts.sessionId }) }; }
      catch { fail('Unlock approval delivery could not be confirmed. Refresh status; this approval will not be resent.', 503); }
    }
    const result = broker(saved).consume(input); // Durable burn before any native side effect.
    if (result.operation !== 'windows.lock') fail('Windows unlock is unavailable.', 503);
    try {
      const outcome = await native.lock(result);
      if (outcome.initiated !== true) fail('Windows did not accept the lock request.', 503);
      const after = await context();
      return { requestId: result.requestId, initiated: true, locked: after.locked, message: after.locked ? 'Laptop locked.' : 'Windows accepted the request. Checking the lock state…' };
    } catch { fail('Lock outcome could not be confirmed. Refresh status before making a new request; this request will not be resent.', 503); }
  });
  // Public inventory only: listing devices must not mint Windows sign-in challenges.
  const pairedDevices = () => serial(() => Object.entries(read().devices).filter(([, device]) => !device.revoked).map(([id, device]) => ({ id, name: device.name, pairedAt: device.pairedAt })));
  const remoteIdentity=deviceId=>serial(()=>{const state=read(),device=state.devices[deviceId];return device&&!device.revoked&&state.accountSid?{computerId:state.computerId,publicKey:device.publicKey}:null;});
  const remoteReady=()=>serial(async()=>{const live=await context();return read().accountSid===live.accountSid&&!live.locked;});
  return { status, action, pairedDevices, remoteIdentity, remoteReady, close: async () => { await chain; db.close(); } };
}
