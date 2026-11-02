import { useEffect, useRef, useState } from 'react';
import { Activity, Instagram, RefreshCw } from 'lucide-react';
import './connections.css';

type Health = { checkedAt: string; services: { id: string; name: string; state: string; detail: string; href: string; lastHealthyAt: string | null }[] };
type InstagramState = { state: string; savedUrl: string; daily: boolean; analyse: boolean; message: string; analysis: string; counts: Record<string, number>; lastSync: string | null; downloading: boolean };
type Reel = { code: string; url: string; collections: string[]; state: string; error: string; understanding: { state: string; error: string; analysis: { title: string; summary: string; limitations: string; coverage: string; ideas: string[] } | null } };
const label = (state: string) => ({ ready: 'Ready', held: 'Release held', not_connected: 'Not connected', needs_attention: 'Needs attention', partial: 'Partial coverage', unavailable: 'Unavailable', idle: 'Ready to load', sign_in: 'Sign in needed', syncing: 'Checking saves' }[state] || state.replaceAll('_', ' '));
const serviceDestination = (service: Health['services'][number]) => ['chat', 'input', 'voice'].includes(service.id) ? '#/settings/assistant' : service.href;
async function get<T,>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load connections.'); return data;
}
export default function ConnectionCenter() {
  const [health, setHealth] = useState<Health>(), [instagram, setInstagram] = useState<InstagramState>(), [reels, setReels] = useState<Reel[]>([]);
  const [savedUrl, setSavedUrl] = useState(''), [daily, setDaily] = useState(false), [link, setLink] = useState('');
  const [analyse, setAnalyse] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(''), [local, setLocal] = useState(false);
  const initialized = useRef(false), alive = useRef(true);
  async function refresh(signal?: AbortSignal) {
    const results = await Promise.allSettled([
      get<Health>('/api/connections/health', signal), get<InstagramState>('/api/instagram/status', signal), get<Reel[]>('/api/instagram/library', signal), get<{ connection: string }>('/api/access', signal),
    ]);
    if (!alive.current || signal?.aborted) return;
    const [h, s, r, a] = results;
    if (h.status === 'fulfilled') setHealth(h.value);
    if (s.status === 'fulfilled') { setInstagram(s.value); if (!initialized.current) { initialized.current = true; setSavedUrl(s.value.savedUrl); setDaily(s.value.daily); setAnalyse(s.value.analyse); } }
    if (r.status === 'fulfilled') setReels(r.value);
    if (a.status === 'fulfilled') setLocal(a.value.connection === 'local');
    if (results.some(result => result.status === 'rejected')) setError('Some connection checks failed. Displayed results may be out of date.');
  }
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, 30000);
    return () => { alive.current = false; controller.abort(); clearInterval(timer); };
  }, []);
  async function action(name: string, input: object = {}) {
    setBusy(name); setError(''); setFeedback('');
    try {
      const response = await fetch(`/api/instagram/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(input) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!alive.current) return;
      setFeedback(name === 'signin' ? data.message : name === 'configure' ? 'Instagram setup saved. Use Sync saved reels to check for new saves in All Posts.' : name === 'sync' ? (input as { includeHistory?: boolean }).includeHistory ? 'Continuing the older-save import from its saved checkpoint.' : 'Checking the newest saves in All Posts.' : name === 'queue' ? data.existing ? 'Already in your library. No extra copy created.' : 'Reel queued for download.' : 'Updated.');
      if (name === 'queue') setLink('');
      await refresh();
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(''); }
  }
  return <>
    <section className="settings-panel connection-centre" aria-labelledby="connection-health-title">
      <div className="section-heading"><div><div className="settings-title"><Activity size={21} /><h2 id="connection-health-title">Connection health</h2></div><p className="settings-copy">What’s available, what’s waiting, and where to fix it.</p></div><button className="secondary-button" onClick={() => { setError(''); void refresh(); }}><RefreshCw size={15} />Check status</button></div>
      {!health && <p role="status">Checking connections…</p>}
      <div className="service-list">{health?.services.map(service => <a href={serviceDestination(service)} className="service-row" key={service.id}><span className={`service-light ${service.state === 'ready' ? 'ready' : 'waiting'}`} aria-hidden="true" /><div><strong>{service.name}</strong><p>{service.detail}</p>{service.lastHealthyAt && service.state !== 'ready' && <small>Last ready: {new Date(service.lastHealthyAt).toLocaleString()}</small>}</div><span className="service-state">{label(service.state)}</span></a>)}</div>
      {health && <p className="form-hint">Checked {new Date(health.checkedAt).toLocaleTimeString()}. Checks refresh at most every 30 seconds. Ready does not guarantee a future request will succeed.</p>}
    </section>
    <section className="settings-panel instagram-panel" aria-labelledby="instagram-title">
      <div className="settings-title"><Instagram size={21} /><h2 id="instagram-title">Your saved reels</h2></div>
      <p className="settings-copy">All Posts is checked newest first, stopping at previously scanned saves. Moving reels between categories does not reset scan progress or create extra downloads.</p>
      <p role="status">{instagram?.message || 'Checking Instagram setup…'}</p>
      {instagram?.savedUrl && <p className="form-hint">Setup saved · Daily checks {instagram.daily ? 'on' : 'off'} · Reel understanding {instagram.analyse ? 'on' : 'off'}. {instagram.lastSync ? 'A collection scan has completed.' : 'No successful collection sync yet.'}</p>}
      <div className="button-row"><button className="secondary-button" disabled={!!busy || !local || instagram?.state === 'syncing'} onClick={() => void action('signin')}>Open Instagram sign-in</button><span className="form-hint">{local ? 'A separate Chrome window on this laptop. Sign in there, never in JARVIS.' : 'Sign in from JARVIS on your laptop.'}</span></div>
      <form className="instagram-setup" onSubmit={e => { e.preventDefault(); void action('configure', { savedUrl, daily, analyse }); }}>
        <label>Your Instagram Saved page<input type="url" required value={savedUrl} onChange={e => setSavedUrl(e.target.value)} placeholder="https://www.instagram.com/yourusername/saved/" /></label>
        <label className="instagram-check"><input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} />Check for new saves every 24 hours while the laptop is running</label>
        <label className="instagram-check"><input type="checkbox" checked={analyse} onChange={e => setAnalyse(e.target.checked)} />Understand downloaded reels using local audio transcription and sampled frames sent to my ChatGPT connection</label>
        <div className="button-row"><button className="secondary-button" disabled={!!busy}>Save Instagram setup</button><button type="button" className="primary-button" disabled={!!busy || !instagram?.savedUrl || instagram.state === 'syncing'} onClick={() => void action('sync')}>{instagram?.state === 'syncing' ? 'Checking saves…' : 'Sync saved reels'}</button><button type="button" className="secondary-button" disabled={!!busy || !instagram?.savedUrl || instagram.state === 'syncing'} onClick={() => void action('sync', { includeHistory: true })}>Import older saves</button></div>
      </form>
      <p className="form-hint">Ask naturally for a refresh, for example “Check for new reels I’ve saved.” Daily and voice checks use All Posts. Import older saves continues the first-time backfill separately. Category memberships are not refreshed by this scan. Downloads currently support publicly available reels.</p>
      <form className="instagram-link" onSubmit={e => { e.preventDefault(); void action('queue', { url: link }); }}><label>Or add a reel link<input type="url" required value={link} onChange={e => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…/" /></label><button className="secondary-button" disabled={!!busy || !link.trim()}>Save reel</button></form>
      <p className="settings-copy">{instagram?.analysis}</p>
      {instagram?.lastSync && <p className="form-hint">Last collection scan: {new Date(instagram.lastSync).toLocaleString()}</p>}
      <div className="reel-list">{reels.map(reel => <div className="reel-row" key={reel.code}><div><a href={reel.url} target="_blank" rel="noopener noreferrer">{reel.understanding.analysis?.title || 'View reel on Instagram'} ↗</a><p>{reel.collections.join(' · ') || 'Shared link'}</p><small>{label(reel.state)} · {label(reel.understanding.state)}{reel.error || reel.understanding.error ? ` · ${reel.error || reel.understanding.error}` : ''}</small>{reel.understanding.analysis && <details><summary>What JARVIS understood</summary><p>{reel.understanding.analysis.summary}</p><ul>{reel.understanding.analysis.ideas.map((idea, i) => <li key={i}>{idea}</li>)}</ul><p>{reel.understanding.analysis.limitations}</p><small>{reel.understanding.analysis.coverage}</small></details>}</div>{reel.state === 'failed' && <button className="text-button" disabled={!!busy} onClick={() => void action('retry', { code: reel.code })}>Retry download</button>}{reel.state === 'downloaded' && !['ready', 'analysing'].includes(reel.understanding.state) && <button className="text-button" disabled={!!busy} onClick={() => void action('analyse', { code: reel.code })}>Understand reel</button>}</div>)}</div>
      {!reels.length && <p className="form-hint">Your saved links will appear here after the first sync.</p>}
      {feedback && <p role="status">{feedback}</p>}
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
