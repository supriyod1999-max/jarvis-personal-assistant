import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import './whatsapp.css';
import WhatsAppMonitor from './WhatsAppMonitor';

type Chat = { id: string; name: string; isGroup?: boolean; selected?: boolean };
type Status = { state: string; selected: Chat[]; qr?: string | null; message?: string };
type Message = { id: string; body: string; fromMe: boolean; author: string; timestamp: number; type: string };
type Review = { id: string; chatId: string; name: string; text: string; state: string; expires: number };
type Account = { id: string; name: string; sessionName: string };
async function callAPI<T>(path: string, body?: unknown, account?: string): Promise<T> {
  const query = account ? `${path.includes('?') ? '&' : '?'}account=${encodeURIComponent(account)}` : '';
  const response = await fetch(`/api/whatsapp/${path}${query}`, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'WhatsApp is unavailable.');
  return result;
}

export default function WhatsApp() {
  const [accounts, setAccounts] = useState<Account[]>([]), [current, setCurrent] = useState(''), [error, setError] = useState('');
  const [busyAccounts, setBusyAccounts] = useState<Record<string, boolean>>({});
  useEffect(() => { let cancelled = false; void callAPI<Account[]>('accounts').then(rows => { if (!cancelled) { setAccounts(rows); setCurrent(rows[0]?.id || ''); if (!rows.length) setError('WhatsApp needs setup on your computer.'); } }).catch(() => { if (!cancelled) setError('Your computer is unavailable. Refresh when it reconnects.'); }); return () => { cancelled = true; }; }, []);
  return <><div className="wa-account-selector"><label htmlFor="wa-account">WhatsApp account</label><select id="wa-account" value={current} disabled={Object.values(busyAccounts).some(Boolean)} onChange={e => setCurrent(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
    {error && <p role="alert">{error}</p>}
    {accounts.map(a => <div key={a.id} hidden={a.id !== current}><WhatsAppAccount account={a} onBusy={value => setBusyAccounts(b => ({ ...b, [a.id]: value }))} /></div>)}
    <WhatsAppMonitor />
  </>;
}

function WhatsAppAccount({ account, onBusy }: { account: Account; onBusy: (value: boolean) => void }) {
  const api = <T,>(path: string, body?: unknown) => callAPI<T>(path, body, account.id);
  const [status, setStatus] = useState<Status | null>(null), [available, setAvailable] = useState<Chat[] | null>(null);
  const [active, setActive] = useState<Chat | null>(null), [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [instruction, setInstruction] = useState('');
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [receipts, setReceipts] = useState<Review[]>([]);
  const [notice, setNotice] = useState(''), [filter, setFilter] = useState('');
  const lock = useRef(false), activeRef = useRef<string | null>(null), alive = useRef(true), generation = useRef(0);
  const draft = active ? drafts[active.id] || '' : '';
  async function refreshStatus() { const result = await api<Status>('status'); if (alive.current) setStatus(result); }
  useEffect(() => {
    alive.current = true; let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const value = await api<Status>('status'); if (!cancelled) setStatus(value); } catch { if (!cancelled) setStatus(s => ({ state: 'unavailable', selected: s?.selected || [], message: 'Your computer is unavailable.' })); } if (!cancelled) timer = setTimeout(poll, 8000); };
    void poll(); return () => { cancelled = true; alive.current = false; clearTimeout(timer); generation.current++; };
  }, []);
  async function act(label: string, work: () => Promise<void>) {
    if (lock.current) return; lock.current = true; onBusy(true); setBusy(label); setError(''); setNotice('');
    try { await work(); } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { lock.current = false; if (alive.current) { setBusy(''); onBusy(false); } }
  }
  async function open(chat: Chat) {
    const seq = ++generation.current; activeRef.current = chat.id; setActive(chat); setMessages([]); setReceipts([]); setReview(null); setInstruction('');
    await act('Loading conversation…', async () => { const [rows, saved] = await Promise.all([api<Message[]>(`messages?id=${encodeURIComponent(chat.id)}`), api<Review[]>(`receipts?id=${encodeURIComponent(chat.id)}`)]); if (alive.current && seq === generation.current) { setMessages(rows); setReceipts(saved); const unresolved = saved.find(r => ['unknown', 'sending'].includes(r.state)); if (unresolved) setReview(unresolved); } });
  }
  async function refreshMessages() { if (!active) return; const id = active.id; const rows = await api<Message[]>(`messages?id=${encodeURIComponent(id)}`); if (alive.current && activeRef.current === id) setMessages(rows); }
  const stateLabel = status?.state === 'ready' ? 'Connected' : status?.state === 'qr_ready' ? 'Scan to connect' : ['initializing', 'authenticating'].includes(status?.state || '') ? 'Connecting…' : 'Not connected';
  return <section className="wa-space" aria-label="WhatsApp inbox">
    <div className="page-heading"><div><p className="overline">Stay close</p><h1>Your conversations.</h1><p>Read, think it through, reply in your own voice.</p></div><span className="wa-status"><span className={`status-dot ${status?.state === 'ready' ? 'online' : ''}`} />{stateLabel}</span></div>
    <div className="wa-boundary"><ShieldCheck size={17} /><span>{account.name} · You choose the chats. Every reply needs your approval.</span></div>
    {error && <div className="banner warning" role="alert">{error}</div>}{notice && <p className="wa-notice" role="status">{notice}</p>}
    {status?.state !== 'ready' ? <div className="wa-connect settings-panel"><MessageCircle size={38} /><h2>Connect your WhatsApp</h2><p>{status?.message || 'Link this computer to WhatsApp, then choose which chats to open here.'}</p>
      {status?.qr && <><img className="wa-qr" src={status.qr} alt="WhatsApp linked-device QR code" /><p>On your phone: WhatsApp → Linked devices → Link a device.</p></>}
      <button className="primary-button" disabled={!!busy} onClick={() => void act('Connecting…', async () => { setStatus(await api<Status>('reconnect', {})); })}><RefreshCw size={17} />{busy || 'Connect / reconnect'}</button>
      <p className="wa-small">OpenWA must be running on your laptop. This unofficial connection may be disrupted by WhatsApp updates or account restrictions.</p>
    </div> : <div className={`wa-layout ${active ? 'wa-chat-open' : ''}`}>
      <aside className="wa-sidebar settings-panel"><div className="wa-row"><h2>Selected chats</h2><button className="text-button" disabled={!!busy} onClick={() => void act('Loading chats…', async () => setAvailable(await api<Chat[]>('chats')))}>Choose chats</button></div>
        {!status.selected.length && <p className="wa-small">Choose a chat to begin. Messages load when you open an enabled chat.</p>}
        {status.selected.map(c => <button key={c.id} disabled={!!busy} className={`wa-chat-button ${active?.id === c.id ? 'selected' : ''}`} onClick={() => void open(c)}><span className="wa-avatar">{c.name.slice(0, 1).toUpperCase()}</span><span><strong>{c.name}</strong><small>{c.id}</small></span></button>)}
      </aside>
      <div className="wa-conversation settings-panel">{!active ? <div className="wa-empty"><MessageCircle size={42} /><h2>A little more in touch.</h2><p>Open a selected chat to read recent messages and compose a reply.</p></div> : <>
        <div className="wa-row wa-conversation-heading"><button className="icon-button" aria-label="Back to chats" disabled={!!busy} onClick={() => { activeRef.current = null; setActive(null); setReview(null); }}><ArrowLeft size={19} /></button><div><h2>{active.name}</h2><small>{active.id}</small></div><button className="icon-button" aria-label="Refresh messages" disabled={!!busy} onClick={() => void act('Refreshing…', refreshMessages)}><RefreshCw size={18} /></button></div>
        <div className="wa-messages" aria-label="Recent messages">{messages.length ? messages.map((m, i) => <article key={`${m.id}-${i}`} className={`wa-message ${m.fromMe ? 'wa-mine' : ''}`}><small>{m.fromMe ? 'You' : active.id.endsWith('@g.us') ? m.author : active.name}</small><p>{m.body || `[${m.type || 'Attachment'} — open WhatsApp to view]`}</p><time>{m.timestamp ? new Date(m.timestamp * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</time></article>) : <p className="wa-small">{busy || 'No recent messages are available yet. History can be limited by WhatsApp sync.'}</p>}</div>
        <div className="wa-compose"><label htmlFor={`wa-guidance-${account.id}`}>Help with a reply <span className="wa-small">optional</span></label><input id={`wa-guidance-${account.id}`} value={instruction} maxLength={1500} disabled={!!busy || !!review} onChange={e => setInstruction(e.target.value)} placeholder="What would you like to say?" />
          <button className="text-button" disabled={!!busy || !!review || !messages.length} onClick={() => void act('Writing a draft…', async () => { const id = active.id; const result = await api<{ text: string }>('draft', { id, instruction }); if (alive.current && activeRef.current === id) setDrafts(d => ({ ...d, [id]: result.text })); })}><Sparkles size={16} />Suggest a reply</button>
          <p className="wa-small">Suggest a reply shares up to 30 recent messages with your connected ChatGPT account. Nothing is sent to this chat until you approve.</p>
          <label htmlFor={`wa-reply-${account.id}`}>Your reply</label><textarea id={`wa-reply-${account.id}`} rows={4} value={draft} maxLength={4000} disabled={!!busy || !!review} onChange={e => { setDrafts(d => ({ ...d, [active.id]: e.target.value })); setReview(null); }} placeholder="Write your reply, or edit a suggestion…" />
          {!review ? <button className="primary-button" disabled={!!busy || !draft.trim()} onClick={() => void act('Preparing review…', async () => setReview(await api<Review>('prepare', { id: crypto.randomUUID(), chatId: active.id, text: draft })))}><Send size={16} />Review reply</button> : <div className="wa-review" aria-label="Review before sending"><h3>{review.state === 'accepted' ? 'Handed to WhatsApp' : ['unknown', 'sending'].includes(review.state) ? 'Check WhatsApp before trying again' : 'Ready to send?'}</h3><p><strong>From: {account.name}</strong><br /><strong>To: {review.name}</strong><br /><small>{review.chatId}</small></p><p className="wa-review-text">{review.text}</p>
            {review.state === 'review' ? <div className="wa-row"><button className="secondary-button" disabled={!!busy} onClick={() => setReview(null)}>Edit reply</button><button className="primary-button" disabled={!!busy} onClick={() => void act('Sending…', async () => {
              let result: Review;
              try { result = await api<Review>('send', { id: review.id }); }
              catch { setReview(r => r ? { ...r, state: 'unknown' } : r); throw new Error('Connection lost during sending. Check WhatsApp or check the receipt; do not resend blindly.'); }
              setReview(result);
              if (result.state === 'accepted') { setDrafts(d => ({ ...d, [active.id]: '' })); setNotice('WhatsApp accepted the reply. Delivery is not yet confirmed.'); await refreshMessages(); }
            })}><Check size={16} />Approve and send</button></div> : <><p className="wa-small">{review.state === 'accepted' ? 'Accepted for sending. This does not confirm delivery or that it was read.' : 'The outcome is uncertain. This reply will not be sent again automatically.'}</p><div className="wa-row"><button className="secondary-button" disabled={!!busy} onClick={() => void act('Checking receipt…', async () => setReview(await api<Review>(`receipt?id=${review.id}`)))}>Check receipt</button><button className="text-button" disabled={!!busy} onClick={() => setReview(null)}>Close review</button></div></>}
          </div>}{busy && <p role="status" className="wa-small">{busy}</p>}
          {receipts.length > 0 && <details><summary>Recent reply reviews</summary>{receipts.map(r => <p key={r.id} className="wa-small">{r.text.slice(0, 120)} — {r.state === 'accepted' ? 'Accepted by WhatsApp' : r.state === 'review' ? 'Not sent' : 'Outcome uncertain; check WhatsApp'}</p>)}</details>}
        </div>
      </>}</div>
    </div>}
    {available && <section className="wa-picker settings-panel" aria-label="Choose WhatsApp chats"><div className="wa-row"><h2>Choose your chats</h2><button className="text-button" disabled={!!busy} onClick={() => setAvailable(null)}>Done</button></div><p className="wa-small">Only names are loaded for this picker. Choosing chats does not add messages to your saved memories.</p><input aria-label="Find a WhatsApp chat" placeholder="Find a person or group…" value={filter} onChange={e => setFilter(e.target.value)} />
      {available.filter(c => `${c.name} ${c.id}`.toLowerCase().includes(filter.toLowerCase())).map(c => <label className="wa-choice" key={c.id}><input type="checkbox" checked={!!c.selected} disabled={!!busy} onChange={e => { const enabled = e.target.checked; void act('Updating chats…', async () => { await api('select', { id: c.id, enabled }); setAvailable(rows => rows?.map(r => r.id === c.id ? { ...r, selected: enabled } : r) || null); if (!enabled && active?.id === c.id) { activeRef.current = null; setActive(null); setReview(null); setMessages([]); } await refreshStatus(); }); }} /><span><strong>{c.name}</strong><small>{c.id}{c.isGroup ? ' · Group' : ''}</small></span></label>)}
    </section>}
  </section>;
}
