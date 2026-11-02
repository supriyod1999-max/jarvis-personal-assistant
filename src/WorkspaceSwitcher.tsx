import { useEffect, useState } from 'react';
import { lockRequest } from './WorkspaceLock';
type Workspace = { id: string; label: string; url: string | null; current: boolean };
export default function WorkspaceSwitcher() {
  const [items, setItems] = useState<Workspace[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => void fetch('/api/workspaces', { cache: 'no-store' }).then(r => r.ok ? r.json() : []).then(setItems).catch(() => {});
    refresh(); window.addEventListener('jarvis-profile-updated', refresh); return () => window.removeEventListener('jarvis-profile-updated', refresh);
  }, []);
  if (items.length < 2) return null;
  async function change(id: string) {
    const target = items.find(item => item.id === id); if (!target?.url || target.current) return;
    setBusy(true); setError('');
    try {
      await lockRequest('lock', {}); window.dispatchEvent(new Event('jarvis-lock-updated'));
      location.assign(target.url + '/?switch=1&setup=pin#/command');
    } catch { setError('Reconnect to switch workspaces safely.'); setBusy(false); }
  }
  return <div className="workspace-switch"><label>Workspace<select aria-label="Switch workspace" value={items.find(item => item.current)?.id || ''} disabled={busy} onChange={e => void change(e.target.value)}>{items.map(item => <option key={item.id} value={item.id} disabled={!item.url}>{item.label}</option>)}</select></label>{error && <small role="alert">{error}</small>}</div>;
}
