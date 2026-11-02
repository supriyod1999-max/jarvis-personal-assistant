import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Code2, Pause, Play, RefreshCw } from 'lucide-react';

export type CodingSession = { id: string; title: string; project: string; status: 'working' | 'attention' | 'complete' | 'interrupted' | 'quiet' | 'recent'; stale: boolean; preview: string; question?: string; updatedAt: string };
export type CodingSnapshot = { enabled: boolean; locked: boolean; available?: boolean; sessions: CodingSession[]; message?: string };
export type CodingBridge = { coding?: () => Promise<CodingSnapshot>; setCoding?: (value: boolean) => Promise<CodingSnapshot>; openCoding?: (id: string) => Promise<void> };
const EMPTY: CodingSnapshot = { enabled: true, locked: false, sessions: [] };
const labels = { working: 'Working', attention: 'Question recorded', complete: 'Finished', interrupted: 'Interrupted', quiet: 'No recent activity', recent: 'Recent activity' };
const cleanError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Coding sessions are unavailable.';

export function useCodingSessions(bridge: CodingBridge | undefined, locked: boolean) {
  const [snapshot, setSnapshot] = useState<CodingSnapshot>(EMPTY), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0), pending = useRef(false);
  async function refresh() {
    if (locked || !bridge?.coding || pending.current) return;
    const attempt = generation.current; pending.current = true;
    try { const value = await bridge.coding(); if (attempt === generation.current) { setSnapshot(value); setError(''); } }
    catch (issue) { if (attempt === generation.current) { setSnapshot(EMPTY); setError(cleanError(issue)); } }
    finally { pending.current = false; }
  }
  useEffect(() => {
    generation.current++; setSnapshot(EMPTY); setError(''); setLoading(false);
    if (locked || !bridge?.coding) return;
    void refresh(); const timer = setInterval(() => void refresh(), 4000);
    return () => { generation.current++; clearInterval(timer); };
  }, [locked, bridge]);
  async function toggle() {
    if (!bridge?.setCoding || locked || loading) return;
    const attempt = generation.current; setLoading(true);
    try { const value = await bridge.setCoding(!snapshot.enabled); if (attempt === generation.current) { setSnapshot(value); setError(''); } }
    catch (issue) { if (attempt === generation.current) setError(cleanError(issue)); }
    finally { if (attempt === generation.current) setLoading(false); }
  }
  return { snapshot: locked ? { ...EMPTY, locked: true } : snapshot, error, loading, refresh, toggle };
}

export default function CodingSessions({ bridge, state, unlock }: { bridge: CodingBridge; state: ReturnType<typeof useCodingSessions>; unlock: () => void }) {
  const { snapshot, error, loading, refresh, toggle } = state;
  const [opening, setOpening] = useState(''), [openError, setOpenError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function open(id: string) {
    if (!bridge.openCoding || opening) return;
    setOpening(id); setOpenError('');
    try { await bridge.openCoding(id); }
    catch (issue) { if (mounted.current) setOpenError(cleanError(issue)); }
    finally { if (mounted.current) setOpening(''); }
  }
  return <section className="coding-sessions" aria-label="Codex coding sessions">
    <div className="coding-heading"><div><h2><Code2 size={15} />Codex</h2><p>Keep your coding work in view.</p></div>
      {!snapshot.locked && bridge.coding && <div className="coding-tools"><button aria-label="Refresh coding sessions" onClick={() => void refresh()}><RefreshCw size={14} /></button><button disabled={loading} onClick={() => void toggle()} aria-label={snapshot.enabled ? 'Pause Codex monitoring' : 'Resume Codex monitoring'}>{snapshot.enabled ? <Pause size={14} /> : <Play size={14} />}</button></div>}
    </div>
    {snapshot.locked ? <div className="coding-empty"><p>Coding sessions stay private while JARVIS is locked.</p><button onClick={unlock}>Unlock JARVIS<ArrowUpRight size={13} /></button></div>
      : !bridge.coding ? <div className="coding-empty"><p>Update JARVIS Desktop to connect your coding sessions.</p></div>
        : <><div className="coding-list" tabIndex={0} aria-label="Recent Codex sessions">
          {snapshot.sessions.map(session => <article key={session.id} className="coding-session">
            <div className="coding-session-top"><span className={`coding-status coding-${session.status}`}>{labels[session.status] || 'Recent activity'}</span><time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString()}>{new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            <div className="coding-session-title"><div><h3>{session.title}</h3>{session.project && <p>{session.project}</p>}</div><button disabled={!!opening} aria-label={`Open ${session.title} in Codex`} onClick={() => void open(session.id)}>{opening === session.id ? 'Opening…' : 'Open'}<ArrowUpRight size={13} /></button></div>
            {session.question && <p className="coding-question">{session.question}<span>Open Codex to answer.</span></p>}
            {session.preview && <details><summary>Latest update</summary><p>{session.preview}</p></details>}
          </article>)}
          {!snapshot.sessions.length && <div className="coding-empty"><p>{error || snapshot.message || 'Looking for recent Codex sessions…'}</p>{!snapshot.enabled && <button disabled={loading} onClick={() => void toggle()}>Resume monitoring<Play size={13} /></button>}</div>}
        </div><p className="coding-note">Saved local activity. Quiet sessions may still be running. Approvals stay in Codex.</p></>}
    {(error || openError) && snapshot.sessions.length > 0 && <p className="coding-error" role="alert">{openError || error}</p>}
  </section>;
}
