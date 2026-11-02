import { useEffect, useRef, useState, type FormEvent } from 'react';
import { lockRequest } from './WorkspaceLock';

export default function IslandUnlock({ active, onClose }: { active: boolean; onClose: () => void }) {
  const [pin, setPin] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), pending = useRef(false), generation = useRef(0), mounted = useRef(false);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { if (active && error && !busy) input.current?.focus(); }, [active, error, busy]);
  useEffect(() => {
    generation.current++; setPin(''); setError('');
    if (!active) return;
    input.current?.focus();
    const dismiss = () => { generation.current++; setPin(''); setError(''); close.current(); };
    const hidden = () => { if (document.hidden) dismiss(); };
    window.addEventListener('blur', dismiss); document.addEventListener('visibilitychange', hidden);
    return () => { generation.current++; window.removeEventListener('blur', dismiss); document.removeEventListener('visibilitychange', hidden); };
  }, [active]);
  async function unlock(event: FormEvent) {
    event.preventDefault(); if (pending.current || !active) return;
    const attempt = generation.current, submittedPin = pin;
    pending.current = true; setBusy(true); setPin(''); setError('');
    try {
      await lockRequest('unlock', { pin: submittedPin });
      const response = await fetch('/api/lock/status', { cache: 'no-store' });
      if (!response.ok || (await response.json()).unlocked !== true) throw new Error('Access could not be confirmed. Reconnect to JARVIS and try again.');
      // The gate rechecks the server session. Never infer access from form state.
      window.dispatchEvent(new Event('jarvis-lock-updated'));
    } catch (issue) {
      if (mounted.current && attempt === generation.current) { setError(issue instanceof Error ? issue.message : 'Could not unlock. Check your connection and try again.'); input.current?.focus(); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  if (!active) return null;
  return <form className="island-unlock" aria-label="Unlock JARVIS" onSubmit={unlock} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setPin(''); onClose(); } }}>
    <div><h2>Unlock JARVIS</h2><p>Use your workspace PIN. Your microphone stays off.</p></div>
    <label htmlFor="island-pin">Workspace PIN<input ref={input} id="island-pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required value={pin} disabled={busy} onChange={event => setPin(event.target.value)} aria-describedby={error ? 'island-unlock-error' : undefined} /></label>
    <p id="island-unlock-error" className="island-unlock-message" role={error ? 'alert' : 'status'}>{error || (busy ? 'Checking your PIN…' : '6–12 digits · Same PIN as the main app')}</p>
    <div className="island-unlock-actions"><button type="button" onClick={() => { setPin(''); onClose(); }}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button></div>
  </form>;
}
