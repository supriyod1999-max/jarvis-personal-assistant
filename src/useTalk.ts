import { useEffect, useRef, useState } from 'react';
import { nextSpeech, speechText, wavBase64 } from './talkAudio';
import { runSpeechQueue } from './speechQueue';
import { voiceGreeting } from './voicePersona';

export type TalkPhase = 'off' | 'preparing' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'muted';
type Options = { submit: (text: string, signal: AbortSignal, update: (text: string, final: boolean) => void) => Promise<void>; available: boolean; addressAs?: string; background?: boolean; wakeOnly?: boolean; greetOnStart?: boolean };
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
async function post(path: string, body: unknown, signal: AbortSignal) {
  const response = await fetch('/api/voice/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(body), signal });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'The voice connection could not finish.'); }
  return response;
}

export function useTalk(options: Options) {
  const [phase, setPhase] = useState<TalkPhase>('off');
  const [error, setError] = useState('');
  const [heard, setHeard] = useState('');
  const [silence, setSilence] = useState(1200);
  const [interruptible, setInterruptible] = useState(false);
  const [greet, setGreet] = useState(() => { try { return localStorage.getItem('second-brain-voice-greeting') !== 'off'; } catch { return true; } });
  const level = useRef(0), current = useRef<TalkPhase>('off');
  const config = useRef({ ...options, silence, interruptible, greet }); config.current = { ...options, silence, interruptible, greet };
  const mounted = useRef(true), generation = useRef(0), turnGeneration = useRef(0);
  const context = useRef<AudioContext | null>(null), microphone = useRef<MediaStream | null>(null), capture = useRef<AudioWorkletNode | null>(null);
  const session = useRef<AbortController | null>(null), turn = useRef<AbortController | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null), finish = useRef<(() => void) | null>(null), frame = useRef(0);
  const blocks = useRef<Float32Array[]>([]), preRoll = useRef<Float32Array[]>([]);
  const detector = useRef({ talking: false, voiced: 0, quiet: 0, duration: 0, noise: .003, idle: 0, interrupt: 0, cooldown: 0 });
  const active = () => !!session.current && !session.current.signal.aborted;
  function change(value: TalkPhase) {
    current.current = value; if (mounted.current) setPhase(value);
    microphone.current?.getTracks().forEach(track => { track.enabled = value === 'listening' || (value === 'speaking' && config.current.interruptible); });
  }
  function resetCapture() {
    blocks.current = []; preRoll.current = [];
    detector.current = { talking: false, voiced: 0, quiet: 0, duration: 0, noise: .003, idle: 0, interrupt: 0, cooldown: 0 };
    level.current = 0;
  }
  function stopOutput() {
    cancelAnimationFrame(frame.current);
    const source = playing.current; playing.current = null;
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    finish.current?.(); finish.current = null; level.current = 0;
  }
  function end(message = '') {
    generation.current++; turnGeneration.current++;
    session.current?.abort(); session.current = null; turn.current?.abort(); turn.current = null;
    stopOutput(); capture.current?.disconnect(); if (capture.current) capture.current.port.onmessage = null; capture.current = null;
    microphone.current?.getTracks().forEach(track => track.stop()); microphone.current = null;
    if (context.current) void context.current.close().catch(() => {}); context.current = null;
    resetCapture(); change('off'); if (mounted.current && message) setError(message);
  }
  function interrupt() {
    if (!active()) return;
    turnGeneration.current++; turn.current?.abort(); turn.current = null; stopOutput(); resetCapture(); change('listening');
  }
  function mute() {
    if (!active()) return;
    if (current.current === 'muted') { resetCapture(); change('listening'); return; }
    turnGeneration.current++; turn.current?.abort(); turn.current = null; stopOutput(); resetCapture(); change('muted');
  }
  async function prepare(text: string, signal: AbortSignal, valid: () => boolean) {
    if (!valid()) return;
    const response = await post('speak', { text }, signal);
    const audio = context.current; if (!valid() || !audio) return;
    const buffer = await audio.decodeAudioData(await response.arrayBuffer());
    return valid() ? buffer : undefined;
  }
  async function play(buffer: AudioBuffer | undefined, valid: () => boolean) {
    const audio = context.current; if (!valid() || !audio || !buffer) return;
    const source = audio.createBufferSource(), analyser = audio.createAnalyser(); analyser.fftSize = 512;
    source.buffer = buffer; source.connect(analyser); analyser.connect(audio.destination); playing.current = source;
    const samples = new Uint8Array(analyser.fftSize);
    const measure = () => {
      if (!valid()) return; analyser.getByteTimeDomainData(samples);
      let power = 0; for (const value of samples) power += ((value - 128) / 128) ** 2;
      level.current = Math.min(1, Math.sqrt(power / samples.length) * 5); frame.current = requestAnimationFrame(measure);
    };
    change('speaking'); detector.current.interrupt = 0; detector.current.cooldown = 15;
    await new Promise<void>(resolve => {
      finish.current = resolve;
      source.onended = () => { playing.current = null; finish.current = null; cancelAnimationFrame(frame.current); source.disconnect(); analyser.disconnect(); resolve(); };
      source.start(); measure();
    });
    analyser.disconnect(); if (valid()) { level.current = 0; change('thinking'); }
  }
  async function processUtterance(audio: Float32Array[]) {
    const sessionId = generation.current, turnId = ++turnGeneration.current;
    const controller = new AbortController(); turn.current = controller;
    const signal = AbortSignal.any([session.current!.signal, controller.signal]);
    const valid = () => active() && generation.current === sessionId && turnGeneration.current === turnId && !signal.aborted;
    change('transcribing'); resetCapture();
    try {
      const response = await post('transcribe', { wav: wavBase64(audio) }, signal);
      const result = await response.json(); if (!valid()) return;
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      if (!text) { change('listening'); return; }
      setHeard(text); change('thinking');
      let done = false, problem: unknown = null, consumed = '', queue: string[] = [];
      const update = (reply: string, final: boolean) => {
        if (!valid()) return;
        const spoken = speechText(reply);
        if (!spoken.startsWith(consumed)) { problem = new Error('The reply changed while speaking. The written reply is kept. Start Talk again.'); return; }
        let remaining = spoken.slice(consumed.length), count;
        while ((count = nextSpeech(remaining, final, !consumed.trim())) > 0) {
          const part = remaining.slice(0, count); consumed += part; remaining = remaining.slice(count);
          if (part.trim()) queue.push(part.trim());
        }
      };
      const completion = config.current.submit(text, signal, update).then(() => { done = true; }, issue => { problem = issue; done = true; });
      await runSpeechQueue({ take: () => queue.shift(), done: () => done, valid,
        check: () => { if (problem) throw problem; },
        prepare: chunk => prepare(chunk, signal, valid), play: buffer => play(buffer, valid),
      });
      if (!valid()) return;
      await completion; if (problem) throw problem;
      // Let speaker echo decay before collecting the next utterance.
      await pause(250); if (valid()) { resetCapture(); turn.current = null; change('listening'); }
    } catch (issue) {
      if (valid()) end(issue instanceof Error ? issue.message : 'Talk lost its connection. Start again when ready.');
    }
  }
  function samples(pcm: Float32Array) {
    if (!active()) return;
    if (current.current !== 'listening' && !(current.current === 'speaking' && config.current.interruptible)) return;
    let power = 0; for (const sample of pcm) power += sample * sample;
    const rms = Math.sqrt(power / pcm.length), state = detector.current;
    preRoll.current.push(pcm); if (preRoll.current.length > 15) preRoll.current.shift();
    if (current.current === 'speaking') {
      if (state.cooldown-- > 0) return;
      state.interrupt = rms > .035 ? state.interrupt + 20 : 0;
      if (state.interrupt >= 300) {
        const beginning = [...preRoll.current]; interrupt();
        blocks.current = beginning; detector.current.talking = true; detector.current.voiced = 300;
      }
      return;
    }
    level.current = Math.min(1, rms * 5);
    const voiced = rms > Math.max(.012, state.noise * 3);
    if (!state.talking) {
      state.idle += 20;
      if (!voiced) state.noise = state.noise * .98 + Math.min(rms, .012) * .02;
      state.voiced = voiced ? state.voiced + 20 : 0;
      if (state.voiced >= 180) { state.talking = true; state.duration = 300; blocks.current = [...preRoll.current]; }
      if (!config.current.background && state.idle > 120000) end('Talk ended after two minutes of silence. Start again when ready.');
      return;
    }
    blocks.current.push(pcm); state.duration += 20;
    if (voiced) { state.voiced += 20; state.quiet = 0; } else state.quiet += 20;
    if (state.quiet >= (config.current.wakeOnly ? 650 : config.current.silence) || state.duration >= (config.current.wakeOnly ? 5000 : 28000)) {
      const recording = blocks.current;
      if (state.voiced >= 300) void processUtterance(recording); else resetCapture();
    }
  }
  async function start() {
    if (active()) return;
    end(); setError(''); setHeard('');
    const token = generation.current; session.current = new AbortController(); const signal = session.current.signal;
    const valid = () => active() && token === generation.current;
    change('preparing');
    try {
      if (!config.current.available) throw new Error('Wait for the current reply and connection, then start Talk.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires the private HTTPS app address.');
      // Unlock output during the Start click, before model loading or permission waits.
      const audio = new AudioContext(); context.current = audio; const resumed = audio.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (!valid()) { stream.getTracks().forEach(track => track.stop()); return; }
      microphone.current = stream; stream.getTracks().forEach(track => { track.enabled = false; track.addEventListener('ended', () => { if (valid()) end('The microphone disconnected. Start Talk to reconnect.'); }, { once: true }); });
      await resumed; await audio.audioWorklet.addModule('/talk-capture.js'); if (!valid()) return;
      const processor = new AudioWorkletNode(audio, 'talk-capture'); capture.current = processor;
      processor.onprocessorerror = () => { if (valid()) end('Microphone processing stopped. Start Talk to reconnect.'); };
      audio.createMediaStreamSource(stream).connect(processor); processor.connect(audio.destination);
      processor.port.onmessage = event => { if (valid() && event.data instanceof Float32Array) samples(event.data); };
      await post('warm', {}, signal); if (!valid()) return;
      if (config.current.greetOnStart ?? config.current.greet) {
        const welcomeId = ++turnGeneration.current;
        const controller = new AbortController(); turn.current = controller;
        const welcomeSignal = AbortSignal.any([signal, controller.signal]);
        const welcomeValid = () => valid() && welcomeId === turnGeneration.current && !welcomeSignal.aborted;
        try { await play(await prepare(voiceGreeting(new Date(), config.current.addressAs), welcomeSignal, welcomeValid), welcomeValid); }
        catch (issue) { if (welcomeValid()) throw issue; }
        if (!welcomeValid()) return;
        await pause(250); if (!welcomeValid()) return;
        turn.current = null;
      }
      resetCapture(); change('listening');
    } catch (issue) { if (valid()) end(issue instanceof Error ? issue.message : 'The microphone could not start.'); }
  }
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden && active() && !config.current.background) end('Talk ended when the app left the screen.'); };
    document.addEventListener('visibilitychange', hide);
    const offline = () => { if (active()) end('Connection lost. Talk stopped without resending your words.'); };
    window.addEventListener('offline', offline);
    const nativeVoice = () => { if (active()) end(); };
    window.addEventListener('jarvis:native-voice-start', nativeVoice);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && active()) { event.preventDefault(); end(); } };
    window.addEventListener('keydown', escape);
    return () => { mounted.current = false; end(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('offline', offline); window.removeEventListener('keydown', escape); window.removeEventListener('jarvis:native-voice-start', nativeVoice); };
  }, []);
  return { phase, active: phase !== 'off', error, heard, level, start, end, mute, interrupt, silence, setSilence, interruptible, setInterruptible, greet, setGreet: (value: boolean) => { setGreet(value); try { localStorage.setItem('second-brain-voice-greeting', value ? 'on' : 'off'); } catch {} }, clearError: () => setError('') };
}
