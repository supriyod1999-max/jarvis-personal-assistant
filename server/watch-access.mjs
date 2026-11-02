import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const identifier=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function watchKey(value){try{const key=createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'});if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==2048)throw Error();return{key,id:hash(key.export({format:'der',type:'spki'}))};}catch{fail('The watch key is invalid.');}}
export const WATCH_OPERATIONS=new Set(['status','files.roots','files.list','files.phone-download','coding.list','remote.input','voice.transcribe','voice.reply','voice.speak']);

/** Persistent public-key delegation. No PIN, credential, bearer token or Windows unlock authority. */
export function createWatchAccess({directory,computer,execute,now=Date.now}){
  const file=join(directory,'trusted-watches.json');let grants={};
  try{const value=JSON.parse(readFileSync(file,'utf8'));if(value.version===1)grants=value.grants||{};}catch(error){if(error.code!=='ENOENT')fail('Watch trust could not be read. Nothing was enabled.',503);}
  const enrollments=new Map(),requests=new Map();let serial=Promise.resolve();
  const queue=fn=>{const task=serial.then(fn);serial=task.catch(()=>{});return task;};
  function save(next){mkdirSync(directory,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,grants:next}),{mode:0o600});renameSync(file+'.tmp',file);grants=next;}
  function prune(){for(const map of[enrollments,requests])for(const[id,value]of map)if(value.expires<=now())map.delete(id);}
  async function owner(device){const value=await computer.remoteIdentity(device);if(!value)fail('Pair this phone with Windows before trusting a watch.',403);return value;}
  async function authorized(id){const grant=grants[id];if(!grant)return false;const phone=await computer.remoteIdentity(grant.phone);return !!phone&&phone.computerId===grant.computerId;}
  function validSignature(payload,signature,key){try{return typeof signature==='string'&&signature.length<1000&&verify('sha256',Buffer.from(payload),key,Buffer.from(signature,'base64'));}catch{return false;}}
  return{
    list:()=>Object.values(grants).map(({id,name,pairedAt,phone})=>({id,name,pairedAt,phone})),
    prepare: (input,principal,check)=>queue(async()=>{
      prune();if(enrollments.size>=8)fail('Finish or cancel the current watch setup.',429);const phone=await owner(input.phoneId),watch=watchKey(input.publicKey);
      if(typeof input.node!=='string'||!input.node||input.node.length>120)fail('Choose the exact paired watch.');
      if(!check())fail('Unlock the primary workspace to pair your watch.',401);
      const requestId=randomUUID(),expires=now()+45000,payload=['JARVIS_TRUST_WATCH_V1',phone.computerId,input.phoneId,watch.id,hash(input.node),requestId,randomBytes(24).toString('base64url'),expires].join('\n');
      enrollments.set(requestId,{payload,expires,principal,phone:input.phoneId,publicKey:input.publicKey,id:watch.id,computerId:phone.computerId,name:String(input.name||'Galaxy Watch').slice(0,80)});return{requestId,payload,watchId:watch.id,computerId:phone.computerId,expiresAtMs:expires};
    }),
    approve:(input,principal,check)=>queue(async()=>{
      prune();const request=enrollments.get(input.requestId);if(!request||request.principal!==principal)fail('Watch setup expired. Try pairing again.',401);enrollments.delete(input.requestId);const phone=await owner(request.phone);
      const key=createPublicKey({key:Buffer.from(phone.publicKey,'base64'),format:'der',type:'spki'});
      if(!check()||request.expires<=now()||phone.computerId!==request.computerId||!validSignature(request.payload,input.signature,key))fail('Watch pairing was not approved.',403);
      save({...grants,[request.id]:{id:request.id,name:request.name,publicKey:request.publicKey,phone:request.phone,computerId:request.computerId,pairedAt:new Date(now()).toISOString()}});return{paired:true,watchId:request.id,name:request.name};
    }),
    revoke:(id,check)=>queue(async()=>{if(!identifier(id)||!check())fail('Unlock the primary workspace before disconnecting.',401);const next={...grants};delete next[id];save(next);for(const[key,value]of requests)if(value.watchId===id)requests.delete(key);return{revoked:true};}),
    challenge:input=>queue(async()=>{
      prune();if(!identifier(input.watchId)||!await authorized(input.watchId))fail('Trust this watch in the phone app first.',403);
      if(!WATCH_OPERATIONS.has(input.operation)||typeof input.args!=='string'||Buffer.byteLength(input.args)>1281000)fail('Unsupported watch request.');
      if([...requests.values()].filter(value=>value.watchId===input.watchId).length>=4)fail('Wait for the current watch request.',429);
      const id=randomUUID(),expires=now()+30000,payload=['JARVIS_WATCH_REQUEST_V1',input.watchId,id,input.operation,hash(input.args),randomBytes(24).toString('base64url'),expires].join('\n');
      requests.set(id,{payload,watchId:input.watchId,operation:input.operation,args:input.args,expires});return{requestId:id,payload,expiresAtMs:expires};
    }),
    async execute(input,signal){
      const request=await queue(async()=>{prune();const value=requests.get(input.requestId);if(!value)fail('Watch request expired. Nothing was resent.',401);requests.delete(input.requestId);const grant=grants[value.watchId];if(!grant||!await authorized(value.watchId)||!validSignature(value.payload,input.signature,watchKey(grant.publicKey).key))fail('Unlock your trusted watch before using this control.',403);return value;});
      // Burn the exact one-use request before handing it to any side effect. No retry on ambiguity.
      const check=()=>!!grants[request.watchId]&&!signal?.aborted;
      if(!check())fail('Watch disconnected.',401);let args;try{args=JSON.parse(request.args);}catch{fail('Invalid watch request.');}
      const result=await execute(request.operation,args,check,signal,request.watchId,input.data);if(!check()||!await authorized(request.watchId))fail('Watch access ended.',401);return result;
    },
    close:async()=>{enrollments.clear();requests.clear();await serial;},
  };
}
