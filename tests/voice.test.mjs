import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createVoice } from '../server/voice.mjs';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';

const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
function transport(ready = {type:'ready',device:'cuda',gpuMemoryDeltaMiB:128}) {
  let worker, request, options, argumentsUsed, launched = 0;
  const launch = (executable, args, opts) => {
    options = opts; argumentsUsed = args; launched++;
    worker = new EventEmitter(); worker.stdin = new PassThrough(); worker.stdout = new PassThrough(); worker.stderr = new PassThrough();
    worker.kill = () => worker.emit('exit', 0);
    worker.stdin.on('data', line => request = JSON.parse(line));
    queueMicrotask(() => worker.stdout.write(JSON.stringify(ready) + '\n'));
    return worker;
  };
  return { launch, get options() { return options; }, get args() { return argumentsUsed; }, get launched() { return launched; }, get request() { return request; }, diagnostic(text) {worker.stderr.write(text);}, complete() { worker.stdout.write(JSON.stringify({ type: 'audio', id: request.id, wav: wav.toString('base64') }) + '\n'); }, crash() { worker.emit('exit', 1); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('pet voices are request scoped, validated, and never replace the regular Daniel selection',async t=>{
  const io=transport(),voice=createVoice({executable:process.execPath,launch:io.launch});t.after(()=>voice.close());
  await voice.warm();const pet=voice.speak({text:'Hello, friend.',voice:'af_heart',style:'pet'});assert.equal(io.request.voice,'af_heart');assert.equal(io.request.style,'pet');io.complete();await pet;
  const normal=voice.speak({text:'Ready.'});assert.equal(io.request.voice,'bm_daniel');assert.equal(io.request.style,'natural');io.complete();await normal;assert.equal(voice.status().voiceId,'bm_daniel');assert.equal(io.launched,1);
  await assert.rejects(voice.speak({text:'No.',voice:'unapproved'}),error=>error.status===400);
  await assert.rejects(voice.speak({text:'No.',speed:Infinity}),error=>error.status===400);
  await assert.rejects(voice.speak({text:'No.',style:'unknown'}),error=>error.status===400);
  const other=createVoice({engine:'chatterbox',executable:process.execPath,launch:io.launch});t.after(()=>other.close());await assert.rejects(other.speak({text:'No switch.',voice:'af_heart'}),error=>error.status===409);
});
test('warming voice reuses one prepared worker without requesting audible speech', async t => {
  const io = transport(); const voice = createVoice({ executable: process.execPath, launch: io.launch }); t.after(() => voice.close());
  await voice.warm(); assert.equal(voice.status().state, 'ready');
  await voice.warm(); const reply = voice.speak({ text: 'Already warm.' }); io.complete(); await reply;
  assert.equal(io.launched, 1);
});

test('background standby shares warm-up with concurrent clients and stays ready without a tab', async t => {
  const io = transport(); const voice = createVoice({ executable: process.execPath, launch: io.launch, idleMs: 0 }); t.after(() => voice.close());
  await Promise.all([voice.warm(), voice.warm(), voice.warm()]);
  await new Promise(r => setTimeout(r, 40)); assert.equal(voice.status().state, 'ready'); assert.equal(io.launched, 1);
  const reply = voice.speak({ text: 'Ready without a browser.' }); io.complete(); await reply;
  assert.equal(io.launched, 1);
});
test('voice validates input, bounds worker concurrency, keeps a warm worker and recovers after a crash', async t => {
  const io = transport(); const voice = createVoice({ executable: process.execPath, launch: io.launch }); t.after(() => voice.close());
  await assert.rejects(voice.speak({ text: ' ' }), /between/);
  await assert.rejects(voice.speak({ text: 'x'.repeat(601) }), /between/);
  const first = voice.speak({ text: 'Hello.' }); await tick();
  assert.equal(voice.status().state, 'generating');
  await assert.rejects(voice.speak({ text: 'Overlap' }), error => error.status === 429);
  assert.equal(io.options.windowsHide, true); assert.equal(io.options.env.OPENAI_API_KEY, undefined);
  io.complete(); assert.deepEqual(await first, wav);
  const second = voice.speak({ text: 'Again.' }); io.complete(); await second; assert.equal(io.launched, 1);
  const broken = voice.speak({ text: 'Interruption' }); io.crash(); await assert.rejects(broken, /stopped/);
  const retry = voice.speak({ text: 'Recovery' }); await tick(); io.complete(); await retry; assert.equal(io.launched, 2);
});
test('cancelled voice cannot be played, holds the synthesis slot until completion, then permits another request', async t => {
  const io = transport(); const voice = createVoice({ executable: process.execPath, launch: io.launch }); t.after(() => voice.close());
  const controller = new AbortController(); const job = voice.speak({ text: 'Cancel me' }, controller.signal); await tick();
  controller.abort(); await assert.rejects(job, /cancelled/);
  await assert.rejects(voice.speak({ text: 'Too soon' }), error => error.status === 429);
  io.complete(); const next = voice.speak({ text: 'Allowed now' }); io.complete(); await next;
});

test('default local voice uses GPU Daniel without reference audio, credentials or an automatic fallback', async t => {
  const io=transport(),voice=createVoice({executable:process.execPath,launch:io.launch});t.after(()=>voice.close());
  await voice.warm();assert.equal(voice.status().engine,'Kokoro 82M');assert.equal(voice.status().voiceId,'bm_daniel');assert.equal(voice.status().device,'cuda');assert.equal(voice.status().local,true);
  assert.match(io.args[0],/kokoro_worker\.py$/);assert.equal(io.args.includes('--reference'),false);assert.equal(io.options.env.HF_TOKEN,undefined);
  const failed=voice.speak({text:'Synthetic speech.'});io.crash();await assert.rejects(failed,/stopped/);assert.equal(io.launched,1);assert.equal(voice.status().engine,'Kokoro 82M');
  assert.throws(()=>createVoice({engine:'cloud'}),/Unsupported/);
});

test('GPU Daniel requires CUDA allocation proof and refuses native CPU fallback', async t=>{
  const bad=transport({type:'ready',device:'cpu'}),unconfirmed=createVoice({engine:'kokoro-gpu',executable:process.execPath,launch:bad.launch});t.after(()=>unconfirmed.close());
  await assert.rejects(unconfirmed.warm(),/GPU allocation/);assert.equal(unconfirmed.status().state,'error');
  const io=transport({type:'ready',device:'cuda',gpuMemoryDeltaMiB:128}),voice=createVoice({engine:'kokoro-gpu',executable:process.execPath,launch:io.launch});t.after(()=>voice.close());
  await voice.warm();assert.equal(voice.status().device,'cuda');assert.equal(voice.status().gpuMemoryDeltaMiB,128);assert.deepEqual(io.args.slice(1),['--provider','cuda']);assert.equal(io.args.includes('--reference'),false);
  const job=voice.speak({text:'Synthetic GPU check.'});io.diagnostic('Available providers: CPUExecutionProvider. Fallback to cpu!');await assert.rejects(job,/CPU fallback was refused/);assert.equal(io.launched,1);
});
test('voice HTTP routes require the same app origin and request marker, and serve uncached WAV', async t => {
  const cleanup = []; const path = directory({ after: fn => cleanup.push(fn) }); let calls = 0;
  const app = createApplication({ port: 14328, directory: path, hermes: fixtureHermes(), privateAccess: null, voice: { status: () => ({ state: 'ready' }), speak: async () => { calls++; return wav; }, close() {} } });
  app.listen(); await once(app.server, 'listening'); t.after(async () => { await app.close(); cleanup.forEach(fn => fn()); });
  const url = 'http://127.0.0.1:14328/api/voice/speak';
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ text: 'Hello' }) };
  assert.equal((await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://evil.test' } })).status, 403);
  const result = await fetch(url, options); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal(result.headers.get('content-type'), 'audio/wav'); assert.equal(calls, 1); assert.deepEqual(Buffer.from(await result.arrayBuffer()), wav);
});
