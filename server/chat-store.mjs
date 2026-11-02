import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { UUID } from '../shared/model.mjs';
import { createHash } from 'node:crypto';

export function chatError(message, status = 400) { return Object.assign(new Error(message), { status }); }

export function openChatStore(directory, { retainPrivate = () => false } = {}) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'conversations.sqlite'), { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS turns_conversation ON turns(conversation_id);
  `);
  const ephemeral = new Map();
  const requestHash = request => 'sha256:' + createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const redacted = turn => ({ ...turn, privacyTag: 'evergreen', message: '[Evergreen conversation content not retained]', reply: '', sources: [], error: '', action: undefined, redacted: true });
  function persisted(value) { return value.privacyTag === 'evergreen' && !retainPrivate() ? redacted(value) : value; }
  function getTurn(id) { const row = db.prepare('SELECT payload FROM turns WHERE id=?').get(id); return ephemeral.get(id) || (row ? JSON.parse(row.payload) : null); }
  function turns(id, diskOnly = false) { return db.prepare('SELECT id, payload FROM turns WHERE conversation_id=? ORDER BY rowid').all(id).map(row => !diskOnly && ephemeral.get(row.id) || JSON.parse(row.payload)); }
  function list() { return db.prepare('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC LIMIT 100').all(); }
  function activity() {
    return db.prepare('SELECT payload FROM turns ORDER BY rowid DESC LIMIT 50').all().map(row => {
      // Use persisted content, never the ephemeral private conversation cache.
      const turn = JSON.parse(row.payload);
      return { id: turn.id, conversationId: turn.conversationId, title: turn.privacyTag === 'evergreen' || turn.redacted ? 'Evergreen conversation' : turn.message.slice(0,120), status: turn.status, updatedAt: turn.updatedAt };
    });
  }
  function get(id, diskOnly = false) {
    const conversation = db.prepare('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id=?').get(id);
    if (!conversation) return null;
    return { ...conversation, turns: turns(id, diskOnly) };
  }
  function update(id, fields) {
    const current = getTurn(id); if (!current) throw chatError('Conversation turn not found.', 404);
    const value = { ...current, ...fields, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE turns SET payload=? WHERE id=?').run(JSON.stringify(persisted(value)), id);
    if (value.privacyTag === 'evergreen' && !retainPrivate()) ephemeral.set(id, value);
    return value;
  }
  // A interrupted inference is visible and retryable. Never replay it automatically on boot.
  for (const row of db.prepare('SELECT id, payload FROM turns').all()) {
    if (JSON.parse(row.payload).status === 'running') update(row.id, { status: 'interrupted', error: 'The computer restarted before this reply finished. You can try again.' });
  }
  function lookup(request) {
    const previous = db.prepare('SELECT request, payload FROM turns WHERE id=?').get(request.id);
    if (!previous) return null;
    if (previous.request !== JSON.stringify(request) && previous.request !== requestHash(request)) throw chatError('This message identifier belongs to a different request.', 409);
    return ephemeral.get(request.id) || JSON.parse(previous.payload);
  }
  function start(request, sources, contextTrimmed, privateTurn = false) {
    if (!UUID.test(request.id) || !UUID.test(request.conversationId)) throw chatError('Invalid conversation identifier.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = lookup(request);
      if (previous) { db.exec('COMMIT'); return previous; }
      const history = turns(request.conversationId);
      privateTurn ||= history.some(t => t.privacyTag === 'evergreen' || t.provider === 'evergreen-companion');
      if ((history.at(-1)?.id || null) !== request.afterTurnId) throw chatError('This conversation changed in another tab. Reload it before sending.', 409);
      if (history.length >= 100) throw chatError('This conversation is full. Start a new conversation to continue.');
      const now = new Date().toISOString();
      db.prepare('INSERT INTO conversations VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at')
        .run(request.conversationId, privateTurn ? 'Evergreen conversation' : request.message.slice(0, 70), now, now);
      if (privateTurn) db.prepare('UPDATE conversations SET title=? WHERE id=?').run('Evergreen conversation', request.conversationId);
      const value = { id: request.id, conversationId: request.conversationId, message: request.message, reply: '', status: 'running', error: '', sources, contextTrimmed, createdAt: now, updatedAt: now, ...(request.lockedVoice?{lockedVoice:true}:{}), ...(privateTurn ? { privacyTag: 'evergreen' } : {}) };
      db.prepare('INSERT INTO turns VALUES (?,?,?,?)').run(request.id, request.conversationId, privateTurn ? requestHash(request) : JSON.stringify(request), JSON.stringify(persisted(value)));
      if (privateTurn && !retainPrivate()) ephemeral.set(request.id, value);
      db.exec('COMMIT'); return value;
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  function exportData() {
    return { format: 'second-brain-conversations', version: 1, exportedAt: new Date().toISOString(), conversations: db.prepare('SELECT id FROM conversations ORDER BY rowid').all().map(row => get(row.id, true)) };
  }
  function redactEvergreen() {
    const rows = db.prepare('SELECT id, conversation_id, request, payload FROM turns').all();
    const ids = new Set(rows.filter(row => { const t = JSON.parse(row.payload); return t.privacyTag === 'evergreen' || t.provider === 'evergreen-companion' || /\bevergreen\b/i.test(t.message); }).map(r => r.conversation_id));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows.filter(r => ids.has(r.conversation_id))) {
        const value = redacted(JSON.parse(row.payload));
        const hash = row.request.startsWith('sha256:') ? row.request : requestHash(JSON.parse(row.request));
        db.prepare('UPDATE turns SET request=?, payload=? WHERE id=?').run(hash, JSON.stringify(value), row.id); ephemeral.delete(row.id);
      }
      for (const id of ids) db.prepare('UPDATE conversations SET title=? WHERE id=?').run('Evergreen conversation', id);
      db.exec('COMMIT'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
    return [...ids];
  }
  return { list, activity, get, getTurn, turns, lookup, start, update, exportData, redactEvergreen, close: () => { ephemeral.clear(); db.close(); } };
}
