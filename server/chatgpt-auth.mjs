import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { credentialVault } from './credential-vault.mjs';

const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN = 'chatgpt.tokens.use.direct';
const BAD_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const random = () => randomBytes(32).toString('base64url');
const fail = message => { throw new Error(message); };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function validateIdentity(token, keys, { clientId, nonce, subject, now = Date.now() }) {
  try {
    const parts = token.split('.'); if (parts.length !== 3) throw Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const key = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (header.alg !== 'RS256' || !key || header.crit) throw Error();
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw Error();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== AUTH || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now || (claims.nbf && claims.nbf * 1000 > now + 30000) || !equal(claims.nonce, nonce) || typeof claims.sub !== 'string' || !claims.sub || (subject && subject !== claims.sub)) throw Error();
    return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : 'ChatGPT account' };
  } catch { fail('ChatGPT returned an identity that could not be verified. Please sign in again.'); }
}

export function createChatGPTAuth({ directory, vault = credentialVault(join(directory, 'connections/chatgpt.dpapi')), fetcher = fetch, now = Date.now, readOnly = false } = {}) {
  let database, pending, refreshing, notice = '', closed = false;
  let tail = Promise.resolve();
  const exclusive = action => { const next = tail.then(action, action); tail = next.catch(() => {}); return next; };
  const initialized = (async () => { if (!readOnly) await vault.acquire?.(); database = await vault.read(); if (!database) { if (readOnly) fail('Complete ChatGPT sign-in in the app first.'); database = { host: `urn:uuid:${randomUUID()}`, selected: null, registrations: [] }; await vault.write(database); } })();
  initialized.catch(() => {});
  const persist = () => vault.write(database);
  const selected = () => database.registrations.find(item => item.id === database.selected);
  async function request(url, options = {}) {
    try { return await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('Could not reach ChatGPT. Check your connection and try again.'); }
  }
  async function tokenRequest(fields) {
    const response = await request(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
    let data; try { data = await response.json(); } catch { fail('ChatGPT returned an unreadable sign-in response.'); }
    if (!response.ok) { const error = new Error('ChatGPT sign-in needs to be renewed. Please try signing in again.'); error.oauthCode = typeof data.error === 'string' ? data.error : data.error?.code; throw error; }
    return data;
  }
  function credentials(data, old = {}) {
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/) : old.scopes || [];
    if (!scopes.includes(PLAN) || !scopes.includes('resource.invoke')) fail('ChatGPT plan use was not enabled. Reconnect and allow JARVIS to use your plan.');
    if (typeof data.access_token !== 'string' || !data.access_token || String(data.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) fail('ChatGPT returned incomplete credentials. Please sign in again.');
    return { access_token: data.access_token, refresh_token: data.refresh_token || old.refresh_token, id_token: data.id_token || old.id_token, scopes, expiresAt: now() + data.expires_in * 1000 };
  }
  function endAttempt() { if (pending) { clearTimeout(pending.timer); pending.server.close(); pending = null; } }
  async function status() {
    try {
      await initialized; const current = selected();
      return { state: current?.tokens ? 'ready' : 'signin', pending: !!pending, message: notice || (current?.tokens ? 'Direct ChatGPT connection is ready.' : 'Connect ChatGPT in Settings to enable direct conversations.'), selected: database.selected, accounts: database.registrations.map((r, i) => ({ id: r.id, label: `${r.email || 'Pending registration'} · Account ${i + 1}`, signedIn: !!r.tokens })) };
    } catch { return { state: 'error', pending: false, message: 'The Windows credential vault could not be read.', selected: null, accounts: [] }; }
  }
  async function start(accountId = null) {
    await initialized;
    if (readOnly) fail('Manage ChatGPT sign-in in the app.');
    return exclusive(async () => {
      if (closed) fail('The app is restarting.');
      const account = accountId ? database.registrations.find(r => r.id === accountId) : null;
      if (accountId && !account) fail('Select a saved ChatGPT account.');
      endAttempt(); notice = '';
      const attempt = { state: random(), nonce: random(), verifier: random(), account, claimed: false };
      const server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const finish = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
        const url = new URL(req.url, attempt.redirect);
        if (req.method !== 'GET' || req.headers.host !== new URL(attempt.redirect).host || url.pathname !== '/auth/callback') return finish(404, 'Not found.');
        if (pending !== attempt || attempt.claimed || !equal(url.searchParams.get('state'), attempt.state)) return finish(400, 'This sign-in attempt is invalid or expired.');
        attempt.claimed = true;
        try {
          if (url.searchParams.has('error')) fail('ChatGPT sign-in was not completed. You can try again from Settings.');
          const clientId = url.searchParams.get('client_id') || account?.clientId;
          const code = url.searchParams.get('code');
          if (!clientId || clientId === 'dynamic_agent_client' || clientId.length > 256 || !code || code.length > 10000 || (account && clientId !== account.clientId)) fail('ChatGPT registration was incomplete or did not match the selected account.');
          await exclusive(async () => {
            let registration = account;
            if (!registration) {
              // Retain a new issued ID even if the one-time code has expired.
              if (database.registrations.some(r => r.clientId === clientId)) fail('This registration already exists. Select that saved account.');
              registration = { id: randomUUID(), clientId }; database.registrations.push(registration); await persist();
            }
            const data = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect, resource: RESOURCE });
            const jwks = await (await request(`${AUTH}/.well-known/jwks.json`)).json();
            const identity = validateIdentity(data.id_token, jwks.keys, { clientId, nonce: attempt.nonce, subject: registration.subject, now: now() });
            const tokens = credentials(data);
            if (!tokens.refresh_token) fail('ChatGPT did not grant a renewable session. Please reconnect.');
            Object.assign(registration, identity, { tokens }); database.selected = registration.id; await persist();
          });
          notice = ''; finish(200, 'JARVIS is connected to ChatGPT. You can close this tab and return to the app.');
        } catch (error) { notice = error.message; finish(400, notice); }
        finally { if (pending === attempt) endAttempt(); }
      });
      server.requestTimeout = 10000; server.headersTimeout = 10000;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      attempt.redirect = `http://127.0.0.1:${server.address().port}/auth/callback`; attempt.server = server;
      attempt.timer = setTimeout(() => { if (pending === attempt) { notice = 'Sign-in expired. Start again from Settings.'; endAttempt(); } }, 600000); attempt.timer.unref(); pending = attempt;
      const url = new URL(`${AUTH}/api/accounts/authorize`);
      url.search = new URLSearchParams({ client_id: account?.clientId || 'dynamic_agent_client', ...(!account ? { agent_name_hint: 'JARVIS' } : {}), ext_agent_host_id: database.host, response_type: 'code', redirect_uri: attempt.redirect, scope: `openid profile email offline_access resource.invoke ${PLAN}`, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }).toString();
      // Omit optional login hints to keep authorization URLs free of retained tokens.
      return { url: url.href };
    });
  }
  async function getToken() {
    await initialized; if (closed) fail('The app is restarting.');
    const current = selected(); if (!current?.tokens) fail('Connect ChatGPT in Settings before starting a direct conversation.');
    if (current.tokens.expiresAt > now() + 60000) return current.tokens.access_token;
    if (readOnly) fail('Refresh ChatGPT by sending a message in the app, then run the speed check again.');
    if (!refreshing) refreshing = exclusive(async () => {
      const account = selected(); if (!account?.tokens) fail('Please sign in to ChatGPT again.');
      if (account.tokens.expiresAt > now() + 60000) return account.tokens.access_token;
      try {
        const data = await tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.tokens.refresh_token, resource: RESOURCE });
        account.tokens = credentials(data, account.tokens); await persist(); return account.tokens.access_token;
      } catch (error) { if (BAD_REFRESH.has(error.oauthCode)) { delete account.tokens; await persist(); } throw error; }
    }).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function signOut() {
    await initialized;
    if (readOnly) fail('Manage ChatGPT sign-in in the app.');
    return exclusive(async () => {
      endAttempt(); const account = selected(); let revoked = !account?.tokens?.refresh_token;
      if (account?.tokens?.refresh_token) {
        try {
          const metadata = await (await request(`${AUTH}/.well-known/openid-configuration`)).json();
          const url = new URL(metadata.revocation_endpoint);
          if (url.origin !== AUTH || metadata.issuer !== AUTH) throw Error();
          for (let i = 0; i < 2; i++) {
            let response;
            try { response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: account.clientId }) }); } catch { /* Retry once without exposing credentials. */ }
            if (response?.status === 200) { revoked = true; break; }
            if (response && response.status < 500) break;
            if (!i) await new Promise(r => setTimeout(r, 500));
          }
        } catch { /* Still clear local credentials. */ }
      }
      if (account) { delete account.tokens; await persist(); }
      notice = revoked ? 'Signed out of ChatGPT.' : 'Signed out locally. Remote revocation was not confirmed; disconnect JARVIS in ChatGPT Settings.';
      return { message: notice };
    });
  }
  return { status, start, getToken, signOut, close: async () => { closed = true; endAttempt(); await initialized.catch(() => {}); await tail; await vault.release?.(); } };
}
