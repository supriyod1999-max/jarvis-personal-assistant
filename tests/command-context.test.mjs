import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommandSources } from '../src/commandContext.ts';

const item = (id, fields = {}) => ({ id, rev: 4, deleted: false, status: 'open', ...fields });
test('context and manually attached items share exact bounded revision snapshots', () => {
  const records = [item('project'), item('note')];
  assert.deepEqual(resolveCommandSources(records, ['project', 'note', 'project'], new Set()), [{ id: 'project', rev: 4 }, { id: 'note', rev: 4 }]);
  assert.throws(() => resolveCommandSources(Array.from({ length: 7 }, (_, i) => item(String(i))), ['0','1','2','3','4','5','6'], new Set()), /six items/);
});
test('context cannot silently omit deleted, archived, changed or unsynced records', () => {
  for (const unavailable of [[], [item('a', { deleted: true })], [item('a', { status: 'archived' })]]) {
    assert.throws(() => resolveCommandSources(unavailable, ['a'], new Set()), /no longer available/);
  }
  assert.throws(() => resolveCommandSources([item('a')], ['a'], new Set(['a'])), /Sync/);
  assert.throws(() => resolveCommandSources([item('a', { rev: 0 })], ['a'], new Set()), /Sync/);
  assert.deepEqual(resolveCommandSources([item('a', { rev: 9 })], ['a'], new Set()), [{ id: 'a', rev: 9 }]);
});
