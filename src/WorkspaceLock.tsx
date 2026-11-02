import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
type Lock = { enabled: boolean; unlocked: boolean; label: string; retryAfter?: number };
const cacheKey = 'jarvis-pin-enabled';
export async function lockRequest(action: string, data: unknown) {
  const response = await fetch('/api/lock/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(data) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'The workspace lock could not be updated.'); return value;
}
export function WorkspaceGate({ children, lockedView }: { children: ReactNode; lockedView?: ReactNode }) {
  const [switchRequired] = useState(() => new URLSearchParams(location.search).get('switch') === '1');
  const switchLock = useRef<Promise<unknown> | null>(null);
  const [status, setStatus] = useState<Lock | null>(null), [error, setError] = useState(''), [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false);
  const setup = !status?.enabled && new URLSearchParams(location.search).get('setup') === 'pin';
  async function refresh() {
    let denied = false;
    try {
      const response = await fetch('/api/lock/status', { cache: 'no-store' });
      if (!response.ok) { denied = true; setStatus({ enabled: true, unlocked: false, label: 'JARVIS' }); throw new Error('Access denied. Check your Tailscale identity.'); }
      const value = await response.json(); localStorage.setItem(cacheKey, String(value.enabled)); setStatus(value); setError('');
      if (value.enabled && !value.unlocked) void window.jarvisPresence?.disable().catch(() => {});
    } catch (e) {
      if (!denied && localStorage.getItem(cacheKey) === 'false') setStatus({ enabled: false, unlocked: true, label: 'JARVIS' });
      else { setStatus({ enabled: true, unlocked: false, label: 'JARVIS' }); setError('Connect to your computer to unlock JARVIS.'); void window.jarvisPresence?.disable().catch(() => {}); }
    }
  }
  useEffect(() => {
    // Revoke a previously open destination session before rendering any records.
    if (switchRequired && !switchLock.current) switchLock.current = lockRequest('lock', {}).then(() => history.replaceState(null, '', location.pathname + '?setup=pin' + location.hash));
    const refreshWhenReady = () => void (switchLock.current || Promise.resolve()).then(refresh).catch(() => setError('Reconnect to finish switching workspaces.'));
    refreshWhenReady(); const timer = setInterval(refreshWhenReady, 10000);
    const savedFetch = window.fetch;
    const wrapped: typeof fetch = async (...args) => {
      const response = await savedFetch(...args);
      if (response.status === 401 && response.url.includes('/api/') && !response.url.includes('/api/lock/')) void refresh();
      return response;
    };
    window.fetch = wrapped;
    window.addEventListener('jarvis-lock-updated', refresh);
    const endReviewContext = () => { void savedFetch('/api/evergreen/end-session', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: '{}' }).catch(() => {}); };
    window.addEventListener('pagehide', endReviewContext);
    return () => { clearInterval(timer); if (window.fetch === wrapped) window.fetch = savedFetch; window.removeEventListener('jarvis-lock-updated', refresh); window.removeEventListener('pagehide', endReviewContext); };
  }, []);
  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await lockRequest(setup ? 'setup' : 'unlock', setup ? { newPin: pin, confirmPin: confirm } : { pin }); setPin(''); setConfirm(''); if (setup) history.replaceState(null, '', location.pathname + location.hash); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (status?.unlocked && !setup) return children;
  // The desktop overlay has a public, microphone-off shell. Never squeeze the
  // full PIN page into its compact window; private content still stays gated.
  if (lockedView) return lockedView;
  return <main className="workspace-lock"><div className="lock-core" aria-hidden="true" /><h1>{status?.label || 'JARVIS'}</h1><p>{!status ? 'Checking workspace access…' : setup ? 'Choose a PIN for this workspace' : 'Unlock your personal workspace'}</p>{status && <form onSubmit={unlock}><label>{setup ? 'New PIN (6–12 digits)' : 'Workspace PIN'}<input aria-label={setup ? 'New workspace PIN' : 'Workspace PIN'} type="password" inputMode="numeric" autoComplete={setup ? 'new-password' : 'current-password'} pattern="[0-9]{6,12}" minLength={6} maxLength={12} required autoFocus value={pin} onChange={e => setPin(e.target.value)} /></label>{setup && <label>Confirm PIN<input aria-label="Confirm workspace PIN" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>}<button className="primary-button" disabled={busy}>{busy ? 'Checking…' : setup ? 'Set PIN and open workspace' : 'Unlock workspace'}</button></form>}{error && <p role="alert" className="form-error">{error}</p>}<WorkspaceSwitcher /><p className="lock-hint">A PIN protects access through JARVIS. Your Windows account still controls the files on this computer.</p></main>;
}
export function PinSettings() {
  const [enabled, setEnabled] = useState(false), [currentPin, setCurrent] = useState(''), [newPin, setNew] = useState(''), [confirmPin, setConfirm] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void fetch('/api/lock/status').then(r => r.json()).then(s => setEnabled(s.enabled)).catch(() => {}); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await lockRequest(enabled ? 'change' : 'setup', { currentPin, newPin, confirmPin }); setEnabled(true); setCurrent(''); setNew(''); setConfirm(''); localStorage.setItem(cacheKey, 'true'); setMessage('PIN saved. Other sessions must unlock again.'); window.dispatchEvent(new Event('jarvis-lock-updated')); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="settings-panel"><h2>Workspace PIN</h2><p>{enabled ? 'This workspace has its own PIN.' : 'Set a PIN to lock this workspace before switching or stepping away.'} Use 6–12 digits.</p><form onSubmit={save}>{enabled && <label>Current PIN<input type="password" inputMode="numeric" autoComplete="current-password" required value={currentPin} onChange={e => setCurrent(e.target.value)} /></label>}<div className="form-grid"><label>New PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" maxLength={12} required value={newPin} onChange={e => setNew(e.target.value)} /></label><label>Confirm new PIN<input type="password" inputMode="numeric" autoComplete="new-password" required value={confirmPin} onChange={e => setConfirm(e.target.value)} /></label></div><div className="button-row"><button className="primary-button" disabled={busy}>{enabled ? 'Change workspace PIN' : 'Set workspace PIN'}</button>{enabled && <button type="button" className="secondary-button" onClick={async () => { await lockRequest('lock', {}); window.dispatchEvent(new Event('jarvis-lock-updated')); }}>Lock workspace</button>}</div></form>{message && <p role="status">{message}</p>}{error && <p role="alert" className="form-error">{error}</p>}</section>;
}
