import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemoryAssistant } from '../server/memory-assistant.mjs';
import { recallMemories, resolveContact } from '../server/memory-recall.mjs';
import { openStore } from '../server/store.mjs';
import { createChat } from '../server/chat.mjs';
import { validateRecord, parseBackup } from '../shared/model.mjs';
import { directory, entry, mutation } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';

const person = fields => entry({ kind: 'person', title: 'Example Partner', body: 'My girlfriend. Saved as Sunshine❤️ in WhatsApp.', aliases: ['Example', 'Sunshine❤️', 'my girlfriend'], relationship: 'girlfriend', recall: true, ...fields });
test('legacy items stay manual and new person fields survive validation and backup', () => {
  const old = entry(); assert.deepEqual(validateRecord(old), old);
  const record = person(); assert.deepEqual(parseBackup({ format: 'second-brain', version: 1, records: [record] }), [record]);
  assert.throws(() => validateRecord(person({ aliases: [''] })), /aliases/);
  assert.throws(() => validateRecord(person({ recall: 'yes' })), /recall/);
});

test('approved relationship aliases recall across conversations without sharing unapproved notes', () => {
  const p = person(), privateNote = entry({ title: 'Private girlfriend note', body: 'Never share this automatically.' });
  const memories = [p, privateNote];
  assert.deepEqual(recallMemories(memories, "What is my girlfriend's name?"), [p]);
  assert.deepEqual(recallMemories(memories, 'What does she prefer?', [{ status: 'complete', message: 'Tell me about Example Partner.' }]), [p]);
  assert.deepEqual(recallMemories([person({ recall: false })], 'Who is my girlfriend?'), []);
  assert.deepEqual(recallMemories([person({ deleted: true })], 'Who is my girlfriend?'), []);
  assert.deepEqual(recallMemories([person({ status: 'archived' })], 'Who is my girlfriend?'), []);
});

test('person aliases resolve the real chat but collisions and revoked memories fail safely', () => {
  const p = person(), chat = { id: '1234567890@c.us', name: 'Sunshine❤️' };
  for (const name of ['Example Partner', 'Example', 'my girlfriend', 'girlfriend']) assert.deepEqual(resolveContact([p], name, [chat]).matches, [chat]);
  assert.equal(resolveContact([p, person({ title: 'Another Person' })], 'my girlfriend', [chat]).ambiguousPeople, true);
  assert.equal(resolveContact([p], 'Example', [chat, { id: '1111111111@c.us', name: 'Example' }]).matches.length, 2);
  assert.equal(resolveContact([{ ...p, recall: false }], 'my girlfriend', [chat]).matches.length, 0);
});

test('reviewed WhatsApp contact mapping wins over real-name chats without unsafe fallback', () => {
  const p = person({ whatsappName: 'Sunshine ❤️' });
  const chat = { id: '1234567890@c.us', name: 'Sunshine ❤️' };
  const other = { id: '1111111111@c.us', name: 'Example Partner' };
  assert.deepEqual(resolveContact([p], 'Example Partner', [other, chat]).matches, [chat]);
  assert.deepEqual(resolveContact([p], 'my girlfriend', [other]).matches, []);
  assert.equal(resolveContact([p], 'Example', [chat, { ...chat, id: '2222222222@c.us' }]).matches.length, 2);
  assert.deepEqual(resolveContact([p], 'Example', [{ ...chat, name: 'Sunshine 💔' }]).matches, []);
  assert.equal(validateRecord(p).whatsappName, p.whatsappName);
});

test('remember commands propose, coded approval persists once, restart recall uses the stored source', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }); let records = openStore(path);
  let memory = createMemoryAssistant({ directory: path, records, generate: async () => JSON.stringify({ kind: 'person', title: 'Example Partner', relationship: 'girlfriend', aliases: ['Example', 'Sunshine❤️', 'my girlfriend'] }) });
  const conversationId = randomUUID(), id = randomUUID(), original = 'My girlfriend is Example Partner, saved as Sunshine❤️.';
  const review = await memory.run({ id, conversationId, afterTurnId: null, message: `Remember that ${original}` }, () => {}).done;
  assert.equal(records.records().length, 0); assert.match(review.text, /Nothing saved yet/);
  const pending = memory.list()[0]; assert.equal(pending.record.body, original);
  assert.throws(() => memory.approve({ id: pending.id }), /approve/);
  const approved = await memory.run({ id: randomUUID(), conversationId, afterTurnId: id, message: `approve memory ${pending.code}` }, () => {}).done;
  assert.match(approved.text, /Remembered/); memory.approve({ id: pending.id, approved: true }); assert.equal(records.records().length, 1);
  memory.close(); records.close(); records = openStore(path);
  memory = createMemoryAssistant({ directory: path, records, generate: async () => { throw new Error('No extraction needed'); } });
  let prompt; const fake = fixtureHermes(); const chat = createChat({ directory: path, records, serverId: records.serverId, hermes: { ...fake, run: (p, cb, o) => { prompt = p; return fake.run(p, cb, o); } } });
  const request = { id: randomUUID(), serverId: records.serverId, conversationId: randomUUID(), afterTurnId: null, message: 'Who is my girlfriend?', sources: [] };
  chat.send(request); assert.match(prompt, /Example Partner/); assert.equal(chat.store.getTurn(request.id).sources[0].automatic, true);
  await chat.close(); memory.close(); records.close(); cleanup.forEach(fn => fn());
});

test('changed record revisions and cancelled or wrong-context approvals cannot save', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }), records = openStore(path);
  const memory = createMemoryAssistant({ directory: path, records, generate: async () => '' });
  t.after(() => { memory.close(); records.close(); cleanup.forEach(fn => fn()); });
  const saved = records.mutate(mutation(records, person())).record;
  const review = memory.prepare({ record: { ...saved, body: 'New data' }, baseRev: saved.rev, conversationId: randomUUID(), turnId: randomUUID() });
  const bad = await memory.run({ id: randomUUID(), conversationId: randomUUID(), afterTurnId: review.turnId, message: `approve memory ${review.code}` }, () => {}).done;
  assert.match(bad.text, /no current memory/);
  records.mutate(mutation(records, { ...saved, body: 'Changed elsewhere' }, saved.rev));
  assert.throws(() => memory.approve({ id: review.id, approved: true }), /another device/);
  const next = memory.prepare({ record: person(), baseRev: 0 }); memory.cancel({ id: next.id });
  assert.throws(() => memory.approve({ id: next.id, approved: true }), /cancelled/);
});
