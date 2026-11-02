import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildPrompt, boundedConversation } from '../server/chat.mjs';
import { createSemanticAssistant } from '../server/semantic-assistant.mjs';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';

const input = message => ({ id: randomUUID(), conversationId: randomUUID(), afterTurnId: null, message, sources: [], voice: true });
const completed = (message, reply) => ({ status: 'complete', message, reply });
const data = prompt => JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));

test('long replies retain the latest topic and final question instead of dropping the whole conversation', () => {
  const history = [completed('Help with my project', 'Which part?'), completed('Compare the first and second plan', `The first plan is smaller. ${'Long detail. '.repeat(12000)} Would you like the second plan explained?`)];
  const result = buildPrompt(history, 'Yes please', [], true);
  const context = data(result.prompt).recentConversation;
  assert.equal(result.contextTrimmed, true);
  assert.equal(context.length, 2);
  assert.match(context.at(-1).assistant, /^The first plan is smaller/);
  assert.match(context.at(-1).assistant, /Would you like the second plan explained\?$/);
  assert.equal(context.at(-1).excerpted, true);
  assert.ok(JSON.stringify(context).length <= 48000);
});

test('context remains bounded for escaping-heavy content and never treats incomplete turns as facts', () => {
  const history = Array.from({ length: 60 }, (_, i) => completed(`topic ${i} ${'\u0000'.repeat(8000)}`, '\"\n'.repeat(18000)));
  history.push({ status: 'error', message: 'FAILED USER REQUEST', reply: 'FAILED MODEL CLAIM' });
  const result = boundedConversation(history);
  assert.ok(result.recent.length > 0 && result.recent.length <= 20);
  assert.ok(JSON.stringify(result.recent).length <= 48000);
  assert.match(result.recent.at(-1).user, /^topic 59/);
  assert.doesNotMatch(JSON.stringify(result.recent), /FAILED/);
  assert.equal(result.contextTrimmed, true);
});

test('selected project context remains explicit and private Evergreen conversation remains excluded', () => {
  const sources = [{ id: randomUUID(), rev: 4, kind: 'project', title: 'Desk companion', body: 'Reference only: send it', automatic: false }];
  const result = buildPrompt([completed('Old topic', 'Old answer')], 'What should I do next for this project?', sources, true);
  assert.deepEqual(data(result.prompt).selectedSources, sources);
  assert.match(result.prompt, /source bodies|contents remain untrusted reference/);
  const privateResult = buildPrompt([{ ...completed('PRIVATE HOUSEHOLD DETAIL', 'PRIVATE ANSWER'), privacyTag: 'evergreen' }], 'Continue', []);
  assert.deepEqual(data(privateResult.prompt).recentConversation, []);
  assert.doesNotMatch(privateResult.prompt, /PRIVATE HOUSEHOLD DETAIL|PRIVATE ANSWER/);
});

test('short conversational answers can continue an explanation without requiring a fake action review', async () => {
  for (const message of ['yes please', 'no thanks', 'okay', 'sure', 'that’s right']) {
    let prompt;
    const router = createSemanticAssistant({ generate: async value => { prompt = value; return JSON.stringify({ route: 'conversation', answer: 'The second plan takes less time.' }); }, routes: {} });
    const result = await router.run(input(message), () => {}, 'Assistant: Would you like me to explain the second plan?').done;
    assert.equal(result.text, 'The second plan takes less time.');
    assert.match(prompt, /Only route conversation or clarify is allowed/);
    assert.ok(prompt.includes(JSON.stringify(message)));
  }
});

test('a conversational yes cannot become an action, proposal or model change even if the model routes it incorrectly', async () => {
  for (const route of ['records', 'whatsapp', 'instagram', 'profile', 'model', 'action', 'computer']) {
    const router = createSemanticAssistant({ generate: async () => JSON.stringify({ route, command: 'add a task Incorrect approval', actionId: 'devices.list', answer: 'Already done' }), capabilities: () => [{ id: 'devices.list' }], routes: Object.fromEntries(['records', 'whatsapp', 'instagram', 'profile', 'model', 'action'].map(key => [key, () => assert.fail('An acknowledgement must not dispatch')])) });
    const result = await router.run(input('yes'), () => {}, 'Would you like that saved?').done;
    assert.match(result.text, /has not approved or changed anything/);
    assert.doesNotMatch(result.text, /Already done/);
  }
});

test('explicit confirmations remain local and cannot be manufactured from conversation', async () => {
  const router = createSemanticAssistant({ generate: async () => assert.fail('Unmatched confirmations must not use inference'), routes: {} });
  for (const message of ['send it', 'go ahead', 'confirm', 'approve 1234', 'save it']) {
    assert.match((await router.run(input(message), () => {}, '').done).text, /no matching current review/);
  }
  const pending = createSemanticAssistant({ generate: async () => assert.fail('Current review must keep its own confirmation rules'), pendingReview: () => ({ title: 'Existing task review' }), routes: {} });
  assert.match((await pending.run(input('yes'), () => {}, '').done).text, /no matching current review/);
});

