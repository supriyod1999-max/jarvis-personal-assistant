import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign,randomUUID } from 'node:crypto';
import { createRemoteControl,remoteEvent } from '../server/remote-control.mjs';

function fixture(){
  const keys=generateKeyPairSync('rsa',{modulusLength:2048}),computerId=randomUUID(),deviceId='a'.repeat(64),events=[];let valid=true,time=1000000,ready=true;
  const computer={remoteIdentity:async device=>valid&&device===deviceId?{computerId,publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64')}:null,remoteReady:async()=>ready};
  const native={available:()=>true,input:async value=>{events.push(...value);return{applied:true};},close:async()=>{}};
  const control=createRemoteControl({computer,native,now:()=>time});
  const approved=async()=>{const challenge=await control.challenge({deviceId},'signed-in-session');assert.match(challenge.payload,/^JARVIS_REMOTE_CONTROL_V1\n/);return control.start({requestId:challenge.requestId,signature:sign('sha256',Buffer.from(challenge.payload),keys.privateKey).toString('base64')},'signed-in-session');};
  return{control,native,events,approved,deviceId,proof:payload=>sign('sha256',Buffer.from(payload),keys.privateKey).toString('base64'),revoke:()=>{valid=false;},tick:ms=>time+=ms,lock:()=>{ready=false;}};
}
test('remote control requires a paired, separately signed phone proof, binds the PIN session and prevents input replay',async()=>{
  const f=fixture();await assert.rejects(f.control.challenge({deviceId:'unknown'},'signed-in-session'),error=>error.status===403);
  const bad=await f.control.challenge({deviceId:f.deviceId},'signed-in-session');await assert.rejects(f.control.start({requestId:bad.requestId,signature:'bad'},'signed-in-session'),error=>error.status===403);
  const session=await f.approved(),request={session:session.session,sequence:1,events:[{type:'media',key:'play-pause'}]};
  await assert.rejects(f.control.input(request,'another-session'),error=>error.status===401);
  assert.equal((await f.control.input(request,'signed-in-session')).applied,true);assert.equal((await f.control.input(request,'signed-in-session')).applied,true);assert.equal(f.events.length,1);
  await assert.rejects(f.control.input({...request,sequence:3},'signed-in-session'),error=>error.status===409);
  f.revoke();await assert.rejects(f.control.input({...request,sequence:2},'signed-in-session'));assert.equal(f.events.length,1);
  await f.control.close();
});
test('control expiry, explicit stop, workspace revocation and Windows lock prevent further input',async()=>{
  const f=fixture();let session=await f.approved();const request=()=>({session:session.session,sequence:1,events:[{type:'click',button:'left'}]});
  await assert.rejects(f.control.input(request(),'signed-in-session',()=>false));assert.equal(f.events.length,0);
  await f.control.stop({session:session.session},'signed-in-session');await assert.rejects(f.control.input(request(),'signed-in-session'));
  session=await f.approved();f.tick(15*60000+1);await assert.rejects(f.control.input(request(),'signed-in-session'));
  f.lock();await assert.rejects(f.approved(),/Unlock/);assert.equal(f.events.length,0);await f.control.close();
});
test('uncertain delivery burns control authority and stopping mid-batch does not execute later events',async()=>{
  const f=fixture();let finish;f.native.input=async events=>{f.events.push(...events);await new Promise(resolve=>finish=resolve);return{applied:true};};
  const session=await f.approved(),request={session:session.session,sequence:1,events:[{type:'key',key:'enter'},{type:'key',key:'enter'}]};
  const pending=f.control.input(request,'signed-in-session');while(!finish)await new Promise(resolve=>setTimeout(resolve,1));f.control.clear();finish();await assert.rejects(pending);assert.equal(f.events.length,1);
  f.native.input=async()=>{throw Error('Synthetic uncertain native result');};const next=await f.approved();const input={session:next.session,sequence:1,events:[{type:'text',text:'Synthetic text'}]};await assert.rejects(f.control.input(input,'signed-in-session'),error=>error.status===503);await assert.rejects(f.control.input(input,'signed-in-session'));await f.control.close();
});
test('fixed input schema accepts bounded human controls and refuses commands, modifiers, newlines and oversized text',()=>{
  for(const event of [{type:'move',x:600,y:-600},{type:'scroll',steps:2},{type:'text',text:'Hello नमस्ते'},{type:'key',key:'tab'},{type:'media',key:'volume-up'}])assert.deepEqual(remoteEvent(event),event);
  for(const event of [{type:'shell',command:'anything'},{type:'key',key:'ctrl-alt-delete'},{type:'move',x:601,y:0},{type:'text',text:'hello\nworld'},{type:'text',text:'x'.repeat(513)},{type:'media',key:'mute',command:'extra'}])assert.throws(()=>remoteEvent(event));
});

test('workspace revocation during proof verification never creates remote authority',async()=>{
  const f=fixture();await assert.rejects(f.control.challenge({deviceId:f.deviceId},'signed-in-session',()=>false),error=>error.status===401);
  const challenge=await f.control.challenge({deviceId:f.deviceId},'signed-in-session');
  await assert.rejects(f.control.start({requestId:challenge.requestId,signature:f.proof(challenge.payload)},'signed-in-session',()=>false),error=>error.status===401);
  assert.equal(f.control.status().sessionCount,0);await f.control.close();
});
