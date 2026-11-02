import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { openChatStore } from '../server/chat-store.mjs';
import { createChat, buildPrompt } from '../server/chat.mjs';
import { createApplication } from '../server/index.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
import { directory, entry, mutation } from './helpers.mjs';

function request(store, fields = {}) { return { id: randomUUID(), serverId: store.serverId, conversationId: randomUUID(), afterTurnId: null, message: 'Help me plan.', sources: [], ...fields }; }
async function settled(chat, id) {
  for (let i = 0; i < 100; i++) { const turn = chat.store.getTurn(id); if (turn.status !== 'running') return turn; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('Test turn did not settle.');
}

test('chat receipts survive restart, sources are explicit snapshots, and stale context is rejected', async t => {
  const path = directory(t); const records = openStore(path); let calls = 0; let sentPrompt = '';
  const fake = fixtureHermes(); const hermes = { ...fake, run: (prompt, onText) => { calls++; sentPrompt = prompt; return fake.run(prompt, onText); } };
  const chat = createChat({ directory: path, records, serverId: records.serverId, hermes });
  const saved = records.mutate(mutation(records, entry({ title: 'Chosen memory', body: 'My selected notes.' }))).record;
  records.mutate(mutation(records, entry({ title: 'Private unselected item', body: 'Never automatically share me.' })));
  const input = request(records, { sources: [{ id: saved.id, rev: saved.rev }] });
  chat.send(input); chat.send(input);
  assert.equal(calls, 1);
  assert.throws(() => chat.send({ ...input, message: 'changed' }), /different request/);
  assert.throws(() => chat.send(request(records)), /already running/);
  const completed = await settled(chat, input.id);
  assert.equal(completed.status, 'complete'); assert.equal(completed.sources[0].body, saved.body);
  assert.ok(sentPrompt.includes('My selected notes.')); assert.ok(!sentPrompt.includes('Never automatically share me.'));
  assert.throws(() => chat.send(request(records, { conversationId: input.conversationId })), /changed in another tab/);
  records.mutate(mutation(records, { ...saved, body: 'new revision' }, saved.rev));
  assert.throws(() => chat.send(request(records, { sources: [{ id: saved.id, rev: saved.rev }] })), /selected item changed/);
  await chat.close();
  const reopened = createChat({ directory: path, records, serverId: records.serverId, hermes });
  assert.deepEqual(reopened.send(input), completed); assert.equal(calls, 1);
  assert.equal(reopened.store.exportData().conversations.length, 1);
  await reopened.close(); records.close();
});

test('cancellation and provider errors preserve drafts and partial text without automatic retry', async t => {
  const path = directory(t); const records = openStore(path); const chat = createChat({ directory: path, records, serverId: records.serverId, hermes: fixtureHermes() });
  try {
    const first = request(records, { message: 'TEST_SLOW' }); chat.send(first);
    await chat.cancel({ id: first.id, serverId: records.serverId });
    assert.equal(chat.store.getTurn(first.id).status, 'cancelled'); assert.match(chat.store.getTurn(first.id).reply, /Thinking/);
    const next = request(records, { message: 'TEST_ERROR' }); chat.send(next);
    const failed = await settled(chat, next.id); assert.equal(failed.status, 'error'); assert.match(failed.error, /temporarily unavailable/);
    assert.equal(chat.send(next).status, 'error');
  } finally { await chat.close(); records.close(); }
});

test('voice style is per request and receipts distinguish Talk while preserving legacy retries', async t => {
  const path = directory(t); const records = openStore(path); const calls = [];
  const fake = fixtureHermes();
  const hermes = { ...fake, run: (prompt, onText, options) => { calls.push({ prompt, options }); return fake.run(prompt, onText); } };
  const chat = createChat({ directory: path, records, serverId: records.serverId, hermes });
  try {
    const plain = request(records); chat.send(plain); await settled(chat, plain.id);
    chat.send({ ...plain, voice: false }); assert.equal(calls.length, 1);
    assert.throws(() => chat.send({ ...plain, voice: true }), /different request/);
    const spoken = request(records, { voice: true }); chat.send(spoken); await settled(chat, spoken.id);
    assert.equal(calls[0].options.voice, false); assert.ok(!calls[0].prompt.includes('This is a spoken conversation'));
    assert.equal(calls[1].options.voice, true); assert.ok(calls[1].prompt.includes('This is a spoken conversation'));
    chat.send(spoken); assert.equal(calls.length, 2);
    assert.throws(() => chat.send({ ...spoken, voice: false }), /different request/);
    assert.throws(() => chat.send(request(records, { voice: 'yes' })), /Invalid conversation mode/);
  } finally { await chat.close(); records.close(); }
});

test('an unfinished chat becomes interrupted on boot and bounded history is disclosed', t => {
  const path = directory(t); let store = openChatStore(path); const input = request({ serverId: randomUUID() });
  store.start(input, [], false); store.update(input.id, { reply: 'Partial reply.' }); store.close();
  store = openChatStore(path);
  assert.equal(store.getTurn(input.id).status, 'interrupted'); assert.equal(store.getTurn(input.id).reply, 'Partial reply.'); store.close();
  const history = Array.from({ length: 25 }, (_, i) => ({ status: 'complete', message: `message ${i}`, reply: 'Reply.' }));
  const result = buildPrompt(history, 'Current question', []);
  assert.equal(result.contextTrimmed, true); assert.ok(!result.prompt.includes('"message 0"')); assert.ok(result.prompt.includes('"message 24"'));
});

test('Quick and Deep are per-turn, retries preserve effort, and measured timing is saved', async t => {
  const path = directory(t), records = openStore(path), efforts = [];
  const fake = fixtureHermes();
  const chat = createChat({ directory: path, records, serverId: records.serverId, hermes: { ...fake, run: (prompt, text, options) => {
    efforts.push(options.reasoning); const handle = fake.run(prompt, text); return { ...handle, done: handle.done.then(result => ({ ...result, provider: 'chatgpt-direct', timings: { firstTextMs: 123 } })) };
  } } });
  try {
    const quick = request(records); chat.send(quick); await settled(chat, quick.id);
    const deep = request(records, { reasoning: 'high' }); chat.send(deep); const result = await settled(chat, deep.id);
    chat.send(deep); assert.deepEqual(efforts, ['low', 'high']); assert.equal(result.timings.firstTextMs, 123); assert.equal(result.reasoning, 'high');
    assert.throws(() => chat.send({ ...deep, reasoning: 'low' }), /different request/);
    assert.throws(() => chat.send(request(records, { reasoning: 'ultra' })), /Quick or Deep/);
  } finally { await chat.close(); records.close(); }
});

test('chat HTTP boundary, reconnect snapshots, and cancellation work through the real API', async t => {
  const path = directory(t); const app = createApplication({ port: 14321, directory: path, hermes: fixtureHermes() });
  app.listen(); await new Promise(r => app.server.once('listening', r));
  const base = 'http://127.0.0.1:14321';
  const post = (route, body, headers = {}) => fetch(`${base}/api/chat/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1', ...headers }, body: JSON.stringify(body) });
  try {
    const input = request(app.store, { message: 'TEST_SLOW' });
    assert.equal((await post('send', input, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post('send', input, { 'X-Second-Brain': '' })).status, 403);
    assert.equal((await post('send', { ...input, serverId: randomUUID() })).status, 400);
    assert.equal((await post('send', input)).status, 202);
    const controller = new AbortController();
    const response = await fetch(`${base}/api/chat/events?id=${input.conversationId}`, { signal: controller.signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes(input.id)); controller.abort();
    // Disconnecting the browser preserves the run, so a reopened tab can reconnect.
    assert.equal(app.chat.store.getTurn(input.id).status, 'running');
    assert.equal((await post('cancel', { id: input.id, serverId: app.store.serverId })).status, 200);
    const snapshot = await (await fetch(`${base}/api/chat/conversation?id=${input.conversationId}`)).json();
    assert.equal(snapshot.turns[0].status, 'cancelled');
  } finally { await app.close(); }
});
