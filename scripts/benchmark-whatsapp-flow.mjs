// Local dispatch benchmark, using synthetic contacts and a transport with no network.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWhatsApp } from '../server/whatsapp.mjs';
import { createWhatsAppAccounts } from '../server/whatsapp-accounts.mjs';
import { createWhatsAppAssistant } from '../server/whatsapp-assistant.mjs';

const root = resolve('.test-data'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'whatsapp-speed-'));
let modelCalls = 0, catalogueReads = 0, syntheticSends = 0;
const generate = async () => { modelCalls++; throw new Error('Fast dictation must not need a model'); };
const accounts = createWhatsAppAccounts({ directory, generate, readConfig: async () => ({ accounts: [{ sessionId: '11111111-1111-4111-8111-111111111111', label: 'Personal' }] }), createAccount: options => createWhatsApp({ ...options, transport: async (path, input) => {
  if (path.startsWith('/chats')) { catalogueReads++; return [{ id: '1234567890@c.us', name: 'Alex' }]; }
  if (path === '/messages/send-text') { syntheticSends++; return { messageId: `synthetic-${syntheticSends}` }; }
  throw new Error(`Unexpected synthetic request: ${path}`);
} }) });
const assistant = createWhatsAppAssistant({ directory, accounts, generate, monitor: {} });
try {
  const wa = await accounts.account('11111111-1111-4111-8111-111111111111'); await wa.select({ id: '1234567890@c.us', enabled: true }); catalogueReads = 0;
  const samples = { prepare: [], edit: [], confirm: [] };
  let reviewText;
  for (let i = 0; i < 25; i++) {
    const conversationId = randomUUID(); let afterTurnId = null;
    for (const [stage, message] of [['prepare', 'Message Alex from Personal saying I’m leaving now.'], ['edit', 'Change it to I’ll be there in ten minutes.'], ['confirm', 'Send it']]) {
      const request = { id: randomUUID(), conversationId, afterTurnId, message }, start = performance.now();
      const result = await assistant.run(request, () => {}).done;
      samples[stage].push(performance.now() - start); afterTurnId = request.id;
      if (stage === 'prepare') reviewText = result.text;
      if (stage === 'confirm' && result.action?.state !== 'accepted') throw new Error('Synthetic send was not accepted');
    }
  }
  const oldReview = 'Here’s a reply you can review. From Personal, to Alex: I’m leaving now. Nothing has been sent. You can ask to change it or cancel. To send, say approve send followed by your code. Your code is 1 2 3 4.';
  const words = value => value.split(/\s+/).length;
  const report = { mode: 'Synthetic local dispatch; no real WhatsApp messages, AI calls, microphone or speech generation', rounds: 25, medianMs: Object.fromEntries(Object.entries(samples).map(([stage, values]) => [stage, Number(values.sort((a, b) => a - b)[12].toFixed(3))])), modelCalls, catalogueReads, syntheticSends, previousReviewWords: words(oldReview), newReviewWords: words(reviewText), reviewText, limitation: 'These timings exclude real OpenWA/network, transcription and Chatterbox latency; they are not end-to-end voice timings.' };
  mkdirSync('output/qa', { recursive: true }); writeFileSync('output/qa/whatsapp-fast-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  assistant.close(); accounts.close();
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe benchmark cleanup');
  rmSync(directory, { recursive: true, force: true });
}
