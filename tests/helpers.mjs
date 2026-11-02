import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const testRoot = resolve('.test-data');
export function directory(t) {
  mkdirSync(testRoot, { recursive: true });
  const path = mkdtempSync(join(testRoot, 'run-'));
  t.after(() => {
    if (!resolve(path).startsWith(testRoot + sep)) throw new Error('Unsafe test cleanup path');
    rmSync(path, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });
  return path;
}
export function entry(fields = {}) {
  return { id: randomUUID(), kind: 'task', title: 'Test task', body: '', status: 'open', priority: 'normal', dueDate: '', birthday: '', tags: [], projectId: '', personId: '', sourceUrl: '', deleted: false, ...fields };
}
export function mutation(store, record = entry(), baseRev = 0) {
  return { operationId: randomUUID(), serverId: store.serverId, record, baseRev };
}
