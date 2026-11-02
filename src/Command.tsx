import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUp, ArrowUpRight, CalendarDays, Check, FileText, History, Lightbulb, LoaderCircle, MessageCircle, Mic, Plus, RefreshCw, Square, Volume2, X } from 'lucide-react';
import type { Entry, LocalState } from './types';
import AiOrb, { type OrbState } from './AiOrb';
import { useVoice } from './useVoice';
import { useTalk } from './useTalk';
import { voiceGreeting } from './voicePersona';
import HermesHandoff from './HermesHandoff';
import './command-scene.css';
import ModelPicker from './ModelPicker';
import ActionCard from './ActionCard';
import { resolveCommandSources, type CommandContext } from './commandContext';
export type { CommandContext } from './commandContext';

type Source = { id: string; rev: number; title: string; body: string; excerpted: boolean; automatic?: boolean };
type WhatsAppAction = { kind: string; confirmUntil?: number; groups?: { ref: string; label: string; accountName: string }[]; contextSources?: { id: string; rev: number; title: string; body: string; dueDate: string }[]; styleExamplesUsed?: number; lastRun?: { finishedAt?: string } };
type Turn = { id: string; message: string; reply: string; status: 'running' | 'complete' | 'cancelled' | 'error' | 'interrupted'; error: string; sources: Source[]; contextTrimmed: boolean; privacyTag?: string; reasoning?: 'low' | 'high'; model?: string; timings?: { firstTextMs?: number }; provider?: string; action?: WhatsAppAction };
type Conversation = { id: string; title: string; turns: Turn[] };
type Summary = { id: string; title: string; updatedAt: string };
type Status = { state: string; message: string; model: string; provider?: string; active: { id: string; conversationId: string } | null };
type Request = { id: string; serverId: string; conversationId: string; afterTurnId: string | null; message: string; sources: { id: string; rev: number }[]; voice?: boolean; reasoning?: 'low' | 'high'; timeZone?: string };
const LAST_CHAT = 'second-brain-command-chat';
function saved(key: string) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* The server remains authoritative. */ } }
function pendingRequest(key: string): Request | null { try { return JSON.parse(saved(key)) || null; } catch { return null; } }
function initialConversation(key: string) {
  const url = new URL(window.location.href), linked = url.searchParams.get('conversation');
  if (linked && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linked)) {
    return linked;
  }
  return saved(key) || crypto.randomUUID();
}
async function api(path: string, value?: unknown) {
  const response = await fetch(`/api/chat/${path}`, value === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(value) });
  const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || 'The computer could not complete this request.'), { status: response.status }); return data;
}

