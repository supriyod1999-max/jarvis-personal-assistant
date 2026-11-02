import { useEffect, useRef, useState } from 'react';
import { nextSpeech, speechText, wavBase64 } from './talkAudio';
import { runSpeechQueue } from './speechQueue';

export function useVoice(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const level = useRef(0);
  const media = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const capture = useRef<AudioWorkletNode | null>(null);
  const inputRequest = useRef<AbortController | null>(null);
  const finishRecording = useRef<(() => void) | null>(null);
  const frame = useRef(0);
  const epoch = useRef(0);
  const alive = useRef(true);
  const outputEpoch = useRef(0);
  const playback = useRef<AudioContext | null>(null);
  const output = useRef<AudioBufferSourceNode | null>(null);
  const outputFrame = useRef(0);
  const outputRequest = useRef<AbortController | null>(null);
  const finishAudio = useRef<(() => void) | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcript = useRef(onTranscript); transcript.current = onTranscript;

  function releaseMic() {
    cancelAnimationFrame(frame.current); level.current = 0;
    if (capture.current) { capture.current.port.onmessage = null; capture.current.disconnect(); capture.current = null; }
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    if (audio.current) void audio.current.close().catch(() => {}); audio.current = null;
    clearTimeout(timeout.current);
  }
  function stopListening() {
    epoch.current++; finishRecording.current = null;
    inputRequest.current?.abort(); inputRequest.current = null;
    releaseMic();
    if (alive.current) { setListening(false); setPreparing(false); setTranscribing(false); }
  }
  function stopSpeaking() {
    outputEpoch.current++;
    outputRequest.current?.abort(); outputRequest.current = null;
    if (output.current) { output.current.onended = null; try { output.current.stop(); } catch {} output.current.disconnect(); output.current = null; }
    finishAudio.current?.(); finishAudio.current = null;
    cancelAnimationFrame(outputFrame.current); level.current = 0;
    if (playback.current) void playback.current.close().catch(() => {}); playback.current = null;
    if (alive.current) { setSpeaking(false); setVoiceLoading(false); }
  }
  async function startListening(base: string) {
    if (finishRecording.current) { finishRecording.current(); return; }
    if (preparing || transcribing) { stopListening(); return; }
    stopSpeaking(); stopListening(); setVoiceError(''); setPreparing(true);
    const token = ++epoch.current;
    const valid = () => alive.current && token === epoch.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone access needs the private HTTPS app address. You can still type here.'); setPreparing(false); return;
    }
    try {
      const context = new AudioContext(); audio.current = context; const resumed = context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (!valid()) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      await resumed; await context.audioWorklet.addModule('/talk-capture.js'); if (!valid()) return;
      const processor = new AudioWorkletNode(context, 'talk-capture'); capture.current = processor;
      context.createMediaStreamSource(stream).connect(processor); processor.connect(context.destination);
      const blocks: Float32Array[] = []; let duration = 0, quiet = 0, voiced = 0, finishing = false;
      const finish = async () => {
        if (!valid() || finishing) return;
        finishing = true; finishRecording.current = null; releaseMic(); setListening(false); setPreparing(false);
        if (duration < 360 || voiced < 180) { setVoiceError('I didn’t catch any speech. Tap the orb and try again.'); return; }
        setTranscribing(true);
        const controller = new AbortController(); inputRequest.current = controller;
        try {
          const response = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ wav: wavBase64(blocks) }), signal: controller.signal });
          const result = await response.json(); if (!valid()) return;
          if (!response.ok) throw new Error(result.error || 'Local speech recognition could not finish.');
          const text = typeof result.text === 'string' ? result.text.trim() : '';
          if (text) transcript.current(`${base}${base.trim() ? ' ' : ''}${text}`.slice(0, 8000));
          else setVoiceError('I didn’t catch that. Tap the orb to try again.');
        } catch (error) { if (valid()) setVoiceError(error instanceof Error ? error.message : 'The computer could not transcribe your voice. Your typed draft is kept.'); }
        finally { if (valid()) { setTranscribing(false); inputRequest.current = null; } }
      };
      finishRecording.current = () => { void finish(); };
      processor.port.onmessage = event => {
        if (!valid() || finishing || !(event.data instanceof Float32Array)) return;
        const pcm = event.data; blocks.push(pcm); duration += pcm.length / 16;
        let power = 0; for (const sample of pcm) power += sample * sample;
        const rms = Math.sqrt(power / pcm.length); level.current = Math.min(1, rms * 5);
        if (rms > .012) { voiced += pcm.length / 16; quiet = 0; } else quiet += pcm.length / 16;
        if ((voiced >= 300 && quiet >= 1200) || duration >= 28000) void finish();
      };
      processor.onprocessorerror = () => { if (valid()) { stopListening(); setVoiceError('Microphone processing stopped. Tap the orb to reconnect.'); } };
      stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (valid() && !finishing) { stopListening(); setVoiceError('The microphone disconnected. Your typed draft is kept.'); } }, { once: true });
      timeout.current = setTimeout(() => { if (valid()) void finish(); }, 30000);
      setListening(true); setPreparing(false);
    } catch (error) {
      if (!valid()) return;
      stopListening(); setVoiceError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser or keep typing.' : 'The microphone could not start. Check browser permission, or type your thought.');
    }
  }
  async function speak(text: string) {
    stopListening(); stopSpeaking(); setVoiceError('');
    const token = ++outputEpoch.current;
    const active = () => alive.current && token === outputEpoch.current;
    try {
      // Resume inside the user's click so delayed local synthesis can play on Android.
      const context = new AudioContext(); playback.current = context;
      await context.resume(); if (!active()) return;
      const controller = new AbortController(); outputRequest.current = controller;
      const analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.connect(context.destination);
      const samples = new Uint8Array(analyser.fftSize);
      const measure = () => {
        if (!active()) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0; for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        level.current = Math.min(1, Math.sqrt(sum / samples.length) * 5);
        outputFrame.current = requestAnimationFrame(measure);
      };
      let remaining = speechText(text).trim(); const chunks: string[] = [];
      while (remaining) { const count = nextSpeech(remaining, true, chunks.length === 0); chunks.push(remaining.slice(0, count)); remaining = remaining.slice(count).trimStart(); }
      setVoiceLoading(true); setSpeaking(false);
      await runSpeechQueue({ take: () => chunks.shift(), done: () => true, valid: active,
      prepare: async chunk => {
        const response = await fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ text: chunk }), signal: controller.signal });
        if (!response.ok) { const problem = await response.json(); throw new Error(problem.error || 'Local speech could not generate audio.'); }
        return context.decodeAudioData(await response.arrayBuffer());
      },
      play: async decoded => {
        if (!active()) return;
        const source = context.createBufferSource(); output.current = source;
        source.buffer = decoded; source.connect(analyser);
        setVoiceLoading(false); setSpeaking(true); measure();
        await new Promise<void>(resolve => {
          finishAudio.current = resolve;
          source.onended = () => { cancelAnimationFrame(outputFrame.current); level.current = 0; source.disconnect(); output.current = null; finishAudio.current = null; resolve(); };
          source.start();
        });
        if (active()) { setVoiceLoading(true); setSpeaking(false); }
      } });
      if (active()) stopSpeaking();
    } catch (error) {
      if (active()) { stopSpeaking(); setVoiceError(error instanceof Error ? error.message : 'Spoken playback could not start. Your written reply is kept.'); }
    }
  }
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) { stopListening(); stopSpeaking(); } };
    document.addEventListener('visibilitychange', hidden);
    const nativeVoice = () => { stopListening(); stopSpeaking(); };
    window.addEventListener('jarvis:native-voice-start', nativeVoice);
    return () => { alive.current = false; stopListening(); stopSpeaking(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('jarvis:native-voice-start', nativeVoice); };
  }, []);
  return { listening, preparing, transcribing, speaking, voiceLoading, voiceError, level, startListening, stopListening, speak, stopSpeaking, clearError: () => setVoiceError('') };
}
