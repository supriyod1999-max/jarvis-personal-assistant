import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type Choice = { id: string; name: string };
export default function ModelPicker({ disabled, current, onChange }: { disabled: boolean; current?: string; onChange: () => void }) {
  const [choices, setChoices] = useState<Choice[]>([]), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const mounted=useRef(false),changing=useRef(false),readVersion=useRef(0);
  const validChoices=(value:unknown):Choice[]=>Array.isArray(value)?value.filter((item):item is Choice=>!!item&&typeof item.id==='string'&&typeof item.name==='string').slice(0,100):[];
  async function refresh(signal?: AbortSignal) {
    const version=++readVersion.current;setLoading(true);
    try { const response = await fetch('/api/chat/models', { signal, cache: 'no-store' });const value=await response.json();if(!response.ok)throw Error(value.error||'Unlock JARVIS and connect ChatGPT to load model choices.');if(!mounted.current||signal?.aborted||version!==readVersion.current||changing.current)return;const available=validChoices(value.models);setChoices(available);setSelected(value.selected);setError(available.length?'':'No models were returned by this ChatGPT connection. Reload models or check Connections.'); }
    catch (error) { if (mounted.current&&!signal?.aborted&&version===readVersion.current&&!changing.current) setError((error as Error).message); }
    finally{if(mounted.current&&!signal?.aborted&&version===readVersion.current)setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readVersion.current++;};},[]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [current]);
  async function choose(model: string) {
    if(changing.current||disabled||!choices.some(choice=>choice.id===model))return;changing.current=true;readVersion.current++;setLoading(false);setBusy(true); setError('');
    try { const response = await fetch('/api/chat/model', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' }, body: JSON.stringify({ model }) }); const value = await response.json(); if (!response.ok) throw Error(value.error || 'The model could not be changed.');if(value.selected!==model)throw Error('The server did not confirm that model. Reload models before trying again.');if(!mounted.current)return;setSelected(value.selected);setChoices(validChoices(value.models)); onChange(); }
    catch (error) { if(mounted.current)setError((error as Error).message+' Reload models to check the saved choice.'); } finally { changing.current=false;if(mounted.current)setBusy(false); }
  }
  const missing=!!selected&&!choices.some(choice=>choice.id===selected);
  return <div className="model-picker" aria-label="AI model selection"><label>AI model<select aria-label="Conversation model" disabled={disabled || busy || loading || !choices.length} value={selected} onChange={event => void choose(event.target.value)}>
    {!choices.length&&<option value="">{loading?'Loading models…':'Models unavailable'}</option>}{missing&&<option value={selected} disabled>{selected} · unavailable</option>}{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
    </select></label><button className="model-picker-refresh" type="button" aria-label="Reload models" title="Reload models" disabled={busy||loading} onClick={()=>void refresh()}><RefreshCw size={15}/></button>
    <p role="status">{busy?'Saving your model choice…':disabled?'Finish the current reply or end Talk to change models.':missing?'Choose an available model to continue.':'Applies to your next reply, including voice and action understanding.'}</p>{error&&<p className="model-picker-error" role="alert">{error}</p>}
  </div>;
}
