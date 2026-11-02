import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledge, overlaySnapshot, recordConflict } from '../shared/sync-state.mjs';
import { entry } from './helpers.mjs';

test('offline changes overlay server snapshots without hiding new remote items', () => {
  const original = entry({ rev: 1 }); const local = { ...original, title: 'Offline edit', rev: 2 }; const other = entry();
  const state = { records: [local], outbox: [{ operationId: 'a', record: local }], conflicts: [] };
  const merged = overlaySnapshot(state, { serverId: 'host', records: [original, other] });
  assert.equal(merged.records.find(r => r.id === local.id).title, 'Offline edit');
  assert.equal(merged.records.length, 2); assert.equal(merged.outbox.length, 1);
});

test('acknowledging an earlier save cannot erase a later queued edit', () => {
  const first = entry({ rev: 1 }); const last = { ...first, title: 'Later edit', rev: 2 };
  const state = { records: [last], outbox: [{ operationId: 'first', record: first }, { operationId: 'last', record: last }] };
  const result = acknowledge(state, 'first', first);
  assert.equal(result.records[0].title, 'Later edit'); assert.equal(result.outbox.length, 1);
  assert.equal(acknowledge(result, 'last', last).outbox.length, 0);
});

test('conflicts preserve the latest local version and stop only that item’s queued writes', () => {
  const first = entry({ rev: 1 }); const last = { ...first, title: 'Latest local', rev: 2 }; const other = entry();
  const remote = { ...first, title: 'Remote edit', rev: 2 };
  const state = { records: [last, other], conflicts: [], outbox: [{ record: first }, { record: last }, { record: other }] };
  const result = recordConflict(state, first.id, remote);
  assert.equal(result.outbox.length, 1); assert.equal(result.outbox[0].record.id, other.id);
  assert.equal(result.conflicts[0].local.title, 'Latest local'); assert.equal(result.conflicts[0].remote.title, 'Remote edit');
  const merged = overlaySnapshot(result, { records: [remote] });
  assert.equal(merged.records.find(r => r.id === first.id).title, 'Latest local');
});
