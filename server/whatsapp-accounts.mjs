import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { credentialVault } from './credential-vault.mjs';
import { createWhatsApp } from './whatsapp.mjs';

// Each linked number owns a separate selection and approval database. Old clients
// must choose an account after a second is added; there is no implicit send account.
export function createWhatsAppAccounts({ directory, generate, records: personalRecords, profile, readConfig, createAccount = createWhatsApp } = {}) {
  const path = join(directory, 'connections/whatsapp.dpapi');
  const vault = credentialVault(path), instances = new Map();
  let cached = null, modified = -1, loading;
  async function config() {
    if (readConfig) return readConfig();
    const stamp = await stat(path).then(s => s.mtimeMs).catch(e => { if (e.code === 'ENOENT') return 0; throw e; });
    if (modified === stamp) return cached;
    loading ||= vault.read().then(value => { modified = stamp; cached = value; return value; }).finally(() => { loading = null; });
    return loading;
  }
  async function records() { const data = await config(); return data?.accounts || (data?.sessionId ? [data] : []); }
  async function accounts() { return (await records()).map((c, i) => ({ id: c.sessionId, name: c.label || `WhatsApp ${i + 1}`, sessionName: c.sessionName })); }
  async function account(id) {
    const all = await records();
    const current = id ? all.find(c => c.sessionId === id) : all.length === 1 ? all[0] : null;
    if (!current) throw Object.assign(new Error(all.length ? 'Choose a WhatsApp account. Refresh the app if the selector is missing.' : 'WhatsApp is not configured on this computer.'), { status: all.length ? 409 : 503 });
    if (!instances.has(current.sessionId)) {
      // The first account retains the existing database during migration.
      const accountDir = all[0].sessionId === current.sessionId ? directory : join(directory, 'whatsapp-accounts', current.sessionId);
      instances.set(current.sessionId, createAccount({ directory: accountDir, credentials: async () => current, generate, records: personalRecords, profile }));
    }
    return instances.get(current.sessionId);
  }
  return { accounts, account, close: () => { for (const item of instances.values()) item.close(); } };
}
