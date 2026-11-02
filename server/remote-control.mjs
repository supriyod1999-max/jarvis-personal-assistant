import { randomBytes, randomUUID, verify } from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const media=new Set(['play-pause','next','previous','stop','volume-up','volume-down','mute']);
const keys=new Set(['enter','backspace','tab','escape','left','right','up','down','space']);
export function remoteEvent(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid control input.');
  const allowed={move:['type','x','y'],scroll:['type','steps'],click:['type','button'],key:['type','key'],text:['type','text'],media:['type','key']}[input.type];
  if(!allowed||Object.keys(input).some(key=>!allowed.includes(key)))fail('Unsupported control input.');
  const number=(value,max)=>Number.isInteger(value)&&Math.abs(value)<=max;
  if(input.type==='move'&&number(input.x,600)&&number(input.y,600))return {type:'move',x:input.x,y:input.y};
  if(input.type==='scroll'&&number(input.steps,10)&&input.steps!==0)return {type:'scroll',steps:input.steps};
  if(input.type==='click'&&['left','right'].includes(input.button))return {type:'click',button:input.button};
  if(input.type==='key'&&keys.has(input.key))return {type:'key',key:input.key};
  if(input.type==='media'&&media.has(input.key))return {type:'media',key:input.key};
  if(input.type==='text'&&typeof input.text==='string'&&input.text.length>0&&input.text.length<=512&&!/[\x00-\x1f\x7f]/.test(input.text))return {type:'text',text:input.text};
  fail('Invalid control input.');
}

/** Human phone input only. Separate signed proof, no Windows-unlock authority. */
export function createRemoteControl({computer,native,now=Date.now}){
  const challenges=new Map(),sessions=new Map();let chain=Promise.resolve();
  const serial=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
  function prune(){for(const[id,value]of challenges)if(value.expires<=now())challenges.delete(id);for(const[id,value]of sessions)if(value.expires<=now())sessions.delete(id);}
  async function identity(device){const value=await computer.remoteIdentity(device);if(!value)fail('Pair this phone with your laptop first.',403);return value;}
  async function session(input,principal,authorized){prune();const value=sessions.get(input.session);if(!value||value.principal!==principal)fail('Start a new control session.',401);await identity(value.device);if(!authorized()||sessions.get(input.session)!==value||value.expires<=now())fail('Control session stopped.',401);return value;}
  return{
    status:()=>({available:!!native.available(),sessionCount:sessions.size}),
    trustedWatchInput:(input,authorized)=>serial(async()=>{
      if(!authorized()||!native.available()||computer.remoteReady&&!await computer.remoteReady())fail('Unlock Windows before using watch controls.',409);
      if(!Array.isArray(input)||input.length<1||input.length>8)fail('Invalid watch control batch.');const events=input.map(remoteEvent);
      for(const event of events){if(!authorized())fail('Watch access ended.',401);const receipt=await native.input([event]);if(receipt.applied!==true)fail('Control delivery was uncertain. No input was resent.',503);}return{applied:true};
    }),
    challenge: (input,principal,authorized=()=>true)=>serial(async()=>{
      prune();if(!native.available())fail('The laptop remote helper is unavailable.',503);
      if(computer.remoteReady&&!await computer.remoteReady())fail('Unlock the paired Windows account before starting control.',409);
      if(challenges.size>=16)fail('Too many pending control requests.',429);
      const owner=await identity(input.deviceId),requestId=randomUUID(),expires=now()+45000;
      const payload=['JARVIS_REMOTE_CONTROL_V1',owner.computerId,input.deviceId,requestId,randomBytes(24).toString('base64url'),expires].join('\n');
      if(!authorized())fail('Unlock the primary workspace first.',401);
      challenges.set(requestId,{payload,device:input.deviceId,principal,expires,computerId:owner.computerId});return{requestId,payload,computerId:owner.computerId,expiresAtMs:expires};
    }),
    start: (input,principal,authorized=()=>true)=>serial(async()=>{
      prune();const request=challenges.get(input.requestId);if(!request||request.principal!==principal)fail('Control request expired.',401);
      challenges.delete(input.requestId);const owner=await identity(request.device);
      if(computer.remoteReady&&!await computer.remoteReady())fail('Unlock the paired Windows account before starting control.',409);
      let valid=false;try{valid=typeof input.signature==='string'&&input.signature.length<1000&&verify('sha256',Buffer.from(request.payload),{key:Buffer.from(owner.publicKey,'base64'),format:'der',type:'spki'},Buffer.from(input.signature,'base64'));}catch{}
      if(!valid||owner.computerId!==request.computerId)fail('Phone control approval was rejected.',403);
      if(!authorized()||request.expires<=now())fail('Control request expired. Start again.',401);
      // Starting a new session on this phone replaces its earlier authority.
      for(const[id,value]of sessions)if(value.device===request.device)sessions.delete(id);
      const token=randomBytes(32).toString('base64url'),expires=now()+15*60000;sessions.set(token,{device:request.device,principal,expires,sequence:0,receipt:null});
      return{session:token,expiresAtMs:expires};
    }),
    input: (input,principal,authorized=()=>true)=>serial(async()=>{
      const value=await session(input,principal,authorized);
      if(!Number.isSafeInteger(input.sequence)||input.sequence<1)fail('Invalid control sequence.');
      if(input.sequence===value.sequence&&value.receipt)return value.receipt;
      if(input.sequence!==value.sequence+1)fail('Control sequence changed. Start again.',409);
      if(!Array.isArray(input.events)||input.events.length<1||input.events.length>16)fail('Invalid control batch.');
      const events=input.events.map(remoteEvent);
      // Burn the sequence before invoking Windows. Ambiguous input is never replayed.
      value.sequence=input.sequence;value.receipt=null;
      try{for(const event of events){await session(input,principal,authorized);const result=await native.input([event]);if(result.applied!==true)throw Error();}value.receipt={sequence:value.sequence,applied:true};return value.receipt;}
      catch{sessions.delete(input.session);fail('Control delivery was uncertain or Windows is locked. Start again; no input was resent.',503);}
    }),
    stop: (input,principal)=>serial(async()=>{const value=sessions.get(input.session);if(value?.principal===principal)sessions.delete(input.session);return{stopped:true};}),
    clear:()=>{sessions.clear();challenges.clear();},
    close:async()=>{sessions.clear();challenges.clear();await chain;await native.close();},
  };
}
