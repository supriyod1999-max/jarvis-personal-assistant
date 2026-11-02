import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const fastModel = resolve(root, 'data/speech-input/ggml-base.bin');
const openWhisprModels = resolve(homedir(), '.cache/openwhispr/whisper-models');
const defaultModel = () => [resolve(openWhisprModels, 'ggml-base.bin'), fastModel, resolve(openWhisprModels, 'ggml-medium.bin')].find(existsSync) || fastModel;
const fail = (message, status = 503) => Object.assign(new Error(message), { status });
const delay = ms => new Promise(done => setTimeout(done, ms));
export function decodeRecording(input) {
  if (typeof input?.wav !== 'string' || input.wav.length > 1280060 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.wav)) throw fail('Invalid microphone recording.', 400);
  const wav = Buffer.from(input.wav, 'base64');
  if (wav.length < 11244 || wav.length > 960044 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt32LE(4) !== wav.length - 8 || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt32LE(28) !== 32000 || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44 || (wav.length - 44) % 2) throw fail('Use a mono 16 kHz recording between 0.35 and 30 seconds.', 400);
  let energy = 0; for (let i = 44; i < wav.length; i += 2) energy += (wav.readInt16LE(i) / 32768) ** 2;
  return { wav, silent: Math.sqrt(energy / ((wav.length - 44) / 2)) < .003 };
}
async function freePort() {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port; await new Promise(done => probe.close(done)); return port;
}
export function createTranscription({ executable = resolve(root, 'integrations/whisper/whisper-server-win32-x64.exe'), model = defaultModel(), launch = spawn, request = fetch, portFor = freePort, timeoutMs = 90000, idleMs = 600000, directory = resolve(root, 'data/voice-temp') } = {}) {
  let worker = null, base = '', starting = null, state = 'idle', busy = false, closed = false, idle;
  const installed = () => existsSync(executable) && existsSync(model);
  const status = () => ({ engine: basename(model) === 'ggml-base.bin' ? 'Whisper Base' : 'Whisper Medium', state: installed() ? state : 'unavailable', local: true });
  function stop() { clearTimeout(idle); const previous = worker; worker = null; state = 'idle'; previous?.kill(); }
  function armIdle() { clearTimeout(idle); if (idleMs > 0) idle = setTimeout(() => { if (!busy) stop(); }, idleMs).unref(); }
  async function warm() {
    if (closed || !installed()) throw fail('Local transcription is not installed. Check the Whisper setup on your computer.');
    if (starting) return starting;
    if (worker && ['ready', 'transcribing'].includes(state)) { armIdle(); return status(); }
    starting = (async () => {
      const port = await portFor(); if (closed) throw fail('Transcription is stopping.');
      const route = '/' + randomUUID(); base = `http://127.0.0.1:${port}${route}`;
      mkdirSync(directory, { recursive: true });
      const env = {}; for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
      const child = launch(executable, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--request-path', route, '--inference-path', '/transcribe', '--public', directory, '--tmp-dir', directory, '-ng', '-t', '6', '-bo', '1', '-bs', '1', '-sns'], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      worker = child; state = 'loading';
      child.stdout.on('data', () => {}); child.stderr.on('data', () => {}); // Never log recordings or recognised text.
      const lost = () => { if (worker === child) { worker = null; state = 'error'; } };
      child.on('error', lost); child.on('exit', lost);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && worker === child && !closed) {
        try {
          const response = await request(base + '/health', { signal: AbortSignal.timeout(1000) });
          if (response.ok && worker === child && !closed) { state = 'ready'; armIdle(); return status(); }
        } catch { /* Wait for this owned worker to bind its private route. */ }
        await delay(200);
      }
      stop(); state = 'error'; throw fail('Local transcription could not start. Try Talk mode again.');
    })().finally(() => { starting = null; });
    return starting;
  }
  async function transcribe(input, signal) {
    const { wav, silent } = decodeRecording(input);
    if (signal?.aborted) throw fail('Transcription cancelled.', 499);
    if (busy) throw fail('The microphone service is busy. Try again shortly.', 429);
    if (silent) return { text: '', local: true };
    busy = true; clearTimeout(idle);
    const cancel = () => stop(); signal?.addEventListener('abort', cancel, { once: true });
    try {
      await warm();
      if (signal?.aborted) throw fail('Transcription cancelled.', 499);
      state = 'transcribing';
      const form = new FormData(); form.append('file', new Blob([wav], { type: 'audio/wav' }), 'microphone.wav');
      form.append('response_format', 'json'); form.append('temperature', '0.0'); form.append('temperature_inc', '0.0');
      const response = await request(base + '/transcribe', { method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error('Worker failed');
      const result = await response.json();
      if (signal?.aborted) throw fail('Transcription cancelled.', 499);
      if (typeof result.text !== 'string' || result.text.length > 8000) throw new Error('Invalid transcript');
      const text = result.text.replace(/\[[^\]]*\]|\([^)]*(?:music|silence|blank audio)[^)]*\)/gi, '').trim();
      state = 'ready'; return { text, local: true };
    } catch {
      stop(); if (signal?.aborted) throw fail('Transcription cancelled.', 499);
      state = 'error'; throw fail('Local transcription could not finish. Your typed draft is kept; start Talk again.');
    } finally { busy = false; signal?.removeEventListener('abort', cancel); armIdle(); }
  }
  return { status, warm, transcribe, close: async () => { closed = true; stop(); await starting?.catch(() => {}); } };
}
