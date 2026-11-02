import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createWhatsApp } from '../server/whatsapp.mjs';
import { directory } from './helpers.mjs';

const chatId = '1234567890@c.us';
test('read adapters preserve sent status and exact reply metadata without exposing raw metadata', async t => {
  const { wa } = fixture(t, { transport: async url => url.startsWith('/chats') ? [{ id: chatId, name: 'Friend' }] : { messages: [{ id: 'db', waMessageId: 'reply', direction: 'outgoing', status: 'sent', timestamp: 100, body: 'Sure', metadata: { quotedMessage: { id: 'original' }, unrelated: 'private' } }] } });
  await wa.select({ id: chatId, enabled: true });
  for (const rows of [await wa.messages(chatId), await wa.monitorPage(chatId)]) {
    assert.equal(rows[0].replyTo, 'original'); assert.equal(rows[0].status, 'sent'); assert.equal(rows[0].fromMe, true); assert.equal(rows[0].metadata, undefined);
  }
});
function fixture(t, extra = {}) {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }), calls = [];
  const transport = async (url, request) => {
    calls.push({ url, ...request });
    if (url.startsWith('/chats')) return [{ id: chatId, name: 'Example Friend', isGroup: false, lastMessage: 'Must not appear in picker' }, { id: 'status@broadcast', name: 'Status' }];
    if (url.startsWith('/messages?')) return { messages: [{ id: 'database-id', waMessageId: 'source-id', chatId, body: 'Are you free tomorrow?', direction: 'incoming', timestamp: 12, type: 'text' }], total: 1 };
    if (url === '/messages/send-text') return { messageId: 'whatsapp-accepted-id' };
    return { status: 'ready', name: 'test-session' };
  };
  const wa = createWhatsApp({ directory: path, transport, ...extra });
  t.after(() => { wa.close(); for (const fn of cleanup) fn(); });
  return { wa, calls, path };
}
test('WhatsApp limits read access to explicitly selected chats and does not mark them read', async t => {
  const { wa, calls } = fixture(t);
  await assert.rejects(wa.messages(chatId), /Enable this chat/);
  assert.deepEqual(await wa.chats(), [{ id: chatId, name: 'Example Friend', isGroup: false, selected: false }]);
  await wa.select({ id: chatId, enabled: true });
  assert.equal((await wa.messages(chatId))[0].id, 'source-id');
  assert.equal(calls.some(c => c.method !== 'GET'), false);
  await wa.select({ id: chatId, enabled: false });
  await assert.rejects(wa.messages(chatId), /Enable this chat/);
  await assert.rejects(wa.messages('../admin'), /supported WhatsApp chat/);
});
test('AI drafting shares only selected chat context and has no send side effect', async t => {
  let prompt;
  const { wa, calls } = fixture(t, { generate: async p => { prompt = p; return 'Let me check and get back to you.'; } });
  await wa.select({ id: chatId, enabled: true });
  assert.match((await wa.draft({ id: chatId, instruction: 'Do not commit yet' })).text, /Let me check/);
  assert.match(prompt, /untrusted source material/); assert.match(prompt, /Are you free tomorrow/);
  assert.equal(calls.some(c => c.url === '/messages/send-text'), false);
});
test('send uses the reviewed recipient and text once, even across duplicate requests', async t => {
  const { wa, calls } = fixture(t);
  await wa.select({ id: chatId, enabled: true });
  const id = randomUUID();
  wa.prepare({ id, chatId, text: 'Reviewed reply' });
  assert.throws(() => wa.prepare({ id, chatId, text: 'Changed reply' }), /changed/);
  await Promise.all([wa.send({ id, text: 'Injected reply', chatId: '98765@c.us' }), wa.send({ id })]);
  const sends = calls.filter(c => c.url === '/messages/send-text');
  assert.equal(sends.length, 1); assert.deepEqual(sends[0].body, { chatId, text: 'Reviewed reply', linkPreview: false });
  assert.equal(wa.receipt(id).state, 'accepted');
  assert.equal((await wa.send({ id })).state, 'accepted'); assert.equal(calls.filter(c => c.write).length, 1);
});
test('ambiguous sends are never retried; expired and revoked approvals cannot send', async t => {
  let sends = 0;
  const { wa, path } = fixture(t, { transport: async path => {
    if (path.startsWith('/chats')) return [{ id: chatId, name: 'Example' }];
    if (path === '/messages/send-text') { sends++; throw new Error('Lost response after send'); }
  } });
  await wa.select({ id: chatId, enabled: true });
  const input = { id: randomUUID(), chatId, text: 'Hello' }; wa.prepare(input);
  assert.equal((await wa.send(input)).state, 'unknown'); await wa.send(input); assert.equal(sends, 1);
  const expired = { ...input, id: randomUUID() }; wa.prepare(expired);
  const db = new DatabaseSync(join(path, 'whatsapp.sqlite')); db.prepare('UPDATE approvals SET expires=0 WHERE id=?').run(expired.id); db.close();
  await assert.rejects(wa.send(expired), /expired/);
  const revoked = { ...input, id: randomUUID() }; wa.prepare(revoked); await wa.select({ id: chatId, enabled: false });
  await assert.rejects(wa.send(revoked), /Enable this chat/); assert.equal(sends, 1);
});
test('a process restart turns an interrupted send into an uncertain receipt, never resends', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) });
  const first = createWhatsApp({ directory: path, transport: async () => [{ id: chatId, name: 'Example' }] });
  await first.select({ id: chatId, enabled: true }); const id = randomUUID(); first.prepare({ id, chatId, text: 'Hello' }); first.close();
  const db = new DatabaseSync(join(path, 'whatsapp.sqlite')); db.prepare("UPDATE approvals SET state='sending' WHERE id=?").run(id); db.close();
  let calls = 0; const second = createWhatsApp({ directory: path, transport: async () => { calls++; } });
  t.after(() => { second.close(); cleanup.forEach(fn => fn()); });
  assert.equal((await second.send({ id })).state, 'unknown'); assert.equal(calls, 0);
});
