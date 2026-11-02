import { randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { evergreenReview } from './evergreen-review.mjs';
import { evergreenStorage } from './evergreen-storage.mjs';
import { ACTIONS, CAPABILITIES, DOMAINS, actionDomain, canonical, hash, validate, integrationError as fail } from './evergreen-contract.mjs';

const empty = () => ({ version: 1, state: 'disconnected', pairing: null, connection: null, secret: null, cache: {}, cursor: null, gaps: [], requests: {}, reviews: {}, retryAt: 0 });
const bound = c => ({ grantId: c.id, householdId: c.householdId, memberUid: c.memberUid });
const exact = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw fail('invalid'); };
const confirmedSpeech = /^(?:please )?confirm (?:this |the )?evergreen (?:change|review)[.!]?$/i;

export function createEvergreenClient({ directory, profileId = 'owner', transport, storage = evergreenStorage(directory), now = Date.now, environment = 'synthetic', expectedBinding = null, allowedScopes = null, syntheticMember = false, productionMember = false, moduleAccess = null } = {}) {
  // Development-only member clients cannot opt into a production transport.
  if (syntheticMember && (environment !== 'synthetic' || !expectedBinding?.memberUid?.startsWith('synthetic-') || !expectedBinding?.householdId?.startsWith('HH-SYNTHETIC-'))) throw fail('release_held', 503);
  // Only the separately prepared server registry supplies this option. It is
  // never read from a request, workspace name, environment variable or UI field.
  if (productionMember && (syntheticMember || environment !== 'production' || expectedBinding?.profileId !== profileId || !expectedBinding?.memberUid || !expectedBinding?.householdId || !allowedScopes?.length)) throw fail('release_held', 503);
  const member = syntheticMember || productionMember;
  // Trusted schema-4 factory only; never inferred from mode or model/request data.
  const moduleUids = moduleAccess ? structuredClone(moduleAccess.memberUids) : null;
  if (moduleAccess && (!productionMember || moduleAccess.boundary !== 'household-module-access-v1' || !Array.isArray(moduleUids)
    || moduleUids.length !== 2 || new Set(moduleUids).size !== 2 || !moduleUids.includes(expectedBinding.memberUid))) throw fail('release_held', 503);
  const connectionMode = member ? 'household' : 'personal';
  const permittedProfile = profileId === 'owner' || member;
  // No environment/browser flag can enable production. Only synthetic tests inject
  // a transport until a separately reviewed release installs the HTTPS adapter.
  let data, tail = Promise.resolve(), closed = false;
  const operationContext = new AsyncLocalStorage();
  const checkContext = async () => { await operationContext.getStore()?.(); };
  const available = () => { if (!permittedProfile) throw fail('owner_only', 403); if (!transport) throw fail('release_held', 503); };
  const load = async () => {
    if (data) return;
    const restored = await storage.read() || empty();
    if (restored.connection && expectedBinding && (restored.connection.memberUid !== expectedBinding.memberUid || restored.connection.householdId !== expectedBinding.householdId || restored.connection.mode !== connectionMode)) throw fail('protocol');
    // Reviewing is session-local authority. Keep proposals and confirmed recovery
    // payloads, but never restore permission to approve an unheard old review.
    restored.reviews = {};
    for (const request of Object.values(restored.requests)) {
      delete request.reviewTurnId;
      if (request.state === 'reviewed') request.state = 'prepared';
      if (['prepared', 'preparing'].includes(request.state) && request.proposal) request.reviewText = evergreenReview(request.proposal);
    }
    await save(restored);
  };
  const save = async next => { await storage.write(next); data = next; };
  const queue = fn => { const p = tail.then(async () => { if (closed) throw fail('disconnected'); await checkContext(); available(); await load(); try { await checkContext(); return await fn(); } catch (e) { if (e.code === 'protocol' && data.connection) await purge('denied'); throw e; } }); tail = p.catch(() => {}); return p; };
  async function purge(reason = 'disconnected', problem = null) {
    // Household recovery keeps identifiers only, never revoked text or
    // credentials. No replay path reads this ledger; operator recovery is needed.
    const recoveryRequired = member ? [...(data.recoveryRequired || []), ...Object.values(data.requests).filter(r => ['committing', 'uncertain'].includes(r.state) && r.commit && data.connection).map(r => ({ ...bound(data.connection), requestId: r.requestId, proposalId: r.commit.proposalId, digest: r.commit.digest, confirmationId: r.commit.confirmationId }))] : [];
    await save({ ...empty(), state: reason, problem, ...(member ? { recoveryRequired } : {}) });
  }
  async function call(path, body, auth = true, secret = data.secret) {
    await checkContext();
    if (data.retryAt > now()) throw fail('rate_limited', 429);
    if (auth && (!data.connection || !secret)) throw fail('disconnected');
    let response;
    try { response = await transport({ path, method: body === undefined ? 'GET' : 'POST', body, ...(auth ? { credential: { id: data.connection.id, secret } } : {}) }); }
    catch (e) { const code = ['protocol', 'privacy_required', 'release_held'].includes(e.code) ? e.code : 'uncertain'; await save({ ...data, state: 'suspended', problem: code }); throw fail(code, e.status || 503); }
    const status = response?.status;
    const remoteCode = response?.body?.error?.code;
    if (status === 401 || status === 403 || response?.body?.purgeCache === true) {
      const code = ['permissions_changed', 'private_record_denied'].includes(remoteCode) ? remoteCode : 'denied';
      await purge('denied', code); throw fail(code, status || 403);
    }
    if (!(status >= 200 && status < 300)) {
      if ((remoteCode === 'privacy_review_required' && [409, 503].includes(status)) || (['native_privacy_release_required', 'private_rollout_scopes'].includes(remoteCode) && status === 503)) {
        const next = structuredClone(data); next.state = 'suspended'; next.problem = remoteCode; next.reviews = {};
        for (const r of Object.values(next.requests)) if (r.state === 'reviewed') { r.state = 'prepared'; delete r.reviewTurnId; }
        await save(next); throw fail(remoteCode, status);
      }
      const held = ['integration_disabled', 'security_release_required', 'pilot_requires_review', 'permissions_require_review', 'security_hold'].includes(response?.body?.error?.code);
      const code = status === 409 ? 'conflict' : status === 410 ? 'expired' : status === 422 ? 'unsupported' : status === 429 ? 'rate_limited' : status === 507 ? 'capacity' : status >= 500 ? held ? 'security_hold' : 'connection_error' : 'invalid';
      await save({ ...data, state: status >= 500 || status === 429 ? 'suspended' : data.state, problem: code, retryAt: status === 429 ? now() + 60000 : data.retryAt });
      throw Object.assign(fail(code, status || 503), { remoteCode: /^[a-z_]{1,80}$/.test(response?.body?.error?.code || '') ? response.body.error.code : '' });
    }
    return response.body;
  }
  function connection(value) {
    validate('connection', value);
    if (expectedBinding && (value.memberUid !== expectedBinding.memberUid || value.householdId !== expectedBinding.householdId)) throw fail('protocol');
    if (allowedScopes && value.scopes.some(s => !allowedScopes.includes(s))) throw fail('protocol');
    if (value.mode !== connectionMode || !value.enabled || !value.exchangeComplete || value.scopes.some(s => s.endsWith(':write') && !value.scopes.includes(s.replace(':write', ':read')))) throw fail('protocol');
    if (data.connection && (canonical(bound(value)) !== canonical(bound(data.connection)) || canonical([...value.scopes].sort()) !== canonical([...data.connection.scopes].sort()))) throw fail('protocol');
  }
  async function health() {
    if (data.rotation) throw fail('busy', 409);
    const response = await call('/status');
    try {
      connection(response.connection);
      if (response.healthy !== true || response.version !== 1 || !(Date.parse(response.securityVerificationExpiresAt) > now())) throw fail('protocol');
    } catch { await purge('denied'); throw fail('protocol', 503); }
    let rollout = data.rollout || {}, moduleCapabilities = data.moduleCapabilities;
    if (environment === 'production') {
      const inventory = await call('/capabilities');
      if (inventory?.version !== 1 || !Array.isArray(inventory.capabilities) || inventory.capabilities.length !== DOMAINS.length || inventory.capabilities.some(r => !r || typeof r !== 'object') || new Set(inventory.capabilities.map(r => r.domain)).size !== DOMAINS.length) throw fail('protocol');
      rollout = {};
      for (const row of inventory.capabilities) {
        if (!DOMAINS.includes(row.domain) || typeof row.rolloutEnabled !== 'boolean' || (row.rolloutRestriction !== undefined && (typeof row.rolloutRestriction !== 'string' || row.rolloutRestriction.length > 1000))) throw fail('protocol');
        rollout[row.domain] = row.rolloutEnabled;
        if (moduleUids && (!Array.isArray(row.operations) || row.operations.some(a => !ACTIONS.includes(a) || actionDomain(a) !== row.domain)
          || !Array.isArray(row.gaps) || row.gaps.length > 30 || row.gaps.some(g => typeof g !== 'string' || g.length > 1000)
          || row.rolloutEnabled !== (row.domain !== 'photos'))) throw fail('protocol');
      }
      if (moduleUids) moduleCapabilities = inventory.capabilities.map(({ domain, operations, read, gaps }) => ({ domain, operations, read: read === true, gap: gaps.join(' ') }));
    }
    await save({ ...data, rollout, ...(moduleUids ? { moduleCapabilities } : {}), state: 'connected', problem: null, connection: response.connection, securityUntil: response.securityVerificationExpiresAt });
    return response.connection;
  }
  function scope(domain, write = false) {
    if (!DOMAINS.includes(domain)) throw fail('unsupported', 422);
    if (!data.connection?.scopes.includes(`${domain}:read`) || (write && !data.connection.scopes.includes(`${domain}:write`))) throw fail('scope', 403);
    if (data.rollout?.[domain] === false) throw fail('private_rollout_scopes', 503);
    if (domain === 'photos' || (write && domain === 'repayments' && !moduleUids)) throw fail('unsupported', 422);
  }
  function binding(value) { if (canonical(value) !== canonical(bound(data.connection))) throw fail('protocol'); }
  const cacheKey = recordId => hash([data.connection.memberUid, data.connection.householdId, data.connection.id, recordId]);
  function record(row) {
    scope(row.domain);
    if (!row.id.startsWith(`${row.domain}:`) || (!row.deleted && (row.visibility === 'member' && row.ownerUid !== data.connection.memberUid))) throw fail('protocol');
    if (moduleUids && !row.deleted && ['tasks', 'planner', 'study', 'income', 'career'].includes(row.domain)
      && (row.visibility !== 'member' || row.ownerUid !== data.connection.memberUid)) throw fail('protocol');
    if (!row.deleted && (!row.deepLink.startsWith('/') || row.deepLink.startsWith('//') || /[\\\r\n]/.test(row.deepLink))) throw fail('protocol');
  }
  function actionCheck(action) {
    if (Buffer.byteLength(JSON.stringify(action), 'utf8') > 90000) throw fail('invalid');
    validate('action', action); scope(actionDomain(action.type), true);
    if (moduleUids && !data.moduleCapabilities?.find(c => c.domain === actionDomain(action.type))?.operations.includes(action.type)) throw fail('unsupported', 422);
    exact(action.input, Object.keys(action.input));
    if (Object.keys(action.input).some(k => ['householdId', 'memberUid', 'ownerUid', 'uid', 'actor', 'mode', 'path', 'databasePath', 'createdBy'].includes(k))) throw fail('invalid');
    if (action.recordId) {
      const current = data.cache[cacheKey(action.recordId)]?.record;
      if (!current || current.deleted || current.revision !== action.expectedRevision || current.domain !== actionDomain(action.type)) throw fail('conflict', 409);
    } else if (action.expectedRevision || /\.(update|complete|delete|rename|remove|check|archive|archiveOpportunity|archiveResume|interest|remove-stop|save-stop|schedule)$/.test(action.type)) throw fail('invalid');
    if (moduleUids && action.type === 'purchase.create') {
      if (!moduleUids.includes(action.input.paidByUid) || !Array.isArray(action.input.items)
        || action.input.items.some(i => !Array.isArray(i.shares) || !i.shares.length || i.shares.some(s => !moduleUids.includes(s.uid)))) throw fail('invalid');
    } else if (action.type === 'purchase.create') {
      if (!Array.isArray(action.input.items) || action.input.items.some(i => i.split !== 'personal' || !Array.isArray(i.shares) || i.shares.length !== 1 || i.shares[0].uid !== data.connection.memberUid)) throw fail('unsupported', 422);
    }
    if (moduleUids && action.type === 'repayment.record' && (!moduleUids.includes(action.input.fromUid)
      || !moduleUids.includes(action.input.toUid) || action.input.fromUid === action.input.toUid)) throw fail('invalid');
  }
  const publicRequest = r => ({ requestId: r.requestId, state: r.state, proposal: r.proposal || null, receipt: r.receipt || null, reviewText: r.reviewText || '', conversationId: r.conversationId, reviewTurnId: r.reviewTurnId || null });
  function reviewText(p) {
    // Deterministic complete review, never an LLM paraphrase that can hide effects.
    // No IDs are treated as people names; participant UIDs stay explicit in finance.
    return evergreenReview(p);
  }
  function currentRequest(id) { const r = data.requests[id]; if (!r) throw fail('confirmation'); return r; }
  async function acceptReceipt(r, receipt) {
    validate('receipt', receipt);
    if (receipt.id !== r.proposal.proposalId || receipt.requestId !== r.requestId || receipt.proposalDigest !== r.proposal.digest || receipt.confirmationId !== r.commit.confirmationId || receipt.memberUid !== data.connection.memberUid || receipt.householdId !== data.connection.householdId) throw fail('protocol');
    const next = structuredClone(data); next.requests[r.requestId] = { ...r, state: 'committed', receipt }; delete next.reviews[r.conversationId]; await save(next);
    return publicRequest(next.requests[r.requestId]);
  }
  async function sendCommit(r) {
    try { scope(actionDomain(r.action.type), true); const result = validate('commitResponse', await call('/commit', r.commit)); return await acceptReceipt(r, result.receipt); }
    catch (e) {
      if (data.requests[r.requestId]) {
        const next = structuredClone(data); next.requests[r.requestId].state = ['conflict', 'expired', 'invalid', 'unsupported'].includes(e.code) ? 'invalid' : 'uncertain'; delete next.reviews[r.conversationId]; await save(next);
      }
      throw e;
    }
  }
  async function receiveProposal(input) {
    const result = validate('prepareResponse', await call('/prepare', { requestId: input.requestId, action: input.action }));
    const p = result.proposal;
    if (p.requestId !== input.requestId || p.memberUid !== data.connection.memberUid || p.householdId !== data.connection.householdId || p.summary.type !== input.action.type || p.summary.memberUid !== p.memberUid || p.summary.householdId !== p.householdId) throw fail('protocol');
    if (!(Date.parse(p.expiresAt) > now())) throw fail('expired', 410);
    if (!Array.isArray(p.summary.changes) || p.summary.changes.some(c => !DOMAINS.includes(c.domain) || !data.connection.scopes.includes(`${c.domain}:read`))) throw fail('protocol');
    const next = structuredClone(data); next.requests[input.requestId] = { ...next.requests[input.requestId], state: 'prepared', proposal: p, reviewText: reviewText(p) }; await save(next);
    return publicRequest(next.requests[input.requestId]);
  }
  const capabilities = () => (moduleUids ? data?.moduleCapabilities || CAPABILITIES.map(c => ({ ...c, operations: [], gap: 'Connect and verify current module capabilities.' })) : CAPABILITIES).map(c => ({ ...c, rolloutEnabled: environment === 'production' ? data?.rollout?.[c.domain] === true && !!allowedScopes?.includes(`${c.domain}:read`) : undefined }));
  const api = {
    status: async () => {
      if (!permittedProfile || !transport) return { state: permittedProfile ? 'release-held' : 'owner-only', liveEnabled: false, mode: connectionMode, capabilities: CAPABILITIES, pairing: null, connection: null, records: 0, requests: [] };
      return queue(async () => ({ state: data.state, problem: data.problem || null, environment, liveEnabled: environment === 'production' && data.state === 'connected' && Date.parse(data.securityUntil) > now(), mode: connectionMode, ...(moduleUids ? { moduleAccess: { boundary: moduleAccess.boundary, memberUids: [...moduleUids] } } : {}), synthetic: environment === 'synthetic', verifiedUntil: data.securityUntil || null, initialScopes: allowedScopes, pairing: data.pairing ? { pairingId: data.pairing.pairingId || null, expiresAt: data.pairing.expiresAt || null } : null, connection: data.connection, records: Object.keys(data.cache).length, cursor: data.cursor, gaps: data.gaps, recoveryRequired: data.recoveryRequired || [], requests: Object.values(data.requests).map(r => ({ requestId: r.requestId, state: r.state, conversationId: r.conversationId })), capabilities: capabilities() }));
    },
    pair: () => queue(async () => {
      if (data.recoveryRequired?.length) throw fail('busy', 409);
      if (data.connection) throw fail('busy', 409);
      if (!data.pairing) await save({ ...data, state: 'pairing', pairing: { secret: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url') } });
      if (data.pairing.pairingId) return { pairingId: data.pairing.pairingId, expiresAt: data.pairing.expiresAt };
      const result = await call('/pair', { credentialHash: hash(data.pairing.secret), codeChallenge: Buffer.from(hash(data.pairing.verifier), 'hex').toString('base64url') }, false);
      validate('exchangeRequest', { pairingId: result.pairingId, secret: data.pairing.secret, verifier: data.pairing.verifier });
      if (!(Date.parse(result.expiresAt) > now())) throw fail('expired', 410);
      await save({ ...data, pairing: { ...data.pairing, pairingId: result.pairingId, expiresAt: result.expiresAt } });
      return { pairingId: result.pairingId, expiresAt: result.expiresAt };
    }),
    exchange: () => queue(async () => {
      if (!data.pairing?.pairingId) throw fail('disconnected');
      const { pairingId, secret, verifier } = data.pairing;
      const result = await call('/exchange', { pairingId, secret, verifier }, false);
      connection(result.connection);
      if (result.connection.id !== pairingId) throw fail('protocol');
      await save({ ...data, connection: result.connection, secret, state: 'connected', pairing: null });
      return health();
    }),
    check: () => queue(health),
    sync: () => queue(async () => {
      await health(); let pages = 0;
      do {
        const response = validate('changesResponse', await call('/changes', { ...(data.cursor ? { cursor: data.cursor } : {}), limit: 100 }));
        binding(response.binding);
        const deliveredBefore = data.cursor?.sequence || 0;
        let sequence = 0;
        if (response.cursor.grantId !== data.connection.id) throw fail('protocol');
        const next = structuredClone(data);
        for (const row of response.changes) {
          record(row);
          if (row.sequence <= sequence || row.sequence > response.cursor.sequence) throw fail('protocol');
          sequence = row.sequence;
          if (sequence <= deliveredBefore) continue;
          // Retain only tombstone revision/sequence; erased contents cannot resurrect.
          next.cache[cacheKey(row.id)] = row.deleted ? { sequence, deleted: true, revision: row.revision } : { sequence, record: row };
        }
        if (response.changes.length && response.cursor.sequence !== sequence || response.observedThrough < response.cursor.sequence || (!response.hasMore && response.observedThrough !== response.cursor.sequence)) throw fail('protocol');
        if (response.cursor.sequence < deliveredBefore) return { cursor: data.cursor, caughtUp: false, gaps: data.gaps, pages: pages + 1, duplicatePage: true };
        if (!response.changes.length && response.cursor.sequence !== deliveredBefore) throw fail('protocol');
        next.cursor = response.cursor; next.gaps = response.gaps; next.caughtUp = !response.hasMore;
        if (Object.keys(next.cache).length > 5000) throw fail('capacity', 507);
        await save(next); pages++;
        if (!response.hasMore) break;
      } while (pages < 10);
      return { cursor: data.cursor, caughtUp: data.caughtUp, gaps: data.gaps, pages };
    }),
    search: input => queue(async () => {
      exact(input, ['domain', 'query']); await health(); scope(input.domain);
      if (typeof (input.query || '') !== 'string' || (input.query || '').length > 160) throw fail('invalid');
      const rows = []; let next = null, snapshot, restarted = false;
      for (let page = 0; page < 50; page++) {
        const query = new URLSearchParams({ domain: input.domain, query: input.query || '', limit: '100', ...(next ? { after: next, snapshotRevision: snapshot } : {}) });
        let result;
        try { result = validate('recordsResponse', await call('/records?' + query)); }
        catch (e) {
          if (e.remoteCode === 'snapshot_changed' && !restarted) { rows.length = 0; next = null; snapshot = undefined; restarted = true; page = -1; continue; }
          throw e;
        }
        binding(result.binding);
        if (snapshot && snapshot !== result.snapshotRevision) throw fail('conflict', 409);
        snapshot = result.snapshotRevision;
        for (const row of result.records) { record(row); if (row.domain !== input.domain || rows.some(r => r.id === row.id)) throw fail('protocol'); rows.push(row); }
        if (result.next && (result.next === next || !result.records.length)) throw fail('protocol');
        next = result.next;
        if (!next) return { records: rows, snapshotRevision: snapshot, gaps: result.gaps, source: 'evergreen', contentTrust: 'untrusted-data' };
      }
      throw fail('capacity', 507);
    }),
    cached: input => queue(async () => { exact(input, ['domain']); await health(); scope(input.domain); return Object.values(data.cache).filter(r => r.record?.domain === input.domain).map(r => r.record); }),
    quote: input => queue(async () => { validate('quoteRequest', input); await health(); scope(moduleUids && !data.connection.scopes.includes('expenses:write') ? 'repayments' : 'expenses', true); return call('/quote', input); }),
    prepare: input => queue(async () => {
      exact(input, ['requestId', 'conversationId', 'turnId', 'action']); await health();
      validate('prepareRequest', { requestId: input.requestId, action: input.action });
      if (typeof input.conversationId !== 'string' || input.conversationId.length > 128 || typeof input.turnId !== 'string' || input.turnId.length > 128) throw fail('invalid');
      actionCheck(input.action);
      const old = data.requests[input.requestId];
      if (old && (canonical(old.action) !== canonical(input.action) || old.conversationId !== input.conversationId)) throw fail('conflict', 409);
      if (old && ['superseded', 'invalid'].includes(old.state)) throw fail('confirmation');
      if (old?.proposal) return publicRequest(old);
      if (!old) {
        if (Object.values(data.requests).some(r => ['committing', 'uncertain'].includes(r.state))) throw fail('busy', 409);
        const next = structuredClone(data);
        for (const r of Object.values(next.requests)) if (r.conversationId === input.conversationId && ['preparing', 'prepared', 'reviewed'].includes(r.state)) r.state = 'superseded';
        delete next.reviews[input.conversationId];
        next.requests[input.requestId] = { ...input, state: 'preparing' }; await save(next);
      }
      return receiveProposal(input);
    }),
    reviewed: input => queue(async () => {
      exact(input, ['requestId', 'digest', 'conversationId', 'turnId']);
      const r = currentRequest(input.requestId);
      if (!['prepared', 'reviewed'].includes(r.state) || r.proposal.digest !== input.digest || r.conversationId !== input.conversationId || !(Date.parse(r.proposal.expiresAt) > now()) || !input.turnId) throw fail('confirmation');
      const next = structuredClone(data); next.requests[r.requestId].state = 'reviewed'; next.requests[r.requestId].reviewTurnId = input.turnId;
      next.reviews[input.conversationId] = r.requestId; await save(next); return publicRequest(next.requests[r.requestId]);
    }),
    pending: conversationId => queue(async () => { const r = data.requests[data.reviews[conversationId]]; if (r) await health(); return r ? publicRequest(r) : null; }),
    interruptReview: ({ conversationId, turnId }) => queue(async () => {
      const r = data.requests[data.reviews[conversationId]];
      if (!r || r.state !== 'reviewed' || r.reviewTurnId !== turnId) return;
      const next = structuredClone(data); next.requests[r.requestId].state = 'prepared';
      delete next.requests[r.requestId].reviewTurnId; delete next.reviews[conversationId]; await save(next);
    }),
    invalidateReviews: () => !transport || !permittedProfile ? Promise.resolve() : queue(async () => {
      const next = structuredClone(data); next.reviews = {};
      for (const r of Object.values(next.requests)) if (r.state === 'reviewed') { r.state = 'prepared'; delete r.reviewTurnId; }
      await save(next);
    }),
    confirm: input => queue(async () => {
      exact(input, ['requestId', 'digest', 'conversationId', 'afterTurnId', 'utterance']);
      const r = currentRequest(input.requestId);
      if (r.state !== 'reviewed' || data.reviews[input.conversationId] !== r.requestId || r.conversationId !== input.conversationId || r.reviewTurnId !== input.afterTurnId || r.proposal.digest !== input.digest || !confirmedSpeech.test(input.utterance || '')) throw fail('confirmation');
      if (!(Date.parse(r.proposal.expiresAt) > now())) throw fail('expired', 410);
      await health();
      scope(actionDomain(r.action.type), true);
      // A switch/lock during the health round-trip must not turn an old review
      // into a durable human confirmation. This guard is server-owned only.
      await checkContext();
      const next = structuredClone(data); next.requests[r.requestId] = { ...r, state: 'committing', commit: { proposalId: r.proposal.proposalId, digest: r.proposal.digest, confirmed: true, confirmationId: randomUUID() } };
      delete next.reviews[input.conversationId]; await save(next); return sendCommit(next.requests[r.requestId]);
    }),
    recover: requestId => queue(async () => {
      await health(); const r = currentRequest(requestId);
      if (r.state === 'preparing') return receiveProposal(r);
      if (['prepared', 'reviewed'].includes(r.state)) {
        if (!(Date.parse(r.proposal.expiresAt) > now())) throw fail('expired', 410);
        return publicRequest(r);
      }
      if (!r.proposal || !r.commit || !['committing', 'uncertain', 'committed'].includes(r.state)) throw fail('confirmation');
      const result = validate('receiptResponse', await call('/receipt?' + new URLSearchParams({ proposalId: r.proposal.proposalId })));
      if (result.proposalId !== r.proposal.proposalId) throw fail('protocol');
      if (result.state === 'committed') return acceptReceipt(r, result.receipt);
      if (result.expired) throw fail('expired', 410);
      return sendCommit(r); // Exact durable human-confirmed payload; never a new operation.
    }),
    rotate: () => queue(async () => {
      if (!data.rotation) {
        await health();
        await save({ ...data, rotation: { newSecret: randomBytes(32).toString('base64url'), rotationId: randomUUID() }, state: 'rotating' });
      } else {
        // A lost rotate response may mean the OLD credential is already invalid.
        // Probe the durably saved new credential first, without treating its 401
        // as revocation of the still-valid old credential.
        let probe;
        try { probe = await transport({ path: '/status', method: 'GET', credential: { id: data.connection.id, secret: data.rotation.newSecret } }); } catch { throw fail('uncertain', 503); }
        if (probe.status === 200) {
          connection(probe.body.connection);
          if (probe.body.healthy !== true) throw fail('protocol');
          await save({ ...data, secret: data.rotation.newSecret, rotation: null, state: 'connected' }); await health(); return { rotated: true };
        }
        if (probe.status === 403) {
          const code = ['permissions_changed', 'private_record_denied'].includes(probe.body?.error?.code) ? probe.body.error.code : 'denied';
          await purge('denied', code); throw fail(code, 403);
        }
        if (probe.status !== 401) throw fail('security_hold', 503);
      }
      const result = await call('/rotate', data.rotation);
      if (result.rotated !== true || result.grantId !== data.connection.id) throw fail('protocol');
      await save({ ...data, secret: data.rotation.newSecret, rotation: null, state: 'connected' }); await health(); return { rotated: true };
    }),
    cancel: conversationId => queue(async () => {
      const next = structuredClone(data); const r = next.requests[next.reviews[conversationId]];
      if (r) r.state = 'superseded'; delete next.reviews[conversationId]; await save(next); return { cancelled: true };
    }),
    disconnect: () => { const p = tail.then(async () => {
      await checkContext(); if (!permittedProfile) throw fail('owner_only', 403); await load();
      if (Object.values(data.requests).some(r => ['committing', 'uncertain'].includes(r.state))) throw fail('busy', 409);
      await purge(); return { disconnected: true, revokeInEvergreen: true };
    }); tail = p.catch(() => {}); return p; },
    async close() { await tail; closed = true; await storage.close(); },
    // Not exposed in the HTTP operation allowlist. Async-local guards stay bound
    // to their own queued operation even when channels share a member client.
    inContext: (guard, operation) => operationContext.run(guard, operation),
  };
  return api;
}

