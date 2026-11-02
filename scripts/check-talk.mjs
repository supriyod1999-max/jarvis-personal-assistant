// Explicit synthetic integration check; uses an isolated store and real local providers.
import { createApplication } from '../server/index.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createChatGPTAuth } from '../server/chatgpt-auth.mjs';
import { createChatGPT } from '../server/chatgpt.mjs';
const root = resolve('.test-data'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'talk-check-'));
const auth = createChatGPTAuth({ directory: resolve('data'), readOnly: true });
const app = createApplication({ port: 14335, directory, privateAccess: null, hermes: createChatGPT({ auth }) });
const base = 'http://127.0.0.1:14335/api';
async function request(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text()); return response;
}
const report = { provider: 'chatgpt-direct', model: 'gpt-5.6-luna', reasoning: 'low' };
try {
  app.listen(); await once(app.server, 'listening');
  let started = performance.now(); await request('/voice/warm', {}); report.warmSeconds = (performance.now() - started) / 1000;
  started = performance.now(); const { text } = await (await request('/voice/transcribe', { wav: readFileSync('output/qa/talk-input.wav').toString('base64') })).json();
  report.transcriptionSeconds = (performance.now() - started) / 1000; report.transcript = text;
  const state = await (await request('/state')).json(); const conversationId = randomUUID();
  started = performance.now();
  await request('/chat/send', { id: randomUUID(), serverId: state.serverId, conversationId, afterTurnId: null, message: text, sources: [], voice: true });
  let reply;
  while (performance.now() - started < 120000) {
    const conversation = await (await request('/chat/conversation?id=' + conversationId)).json(); const turn = conversation.turns[0];
    if (turn.reply && !report.firstTextSeconds) report.firstTextSeconds = (performance.now() - started) / 1000;
    if (turn.status !== 'running') { if (turn.status !== 'complete') throw new Error(turn.error || turn.status); reply = turn.reply; break; }
    await new Promise(done => setTimeout(done, 350));
  }
  if (!reply) throw new Error('Reply did not finish.'); report.replySeconds = (performance.now() - started) / 1000; report.reply = reply;
  started = performance.now(); const wav = Buffer.from(await (await request('/voice/speak', { text: reply.slice(0, 280) })).arrayBuffer());
  report.speechSeconds = (performance.now() - started) / 1000; report.wavBytes = wav.length;
  writeFileSync('output/qa/talk-direct-e2e.wav', wav); writeFileSync('output/qa/talk-direct-e2e.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await app.close();
  await auth.close();
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  rmSync(directory, { recursive: true, force: true });
}
