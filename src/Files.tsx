import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ChevronRight, File as FileIcon, Folder, FolderPlus, RefreshCw, Upload, X } from 'lucide-react';
import './files.css';
type Share={id:string;label:string;path?:string};
type Item={name:string;directory:boolean;bytes:number;modified:string};
const MAXIMUM_BYTES=20*1024**3;
type Transfer={id:string;share:string;path:string;name:string;size:number};
type Receipt={id:string;offset:number;state:string;chunkBytes:number};
async function call(path:string,body?:unknown,signal?:AbortSignal){const response=await fetch('/api/files/'+path,{cache:'no-store',signal,...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Second-Brain':'1'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'File connection unavailable.'),{status:response.status});return data;}
function chunkUpload(transfer:Transfer,offset:number,bytes:Blob,digest:string,signal:AbortSignal,onProgress:(loaded:number)=>void):Promise<Receipt>{
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest(),abort=()=>request.abort();
    const stop=()=>signal.removeEventListener('abort',abort);
    request.open('POST','/api/files/transfers/chunk?'+new URLSearchParams({id:transfer.id,offset:String(offset)}));
    request.setRequestHeader('Content-Type','application/octet-stream');request.setRequestHeader('X-Second-Brain','1');request.setRequestHeader('X-Content-SHA256',digest);
    request.timeout=0; // No fixed deadline, including on a slow mobile connection.
    request.upload.onprogress=e=>onProgress(e.loaded);
    request.onerror=()=>{stop();reject(Error('Connection interrupted. Resume to continue from the saved position.'));};
    request.onabort=()=>{stop();reject(new DOMException('Upload paused.','AbortError'));};
    request.onload=()=>{stop();try{const data=JSON.parse(request.responseText);if(request.status<200||request.status>=300)throw Error(data.error||'The upload stopped.');resolve(data);}catch(error){reject(error);}};
    if(signal.aborted){reject(new DOMException('Upload paused.','AbortError'));return;}
    signal.addEventListener('abort',abort,{once:true});request.send(bytes);
  });
}
export default function Files(){
  const nativeTransfers=navigator.userAgent.includes("JARVISNativeTransfers/1");
  const [shares,setShares]=useState<Share[]>([]),[share,setShare]=useState(''),[path,setPath]=useState(''),[items,setItems]=useState<Item[]>([]),[configure,setConfigure]=useState(false),[folder,setFolder]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[truncated,setTruncated]=useState(false);
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState(''),[progress,setProgress]=useState<number|null>(null),[notice,setNotice]=useState('');
  const upload=useRef<AbortController|null>(null),alive=useRef(true);
  const [transfer,setTransfer]=useState<Transfer|null>(null),[discarding,setDiscarding]=useState(false),[maximum,setMaximum]=useState(MAXIMUM_BYTES);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;upload.current?.abort();};},[]);
  useEffect(()=>{let active=true;setLoading(true);setItems([]);setError('');void(async()=>{try{const status=await call('status');if(!active)return;setMaximum(status.maximumBytes||MAXIMUM_BYTES);setShares(status.shares);setConfigure(status.canConfigure);const chosen=status.shares.some((s:Share)=>s.id===share)?share:status.shares[0]?.id||'';if(chosen!==share){setShare(chosen);setPath('');return;}if(chosen){const value=await call('list?'+new URLSearchParams({share:chosen,path}));if(!active)return;setItems(value.entries);setTruncated(value.truncated);}}catch(e){if(active)setError((e as Error).message);}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[share,path,refresh]);
  async function change(body:unknown){setError('');try{await call('configure',body);if(alive.current){setFolder('');setRefresh(n=>n+1);}}catch(e){if(alive.current)setError((e as Error).message);}}
  async function send(event:FormEvent){
    event.preventDefault();if(!file||!share||upload.current)return;
    if(file.size>Math.min(maximum,MAXIMUM_BYTES)){setError('This connection supports files up to '+(maximum/1024**3).toLocaleString()+' GB. Refresh after updating JARVIS.');return;}
    const operation=transfer||{id:crypto.randomUUID(),share,path,name,size:file.size},controller=new AbortController();
    let registered=!!transfer;
    setTransfer(operation);upload.current=controller;setError('');setNotice('');setProgress(0);
    const update=(bytes:number)=>{if(alive.current)setProgress(file.size?Math.min(99,Math.floor(bytes/file.size*100)):0);};
    try{
      let saved:Receipt=await call('transfers/begin',operation,controller.signal);
      registered=true;
      if(saved.state==='cancelled')throw Error('This upload was discarded. Choose a new file.');
      if(!Number.isSafeInteger(saved.offset)||saved.offset<0||saved.offset>file.size||!Number.isSafeInteger(saved.chunkBytes)||saved.chunkBytes<1||saved.chunkBytes>8*1024**2)throw Error('Invalid upload progress. Refresh JARVIS.');
      update(saved.offset);
      while(saved.state!=='complete'&&saved.offset<file.size){
        controller.signal.throwIfAborted();const offset=saved.offset,chunk=file.slice(offset,Math.min(file.size,offset+saved.chunkBytes));
        const hash=await crypto.subtle.digest('SHA-256',await chunk.arrayBuffer());controller.signal.throwIfAborted();
        const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
        saved=await chunkUpload(operation,offset,chunk,digest,controller.signal,loaded=>update(offset+loaded));
        if(saved.offset!==offset+chunk.size)throw Error('Upload progress changed. Resume to check its saved position.');
        update(saved.offset);
      }
      controller.signal.throwIfAborted();await call('transfers/finish',{id:operation.id},controller.signal);
      if(alive.current){setNotice('Saved to your laptop.');setTransfer(null);setFile(null);setName('');setRefresh(n=>n+1);}
    }catch(error){if(alive.current){
      if(controller.signal.aborted)setNotice('Upload paused. Keep this page open and tap Resume upload to continue.');
      else{
        const status=(error as Error&{status?:number}).status;
        const rejected=!registered&&status!==undefined&&status>=400&&status<500;
        if(rejected)setTransfer(null);
        setError((error as Error).message+(rejected?'':' Keep this page open to resume.'));
      }
    }}
    finally{upload.current=null;if(alive.current)setProgress(null);}
  }
  async function discard(){
    if(!transfer||discarding)return;setDiscarding(true);setError('');
    try{const result=await call('transfers/cancel',{id:transfer.id});if(alive.current){setNotice(result.state==='complete'?'The file was already saved to your laptop.':'Upload discarded.');setTransfer(null);setRefresh(n=>n+1);}}
    catch(error){if(alive.current){if((error as Error&{status?:number}).status===404){setTransfer(null);setNotice('Upload discarded.');}else setError((error as Error).message);}}
    finally{if(alive.current)setDiscarding(false);}
  }
  const activeShare=shares.find(s=>s.id===share),crumbs=path?path.split('/'):[];
  return <section className="files-view" aria-labelledby="files-heading"><header className="files-heading"><div><a className="section-kicker" href="#/devices">YOUR DEVICES / LAPTOP</a><h1 id="files-heading">Files, wherever you are.</h1><p>Browse your laptop’s drives, then move a file to the device you need.</p></div><button className="secondary-button" onClick={()=>setRefresh(n=>n+1)} disabled={loading}><RefreshCw size={16}/>Refresh</button></header>
    {error&&<p className="files-message" role="alert">{error}</p>}{notice&&<p className="files-message" role="status">{notice}</p>}
    {!!shares.length&&<><div className="files-folders" aria-label="Laptop drives and folders">{shares.map(s=><button key={s.id} aria-pressed={share===s.id} disabled={progress!==null||!!transfer} onClick={()=>{setShare(s.id);setPath('');}}><Folder size={18}/>{s.label}</button>)}</div><nav className="files-breadcrumb" aria-label="Folder location"><button disabled={progress!==null||!!transfer} onClick={()=>setPath('')}>{activeShare?.label}</button>{crumbs.map((part,index)=><span key={index}><ChevronRight size={13}/><button disabled={progress!==null||!!transfer} onClick={()=>setPath(crumbs.slice(0,index+1).join('/'))}>{part}</button></span>)}</nav>
    <div className="files-list" aria-busy={loading}>{loading?<p>Loading files…</p>:items.length?items.map(item=><div className="files-row" key={item.name}><span className="files-icon">{item.directory?<Folder size={22}/>:<FileIcon size={22}/>}</span><div className="files-item-name">{item.directory?<button disabled={progress!==null||!!transfer} onClick={()=>setPath([...crumbs,item.name].join('/'))}>{item.name}</button>:<strong>{item.name}</strong>}<small>{item.directory?'Folder':new Intl.NumberFormat(undefined,{style:'unit',unit:'megabyte',maximumFractionDigits:2}).format(item.bytes/1048576)} · {new Date(item.modified).toLocaleDateString()}</small></div>{item.directory?<button className="icon-button" aria-label={'Open '+item.name} disabled={progress!==null||!!transfer} onClick={()=>setPath([...crumbs,item.name].join('/'))}><ChevronRight size={18}/></button>:<a className="icon-button" aria-label={'Download '+item.name} href={'/api/files/download?'+new URLSearchParams({share,path:[...crumbs,item.name].join('/')})} download><ArrowDownToLine size={18}/></a>}</div>):<p>This folder is empty. Add a file below.</p>}{truncated&&<p>Showing the first 500 items. Open a smaller subfolder to find more.</p>}</div>
    {nativeTransfers&&<div className="files-upload"><strong>Send a file in the background</strong><p>Uploads and downloads continue when you close JARVIS or lock your phone, and resume after a connection drop.</p><a className="primary-button" href={"/native/files/upload?"+new URLSearchParams({share,path})}><Upload size={16}/>Choose a file to send</a><small>Manage progress from App controls → Transfers.</small></div>}
    {!nativeTransfers&&<form className="files-upload" onSubmit={event=>void send(event)}><label className="files-pick"><Upload size={20}/><span>{file?.name||'Choose a file from this device'}<small>Up to 20 GB · no transfer time limit</small></span><input aria-label="Choose a file to transfer" type="file" disabled={progress!==null||!!transfer} onChange={e=>{const chosen=e.target.files?.[0]||null;setFile(chosen);setName(chosen?.name||'');}}/></label>{file&&<label>Save as<input aria-label="File name on laptop" value={name} maxLength={240} disabled={progress!==null||!!transfer} onChange={e=>setName(e.target.value)}/></label>}<div>{progress===null?<><button className="primary-button" disabled={!file||!name||loading||discarding}><Upload size={16}/>{transfer?'Resume upload':'Send to laptop'}</button>{transfer&&<button type="button" className="secondary-button" disabled={discarding} onClick={()=>void discard()}><X size={15}/>{discarding?'Discarding…':'Discard upload'}</button>}</>:<><progress aria-label="Upload progress" max={100} value={progress}/><span>{progress}%</span><button type="button" className="secondary-button" onClick={()=>upload.current?.abort()}><X size={15}/>Pause</button></>}</div>{transfer&&<small>Keep this page open to resume. The file appears in its destination after the upload finishes.</small>}</form>}</>}
    {!loading&&!shares.length&&<div className="files-empty"><FolderPlus size={36}/><h2>No drives available yet.</h2><p>{configure?'Create a JARVIS transfer folder, or share a folder from your laptop below.':'Keep the laptop awake and refresh to check its drives.'}</p>{configure&&<button className="primary-button" onClick={()=>void change({operation:'create',label:'JARVIS Transfers'})}>Create transfer folder</button>}</div>}
    <p className="form-hint">{nativeTransfers?"Up to 20 GB per file. Background transfers have saved progress and a notification. Android Force stop stops jobs; reopen Transfers to resume. Files follow Windows permissions and existing files are never overwritten.":"Up to 20 GB per file, with no fixed transfer deadline. Pause and resume uploads while this page stays open. The Android app supports background transfers. Files follow Windows permissions; credentials are protected and existing files are never overwritten."}</p>
    {configure&&<details className="files-settings"><summary>Manage shared folders</summary><p>Choose folders on this laptop. Only these folders are available on your phone. Hidden files, linked folders and application storage stay excluded.</p><form onSubmit={e=>{e.preventDefault();void change({operation:'add',path:folder});}}><label>Folder path<input required placeholder="C:\Users\…\Downloads" value={folder} onChange={e=>setFolder(e.target.value)}/></label><button className="secondary-button">Share folder</button></form>{shares.map(s=><div className="files-share" key={s.id}><span>{s.label}<small>{s.path}</small></span><button className="secondary-button" onClick={()=>void change({operation:'remove',id:s.id})}>Stop sharing</button></div>)}</details>}
  </section>;
}
