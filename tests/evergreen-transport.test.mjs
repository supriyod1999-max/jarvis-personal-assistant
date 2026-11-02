import test from 'node:test';
import assert from 'node:assert/strict';
import { evergreenHttpsTransport, evergreenSyntheticTransport, evergreenSyntheticSession } from '../server/evergreen-transport.mjs';
import { configuredEvergreen } from '../server/evergreen-config.mjs';

test('synthetic marker is mandatory and live transport rejects synthetic responses; redirects/retries are disabled', async () => {
  let calls = 0;
  const response = (marker, value) => new Response(JSON.stringify(value), { headers: { ...(marker ? { 'x-evergreen-synthetic': 'true' } : {}), 'content-type': 'application/json' } });
  const missing = evergreenSyntheticTransport({ fetcher: async (_, options) => { calls++; assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); return response(false, {}); } });
  await assert.rejects(missing({ path: '/status' }), { code: 'protocol' }); assert.equal(calls, 1);
  const wrong = evergreenHttpsTransport(async () => response(true, {})); await assert.rejects(wrong({ path: '/status' }), { code: 'protocol' });
  assert.throws(() => evergreenSyntheticTransport({ port: 443 }));
  assert.throws(() => configuredEvergreen({ directory: '.', mode: 'live' }));
  await assert.rejects(missing({ path: '//evil.example/status' }), { code: 'protocol' }); assert.equal(calls, 1);
});

test('only the marked synthetic sandbox supplies its controlled clock to development mode', async () => {
  let now = '2026-10-06T01:00:00.000Z', realData = false;
  const session = evergreenSyntheticSession({ fetcher: async url => new Response(JSON.stringify(url.endsWith('/health') ? { synthetic: true, realData, mode: 'personal', fixtureKind: 'evergreen-jarvis-synthetic-only-v1', now } : {}), { headers: { 'x-evergreen-synthetic': 'true' } }) });
  await session.transport({ path: '/status' }); assert.equal(session.now(), Date.parse(now));
  now = '2026-10-06T02:00:00.000Z'; await session.transport({ path: '/status' }); assert.equal(session.now(), Date.parse(now));
  realData = true; await assert.rejects(session.transport({ path: '/status' }), { code: 'protocol' });
});

test('transport preserves split UTF-8, bounds payloads and does not expose non-JSON failures', async () => {
  const bytes = Buffer.from(JSON.stringify({ title: 'Café 🌿' }));
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const transport = evergreenSyntheticTransport({ fetcher: async () => new Response(stream, { headers: { 'x-evergreen-synthetic': 'true' } }) });
  assert.equal((await transport({ path: '/status' })).body.title, 'Café 🌿');
  const failure = evergreenSyntheticTransport({ fetcher: async () => new Response('secret HTML error', { status: 503, headers: { 'x-evergreen-synthetic': 'true' } }) });
  assert.deepEqual(await failure({ path: '/status' }), { status: 503, body: null });
  await assert.rejects(failure({ path: '/prepare', method: 'POST', body: { tooMuch: 'x'.repeat(100001) } }));
});

test('live diagnostics expose fixed operation metadata only and cannot change a successful response', async () => {
  const events = [], privateValue = 'DO-NOT-LOG-PRIVATE-CONTENT';
  const request = { path: '/records?query=' + privateValue, credential: { id: privateValue, secret: privateValue } };
  const send = evergreenHttpsTransport(async () => new Response(JSON.stringify({ title: privateValue }),
    { headers: { 'server-timing': 'authority;dur=123.4' } }), event => events.push(event));
  assert.equal((await send(request)).body.title, privateValue);
  assert.deepEqual(Object.keys(events[0]).sort(), ['durationMs', 'method', 'operation', 'outcome', 'serverDurationMs', 'status']);
  assert.equal(events[0].operation, 'records'); assert.equal(events[0].status, 200);
  assert.equal(events[0].serverDurationMs, 123.4); assert.ok(Number.isSafeInteger(events[0].durationMs));
  assert.ok(!JSON.stringify(events).includes(privateValue));
  const noisyObserver = evergreenHttpsTransport(async () => new Response('{}'), () => { throw new Error(privateValue); });
  assert.deepEqual(await noisyObserver({ path: '/status' }), { status: 200, body: {} });
});

