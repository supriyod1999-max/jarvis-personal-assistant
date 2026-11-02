import {useEffect,useState} from 'react';
import {Activity,ArrowRight,Check,Code2,RefreshCw,Timer} from 'lucide-react';
import './activity.css';
import ActionFeed, {type ActionItem} from './ActionFeed';import ConversationLink from './ConversationLink';
type Snapshot={actions?:ActionItem[];checkedAt:number;unavailable:string[];coding?:{enabled:boolean;message?:string;sessions:{id:string;title:string;state?:string;status?:string;detail?:string;preview?:string;stale?:boolean}[]};transfers?:{id:string;name:string;bytes:number;offset:number;state:string}[];connections?:{services:{id:string;name:string;state:string;detail:string;href:string}[]};reviews?:{id:string;title:string;kind?:string}[];conversations?:{id:string;title:string}[]};
const destinations=new Set(['#/settings','#/settings/assistant','#/settings/connections','#/whatsapp']);
export default function ActivityCenter({workspace,compact=false}:{workspace:string;compact?:boolean}){
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let alive=true,busy=false;const controller=new AbortController();async function refresh(){if(busy)return;busy=true;try{const r=await fetch('/api/activity',{signal:controller.signal,cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error||'Activity unavailable');if(alive){setData(v);setError('');}}catch(e){if(alive){setData(null);setError((e as Error).message);}}finally{busy=false;}}void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},15000);return()=>{alive=false;controller.abort();clearInterval(timer);};},[attempt,workspace]);
  const attention=data?.connections?.services.filter(s=>!['ready','idle'].includes(s.state))||[];
  if(compact) return <section className="activity-page activity-compact" aria-label="Live activity">
    <header className="activity-heading"><div><h2>Across your devices</h2><p>Current reviews and recent conversations from your laptop.</p></div><a className="text-button" href="#/activity">Action centre <ArrowRight size={15}/></a></header>
    {error&&<div role="alert"><p>Activity is unavailable. Your saved items above are still here.</p><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Try again</button></div>}
    {!data&&!error&&<p role="status">Checking your activity…</p>}
    {!!data?.unavailable.length&&<p role="alert">Could not check {data.unavailable.join(', ')}.</p>}
    {data&&<div className="activity-compact-grid"><section className="activity-section"><h3>Needs you</h3>
      {data.reviews?.slice(0,3).map(r=><a className="activity-row" key={r.id} href={(({task:'#/tasks',person:'#/people',note:'#/knowledge',project:'#/projects',inbox:'#/inbox'} as Record<string,string>)[r.kind||'']||'#/command')}><div><strong>{r.title}</strong><p>Review the proposed change before saving</p></div><ArrowRight size={16}/></a>)}
      {attention.slice(0,2).map(s=><a className="activity-row" key={s.id} href={destinations.has(s.href)?s.href:'#/settings'}><div><strong>{s.name}</strong><p>{s.detail}</p></div><ArrowRight size={16}/></a>)}
      {!attention.length&&!data.reviews?.length&&<p>{data.unavailable.length?'Some services could not be checked.':'No pending reviews or connection issues reported.'}</p>}
    </section><section className="activity-section"><h3>Continue a conversation</h3>{data.conversations?.slice(0,3).map(c=><a className="activity-row" key={c.id} href={`?conversation=${encodeURIComponent(c.id)}#/command`}><strong>{c.title}</strong><ArrowRight size={16}/></a>)}{!data.conversations?.length&&<p>Your saved conversations will appear here.</p>}<a className="text-button" href="#/command">Open JARVIS <ArrowRight size={15}/></a></section></div>}
    {data&&<p className="form-hint">Checked {new Date(data.checkedAt).toLocaleTimeString()}. Refreshes while Home is visible.</p>}
  </section>;
  return <section className="activity-page"><header className="activity-heading"><div><p className="overline">ACROSS YOUR CONNECTED SPACE</p><h1>Action centre</h1><p>Your requests, their progress, and what needs you next.</p></div><button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/>Refresh</button></header>
    {error&&<p role="alert">{error} Reconnect to see current activity.</p>}
    {!data&&!error&&<p role="status">Checking your requests…</p>}
    {!!data?.unavailable.length&&<p role="alert">Could not check {data.unavailable.join(', ')}. The list is incomplete; no actions were retried.</p>}
    {data&&<ActionFeed items={data.actions||[]}/>}
    <section className="activity-section"><h2>Pick up a conversation</h2><p>Continue here or take a private link to another connected device.</p>{data?.conversations?.map(c=><div className="activity-row conversation-resume" key={c.id}><a href={`?conversation=${encodeURIComponent(c.id)}#/command`}><strong>{c.title}</strong><ArrowRight size={16}/></a><ConversationLink id={c.id} title={c.title}/></div>)}</section>
    <details className="focus-disclosure"><summary>Focus timer on this device</summary><FocusRoutine key={workspace} workspace={workspace}/></details>
    {data&&<p className="form-hint">Checked {new Date(data.checkedAt).toLocaleTimeString()}. Updates while this screen is visible. Progress is reported by each source; opening an item never retries or approves it.</p>}
  </section>;
}

function FocusRoutine({workspace}:{workspace:string}){
  const key=`jarvis-focus:${workspace}`;
  const [minutes,setMinutes]=useState(25),[end,setEnd]=useState(()=>{try{const v=Number(localStorage.getItem(key));return Number.isFinite(v)&&v>0&&v<Date.now()+7200000?v:0;}catch{return 0;}}),[now,setNow]=useState(Date.now()),[notice,setNotice]=useState('');
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  function change(value:number){setEnd(value);setNow(Date.now());try{value?localStorage.setItem(key,String(value)):localStorage.removeItem(key);}catch{setNotice('This timer will last only while this page stays open.');}}
  const left=Math.max(0,Math.ceil((end-now)/1000));
  return <div className="focus-routine"><div><p className="overline">A LITTLE ROOM TO FOCUS</p><h2><Timer size={21}/>{end?left?`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} remaining`:'Time for a break':'Start a focus session'}</h2><p>Runs on this device, even without the laptop connection. No microphone or apps are started.</p></div><div className="focus-actions">{!end?<><label>Minutes <select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[10,25,45,60].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button className="primary-button" onClick={()=>change(Date.now()+minutes*60000)}>Start focus</button></>:<button className="secondary-button" onClick={()=>change(0)}>{left?'End session':'Finish'}</button>}</div>{notice&&<p role="status">{notice}</p>}</div>;
}
