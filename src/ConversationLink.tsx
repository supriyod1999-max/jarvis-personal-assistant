import {useRef,useState} from 'react';
import {Copy,Smartphone,X} from 'lucide-react';

export default function ConversationLink({id,title}:{id:string;title:string}) {
  const dialog=useRef<HTMLDialogElement>(null),[url,setUrl]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  async function open() {
    setUrl('');setError('');setCopied(false);dialog.current?.showModal();
    try {
      const response=await fetch('/api/access',{cache:'no-store'});if(!response.ok)throw Error('Unlock this workspace and try again.');
      const access=await response.json();
      if(access.state!=='configured'||!access.phoneUrl)throw Error('Set up private phone access in Settings before continuing on another device.');
      const target=new URL(access.phoneUrl);
      if(target.protocol!=='https:'||target.username||target.password)throw Error('A secure private device address is unavailable.');
      target.pathname='/';target.search='';target.searchParams.set('conversation',id);target.hash='/command';setUrl(target.toString());
    } catch(issue) {setError((issue as Error).message);}
  }
  async function copy(){try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setError('Copy the address below manually.');}}
  return <><button className="text-button" aria-label={`Continue ${title} on another device`} onClick={()=>void open()}><Smartphone size={16}/>Continue elsewhere</button><dialog ref={dialog} className="conversation-link-dialog" aria-label="Continue on another device"><header><h2>Take this conversation with you</h2><button className="text-button" aria-label="Close conversation link" onClick={()=>dialog.current?.close()}><X size={19}/></button></header><p>{title}</p><p>Open this private link on your connected phone or laptop, then unlock the same JARVIS workspace. Your saved conversation is there; unsent drafts and microphone listening stay on this device.</p><p>Opening the link does not send a message or approve a pending action.</p>{!url&&!error&&<p role="status">Preparing your private link…</p>}{error&&<p role="alert">{error}</p>}{url&&<><label>Private conversation link<input readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label><button className="primary-button" onClick={()=>void copy()}><Copy size={16}/>{copied?'Copied':'Copy link'}</button></>}</dialog></>;
}
