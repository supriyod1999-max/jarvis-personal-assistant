import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVoice, voiceModels } from './voice.mjs';

const error = (message, status = 503) => Object.assign(new Error(message), { status });
const valid = new Set(['kokoro-gpu', 'kokoro', 'chatterbox']);

// One host-wide selection and worker, shared by all personal workspaces/listeners.
export function createVoiceService({ directory, idleMs, createWorker = createVoice, choices = voiceModels } = {}) {
  const file = join(directory, 'voice-output.json');
  let selected = 'kokoro-gpu', revision = 0, configurationError = '', current = null, transition = null, closed = false;
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !valid.has(saved.engine) || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw Error();
      selected = saved.engine; revision = saved.revision;
    } catch { configurationError = 'The saved voice setting could not be read. Choose and apply a voice model again.'; }
  }
  const status = () => {
    const choice = choices().find(item => item.id === selected);
    return { engine: choice?.name, voice: choice?.voice, device: choice?.device, local: true,
      ...(current?.status() || { state: choice?.available ? 'idle' : 'unavailable', message: '' }),
      selected, revision,
      ...(configurationError ? { state: 'error', message: configurationError } : {}),
      ...(transition ? { state: 'restarting', message: 'Restarting speech with the selected model…' } : {}) };
  };
  const models = () => ({ selected, revision, models: choices(), output: status(), shared: true });
  function worker() {
    if (closed) throw error('Voice service is stopping.');
    if (transition) throw error('Speech is restarting. Try again when the selected voice is ready.');
    if (configurationError) throw error(configurationError);
    current ??= createWorker({ engine: selected, ...(idleMs === undefined ? {} : { idleMs }) });
    return current;
  }
  async function select(input, authorized = () => true) {
    if (!input || Object.keys(input).some(key => !['engine', 'baseRevision'].includes(key)) || !valid.has(input.engine) || !Number.isSafeInteger(input.baseRevision)) throw error('Choose one of the installed voice models.', 400);
    if (closed) throw error('Voice service is stopping.');
    if (transition) throw error('A voice restart is already in progress.', 409);
    if (input.baseRevision !== revision) throw error('The voice model changed elsewhere. Refresh and choose again.', 409);
    if (!authorized()) throw error('Unlock the primary JARVIS workspace to change the voice model.', 401);
    if (['loading', 'generating'].includes(current?.status().state)) throw error('Wait for speech to finish before changing voice models.', 409);
    if (!choices().some(choice => choice.id === input.engine && choice.available)) throw error('This voice model is not installed. Choose an available model.');
    if (input.engine === selected && current?.status().state === 'ready' && !configurationError) return models();
    const apply = async () => {
      // Never construct or warm the replacement until the previous process tree exits.
      await current?.close(); current = null;
      if (closed || !authorized()) throw error('Voice change cancelled. Unlock the primary workspace and try again.', 401);
      const next = { version: 1, engine: input.engine, revision: revision + 1 };
      mkdirSync(directory, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 }); renameSync(file + '.tmp', file);
      selected = next.engine; revision = next.revision; configurationError = '';
      current = createWorker({ engine: selected, ...(idleMs === undefined ? {} : { idleMs }) });
      try { await current.warm(); }
      catch { configurationError = 'Your voice choice was saved, but it could not start. Apply again to retry or choose another model.'; }
    };
    transition = apply();
    try { await transition; }
    catch (failure) { configurationError = failure.message || 'Voice restart could not finish. Restart JARVIS before trying again.'; throw failure; }
    finally { transition = null; }
    return models();
  }
  return { status, models, select,
    warm: async () => worker().warm(), speak: async (input, signal) => worker().speak(input, signal),
    async close() { closed = true; await transition?.catch(() => {}); await current?.close(); current = null; },
  };
}
