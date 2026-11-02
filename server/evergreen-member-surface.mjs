// Host adapter mounted through evergreen-host; its live registry remains held.
// Open only after Origin/Tailscale/PIN checks. `ticket` is server-authenticated;
// never accept a member UID, household, connection handle or subject from JSON.
import { createEvergreenAssistant } from './evergreen-assistant.mjs';
import { integrationError as fail } from './evergreen-contract.mjs';

// HTTP/chat lifecycle owner. `authenticate` must check the actual session AND the reviewed
// principal, and the host must still enforce Origin/Tailscale/PIN before dispatch.
export function createEvergreenMemberSessions({ registry, authenticate, generate, redactChat, maxSessions = 8 }) {
  if (typeof authenticate !== 'function' || typeof generate !== 'function' || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 32) throw fail('invalid');
  const sessions = new Map(); let closed = false;
  async function identity(ticket) {
    const id = await authenticate(ticket);
    if (!id || !['profileId', 'sessionId', 'subject'].every(k => typeof id[k] === 'string' && id[k].length > 0)) throw fail('denied', 403);
    return { profileId: id.profileId, sessionId: id.sessionId, subject: id.subject };
  }
  const key = id => JSON.stringify([id.profileId, id.sessionId, id.subject]);
  async function prune() {
    for (const [k, entry] of sessions) {
      let current; try { current = await identity(entry.ticket); } catch { /* Revoked/expired. */ }
      if (!current || key(current) !== k) { sessions.delete(k); try { await (await entry.ready).close(); } catch { /* A failed opening has no session to retain. */ } }
    }
  }
  return {
    async forRequest(ticket) {
      if (closed) throw fail('context_changed', 409);
      const id = await identity(ticket), k = key(id); await prune();
      if (closed) throw fail('context_changed', 409);
      let entry = sessions.get(k);
      if (!entry) {
        if (sessions.size >= maxSessions) throw fail('busy', 409);
        entry = { ticket, ready: openEvergreenMemberSurface({ registry, ticket, generate: prompt => generate(id, prompt), ...(redactChat ? { redactChat: () => redactChat(id) } : {}) }) };
        sessions.set(k, entry);
        entry.ready.catch(() => { if (sessions.get(k) === entry) sessions.delete(k); });
      }
      const surface = await entry.ready;
      const current = await identity(ticket);
      if (closed || sessions.get(k) !== entry || key(current) !== k) throw fail('context_changed', 409);
      return surface;
    },
    // Call before the host revokes the PIN session or switches its workspace.
    // Expired/revoked sessions are also pruned on the next authenticated request.
    async endSession(ticket) {
      const id = await identity(ticket), k = key(id), entry = sessions.get(k);
      sessions.delete(k);
      if (entry) await (await entry.ready).close();
    },
    async close() { closed = true; await Promise.all([...sessions.values()].map(async e => { try { await (await e.ready).close(); } catch { /* A failed opening has no usable session. */ } })); sessions.clear(); },
  };
}

export async function openEvergreenMemberSurface({ registry, ticket, generate, redactChat = null }) {
  const connections = await registry.connections(ticket);
  if (connections.length !== 1) throw fail('denied', 403);
  const channel = registry.channel();
  let token;
  try { token = await channel.select(ticket, connections[0].handle); } catch (e) { await channel.stop(); throw e; }
  let privacy;
  try { privacy = await channel.privacy(token); } catch (e) { await channel.stop(); throw e; }
  const methods = ['status', 'pair', 'exchange', 'check', 'sync', 'rotate', 'disconnect', 'search', 'cached', 'quote', 'prepare', 'reviewed', 'confirm', 'recover', 'pending', 'cancel', 'interruptReview'];
  const client = Object.fromEntries(methods.map(method => [method, value => channel.run(token, method, ['pending', 'cancel'].includes(method) ? { conversationId: value } : method === 'recover' ? { requestId: value } : value)]));
  const refreshPrivacy = async () => { privacy = await channel.privacy(token); return privacy; };
  const assistant = createEvergreenAssistant({ client, privacy: () => privacy, generate: async prompt => {
    await refreshPrivacy();
    if (!privacy.processWithAI) throw fail('privacy_required', 403);
    const text = await generate(prompt);
    // Revalidate session before model output can enter a private review.
    await refreshPrivacy(); return text;
  } });
  let closed = false;
  return {
    // Retain this object for one authenticated voice/renderer session. Closing or
    // switching ends that review context. It is not a transferable bearer token.
    handles: assistant.handles,
    async status() {
      const status = await client.status(); await refreshPrivacy();
      return { ...status, privacy: { ...privacy }, memberContext: { profileId: connections[0].profileId, handle: connections[0].handle, privateAccess: 'current-member-only', sharedAccess: 'explicit-scopes-only' } };
    },
    async settings(operation, input = {}) {
      if (closed) throw fail('context_changed', 409);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid');
      if (operation === 'privacy') {
        if (Object.keys(input).some(k => !['processWithAI', 'retainChat', 'confirm'].includes(k)) || input.confirm !== true || typeof input.processWithAI !== 'boolean' || typeof input.retainChat !== 'boolean') throw fail('invalid');
        // A host using persistent chat must supply its member-isolated redactor.
        // Without that host contract retention cannot be enabled at all.
        if (input.retainChat && !redactChat) throw fail('release_held', 503);
        await refreshPrivacy();
        if (!input.retainChat && redactChat) { await redactChat(); await refreshPrivacy(); }
        privacy = await channel.privacy(token, input); return { ...privacy };
      }
      if (operation === 'redact-chat') {
        if (input.confirm !== true || Object.keys(input).length !== 1 || !redactChat) throw fail('invalid');
        await refreshPrivacy(); await redactChat(); await refreshPrivacy();
        return channel.privacy(token, { processWithAI: privacy.processWithAI, retainChat: false, confirm: true });
      }
      if (!['pair', 'exchange', 'check', 'sync', 'rotate', 'disconnect', 'recover'].includes(operation)) throw fail('invalid');
      if (Object.keys(input).some(k => operation !== 'recover' || k !== 'requestId')) throw fail('invalid');
      return client[operation](operation === 'recover' ? input.requestId : undefined);
    },
    async records(input) { return client.search(input); },
    async talk(request, onText) {
      if (closed) throw fail('context_changed', 409);
      await refreshPrivacy();
      // Register this conversation's local name before status-based recovery.
      // The encrypted request still owns the original ID and confirmation.
      if (!assistant.handles(request)) return null;
      await client.pending(request.conversationId);
      const pending = [];
      const run = assistant.run(request, text => pending.push(text));
      if (!run) return null;
      const done = run.done.then(async result => {
        await refreshPrivacy();
        // Do not stream a late private reply into a newly selected workspace.
        for (const text of pending) onText(text);
        return { ...result, retainChat: privacy.retainChat };
      });
      return { ...run, done };
    },
    async interruptReview(input) { return client.interruptReview(input); },
    async close() { closed = true; await channel.stop(); },
  };
}
