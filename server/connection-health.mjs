import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Only sanitized states persist here, never credentials, message bodies or URLs.
export function createConnectionHealth({ directory, probes, now = Date.now, timeoutMs = 8000 }) {
  const db = new DatabaseSync(join(directory, 'connection-health.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS health(id TEXT PRIMARY KEY, state TEXT, changedAt TEXT, lastHealthyAt TEXT)');
  let pending, cached, checked = 0;
  async function check() {
    if (cached && now() - checked < 30000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const services = await Promise.all(probes.map(async probe => {
        let timer, result;
        try {
          result = await Promise.race([probe.check(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
        } catch { result = { state: 'unavailable', detail: 'Could not check this connection. Try again shortly.' }; }
        finally { clearTimeout(timer); }
        const stamp = new Date(now()).toISOString();
        const old = db.prepare('SELECT * FROM health WHERE id=?').get(probe.id);
        const row = { id: probe.id, state: result.state, changedAt: old?.state === result.state ? old.changedAt : stamp, lastHealthyAt: result.state === 'ready' ? stamp : old?.lastHealthyAt || null };
        db.prepare('INSERT OR REPLACE INTO health VALUES(?,?,?,?)').run(row.id, row.state, row.changedAt, row.lastHealthyAt);
        return { ...row, name: probe.name, detail: result.detail, href: probe.href || '#/settings' };
      }));
      checked = now(); cached = { checkedAt: new Date(checked).toISOString(), services }; return cached;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { check, close: async () => { await pending?.catch(() => {}); db.close(); } };
}
