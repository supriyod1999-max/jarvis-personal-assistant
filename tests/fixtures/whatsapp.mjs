import { createWhatsAppAccounts } from '../../server/whatsapp-accounts.mjs';
import { createWhatsApp } from '../../server/whatsapp.mjs';

// Synthetic transport only. This fixture never accesses OpenWA or credentials.
export async function fixtureWhatsApp({ directory, generate, records }) {
  const sessionId = '11111111-1111-4111-8111-111111111111', chatId = '19999999999@g.us';
  const now = Math.floor(Date.now() / 1000);
  const messages = ['Old context', 'Dinner on Friday?', 'Sounds good, let me check!', 'Seven o’clock?', 'Can you confirm?', 'I’ll confirm shortly.'].map((body, i) => ({ id: `fixture-source-${i}`, waMessageId: `fixture-wa-${i}`, body, author: '18888888888@c.us', direction: [2, 5].includes(i) ? 'outgoing' : 'incoming', timestamp: now - 60 + i, createdAt: new Date((now - 60 + i) * 1000).toISOString() })).reverse();
  const accounts = createWhatsAppAccounts({ directory, generate, records, readConfig: async () => ({ accounts: [{ sessionId, label: 'Personal' }] }), createAccount: options => createWhatsApp({ ...options, transport: async (url, input) => {
    if (url === '/messages/send-text' && input.method === 'POST') return { messageId: 'fixture-only-receipt' }; // Synthetic transport, no network.
    if (input.method !== 'GET') throw new Error('Unsupported fixture operation.');
    if (url.startsWith('/chats')) return [{ id: chatId, name: 'Dinner friends', isGroup: true }];
    if (url.startsWith('/messages?')) return { messages };
    if (url.startsWith('/contacts/')) return { id: '18888888888@c.us', name: 'Alex' };
    return { status: 'ready' };
  } }) });
  await (await accounts.account(sessionId)).select({ id: chatId, enabled: true });
  return accounts;
}
