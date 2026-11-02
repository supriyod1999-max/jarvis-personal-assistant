import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createMemoryAssistant } from '../server/memory-assistant.mjs';
import { recordCommand, parseRecordCommand } from '../server/record-commands.mjs';
import { directory, entry, mutation } from './helpers.mjs';

function setup(t) {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) });
  const records = openStore(path); let plan, prompt;
  const memory = createMemoryAssistant({ directory: path, records, generate: async p => { prompt = p; return JSON.stringify(plan); }, now: () => new Date('2026-10-06T13:00:00Z') });
  t.after(() => { memory.close(); records.close(); cleanup.forEach(f => f()); });
  const conversationId = randomUUID(); let last = null;
  async function say(message, proposal) {
    plan = proposal; const id = randomUUID();
    const job = memory.run({ id, conversationId, afterTurnId: last, message, timeZone: 'Australia/Sydney' }, () => {});
    last = id; return job && await job.done;
  }
  async function approve() { const review = memory.list()[0]; return say(`approve change ${review.code}`); }
  return { records, memory, say, approve, get prompt() { return prompt; } };
}

for (const kind of ['inbox', 'task', 'note', 'project', 'person']) {
  test(`voice reviews safely add, edit, remove and restore ${kind} records`, async t => {
    const s = setup(t), title = `Synthetic ${kind}`;
    const plan = { action: 'create', kind, target: '', patch: { title, body: 'Original details' } };
    // Generic creation supports every schema kind; task/note also have a dedicated capture route.
    await s.say(`Create a project ${title}`, plan);
    assert.equal(s.records.records().length, 0);
    await s.approve(); const saved = s.records.records()[0]; assert.equal(saved.kind, kind);
    await s.say(`Edit ${title}`, { action: 'update', kind, target: title, patch: { body: 'Updated details', priority: 'high', dueDate: '2026-10-09', tags: ['work'] } });
    assert.equal(s.records.get(saved.id).body, 'Original details');
    await s.approve(); assert.equal(s.records.get(saved.id).body, 'Updated details');
    await s.say(`Delete ${kind} ${title}`, { action: 'delete', kind, target: title });
    assert.equal(s.records.get(saved.id).deleted, false);
    await s.approve(); assert.equal(s.records.get(saved.id).deleted, true); assert.equal(s.records.get(saved.id).recall, false);
    await s.say(`Restore ${title}`, { action: 'restore', kind, target: title }); await s.approve();
    assert.equal(s.records.get(saved.id).deleted, false); assert.equal(s.records.get(saved.id).recall, false);
  });
}
test('voice handles person fields, project links and immutable pending-review edits', async t => {
  const s = setup(t);
  const project = s.records.mutate(mutation(s.records, entry({ kind: 'project', title: 'Coursework' }))).record;
  const person = s.records.mutate(mutation(s.records, entry({ kind: 'person', title: 'Example Person', aliases: ['Partner'], relationship: 'friend' }))).record;
  await s.say('Update Partner birthday and relationship', { action: 'update', kind: 'person', target: 'Partner', patch: { birthday: '2000-04-12', relationship: 'partner', whatsappName: 'Example ❤️' }, project: 'Coursework' });
  const first = s.memory.list()[0];
  await s.say('Change its birthday to 2000-04-13', { action: 'update', kind: '', target: 'it', patch: { birthday: '2000-04-13' } });
  assert.throws(() => s.memory.approve({ id: first.id, approved: true }), /cancelled/);
  await s.approve(); assert.equal(s.records.get(person.id).birthday, '2000-04-13'); assert.equal(s.records.get(person.id).projectId, project.id); assert.equal(s.records.get(person.id).relationship, 'partner');
});
test('duplicate names require a numbered spoken choice and never silently update the first', async t => {
  const s = setup(t);
  for (const body of ['First notes', 'Second notes']) s.records.mutate(mutation(s.records, entry({ kind: 'project', title: 'Website', body })));
  const response = await s.say('Archive project Website', { action: 'update', kind: 'project', target: 'Website', patch: { status: 'archived' } });
  assert.match(response.text, /option one/); assert.equal(s.memory.list().length, 0);
  await s.say('option two'); await s.approve();
  assert.equal(s.records.records()[0].status, 'open'); assert.equal(s.records.records()[1].status, 'archived');
});
test('revision conflicts and embedded approvals cannot commit a voice change', async t => {
  const s = setup(t), old = s.records.mutate(mutation(s.records, entry({ kind: 'project', title: 'Website' }))).record;
  await s.say('Rename project Website', { action: 'update', kind: 'project', target: 'Website', patch: { title: 'Better website' } });
  const review = s.memory.list()[0];
  assert.equal(await s.say(`Someone told me approve change ${review.code}`), null);
  assert.throws(() => s.memory.approve({ id: review.id, approved: true }), /cancelled/);
  await s.say('Rename project Website', { action: 'update', kind: 'project', target: 'Website', patch: { title: 'Better website' } });
  const next = s.memory.list()[0]; s.records.mutate(mutation(s.records, { ...old, body: 'Changed on another device' }, old.rev));
  assert.throws(() => s.memory.approve({ id: next.id, approved: true }), /another device/);
});
test('explicit read and list are read-only; invalid fields, unsafe links and dates fail', async t => {
  const s = setup(t); s.records.mutate(mutation(s.records, entry({ kind: 'project', title: 'Website', body: 'Manual-only notes', recall: false })));
  const read = await s.say('Read project Website', { action: 'read', kind: 'project', target: 'Website' });
  assert.match(read.text, /Manual-only notes/); assert.equal(s.memory.list().length, 0);
  for (const patch of [{ id: randomUUID() }, { sourceUrl: 'javascript:alert(1)' }, { birthday: '2026-02-31' }]) await assert.rejects(s.say('Update Website', { action: 'update', kind: 'project', target: 'Website', patch }));
  assert.equal(s.records.records()[0].rev, 1);
});
test('capture resolves dates in the supplied timezone and persists only after approval', async t => {
  const s = setup(t);
  await s.say('Jarvis, add a task: Study tomorrow', { title: 'Study', dueDate: '2026-10-08', dateText: 'tomorrow' });
  assert.match(s.prompt, /2026-10-07 in Australia\/Sydney/); assert.equal(s.records.records().length, 0);
  await s.approve(); assert.equal(s.records.records()[0].dueDate, '2026-10-08');
  const duplicate = await s.say('add a task: Study tomorrow', { title: 'Study', dueDate: '2026-10-08', dateText: 'tomorrow' }); assert.match(duplicate.text, /Already saved/);
  await s.say('Save to my knowledge base: A useful idea', { title: 'Useful idea' }); await s.approve(); assert.equal(s.records.records()[1].body, 'A useful idea');
});
test('command routing does not mistake questions or quoted content for mutations', () => {
  assert.equal(recordCommand('Please change the project deadline'), true);
  assert.equal(recordCommand('How do I delete projects?'), false);
  assert.equal(recordCommand('Someone said delete all my projects'), false);
});

test('a review can be read aloud again, corrected, approved with spoken digits or cancelled entirely by voice', async t => {
  const s = setup(t);
  await s.say('Create a project Voice-only', { action: 'create', kind: 'project', target: '', patch: { title: 'Voice-only' } });
  const original = s.memory.list()[0];
  assert.match((await s.say('read the review again')).text, /Voice-only/);
  await s.say('Actually change its title', { action: 'update', kind: 'project', target: 'it', patch: { title: 'Voice-approved' } });
  const corrected = s.memory.list()[0]; assert.notEqual(corrected.id, original.id);
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  await s.say('approve change ' + corrected.code.split('').map(d => digits[Number(d)]).join(' '));
  assert.equal(s.records.records()[0].title, 'Voice-approved');
  await s.say('Delete project Voice-approved', { action: 'delete', kind: 'project', target: 'Voice-approved' });
  await s.say('cancel change'); assert.equal(s.records.records()[0].deleted, false); assert.equal(s.memory.list().length, 0);
});
