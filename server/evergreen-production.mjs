// Prepared for a separate coordinated release. NOT imported by the app config.
// Tests inject an in-memory fetcher; no live activation file is created here.
import { join } from 'node:path';
import { createEvergreenClient } from './evergreen-client.mjs';
import { evergreenHttpsTransport, EVERGREEN_BASE } from './evergreen-transport.mjs';
import { integrationError, validate } from './evergreen-contract.mjs';
export const INITIAL_EVERGREEN_SCOPES = ['tasks:read', 'tasks:write', 'planner:read', 'planner:write'];
export function validateEvergreenRelease(release, now = Date.now()) {
  const keys = ['enabled', 'mode', 'origin', 'bindingSource', 'securityReleaseReviewed', 'rulesSha256', 'deploymentId', 'verifiedAtMs', 'memberUid', 'householdId'];
  if (release && Object.keys(release).some(k => !keys.includes(k))) throw integrationError('release_held', 503);
  if (!release || release.enabled !== true || release.mode !== 'personal' || release.origin !== EVERGREEN_BASE || release.bindingSource !== 'verified-evergreen-settings' || release.securityReleaseReviewed !== true || !/^[a-f0-9]{64}$/.test(release.rulesSha256 || '') || typeof release.deploymentId !== 'string' || !release.deploymentId.trim() || !Number.isSafeInteger(release.verifiedAtMs) || release.verifiedAtMs > now || now - release.verifiedAtMs >= 86400000) throw integrationError('release_held', 503);
  validate('uid', release.memberUid);
  if (!/^HH-[A-Za-z0-9_-]{1,100}$/.test(release.householdId || '')) throw integrationError('release_held', 503);
  return { memberUid: release.memberUid, householdId: release.householdId };
}
export function preparedEvergreenProduction({ directory, profileId = 'owner', release = null, privacy, fetcher, storage, now = Date.now } = {}) {
  // A supplied local release manifest records operator evidence; it is not a
  // substitute for deployed-rule readback. Remote status rechecks its own gate.
  const evidence = release ? structuredClone(release) : null;
  const send = evergreenHttpsTransport(fetcher);
  const assertRelease = () => validateEvergreenRelease(evidence, now());
  const transport = async request => {
    assertRelease();
    if (!['/status', '/capabilities', '/rotate', '/commit'].includes(request.path) && !request.path.startsWith('/receipt?') && privacy?.get().processWithAI !== true) throw integrationError('privacy_required', 403);
    return send(request);
  };
  let binding; try { binding = assertRelease(); } catch { /* Prepared, still held. */ }
  const client = createEvergreenClient({ directory: join(directory, 'production-evergreen'), profileId, ...(storage ? { storage } : {}), now,
    environment: 'production', expectedBinding: binding, allowedScopes: INITIAL_EVERGREEN_SCOPES,
    ...(binding ? { transport } : {}) });
  const status = client.status;
  client.status = async () => { const value = await status(); if (profileId !== 'owner') return value; try { assertRelease(); } catch { return { ...value, state: 'release-held', problem: 'release_held', liveEnabled: false, environment: 'production' }; } return value; };
  return client;
}
