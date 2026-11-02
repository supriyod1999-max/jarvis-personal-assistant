import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { directory } from './helpers.mjs';
import { fastWhatsAppIntent, confirmsWhatsAppSend } from '../server/whatsapp-fast.mjs';
import { createWhatsApp } from '../server/whatsapp.mjs';
import { createWhatsAppAccounts } from '../server/whatsapp-accounts.mjs';
import { createWhatsAppAssistant } from '../server/whatsapp-assistant.mjs';

const configs = [{ sessionId: '11111111-1111-4111-8111-111111111111', label: 'Personal' }, { sessionId: '22222222-2222-4222-8222-222222222222', label: 'Personal Australia' }];
const available = configs.map(c => ({ id: c.sessionId, name: c.label }));
const id = '1234567890@c.us';
async function fixture(t) {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }), calls = [], prompts = [];
  let clock = Date.now(), failSend = false;
  const generate = async prompt => { prompts.push(prompt); throw new Error('The fast flow must not call a model'); };
  const accounts = createWhatsAppAccounts({ directory: path, generate, readConfig: async () => ({ accounts: configs }), createAccount: options => createWhatsApp({ ...options, transport: async (url, request) => {
    calls.push({ url, ...request, account: (await options.credentials()).sessionId });
    if (url.startsWith('/chats')) return [{ id, name: 'Alex' }];
    if (url === '/messages/send-text') { if (failSend) throw new Error('Unknown transport result'); return { messageId: 'accepted-id' }; }
    throw new Error('No chat history should be needed for dictated messages');
  } }) });
  const wa = await accounts.account(configs[1].sessionId); await wa.select({ id, enabled: true }); calls.length = 0;
  const options = { directory: path, accounts, generate, monitor: {}, now: () => clock };
  let assistant = createWhatsAppAssistant(options), afterTurnId = null;
  const conversationId = randomUUID();
  async function ask(message, overrides = {}) {
    const request = { id: randomUUID(), conversationId, afterTurnId, message, ...overrides };
    const handle = assistant.run(request, () => {}); assert.ok(handle);
    const result = await handle.done; afterTurnId = request.id; return { ...result, request };
  }
  t.after(() => { assistant.close(); accounts.close(); cleanup.forEach(fn => fn()); });
  return { ask, wa, calls, prompts, priority: request => assistant.runFollowup(request, () => {}), advance: ms => { clock += ms; }, fail: () => { failSend = true; }, restart: () => { assistant.close(); assistant = createWhatsAppAssistant(options); } };
}

test('fast parser preserves literal message and leaves uncertain instructions to the model', () => {
  assert.deepEqual(fastWhatsAppIntent('Message Alex from Personal Australia saying I’ll arrive at 7.', null, available), { action: 'prepare', contact: 'Alex', account: 'Personal Australia', text: 'I’ll arrive at 7.' });
  assert.equal(fastWhatsAppIntent('Text Alex: Did you say "send it"?', null, available).text, 'Did you say "send it"?');
  assert.equal(fastWhatsAppIntent('Send a message to Alex on Personal saying “I’m leaving now.”', null, available).text, 'I’m leaving now.');
  for (const text of ['Message Alex from Work saying Hi', 'Message Alex and Sam saying Hello', 'If Alex asks, send him a reply', 'Do not message Alex saying Hello']) assert.equal(fastWhatsAppIntent(text, null, available), null);
  for (const phrase of ['send it', 'Yes, send it.', 'Please send that message', 'Go ahead and send it']) assert.equal(confirmsWhatsAppSend(phrase), true);
  for (const phrase of ['yes', 'okay', 'do not send it', 'Alex said send it', 'send it to Sam', 'send it tomorrow', 'send it and change the recipient']) assert.equal(confirmsWhatsAppSend(phrase), false);
});

