import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,createPublicKey,randomBytes,randomUUID,verify} from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const operations=new Set(['voice.transcribe','voice.reply','voice.speak','voice.claim','voice.renew','voice.release','session.poll','session.frame','session.stop']);
function publicKey(value){try{if(typeof value!=='string'||value.length>600)throw Error();const key=createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'});if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==2048)throw Error();return{key,id:hash(key.export({format:'der',type:'spki'}))};}catch{fail('The companion key is invalid.');}}
function signed(payload,signature,key){try{return typeof signature==='string'&&signature.length<1000&&verify('sha256',Buffer.from(payload),key,Buffer.from(signature,'base64'));}catch{return false;}}
/** Validate JPEG dimensions before retaining it. No image decoding, disk writes or model processing. */
export function checkinJpeg(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>512000||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)fail('The camera frame is invalid.');
  let position=2,dimensions=false;
  while(position<bytes.length-2){if(bytes[position++]!==255)fail('The camera frame is invalid.');while(bytes[position]===255)position++;const marker=bytes[position++];if(marker===0xda)break;if(marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7)continue;if(position+2>bytes.length)fail('The camera frame is incomplete.');const length=bytes.readUInt16BE(position);if(length<2||position+length>bytes.length)fail('The camera frame is incomplete.');if([0xc0,0xc1,0xc2].includes(marker)){if(length<8)fail('The camera frame is invalid.');const height=bytes.readUInt16BE(position+3),width=bytes.readUInt16BE(position+5);if(!width||!height||width>960||height>960)fail('The camera frame is too large.');dimensions=true;}position+=length;}
  if(!dimensions)fail('The camera frame has no supported dimensions.');return bytes;
}

/** Deliberately separate from Windows/watch authority: general voice and explicit foreground camera sessions only. */
export function createCompanionAccess({directory,executeVoice,voiceFocus,now=Date.now}){
  const file=join(directory,'phone-companions.json');let grants={};try{const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.version!==1||!saved.grants)throw Error();grants=saved.grants;}catch(error){if(error.code!=='ENOENT')fail('Companion trust could not be read. Nothing was enabled.',503);}
  const enrollments=new Map(),requests=new Map(),sessions=new Map(),frames=new Map();let serial=Promise.resolve();
  const queue=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
  const save=next=>{mkdirSync(directory,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,grants:next}),{mode:0o600});renameSync(file+'.tmp',file);grants=next;};
  function prune(){for(const map of[enrollments,requests])for(const[key,value]of map)if(value.expires<=now())map.delete(key);for(const[key,value]of sessions)if(value.lastSeen+20000<=now())sessions.delete(key);}
  function cancelFrames(device,message){for(const value of frames.values())if(value.device===device)value.finish(null,Object.assign(new Error(message),{status:409}));}
  return{
    list(){prune();return Object.values(grants).map(({id,name,pairedAt,permissions})=>({id,name,pairedAt,permissions,camera:sessions.get(id)?.sharing===true,lastSeen:sessions.get(id)?.lastSeen||null}));},
    prepare:(input,principal,check)=>queue(async()=>{prune();if(!check())fail('Unlock the primary workspace first.',401);if(enrollments.size>=8||Object.keys(grants).length>=32)fail('Review existing companion connections first.',429);const selected=publicKey(input.publicKey),name=typeof input.name==='string'?input.name.trim().slice(0,60):'';if(!name)fail('Name this device.');if(typeof input.voice!=='boolean'||typeof input.camera!=='boolean'||!input.voice&&!input.camera)fail('Choose companion permissions.');const scope=[input.voice?'voice':'',input.camera?'camera':''].filter(Boolean).join(',');const requestId=randomUUID(),expires=now()+60000,payload=['JARVIS_COMPANION_ENROLL_V1',selected.id,requestId,scope,randomBytes(24).toString('base64url'),expires].join('\n');enrollments.set(requestId,{id:selected.id,publicKey:input.publicKey,name,voice:input.voice,camera:input.camera,payload,principal,expires});return{requestId,payload,deviceId:selected.id,expiresAtMs:expires};}),
    approve:(input,principal,check)=>queue(async()=>{prune();const value=enrollments.get(input.requestId);if(!value||value.principal!==principal)fail('Companion setup expired.',401);enrollments.delete(input.requestId);if(!check()||!signed(value.payload,input.signature,publicKey(value.publicKey).key))fail('Companion setup was not approved.',403);save({...grants,[value.id]:{id:value.id,publicKey:value.publicKey,name:value.name,permissions:{voice:value.voice,camera:value.camera},pairedAt:new Date(now()).toISOString()}});return{paired:true,deviceId:value.id};}),
    revoke:(device,check)=>queue(async()=>{if(!id(device)||!check())fail('Unlock the primary workspace first.',401);const next={...grants};delete next[device];save(next);voiceFocus?.revoke('companion:'+device);sessions.delete(device);cancelFrames(device,'Device sharing ended.');for(const[key,value]of requests)if(value.device===device)requests.delete(key);return{revoked:true};}),
    challenge:input=>queue(async()=>{prune();if(!id(input.deviceId)||!grants[input.deviceId])fail('Connect this companion in the phone app first.',403);if(!operations.has(input.operation)||!(input.operation.startsWith('voice.')?grants[input.deviceId].permissions?.voice:grants[input.deviceId].permissions?.camera)||typeof input.args!=='string'||Buffer.byteLength(input.args)>16000)fail('This companion action is unavailable.');if([...requests.values()].filter(value=>value.device===input.deviceId).length>=4)fail('Wait for the current companion request.',429);const requestId=randomUUID(),expires=now()+30000,payload=['JARVIS_COMPANION_REQUEST_V1',input.deviceId,requestId,input.operation,hash(input.args),randomBytes(24).toString('base64url'),expires].join('\n');requests.set(requestId,{device:input.deviceId,operation:input.operation,args:input.args,payload,expires});return{requestId,payload,expiresAtMs:expires};}),
    async execute(input,signal){
      const request=await queue(async()=>{prune();const value=requests.get(input.requestId);if(!value)fail('Companion request expired. Nothing was resent.',401);requests.delete(input.requestId);if(!grants[value.device]||!signed(value.payload,input.signature,publicKey(grants[value.device].publicKey).key))fail('Companion request was not approved.',403);return value;});
      const check=()=>!!grants[request.device]&&!signal?.aborted;if(!check())fail('Companion disconnected.',401);let args;try{args=JSON.parse(request.args);}catch{fail('Invalid companion request.');}if(!args||typeof args!=='object'||Array.isArray(args))fail('Invalid companion request.');
      if(['voice.claim','voice.renew','voice.release'].includes(request.operation)){if(!voiceFocus)fail('Voice coordination unavailable.',503);const operation=request.operation.slice(6);return voiceFocus[operation]('companion:'+request.device,operation==='claim'?args.attempt:args.token);}
      if(request.operation==='session.poll'){
        if(typeof args.sharing!=='boolean')fail('Choose camera sharing on the device first.');sessions.set(request.device,{sharing:args.sharing,lastSeen:now()});if(!args.sharing)cancelFrames(request.device,'Camera sharing was turned off.');
        const pending=[...frames.values()].find(value=>value.device===request.device&&!value.delivered);if(pending&&args.sharing){pending.delivered=true;return{capture:{requestId:pending.id,expiresAtMs:pending.expires}};}return{capture:null};
      }
      if(request.operation==='session.stop'){sessions.delete(request.device);cancelFrames(request.device,'Camera sharing ended.');return{stopped:true};}
      if(request.operation==='session.frame'){
        const pending=frames.get(args.requestId);if(!pending||pending.device!==request.device||pending.expires<=now()||!pending.delivered||!sessions.get(request.device)?.sharing)fail('This camera check-in ended.',409);
        if(args.error){pending.finish(null,Object.assign(new Error('The device could not capture a fresh frame.'),{status:409}));return{received:false};}
        if(typeof input.data!=='string'||input.data.length>683000||typeof args.sha256!=='string')fail('The camera frame is invalid.');const bytes=Buffer.from(input.data,'base64');if(hash(bytes)!==args.sha256)fail('The camera frame changed.');checkinJpeg(bytes);if(!check())fail('Companion disconnected.',401);pending.finish(bytes);return{received:true};
      }
      // The fixed voice handler has no file, Windows, messages, records or approval operations.
      const result=await executeVoice(request.operation,args,check,signal,request.device,input.data);if(!check())fail('Companion access ended.',401);return result;
    },
    frame(device,check,signal){
      prune();if(!check())fail('Unlock the primary workspace first.',401);if(!id(device)||!grants[device]||!sessions.get(device)?.sharing)fail('Enable camera check-ins on this device first.',409);if(frames.size>=8||[...frames.values()].some(value=>value.device===device))fail('A check-in is already pending.',429);
      return new Promise((resolve,reject)=>{const requestId=randomUUID(),expires=now()+15000;let timer;const cancel=()=>finish(null,Object.assign(new Error('Camera check-in cancelled.'),{status:409}));const finish=(bytes,error)=>{frames.delete(requestId);clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error)return reject(error);if(!check()||!grants[device]){bytes?.fill(0);return reject(Object.assign(new Error('Camera check-in ended.'),{status:401}));}resolve(bytes);};frames.set(requestId,{id:requestId,device,expires,delivered:false,finish});timer=setTimeout(()=>finish(null,Object.assign(new Error('The device did not provide a fresh image. Try again.'),{status:408})),15000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
    },
    async close(){for(const value of frames.values())value.finish(null,Object.assign(new Error('Camera service ended.'),{status:503}));sessions.clear();requests.clear();enrollments.clear();await serial;},
  };
}
