import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { directory } from './helpers.mjs';
import { createWhatsAppAssistant } from '../server/whatsapp-assistant.mjs';

test('a synced owner reply removes a stale saved update before the voice briefing is generated', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) });
  let alerts = [{ id: 'a', accountId: 'personal', accountName: 'Personal', chatId: '1234567890@c.us', chatName: 'Friend', messageId: 'm', summary: 'A question', excerpt: 'Have you started?' }];
  const rows = [{ id: 'out', fromMe: true, status: 'sent', body: 'Yes', timestamp: 123 }];
  const assistant = createWhatsAppAssistant({ directory: path,
    accounts: { accounts: async () => [{ id: 'personal', name: 'Personal' }], account: async () => ({ selectedChats: () => [{ id: '1234567890@c.us' }], messages: async () => rows }) },
    monitor: { state: () => ({ alerts, settings: { enabled: true } }), observeReplies: (account, chat, history) => { assert.equal(account, 'personal'); assert.equal(chat, '1234567890@c.us'); assert.equal(history, rows); alerts = []; } },
    generate: async prompt => { assert.ok(prompt.startsWith('JARVIS_WHATSAPP_INTENT:')); return JSON.stringify({ action: 'digest' }); } });
  t.after(() => { assistant.close(); cleanup.forEach(fn => fn()); });
  const result = await assistant.run({ id: randomUUID(), conversationId: randomUUID(), afterTurnId: null, message: 'WhatsApp updates' }, () => {}).done;
  assert.match(result.text, /no flagged messages/); assert.doesNotMatch(result.text, /Have you started/);
});

test('a named briefing follow-up binds the exact chat and account without requiring the model to supply a ref', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }), account = { id: 'account-a', name: 'Personal' }, other = { id: 'account-b', name: 'Personal Australia' };
  const intents = [{ action: 'digest' }, { action: 'read', contact: 'Alex' }];
  let reads = 0;
  const wa = { selectedChats: () => [{ id: '1234567890@c.us', name: 'Alex' }], chats: async () => [{ id: '1234567890@c.us', name: 'Alex', selected: true }], messages: async () => [], readContext: async () => { reads++; return [{ id: 'm', body: 'Hello', speaker: 'Alex', fromMe: false }]; } };
  const assistant = createWhatsAppAssistant({ directory: path, accounts: { accounts: async () => [account, other], account: async id => { assert.equal(id, account.id); return wa; } }, monitor: { state: () => ({ settings: { enabled: true }, alerts: [{ id: 'alert', accountId: account.id, accountName: account.name, chatId: '1234567890@c.us', chatName: 'Alex', summary: 'A question', excerpt: 'Can we talk?', messageId: 'm' }] }) }, generate: async prompt => prompt.startsWith('JARVIS_WHATSAPP_INTENT:') ? JSON.stringify(intents.shift()) : JSON.stringify({ groups: [{ ref: 'g1', update: 'Alex would like to talk.', suggestion: '', memoryRefs: [] }] }) });
  t.after(() => { assistant.close(); cleanup.forEach(fn => fn()); });
  const first = { id: randomUUID(), conversationId: randomUUID(), afterTurnId: null, message: 'WhatsApp updates' };
  await assistant.run(first, () => {}).done;
  const read = await assistant.run({ ...first, id: randomUUID(), afterTurnId: first.id, message: 'Read Alex’s messages' }, () => {}).done;
  assert.match(read.text, /Alex: Hello/); assert.equal(reads, 1); assert.equal(read.action.accountId, account.id);
  intents.push({ action: 'read', contact: '' });
  const stale = await assistant.run({ ...first, id: randomUUID(), afterTurnId: first.id, message: 'Read their messages' }, () => {}).done;
  assert.match(stale.text, /Which WhatsApp account/); assert.equal(reads, 1, 'A stale afterTurnId does not inherit the target');
});
