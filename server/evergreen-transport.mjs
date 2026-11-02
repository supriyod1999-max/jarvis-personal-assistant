import { integrationError } from './evergreen-contract.mjs';
export const EVERGREEN_BASE = 'https://evergreen.example.invalid/api/integrations/jarvis';
// Not installed in the application while release remains held. Fixed origin,
// no redirects, cookies, Firebase token, alternate host or automatic retries.
export function evergreenHttpsTransport(fetcher = fetch, observe = event => console.warn('[Evergreen transport] ' + JSON.stringify(event)),
  { diagnosticChangesOnce = process.env.JARVIS_EVERGREEN_MEASURE_CHANGES_ONCE === '1' } = {}) {
  return transportFor(EVERGREEN_BASE, false, fetcher, observe, diagnosticChangesOnce === true);
}
export function evergreenSyntheticTransport({ port = 4320, fetcher = fetch } = {}) {
  if (![4320, 4321].includes(port)) throw integrationError('invalid');
  return transportFor(`http://127.0.0.1:${port}/api/integrations/jarvis`, true, fetcher);
}
// The runnable sandbox deliberately freezes/advances its own clock. Keep this
// adjustment confined to synthetic configuration, never production expiry checks.
export function evergreenSyntheticSession({ port = 4320, fetcher = fetch, mode = 'personal' } = {}) {
  if (!['personal', 'household'].includes(mode)) throw integrationError('invalid');
  const send = evergreenSyntheticTransport({ port, fetcher }); let clock = Date.now();
  return { now: () => clock, transport: async request => {
    const response = await fetcher(`http://127.0.0.1:${port}/__synthetic/health`, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000) });
    if (!response.ok || response.headers.get('x-evergreen-synthetic') !== 'true') throw integrationError('protocol');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body || []) { bytes += chunk.length; if (bytes > 4096) throw integrationError('protocol'); chunks.push(Buffer.from(chunk)); }
    const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (health.synthetic !== true || health.realData !== false || health.mode !== mode || health.fixtureKind !== 'evergreen-jarvis-synthetic-only-v1' || !Number.isFinite(Date.parse(health.now))) throw integrationError('protocol');
    clock = Date.parse(health.now);
    return send(request);
  } };
}
function transportFor(base, synthetic, fetcher, observe, diagnosticChangesOnce = false) {
  return async ({ path, method = 'GET', body, credential }) => {
    const operation = /^\/(pair|exchange|status|records|changes|quote|prepare|commit|receipt|rotate|capabilities)(?:\?|$)/.exec(path)?.[1];
    if (!operation) throw integrationError('protocol');
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload && Buffer.byteLength(payload) > 100000) throw integrationError('invalid');
    // Temporary operator measurement, never a request-controlled timeout. Only
    // one exact read-feed POST consumes it, even on failure; every other request
    // retains its normal bound. No retry, authentication or expiry change.
    const measure = diagnosticChangesOnce && path === '/changes' && method === 'POST';
    if (measure) diagnosticChangesOnce = false;
    const deadlineMs = measure ? 45000 : 15000;
    const started = performance.now();
    const report = (status, outcome, response, failure) => {
      if (typeof observe !== 'function') return;
      // Never retain the request, query, credential, response body or error text.
      const timing = /^authority;dur=(\d{1,9}(?:\.\d{1,3})?)$/.exec(response?.headers.get('server-timing') || '');
      const event = { operation, method: ['GET', 'POST'].includes(method) ? method : 'other',
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        durationMs: Math.max(0, Math.round(performance.now() - started)), outcome,
        ...(timing ? { serverDurationMs: Number(timing[1]) } : {}),
        ...(failure ? { errorClass: ['AbortError', 'TimeoutError', 'TypeError', 'Error'].includes(failure.name) ? failure.name : 'network_error' } : {}) };
      try { observe(event); } catch { /* Diagnostics cannot affect access or recovery. */ }
    };
    let response;
    try { response = await fetcher(base + path, { method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(deadlineMs), headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(credential ? { Authorization: `Bearer ejv1.${credential.id}.${credential.secret}` } : {}) }, body: payload }); }
    catch (error) { report(null, 'network_error', null, error); throw integrationError('uncertain', 503); }
    if ((response.headers.get('x-evergreen-synthetic') === 'true') !== synthetic) { report(response.status, 'protocol_error', response); throw integrationError('protocol'); }
    let bytes = 0; const chunks = [];
    try {
      for await (const chunk of response.body || []) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw integrationError('protocol'); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      report(response.status, 'response', response);
      return { status: response.status, body };
    } catch { const status = response.ok ? 502 : response.status; report(status, 'invalid_response', response); return { status, body: null }; }
  };
}
