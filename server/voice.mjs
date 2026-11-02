import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = resolve(root, 'data/voice-models/hub/models--ResembleAI--chatterbox-turbo/snapshots/749d1c1a46eb10492095d68fbcf55691ccf137cd');
const kokoro = resolve(root, 'data/voice-models/kokoro');
const reference = resolve(root, 'data/voice-reference/current.wav');
const engines = {
  kokoro: { name: 'Kokoro 82M', voice: 'Daniel · British English', voiceId: 'bm_daniel', device: 'cpu', python: resolve(root, 'integrations/kokoro/.venv/Scripts/python.exe'), worker: 'server/kokoro_worker.py', downloaded: () => existsSync(resolve(kokoro, 'manifest.json')) && ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-gb-en.txt'].every(name => existsSync(resolve(kokoro, 'kokoro-int8-multi-lang-v1_0', name))) },
  'kokoro-gpu': { name: 'Kokoro 82M', voice: 'Daniel · British English', voiceId: 'bm_daniel', device: 'cuda', python: resolve(root, 'integrations/kokoro-gpu/.venv/Scripts/python.exe'), worker: 'server/kokoro_worker.py', args: ['--provider', 'cuda'], downloaded: () => existsSync(resolve(kokoro, 'manifest.json')) && existsSync(resolve(root, 'data/voice-models/kokoro-gpu/model.onnx')) },
  chatterbox: { name: 'Chatterbox Turbo', voice: 'Your reference voice', device: 'cuda', python: resolve(root, 'integrations/chatterbox/.venv/Scripts/python.exe'), worker: 'server/voice_worker.py', downloaded: () => ['t3_turbo_v1.safetensors', 's3gen_meanflow.safetensors', 've.safetensors', 'conds.pt'].every(name => existsSync(resolve(checkpoint, name))) },
};
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

async function stopWorker(worker) {
  if (!worker) return;
  worker.stdin.end();
  if (process.platform !== 'win32' || !Number.isInteger(worker.pid)) { worker.kill(); return; }
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  // Windows venv python.exe launches a child interpreter. Stop only this tree.
  await new Promise((resolveStop, reject) => {
    const killer = spawn(resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.on('error', () => reject(failure('The previous voice worker could not be stopped. Restart JARVIS before switching models.')));
    killer.on('close', code => code === 0 || worker.exitCode !== null || worker.signalCode !== null ? resolveStop() : reject(failure('The previous voice worker is still running. Restart JARVIS before switching models.')));
  });
}

export function voiceModels() {
  return Object.entries(engines).map(([id, model]) => ({ id, name: model.name, voice: model.voice, device: model.device, available: existsSync(model.python) && model.downloaded() }));
}

export function createVoice({ engine = 'kokoro-gpu', executable, launch = spawn, timeoutMs = 180000, idleMs = 600000 } = {}) {
  const selected = engines[engine];
  if (!selected) throw new Error('Unsupported local voice engine.');
  executable ??= selected.python;
  let child = null, pending = null, buffer = '', state = 'idle', message = '', timer, idle;
  let closed = false, warming = null, gpuMemoryDeltaMiB;
  let cleanup = Promise.resolve();
  function retire(worker) { cleanup = cleanup.then(() => stopWorker(worker)); void cleanup.catch(() => {}); return cleanup; }
  const installed = () => existsSync(executable);
  const downloaded = () => executable !== selected.python || selected.downloaded();
  function status() {
    return { engine: selected.name, voice: engine === 'chatterbox' && !existsSync(reference) ? 'Built-in voice' : selected.voice, ...(selected.voiceId ? { voiceId: selected.voiceId } : {}), device: selected.device, ...(gpuMemoryDeltaMiB ? {gpuMemoryDeltaMiB} : {}), state: !installed() || !downloaded() ? 'unavailable' : state, message: !downloaded() ? 'The local voice model download needs to finish.' : message, local: true };
  }
  function settle(error, bytes) {
    const job = pending; pending = null; clearTimeout(timer);
    if (job) { job.signal?.removeEventListener('abort', job.abort); error ? job.reject(error) : job.resolve(bytes); }
    clearTimeout(idle);
    if (child && idleMs > 0) idle = setTimeout(() => { const old = child; child = null; state = 'idle'; void retire(old); }, idleMs).unref();
  }
  function fail(text) {
    state = 'error'; message = text;
    const old = child; child = null; void retire(old);
    settle(failure(text));
  }
  async function start() {
    try { await cleanup; } catch { return fail('The previous voice worker could not be stopped. Restart JARVIS.'); }
    if (closed || !pending) return;
    state = 'loading'; message = ''; buffer = ''; gpuMemoryDeltaMiB = undefined;
    // No Hermes/OpenAI credentials or API keys are inherited by this process.
    const env = {};
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
    env.PYTHONUNBUFFERED = '1'; env.PYTHONIOENCODING = 'utf-8';
    const args = [resolve(root, selected.worker), ...(selected.args || [])];
    if (engine === 'chatterbox' && existsSync(reference)) args.push('--reference', reference);
    const worker = launch(executable, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = worker;
    let diagnosticsTail='';
    worker.stderr.on('data', bytes => {
      // Never log diagnostics: libraries can include supplied text. Refuse CUDA-to-CPU fallback.
      if(engine==='kokoro-gpu'&&child===worker){const text=diagnosticsTail+bytes.toString('utf8');diagnosticsTail=text.slice(-128);if(/fall\s*back\s+to\s+cpu/i.test(text))fail('Kokoro GPU acceleration was unavailable. CPU fallback was refused.');}
    });
    worker.stdin.on('error', () => { if (child === worker) fail('The local voice process disconnected. Try again.'); });
    worker.on('error', () => { if (child === worker) fail('Local speech could not start. Check the voice installation.'); });
    worker.on('exit', () => { if (child === worker) fail('Local speech stopped. Try the spoken reply again.'); });
    worker.stdout.on('data', chunk => {
      if (child !== worker) return;
      buffer += chunk.toString('utf8');
      if (buffer.length > 16000000) return fail('The spoken reply exceeded the local audio limit.');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let event; try { event = JSON.parse(line); } catch { return fail('Local speech returned an unreadable response.'); }
        if (event.type === 'ready') {
          if(engine==='kokoro-gpu'){
            if(event.device!=='cuda'||!Number.isFinite(event.gpuMemoryDeltaMiB)||event.gpuMemoryDeltaMiB<16)return fail('Kokoro GPU allocation could not be confirmed. CPU fallback was refused.');
            gpuMemoryDeltaMiB=event.gpuMemoryDeltaMiB;
          }
          state = pending ? 'generating' : 'ready';
          if (pending?.warm) { state = 'ready'; settle(null, status()); }
          else if (pending) worker.stdin.write(JSON.stringify({ id: pending.id, text: pending.text, voice: pending.voice, speed: pending.speed, style: pending.style }) + '\n');
        } else if (event.type === 'error') {
          return fail('Local speech could not finish. Check the voice installation and try again.');
        } else if (event.type === 'audio' && event.id === pending?.id) {
          const bytes = Buffer.from(event.wav || '', 'base64');
          if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return fail('Local speech returned invalid audio.');
          state = 'ready'; settle(null, bytes);
        }
      }
    });
  }
  function warm() {
    if (closed || !installed() || !downloaded()) return Promise.reject(failure('The local voice installation is incomplete.'));
    if (child && state === 'ready') return Promise.resolve(status());
    if (warming) return warming;
    if (pending) return Promise.reject(failure('Voice is busy. Try Talk mode in a moment.', 429));
    clearTimeout(idle);
    warming = new Promise((resolveJob, reject) => {
      pending = { warm: true, resolve: resolveJob, reject };
      timer = setTimeout(() => fail('Voice could not warm up. Try Talk mode again.'), timeoutMs).unref();
      start();
    }).finally(() => { warming = null; });
    return warming;
  }
  function speak(input, signal) {
    const voice = input?.voice ?? 'bm_daniel', speed = input?.speed ?? 1, style = input?.style ?? 'natural';
    if (!['bm_daniel','af_heart','af_bella','am_puck'].includes(voice) || !['natural','pet'].includes(style) || !Number.isFinite(speed) || speed < .9 || speed > 1.12) return Promise.reject(failure('Choose an available pet voice and a supported speaking speed.', 400));
    if (engine === 'chatterbox' && (voice !== 'bm_daniel' || speed !== 1 || style !== 'natural')) return Promise.reject(failure('Pet voice choices require your selected Kokoro engine. No model was switched.', 409));
    if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 600) return Promise.reject(failure('Use between 1 and 600 characters per spoken segment.', 400));
    if (closed || !installed()) return Promise.reject(failure('The local voice runtime is not installed on this computer yet.'));
    if (!downloaded()) return Promise.reject(failure('The local voice model download needs to finish. Your written reply is kept.'));
    if (warming) return warming.then(() => speak(input, signal));
    if (pending) return Promise.reject(failure('Local speech is finishing another segment. Try again in a moment.', 429));
    if (signal?.aborted) return Promise.reject(failure('Speech playback was cancelled.', 499));
    clearTimeout(idle);
    return new Promise((resolveJob, reject) => {
      const job = { id: randomUUID(), text: input.text.trim(), voice, speed, style, resolve: resolveJob, reject, signal, abort: () => reject(failure('Speech playback was cancelled.', 499)) };
      pending = job; signal?.addEventListener('abort', job.abort, { once: true });
      timer = setTimeout(() => fail('Local speech took too long. Try again after checking the voice service.'), timeoutMs).unref();
      if (!child) start();
      else if (state === 'ready') { state = 'generating'; child.stdin.write(JSON.stringify({ id: job.id, text: job.text, voice: job.voice, speed: job.speed, style: job.style }) + '\n'); }
    });
  }
  async function close() { closed = true; clearTimeout(timer); clearTimeout(idle); const old = child; child = null; settle(failure('Voice service is stopping.')); await retire(old); }
  return { status, speak, warm, close };
}
