// Uninstalled candidate. No imports from bootstrap/config, environment loader,
// live evidence or activation loader. Explicit preparation is not installation.
import { join } from 'node:path';
import { createEvergreenMemberRegistry } from './evergreen-members.mjs';
import { createEvergreenClient } from './evergreen-client.mjs';
import { evergreenStorage } from './evergreen-storage.mjs';
import { evergreenHttpsTransport, EVERGREEN_BASE } from './evergreen-transport.mjs';
import { INITIAL_EVERGREEN_SCOPES } from './evergreen-production.mjs';
import { canonical, hash, validate, integrationError as fail } from './evergreen-contract.mjs';

export const REVIEWED_BRIDGE_BOUNDARY = 'household-reviewed-bridge-v1';
// REVIEWED-BRIDGE-CONTRACT.json, contractRevision 1, wire protocol 1.
export const reviewedBridgePublic = () => ({ schemaVersion: 3, contractRevision: 1,
  boundary: REVIEWED_BRIDGE_BOUNDARY, guarantee: 'reviewed-bridge-only',
  nativeSourceAccess: 'shared-root-readable-by-authorized-household-members',
  rolloutDomains: ['tasks', 'planner'], newOwnRecords: 'accepted-standalone-workflow',
  unreviewedSourceChanges: 'fresh-review-hold', maximumAttestationAgeMs: 86400000 });
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const held = () => { throw fail('release_held', 503); };
const publicKeys = Object.keys(reviewedBridgePublic());
const authKeys = [...publicKeys, 'bindingDigest', 'authorizationRevision', 'authorizationDigest'];

export function reviewedBridgeAuthorizationDigest(r) {
  const p = reviewedBridgePublic();
  return hash({ schemaVersion: p.schemaVersion, contractRevision: p.contractRevision, boundary: p.boundary,
    householdId: r.householdId, ownerUid: r.ownerUid, memberUids: r.members.map(m => m.memberUid),
    bindingDigest: r.bindingDigest, authorizationRevision: r.authorizationRevision,
    permissions: Object.fromEntries(r.members.map(m => [m.memberUid, [...m.scopes].sort()])),
    guarantee: p.guarantee, nativeSourceAccess: p.nativeSourceAccess, newOwnRecords: p.newOwnRecords });
}

// Release metadata belongs on the response envelope, not the nested v1 grant.
// GET connection is signed-in Evergreen Settings only; JARVIS uses /status.
export const REVIEWED_BRIDGE_WIRE = Object.freeze({ boundary: REVIEWED_BRIDGE_BOUNDARY, contractRevision: 1,
  publicMetadata: body => body?.release, authorizationMetadata: body => body?.release,
  legacyConnection: value => structuredClone(value), authorizationDigest: reviewedBridgeAuthorizationDigest });

export function validateReviewedBridgePublic(value) {
  if (!exact(value, publicKeys) || canonical(value) !== canonical(reviewedBridgePublic())) throw fail('protocol', 503);
  return structuredClone(value);
}
export function validateReviewedBridgeAuthorization(value, release) {
  if (!exact(value, authKeys)) throw fail('protocol', 503);
  validateReviewedBridgePublic(Object.fromEntries(publicKeys.map(k => [k, value[k]])));
  if (value.bindingDigest !== release.bindingDigest || value.authorizationRevision !== release.authorizationRevision
    || value.authorizationDigest !== release.authorizationDigest) throw fail('protocol', 503);
  return structuredClone(value);
}

export function validateReviewedBridgeRelease(value, now = Date.now()) {
  const keys = ['version', 'enabled', 'mode', 'origin', 'bindingSource', 'bridge', 'evidence',
    'rulesSha256', 'bridgeEvidenceSha256', 'deploymentId', 'verifiedAtMs', 'householdId', 'ownerUid', 'members',
    'bindingDigest', 'authorizationRevision', 'authorizationDigest'];
  const evidenceKeys = ['securityReleaseReviewed', 'sessionBindingsReviewed', 'tenancyAuthorityVerified',
    'bridgeOutputIsolationVerified', 'sourceReviewIntegrityVerified', 'confirmedWritesVerified',
    'receiptsRevocationVerified', 'nativeContinuityOrHoldVerified'];
  if (!exact(value, keys) || value.version !== 3 || value.enabled !== true || value.mode !== 'household'
    || value.origin !== EVERGREEN_BASE || value.bindingSource !== 'verified-evergreen-settings'
    || !exact(value.evidence, evidenceKeys) || evidenceKeys.some(k => value.evidence[k] !== true)
    || !digest(value.rulesSha256) || !digest(value.bridgeEvidenceSha256) || !digest(value.bindingDigest) || !digest(value.authorizationDigest)
    || !Number.isSafeInteger(value.authorizationRevision) || value.authorizationRevision < 1
    || typeof value.deploymentId !== 'string' || !value.deploymentId.trim() || value.deploymentId.length > 256
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(value.verifiedAtMs) || value.verifiedAtMs > now
    || now - value.verifiedAtMs >= 86400000 || !/^HH-[A-Za-z0-9_-]{1,100}$/.test(value.householdId || '')
    || !Array.isArray(value.members) || value.members.length !== 2) held();
  try { validateReviewedBridgePublic(value.bridge); validate('uid', value.ownerUid); } catch { held(); }
  const roster = value.members.map(m => {
    if (!exact(m, ['profileId', 'memberUid', 'sessionSubject', 'scopes'])
      || !/^[a-z][a-z0-9-]{0,39}$/.test(m.profileId || '') || typeof m.sessionSubject !== 'string'
      || !/^jarvis-workspace:[0-9a-f-]{36}:[a-z][a-z0-9-]{0,39}$/.test(m.sessionSubject)
      || !m.sessionSubject.endsWith(`:${m.profileId}`) || !Array.isArray(m.scopes) || !m.scopes.length
      || new Set(m.scopes).size !== m.scopes.length || m.scopes.some(s => !INITIAL_EVERGREEN_SCOPES.includes(s))
      || m.scopes.some(s => s.endsWith(':write') && !m.scopes.includes(s.replace(':write', ':read')))) held();
    try { validate('uid', m.memberUid); } catch { held(); }
    return { profileId: m.profileId, memberUid: m.memberUid, sessionSubject: m.sessionSubject,
      scopes: [...m.scopes].sort(), householdId: value.householdId };
  });
  for (const key of ['profileId', 'memberUid', 'sessionSubject']) if (new Set(roster.map(r => r[key])).size !== 2) held();
  if (roster[0].memberUid !== value.ownerUid) held();
  return roster;
}

