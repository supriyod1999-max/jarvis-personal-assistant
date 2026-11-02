import { useEffect, useState } from 'react';
import type { Entry, Kind } from './types';
type Review = { id: string; record: Entry; baseRev: number; code: string; expires: number; state: string; simpleApproval?: boolean };
async function api(path: string, input?: unknown) {
  const response = await fetch(`/api/memory/${path}`, input === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Memory review is unavailable.'); return data;
}
export default function MemoryReviews({ onOpen, onSaved, kind, records = [] }: { onOpen: (record: Entry) => void; onSaved: () => void; kind?: Kind; records?: Entry[] }) {
  const [reviews, setReviews] = useState<Review[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState('');
  useEffect(() => { let alive = true; const refresh = () => void api('reviews').then(rows => { if (alive && Array.isArray(rows)) setReviews(rows); }).catch(() => {}); refresh(); const timer = setInterval(refresh, 15000); return () => { alive = false; clearInterval(timer); }; }, []);
  async function act(action: string, id: string) {
    setBusy(id); setError('');
    try { await api(action, { id, approved: true }); setReviews(await api('reviews')); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  const visible = reviews.filter(r => kind ? r.record.kind === kind : ['note', 'person'].includes(r.record.kind));
  if (!visible.length && !error) return null;
  return <section className="memory-reviews" aria-label={kind === 'task' ? 'Tasks awaiting your review' : 'Memories awaiting your review'}><h2>Changes to review</h2><p>Check the details before saving. You can also answer the review in your conversation.</p>{error && <p role="alert">{error}</p>}{visible.map(r => <article className="memory-review settings-panel" key={r.id}>
    <h3>{r.record.deleted ? 'Remove: ' : ''}{r.record.title}</h3>
    {r.simpleApproval && <p>In the conversation that prepared this memory, say yes to save, no to cancel, or tell JARVIS what to change.</p>}
    {r.record.deleted ? <p>This removes the {r.record.kind} from active records and automatic recall. Conversation snapshots and recovery backups remain. You can restore the record later.</p> : <>
      <p>{r.record.kind} · {r.record.status} · {r.record.priority} priority</p>
      <p>Due: <strong>{r.record.dueDate || 'None'}</strong> · Birthday: <strong>{r.record.birthday || 'None'}</strong></p>
      <p>Relationship: {r.record.relationship || 'None'} · Aliases: {r.record.aliases?.join(' · ') || 'None'}</p>
      <p>WhatsApp contact: {r.record.whatsappName || 'None'} · Tags: {r.record.tags.join(', ') || 'None'}</p>
      <p>Project: {records.find(x => x.id === r.record.projectId)?.title || r.record.projectId || 'None'} · Person: {records.find(x => x.id === r.record.personId)?.title || r.record.personId || 'None'}</p>
      <p>Source: {r.record.sourceUrl || 'None'}</p><p className="memory-review-body">{r.record.body}</p>
      <p className="form-hint">{r.record.recall ? 'Recall when relevant: enabled. Matching details can be shared with your connected model.' : 'Automatic recall will be disabled; past conversations remain.'}</p>
    </>}
    <div className="button-row"><button className="primary-button" disabled={!!busy} onClick={() => void act('approve', r.id)}>{busy === r.id ? 'Saving…' : r.record.deleted ? 'Approve removal' : r.record.kind === 'task' ? 'Approve and save task' : r.record.recall ? 'Approve and remember' : 'Approve changes'}</button>{!r.record.deleted && <button className="secondary-button" disabled={!!busy} onClick={() => onOpen({ ...r.record, rev: r.baseRev, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })}>Edit before saving</button>}<button className="text-button" disabled={!!busy} onClick={() => void act('cancel', r.id)}>Discard</button></div>
  </article>)}</section>;
}
