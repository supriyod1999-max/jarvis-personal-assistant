import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createChatGPTAuth, validateIdentity } from '../server/chatgpt-auth.mjs';
import { createChatGPT } from '../server/chatgpt.mjs';
import { createConversationProvider } from '../server/conversation-provider.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(fields = {}) { const input = `${encode({ kid: 'test', alg: 'RS256' })}.${encode({ iss: 'https://auth.openai.com', aud: 'issued', sub: 'person', exp: Date.now() / 1000 + 3600, nonce: 'nonce', email: 'person@example.test', ...fields })}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`; }
const json = value => Response.json(value);
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const tokens = fields => ({ access_token: 'access', refresh_token: 'refresh', id_token: jwt(), token_type: 'Bearer', expires_in: 3600, scope: scopes, ...fields });
function vault(value = null) { let saved = structuredClone(value); return { read: async () => structuredClone(saved), write: async next => { saved = structuredClone(next); }, peek: () => structuredClone(saved) }; }
function registered(expiry = 0) { return { host: 'urn:uuid:stable', selected: 'account', registrations: [{ id: 'account', clientId: 'issued', subject: 'person', email: 'person@example.test', tokens: { access_token: 'old-access', refresh_token: 'old-refresh', scopes: scopes.split(' '), expiresAt: expiry } }] }; }

test('identity validation rejects altered signatures, issuer, audience, expiry, nonce and account changes', () => {
  const options = { clientId: 'issued', nonce: 'nonce', subject: 'person' };
  assert.equal(validateIdentity(jwt(), [jwk], options).subject, 'person');
  for (const fields of [{ iss: 'https://evil.test' }, { aud: 'other' }, { exp: 0 }, { nonce: 'other' }, { sub: 'other' }, { aud: ['issued', 'other'] }]) assert.throws(() => validateIdentity(jwt(fields), [jwk], options), /could not be verified/);
  const original = jwt().split('.'); original[1] = encode({ sub: 'forged' });
  assert.throws(() => validateIdentity(original.join('.'), [jwk], options), /could not be verified/);
});

test('OAuth uses fresh PKCE, checks state, retains issued registration, and never exposes tokens in status', async () => {
  const storage = vault(); let nonce, exchanges = 0, codeFields;
  const auth = createChatGPTAuth({ vault: storage, fetcher: async (url, options) => {
    if (url.endsWith('jwks.json')) return json({ keys: [jwk] });
    exchanges++; codeFields = options.body; return json(tokens({ id_token: jwt({ nonce }) }));
  } });
  try {
    const first = new URL((await auth.start()).url); nonce = first.searchParams.get('nonce');
    assert.equal(first.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(first.searchParams.get('agent_name_hint'), 'JARVIS');
    assert.equal(first.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(first.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: 'wrong', code: 'code', client_id: 'issued' });
    assert.equal((await fetch(callback)).status, 400); assert.equal(exchanges, 0);
    callback.searchParams.set('state', first.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
    assert.equal(exchanges, 1); assert.equal(codeFields.get('client_id'), 'issued'); assert.equal(codeFields.get('redirect_uri'), first.searchParams.get('redirect_uri')); assert.ok(codeFields.get('code_verifier'));
    assert.equal(await auth.getToken(), 'access');
    const status = await auth.status(); assert.equal(status.state, 'ready'); assert.ok(!JSON.stringify(status).includes('refresh_token'));
    const again = new URL((await auth.start(status.selected)).url);
    assert.equal(again.searchParams.get('client_id'), 'issued'); assert.equal(again.searchParams.get('agent_name_hint'), null); assert.equal(again.searchParams.get('ext_agent_host_id'), first.searchParams.get('ext_agent_host_id')); assert.notEqual(again.searchParams.get('state'), first.searchParams.get('state'));
  } finally { await auth.close(); }
});

test('denied grants and changed returning registration cannot replace working credentials', async () => {
  const storage = vault(registered(Date.now() + 3600000)); let called = 0;
  const auth = createChatGPTAuth({ vault: storage, fetcher: async () => { called++; throw Error(); } });
  try {
    for (const extra of [{ error: 'access_denied' }, { code: 'code', client_id: 'different' }]) {
      const url = new URL((await auth.start('account')).url), callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ state: url.searchParams.get('state'), ...extra });
      assert.equal((await fetch(callback)).status, 400);
      assert.equal(await auth.getToken(), 'old-access');
    }
    assert.equal(called, 0);
  } finally { await auth.close(); }
});

test('refresh is serialized, rotates atomically, omits scope and survives restart', async () => {
  const storage = vault(registered()); let calls = 0;
  const auth = createChatGPTAuth({ vault: storage, fetcher: async (url, options) => { calls++; assert.equal(options.body.get('scope'), null); assert.equal(options.body.get('client_id'), 'issued'); return json(tokens({ refresh_token: 'rotated' })); } });
  assert.deepEqual(await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]), ['access', 'access', 'access']); assert.equal(calls, 1);
  assert.equal(storage.peek().registrations[0].tokens.refresh_token, 'rotated'); await auth.close();
  const reopened = createChatGPTAuth({ vault: storage, fetcher: () => assert.fail('No refresh needed') });
  assert.equal(await reopened.getToken(), 'access'); await reopened.close();
});

