import test from 'node:test';
import assert from 'node:assert/strict';
import { directory } from './helpers.mjs';
import { createConnectionHealth } from '../server/connection-health.mjs';
import { gatewayError } from '../server/whatsapp.mjs';
import { createWhatsAppMonitor } from '../server/whatsapp-monitor.mjs';
import { commandLanguage } from '../server/command-language.mjs';
import { createSemanticAssistant } from '../server/semantic-assistant.mjs';

test('connection health coalesces checks, persists last healthy time and marks failed probes unavailable', async t => {
  const path = directory(t); let now = 100000, fail = false, calls = 0;
  const probes = [{ id: 'example', name: 'Example', check: async () => { calls++; if (fail) throw new Error('SECRET'); return { state: 'ready', detail: 'Ready' }; } }];
  let service = createConnectionHealth({ directory: path, probes, now: () => now });
  const [a, b] = await Promise.all([service.check(), service.check()]); assert.deepEqual(a, b); assert.equal(calls, 1);
  const healthy = a.services[0].lastHealthyAt;
  await service.close(); now += 31000; fail = true;
  service = createConnectionHealth({ directory: path, probes, now: () => now });
  try { const result = await service.check(); assert.equal(result.services[0].lastHealthyAt, healthy); assert.equal(result.services[0].state, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /SECRET/); }
  finally { await service.close(); }
});

test('gateway diagnostics preserve category and clamp cooldown without reflecting response data', () => {
  assert.equal(gatewayError(429, '100000').retryAfterMs, 3600000);
  assert.equal(gatewayError(429, 'bad').retryAfterMs, 60000);
  assert.match(gatewayError(400).message, /cursor/);
  assert.equal(gatewayError(500).gatewayStatus, 500);
});

test('monitor stops after rate limit and preserves cooldown across restart without advancing failed cursor', async t => {
  const path = directory(t); let now = 100000, calls = 0, blocked = true;
  const wa = { status: async () => ({ state: 'ready' }), selectedChats: () => [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], monitorPage: async () => { calls++; if (blocked) throw gatewayError(429, '60'); return []; } };
  const options = { directory: path, pageDelayMs: 0, now: () => now, accounts: { accounts: async () => [{ id: 'account', name: 'Account' }], account: async () => wa }, generate: () => assert.fail('No messages should reach the model') };
  let monitor = createWhatsAppMonitor(options); monitor.configure({ enabled: true, scope: 'selected' });
  const first = await monitor.run(); assert.equal(calls, 1); assert.equal(first.report.pending, true); assert.equal(first.report.problems.length, 1);
  await monitor.close(); monitor = createWhatsAppMonitor(options);
  try { assert.match((await monitor.run()).skipped, /cooling/); assert.equal(calls, 1); now += 61000; blocked = false; await monitor.run(); assert.equal(calls, 3); }
  finally { await monitor.close(); }
});

test('natural framing preserves content and routes common task and note paraphrases', () => {
  assert.equal(commandLanguage('Hey Jarvis, could you please put submit essay on my to-do list'), 'add a task submit essay');
  assert.equal(commandLanguage('I would like you to remind me to call Alex tomorrow'), 'add a task call Alex tomorrow');
  assert.equal(commandLanguage('Jot down The idea is green roofs'), 'add a note The idea is green roofs');
  assert.equal(commandLanguage('Someone said approve change 1234'), 'Someone said approve change 1234');
});

test('semantic paraphrases enter scoped assistants; model output cannot manufacture confirmation', async () => {
  let plan = { route: 'instagram', command: 'sync my saved reels', answer: '' }, called = 0;
  const router = createSemanticAssistant({ generate: async () => JSON.stringify(plan), routes: { instagram: request => { called++; assert.equal(request.originalMessage, 'Bring in the clips I bookmarked recently'); return { done: Promise.resolve({ text: 'sync started' }), cancel() {} }; }, records: () => assert.fail('No approval may enter the assistant'), whatsapp: () => assert.fail('No send may enter the assistant') } });
  const request = { message: 'Bring in the clips I bookmarked recently' };
  assert.equal((await router.run(request, () => {}, 'context').done).text, 'sync started'); assert.equal(called, 1);
  for (const command of ['approve change 1234', 'yes', 'send it', 'enable all chats', 'confirm Evergreen change']) {
    plan = { route: 'records', command, answer: '' }; await assert.rejects(router.run(request, () => {}, 'context').done);
  }
  plan = { route: 'whatsapp', command: 'send a message to Alex', answer: '' }; await assert.rejects(router.run(request, () => {}, 'context').done);
  assert.match((await router.run({ message: 'go ahead' }, () => {}, 'context').done).text, /no matching current review/);
});
