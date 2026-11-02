// Read-only credentials: the app remains the sole owner of token rotation.
// Synthetic prompts only; does not create conversation records or retain tokens.
import { createChatGPTAuth } from '../server/chatgpt-auth.mjs';
import { createChatGPT } from '../server/chatgpt.mjs';
import { createHermes } from '../server/hermes.mjs';
import { buildPrompt } from '../server/chat.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const baseline = process.argv.includes('--baseline');
const auth = baseline ? null : createChatGPTAuth({ directory: resolve('data'), readOnly: true });
const reports = []; mkdirSync('output/qa', { recursive: true });
try {
  if (auth && (await auth.status()).state !== 'ready') throw new Error('Complete Second Brain ChatGPT sign-in first.');
  const routes = { direct: auth ? createChatGPT({ auth }) : null, hermes: createHermes() };
  const prompts = [
    ['low', 'Hello. Reply with one short greeting.'],
    ['low', 'Suggest one practical way to focus for the next twenty minutes. Reply in one sentence.'],
    ['low', 'What is an API? Explain it in one short sentence.'],
    ['high', 'I have 30 minutes, two ten-minute tasks, and a fifteen-minute call. Suggest a feasible sequence and state what must move. Keep it to two sentences.'],
  ];
  for (let index = 0; index < prompts.length; index++) {
    const [reasoning, message] = prompts[index]; const { prompt } = buildPrompt([], message, [], true);
    for (const route of baseline ? ['hermes'] : index % 2 ? ['hermes', 'direct'] : ['direct', 'hermes']) {
      const started = performance.now();
      try { const result = await routes[route].run(prompt, () => {}, { reasoning, voice: true }).done; reports.push({ route, reasoning, prompt: index + 1, ...result.timings, totalMs: Math.round(performance.now() - started), reply: result.text }); }
      catch (error) { reports.push({ route, reasoning, prompt: index + 1, totalMs: Math.round(performance.now() - started), error: error.message }); }
      console.log(JSON.stringify(reports.at(-1))); writeFileSync(`output/qa/${baseline ? 'hermes-baseline' : 'direct-latency'}.json`, JSON.stringify({ measuredAt: new Date().toISOString(), model: 'gpt-5.6-luna', reports }, null, 2));
    }
  }
} finally { await auth?.close(); }
