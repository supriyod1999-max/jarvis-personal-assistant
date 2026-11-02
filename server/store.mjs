import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readdirSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { UUID, validateRecord } from '../shared/model.mjs';

export class ConflictError extends Error {
  constructor(current) { super('This item changed on another device.'); this.current = current; }
}

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'brain.sqlite'), { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request TEXT NOT NULL, response TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('serverId', randomUUID());
  const serverId = db.prepare('SELECT value FROM metadata WHERE key = ?').get('serverId').value;
  let backupAt = null;
  let backupError = null;
  const backupDirectory = join(directory, 'backups');
  mkdirSync(backupDirectory, { recursive: true });
  const latestPath = join(backupDirectory, 'latest.json');
  if (existsSync(latestPath)) {
    try { backupAt = JSON.parse(readFileSync(latestPath, 'utf8')).exportedAt; } catch { backupError = 'The previous backup could not be read.'; }
  }

  function records() { return db.prepare('SELECT payload FROM records ORDER BY rowid').all().map(r => JSON.parse(r.payload)); }
  function get(id) { const row = db.prepare('SELECT payload FROM records WHERE id = ?').get(id); return row ? JSON.parse(row.payload) : null; }
  function exportData() { return { format: 'second-brain', version: 1, exportedAt: new Date().toISOString(), records: records().filter(r => !r.deleted) }; }

  function backup() {
    try {
      const data = exportData();
      const text = JSON.stringify(data, null, 2);
      // Keep a rolling snapshot and the first snapshot of each UTC day. This is a local recovery copy,
      // not protection against disk loss. Users can download an export to a different device.
      writeFileSync(`${latestPath}.tmp`, text, { mode: 0o600 });
      renameSync(`${latestPath}.tmp`, latestPath);
      const daily = join(backupDirectory, `${data.exportedAt.slice(0, 10)}.json`);
      if (!existsSync(daily)) {
        writeFileSync(`${daily}.tmp`, text, { mode: 0o600 });
        renameSync(`${daily}.tmp`, daily);
      }
      const names = readdirSync(backupDirectory).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
      for (const name of names.slice(0, Math.max(0, names.length - 14))) unlinkSync(join(backupDirectory, name));
      backupAt = data.exportedAt; backupError = null;
    } catch { backupError = 'Items are saved, but the local recovery copy could not be updated.'; }
    return { backupAt, backupError };
  }

  function mutate(mutation) {
    if (!mutation || !UUID.test(mutation.operationId) || !Number.isSafeInteger(mutation.baseRev) || mutation.baseRev < 0) {
      throw new Error('Invalid change request.');
    }
    if (mutation.serverId !== serverId) throw new Error('This change belongs to a different memory store.');
    const fields = validateRecord(mutation.record);
    const request = JSON.stringify({ record: fields, baseRev: mutation.baseRev, serverId });
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT request, response FROM operations WHERE id = ?').get(mutation.operationId);
      if (previous) {
        if (previous.request !== request) throw new Error('A change identifier cannot be reused for a different change.');
        db.exec('COMMIT');
        return JSON.parse(previous.response);
      }
      const current = get(fields.id);
      if ((current?.rev ?? 0) !== mutation.baseRev) throw new ConflictError(current);
      const now = new Date().toISOString();
      const record = { ...fields, rev: mutation.baseRev + 1, createdAt: current?.createdAt ?? now, updatedAt: now };
      db.prepare('INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, payload=excluded.payload')
        .run(record.id, record.rev, JSON.stringify(record));
      const response = { record };
      db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(mutation.operationId, request, JSON.stringify(response));
      db.exec('COMMIT');
      backup();
      return response;
    } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
  }

  return { serverId, records, get, mutate, backup, exportData, status: () => ({ backupAt, backupError }), close: () => db.close() };
}
