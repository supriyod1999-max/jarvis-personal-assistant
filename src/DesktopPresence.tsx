import {VoiceFocus} from './voiceFocus';
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Code2, LockKeyhole, Mic, MicOff, Moon, PanelTop } from 'lucide-react';
import AiOrb, { type OrbState } from './AiOrb';
import { useTalk } from './useTalk';
import { wakeCommand, sleepCommand, microphoneOffCommand } from './wakeWords';
import { useIslandPresentation } from './useIslandPresentation';
import CodingSessions, { useCodingSessions, type CodingBridge } from './CodingSessions';
import IslandUnlock from './IslandUnlock';
import './presence.css';

type Config = { enabled: boolean; mode: 'orb' | 'island' };
type Bridge = CodingBridge & { ready: () => Promise<Config>; report: (state: { awake: boolean; phase: string; error: string; presentation: string; detail: string; panel?: string; reducedMotion: boolean }) => Promise<void>; disable: () => Promise<void>; open: () => Promise<void>; wake: () => Promise<void>; onConfig: (callback: (value: Config) => void) => () => void };
declare global { interface Window { jarvisPresence?: Bridge } }
async function api(path: string, value?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/' + path, { signal, cache: 'no-store', ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(value) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'JARVIS is unavailable.'); return data;
}
export default function DesktopPresence({ locked = false }: { locked?: boolean }) {
  const bridge = window.jarvisPresence;
  const [rawConfig, setConfig] = useState<Config>({ enabled: false, mode: 'island' });
  const config: Config = locked ? { enabled: false, mode: 'island' } : rawConfig;
  const [configured, setConfigured] = useState(false);
  const [controlError, setControlError] = useState('');
  const [panel, setPanel] = useState<'assistant' | 'coding' | 'unlock'>('assistant');
  const returnPanel = useRef<'assistant' | 'coding'>('assistant'), lockedRef = useRef(locked); lockedRef.current = locked;
  const coding = useCodingSessions(bridge, locked);
  const [awake, setAwake] = useState(false), awakeRef = useRef(false);
  const [caption, setCaption] = useState('Say “Hey JARVIS”'), [heard, setHeard] = useState('');
  const focus=useRef<VoiceFocus|null>(null);
  const conversation = useRef(crypto.randomUUID()), after = useRef<string | null>(null);
  const talk = useTalk({ available: !locked, background: !!bridge, greetOnStart: false, wakeOnly: !awake, submit });
  const island = useIslandPresentation({ ...config, awake, phase: talk.phase, level: talk.level });
  const detail = caption.length > 260 ? 'long' : heard || caption.length > 90 ? 'regular' : 'short';
  const wave = useRef<HTMLSpanElement>(null);
  function closeUnlock() { setPanel(returnPanel.current); }
  function openUnlock() { returnPanel.current = panel === 'coding' ? 'coding' : 'assistant'; setPanel('unlock'); island.expand(); }
  function wake() { awakeRef.current = true; setAwake(true); setHeard(''); setCaption('I’m listening. What’s on your mind?'); }
  function sleep() {
    focus.current?.close();focus.current=null;
    awakeRef.current = false; setAwake(false); setHeard(''); setCaption('Say “Hey JARVIS”');
    conversation.current = crypto.randomUUID(); after.current = null;
  }
  async function submit(text: string, signal: AbortSignal, update: (text: string, final: boolean) => void) {
    if (!awakeRef.current) {
      const command = wakeCommand(text);
      if (command === null) return; // Ambient transcripts stay local and are discarded, never sent to chat or saved.
      if(!focus.current){const lease=new VoiceFocus(()=>{talk.end('Voice coordination lost. Start listening again to reconnect.');sleep();});focus.current=lease;try{if(!await lease.claim()){lease.close();if(focus.current===lease)focus.current=null;setCaption('Another device is answering.');return;}}catch(error){lease.close();if(focus.current===lease)focus.current=null;throw error;}if(signal.aborted){lease.close();if(focus.current===lease)focus.current=null;return;}}
      awakeRef.current = true; setAwake(true); setHeard('');
      if (!command) { const welcome = 'At your service. How can I help?'; setCaption(welcome); update(welcome, true); return; }
      text = command;
    }
    if (microphoneOffCommand(text)) { await bridge?.disable(); return; }
    if (sleepCommand(text)) { sleep(); return; }
    const repeatedWake = wakeCommand(text);
    if (repeatedWake !== null) { if (!repeatedWake) { setCaption('I’m listening.'); update('I’m listening.', true); return; } text = repeatedWake; }
    setHeard(text); setCaption('Thinking…');
    const health = await api('health', undefined, signal);
    const request = { id: crypto.randomUUID(), serverId: health.serverId, conversationId: conversation.current, afterTurnId: after.current, message: text, sources: [], voice: true, reasoning: 'low', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const cancel = () => void api('chat/cancel', { id: request.id, serverId: request.serverId }).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    let stream: EventSource | undefined;
    try {
      await api('chat/send', request, signal); // Never retry an ambiguous submission automatically.
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => { stream?.close(); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
        const aborted = () => finish(new Error('Conversation stopped.'));
        if (signal.aborted) return aborted();
        signal.addEventListener('abort', aborted, { once: true });
        stream = new EventSource('/api/chat/events?id=' + request.conversationId);
        stream.onmessage = event => {
          try {
            const turn = JSON.parse(event.data).turns?.find((item: { id: string }) => item.id === request.id);
            if (!turn) return;
            setCaption(turn.reply || 'Thinking…'); update(turn.reply || '', turn.status === 'complete');
            if (turn.status !== 'running') { after.current = request.id; finish(turn.status === 'complete' ? undefined : new Error(turn.error || 'The reply stopped.')); }
          } catch { finish(new Error('The reply could not be read. Open JARVIS to review its saved status.')); }
        };
        stream.onerror = () => finish(new Error('Connection interrupted. Your words were not resent. Open JARVIS to review the conversation.'));
      });
    } catch (error) { cancel(); throw error; }
    // Playback outlasts SSE completion; its abort must still invalidate review.
    finally { stream?.close(); }
  }
  useEffect(() => {
    if (!bridge) return;
    document.documentElement.classList.add('presence-document');
    const receive = (value: Config) => setConfig(lockedRef.current ? { enabled: false, mode: 'island' } : value);
    const remove = bridge.onConfig(receive); void bridge.ready().then(value => { receive(value); setConfigured(true); }).catch(() => { setControlError('Open JARVIS to reconnect the island.'); setConfigured(true); });
    return () => { remove(); document.documentElement.classList.remove('presence-document'); };
  }, []);
  useEffect(() => { if (config.enabled) { setControlError(''); void talk.start(); } else { talk.end(); sleep(); } }, [config.enabled]);
  useEffect(() => { if (bridge && configured) void bridge.report({ awake, phase: talk.phase, error: talk.error, presentation: island.presentation, detail, panel, reducedMotion: island.reducedMotion }); }, [configured, awake, talk.phase, talk.error, island.presentation, detail, panel, island.reducedMotion]);
  useEffect(() => { if (awake) setPanel('assistant'); }, [awake]);
  useEffect(()=>()=>{focus.current?.close();focus.current=null;},[]);
  useEffect(() => {
    if (!awake) return;
    if (talk.phase === 'off' || talk.phase === 'muted') { sleep(); return; }
    if (talk.phase !== 'listening') return;
    let lastSpeech = Date.now();
    const timer = setInterval(() => {
      if (talk.level.current > .025) lastSpeech = Date.now();
      else if (Date.now() - lastSpeech > 20000) sleep();
    }, 500);
    return () => clearInterval(timer);
  }, [awake, talk.phase]);
  useEffect(() => { if (locked) setConfig({ enabled: false, mode: 'island' }); }, [locked]);
  useEffect(() => { if (panel === 'unlock' && (!locked || island.presentation !== 'expanded')) closeUnlock(); }, [locked, panel, island.presentation]);
  useEffect(() => {
    if (!config.enabled || !awake || !['listening', 'speaking'].includes(talk.phase) || island.reducedMotion) { wave.current?.style.setProperty('--level', '0'); return; }
    let frame = 0, last = 0;
    const measure = (now: number) => { if (now - last > 32) { wave.current?.style.setProperty('--level', String(Math.min(1, talk.level.current * 2))); last = now; } frame = requestAnimationFrame(measure); };
    frame = requestAnimationFrame(measure); return () => cancelAnimationFrame(frame);
  }, [config.enabled, awake, talk.phase, island.reducedMotion]);
  useEffect(() => {
    if (!awake || talk.phase !== 'listening') return;
    const timer = setTimeout(sleep, 45000); return () => clearTimeout(timer);
  }, [awake, talk.phase, talk.heard]);
  if (!bridge) return <main className="presence-unavailable">Open JARVIS Desktop to use wake words and the floating assistant.</main>;
  const state: OrbState = talk.error ? 'error' : talk.phase === 'preparing' ? 'preparing' : ['thinking', 'transcribing'].includes(talk.phase) ? 'thinking' : talk.phase === 'speaking' ? 'speaking' : awake ? 'listening' : 'ready';
  const compact = config.mode === 'island' && island.presentation === 'compact';
  const codingCount = coding.snapshot.sessions.filter(session => ['working', 'attention'].includes(session.status)).length;
  const status = locked ? 'Locked' : !awake && codingCount ? `Codex · ${codingCount}` : !config.enabled ? 'Mic off' : talk.error ? 'Needs attention' : talk.phase === 'preparing' ? 'Getting ready' : !awake ? 'Wake on'
    : talk.phase === 'speaking' ? 'Speaking' : talk.phase === 'transcribing' ? 'One moment' : talk.phase === 'thinking' ? 'Thinking' : 'Listening';
  return <main className={`desktop-presence ${config.mode} ${awake ? 'awake' : 'asleep'} ${island.presentation} phase-${state} panel-${panel}`} style={{ visibility: configured ? 'visible' : 'hidden' }} data-presentation={island.presentation} aria-label="JARVIS voice presence">
    <div className="presence-shape" onPointerEnter={island.enter} onPointerLeave={island.leave}
      onFocusCapture={event => island.focus(event.target.matches(':focus-visible'))}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) island.focus(false); }}>
      <div className="presence-orb"><AiOrb state={state} level={talk.level} /></div>
      <button className="presence-header" aria-expanded={!compact} aria-controls="presence-detail"
        tabIndex={config.mode === 'orb' ? -1 : 0} disabled={config.mode === 'orb'}
        aria-label={config.mode === 'orb' ? 'JARVIS voice status' : island.presentation === 'expanded' ? 'Collapse JARVIS island' : 'Expand JARVIS island'} onClick={() => { if (panel === 'unlock') closeUnlock(); island.toggle(); }}>
        <span className="presence-name">JARVIS</span><span className="presence-state"><span className="mic-indicator" />{status}</span>
        <span ref={wave} className="presence-wave" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} />)}</span>
        <ChevronUp className="presence-chevron" size={14} />
      </button>
      <div id="presence-detail" className="presence-body" inert={compact} aria-hidden={compact}>
        <IslandUnlock active={locked && panel === 'unlock' && island.presentation === 'expanded'} onClose={closeUnlock} />
        {panel === 'unlock' && locked ? null : panel === 'coding' && island.presentation === 'expanded' ? <><div className="presence-panel-tabs"><button onClick={() => setPanel('assistant')}>Assistant</button><button aria-pressed="true" onClick={() => void coding.refresh()}>Codex</button></div><CodingSessions bridge={bridge} state={coding} unlock={openUnlock} /></> : <><div className="presence-copy">
          {awake && heard && <p className="presence-heard">{heard}</p>}
          <p className="presence-caption" role="status">{locked ? 'Unlock your workspace right here. Your microphone is off.' : controlError || (!config.enabled ? 'Right here when you need me. Open JARVIS or turn on wake listening.' : talk.error || caption)}</p>
        </div>
        <div className="presence-controls">
          {locked ? <button aria-label="Unlock JARVIS" onClick={openUnlock}><LockKeyhole size={14} /><span>Unlock</span></button> : !config.enabled ? <button aria-label="Enable wake listening" onClick={() => { void bridge.wake().catch((e: Error) => setControlError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''))); }}><Mic size={14} /><span>Wake on</span></button>
            : awake ? <button aria-label="Return to wake listening" onClick={() => { talk.interrupt(); sleep(); }}><Moon size={14} /><span>Go to sleep</span></button>
            : <button aria-label="Talk to JARVIS" disabled={!config.enabled || talk.phase !== 'listening'} onClick={wake}><Mic size={14} /><span>Talk to me</span></button>}
          <button aria-label="Open JARVIS" onClick={() => void bridge.open()}><PanelTop size={14} /><span>Open JARVIS</span></button>
          <button aria-label="View coding sessions" onClick={() => { setPanel('coding'); island.expand(); }}><Code2 size={14} /><span>Codex</span></button>
          {config.enabled && <button aria-label="Turn off wake listening" title="Microphone off" onClick={() => void bridge.disable()}><MicOff size={14} /><span>Mic off</span></button>}
        </div>
        </>}
      </div>
      <span className="presence-rim" aria-hidden="true" />
    </div>
  </main>;
}
