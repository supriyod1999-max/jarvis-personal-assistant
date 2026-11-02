import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const executable=fileURLToPath(new URL('../output/remote-control/build/Release/jarvis-remote.exe',import.meta.url));

// Fixed stdin protocol to one restricted helper; never a shell or caller command.
export function createRemoteNative(){
  let child=null,pending=null,sequence=0,buffer='';
  const available=()=>process.platform==='win32'&&existsSync(executable);
  function stop(){const active=child;child=null;active?.kill();if(pending){clearTimeout(pending.timer);pending.reject(Error('Remote helper stopped'));pending=null;}buffer='';}
  function start(){
    if(child)return;if(!available())throw Error('Remote helper unavailable');
    child=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const running=child;
    child.stdout.on('data',bytes=>{
      if(child!==running)return;
      buffer+=bytes.toString('utf8');if(buffer.length>2048){stop();return;}
      const end=buffer.indexOf('\n');if(end<0)return;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      const waiting=pending;if(!waiting)return;pending=null;clearTimeout(waiting.timer);
      try{const result=JSON.parse(line);if(result.sequence!==waiting.sequence||result.applied!==true)throw Error();waiting.resolve(result);}catch{waiting.reject(Error('Windows refused remote input'));}
    });
    child.on('error',()=>{if(child===running)stop();});child.on('exit',()=>{if(child===running)stop();});child.stdin.on('error',()=>{if(child===running)stop();});
  }
  async function input(events){
    for(const event of events){
      start();if(pending)throw Error('Remote helper busy');const id=++sequence;
      const op=event.type,a=event.x??event.steps??0,b=event.y??0,text=event.text??event.key??event.button??'';
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>stop(),5000);pending={sequence:id,resolve,reject,timer};child.stdin.write([id,op,a,b,Buffer.from(text,'utf8').toString('hex')].join('|')+'\n');});
    }
    return{applied:true};
  }
  return{available,input,close:async()=>stop()};
}
