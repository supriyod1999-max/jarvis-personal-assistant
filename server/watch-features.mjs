import { createHash } from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function createWatchFeatures({computer,files,coding,remote,transcription,voice,reply}){
  return async(operation,args,check,signal,id,data)=>{
    if(!args||typeof args!=='object'||Array.isArray(args))fail('Invalid watch request.');
    if(operation==='status'){const state=await computer.status(false,check);return{name:state.computerName,locked:state.locked,available:state.available,remote:remote.status().available};}
    if(operation==='files.roots'){const value=await files.status(false);return{shares:value.shares.map(({id,label})=>({id,label}))};}
    if(operation==='files.phone-download'){
      if(typeof args.share!=='string'||typeof args.path!=='string')fail('Choose a file.');const slash=args.path.lastIndexOf('/'),folder=slash<0?'':args.path.slice(0,slash),name=slash<0?args.path:args.path.slice(slash+1);const listing=await files.list(args.share,folder,check);const entry=listing.entries.find(item=>!item.directory&&item.name===name);if(!entry)fail('The file changed. Browse the folder again.');return{phoneDownload:{share:args.share,path:args.path,name:entry.name,bytes:entry.bytes}};
    }
    if(operation==='files.list'){
      if(typeof args.share!=='string'||typeof args.path!=='string')fail('Choose a folder.');const page=Number.isSafeInteger(args.offset)&&args.offset>=0&&args.offset<=500?args.offset:0;
      const value=await files.list(args.share,args.path,check),entries=[];let next=page;while(next<value.entries.length&&entries.length<20){const item=value.entries[next];if(Buffer.byteLength(JSON.stringify([...entries,item]))>9000)break;entries.push(item);next++;}return{entries,next:next<value.entries.length?next:null,truncated:value.truncated};
    }
    if(operation==='coding.list'){const state=coding?await coding.snapshot(check):{enabled:false,sessions:[]};return{enabled:state.enabled,message:state.message||'',sessions:state.sessions.slice(0,8).map(item=>({id:item.id,title:String(item.title||'Coding session').slice(0,140),status:item.status||item.state||'open',detail:String(item.detail||item.summary||'').slice(0,160)}))};}
    if(operation==='remote.input')return remote.trustedWatchInput(args.events,check);
    if(operation==='voice.transcribe'){
      if(typeof data!=='string'||data.length>1281000||typeof args.sha256!=='string')fail('The watch recording is invalid.');const wav=Buffer.from(data,'base64');if(createHash('sha256').update(wav).digest('hex')!==args.sha256)fail('The watch recording changed.');return transcription.transcribe({wav:data},signal);
    }
    if(operation==='voice.reply'){if(typeof args.text!=='string'||!args.text.trim()||args.text.length>6000)fail('Ask one question at a time.');return reply(args,id,signal);}
    if(operation==='voice.speak'){if(typeof args.text!=='string'||args.text.length>1600)fail('The spoken reply is too long.');return voice.speak({text:args.text,...(args.voice===undefined?{}:{voice:args.voice}),...(args.speed===undefined?{}:{speed:args.speed}),...(args.style===undefined?{}:{style:args.style})},signal);}
    fail('This watch action is unavailable.');
  };
}
