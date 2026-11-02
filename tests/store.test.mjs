import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openStore, ConflictError } from '../server/store.mjs';
import { parseBackup, validateRecord } from '../shared/model.mjs';
import { directory, entry, mutation } from './helpers.mjs';

test('replay after restart returns the original receipt without duplicating data', t => {
  const path = directory(t); let store = openStore(path);
  const change = mutation(store); const first = store.mutate(change);
  store.close(); store = openStore(path);
  try {
    assert.equal(store.serverId, change.serverId);
    assert.deepEqual(store.mutate(change), first);
    assert.equal(store.records().length, 1);
    assert.equal(store.get(first.record.id).rev, 1);
    assert.equal(parseBackup(JSON.parse(readFileSync(join(path, 'backups/latest.json')))).length, 1);
  } finally { store.close(); }
});

test('stale changes preserve the computer version and a failed transaction can be retried', t => {
  const store = openStore(directory(t));
  try {
    const first = store.mutate(mutation(store)).record;
    const remote = store.mutate(mutation(store, { ...first, title: 'Computer edit' }, 1)).record;
    assert.throws(() => store.mutate(mutation(store, { ...first, title: 'Device edit' }, 1)), e => e instanceof ConflictError && e.current.title === 'Computer edit');
    assert.equal(store.get(first.id).title, 'Computer edit');
    assert.equal(store.mutate(mutation(store, { ...remote, title: 'Reviewed edit' }, 2)).record.rev, 3);
  } finally { store.close(); }
});

test('operation identifiers and database identity cannot be reused for other changes', t => {
  const store = openStore(directory(t));
  try {
    const change = mutation(store); store.mutate(change);
    assert.throws(() => store.mutate({ ...change, record: { ...change.record, title: 'Different' } }), /reused/);
    assert.throws(() => store.mutate({ ...mutation(store), serverId: 'different' }), /different memory store/);
    assert.equal(store.records().length, 1);
  } finally { store.close(); }
});

test('trash survives restart, exports omit trash, and restore advances the revision', t => {
  const path = directory(t); let store = openStore(path);
  const first = store.mutate(mutation(store)).record;
  store.mutate(mutation(store, { ...first, deleted: true }, 1)); store.close();
  store = openStore(path);
  try {
    assert.equal(store.get(first.id).deleted, true);
    assert.equal(store.exportData().records.length, 0);
    const restored = store.mutate(mutation(store, { ...first, deleted: false }, 2)).record;
    assert.equal(restored.rev, 3); assert.equal(restored.createdAt, first.createdAt);
  } finally { store.close(); }
});

test('backup failure does not report a committed save as lost', t => {
  const path = directory(t); const store = openStore(path);
  try {
    store.backup(); unlinkSync(join(path, 'backups/latest.json'));
    mkdirSync(join(path, 'backups/latest.json'));
    const result = store.mutate(mutation(store));
    assert.equal(store.get(result.record.id).title, result.record.title);
    assert.match(store.status().backupError, /Items are saved/);
  } finally { store.close(); }
});

test('committed data survives an abrupt host process stop', async t => {
  const path = directory(t);
  const script = `import { openStore } from './server/store.mjs'; import { entry, mutation } from './tests/helpers.mjs'; const s=openStore(process.argv[1]); s.mutate(mutation(s,entry({title:'Durable before crash'}))); console.log('committed'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Crash fixture did not start')), 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', reject);
  });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const store = openStore(path);
  try { assert.equal(store.records()[0].title, 'Durable before crash'); } finally { store.close(); }
});

test('validation rejects unsafe links, impossible dates and ambiguous backups', () => {
  assert.throws(() => validateRecord(entry({ sourceUrl: 'javascript:alert(1)' })), /http or https/);
  assert.throws(() => validateRecord(entry({ dueDate: '2026-02-30' })), /valid date/);
  assert.throws(() => validateRecord(entry({ title: ' ' })), /title/);
  const r = entry(); assert.throws(() => parseBackup({ format: 'second-brain', version: 1, records: [r, r] }), /duplicate/);
  assert.throws(() => parseBackup({ version: 2, records: [] }), /supported/);
  assert.deepEqual(validateRecord(entry({ tags: [' idea ', 'idea'] })).tags, ['idea']);
});
