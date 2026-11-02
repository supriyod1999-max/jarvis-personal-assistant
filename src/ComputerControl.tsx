import { useEffect, useState } from 'react';
import { Laptop, RefreshCw, ShieldCheck } from 'lucide-react';
type Snapshot = { available: boolean; computerName: string; locked: boolean | null; unlockReady: boolean; unlockMessage: string; message: string; localReview?: boolean; devices: { id: string; name: string }[]; pending: { id: string; name: string; deviceId: string; code: string; expiresAtMs: number }[] };
async function call(path: string, input?: unknown) {
  const response = await fetch('/api/computer/' + path, { cache: 'no-store', ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(input) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Computer controls are unavailable.'); return value;
}
export default function ComputerControl() {
  const [state, setState] = useState<Snapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState('');
  async function refresh() { setBusy(true); try { setState(await call('status')); setError(''); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  useEffect(() => { let disposed = false; void call('status').then(value => { if (!disposed) setState(value); }).catch(issue => { if (!disposed) setError(issue.message); }); return () => { disposed = true; }; }, []);
  async function act(operation: string, input: unknown) {
    if (busy) return; setBusy(true); setError('');
    try { await call(operation, input); setReview(''); setState(await call('status')); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  async function enrollment(deviceId: string) {
    if (busy) return; setBusy(true); setError('');
    try { const value = await call('enrollment', { deviceId }); const url = URL.createObjectURL(new Blob([value.configuration], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'JARVIS-Windows-enrollment.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  return <section className="settings-panel" aria-labelledby="computer-heading"><div className="settings-title"><Laptop size={21} /><h2 id="computer-heading">Laptop controls</h2></div>
    <p className="settings-copy">Open <strong>••• → Laptop controls</strong> in the native Android app to pair this laptop. Compare the six-digit code on both devices before approving. Pairing codes last five minutes.</p>
    {state?.localReview === false && <p className="form-hint">Approve new phones in the Windows JARVIS app under Settings → Devices. This private connection can check status but cannot approve a new phone.</p>}
    {state && <><dl className="status-list"><div><dt>Windows</dt><dd>{!state.available ? 'Unavailable' : state.locked === null ? 'Status unavailable' : state.locked ? 'Locked' : 'Unlocked'}</dd></div><div><dt>Phone unlock</dt><dd>{!state.available || state.locked === null ? 'Status unavailable' : state.unlockReady ? 'Ready for phone approval' : state.locked === false ? 'Checked when Windows is locked' : 'Windows request not ready'}</dd></div></dl>
      <p className="form-hint">{state.message || state.unlockMessage}</p>
      {state.pending.map(pair => <div className="computer-pair-review" key={pair.id}><h3>Review phone: {pair.name}</h3><p>Pairing code <strong>{pair.code}</strong></p><p className="form-hint">Key: {pair.deviceId}</p><label><input type="checkbox" checked={review === pair.id} onChange={event => setReview(event.target.checked ? pair.id : '')} /> The code matches my phone.</label><button className="primary-button" disabled={busy || review !== pair.id || pair.expiresAtMs <= Date.now()} onClick={() => void act('approve-pair', { pairId: pair.id, deviceId: pair.deviceId, code: pair.code })}><ShieldCheck size={15} />Pair this phone</button></div>)}
      {state.devices.map(device => <div className="computer-paired" key={device.id}><span>{device.name}</span>{state.localReview !== false && <div className="button-row"><button className="text-button" disabled={busy} onClick={() => void enrollment(device.id)}>Prepare Windows setup</button><button className="text-button" disabled={busy} onClick={() => void act('revoke', { deviceId: device.id })}>Revoke phone</button></div>}</div>)}
      {!state.devices.length && <p className="form-hint">No phone paired yet. Windows passwords are never entered here.</p>}</>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh laptop controls</button><a className="text-button" href="/downloads/JARVIS.apk">Download Android app</a></div>
  </section>;
}
