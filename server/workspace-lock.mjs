import { DatabaseSync } from 'node:sqlite';
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
const derive = promisify(scrypt), hash = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const validPin = value => typeof value === 'string' && /^\d{6,12}$/.test(value);
export function createWorkspaceLock({ directory, id, now = Date.now }) {
  const db = new DatabaseSync(join(directory, 'lock.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY,salt TEXT,hash TEXT,failures INTEGER DEFAULT 0,blockedUntil INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER);');
  const name = `jarvis_session_${id}`, lifetime = 8 * 60 * 60 * 1000;
  let working = false;
  const config = () => db.prepare('SELECT * FROM config WHERE id=1').get();
  const token = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
  function allowed(req) {
    if (!config()) return true;
    const raw = token(req); if (!/^[a-f0-9]{64}$/.test(raw)) return false;
    return (db.prepare('SELECT expires FROM sessions WHERE token=?').get(hash(raw))?.expires || 0) > now();
  }
  function status(req) { const c = config(); return { enabled: !!c, unlocked: allowed(req), retryAfter: Math.max(0, Math.ceil(((c?.blockedUntil || 0) - now()) / 1000)) }; }
  function cookie(res, value, secure, age = lifetime / 1000) { res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`); }
  function grant(res, secure) {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
    const raw = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(raw), now() + lifetime); cookie(res, raw, secure);
  }
  async function verify(pin, current) {
    if (current.blockedUntil > now()) throw failure('Too many attempts. Wait before trying this workspace again.', 429);
    const candidate = await derive(typeof pin === 'string' && pin.length < 128 ? pin : '', current.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    if (!timingSafeEqual(candidate, Buffer.from(current.hash, 'hex'))) {
      const failures = current.failures + 1, blocked = failures >= 5 ? now() + 15 * 60 * 1000 : 0;
      db.prepare('UPDATE config SET failures=?,blockedUntil=? WHERE id=1').run(blocked ? 0 : failures, blocked);
      throw failure(blocked ? 'Too many attempts. Try again in 15 minutes.' : 'Incorrect PIN.', blocked ? 429 : 401);
    }
    db.prepare('UPDATE config SET failures=0,blockedUntil=0 WHERE id=1').run();
  }
  async function action(kind, input, req, res, secure) {
    if (kind === 'lock') { const raw = token(req); if (raw) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(raw)); cookie(res, '', secure, 0); return { ok: true }; }
    if (!['unlock', 'setup', 'change'].includes(kind)) throw failure('Unknown lock action.');
    if (working) throw failure('A PIN check is already running. Try again in a moment.', 429);
    working = true;
    try {
      const current = config();
      if (kind === 'unlock') {
        if (!current) throw failure('Set a PIN in workspace settings first.');
        await verify(input.pin, current); grant(res, secure); return { ok: true };
      }
      if ((kind === 'setup' && current) || (kind === 'change' && (!current || !allowed(req)))) throw failure('Unlock this workspace before changing its PIN.', 401);
      if (!validPin(input.newPin) || input.newPin !== input.confirmPin) throw failure('Choose a matching PIN with 6 to 12 digits.');
      if (current) await verify(input.currentPin, current);
      const salt = randomBytes(32).toString('hex'), encoded = (await derive(input.newPin, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('INSERT OR REPLACE INTO config VALUES(1,?,?,0,0)').run(salt, encoded); db.exec('DELETE FROM sessions; COMMIT'); }
      catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
      grant(res, secure); return { ok: true };
    } finally { working = false; }
  }
  // Server-only session identity for separately reviewed integrations. An
  // unconfigured PIN is allowed for the ordinary app, never a member identity.
  function session(req) {
    if (!config() || !allowed(req)) return null;
    const raw = token(req);
    return { profileId: id, sessionId: hash(raw) };
  }
  return { allowed, status, action, session, close: () => db.close() };
}
