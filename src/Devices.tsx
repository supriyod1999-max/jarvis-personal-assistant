import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,FolderOpen,Laptop,Link2,Plus,RefreshCw,ShieldCheck,Smartphone,X} from 'lucide-react';
import './devices.css';
import CameraCheckins from './CameraCheckins';

type Device={id:string;name:string;kind:string;role:string;presence:'online'|'unknown';pairedAt?:string;detail:string;capabilities:{files:boolean;transfers:boolean;screen:boolean;remoteInput:boolean}};
type Network={hostId:string;devices:Device[]};
export default function Devices(){
  const [network,setNetwork]=useState<Network|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  const add=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const controller=new AbortController();let active=true;
    async function refresh(){try{const response=await fetch('/api/devices',{cache:'no-store',signal:controller.signal});const value=await response.json();if(!response.ok)throw Error(value.error||'Device connection unavailable.');if(active){setNetwork(value);setError('');}}catch(issue){if(active){setNetwork(null);setError((issue as Error).message);}}finally{if(active)setLoading(false);}}
    setLoading(true);void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[attempt]);
  return <section className="devices-view" aria-labelledby="devices-heading">
    <header className="devices-heading"><div><p className="section-kicker">YOUR PRIVATE NETWORK</p><h1 id="devices-heading">Every device. One JARVIS.</h1><p>Choose a device. Bring its files and tools closer.</p></div><button className="secondary-button" onClick={()=>add.current?.showModal()}><Plus size={17}/>Add a device</button></header>
    <div className="devices-network-note"><span><ShieldCheck size={17}/> Private connection</span><button className="text-button" disabled={loading} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={14} className={loading?'spin':''}/>Refresh</button></div>
    {error&&<p className="devices-error" role="alert">{error} Check the laptop is awake and Tailscale is connected.</p>}
    {loading&&!network?<p role="status">Finding your enrolled devices…</p>:network&&<div className="device-grid">{network.devices.map(device=><article className="device-card" key={device.id} aria-label={device.name}>
      <div className="device-top"><span className={'device-art '+(device.role==='host'?'device-art-host':'')}>{device.kind==='android'?<Smartphone size={40} strokeWidth={1.1}/>:<Laptop size={52} strokeWidth={1.1}/>}</span><span className={'device-status '+(device.presence==='online'?'online':'')}>{device.presence==='online'?<><i/>Online</>:<><Check size={13}/>Paired</>}</span></div>
      <h2>{device.name}</h2><p className="device-kind">{device.role==='host'?'JARVIS host · '+(device.kind==='windows'?'Windows':'Computer'):'Android companion · Presence unknown'}</p><p className="device-detail">{device.detail}</p>
      {device.role==='host'?<><div className="device-capabilities"><span className={device.capabilities.files?'ready':''}><FolderOpen size={14}/>{device.capabilities.files?'Drives available':'Files unavailable'}</span><span>Screen access coming next</span></div><a className={'primary-button device-action '+(!device.capabilities.files?'device-disabled':'')} aria-disabled={!device.capabilities.files} href={device.capabilities.files?'#/files':undefined}><FolderOpen size={16}/>Browse files<ArrowRight size={16}/></a></>:<><div className="device-capabilities"><span className="ready"><ShieldCheck size={14}/>Biometric controls</span><span>Phone files not connected</span></div><a className="secondary-button device-action" href="#/settings/devices">Manage pairing<ArrowRight size={15}/></a></>}
    </article>)}</div>}
    <CameraCheckins/>
    <div className="devices-direction"><Link2 size={22}/><div><h2>A network that grows with you.</h2><p>This release connects your host laptop and its paired Android companions. Access to files on other phones and laptops needs a device agent and enrollment on each one. Joining Tailscale alone does not grant file or screen access.</p></div></div>
    <dialog className="device-enroll" ref={add} onClick={event=>{if(event.target===add.current)add.current?.close();}}><button className="icon-button device-enroll-close" aria-label="Close device setup" onClick={()=>add.current?.close()}><X size={20}/></button><Smartphone size={34}/><h2>Bring another phone.</h2><p>Install JARVIS on Android, connect Tailscale with your existing account, and open your laptop’s private JARVIS address.</p><ol><li>Unlock your JARVIS workspace on the phone.</li><li>Choose <strong>••• → Laptop controls → Pair this phone</strong>.</li><li>Compare the code on your laptop and approve the pairing in Settings → Devices.</li></ol><a className="primary-button" href="/downloads/JARVIS.apk">Download Android app<ArrowRight size={16}/></a><p className="device-enroll-future">Enrollment for additional laptop hosts is still being built. This pairing enables biometric laptop controls; it does not share the phone’s files.</p></dialog>
  </section>;
}
