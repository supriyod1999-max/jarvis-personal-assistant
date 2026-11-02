import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createFileShares } from '../server/file-shares.mjs';
import { MAX_FILE_BYTES, TRANSFER_CHUNK_BYTES } from '../server/file-transfers.mjs';
import { directory } from './helpers.mjs';

const incoming = bytes => Object.assign(Readable.from([bytes]), { headers: { 'content-length': bytes.length } });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, blockedWrite = []) {
  const root = directory(t), data = directory(t);
  const make = () => createFileShares({ directory: data, discoverDrives: async () => [{ id: 'drive-test', path: root, label: 'Synthetic drive' }], blockedWrite });
  const files = make(); await files.status(false);
  return { root, data, files, make, input: size => ({ id: randomUUID(), share: 'drive-test', path: '', name: 'synthetic.bin', size }) };
}

test('resumable chunks survive restart, reconcile a lost acknowledgement, and finish exactly once', async t => {
  const f = await fixture(t), chunk = Buffer.alloc(TRANSFER_CHUNK_BYTES, 23), tail = Buffer.from('End of synthetic file');
  const input = f.input(chunk.length + tail.length);
  assert.equal((await f.files.status(false)).maximumBytes, 21474836480);
  await f.files.transfers.begin(input, () => true);
  assert.equal((await f.files.transfers.append(input.id, 0, digest(chunk), incoming(chunk), () => true)).offset, chunk.length);
  const restarted = f.make(); await restarted.status(false);
  const saved = await restarted.transfers.begin(input, () => true); assert.equal(saved.offset, chunk.length);
  await assert.rejects(restarted.transfers.append(input.id, 0, digest(chunk), incoming(chunk), () => true), /progress changed/);
  await restarted.transfers.append(input.id, saved.offset, digest(tail), incoming(tail), () => true);
  assert.deepEqual((await readdir(f.root)).filter(name => !name.startsWith('.jarvis-upload-')), []);
  const result = await restarted.transfers.finish(input.id, () => true);
  assert.equal(result.state, 'complete');
  assert.deepEqual(await readFile(join(f.root, input.name)), Buffer.concat([chunk, tail]));
  assert.deepEqual(await restarted.transfers.finish(input.id, () => true), result);
  assert.deepEqual(await readdir(f.root), [input.name]);
});

test('bad hashes, interrupted chunks, stale offsets and revoked access never commit data', async t => {
  const f = await fixture(t), input = f.input(20), data = Buffer.alloc(20, 13);
  await f.files.transfers.begin(input, () => true);
  await assert.rejects(f.files.transfers.append(input.id, 0, '0'.repeat(64), incoming(data), () => true), /integrity/);
  const partial = Object.assign(Readable.from((async function* () { yield data.subarray(0, 5); throw Error('Synthetic disconnect'); })()), { headers: {} });
  await assert.rejects(f.files.transfers.append(input.id, 0, digest(data), partial, () => true), /disconnect/);
  assert.equal((await f.files.transfers.status(input.id, () => true)).offset, 0);
  assert.equal((await readFile(join(f.root, '.jarvis-upload-' + input.id))).length, 0);
  let allowed = true;
  const revoked = Object.assign(Readable.from((async function* () { yield data.subarray(0, 5); allowed = false; yield data.subarray(5); })()), { headers: {} });
  await assert.rejects(f.files.transfers.append(input.id, 0, digest(data), revoked, () => allowed), /Sharing stopped/);
  await assert.rejects(f.files.transfers.status(input.id, () => false), /Sharing stopped/);
  await assert.rejects(f.files.transfers.finish(input.id, () => true), /not complete/);
  await f.files.transfers.cancel(input.id, () => true);
  assert.deepEqual(await readdir(f.root), []);
});

test('twenty GB boundary uses safe integers and rejects excess sizes before any allocation', async t => {
  const f = await fixture(t);
  for (const size of [MAX_FILE_BYTES + 1, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(f.files.transfers.begin(f.input(size), () => true), /20 GB/);
  assert.deepEqual(await readdir(f.root), []);
  // A sparse source exercises 64-bit filesystem sizes without reading/writing 20 GB.
  const source = await open(join(f.root, 'large.bin'), 'w'); await source.truncate(MAX_FILE_BYTES); await source.close();
  const entries = await f.files.list('drive-test', '', () => true);
  assert.equal(entries.entries[0].bytes, MAX_FILE_BYTES);
  const oversized = await open(join(f.root, 'large.bin'), 'r+'); await oversized.truncate(MAX_FILE_BYTES + 1); await oversized.close();
  await assert.rejects(f.files.download('drive-test', 'large.bin', {}, () => true), /20 GB/);
});

test('resume cannot change destination, overwrite a file, escape a drive or enter protected reference folders', async t => {
  const f = await fixture(t), input = f.input(0);
  await writeFile(join(f.root, input.name), 'Existing owner fixture');
  await assert.rejects(f.files.transfers.begin(input, () => true), /already exists/);
  await assert.rejects(f.files.transfers.begin({ ...input, name: '../escape' }, () => true), /20 GB/);
  await assert.rejects(f.files.transfers.begin({ ...input, name: 'new.bin', path: '..' }, () => true));
  input.name = 'empty.bin'; await f.files.transfers.begin(input, () => true);
  await assert.rejects(f.files.transfers.begin({ ...input, name: 'another.bin' }, () => true), /different file/);
  await writeFile(join(f.root, input.name), 'Later owner fixture');
  await assert.rejects(f.files.transfers.finish(input.id, () => true), /already exists/);
  await f.files.transfers.cancel(input.id, () => true);
  assert.equal(await readFile(join(f.root, input.name), 'utf8'), 'Later owner fixture');
  const reference = join(f.root, 'reference'); await mkdir(reference);
  const blocked = createFileShares({ directory: directory(t), discoverDrives: async () => [{ id: 'drive-test', path: f.root, label: 'Synthetic drive' }], blockedWrite: [reference] }); await blocked.status(false);
  await assert.rejects(blocked.transfers.begin({ ...f.input(0), path: 'reference' }, () => true), /cannot be changed/);
});