export function prepareReviewedBridgeInstaller({ release, wire, storageFactory = evergreenStorage, fetcher, now = Date.now, assertInstallation = () => {} } = {}) {
  const evidence = structuredClone(release);
  const assertRelease = () => validateReviewedBridgeRelease(evidence, now());
  assertRelease();
  // No request-supplied decoder or alternative authorization canonicalization.
  if (wire !== REVIEWED_BRIDGE_WIRE) held();
  // Capture trusted decoder functions once; caller mutation cannot swap them
  // after validation or change checks on an already-open registry.
  const codec = Object.freeze(Object.fromEntries(['publicMetadata', 'authorizationMetadata', 'legacyConnection', 'authorizationDigest'].map(k => [k, wire[k]])));
  const assertDigest = () => {
    const calculated = codec.authorizationDigest(structuredClone(evidence));
    if (!digest(calculated) || calculated !== evidence.authorizationDigest) held();
  };
  assertDigest();
  return function registryFactory({ directory, authenticate }) {
    const roster = assertRelease(); assertDigest();
    if (typeof authenticate !== 'function') held();
    const send = evergreenHttpsTransport(fetcher);
    const pin = { boundary: REVIEWED_BRIDGE_BOUNDARY, contractRevision: 1, bindingDigest: evidence.bindingDigest,
      authorizationRevision: evidence.authorizationRevision, authorizationDigest: evidence.authorizationDigest };
    const protectedStorage = path => {
      const inner = storageFactory(path);
      return {
        async read() {
          const saved = await inner.read(); if (saved == null) return null;
          if (!exact(saved, ['version', 'pin', 'value']) || saved.version !== 3 || canonical(saved.pin) !== canonical(pin)) throw fail('protocol', 503);
          return saved.value;
        },
        write: value => inner.write({ version: 3, pin, value }), close: () => inner.close(),
      };
    };
    return createEvergreenMemberRegistry({ directory: join(directory, 'production-reviewed-bridge-v3'),
      environment: 'production', now, bindings: roster, storageFactory: protectedStorage,
      authenticate: async ticket => {
        assertInstallation(); assertRelease(); assertDigest(); const identity = await authenticate(ticket);
        const row = roster.find(r => r.profileId === identity?.profileId);
        if (!row || row.sessionSubject !== identity.subject || typeof identity.sessionId !== 'string' || !identity.sessionId) throw fail('denied', 403);
        return { profileId: row.profileId, sessionId: identity.sessionId };
      },
      clientFactory: ({ directory, storage, binding, getPrivacy }) => {
        const client = createEvergreenClient({ directory, storage, profileId: binding.profileId,
          expectedBinding: binding, productionMember: true, environment: 'production', allowedScopes: binding.scopes, now,
          transport: async request => {
            assertInstallation(); assertRelease(); assertDigest();
            if (!['/status', '/capabilities', '/rotate', '/commit'].includes(request.path) && !request.path.startsWith('/receipt?') && !getPrivacy().processWithAI) throw fail('privacy_required', 403);
            const checkPublic = response => {
              if (response.status >= 200 && response.status < 300) validateReviewedBridgePublic(codec.publicMetadata(response.body));
              return response;
            };
            // Check public protocol before ever transmitting the pending proof.
            if (request.path === '/pair' || request.path === '/exchange') {
              const advertised = checkPublic(await send({ path: '/capabilities', method: 'GET' }));
              if (advertised.status < 200 || advertised.status >= 300) return advertised;
              assertInstallation(); assertRelease();
            }
            const response = await send(request);
            assertInstallation(); assertRelease(); // Expiry/removal while in flight cannot release a late result.
            if (!(response.status >= 200 && response.status < 300)) return response;
            if (request.path === '/capabilities' || request.path === '/pair') return checkPublic(response);
            if (request.path === '/exchange' || request.path === '/status') {
              validateReviewedBridgeAuthorization(codec.authorizationMetadata(response.body), evidence);
              const connection = codec.legacyConnection(response.body.connection);
              validate('connection', connection);
              if (connection.memberUid !== binding.memberUid || connection.householdId !== binding.householdId
                || connection.scopes.some(s => !binding.scopes.includes(s))) throw fail('protocol', 503);
              return { ...response, body: { ...response.body, connection } };
            }
            return response;
          },
        });
        const status = client.status;
        client.status = async () => ({ ...await status(), bridge: structuredClone(evidence.bridge) });
        return client;
      },
    });
  };
}
