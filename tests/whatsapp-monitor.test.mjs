import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppMonitor, whatsAppConnectionProblem } from '../server/whatsapp-monitor.mjs';
import { openStore } from '../server/store.mjs';
import { directory } from './helpers.mjs';

test('connection diagnostics distinguish offline service, pairing and recovery without echoing remote text', () => {
  assert.match(whatsAppConnectionProblem({ state: 'unavailable', message: 'OpenWA is unavailable. Start OpenWA on your computer, then reconnect here.' }), /OpenWA is unavailable/);
  assert.match(whatsAppConnectionProblem({ state: 'qr_ready' }), /QR code/);
  assert.match(whatsAppConnectionProblem({ state: 'authenticating' }), /reconnecting/);
  assert.match(whatsAppConnectionProblem({ state: 'disconnected' }), /Reconnect/);
  const result = whatsAppConnectionProblem({ state: 'unavailable', message: 'secret token: arbitrary incoming instructions' });
  assert.doesNotMatch(result, /secret|token|instructions/);
});

function fixture(t) {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }); const records = openStore(path);
  const now = Date.now(), chat = { id: '1234567890@c.us', name: 'Example', selected: true }, calls = [], prompts = [];
  const data = [{ cursor: 'row-1', id: 'message-1', body: 'Please call me tomorrow at 3.', fromMe: false, author: 'Example', timestamp: now / 1000, receivedAt: now }];
  let fail = false, monitor;
  const accounts = { accounts: async () => [{ id: 'personal', name: 'Personal' }, { id: 'australia', name: 'Personal Australia' }], account: async id => ({ status: async () => ({ state: 'ready' }), selectedChats: () => id === 'personal' ? [chat] : [], chats: async () => [chat, { id: '12345@g.us', name: 'Group', isGroup: true }], monitorPage: async (chatId, after, scope) => { calls.push({ id, chatId, scope }); if (fail) throw new Error('Disconnected'); return data; } }) };
  const generate = async prompt => { prompts.push(prompt); const source = JSON.parse(prompt.split('\n').at(-1)); return JSON.stringify({ items: source.messages.map(m => ({ id: m.id, important: true, summary: 'A call was requested.', reminder: 'Call Example', dueText: 'tomorrow at 3' })) }); };
  function open() { monitor = createWhatsAppMonitor({ directory: path, accounts, generate, records, now: () => now }); return monitor; }
  open();
  t.after(async () => { await monitor.close(); records.close(); cleanup.forEach(fn => fn()); });
  return { get monitor() { return monitor; }, records, calls, prompts, data, now, open, fail: value => { fail = value; } };
}

test('hourly checks honour selected scope, deduplicate across restart, and save reminders only after approval', async t => {
  const f = fixture(t); assert.equal(f.monitor.state().settings.enabled, false);
  await f.monitor.run(); assert.equal(f.calls.length, 0);
  f.monitor.configure({ enabled: true, scope: 'selected' });
  const result = await f.monitor.run(); assert.equal(result.report.newAlerts, 1); assert.equal(f.records.records().length, 0);
  assert.deepEqual(f.calls.map(c => c.id), ['personal']);
  const alert = result.alerts[0]; assert.equal(alert.messageId, 'message-1'); assert.equal(alert.dueText, 'tomorrow at 3');
  assert.throws(() => f.monitor.updateAlert({ id: alert.id, action: 'save-task' }), /approve/);
  const saved = f.monitor.updateAlert({ id: alert.id, action: 'save-task', approved: true, dueDate: '2026-10-06', title: 'Call Example tomorrow' });
  assert.equal(f.records.get(saved.taskId).dueDate, '2026-10-06');
  f.monitor.updateAlert({ id: alert.id, action: 'save-task', approved: true }); assert.equal(f.records.records().length, 1);
  await f.monitor.close(); f.open(); await f.monitor.run(); assert.equal(f.prompts.length, 1); assert.equal(f.monitor.state().alerts.length, 1);
});

test('disconnects preserve cursor; retry catches new messages without replaying old alerts', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'selected' }); await f.monitor.run();
  f.data.unshift({ ...f.data[0], cursor: 'row-2', id: 'message-2', receivedAt: f.now + 10 });
  f.fail(true); const failed = await f.monitor.run(); assert.equal(failed.report.newAlerts, 0); assert.ok(failed.report.problems.some(p => p.includes('Disconnected')));
  f.fail(false); const next = await f.monitor.run(); assert.equal(next.report.newAlerts, 1); assert.equal(f.monitor.state().alerts.length, 2);
});