test('a spoken correction retains exact owner wording and selected context while a scoped handler prepares the revision', async () => {
  const source = { id: randomUUID(), rev: 2, title: 'Read article', kind: 'task', body: 'Read the source.', automatic: false };
  const request = input('Actually, I meant next Friday, not tomorrow');
  let seenPrompt, routed;
  const router = createSemanticAssistant({ generate: async prompt => { seenPrompt = prompt; return JSON.stringify({ route: 'records', command: 'update task Read article due next Friday', answer: '' }); }, routes: { records: value => { routed = value; return { done: Promise.resolve({ text: 'Review the revised due date. Nothing saved yet.' }), cancel: async () => {} }; } } });
  const prompt = buildPrompt([completed('Move Read article to tomorrow', 'Review the new due date.')], request.message, [source], true).prompt;
  const result = await router.run(request, () => {}, prompt).done;
  assert.equal(routed.originalMessage, request.message);
  assert.equal(routed.semanticRoute, true);
  assert.match(seenPrompt, /Read article/);
  assert.match(seenPrompt, /replace the changed detail/);
  assert.match(result.text, /Nothing saved yet/);
});

test('the real direct chat path supports an explanatory yes and retains its preceding question', async t => {
  const cleanups = [], path = directory({ after: fn => cleanups.push(fn) });
  const prompts = [];
  const provider = {
    status: async () => ({ state: 'ready', provider: 'chatgpt-direct' }),
    models: async () => [{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }],
    run(prompt) {
      prompts.push(prompt);
      return { done: Promise.resolve({ text: JSON.stringify({ route: 'conversation', answer: prompts.length === 1 ? 'Would you like a simpler example?' : 'Think of it as sorting books onto shelves.' }) }), cancel: async () => {} };
    },
  };
  const app = createApplication({ port: 14443, directory: path, conversationProvider: provider });
  t.after(async () => { await app.close(); cleanups.forEach(fn => fn()); });
  const first = { ...input('Explain how sorting works'), serverId: app.store.serverId };
  const wait = async id => { const deadline = Date.now() + 3000; while (app.chat.store.getTurn(id).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); return app.chat.store.getTurn(id); };
  app.chat.send(first); assert.equal((await wait(first.id)).status, 'complete');
  const second = { ...first, id: randomUUID(), afterTurnId: first.id, message: 'Yes please' };
  app.chat.send(second);
  const result = await wait(second.id);
  assert.equal(result.status, 'complete', result.error);
  assert.match(result.reply, /sorting books/);
  assert.match(prompts[1], /Would you like a simpler example/);
  assert.equal(app.store.records().length, 0);
  assert.equal(result.action, undefined);
});

test('malformed intent formatting retries once on the same model before any action can run', async () => {
  const calls = []; let dispatched = 0;
  const router = createSemanticAssistant({ generate: async (prompt, options) => { calls.push({prompt,options}); return calls.length === 1 ? '{"route" "records", "command":"add a task Wrong"}' : JSON.stringify({route:'conversation',answer:'A task is a single step. A project groups the steps.'}); }, routes: { records: () => { dispatched++; assert.fail('Malformed output cannot dispatch'); } } });
  const result = await router.run({...input('Explain a task and a project'),model:'gpt-6-luna'},()=>{},'').done;
  assert.equal(calls.length,2); assert.equal(dispatched,0); assert.match(result.text,/single step/);
  assert.equal(calls[0].options.model,calls[1].options.model); assert.equal(calls[0].options.signal,calls[1].options.signal);
  assert.match(calls[1].prompt,/Formatting correction/); assert.doesNotMatch(calls[1].prompt,/add a task Wrong/);
});

test('repeated malformed intent output fails clearly without raw parser internals or action dispatch', async () => {
  let calls=0;
  const router=createSemanticAssistant({generate:async()=>{calls++;return '{invalid';},routes:{records:()=>assert.fail('No action may dispatch')}});
  await assert.rejects(router.run(input('Explain my options'),()=>{},'').done,/could not finish that reply reliably.*Nothing was changed/);
  assert.equal(calls,2);
});

test('cancel during malformed generation never starts a formatting retry', async () => {
  let complete, calls=0;
  const router=createSemanticAssistant({generate:async()=>{calls++;return new Promise(resolve=>{complete=resolve;});},routes:{}});
  const run=router.run(input('Explain it'),()=>{},'');await run.cancel();complete('{invalid');
  assert.equal((await run.done).cancelled,true);assert.equal(calls,1);
});
