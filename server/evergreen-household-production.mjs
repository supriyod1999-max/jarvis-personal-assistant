// Normal config invokes this with a null release, before transport construction.
// Importing this file does not load a manifest or make a request. Live transport
// installation still requires separately reviewed server composition.
import { join } from 'node:path';
import { createEvergreenMemberRegistry } from './evergreen-members.mjs';
import { createEvergreenClient } from './evergreen-client.mjs';
import { evergreenHttpsTransport, EVERGREEN_BASE } from './evergreen-transport.mjs';
import { INITIAL_EVERGREEN_SCOPES } from './evergreen-production.mjs';
import { validate, integrationError as fail } from './evergreen-contract.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));
export function validateEvergreenHouseholdRelease(value, now = Date.now()) {
  const keys = ['version', 'enabled', 'mode', 'origin', 'bindingSource', 'securityReleaseReviewed', 'sourceIsolationVerified', 'sessionBindingsReviewed', 'releaseBoundary', 'memberIsolationTestsPassed', 'nativeContinuityTestsPassed', 'rulesSha256', 'deploymentId', 'verifiedAtMs', 'householdId', 'members'];
  if (value?.releaseBoundary !== 'household-member-reviewed-v1' || value.memberIsolationTestsPassed !== true || value.nativeContinuityTestsPassed !== true) throw fail('release_held', 503);
  if (!exact(value, keys) || value.version !== 2 || value.enabled !== true || value.mode !== 'household' || value.origin !== EVERGREEN_BASE || value.bindingSource !== 'verified-evergreen-settings' || value.securityReleaseReviewed !== true || value.sourceIsolationVerified !== true || value.sessionBindingsReviewed !== true || !/^[a-f0-9]{64}$/.test(value.rulesSha256) || typeof value.deploymentId !== 'string' || !value.deploymentId.trim() || !Number.isSafeInteger(value.verifiedAtMs) || value.verifiedAtMs > now || now - value.verifiedAtMs >= 86400000 || !/^HH-[A-Za-z0-9_-]{1,100}$/.test(value.householdId) || value.members?.length !== 2) throw fail('release_held', 503);
  if (!Array.isArray(value.members)) throw fail('release_held', 503);
  const roster = value.members.map(m => {
    if (!exact(m, ['profileId', 'memberUid', 'sessionSubject']) || !/^[A-Za-z0-9_-]{1,128}$/.test(m.profileId) || typeof m.sessionSubject !== 'string' || m.sessionSubject.length < 3 || m.sessionSubject.length > 512 || /[\r\n]/.test(m.sessionSubject)) throw fail('release_held', 503);
    try { validate('uid', m.memberUid); } catch { throw fail('release_held', 503); }
    return { ...m, householdId: value.householdId };
  });
  for (const key of ['memberUid', 'profileId', 'sessionSubject']) if (new Set(roster.map(m => m[key])).size !== 2) throw fail('release_held', 503);
  return roster;
}

export function preparedEvergreenHouseholdRegistry({ directory, release, authenticate, storageFactory, fetcher, now = Date.now }) {
  // These claims must come from a separately reviewed deployment/readback. This
  // validator checks their shape/freshness; it cannot certify their truth.
  const evidence = structuredClone(release);
  const assertRelease = () => validateEvergreenHouseholdRelease(evidence, now());
  const roster = assertRelease();
  if (typeof authenticate !== 'function') throw fail('release_held', 503);
  const send = evergreenHttpsTransport(fetcher);
  return createEvergreenMemberRegistry({ directory: join(directory, 'production-household-evergreen-v2'), environment: 'production', bindings: roster, storageFactory, now,
    authenticate: async ticket => {
      assertRelease();
      const identity = await authenticate(ticket);
      const member = roster.find(m => m.profileId === identity?.profileId);
      // A profile label or a caller-supplied household/UID is never a principal.
      if (!member || identity.subject !== member.sessionSubject || typeof identity.sessionId !== 'string' || !identity.sessionId) throw fail('denied', 403);
      return { profileId: member.profileId, sessionId: identity.sessionId };
    },
    clientFactory: ({ directory, storage, binding, getPrivacy }) => createEvergreenClient({ directory, storage, profileId: binding.profileId,
      expectedBinding: binding, productionMember: true, environment: 'production', allowedScopes: INITIAL_EVERGREEN_SCOPES, now,
      transport: async request => {
        assertRelease();
        // Turning processing off must not prevent checking/recovering the exact
        // already-confirmed receipt. It must stop fresh reads and preparations.
        if (!['/status', '/capabilities', '/rotate', '/commit'].includes(request.path) && !request.path.startsWith('/receipt?') && !getPrivacy().processWithAI) throw fail('privacy_required', 403);
        return send(request);
      },
    }),
  });
}