test('broad monitoring scope is opt-in and excludes groups in direct mode', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'direct' }); await f.monitor.run();
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => c.scope === 'direct' && !c.chatId.endsWith('@g.us')));
});

test('a busy backlog continues from a durable page cursor and never drops or duplicates alerts', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }); const records = openStore(path), time = Date.now();
  const rows = Array.from({ length: 420 }, (_, i) => ({ cursor: `row-${i}`, id: `message-${i}`, body: 'A direct request', fromMe: false, author: 'Friend', timestamp: time / 1000, receivedAt: time }));
  let waReads = 0;
  const accounts = { accounts: async () => [{ id: 'one', name: 'Personal' }], account: async () => ({ status: async () => ({ state: 'ready' }), selectedChats: () => [{ id: '12345@c.us', name: 'Friend' }], monitorPage: async (chat, after) => { waReads++; const offset = after ? rows.findIndex(r => r.cursor === after) + 1 : 0; return rows.slice(offset, offset + 100); } }) };
  const generate = async prompt => JSON.stringify({ items: JSON.parse(prompt.split('\n').at(-1)).messages.map(m => ({ id: m.id, important: true, summary: 'Needs a response', reminder: '', dueText: '' })) });
  const make = () => createWhatsAppMonitor({ directory: path, accounts, generate, records, now: () => time });
  let monitor = make(); t.after(async () => { await monitor.close(); records.close(); cleanup.forEach(fn => fn()); });
  monitor.configure({ enabled: true, scope: 'selected' }); const first = await monitor.run(); assert.equal(first.report.newAlerts, 300); assert.equal(first.report.pending, true);
  await monitor.close(); monitor = make(); const second = await monitor.run(); assert.equal(second.report.newAlerts, 120); assert.equal(second.report.pending, false);
  assert.equal((await monitor.run()).report.newAlerts, 0); assert.equal(waReads, 7);
});

test('unverifiable model dates do not consume messages or create reminders', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }); const records = openStore(path), time = Date.now(); let wrong = true;
  const accounts = { accounts: async () => [{ id: 'one', name: 'Personal' }], account: async () => ({ status: async () => ({ state: 'ready' }), selectedChats: () => [{ id: '12345@c.us', name: 'Friend' }], monitorPage: async () => [{ id: 'one', cursor: 'row', body: 'Call me tomorrow', fromMe: false, timestamp: time / 1000, receivedAt: time }] }) };
  const monitor = createWhatsAppMonitor({ directory: path, accounts, records, generate: async () => JSON.stringify({ items: [{ id: 'one', important: true, summary: 'Call requested', reminder: 'Call Friend', dueText: wrong ? 'Friday 9am' : 'tomorrow' }] }) });
  t.after(async () => { await monitor.close(); records.close(); cleanup.forEach(fn => fn()); });
  monitor.configure({ enabled: true, scope: 'selected' }); assert.equal((await monitor.run()).report.newAlerts, 0); assert.equal(monitor.state().alerts.length, 0);
  wrong = false; assert.equal((await monitor.run()).report.newAlerts, 1);
});

test('an already answered direct message never reaches AI, while a newer question still does', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'selected' });
  const original = f.data[0];
  f.data.unshift({ ...original, cursor: 'reply', id: 'reply', fromMe: true, status: 'sent', body: 'Yes, I will.', timestamp: original.timestamp + 1 });
  assert.equal((await f.monitor.run()).report.newAlerts, 0); assert.equal(f.prompts.length, 0);
  await f.monitor.close(); f.open();
  f.data.unshift({ ...original, cursor: 'followup', id: 'followup', timestamp: original.timestamp + 2 });
  const next = await f.monitor.run(); assert.equal(next.report.newAlerts, 1);
  assert.deepEqual(next.alerts.map(a => a.messageId), ['followup']);
});

