import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { credentialVault } from '../server/credential-vault.mjs';

// Run locally once. The dashboard admin key never enters the app or its browser.
const root = resolve(import.meta.dirname, '..');
const vault = credentialVault(resolve(root, 'data/connections/whatsapp.dpapi'));
await vault.acquire();
try {
  const existing = await vault.read();
  const accounts = existing?.accounts || (existing?.sessionId ? [existing] : []);
  const addSecond = process.argv.includes('--add-second');
  if (existing && (!addSecond || accounts.length >= 2)) {
    console.log('Second Brain already has an OpenWA connection. Use the WhatsApp tab to pair or reconnect.');
  } else {
    const admin = (await readFile(resolve(root, 'integrations/OpenWA/data/.api-key'), 'utf8')).trim();
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:2785/api/${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'X-API-Key': admin, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(`OpenWA setup failed (${response.status}): ${JSON.stringify(error.message || 'Request refused')}`); }
      return response.json();
    };
    const sessions = await request('sessions');
    // Never silently adopt someone else's paired account.
    const sessionName = accounts.length ? 'second-brain-2' : 'second-brain';
    const session = sessions.find(s => s.name === sessionName) || await request('sessions', { name: sessionName });
    const credentials = { version: 1, sessionId: session.id, sessionName: session.name };
    for (const role of ['viewer', 'operator']) {
      const key = await request('auth/api-keys', { name: `${sessionName} ${role}`, role, allowedSessions: [session.id], allowedIps: ['127.0.0.1'] });
      credentials[role] = key.apiKey;
    }
    await vault.write({ version: 2, accounts: [...accounts, credentials] });
    console.log(`Created ${sessionName} and encrypted session-scoped credentials. Pairing this number is still required.`);
  }
} finally { await vault.release(); }