test('dictate, correct and confirm need zero model calls and one catalogue fetch; duplicate confirmation never resends', async t => {
  const f = await fixture(t);
  const first = await f.ask('Message Alex from Personal Australia saying I will arrive at seven.');
  assert.equal(first.timings.modelCalls, 0); assert.equal(first.action.text, 'I will arrive at seven.');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
  assert.match(first.text, /^To Alex on Personal Australia:/); assert.match(first.text, /Send it\?$/); assert.doesNotMatch(first.text, /code/);
  const changed = await f.ask('No, change it to I will arrive at eight.');
  assert.equal(changed.action.text, 'I will arrive at eight.'); assert.notEqual(changed.action.id, first.action.id);
  assert.equal(f.calls.length, 1); assert.equal(changed.timings.modelCalls, 0);
  assert.match((await f.ask(`approve send ${first.action.code}`)).text, /did not match/);
  assert.match((await f.ask('yes')).text, /Say “send it”/);
  const sent = await f.ask('Send it');
  assert.equal(sent.action.state, 'accepted'); assert.equal(sent.timings.modelCalls, 0);
  const sends = f.calls.filter(c => c.method === 'POST'); assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].body, { chatId: id, text: 'I will arrive at eight.', linkPreview: false }); assert.equal(sends[0].account, configs[1].sessionId);
  assert.match((await f.ask('send it')).text, /already sent/); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.prompts.length, 0);
  const followup = await f.ask('Reply saying Thanks!'); assert.equal(followup.action.accountId, configs[1].sessionId); assert.equal(f.calls.filter(c => c.url.startsWith('/chats')).length, 1);
});

test('account clarification stays local and does not silently default between numbers', async t => {
  const f = await fixture(t);
  assert.match((await f.ask('Text Alex saying Hello')).text, /Which WhatsApp account/); assert.equal(f.calls.length, 0);
  const review = await f.ask('Personal Australia'); assert.equal(review.action.accountId, configs[1].sessionId); assert.equal(f.prompts.length, 0);
  assert.match((await f.ask('cancel')).text, /Cancelled/);
  assert.match((await f.ask('send it')).text, /no current review/); assert.equal(f.calls.some(c => c.method === 'POST'), false);
});

test('natural send is bound to the current conversation, reviewed text, expiry and selected chat', async t => {
  const f = await fixture(t); const review = await f.ask('Text Alex from Personal Australia saying Hello');
  assert.match((await f.ask('send it', { conversationId: randomUUID(), afterTurnId: review.request.id })).text, /no current review/);
  assert.match((await f.ask('send it', { afterTurnId: randomUUID() })).text, /no current review/);
  // Resume the actual review using its precise turn ID; a stale/new thread cannot inherit it.
  f.advance(121000);
  const expired = await f.ask('send it', { afterTurnId: review.request.id }); assert.match(expired.text, /window has passed/);
  assert.equal(f.calls.some(c => c.method === 'POST'), false);
  f.restart(); assert.match((await f.ask('read it back')).text, /Hello.*Send it/);
  await f.wa.select({ id, enabled: false });
  await assert.rejects(f.ask('send it'), /Enable this chat/); assert.equal(f.calls.some(c => c.method === 'POST'), false);
});

test('ambiguous network outcome is never automatically retried by a repeated natural confirmation', async t => {
  const f = await fixture(t); f.fail();
  await f.ask('Text Alex from Personal Australia saying Hello');
  const uncertain = await f.ask('send it'); assert.equal(uncertain.action.state, 'unknown');
  assert.match((await f.ask('send it')).text, /still uncertain/); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('only current message corrections take priority over personal-memory edits', async t => {
  const f = await fixture(t), review = await f.ask('Message Alex from Personal Australia saying Hello');
  const request = { ...review.request, id: randomUUID(), afterTurnId: review.request.id };
  assert.equal(f.priority({ ...request, message: 'Change my project title to New project' }), null);
  assert.equal(f.priority({ ...request, message: 'Remember that I prefer tea' }), null);
  assert.equal(f.priority({ ...request, afterTurnId: randomUUID(), message: 'Change it to Goodbye' }), null);
  const changed = await f.priority({ ...request, message: 'Change it to Goodbye' }).done;
  assert.equal(changed.action.text, 'Goodbye'); assert.equal(f.calls.some(c => c.method === 'POST'), false);
});