export default function Command({ state, onOpen, onDraft, suspended = false, addressAs = 'sir', context, onClearContext }: { state: LocalState; onOpen: (entry: Entry) => void; onDraft: (text: string, kind?: 'note' | 'task') => void; suspended?: boolean; addressAs?: string; context?: CommandContext | null; onClearContext?: () => void }) {
  // A contextual Ask opens its own conversation. Removing attachments must not lose its draft.
  const [storageKey, setStorageKey] = useState(() => `${LAST_CHAT}:${state.serverId}${context ? `:context:${context.recordIds[0] || context.label}` : ''}`);
  const [id, setId] = useState(() => context ? saved(storageKey) || crypto.randomUUID() : initialConversation(storageKey));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [list, setList] = useState<Summary[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [reasoning, setReasoning] = useState<'low' | 'high'>('low');
  const [draft, setDraft] = useState(() => saved(`${storageKey}:draft`) || context?.message || '');
  const [contextDismissed, setContextDismissed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [connected, setConnected] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef<Request | null>(pendingRequest(`${storageKey}:pending`));
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDialogElement>(null);
  const talkTurn = useRef<{ id: string; update: (text: string, final: boolean) => void; resolve: () => void; reject: (error: Error) => void } | null>(null);
  const voice = useVoice(text => { setDraft(text); requestRef.current = null; });
  const idRef = useRef(id); idRef.current = id;
  const records = state.records.filter(r => !r.deleted && r.status !== 'archived');
  const pendingIds = new Set([...state.outbox.map(m => m.record.id), ...state.conflicts.map(c => c.id)]);
  const attachedContext = contextDismissed ? null : context;
  const contextIds = [...new Set(attachedContext?.recordIds ?? [])];
  const sourceIds = [...new Set([...contextIds, ...selected])];
  const running = conversation?.turns.find(t => t.status === 'running');
  const blockedByOther = status?.active && status.active.conversationId !== id;
  const canSend = connected && !!state.serverId && status?.state === 'ready' && !running && !blockedByOther && !sending;
  const talk = useTalk({ submit: submitTalk, available: canSend && !draft.trim() && !requestRef.current, addressAs });
  useEffect(() => { if (suspended) { voice.stopListening(); voice.stopSpeaking(); talk.end(); } }, [suspended]);
  useEffect(() => { if (!connected && talk.active) talk.end('The conversation disconnected. Reconnect, then start Talk again.'); }, [connected]);
  const orbState: OrbState = talk.active ? (talk.phase === 'listening' ? 'listening' : talk.phase === 'speaking' ? 'speaking' : talk.phase === 'preparing' ? 'preparing' : talk.phase === 'muted' ? 'ready' : 'thinking') : voice.listening ? 'listening' : voice.speaking ? 'speaking' : voice.preparing || voice.transcribing || voice.voiceLoading ? 'preparing' : !connected ? 'offline' : running || sending ? 'thinking' : voice.voiceError || talk.error || status?.state !== 'ready' ? 'error' : 'ready';
  const coreState = talk.active ? ({ preparing: 'Preparing Talk', listening: 'Listening', transcribing: 'Understanding you', thinking: 'Thinking', speaking: 'Speaking', muted: 'Muted', off: 'Ready' })[talk.phase] : ({ ready: 'Ready', listening: 'Listening', speaking: 'Speaking', thinking: 'Thinking', offline: 'Offline', error: 'Needs attention', preparing: voice.voiceLoading ? 'Preparing voice' : voice.transcribing ? 'Understanding you' : 'Opening microphone' })[orbState];
  const hasTurns = !!conversation?.turns.length;

  async function refreshStatus() {
    try { const [nextStatus, nextList] = await Promise.all([api('status'), api('conversations')]); setStatus(nextStatus); setList(nextList); }
    catch { setStatus(null); }
  }
  useEffect(() => { remember(storageKey, id); }, [id, storageKey]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (state.serverId && url.searchParams.get('conversation') === id) { url.searchParams.delete('conversation'); window.history.replaceState(null, '', url); }
  }, [id, state.serverId]);
  const evergreenConversation = conversation?.turns.some(t => t.privacyTag === 'evergreen' || t.provider === 'evergreen-companion');
  useEffect(() => { remember(`${storageKey}:draft`, evergreenConversation || /\bevergreen\b/i.test(draft) ? '' : draft); }, [draft, storageKey, evergreenConversation]);
  useEffect(() => {
    let alive = true; setConnected(false); setConversation(null);
    // SSE sends the authoritative saved snapshot on reconnect, including partial replies.
    const stream = new EventSource(`/api/chat/events?id=${encodeURIComponent(id)}`);
    stream.onmessage = event => {
      if (!alive) return;
      try {
        const next = JSON.parse(event.data) as Conversation | null;
        setConversation(next); setConnected(true);
        const waiting = talkTurn.current, spokenTurn = waiting && next?.turns.find(turn => turn.id === waiting.id);
        if (waiting && spokenTurn) {
          waiting.update(spokenTurn.reply, spokenTurn.status === 'complete');
          if (spokenTurn.status !== 'running') {
            talkTurn.current = null;
            if (spokenTurn.status === 'complete') waiting.resolve();
            else waiting.reject(new Error(spokenTurn.error || 'The reply stopped. Start Talk again when ready.'));
          }
        }
        const pending = requestRef.current;
        if (pending && next?.turns.some(turn => turn.id === pending.id)) {
          setDraft(current => current.trim() === pending.message ? '' : current);
          setSelected([]); requestRef.current = null; remember(`${storageKey}:pending`, '');
        }
        const last = next?.turns.at(-1);
        if (last && last.status !== 'running') void refreshStatus();
      } catch { setError('The conversation could not be read. Reconnect to try again.'); }
    };
    stream.onerror = () => { if (alive) setConnected(false); };
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 15000);
    return () => { alive = false; stream.close(); clearInterval(timer); };
  }, [id, refreshKey]);
  useEffect(() => {
    if (!transcriptOpen || !conversation?.turns.length) return;
    if (talk.active) { const transcript = bottom.current?.parentElement; if (transcript) transcript.scrollTop = transcript.scrollHeight; }
    else bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [conversation?.turns.length, transcriptOpen]);

  function chooseChat(next: string, view = true) {
    talk.end(); voice.stopListening(); voice.stopSpeaking(); voice.clearError(); history.current?.close();
    setStorageKey(`${LAST_CHAT}:${state.serverId}`);
    setId(next); setTranscriptOpen(view); setError(''); setSelected([]); setPicker(false); setContextDismissed(true); onClearContext?.();
  }
  function clearContext() {
    if (sending || running || requestRef.current) return;
    talk.end(); voice.stopListening(); setContextDismissed(true); onClearContext?.();
  }
  function rejectedRequest(issue: unknown, requestId: string) {
    // A definitive client rejection did not start a turn. Allow fixing attachments;
    // uncertain network/server failures retain the original receipt for safe retry.
    const code = (issue as { status?: number })?.status;
    if (code && [400, 401, 403, 404, 409, 413, 422].includes(code) && requestRef.current?.id === requestId) {
      requestRef.current = null; remember(`${storageKey}:pending`, '');
    }
  }
  async function send(event?: FormEvent, text = draft) {
    event?.preventDefault(); if (talk.active || !canSend || !text.trim() || !state.serverId) return;
    voice.stopListening(); voice.stopSpeaking();
    let sources: { id: string; rev: number }[];
    try { sources = resolveCommandSources(records, sourceIds, pendingIds); }
    catch (issue) { setError((issue as Error).message); return; }
    const candidate = { serverId: state.serverId, conversationId: id, afterTurnId: conversation?.turns.at(-1)?.id || null, message: text.trim(), sources, reasoning, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const previous = requestRef.current;
    // Retrying an uncertain network response reuses the receipt, so it cannot start a second reply.
    const request = previous && previous.conversationId === id && previous.message === candidate.message && JSON.stringify(previous.sources) === JSON.stringify(sources) ? previous : { ...candidate, id: crypto.randomUUID() };
    requestRef.current = request; remember(`${storageKey}:pending`, evergreenConversation || /\bevergreen\b/i.test(text) ? '' : JSON.stringify(request)); setSending(true); setError('');
    try {
      await api('send', request);
      if (idRef.current === id) { setDraft(current => current.trim() === request.message ? '' : current); setSelected([]); requestRef.current = null; remember(`${storageKey}:pending`, ''); }
      void refreshStatus();
    } catch (e) { rejectedRequest(e, request.id); setError((e as Error).message || 'Connection lost. Your draft is kept. Reconnect and send again.'); }
    finally { setSending(false); }
  }
  async function submitTalk(text: string, signal: AbortSignal, update: (text: string, final: boolean) => void) {
    if (signal.aborted || !connected || !state.serverId || running || sending || requestRef.current) throw new Error('The conversation is busy or disconnected. Your words were not resent.');
    const sources = resolveCommandSources(records, sourceIds, pendingIds);
    const request = { id: crypto.randomUUID(), serverId: state.serverId, conversationId: id, afterTurnId: conversation?.turns.at(-1)?.id || null, message: text, sources, voice: true, reasoning, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    setDraft(text); setSending(true); setError(''); requestRef.current = request; remember(`${storageKey}:pending`, evergreenConversation || /\bevergreen\b/i.test(text) ? '' : JSON.stringify(request));
    const completion = new Promise<void>((resolve, reject) => { talkTurn.current = { id: request.id, update, resolve, reject }; });
    void completion.catch(() => {});
    const cancel = () => {
      if (talkTurn.current?.id === request.id) { talkTurn.current.reject(new Error('Talk stopped.')); talkTurn.current = null; }
      void api('cancel', { id: request.id, serverId: request.serverId }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const reply = await api('send', request) as Turn;
      if (signal.aborted) { cancel(); throw new Error('Talk stopped.'); }
      if (idRef.current === id) { setDraft(current => current.trim() === text ? '' : current); setSelected([]); requestRef.current = null; remember(`${storageKey}:pending`, ''); }
      if (reply.status !== 'running' && talkTurn.current?.id === request.id) {
        update(reply.reply, reply.status === 'complete');
        if (reply.status === 'complete') talkTurn.current.resolve(); else talkTurn.current.reject(new Error(reply.error || 'The reply stopped.'));
        talkTurn.current = null;
      }
      await completion;
    } catch (issue) {
      rejectedRequest(issue, request.id); throw issue;
    } finally {
      // Keep cancellation attached through audio playback, which outlasts the
      // completed text response. The turn signal is released after playback.
      if (talkTurn.current?.id === request.id) talkTurn.current = null;
      setSending(false); void refreshStatus();
    }
  }
  async function stop() {
    if (!running) return; setStopping(true); setError('');
    try { await api('cancel', { id: running.id, serverId: state.serverId }); }
    catch { setError('Could not confirm that the reply stopped. Reconnect to check its saved status.'); }
    finally { setStopping(false); }
  }
  async function exportChats() {
    try {
      const data = await api('export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'second-brain-conversations.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Connect to your computer to export saved conversations.'); }
  }
  return <section className={`command command-workspace ${hasTurns && transcriptOpen ? 'has-conversation' : 'fresh-conversation'} ${talk.active ? 'talk-active' : ''} ${attachedContext ? 'with-context' : ''}`} aria-label="JARVIS Command">
    <header className="command-header"><div className="command-heading"><span className="command-kicker">Ask JARVIS</span><p>A space to think, talk, and move things forward.</p></div><div className="command-header-actions"><button type="button" className="command-new" onClick={() => { talk.end(); history.current?.showModal(); }}><History size={16} />History</button><button type="button" className="command-new" disabled={sending} onClick={() => chooseChat(crypto.randomUUID())}><Plus size={17} />New chat</button></div></header>
    <div className="command-layout">
      <div className="command-chat">
        <div className="command-chat-topline"><span className="command-conversation-label"><MessageCircle size={16} />{attachedContext ? 'In context' : 'Your conversation'}</span><div className="command-model-bar"><ModelPicker disabled={talk.active || !!running || sending} current={status?.model} onChange={() => void refreshStatus()} /></div></div>
        {attachedContext && <section className="command-context" aria-label="Attached context"><div className="command-context-heading"><div><span>Working with</span><strong>{attachedContext.label}</strong></div><button type="button" className="icon-button" aria-label="Remove attached context" disabled={sending || !!running || !!requestRef.current} onClick={clearContext}><X size={17} /></button></div>{contextIds.length ? <details><summary>{contextIds.length} {contextIds.length === 1 ? 'saved item attached' : 'saved items attached'}</summary><ul>{contextIds.map(sourceId => { const record = records.find(item => item.id === sourceId); return <li key={sourceId}>{record ? <button type="button" onClick={() => { talk.end(); onOpen(record); }}>{record.title}<span>{pendingIds.has(sourceId) || record.rev < 1 ? 'Waiting to sync' : `Revision ${record.rev}`}</span></button> : <span>Item unavailable — remove context to continue.</span>}</li>; })}</ul><p>Only these saved items are attached. Up to 3,000 characters each; linked websites and files are not fetched.</p></details> : <p>This opens an editable question. No saved items are attached.</p>}</section>}
        {hasTurns && <div className="command-transcript-control"><button type="button" className="command-new" aria-expanded={transcriptOpen} aria-controls="command-transcript" onClick={() => setTranscriptOpen(open => !open)}><MessageCircle size={16} />{transcriptOpen ? 'Hide chat' : 'View chat'}</button><span role="status">{running ? 'JARVIS is replying…' : transcriptOpen ? 'Your current conversation' : 'Your conversation is hidden'}</span></div>}
        <div id="command-transcript" hidden={hasTurns && !transcriptOpen} className="command-transcript" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {!hasTurns ? <div className="command-welcome"><span className="command-welcome-eyebrow">{talk.active ? 'WE’RE HERE, TOGETHER' : attachedContext ? 'A LITTLE CONTEXT GOES A LONG WAY' : 'MAKE ROOM FOR A GOOD THOUGHT'}</span><h1>{talk.active ? 'Your words. Our next step.' : attachedContext ? 'Let’s move this forward.' : 'What’s on your mind?'}</h1><p>{talk.active ? 'Speak naturally. Your words and JARVIS’s replies will appear here as the conversation unfolds.' : attachedContext ? 'Your selected items are here. Ask a question, find the connections, or work out what comes next.' : 'Bring a question, a half-formed idea, or something you want to get done. We’ll take it from there.'}</p>{!talk.active && <div className="command-suggestions">{[
            { label: 'Plan my day', description: 'Find a little more focus.', text: 'Help me plan my next hour.', Icon: CalendarDays },
            { label: 'Explore an idea', description: 'Turn a maybe into a next step.', text: 'Help me think through an app idea.', Icon: Lightbulb },
            { label: 'Connect my memories', description: 'Bring your saved thoughts together.', text: 'Summarise the memories I select.', Icon: FileText },
          ].map(({ label, description, text, Icon }) => <button disabled={talk.active} key={text} onClick={() => { voice.stopListening(); setDraft(text); textarea.current?.focus(); }}><span className="suggestion-icon"><Icon size={20} /></span><span><strong>{label}</strong><small>{description}</small></span><ArrowUpRight className="suggestion-arrow" size={17} /></button>)}</div>}</div> : conversation!.turns.map(turn => <article key={turn.id} className="command-turn">
            <div className="command-message user"><span>You</span><p>{turn.message}</p>{!!turn.sources.length && <details><summary>{turn.sources.length} {turn.sources.length === 1 ? 'memory used' : 'memories used'}</summary>{turn.sources.map(source => <div className="command-source" key={source.id}><strong>{source.title}</strong><small>{source.automatic ? 'Recalled automatically · ' : 'Attached by you · '}Revision {source.rev}{source.excerpted ? ' · first 3,000 characters' : ''}</small><p>{source.body || 'No notes in this item.'}</p><button className="command-subtle" onClick={() => { const entry = records.find(r => r.id === source.id); if (entry) onOpen(entry); }} disabled={!records.some(r => r.id === source.id)}>Open current item</button></div>)}</details>}</div>
            <div className="command-message assistant"><span><span className="command-small-core" />JARVIS{turn.status === 'running' && <LoaderCircle size={14} className="spin" />}</span><p>{turn.reply || (turn.status === 'running' ? 'Thinking through your message…' : 'No reply was completed.')}</p>
              {turn.timings?.firstTextMs !== undefined && <small>{turn.model || (turn.reasoning === 'high' ? 'Deep' : 'Quick')} · First words in {(turn.timings.firstTextMs / 1000).toFixed(1)}s{turn.provider === 'chatgpt-direct' ? ' · Direct ChatGPT' : ''}</small>}
              {turn.contextTrimmed && <small>Only recent completed messages were included in this reply.</small>}
              {turn.status === 'cancelled' && <small>Stopped. Any partial reply is kept.</small>}
              {turn.error && <div className="command-turn-error">{turn.error}</div>}
              <ActionCard value={turn.action} turnId={turn.id} current={turn.status === 'complete' && conversation?.turns.at(-1)?.id === turn.id && !sending && !running} onOpen={() => { talk.end(); voice.stopListening(); voice.stopSpeaking(); }} />
              {turn.status === 'complete' && turn.action?.kind === 'whatsapp-review' && !!turn.action.confirmUntil && <div className="reply-actions" aria-label="WhatsApp message confirmation"><button className="command-send" disabled={talk.active || !canSend || !!draft.trim() || conversation?.turns.at(-1)?.id !== turn.id} onClick={() => void send(undefined, 'send it')}>Send this message</button><button className="command-subtle" disabled={talk.active || !canSend || !!draft.trim() || conversation?.turns.at(-1)?.id !== turn.id} onClick={() => void send(undefined, 'cancel WhatsApp')}>Cancel message</button><small>Not sent yet · You can also say “send it” or ask for a change.</small></div>}
              {turn.action?.kind === 'whatsapp-digest' && !!turn.action.groups?.length && <details className="whatsapp-briefing-details"><summary>Explore these updates</summary>
                {turn.action.lastRun?.finishedAt && <small>Last monitoring check: {new Date(turn.action.lastRun.finishedAt).toLocaleString()}</small>}
                {turn.action.groups.map((group, index) => <div className="command-source" key={group.ref}><strong>{group.label}</strong><small>{group.accountName}</small><div className="reply-actions">{[['Read last five messages', `Read the last five messages from chat number ${index + 1} in those WhatsApp updates.`], ['Help me reply', `Help me reply to chat number ${index + 1} in those WhatsApp updates.`]].map(([label, message]) => <button key={label} className="command-subtle" disabled={talk.active || !canSend || conversation?.turns.at(-1)?.id !== turn.id} onClick={() => { voice.stopListening(); voice.stopSpeaking(); requestRef.current = null; setDraft(message); textarea.current?.focus(); }}>{label}</button>)}</div></div>)}
              </details>}
              {!!turn.action?.contextSources?.length && <details><summary>Personal context considered</summary>{turn.action.contextSources.map(source => <div className="command-source" key={source.id}><strong>{source.title}</strong><small>Saved memory · revision {source.rev}{source.dueDate ? ` · ${source.dueDate}` : ''}</small><p>{source.body}</p></div>)}</details>}
              {!!turn.action?.styleExamplesUsed && <small>Draft informed by {turn.action.styleExamplesUsed} of your recent replies in this chat.</small>}
              {turn.status === 'complete' && <div className="reply-actions"><button className="command-subtle" onClick={() => { talk.end(); voice.stopSpeaking(); onDraft(turn.reply); }}><FileText size={14} />Review as a note</button><button className="command-subtle" onClick={() => { talk.end(); voice.stopSpeaking(); onDraft(turn.reply, 'task'); }}><Check size={14} />Review as a task</button><button className="command-subtle" disabled={talk.active} onClick={() => void voice.speak(turn.reply)}><Volume2 size={14} />Read reply aloud</button></div>}
              {['error', 'interrupted', 'cancelled'].includes(turn.status) && <button className="command-subtle" onClick={() => { setDraft(turn.message); setSelected(turn.sources.map(s => s.id).filter(sourceId => records.some(r => r.id === sourceId))); requestRef.current = null; textarea.current?.focus(); }}>Prepare retry</button>}
            </div>
          </article>)}<div ref={bottom} />
        </div>
        <div className="command-composer-area">
          {blockedByOther && <div className="command-notice">A reply is running in another conversation. <button onClick={() => chooseChat(status!.active!.conversationId)}>Open it</button></div>}
          {error && <div className="command-error" role="alert">{error}<button aria-label="Dismiss chat error" onClick={() => setError('')}><X size={15} /></button></div>}
          {voice.voiceError && <div className="command-error" role="alert">{voice.voiceError}<button aria-label="Dismiss voice error" onClick={voice.clearError}><X size={15} /></button></div>}
          {talk.error && <div className="command-error" role="alert">{talk.error}<button aria-label="Dismiss Talk error" onClick={talk.clearError}><X size={15} /></button></div>}
          {picker && <div className="command-picker"><div><label htmlFor="memory-search">Choose memories for this message</label><button aria-label="Close memory picker" onClick={() => setPicker(false)}><X size={16} /></button></div><input id="memory-search" placeholder="Find a saved item…" value={search} onChange={e => setSearch(e.target.value)} /><div className="command-memory-options">{records.filter(r => `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0, 40).map(record => <label key={record.id}><input type="checkbox" checked={sourceIds.includes(record.id)} disabled={contextIds.includes(record.id) || pendingIds.has(record.id) || record.rev < 1 || (!sourceIds.includes(record.id) && sourceIds.length >= 6)} onChange={e => setSelected(ids => e.target.checked ? [...ids, record.id] : ids.filter(x => x !== record.id))} /><span>{record.title}<small>{record.kind}{contextIds.includes(record.id) ? ' · attached context' : pendingIds.has(record.id) || record.rev < 1 ? ' · waiting to sync' : ''}</small></span></label>)}{!records.length && <p>Save a thought, task, or note first.</p>}</div><p>Up to 6 items including attached context. The first 3,000 characters of each item are shared.</p></div>}
          <form className="command-composer" onSubmit={e => void send(e)}>
            {!!selected.length && <div className="command-selected">{selected.map(sourceId => <button type="button" disabled={talk.active} key={sourceId} onClick={() => setSelected(ids => ids.filter(x => x !== sourceId))}><Check size={12} />{records.find(r => r.id === sourceId)?.title || 'Unavailable memory'}<X size={12} /></button>)}</div>}
            <textarea ref={textarea} readOnly={talk.active} aria-label="Message JARVIS" placeholder={talk.active ? 'Follow your conversation above. End Talk to type.' : 'Ask anything, or start with a thought…'} maxLength={8000} value={draft} onChange={e => { voice.stopListening(); setDraft(e.target.value); requestRef.current = null; }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            <div className="command-composer-tools"><button type="button" disabled={talk.active} onClick={() => setPicker(!picker)} aria-expanded={picker}><Plus size={16} />Add memories{selected.length ? ` (${selected.length})` : ''}</button><small>Ctrl + Enter to send</small>{running ? <button type="button" className="command-send" onClick={() => void stop()} disabled={stopping}><Square size={14} />{stopping ? 'Stopping…' : 'Stop reply'}</button> : <button className="command-send" type="submit" disabled={talk.active || !canSend || !draft.trim()}>{sending ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}Send</button>}</div>
          </form>
          <details className="command-tools"><summary>Voice settings & guidance</summary><div className="command-tools-content"><div className="command-voice-check"><p>Check your selected local voice before starting a conversation.</p><button type="button" className="voice-action" disabled={talk.active || voice.speaking || voice.voiceLoading} onClick={() => void voice.speak(voiceGreeting(new Date(), addressAs))}><Volume2 size={15} />Test voice</button></div><details className="talk-options"><summary>Conversation settings</summary><label>Thinking effort<select aria-label="Thinking effort" disabled={talk.active || !!running || sending} value={reasoning} onChange={event => setReasoning(event.target.value as 'low' | 'high')}><option value="low">Quick · low</option><option value="high">Deep · high</option></select></label><p>Deep thinking takes longer. Choose it before sending a complex question.</p><label>Pause before replying<select aria-label="Pause before replying" disabled={talk.active} value={talk.silence} onChange={event => talk.setSilence(Number(event.target.value))}><option value={800}>Short · 0.8 seconds</option><option value={1200}>Natural · 1.2 seconds</option><option value={1800}>Relaxed · 1.8 seconds</option></select></label><label className="talk-interrupt"><input type="checkbox" checked={talk.greet} disabled={talk.active} onChange={event => talk.setGreet(event.target.checked)} />Greet me when Talk starts</label><label className="talk-interrupt"><input type="checkbox" checked={talk.interruptible} disabled={talk.active} onChange={event => talk.setInterruptible(event.target.checked)} />Interrupt by speaking</label><p>Use headphones for spoken interruptions. You can always tap the orb to interrupt. Talk ends when you leave the app.</p></details><details className="talk-options"><summary>WhatsApp voice commands</summary><p>“Message Rahul from Personal Australia saying I’ll arrive at 7.”</p><p>I’ll read back the recipient, account and message. Say “send it”, “change it to…” or “cancel”. A simple “yes” won’t send. The confirmation stays available for two minutes; say “read it back” to review it again.</p><p>After reading a chat, try “Reply saying I’ll be there” or “Help me reply”.</p><p>Enable chats in the WhatsApp tab, or say “Enable WhatsApp chat Mum on Personal.”</p><a href="#/whatsapp">Open WhatsApp and monitoring</a></details><details className="talk-options"><summary>Remembering people and facts</summary><p>Ask naturally: “Keep that in mind”, “Make a note of this”, or “I’d like you to remember…”. I’ll use the conversation and read back what I plan to remember. Say yes, no, or a correction—no need to repeat the whole fact.</p><p>Approved memories with “Recall when relevant” enabled can be used in later conversations. Names, nicknames and relationships can also match WhatsApp contacts. The reply shows which memories were used.</p><a href="#/people">People and memory reviews</a></details></div></details>
          <HermesHandoff draft={draft} disabled={talk.active || sending || !!running} /><p className="command-footnote">{status?.provider === 'hermes' && <>Using Hermes until you connect direct ChatGPT in Settings.<br /></>}Voice is processed on your laptop. Replies use your ChatGPT connection.</p>
        </div>
      </div>
      <aside className="command-presence" aria-label="Voice companion">
        <div className="presence-eyebrow"><span /> A conversation, naturally</div>
        <button className="orb-trigger" disabled={talk.phase === 'preparing'} aria-label={talk.active ? talk.phase === 'listening' ? 'Mute Talk' : talk.phase === 'muted' ? 'Resume Talk' : 'Interrupt and listen' : voice.listening ? 'Finish voice input' : voice.preparing || voice.transcribing ? 'Cancel voice input' : 'Start voice input'} title={talk.active ? 'Control your conversation' : 'Local dictation. Pause or tap again to finish, then review your words. Choose Start Talk for a conversation.'} onClick={() => { if (talk.active) { if (talk.phase === 'listening' || talk.phase === 'muted') talk.mute(); else talk.interrupt(); } else void voice.startListening(draft); }}><AiOrb state={orbState} level={talk.active ? talk.level : voice.level} /><span className="orb-mic">{orbState === 'listening' ? <Square size={16} /> : <Mic size={19} />}</span></button>
        <div className={`command-core-label state-${orbState}`} role="status"><span className="command-dot" />{coreState}</div>
        <h2>{orbState === 'listening' ? 'I’m listening.' : orbState === 'speaking' ? 'Let’s think out loud.' : talk.phase === 'muted' ? 'Take your time.' : 'Think out loud.'}</h2>
        <p className="presence-caption">{talk.active ? ({ preparing: 'Warming your local voice. The first start takes longer.', listening: 'Speak naturally. A pause sends your words automatically.', transcribing: 'Turning your voice into words on your computer.', thinking: 'Thinking through your words. Tap the orb to interrupt.', speaking: 'Tap the orb to interrupt and say something else.', muted: 'Microphone muted. Resume whenever you’re ready.', off: '' })[talk.phase] : voice.listening ? 'Speak, then pause or tap the orb. Review your words before sending.' : voice.transcribing ? 'Turning your voice into words on your computer.' : voice.voiceLoading ? 'Creating your audio locally on this computer.' : voice.speaking ? 'Your reply, spoken by JARVIS.' : 'Start a conversation, or tap the orb to turn a thought into an editable message.'}</p>
        <div className="presence-actions">{talk.active ? <><button className="voice-action" disabled={talk.phase === 'preparing'} onClick={talk.mute}>{talk.phase === 'muted' ? <Mic size={15} /> : <Square size={14} />}{talk.phase === 'muted' ? 'Resume microphone' : 'Mute microphone'}</button><button className="voice-action talk-end" onClick={() => talk.end()}><X size={15} />End Talk</button></> : <><button className="voice-action talk-start" disabled={!canSend || !!draft.trim() || !!requestRef.current} onClick={() => { voice.stopListening(); voice.stopSpeaking(); voice.clearError(); void talk.start(); }}><Mic size={15} />Start Talk</button>{(voice.speaking || voice.voiceLoading) && <button className="voice-action" onClick={voice.stopSpeaking}><Square size={14} />Stop audio</button>}</>}</div>


        {!talk.active && !!draft.trim() && <p className="talk-hint">Send your draft, or <button type="button" disabled={sending || !!running || !!requestRef.current} onClick={() => { setDraft(''); requestRef.current = null; }}>clear it to start Talk</button>.</p>}

        {!!talk.heard && <p className="talk-heard"><span>Last heard</span>{talk.heard}</p>}
        {(!connected || status?.state !== 'ready') && <div className="command-connection"><p>{!connected ? 'Reconnecting to your computer. Your draft stays here.' : status?.message || 'Checking the ChatGPT connection…'}</p><button className="command-subtle" onClick={() => { setRefreshKey(k => k + 1); void refreshStatus(); }}><RefreshCw size={13} /> Reconnect</button></div>}
      </aside>
    </div>
    <dialog ref={history} className="command-history-dialog" aria-labelledby="history-heading" onClick={e => { if (e.target === e.currentTarget) history.current?.close(); }}><div className="history-heading"><div><span className="command-kicker">PICK UP A THOUGHT</span><h2 id="history-heading">Your conversations</h2></div><button className="icon-button" aria-label="Close history" onClick={() => history.current?.close()}><X size={20} /></button></div><div className="command-history">{list.length ? list.map(item => <button disabled={sending} key={item.id} aria-current={item.id === id ? 'page' : undefined} className={item.id === id ? 'selected' : ''} onClick={() => chooseChat(item.id, true)}><MessageCircle size={16} /><span>{item.title}</span></button>) : <p>Your first conversation starts here.</p>}</div><button className="command-subtle" onClick={() => void exportChats()}><ArrowDownToLine size={14} />Export conversations</button></dialog>
  </section>;
}
