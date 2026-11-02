import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWhatsApp } from '../server/whatsapp.mjs';
import { createWhatsAppAccounts } from '../server/whatsapp-accounts.mjs';
import { directory } from './helpers.mjs';

test('two numbers cannot share selections or send approvals, and missing account fails closed', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) });
  const first = { sessionId: randomUUID(), label: 'Personal' }, second = { sessionId: randomUUID(), label: 'Personal Australia' };
  const sends = [], chatId = '1234567890@c.us';
  const manager = createWhatsAppAccounts({ directory: path, readConfig: async () => ({ accounts: [first, second] }), createAccount: options => createWhatsApp({ ...options, transport: async (path, input) => {
    const account = await options.credentials();
    if (path.startsWith('/chats')) return [{ id: chatId, name: 'Example' }];
    if (path === '/messages/send-text') { sends.push(account.sessionId); return { messageId: 'accepted' }; }
  } }) });
  t.after(() => { manager.close(); cleanup.forEach(fn => fn()); });
  assert.deepEqual((await manager.accounts()).map(a => a.name), ['Personal', 'Personal Australia']);
  await assert.rejects(manager.account(null), /Choose a WhatsApp account/);
  await assert.rejects(manager.account(randomUUID()), /Choose a WhatsApp account/);
  const a = await manager.account(first.sessionId), b = await manager.account(second.sessionId);
  await a.select({ id: chatId, enabled: true });
  await assert.rejects(b.messages(chatId), /Enable this chat/);
  const id = randomUUID(); a.prepare({ id, chatId, text: 'Hello from Personal' });
  await assert.rejects(b.send({ id }), /Reply not found/);
  await a.send({ id }); assert.deepEqual(sends, [first.sessionId]);
});
