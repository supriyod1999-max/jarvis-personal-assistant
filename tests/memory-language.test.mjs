import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { memoryIntent, simpleYes, simpleNo } from '../server/memory-language.mjs';
import { createMemoryAssistant } from '../server/memory-assistant.mjs';
import { openStore } from '../server/store.mjs';
import { directory } from './helpers.mjs';
const note = content => ({ kind: 'note', title: 'Coffee preference', relationship: '', aliases: [], content, evidence: [content] });
test('natural memory cues support direct facts and contextual references without mistaking recall questions or quoted approvals', () => {
  for (const message of ['Keep that in mind','Please save that','Could you make a note of this?','I want you to remember that','Remember what I just said']) assert.equal(memoryIntent(message)?.contextual, true, message);
  for (const message of ['Could you remember that I prefer black coffee','I prefer black coffee, keep that in mind.','Please make a note that I prefer black coffee']) assert.equal(memoryIntent(message).content, 'I prefer black coffee');
  for (const message of ['Do you remember my birthday?', 'Can you remember where I live?', 'I remember the holiday', 'She said remember that', 'Translate "remember that"']) assert.equal(memoryIntent(message), null, message);
  assert.equal(simpleYes('yes please'), true); assert.equal(simpleNo('no thanks'), true);
  for (const value of ['she said yes', 'yes but change the date', '"yes"', 'the message says confirm']) assert.equal(simpleYes(value), false);
});
test('contextual memory reads back owner facts and saves only on an immediate yes, with correction and cancellation', async t => {
  const cleanup = [], root = directory({ after: fn => cleanup.push(fn) }), records = openStore(root);
  let history = [{ status: 'complete', message: 'I prefer black coffee', reply: 'Would you like recommendations?' }], prompts = [];
  const memory = createMemoryAssistant({ directory: root, records, history: () => history, generate: async prompt => { const input = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)); prompts.push(input); return JSON.stringify(input.pending ? { ...note('I prefer tea'), evidence: ['Actually, I prefer tea'] } : note('I prefer black coffee')); } });
  t.after(() => { memory.close(); records.close(); cleanup.forEach(fn => fn()); });
  const conversationId = randomUUID(); let afterTurnId = null;
  async function say(message) { const id = randomUUID(), job = memory.run({ id, conversationId, afterTurnId, message }, () => {}); if (!job) return null; const result = await job.done; afterTurnId = id; history.push({ status: 'complete', message, reply: result.text }); return result; }
  assert.match((await say('Keep that in mind')).text, /I prefer black coffee/); assert.equal(records.records().length, 0); assert.equal(prompts[0].context[0].user, 'I prefer black coffee');
  assert.match((await say('Actually, I prefer tea')).text, /I prefer tea/); assert.equal(records.records().length, 0);
  assert.match((await say('yes please')).text, /Remembered/); assert.equal(records.records()[0].body, 'I prefer tea');
  assert.equal(await say('yes'), null); assert.equal(records.records().length, 1);
  await say('Remember I prefer black coffee'); assert.match((await say('no')).text, /Nothing was saved/); assert.equal(records.records()[0].body, 'I prefer tea');
});
test('yes cannot approve across conversations, after unrelated turns, or when the source revision changed', async t => {
  const cleanup = [], root = directory({ after: fn => cleanup.push(fn) }), records = openStore(root);
  const memory = createMemoryAssistant({ directory: root, records, generate: async () => JSON.stringify(note('I prefer tea')) });
  t.after(() => { memory.close(); records.close(); cleanup.forEach(fn => fn()); });
  const conversationId = randomUUID(), id = randomUUID(); await memory.run({ id, conversationId, afterTurnId: null, message: 'Remember I prefer tea' }, () => {}).done;
  assert.equal(memory.run({ id: randomUUID(), conversationId: randomUUID(), afterTurnId: id, message: 'yes' }, () => {}), null); assert.equal(records.records().length, 0);
  assert.equal(memory.run({ id: randomUUID(), conversationId, afterTurnId: id, message: 'What is the weather?' }, () => {}), null);
  assert.equal(memory.run({ id: randomUUID(), conversationId, afterTurnId: id, message: 'yes' }, () => {}), null); assert.equal(records.records().length, 0);
});
test('clarification can be answered naturally without repeating a remember command', async t => {
  const cleanup = [], root = directory({ after: fn => cleanup.push(fn) }), records = openStore(root);
  let history = [], calls = 0;
  const memory = createMemoryAssistant({ directory: root, records, history: () => history, generate: async () => { calls++; return JSON.stringify({ ...note('I prefer tea'), evidence: ['I prefer tea'] }); } });
  t.after(() => { memory.close(); records.close(); cleanup.forEach(fn => fn()); });
  const conversationId = randomUUID(), id = randomUUID();
  const question = await memory.run({ id, conversationId, afterTurnId: null, message: 'Keep that in mind' }, () => {}).done;
  assert.match(question.text, /What would you like/); assert.equal(calls, 0);
  history = [{ status: 'complete', message: 'Keep that in mind', reply: question.text }];
  const answerId = randomUUID(), proposal = await memory.run({ id: answerId, conversationId, afterTurnId: id, message: 'I prefer tea' }, () => {}).done;
  assert.match(proposal.text, /Shall I save/); assert.equal(records.records().length, 0);
  await memory.run({ id: randomUUID(), conversationId, afterTurnId: answerId, message: 'yes' }, () => {}).done; assert.equal(records.records()[0].body, 'I prefer tea');
});
