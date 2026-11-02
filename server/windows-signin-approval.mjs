// Development core only. No HTTP route, credential access, Windows logon or
// enrollment is installed here. The native secure-desktop broker owns authority.
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const sid = value => typeof value === 'string' && /^S-1-5-(?:\d+-){1,14}\d+$/.test(value) && value.length < 180;
const fail = () => { throw new Error('Windows approval rejected.'); };
export function phoneKeyIdentity(der) {
  const key = createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048) fail();
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}
export function windowsApprovalPayload(value) {
  if (!['windows.unlock', 'windows.lock'].includes(value.operation) || !/^[a-f0-9]{64}$/.test(value.deviceId)
    || !uuid(value.computerId) || !sid(value.accountSid) || !uuid(value.bootId) || !uuid(value.requestId)
    || !Number.isSafeInteger(value.sessionId) || value.sessionId < 1 || value.sessionId > 2147483647
    || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs < 1) fail();
  return ['JARVIS_WINDOWS_SIGNIN_V1', value.operation, value.deviceId, value.computerId, value.accountSid,
    value.sessionId, value.bootId, value.requestId, value.nonce, value.expiresAtMs].join('\n');
}

// storage.transaction(fn) MUST atomically persist a changed snapshot before returning.
// Integration must supply SYSTEM-owned encrypted storage and native session facts.
// Public keys enter via reviewed local enrollment, never via these operations.
export function createWindowsApprovalBroker({ storage, computerId, accountSid, bootId, session, now = Date.now }) {
  if (!storage?.transaction || !uuid(computerId) || !sid(accountSid) || !uuid(bootId) || typeof session !== 'function') fail();
  function context() {
    const value = session();
    if (!value || !Number.isSafeInteger(value.id) || value.id < 1 || value.accountSid !== accountSid || value.remote === true) fail();
    return value;
  }
  function challenge({ deviceId, operation }) {
    const target = context();
    if (operation === 'windows.unlock' && target.locked !== true) fail();
    if (operation === 'windows.lock' && target.locked !== false) fail();
    return storage.transaction(state => {
      const device = state.devices?.[deviceId];
      if (!device || device.revoked || phoneKeyIdentity(device.publicKey) !== deviceId) fail();
      state.requests ||= {};
      // Only one live request per device; abandoned requests cannot be approved later.
      for (const [id, old] of Object.entries(state.requests)) if (old.deviceId === deviceId && !old.consumed) delete state.requests[id];
      const value = { operation, deviceId, computerId, accountSid, sessionId: target.id, bootId,
        requestId: randomUUID(), nonce: randomBytes(32).toString('base64url'), expiresAtMs: now() + 30000 };
      const payload = windowsApprovalPayload(value);
      state.requests[value.requestId] = { ...value, consumed: false };
      return { requestId: value.requestId, payload, expiresAtMs: value.expiresAtMs };
    });
  }
  function consume({ requestId, signature }) {
    if (!uuid(requestId) || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{342}==$/.test(signature)) fail();
    const target = context();
    return storage.transaction(state => {
      const request = state.requests?.[requestId], device = request && state.devices?.[request.deviceId];
      if (!request || request.consumed || !device || device.revoked || request.computerId !== computerId
        || request.accountSid !== accountSid || request.bootId !== bootId || request.sessionId !== target.id
        || now() >= request.expiresAtMs || request.expiresAtMs - now() > 30000
        || (request.operation === 'windows.unlock' ? target.locked !== true : target.locked !== false)) fail();
      const publicKey = createPublicKey({ key: Buffer.from(device.publicKey, 'base64'), format: 'der', type: 'spki' });
      if (phoneKeyIdentity(device.publicKey) !== request.deviceId || !verify('sha256', Buffer.from(windowsApprovalPayload(request)), publicKey, Buffer.from(signature, 'base64'))) fail();
      // Burn approval durably BEFORE handing it to the native caller. A crash can
      // require a new phone approval, but never replays a Windows sign-in.
      request.consumed = true;
      return { operation: request.operation, accountSid, sessionId: target.id, requestId };
    });
  }
  return { challenge, consume };
}
