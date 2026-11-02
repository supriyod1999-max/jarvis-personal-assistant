import { useEffect, useState, type FormEvent } from 'react';
type Profile = { id: string; label: string; displayName: string; addressAs: string; rev: number; sharedChatConnection: boolean };
export default function ProfileSettings() {
  const [profile, setProfile] = useState<Profile | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void fetch('/api/profile').then(r => r.json()).then(p => { if (alive) setProfile(p); }).catch(() => { if (alive) setError('Reconnect to edit your profile.'); }); return () => { alive = false; }; }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!profile) return; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/profile/update', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ operationId: crypto.randomUUID(), baseRev: profile.rev, value: { label: profile.label, displayName: profile.displayName, addressAs: profile.addressAs }, approved: true }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Your profile could not be saved.');
      setProfile({ ...profile, ...result }); setMessage('Profile saved. New greetings and replies will use these preferences.'); window.dispatchEvent(new Event('jarvis-profile-updated'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="settings-panel profile-settings"><h2>Your identity and voice</h2><p>Choose how this workspace looks and how JARVIS addresses you. Your sign-in and connected accounts stay separate from these display preferences.</p>{profile && <form onSubmit={save}><div className="form-grid"><label>Workspace name<input maxLength={80} required value={profile.label} onChange={e => setProfile({ ...profile, label: e.target.value })} /></label><label>Your name<input maxLength={80} required value={profile.displayName} onChange={e => setProfile({ ...profile, displayName: e.target.value })} /></label><label>Address me as<input maxLength={40} value={profile.addressAs} placeholder="Sir, Owner, or leave blank" onChange={e => setProfile({ ...profile, addressAs: e.target.value })} /></label></div><p className="form-hint">You can also say “Call me Owner” or “Rename this workspace Personal”, then approve the spoken profile review.</p>{profile.sharedChatConnection && <p>This personal workspace uses your primary ChatGPT connection. Its records and other account connections are isolated.</p>}<button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile preferences'}</button></form>}{error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}</section>;
}
