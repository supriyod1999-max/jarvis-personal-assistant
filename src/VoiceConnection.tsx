import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';

type Output = { state: string; engine?: string; voice?: string; message?: string };
type Choice = { id: string; name: string; voice: string; device: string; available: boolean };
type Selection = { selected: string; revision: number; models: Choice[]; output: Output; canManage: boolean };
const labels: Record<string, string> = { checking: 'Checking voice…', idle: 'Ready to start', ready: 'Voice ready', loading: 'Loading voice', restarting: 'Restarting voice…', generating: 'Creating audio', error: 'Needs attention', unavailable: 'Setup incomplete', disconnected: 'Computer unavailable' };

export default function VoiceConnection() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const alive = useRef(false), busy = useRef(false), generation = useRef(0);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    let controller: AbortController;
    async function check() {
      if (busy.current) return;
      const version = ++generation.current;
      controller?.abort(); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch('/api/voice/models', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw Error('Unlock JARVIS and refresh to manage its voice.');
        const result: Selection = await response.json();
        if (alive.current && version === generation.current) { setSelection(result); setDraft(previous => previous || result.selected); setConnectionError(''); }
      } catch (failure) { if (alive.current && version === generation.current) setConnectionError(failure instanceof Error ? failure.message : 'Voice status is unavailable.'); }
      finally { clearTimeout(timeout); }
    }
    void check(); const timer = setInterval(() => { if (!document.hidden) void check(); }, 5000);
    return () => { alive.current = false; ++generation.current; controller?.abort(); clearInterval(timer); };
  }, []);
  async function apply() {
    if (!selection || busy.current) return;
    busy.current = true; ++generation.current; setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/voice/model', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ engine: draft, baseRevision: selection.revision }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'The voice model could not be changed. Refresh its status before trying again.');
      if (alive.current) {
        setSelection(result); setDraft(result.selected);
        if (result.output.state === 'error') setError(result.output.message);
        else setNotice('Voice model saved and restarted. Only this model is loaded.');
      }
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'The voice change could not finish. Refresh before trying again.'); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const output = selection?.output || { state: 'checking', engine: 'Local voice' };
  const restarting = pending || output.state === 'restarting';
  const canApply = selection?.canManage && !restarting && !['generating','loading'].includes(output.state) && (draft !== selection.selected || output.state === 'error');
  return <div className="connection-card voice-output-card" aria-busy={restarting}>
    <Volume2 size={23} strokeWidth={1.5} /><h3>{output.engine}</h3>
    <p>{output.voice ? output.voice + '. ' : ''}Speech is generated locally on your computer.</p>
    <div className="voice-model-field"><label htmlFor={id}>Voice model</label>
      <select id={id} value={draft} onChange={event => { setDraft(event.target.value); setNotice(''); setError(''); }} disabled={!selection?.canManage || restarting}>
        {!selection && <option value="">Loading models…</option>}
        {selection?.models.map(model => <option key={model.id} value={model.id} disabled={!model.available}>{model.name} · {model.id === 'chatterbox' ? 'JARVIS clone' : 'Daniel'} · {model.device === 'cuda' ? 'GPU' : 'CPU'}{!model.available ? ' · Not installed' : ''}</option>)}
      </select>
    </div>
    <p className="voice-model-help">Shared across your JARVIS devices. Applying stops the previous model, then restarts speech with your choice.</p>
    {selection && !selection.canManage && <p>Unlock the primary workspace to change this setting.</p>}
    <button className="secondary-button" disabled={!canApply} onClick={() => void apply()}>{restarting && <Loader2 size={15} className="spin" aria-hidden="true" />}{restarting ? 'Restarting voice…' : 'Apply & restart voice'}</button>
    <span aria-live="polite">{restarting ? labels.restarting : notice || labels[output.state] || 'Check voice setup'}</span>
    {(error || connectionError || output.state === 'error' && output.message) && <p className="form-error" role="alert">{error || connectionError || output.message}</p>}
  </div>;
}
