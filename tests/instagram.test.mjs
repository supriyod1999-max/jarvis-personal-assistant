import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { directory } from './helpers.mjs';
import { createInstagram, reelIdentity } from '../server/instagram.mjs';
import { savedInstagramUrl } from '../server/instagram-browser.mjs';
import { createReelUnderstanding } from '../server/reel-understanding.mjs';

const url = 'https://www.instagram.com/reel/ABCDE123/';
const receipt = { shortcode: 'ABCDE123', sha256: 'a'.repeat(64), audioVideoDecodePassed: true };
const browser = { signIn: async () => ({}), collect: async () => ({ items: [{ url, collections: ['Ideas'] }, { url: url + '?share=1', collections: ['Recipes'] }], partial: true }), close: async () => {} };
test('Instagram URL identity ignores trackers and rejects arbitrary URLs, credentials and profile paths', () => {
  assert.deepEqual(reelIdentity(url + '?share=private'), { code: 'ABCDE123', url });
  for (const value of ['http://www.instagram.com/reel/ABCDE123/', 'https://evil.test/reel/ABCDE123/', 'https://name:pass@www.instagram.com/reel/ABCDE123/', 'https://www.instagram.com/accounts/login/']) assert.throws(() => reelIdentity(value));
  assert.equal(savedInstagramUrl('https://instagram.com/example/saved/?x=1'), 'https://www.instagram.com/example/saved/');
  assert.throws(() => savedInstagramUrl('https://127.0.0.1/example/saved/'));
});

test('collection sync merges duplicate reel membership, queues once and survives restart', async t => {
  const path = directory(t); let downloads = 0;
  const options = { directory: path, browser, timers: false, download: async () => { downloads++; return receipt; } };
  let library = createInstagram(options);
  library.configure({ savedUrl: 'https://www.instagram.com/example/saved/', daily: true });
  await library.sync(); await library.drain();
  assert.equal(downloads, 1); assert.deepEqual(library.list()[0].collections, ['Ideas', 'Recipes']); assert.equal(library.status().state, 'partial');
  await library.close(); library = createInstagram(options);
  try { await library.sync(); await library.drain(); assert.equal(downloads, 1); assert.equal(library.list().length, 1); assert.equal(library.status().daily, true); }
  finally { await library.close(); }
});

test('interrupted downloads recover and disconnected sync preserves library without claiming success', async t => {
  const path = directory(t); let library = createInstagram({ directory: path, browser, timers: false, download: async () => receipt });
  library.queue({ url }); await library.drain(); await library.close();
  const db = new DatabaseSync(join(path, 'instagram/library.sqlite')); db.exec("UPDATE reels SET state='downloading'"); db.close();
  library = createInstagram({ directory: path, timers: false, browser: { ...browser, collect: async () => { throw new Error('login'); } }, download: async () => receipt });
  try { assert.equal(library.list()[0].state, 'queued'); await library.drain(); library.configure({ savedUrl: 'https://www.instagram.com/example/saved/', daily: false }); await library.sync(); assert.equal(library.status().state, 'needs_attention'); assert.equal(library.status().lastSync, null); assert.equal(library.list()[0].state, 'downloaded'); }
  finally { await library.close(); }
});

test('audio checkpoints survive analysis failure; changed media invalidates evidence; discussion never guesses', async t => {
  const path = directory(t); let audioCalls = 0, shouldFail = true, content;
  const options = { directory: path, extract: async () => ({ sha256: receipt.sha256, chunks: [{ seconds: 0, wav: 'synthetic' }], frames: [{ seconds: 1, jpeg: 'YWJj' }] }), transcribe: async () => { audioCalls++; return { text: 'Build a kitchen garden.' }; }, generate: async value => { content = value; if (shouldFail) throw new Error('provider unavailable'); return JSON.stringify({ title: 'Kitchen garden', summary: 'Growing herbs.', ideas: ['Plant basil'], limitations: 'Measurements unclear' }); } };
  let understanding = createReelUnderstanding(options);
  const reel = { code: receipt.shortcode, url, collections: '["Ideas"]', receipt: JSON.stringify(receipt) };
  assert.equal((await understanding.analyse(reel)).state, 'failed'); await understanding.close();
  shouldFail = false; understanding = createReelUnderstanding(options);
  try { assert.equal((await understanding.analyse(reel)).state, 'ready'); assert.equal(audioCalls, 1); assert.equal(content[1].type, 'input_image'); assert.match(understanding.get(reel.code).analysis.coverage, /sampled frames/); await understanding.analyse(reel); assert.equal(audioCalls, 1); const changed = { ...reel, receipt: JSON.stringify({ ...receipt, sha256: 'b'.repeat(64) }) }; assert.equal((await understanding.analyse(changed)).state, 'failed'); assert.equal(understanding.get(reel.code).analysis, null); }
  finally { await understanding.close(); }
});

test('reel discussion uses bounded analyses and never calls the model for unanalysed sources', async t => {
  const path = directory(t); let called = 0, ready = false;
  const library = createInstagram({ directory: path, browser, timers: false, download: async () => receipt, generate: async prompt => { called++; assert.match(prompt, /UNTRUSTED/); assert.match(prompt, /Recipes/); return 'A basil idea from the saved reel.'; }, understanding: { get: () => ({ state: ready ? 'ready' : 'not_analysed', analysis: ready ? { title: 'Basil', summary: 'Plant basil' } : null }), close: async () => {} } });
  try { library.queue({ url, collections: ['Recipes'] }); await library.drain(); assert.match(await library.discuss('Recipes'), /haven’t been understood/); assert.equal(called, 0); ready = true; assert.match(await library.discuss('Recipes'), /basil/); assert.equal(called, 1); }
  finally { await library.close(); }
});
