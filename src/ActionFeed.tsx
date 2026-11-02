import { useState } from 'react';
import { ArrowUpRight, CheckCheck, CircleDot, Search } from 'lucide-react';
export type ActionItem = {id:string;source:string;title:string;state:string;detail:string;href:string;updatedAt:string|null};
const labels:Record<string,string>={needs_review:'Needs review',needs_attention:'Needs attention',running:'Running',waiting:'Waiting',completed:'Completed',failed:'Failed',interrupted:'Interrupted',cancelled:'Cancelled',unknown:'Not confirmed'};
const groups = [{id:'all',label:'Everything'},{id:'attention',label:'Needs you'},{id:'active',label:'In progress'},{id:'finished',label:'Finished'}];
const belongs = (state:string,filter:string) => filter==='all'||(filter==='attention'?['needs_review','needs_attention','failed','interrupted'].includes(state):filter==='active'?['running','waiting','unknown'].includes(state):['completed','cancelled'].includes(state));
export default function ActionFeed({items}:{items:ActionItem[]}) {
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
  const visible=items.filter(item=>belongs(item.state,filter)&&`${item.title} ${item.source}`.toLowerCase().includes(query.toLowerCase()));
  return <section aria-label="Action centre" className="action-feed">
    <div className="action-summary">{groups.slice(1).map(group=><button key={group.id} aria-pressed={filter===group.id} onClick={()=>setFilter(filter===group.id?'all':group.id)}><span>{group.label}</span><strong>{items.filter(item=>belongs(item.state,group.id)).length}</strong></button>)}</div>
    <div className="action-toolbar"><div className="segmented" aria-label="Action filter">{groups.map(group=><button key={group.id} aria-pressed={filter===group.id} onClick={()=>setFilter(group.id)}>{group.label}</button>)}</div><label className="action-search"><Search size={16}/><input aria-label="Search actions" placeholder="Find a request…" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
    <div className="action-list">{visible.map(item=><a className={`action-item state-${item.state}`} key={item.id} href={item.href}><span className="action-state-icon">{item.state==='completed'?<CheckCheck size={19}/>:<CircleDot size={19}/>}</span><div><div className="action-meta"><span>{item.source}</span>{item.updatedAt&&<time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>}</div><h3>{item.title}</h3><p>{item.detail}</p></div><span className="action-status">{labels[item.state]||'Not confirmed'}</span><ArrowUpRight size={17}/></a>)}</div>
    {!visible.length&&<div className="action-empty"><CheckCheck size={28}/><h2>{items.length?'No matching requests.':'A clear desk.'}</h2><p>{items.length?'Try another filter or search.':'Conversation requests, upload progress and reviews will appear here.'}</p></div>}
  </section>;
}