test('synced replies retire old alerts across restarts without deleting saved tasks or crossing accounts', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'direct' });
  const first = await f.monitor.run(); assert.equal(first.alerts.length, 2);
  const personal = first.alerts.find(a => a.accountId === 'personal');
  f.monitor.updateAlert({ id: personal.id, action: 'save-task', approved: true });
  f.monitor.observeReplies('personal', personal.chatId, [{ id: 'out', fromMe: true, status: 'delivered', type: 'audio', timestamp: personal.messageAt + 1 }]);
  assert.deepEqual(f.monitor.state().alerts.map(a => a.accountId), ['australia']);
  assert.equal(f.records.records().length, 1);
  assert.throws(() => f.monitor.updateAlert({ id: personal.id, action: 'save-task', approved: true }), /already replied/);
  await f.monitor.close(); f.open(); assert.equal(f.monitor.state().alerts.length, 1);
  assert.equal((await f.monitor.run()).report.newAlerts, 0);
});

test('failed, pending, unknown, incoming and reaction messages are not reply evidence', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'selected' });
  const original = f.data[0];
  for (const status of ['failed', 'pending', 'unknown'])
    f.data.unshift({ ...original, id: status, cursor: status, fromMe: true, status, timestamp: original.timestamp + 1 });
  f.data.unshift({ ...original, id: 'reaction', cursor: 'reaction', fromMe: true, status: 'sent', type: 'reaction', timestamp: original.timestamp + 2 });
  assert.equal((await f.monitor.run()).report.newAlerts, 1);
  f.monitor.observeReplies('personal', '1234567890@c.us', [{ ...original, status: 'sent', replyTo: original.id }]);
  assert.equal(f.monitor.state().alerts.length, 1);
});

test('group replies clear only the explicitly quoted source and never another chat', async t => {
  const f = fixture(t); f.monitor.configure({ enabled: true, scope: 'all' }); await f.monitor.run();
  const rows = [{ id: 'reply', fromMe: true, status: 'sent', body: 'Agreed', timestamp: f.now / 1000 + 1 }];
  f.monitor.observeReplies('personal', '12345@g.us', rows);
  assert.equal(f.monitor.state().alerts.length, 4);
  rows[0].replyTo = 'message-1';
  f.monitor.observeReplies('personal', '12345@g.us', rows);
  assert.equal(f.monitor.state().alerts.length, 3);
  assert.ok(f.monitor.state().alerts.some(a => a.accountId === 'personal' && a.chatId === '1234567890@c.us'));
});

test('a reply arriving during a paused backlog is checked before continuing older pages', async t => {
  const cleanup = [], path = directory({ after: fn => cleanup.push(fn) }), records = openStore(path), time = Date.now();
  const incoming = Array.from({ length: 420 }, (_, i) => ({ cursor: `r${i}`, id: `m${i}`, body: 'Please respond', fromMe: false, timestamp: time / 1000 - i, receivedAt: time - i }));
  let rows = [...incoming], prompts = 0;
  const accounts = { accounts: async () => [{ id: 'one', name: 'Personal' }], account: async () => ({ status: async () => ({ state: 'ready' }), selectedChats: () => [{ id: '12345@c.us', name: 'Friend' }], monitorPage: async (_, after) => rows.slice(after ? rows.findIndex(r => r.cursor === after) + 1 : 0, (after ? rows.findIndex(r => r.cursor === after) + 1 : 0) + 100) }) };
  const make = () => createWhatsAppMonitor({ directory: path, accounts, records, now: () => time, generate: async prompt => { prompts++; return JSON.stringify({ items: JSON.parse(prompt.split('\n').at(-1)).messages.map(m => ({ id: m.id, important: true, summary: 'Question', reminder: '', dueText: '' })) }); } });
  let monitor = make(); t.after(async () => { await monitor.close(); records.close(); cleanup.forEach(fn => fn()); });
  monitor.configure({ enabled: true, scope: 'selected' }); assert.equal((await monitor.run()).report.newAlerts, 300);
  await monitor.close(); monitor = make();
  rows.unshift({ cursor: 'out', id: 'out', fromMe: true, status: 'sent', type: 'text', body: 'Done', timestamp: time / 1000 + 1, receivedAt: time + 1000 });
  const result = await monitor.run(); assert.equal(result.report.newAlerts, 0); assert.equal(result.alerts.length, 0); assert.equal(prompts, 15);
  assert.equal((await monitor.run()).report.newAlerts, 0);
});
