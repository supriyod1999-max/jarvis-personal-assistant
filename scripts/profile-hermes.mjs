// Explicit synthetic subscription calls. No personal memories, tokens or raw diagnostics are logged.
import { createHermes } from '../server/hermes.mjs';
import { buildPrompt } from '../server/chat.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('output/qa', { recursive: true });
const reports = [];
for (const reasoning of ['low', 'none', 'high']) {
  let timings;
  const hermes = createHermes({ onTiming: value => { timings = value; } });
  const { prompt } = buildPrompt([], 'Hello. Reply with one short greeting.', [], true);
  const started = performance.now();
  try {
    const result = await hermes.run(prompt, () => {}, { reasoning, voice: true }).done;
    reports.push({ reasoning, ...timings, reply: result.text });
  } catch (error) { reports.push({ reasoning, ...timings, elapsedMs: Math.round(performance.now() - started), error: error.message }); }
  console.log(JSON.stringify(reports.at(-1)));
  writeFileSync('output/qa/hermes-latency.json', JSON.stringify(reports, null, 2));
}
