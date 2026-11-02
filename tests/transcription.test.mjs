import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createTranscription, decodeRecording } from '../server/transcription.mjs';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
function recording(silent = false) {
  const wav = Buffer.alloc(32044); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  if (!silent) for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(5000, i);
  return { wav: wav.toString('base64') };
}
test('transcription rejects malformed, oversized and non-PCM recordings and detects silence', () => {
  assert.equal(decodeRecording(recording()).silent, false); assert.equal(decodeRecording(recording(true)).silent, true);
  for (const input of [{}, { wav: '!!' }, { wav: 'x'.repeat(1280061) }, { wav: Buffer.alloc(100).toString('base64') }]) assert.throws(() => decodeRecording(input), error => error.status === 400);
  const bad = Buffer.from(recording().wav, 'base64'); bad.writeUInt32LE(48000, 24); assert.throws(() => decodeRecording({ wav: bad.toString('base64') }));
});
function fixture() {
  let killed = 0, launched = 0, args, pending, options;
  const launch = (exe, parameters, settings) => {
    launched++; args = parameters; options = settings;
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { killed++; child.emit('exit'); }; return child;
  };
  const request = async (url, opts) => {
    if (url.endsWith('/health')) return { ok: true };
    return new Promise((resolve, reject) => {
      pending = () => resolve({ ok: true, json: async () => ({ text: ' A local transcript. ' }) });
      opts.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  };
  return { launch, request, finish: () => pending(), get killed() { return killed; }, get launched() { return launched; }, get args() { return args; }, get options() { return options; } };
}
const tick = () => new Promise(done => setImmediate(done));
test('local transcription reuses one private worker, bounds concurrency and cancels without stale text', async t => {
  const io = fixture(); const service = createTranscription({ executable: process.execPath, model: process.execPath, launch: io.launch, request: io.request, portFor: async () => 14339 }); t.after(() => service.close());
  await service.warm(); assert.equal(service.status().state, 'ready'); assert.ok(io.args.includes('127.0.0.1')); assert.ok(io.args.includes('--request-path')); assert.equal(io.options.env.OPENAI_API_KEY, undefined);
  const first = service.transcribe(recording()); await tick(); await assert.rejects(service.transcribe(recording()), e => e.status === 429); io.finish(); assert.equal((await first).text, 'A local transcript.');
  const controller = new AbortController(); const aborted = service.transcribe(recording(), controller.signal); await tick(); controller.abort(); await assert.rejects(aborted, e => e.status === 499); assert.equal(io.killed, 1);
  const retry = service.transcribe(recording()); await tick(); io.finish(); await retry; assert.equal(io.launched, 2);
  assert.equal((await service.transcribe(recording(true))).text, '');
});
test('transcription HTTP shares app authorization, accepts bounded audio and does not cache transcripts', async t => {
  const cleanup = []; const path = directory({ after: fn => cleanup.push(fn) }); let calls = 0;
  const app = createApplication({ port: 14338, directory: path, hermes: fixtureHermes(), privateAccess: null, voice: { status: () => ({ state: 'ready' }), warm: async () => {}, close() {} }, transcription: { status: () => ({ state: 'ready' }), warm: async () => {}, transcribe: async input => { calls++; decodeRecording(input); return { text: 'Synthetic text' }; }, close() {} } });
  app.listen(); await once(app.server, 'listening'); t.after(async () => { await app.close(); cleanup.forEach(fn => fn()); });
  const base = 'http://127.0.0.1:14338/api/voice'; const headers = { 'Content-Type': 'application/json', 'X-Second-Brain': '1' };
  assert.equal((await fetch(base + '/transcribe', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/transcribe', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: JSON.stringify(recording()) })).status, 403);
  const response = await fetch(base + '/transcribe', { method: 'POST', headers, body: JSON.stringify(recording()) }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).text, 'Synthetic text'); assert.equal(calls, 1);
  assert.equal((await fetch(base + '/warm', { method: 'POST', headers, body: '{}' })).status, 200);
});
