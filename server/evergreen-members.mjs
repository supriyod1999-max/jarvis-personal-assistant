// Two-member router core. Not imported by application configuration.
// Authentication and bindings are trusted server dependencies, never JSON fields.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createEvergreenClient } from './evergreen-client.mjs';
import { evergreenStorage } from './evergreen-storage.mjs';
import { evergreenSyntheticSession } from './evergreen-transport.mjs';
import { canonical, hash, integrationError as fail } from './evergreen-contract.mjs';

const denied = () => fail('denied', 403);
const changed = () => fail('context_changed', 409);
const exact = (input, keys) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw fail('invalid');
};
const simple = new Set(['pair', 'exchange', 'check', 'sync', 'rotate', 'disconnect', 'status']);
const operations = new Set([...simple, 'search', 'cached', 'quote', 'prepare', 'reviewed', 'confirm', 'recover', 'pending', 'cancel', 'interruptReview']);

export function createSyntheticEvergreenRegistry({ directory, bindings, authenticate, environment = 'synthetic', storageFactory = evergreenStorage, sessionFactory = () => evergreenSyntheticSession({ mode: 'household' }) }) {
  if (environment !== 'synthetic') throw fail('release_held', 503);
  if (!Array.isArray(bindings) || bindings.length !== 2 || typeof authenticate !== 'function') throw fail('invalid');
  const roster = structuredClone(bindings);
  for (const b of roster) {
    exact(b, ['profileId', 'memberUid', 'householdId']);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(b.profileId || '') || !/^synthetic-[A-Za-z0-9_-]{1,100}$/.test(b.memberUid || '') || !/^HH-SYNTHETIC-[A-Za-z0-9_-]{1,100}$/.test(b.householdId || '')) throw fail('release_held', 503);
  }
  if (new Set(roster.map(b => b.memberUid)).size !== 2 || new Set(roster.map(b => b.profileId)).size !== 2 || new Set(roster.map(b => b.householdId)).size !== 1) throw fail('invalid');
  return createEvergreenMemberRegistry({ directory: join(directory, 'synthetic-household-evergreen'), bindings: roster, authenticate, storageFactory, environment,
    clientFactory: ({ directory, storage, binding: b }) => createEvergreenClient({ ...sessionFactory(b), directory, storage, profileId: b.profileId, expectedBinding: b, syntheticMember: true, environment: 'synthetic' }) });
}

