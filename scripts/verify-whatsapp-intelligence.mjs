// Live Luna, synthetic WhatsApp only. Never reads contacts or sends real messages.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChatGPTAuth } from '../server/chatgpt-auth.mjs';
import { createChatGPT } from '../server/chatgpt.mjs';
import { createWhatsApp } from '../server/whatsapp.mjs';
import { createWhatsAppAccounts } from '../server/whatsapp-accounts.mjs';
import { createWhatsAppAssistant } from '../server/whatsapp-assistant.mjs';
import { createWhatsAppMonitor } from '../server/whatsapp-monitor.mjs';
import { openStore } from '../server/store.mjs';
import assert from 'node:assert/strict';
mkdirSync('.test-data', { recursive: true }); mkdirSync('output/qa', { recursive: true });
const directory = mkdtempSync(resolve('.test-data/whatsapp-live-'));
const auth = createChatGPTAuth({ directory: resolve('data'), readOnly: true }), provider = createChatGPT({ auth });
const reports = [], generate = async prompt => (await provider.run(prompt, () => {}, { reasoning: 'low' }).done).text;
const ids = [randomUUID(), randomUUID()], chatId = '1234567890@c.us'; let sends = 0;
const now = Date.now();
const accounts = createWhatsAppAccounts({ directory, generate, readConfig: async () => ({ accounts: ids.map((id, i) => ({ sessionId: id, label: i ? 'Personal Australia' : 'Personal' })) }), createAccount: options => createWhatsApp({ ...options, transport: async (url) => {
  if (url.startsWith('/chats')) return [{ id: chatId, name: 'Example Friend' }];
  if (url.startsWith('/messages?')) return { messages: [{ id: 'row-one', waMessageId: 'synthetic-one', body: 'Please call me tomorrow at 3 pm to confirm the meeting.', direction: 'incoming', from: chatId, createdAt: new Date(now).toISOString(), timestamp: now / 1000 }] };
  if (url === '/messages/send-text') { sends++; return { messageId: 'SYNTHETIC_ONLY' }; }
  return { status: 'ready' };
} }) });
const records = openStore(directory), monitor = createWhatsAppMonitor({ directory, accounts, generate, records });
const assistant = createWhatsAppAssistant({ directory, accounts, monitor, generate });
let afterTurnId = null; const conversationId = randomUUID();
async function command(message) {
  const id = randomUUID(), start = performance.now();
  const handle = assistant.run({ id, conversationId, afterTurnId, message, voice: true }, () => {});
  assert.ok(handle); const result = await handle.done; afterTurnId = id;
  reports.push({ message, reply: result.text, milliseconds: Math.round(performance.now() - start) });
  console.log(JSON.stringify(reports.at(-1))); return result;
}
try {
  await (await accounts.account(ids[1])).select({ id: chatId, enabled: true });
  const review = await command('Message Example Friend from Personal Australia saying I will arrive at 7.');
  assert.equal(review.action?.kind, 'whatsapp-review'); assert.equal(review.action.accountName, 'Personal Australia'); assert.equal(sends, 0);
  const edit = await command('Change that message to I will arrive at 8.');
  assert.equal(edit.action?.kind, 'whatsapp-review'); assert.match(edit.action.text, /8/); assert.equal(sends, 0);
  await command('cancel WhatsApp');
  const start = performance.now(); monitor.configure({ enabled: true, scope: 'selected' });
  const checked = await monitor.run(); assert.equal(checked.report.problems.filter(p => !p.includes('no chats enabled')).length, 0); assert.equal(checked.alerts.length, 1);
  reports.push({ monitoringMilliseconds: Math.round(performance.now() - start), alert: checked.alerts[0].summary, reminder: checked.alerts[0].reminder });
  assert.equal(sends, 0); console.log(JSON.stringify(reports.at(-1)));
  await command('What are my important WhatsApp messages?');
  const reminder = await command('Review reminder number 1'); assert.equal(reminder.action?.kind, 'whatsapp-reminder-review'); assert.equal(records.records().length, 0);
  writeFileSync(join('output/qa', 'whatsapp-intelligence.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), syntheticOnly: true, realSends: 0, reports }, null, 2));
} finally { assistant.close(); await monitor.close(); accounts.close(); records.close(); await auth.close(); }