test('interrupted requests remain uncertain without replay and diagnostics discard failure text and arbitrary timing headers', async () => {
  const events = [], privateValue = 'DO-NOT-LOG-CREDENTIAL-OR-BODY'; let calls = 0;
  const send = evergreenHttpsTransport(async () => {
    calls++; throw Object.assign(new Error(privateValue), { name: privateValue });
  }, event => events.push(event));
  await assert.rejects(send({ path: '/commit', method: 'POST', body: { text: privateValue },
    credential: { id: privateValue, secret: privateValue } }), { code: 'uncertain' });
  assert.equal(calls, 1); assert.equal(events[0].operation, 'commit'); assert.equal(events[0].status, null);
  assert.equal(events[0].errorClass, 'network_error'); assert.equal(events[0].outcome, 'network_error');
  const invalid = evergreenHttpsTransport(async () => new Response(privateValue,
    { headers: { 'server-timing': 'authority;dur=1, secret=' + privateValue } }), event => events.push(event));
  assert.deepEqual(await invalid({ path: '/status' }), { status: 502, body: null });
  assert.equal(events[1].outcome, 'invalid_response'); assert.equal(events[1].serverDurationMs, undefined);
  assert.ok(!JSON.stringify(events).includes(privateValue));
});

test('one-shot measurement extends only the exact read-feed POST; writes, variants, subsequent calls and defaults stay bounded', async t => {
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', ms => { deadlines.push(ms); return new AbortController().signal; });
  const send = evergreenHttpsTransport(async () => new Response('{}'), () => {}, { diagnosticChangesOnce: true });
  for (const request of [
    { path: '/status' }, { path: '/capabilities' }, { path: '/changes' },
    { path: '/changes?diagnostic=1', method: 'POST' }, { path: '/changes', method: 'post' },
    ...['pair', 'exchange', 'quote', 'prepare', 'commit', 'rotate'].map(p => ({ path: '/' + p, method: 'POST' })),
    { path: '/changes', method: 'POST' }, { path: '/changes', method: 'POST' },
  ]) await send(request);
  assert.deepEqual(deadlines, [...Array(11).fill(15000), 45000, 15000]);
  const normal = evergreenHttpsTransport(async () => new Response('{}'), () => {}, { diagnosticChangesOnce: false });
  await normal({ path: '/changes', method: 'POST', deadlineMs: 45000 });
  assert.equal(deadlines.at(-1), 15000, 'Request fields cannot choose the deadline');
  const synthetic = evergreenSyntheticTransport({ fetcher: async () => new Response('{}', { headers: { 'x-evergreen-synthetic': 'true' } }) });
  await synthetic({ path: '/changes', method: 'POST' }); assert.equal(deadlines.at(-1), 15000);
});

test('failed measurement is consumed without replay and observer failure cannot expose private data or change recovery', async t => {
  const deadlines = [], events = []; let calls = 0;
  t.mock.method(AbortSignal, 'timeout', ms => { deadlines.push(ms); return new AbortController().signal; });
  const privateValue = 'PRIVATE-MEASUREMENT-CANARY';
  const send = evergreenHttpsTransport(async () => {
    calls++; throw Object.assign(new Error(privateValue), { name: 'TimeoutError' });
  }, event => { events.push(event); throw new Error(privateValue); }, { diagnosticChangesOnce: true });
  const request = { path: '/changes', method: 'POST', body: { cursor: privateValue }, credential: { id: privateValue, secret: privateValue } };
  await assert.rejects(send(request), { code: 'uncertain' }); assert.equal(calls, 1);
  assert.deepEqual(deadlines, [45000]);
  await assert.rejects(send(request), { code: 'uncertain' }); assert.equal(calls, 2);
  assert.deepEqual(deadlines, [45000, 15000]);
  assert.equal(events[0].errorClass, 'TimeoutError');
  assert.ok(!JSON.stringify(events).includes(privateValue));
});
