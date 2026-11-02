import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

type Status = { state: string; message: string; pending: boolean; selected: string | null; accounts: { id: string; label: string }[]; sharedConnection?: boolean };
export default function ChatGPTConnection() {
  const [status, setStatus] = useState<Status | null>(null), [account, setAccount] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [local, setLocal] = useState(false);
  async function refresh() { try { const value = await (await fetch('/api/chatgpt/status', { cache: 'no-store' })).json(); setStatus(value); } catch { /* Existing status remains visible while disconnected. */ } }
  useEffect(() => { void refresh(); void fetch('/api/access').then(r => r.json()).then(value => setLocal(value.connection === 'local')).catch(() => {}); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, []);
  async function action(name: 'signin' | 'signout') {
    const tab = name === 'signin' ? window.open('about:blank', '_blank') : null;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/chatgpt/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ accountId: account === 'new' ? null : account || status?.selected || null }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (name === 'signin') { if (tab) { tab.opener = null; tab.location.href = data.url; } else window.location.assign(data.url); }
      await refresh();
    } catch (e) { tab?.close(); setError((e as Error).message || 'The connection could not be updated.'); }
    finally { setBusy(false); }
  }
  return <div className="connection-card chatgpt-connection"><Sparkles size={23} strokeWidth={1.5} /><h3>ChatGPT, directly</h3><p>GPT-5.6 Luna for conversation, using your ChatGPT plan. Quick thinking is the default; choose Deep for complex questions.</p><span>{status?.state === 'ready' ? 'Connected' : status?.pending ? 'Waiting for sign-in' : 'Sign-in needed'}</span><p role="status">{status?.message || 'Checking connection…'}</p>
    {!!status?.accounts.length && !status.sharedConnection && <label>ChatGPT account<select aria-label="ChatGPT account" value={account || status.selected || ''} onChange={e => setAccount(e.target.value)}>{status.accounts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="new">Add another account</option></select></label>}
    {status?.sharedConnection ? <p>This personal workspace uses your primary ChatGPT connection. Manage sign-in in your primary workspace on this computer.</p> : local ? <div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => { void action('signin'); }}>Continue with ChatGPT</button>{status?.state === 'ready' && <button className="text-button" disabled={busy} onClick={() => void action('signout')}>Sign out</button>}</div> : <p>Manage sign-in on your computer. Your phone shares its connection.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">ChatGPT plan usage</a>
  </div>;
}
