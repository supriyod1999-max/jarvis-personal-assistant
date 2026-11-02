import { createApplication } from '../server/index.mjs';
import { directory, entry, mutation } from '../tests/helpers.mjs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const cleanups = []; const data = directory({ after: fn => cleanups.push(fn) });
const app = createApplication({ port: 14322, directory: data });
app.listen(); await new Promise(r => app.server.once('listening', r));
const base = 'http://127.0.0.1:14322';
async function submit(request) {
  const response = await fetch(`${base}/api/chat/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(request) });
  assert.equal(response.status, 202);
  const controller = new AbortController(); let sawPartial = false;
  const stream = await fetch(`${base}/api/chat/events?id=${request.conversationId}`, { signal: controller.signal });
  const reader = stream.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const timer = setTimeout(() => controller.abort(), 160000);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) throw new Error('Stream ended early.');
      buffer += decoder.decode(value, { stream: true }); let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (!line.startsWith('data: ')) continue;
        const turn = JSON.parse(line.slice(6)).turns.find(t => t.id === request.id);
        if (turn.status === 'running' && turn.reply) sawPartial = true;
        if (turn.status !== 'running') { assert.equal(turn.status, 'complete', turn.error); return { turn, sawPartial }; }
      }
    }
  } finally { clearTimeout(timer); controller.abort(); }
}
try {
  const status = await (await fetch(`${base}/api/chat/status`)).json(); assert.equal(status.state, 'ready');
  const memory = app.store.mutate(mutation(app.store, entry({ kind: 'note', title: 'Integration test', body: 'The test colour is teal.' }))).record;
  const conversationId = randomUUID();
  const first = await submit({ id: randomUUID(), serverId: app.store.serverId, conversationId, afterTurnId: null, message: 'What is the test colour in the selected memory? Answer with just the colour.', sources: [{ id: memory.id, rev: memory.rev }] });
  assert.match(first.turn.reply, /teal/i);
  const second = await submit({ id: randomUUID(), serverId: app.store.serverId, conversationId, afterTurnId: first.turn.id, message: 'What colour did you just say? Answer with just the colour.', sources: [] });
  assert.match(second.turn.reply, /teal/i);
  console.log(JSON.stringify({ verified: true, model: status.model, realProvider: status.provider, selectedMemory: true, followUpContinuity: true, eventStream: true, partialReplyObserved: first.sawPartial || second.sawPartial, isolatedTestData: true }));
} finally { await app.close(); for (const cleanup of cleanups) cleanup(); }
