/** Response lease only; never collects microphone data or sends transcripts. */
export class VoiceFocus {
  private token='';private timer:ReturnType<typeof setTimeout>|undefined;private closed=false;
  constructor(private lost:()=>void){}
  private async request(operation:string,value:object){const r=await fetch('/api/voice-focus/'+operation,{method:'POST',headers:{'Content-Type':'application/json','X-Second-Brain':'1'},body:JSON.stringify(value),signal:AbortSignal.timeout(7000)});const result=await r.json();if(!r.ok)throw Error(result.error||'Voice coordination unavailable');return result;}
  async claim(){const r=await this.request('claim',{attempt:crypto.randomUUID()});if(!r.granted)return false;this.token=r.token;if(this.closed){this.release();return false;}this.schedule();return true;}
  private schedule(){this.timer=setTimeout(async()=>{if(this.closed)return;try{const r=await this.request('renew',{token:this.token});if(!r.granted)throw Error();if(!this.closed)this.schedule();}catch{if(!this.closed){this.lost();this.close();}}},4000);}
  private release(){const token=this.token;this.token='';if(token)void this.request('release',{token}).catch(()=>{});}
  close(){this.closed=true;clearTimeout(this.timer);this.release();}
}