// Trusted server composition only. The production factory validates its release
// and session subjects before constructing this core; no public endpoint creates it.
export function createEvergreenMemberRegistry({ directory: base, bindings: roster, authenticate, storageFactory = evergreenStorage, clientFactory, environment, now = Date.now }) {
  if (!['synthetic', 'production'].includes(environment) || typeof clientFactory !== 'function' || typeof authenticate !== 'function' || roster?.length !== 2) throw fail('invalid');
  roster = structuredClone(roster);
  const registry = storageFactory(join(base, 'registry'));
  const clients = new Map(), channels = new Set();
  let ready, entries, closed = false, registryTail = Promise.resolve();
  const privacyFor = profileId => {
    const p = entries?.find(e => e.profileId === profileId)?.privacy;
    return p?.version === 1 && typeof p.processWithAI === 'boolean' && typeof p.retainChat === 'boolean' && Number.isFinite(Date.parse(p.agreedAt)) ? structuredClone(p) : { version: 1, processWithAI: false, retainChat: false, agreedAt: null };
  };
  async function init() {
    if (closed) throw fail('disconnected');
    ready ||= (async () => {
      const saved = await registry.read();
      if (saved) {
        if (saved.version !== 1 || canonical(saved.bindings) !== canonical(roster) || !Array.isArray(saved.entries) || saved.entries.length !== 2 || new Set(saved.entries.map(e => e.handle)).size !== 2 || saved.entries.some((e, i) => e.profileId !== roster[i].profileId || !/^[a-f0-9-]{36}$/.test(e.handle))) throw fail('protocol');
        entries = saved.entries;
      } else {
        entries = roster.map(b => ({ profileId: b.profileId, handle: randomUUID() }));
        await registry.write({ version: 1, bindings: roster, entries });
      }
      for (const b of roster) {
        const entry = entries.find(e => e.profileId === b.profileId);
        clients.set(entry.handle, clientFactory({ directory: join(base, entry.handle), storage: storageFactory(join(base, entry.handle)), binding: b, getPrivacy: () => privacyFor(b.profileId) }));
      }
    })();
    return ready;
  }
  async function identity(ticket) {
    const value = await authenticate(ticket);
    if (!value || typeof value.sessionId !== 'string' || !value.sessionId || !roster.some(b => b.profileId === value.profileId)) throw denied();
    return { profileId: value.profileId, sessionId: value.sessionId };
  }
  const entryFor = id => entries.find(e => e.profileId === id.profileId);
  return {
    async connections(ticket) {
      const id = await identity(ticket); await init(); const e = entryFor(id);
      return [{ handle: e.handle, profileId: e.profileId, environment, liveEnabled: false }];
    },
    // One channel per authenticated renderer/voice surface. Keep it server-side;
    // never expose the client objects or use caller-created profile sessions.
    channel() {
      let active = null, generation = 0, stopped = false;
      const contexts = new WeakMap();
      async function current(token) {
        const ctx = contexts.get(token);
        if (closed || stopped || !ctx || active !== ctx || ctx.generation !== generation) throw changed();
        const id = await identity(ctx.ticket);
        if (active !== ctx || ctx.generation !== generation || canonical(id) !== canonical(ctx.identity)) throw changed();
        return ctx;
      }
      async function invalidate() {
        generation++; const previous = active; active = null;
        if (previous) await previous.client.invalidateReviews();
      }
      const channel = {
        async privacy(token, input) {
          const ctx = await current(token);
          if (input === undefined) return privacyFor(ctx.identity.profileId);
          exact(input, ['processWithAI', 'retainChat', 'confirm']);
          if (input.confirm !== true || typeof input.processWithAI !== 'boolean' || typeof input.retainChat !== 'boolean') throw fail('invalid');
          const update = registryTail.then(async () => {
            await current(token);
            await ctx.client.invalidateReviews();
            await current(token);
            const next = structuredClone(entries), entry = next.find(e => e.handle === ctx.handle);
            entry.privacy = { version: 1, processWithAI: input.processWithAI, retainChat: input.retainChat, agreedAt: new Date(now()).toISOString() };
            await registry.write({ version: 1, bindings: roster, entries: next }); entries = next;
            await current(token); return privacyFor(ctx.identity.profileId);
          });
          registryTail = update.catch(() => {}); return update;
        },
        async select(ticket, handle) {
          // Drop voice authority immediately, including while a network call runs.
          const pending = invalidate(), selection = generation;
          await pending; const id = await identity(ticket); await init();
          const entry = entryFor(id);
          if (entry.handle !== handle) throw denied();
          if (stopped || selection !== generation) throw changed();
          const client = clients.get(handle); await client.invalidateReviews();
          if (stopped || selection !== generation) throw changed();
          const token = Object.freeze({ contextId: randomUUID() });
          // Stable across server restart for the same durable authenticated
          // session. A newly unlocked session gets a different namespace. Review
          // authority is still discarded on every selection and reconstruction.
          active = { ticket, identity: id, client, handle, generation, conversations: new Map(), heard: new Map(), prefix: hash([id.profileId, id.sessionId]) };
          contexts.set(token, active);
          return token;
        },
        async run(token, operation, input = {}) {
          const ctx = await current(token);
          if (!operations.has(operation)) throw fail('invalid');
          let payload = structuredClone(input);
          if (simple.has(operation)) exact(payload, []);
          if (['pending', 'cancel', 'interruptReview', 'prepare', 'reviewed', 'confirm'].includes(operation)) {
            const keys = { pending: ['conversationId'], cancel: ['conversationId'], interruptReview: ['conversationId', 'turnId'], prepare: ['conversationId', 'requestId', 'turnId', 'action'], reviewed: ['conversationId', 'requestId', 'turnId', 'digest'], confirm: ['conversationId', 'requestId', 'afterTurnId', 'digest', 'utterance'] };
            exact(payload, keys[operation]);
            if (typeof payload.conversationId !== 'string' || !payload.conversationId || payload.conversationId.length > 128) throw fail('invalid');
            // Browser conversation IDs cannot select another member's history.
            const local = payload.conversationId;
            payload.conversationId = hash([ctx.prefix, ctx.handle, local]);
            ctx.conversations.set(payload.conversationId, local);
          }
          if (operation === 'recover') exact(payload, ['requestId']);
          if (operation === 'confirm') {
            const heard = ctx.heard.get(payload.requestId);
            if (!heard || heard.digest !== payload.digest || heard.turnId !== payload.afterTurnId || heard.conversationId !== payload.conversationId) throw fail('confirmation');
            ctx.heard.delete(payload.requestId);
          }
          if (['prepare', 'cancel', 'interruptReview'].includes(operation)) for (const [id, heard] of ctx.heard) if (heard.conversationId === payload.conversationId) ctx.heard.delete(id);
          const argument = ['pending', 'cancel'].includes(operation) ? payload.conversationId : operation === 'recover' ? payload.requestId : payload;
          await current(token);
          const result = await ctx.client.inContext(() => current(token), () => ctx.client[operation](...(simple.has(operation) ? [] : [argument])));
          await current(token); // A late private result must never enter a new context.
          if (operation === 'reviewed') ctx.heard.set(payload.requestId, { digest: payload.digest, turnId: payload.turnId, conversationId: payload.conversationId });
          if (result?.conversationId) return { ...result, conversationId: ctx.conversations.get(result.conversationId) || null };
          if (operation === 'status') return { ...result, requests: result.requests.map(r => ({ ...r, conversationId: ctx.conversations.get(r.conversationId) || null })) };
          return result;
        },
        async stop() { stopped = true; await invalidate(); channels.delete(channel); },
      };
      channels.add(channel); return channel;
    },
    async close() {
      closed = true;
      await Promise.all([...channels].map(c => c.stop()));
      if (ready) await ready.catch(() => {});
      await Promise.all([...clients.values()].map(c => c.close()));
      await registryTail; await registry.close();
    },
  };
}

// Presentation helper for results ALREADY authorised to the current session.
// This never queries another connection or creates write authority.
export function mergeEvergreenSharedViews(views) {
  const grouped = new Map(), privateRows = [];
  for (const { handle, householdId, records } of views) {
    for (const record of records) {
      if (record.deleted) continue;
      const source = { handle, recordId: record.id, revision: record.revision };
      if (record.visibility !== 'household') { privateRows.push({ record, sources: [source], conflict: false }); continue; }
      const key = canonical([householdId, record.domain, record.nativeId]);
      const old = grouped.get(key);
      if (!old) grouped.set(key, { record, sources: [source], conflict: false });
      else {
        old.sources.push(source);
        if (old.record && (old.record.revision !== record.revision || canonical(old.record.data) !== canonical(record.data))) { old.record = null; old.conflict = true; }
      }
    }
  }
  return [...privateRows, ...grouped.values()];
}