test('invalid refresh clears only tokens, while transient failures preserve a renewable session', async () => {
  for (const invalid of [true, false]) {
    const storage = vault(registered()), auth = createChatGPTAuth({ vault: storage, fetcher: async () => invalid ? Response.json({ error: 'refresh_token_reused' }, { status: 400 }) : Promise.reject(Error('offline')) });
    await assert.rejects(auth.getToken()); assert.equal(!!storage.peek().registrations[0].tokens, !invalid); assert.equal(storage.peek().registrations[0].clientId, 'issued'); await auth.close();
  }
});

test('signout uses discovered revocation endpoint and clears local tokens even when offline', async () => {
  for (const offline of [false, true]) {
    const storage = vault(registered()), auth = createChatGPTAuth({ vault: storage, fetcher: async (url, options) => {
      if (offline) throw Error();
      if (url.endsWith('openid-configuration')) return json({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' });
      assert.equal(options.body.get('token_type_hint'), 'refresh_token'); return new Response('', { status: 200 });
    } });
    const result = await auth.signOut(); assert.equal(storage.peek().registrations[0].tokens, undefined); if (offline) assert.match(result.message, /not confirmed/); await auth.close();
  }
});

const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function stream(events) { const encoded = new TextEncoder().encode(events.map(frame).join('')); let pos = 0; return new Response(new ReadableStream({ pull(c) { if (pos >= encoded.length) c.close(); else { c.enqueue(encoded.slice(pos, pos + 7)); pos += 7; } } }), { headers: { 'Content-Type': 'text/event-stream' } }); }
const delta = { type: 'response.output_text.delta', delta: 'Hello 🙂' };
const complete = { type: 'response.completed', response: { id: 'response', model: 'gpt-5.6-luna' } };
function provider(events, inspect = () => {}) { return createChatGPT({ auth: { getToken: async () => 'opaque', status: async () => ({ state: 'ready' }) }, fetcher: async (url, options) => { if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-5.6-luna' }] }); inspect(JSON.parse(options.body)); return stream(events); } }); }

test('direct stream uses requested Luna effort, correct subscription flags, UTF8 deltas and timings', async () => {
  for (const reasoning of ['low', 'high']) {
    let partial;
    const result = await provider([delta, complete], body => { assert.equal(body.model, 'gpt-5.6-luna'); assert.equal(body.reasoning.effort, reasoning); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.tools, undefined); assert.equal(body.max_output_tokens, undefined); }).run('prompt', text => { partial = text; }, { reasoning }).done;
    assert.equal(result.text, 'Hello 🙂'); assert.equal(partial, result.text); assert.equal(result.provider, 'chatgpt-direct'); assert.ok(result.timings.firstTextMs >= 0);
  }
});

test('partial, failed, incomplete, unexpected model and tool streams fail without replay', async () => {
  for (const ending of [null, { type: 'response.failed' }, { type: 'response.incomplete' }, { type: 'response.output_item.added', item: { type: 'function_call' } }, { ...complete, response: { model: 'different' } }]) {
    let calls = 0, partial = '';
    const handle = provider([delta, ...(ending ? [ending] : [])], () => calls++).run('prompt', text => { partial = text; });
    await assert.rejects(handle.done); assert.equal(calls, 1); assert.equal(partial, 'Hello 🙂');
  }
});

test('valid subscription SSE works without Content-Type but missing-header HTML fails', async () => {
  for (const valid of [true, false]) {
    const direct = createChatGPT({ auth: { getToken: async () => 'opaque' }, fetcher: async (url, options) => {
      if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-5.6-luna' }] });
      assert.equal(options.headers.Accept, 'text/event-stream');
      const response = valid ? stream([delta, complete]) : new Response('<html>Not a response</html>');
      response.headers.delete('content-type'); return response;
    } });
    const handle = direct.run('prompt', () => {});
    if (valid) assert.equal((await handle.done).text, 'Hello 🙂');
    else await assert.rejects(handle.done, /ended before completing/);
  }
});

test('cancellation interrupts pending direct HTTP without starting another provider', async () => {
  const direct = createChatGPT({ auth: { getToken: async () => 'opaque' }, fetcher: async (url, { signal }) => { if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-5.6-luna' }] }); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  const handle = direct.run('prompt', () => {}); await new Promise(r => setTimeout(r, 10)); await handle.cancel(); assert.equal((await handle.done).cancelled, true);
});

test('legacy route is disclosed only before setup; direct errors never retry through Hermes', async () => {
  let state = { state: 'signin', accounts: [] }, directRuns = 0, legacyRuns = 0;
  const router = createConversationProvider({ auth: { status: async () => state },
    direct: { status: async () => state, run: () => { directRuns++; return { done: Promise.reject(new Error('upstream failed')), cancel: async () => {} }; } },
    legacy: { status: async () => ({ state: 'ready' }), run: () => { legacyRuns++; return { done: Promise.resolve({ text: 'Legacy setup reply' }), cancel: async () => {} }; } },
  });
  assert.match((await router.status()).message, /sign-in is pending/);
  assert.equal((await router.run('prompt', () => {}).done).provider, 'hermes');
  state = { state: 'ready', accounts: [{ id: 'account' }] };
  await assert.rejects(router.run('prompt', () => {}).done, /upstream failed/);
  state = { state: 'signin', accounts: [{ id: 'account' }] };
  await assert.rejects(router.run('prompt', () => {}).done, /upstream failed/);
  assert.equal(directRuns, 2); assert.equal(legacyRuns, 1);
});

