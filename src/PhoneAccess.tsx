import { useEffect, useState } from 'react';
import { Check, Copy, Plus, RefreshCw, Smartphone } from 'lucide-react';

type Access = { state: 'local' | 'configured' | 'error'; phoneUrl: string | null; connection: 'local' | 'private'; loginStartup: boolean };

export default function PhoneAccess({ canInstall, onInstall }: { canInstall: boolean; onInstall: () => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [copyError, setCopyError] = useState('');
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  useEffect(() => {
    let disposed = false; let controller: AbortController | undefined;
    async function check() {
      controller?.abort(); controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch('/api/access', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const result: Access = await response.json();
        if (!disposed) { setAccess(result); setFailed(false); }
      } catch { if (!disposed) setFailed(true); }
      finally { clearTimeout(timeout); if (!disposed) setChecking(false); }
    }
    setChecking(true); void check();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 15000);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); };
  }, [attempt]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 3000); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    setCopyError('');
    try { await navigator.clipboard.writeText(access!.phoneUrl!); setCopied(true); }
    catch { setCopyError('Select and copy the address above.'); }
  }
  return <section className="settings-panel phone-access" aria-labelledby="phone-heading">
    <div className="settings-title"><Smartphone size={21} /><h2 id="phone-heading">On your phone</h2></div>
    <p className="phone-state" aria-live="polite">{checking ? 'Checking access…' : failed ? 'Computer connection unavailable' : access?.state === 'error' ? 'Phone access needs attention' : access?.connection === 'private' ? 'Connected privately' : access?.state === 'configured' ? 'Private address configured' : 'Phone setup pending'}</p>
    {access?.phoneUrl && <><a className="phone-address" href={access.phoneUrl}>{access.phoneUrl}</a><button className="secondary-button" onClick={() => void copy()}><span aria-hidden="true">{copied ? <Check size={15} /> : <Copy size={15} />}</span>{copied ? 'Copied' : 'Copy phone address'}</button></>}
    {copyError && <p className="form-hint" role="alert">{copyError}</p>}
    {failed ? <p className="settings-copy">Check that your computer is awake and JARVIS is running. On your phone, connect Tailscale using the same account as your computer. Your saved items remain on this device.</p> : access?.state === 'configured' ? <ol className="phone-steps"><li>Connect Tailscale on Android with the same account as this computer.</li><li>Open this private address in Chrome.</li><li>In Chrome’s menu, choose Install app or Install and create shortcut.</li></ol> : <p className="settings-copy">Finish private access setup on your computer to get your phone address. This device can still use the local app.</p>}
    {standalone ? <p className="form-hint">Installed on this device.</p> : canInstall && <button className="secondary-button" onClick={onInstall}><Plus size={15} />Install on this device</button>}
    <dl className="status-list phone-recovery"><div><dt>After Windows sign-in</dt><dd>{failed || !access ? 'Unable to check' : access.loginStartup ? 'Starts automatically' : 'Manual start'}</dd></div></dl>
    <p className="form-hint">Keep your computer awake for AI replies and local speech. Cached notes and new captures remain available offline and sync when it returns. Dictation depends on your browser. Meeting recording and notifications are still planned.</p>
    <button className="text-button" disabled={checking} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={14} /> Check connection</button>
  </section>;
}
