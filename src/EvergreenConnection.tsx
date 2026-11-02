import { useEffect, useState } from 'react';
import './evergreen.css';
type Status = { moduleAccess?: { boundary: string }; localPreferencesOnly?: boolean; state: string; problem?: string | null; synthetic?: boolean; mode: string; memberContext?: { profileId: string; privateAccess: string; sharedAccess: string }; privacy?: { processWithAI: boolean; retainChat: boolean; agreedAt: string | null }; pairing: { pairingId: string | null; expiresAt: string | null } | null; connection: { scopes: string[]; memberUid?: string; householdId?: string } | null; records: number; capabilities: { domain: string; read: boolean; operations: string[]; gap: string; rolloutEnabled?: boolean }[]; requests: { requestId: string; state: string }[] };
export default function EvergreenConnection() {
  const [state, setState] = useState<Status | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [processWithAI, setProcessWithAI] = useState(false), [retainChat, setRetainChat] = useState(false), [removeReviewed, setRemoveReviewed] = useState(false);
  async function refresh() { const r = await fetch('/api/evergreen/status', { cache: 'no-store' }); const value = await r.json(); if (!r.ok) throw new Error(value.error); setState(value); setProcessWithAI(value.privacy?.processWithAI === true); setRetainChat(value.privacy?.retainChat === true); }
  useEffect(() => { void refresh().catch(() => setError('Evergreen connection status is unavailable.')); }, []);
  async function action(name: string, input = {}) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await fetch(`/api/evergreen/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify(input) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); await refresh(); if (name === 'privacy') setNotice(state?.localPreferencesOnly ? 'Preferences saved for this workspace. Live access remains on hold; review these choices again when connecting Evergreen.' : 'Privacy choices saved.'); if (name === 'redact-chat') setNotice('Evergreen chat contents removed. Recovery receipts are preserved.'); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); } finally { setBusy(false); }
  }
  const held = !state || ['release-held', 'owner-only'].includes(state.state);
  const memberConnection = state?.mode === 'household';
  const fullModules = state?.moduleAccess?.boundary === 'household-module-access-v1';
  const privacyProblem = ({ privacy_review_required: 'Ownership review needed in Evergreen. Original requests are kept; do not replace an interrupted change.', native_privacy_release_required: 'Security hold. Evergreen’s private workspace release is not ready.', private_rollout_scopes: 'This module is not available under the current release and permissions.', permissions_changed: 'Permissions changed. The connection cache was cleared; new signed-in consent and pairing are required.', private_record_denied: 'Record access denied. The connection cache was cleared; review access in Evergreen Settings.' } as Record<string, string>)[state?.problem || ''];
  return <section className="settings-panel evergreen-settings" aria-label="Evergreen companion">
    <h2>Evergreen · your {memberConnection ? 'member' : 'personal'} connection</h2>
    <p>{!state ? 'Checking connection status…' : state.state === 'owner-only' ? 'This connection belongs to Owner’s primary workspace.' : held ? 'Live access is waiting for the reviewed security release and signed-in consent.' : state.synthetic ? 'Synthetic test connection — no real Evergreen data.' : fullModules ? 'Evergreen module connection · access depends on your approved permissions.' : 'Production connection · tasks and planner only.'}</p>
    {!held && <p role="status">{privacyProblem || (state?.state === 'suspended' ? ['security_hold', 'release_held'].includes(state.problem || '') ? 'Security hold. Original requests are kept; receipt recovery may be unavailable until the hold is resolved.' : state.problem === 'rate_limited' ? 'Evergreen has paused requests. No automatic retry.' : state.problem === 'privacy_required' ? 'Your data-processing approval is needed below.' : 'Connection error. Check the connection; nothing was automatically retried.' : state?.state === 'denied' ? 'Access was denied or revoked. The private connection cache has been cleared.' : state?.connection ? 'Paired. Access is checked again before each operation.' : state?.pairing ? 'Waiting for your signed-in Evergreen approval and original proof exchange.' : 'Not paired. No Evergreen records are available.')}</p>}
    <p>{fullModules ? 'Connect the supported modules you choose in Evergreen Settings. Purchases and ledger repayments require finance permissions.' : 'Start with tasks and your planner. Other modules need their own permissions in Evergreen.'} {memberConnection ? 'Each member approves their own connection. This session can access only your private records and explicitly permitted shared records. Your partner’s private records stay separate.' : 'Your connection does not include Partner’s private records or repayments to her.'}</p>
    {memberConnection && <p>Pairing, privacy choices, saved sync progress and interrupted changes belong to this authenticated workspace. Switching workspaces ends the current spoken review.</p>}
    {!held && <div className="button-row">
      {!state?.connection && !state?.pairing?.pairingId && <button className="secondary-button" disabled={busy || !state?.privacy?.processWithAI} onClick={() => void action('pair')}>{state?.pairing ? 'Retry original pairing request' : 'Create pairing ID'}</button>}
      {state?.pairing?.pairingId && <><p>Pairing ID: <strong>{state.pairing.pairingId}</strong>. {state.synthetic ? 'Use the synthetic Settings consent procedure in the companion guide. The live Settings page cannot approve fixture accounts.' : 'Enter only this ID in Evergreen Settings and review your account and permissions there.'}</p><button className="secondary-button" disabled={busy} onClick={() => void action('exchange')}>Complete approved pairing</button></>}
      {state?.connection && <button className="secondary-button" disabled={busy} onClick={() => void action('sync')}>Sync Evergreen</button>}
      {state?.connection && <button className="secondary-button" disabled={busy} onClick={() => void action('check')}>Check connection</button>}
      {state?.connection && <button className="secondary-button" disabled={busy} onClick={() => void action('rotate')}>Renew connection secret</button>}
      {state?.requests.filter(r => ['preparing', 'uncertain', 'committing'].includes(r.state)).map(r => <button key={r.requestId} className="secondary-button" disabled={busy} onClick={() => void action('recover', { requestId: r.requestId })}>Recover interrupted change</button>)}
    </div>}
    {state?.state !== 'owner-only' && <fieldset disabled={busy || !state || (held && memberConnection && !state.localPreferencesOnly)}>
      <legend>Evergreen privacy choices</legend>
      {state?.localPreferencesOnly && <p>You can save your preferences now. They do not enable processing, chat retention or Evergreen access during the security hold. You’ll review them again when connecting your verified Evergreen account.</p>}
      <label><input type="checkbox" checked={processWithAI} onChange={e => setProcessWithAI(e.target.checked)} />Allow my Evergreen requests and necessary record details to be processed through my ChatGPT connection</label>
      <label><input type="checkbox" checked={retainChat} onChange={e => setRetainChat(e.target.checked)} />Keep Evergreen conversations in JARVIS chat history</label>
      <p>Without chat history, content is held only in the running server’s memory and is excluded from chat exports. The encrypted connection store still keeps records, proposals and receipts needed for safe recovery. Saved chat history uses JARVIS’s existing database, separate from that encrypted store.</p>
      <p>Evergreen conversations are not reused as general AI or automatic memory context. Turning chat history off removes the contents of existing conversations containing Evergreen, including other messages in those conversations. Downloaded copies, backups and information already sent to ChatGPT cannot be recalled. These choices do not activate live access.</p>
      <button className="secondary-button" onClick={() => void action('privacy', { processWithAI, retainChat, confirm: true })}>Save reviewed privacy choices</button>
      <label><input type="checkbox" checked={removeReviewed} onChange={e => setRemoveReviewed(e.target.checked)} />Remove the contents of all conversations containing Evergreen; keep only redacted request receipts</label>
      <button className="text-button" disabled={!removeReviewed} onClick={() => { void action('redact-chat', { confirm: true }); setRemoveReviewed(false); }}>Remove Evergreen chat contents</button>
    </fieldset>}
    {state?.connection && <p>Approved permissions: {state.connection.scopes.join(', ')}.</p>}
    {memberConnection && state?.connection && <details><summary>Verified connection binding</summary><p>Member: {state.connection.memberUid}. Household: {state.connection.householdId}. These identifiers come from the approved Evergreen grant; changing a display name does not change access.</p></details>}
    <p>Ask “add a task in Evergreen” or “show my Evergreen planner”. JARVIS reads back changes before saving. Say “confirm Evergreen change” after the review; corrections create a new review.</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <details><summary>Available modules and limits</summary>{state?.capabilities.map(c => <div key={c.domain}><h3>{c.domain}</h3><p>{c.rolloutEnabled === false ? 'Not enabled for this rollout. ' : c.rolloutEnabled === true ? 'Enabled for this rollout with approved permissions. ' : 'Implementation inventory; availability depends on release and permissions. '}{c.read ? `${c.operations.length} implemented changes.` : 'Access is on hold.'} {c.gap}</p></div>)}</details>
    <p className="form-hint">Photos remain on hold. Notes cover notebook details, not TALP content. Finance changes record information and never move money.</p>
    {state?.connection && <button className="text-button" disabled={busy} onClick={() => void action('disconnect')}>Disconnect and erase local Evergreen cache</button>}
    <p className="form-hint">Disconnecting here erases the local connection. Revoke it in Evergreen Settings too; that step works even during a security hold.</p>
  </section>;
}
