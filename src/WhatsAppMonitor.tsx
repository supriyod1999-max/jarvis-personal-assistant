import { useEffect, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';

type Alert = { id: string; accountName: string; chatName: string; sender: string; summary: string; reminder: string; dueText: string; excerpt: string; messageId: string; dismissed: boolean; taskId: string | null };
type State = { settings: { enabled: boolean; scope: 'selected' | 'direct' | 'all' }; running: boolean; lastRun: { finishedAt: string; checked: number; pending: boolean; problems: string[] } | null; alerts: Alert[]; limitation: string };
async function api(path: string, input?: unknown): Promise<State> {
  const response = await fetch(`/api/whatsapp-monitor/${path}`, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The message check is unavailable.'); return data;
}
export default function WhatsAppMonitor() {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [review, setReview] = useState<Alert | null>(null), [title, setTitle] = useState(''), [dueDate, setDueDate] = useState('');
  useEffect(() => { let alive = true; const refresh = () => void api('state').then(s => { if (alive) setState(s); }).catch(e => { if (alive) setError(e.message); }); refresh(); const timer = setInterval(refresh, 30000); return () => { alive = false; clearInterval(timer); }; }, []);
  async function act(path: string, input: unknown) {
    setBusy(true); setError('');
    try { await api(path, input); setState(await api('state')); setReview(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!state) return <p className="wa-small" role={error ? 'alert' : 'status'}>{error || 'Loading message monitoring…'}</p>;
  const alerts = state.alerts.filter(a => !a.dismissed);
  return <section className="wa-monitor settings-panel" aria-label="WhatsApp monitoring">
    <div className="wa-row"><h2><Bell size={19} /> What needs your attention</h2><button className="secondary-button" disabled={busy || state.running || !state.settings.enabled} onClick={() => void act('run', {})}><RefreshCw size={15} />{busy || state.running ? 'Checking…' : 'Check now'}</button></div>
    <p>Hourly checks across both accounts. Messages you’ve replied to leave these updates after your reply syncs. In groups, only a reply linked to the original message clears it. Tasks you’ve already saved stay in Tasks.</p>
    <div className="wa-monitor-controls"><label><input type="checkbox" checked={state.settings.enabled} disabled={busy || state.running} onChange={e => void act('configure', { ...state.settings, enabled: e.target.checked })} /> Monitoring enabled</label><label>Check messages from<select aria-label="Monitoring chat scope" disabled={busy || state.running} value={state.settings.scope} onChange={e => void act('configure', { ...state.settings, scope: e.target.value })}><option value="selected">Only chats I enable</option><option value="direct">All one-to-one chats</option><option value="all">All chats, including groups</option></select></label></div>
    <p className="wa-small">Luna reads new message text in this scope using your ChatGPT connection. Keep the laptop, Codex and OpenWA running for hourly checks. {state.limitation}</p>
    <p className="wa-small">{state.lastRun ? `Last check: ${new Date(state.lastRun.finishedAt).toLocaleString()} · ${state.lastRun.checked} new messages analysed${state.lastRun.pending ? ' · More history will continue next check' : ''}` : 'No check has completed yet. Enable chats and run your first check.'}</p>
    {state.lastRun?.problems?.length ? <details><summary>Some chats need attention</summary>{state.lastRun.problems.map((p, i) => <p className="wa-small" key={i}>{p}</p>)}</details> : null}
    {error && <p role="alert">{error}</p>}
    <div className="wa-alerts">{alerts.length ? alerts.map(a => <article className="wa-alert" key={a.id}><small>{a.accountName} · {a.chatName}</small><h3>{a.summary}</h3><p className="wa-small">Sender: {a.sender}</p>{a.reminder && <p><strong>Suggested reminder:</strong> {a.reminder}{a.dueText && <><br /><small>Date mentioned: {a.dueText}</small></>}</p>}<details><summary>Source message</summary><p className="wa-review-text">{a.excerpt}</p><small>{a.messageId}</small></details><div className="wa-row">{a.taskId ? <span>Saved in Tasks</span> : a.reminder && <button className="secondary-button" disabled={busy} onClick={() => { setReview(a); setTitle(a.reminder); setDueDate(''); }}>Review reminder</button>}<button className="text-button" disabled={busy} onClick={() => void act('alert', { id: a.id, action: 'dismiss' })}>Dismiss</button></div></article>) : <p className="wa-small">No flagged messages yet. In Command, try “Check my important WhatsApp messages.”</p>}</div>
    {review && <div className="wa-review wa-compose" aria-label="Review WhatsApp reminder"><h3>Review before saving a task</h3><p>{review.accountName} · {review.chatName}<br />{review.dueText ? `Original date wording: ${review.dueText}` : 'No date was mentioned.'}</p><label>Task title<input aria-label="WhatsApp reminder title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label><label>Due date (optional)<input aria-label="WhatsApp reminder due date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label><p className="wa-small">Saving creates a task. It does not schedule an alarm or send a message.</p><div className="wa-row"><button className="secondary-button" disabled={busy} onClick={() => setReview(null)}>Cancel</button><button className="primary-button" disabled={busy || !title.trim()} onClick={() => void act('alert', { id: review.id, action: 'save-task', approved: true, title, dueDate })}>Approve and save task</button></div></div>}
  </section>;
}
