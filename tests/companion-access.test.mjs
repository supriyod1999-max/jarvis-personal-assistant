import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createCompanionAccess,checkinJpeg} from '../server/companion-access.mjs';
import {directory} from './helpers.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const key=()=>{const pair=generateKeyPairSync('rsa',{modulusLength:2048});const publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64');return{publicKey,privateKey:pair.privateKey,id:hash(Buffer.from(publicKey,'base64'))};};
const proof=(payload,pair)=>sign('sha256',Buffer.from(payload),pair.privateKey).toString('base64');
async function enroll(access,pair){const request=await access.prepare({publicKey:pair.publicKey,name:'Synthetic phone',voice:true,camera:true},'owner',()=>true);return access.approve({requestId:request.requestId,signature:proof(request.payload,pair)},'owner',()=>true);}
async function execute(access,pair,operation,args={},data){const request=await access.challenge({deviceId:pair.id,operation,args:JSON.stringify(args)});return access.execute({requestId:request.requestId,signature:proof(request.payload,pair),data});}
// A minimal structural JPEG fixture. This is protocol validation, not a renderer test.
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,120,0,160,1,1,17,0,255,218,0,2,255,217]);

test('companion trust needs exact owner review and key proof, persists public data, rejects cross-domain actions and replay',async t=>{
  const path=directory(t),phone=key(),wrong=key();let time=10000,calls=0,access=createCompanionAccess({directory:path,now:()=>time,executeVoice:async op=>{calls++;return{op};}});t.after(()=>access.close());
  await assert.rejects(access.prepare({publicKey:phone.publicKey,name:'Phone',voice:true,camera:true},'owner',()=>false),/Unlock/);
  const request=await access.prepare({publicKey:phone.publicKey,name:'Phone',voice:true,camera:true},'owner',()=>true);await assert.rejects(access.approve({requestId:request.requestId,signature:proof(request.payload,wrong)},'owner',()=>true),/not approved/);assert.equal(access.list().length,0);
  await enroll(access,phone);await access.close();access=createCompanionAccess({directory:path,now:()=>time,executeVoice:async op=>{calls++;return{op};}});assert.equal(access.list()[0].camera,false);assert.doesNotMatch(readFileSync(join(path,'phone-companions.json'),'utf8'),/privateKey|BEGIN PRIVATE|cookie|sessionId/);
  for(const operation of['windows.unlock','files.list','remote.input','coding.approve','records.read','whatsapp.send'])await assert.rejects(access.challenge({deviceId:phone.id,operation,args:'{}'}),/unavailable/);
  const once=await access.challenge({deviceId:phone.id,operation:'voice.reply',args:'{"text":"hello"}'});assert(once.payload.startsWith('JARVIS_COMPANION_REQUEST_V1\n'));const input={requestId:once.requestId,signature:proof(once.payload,phone)};assert.equal((await access.execute(input)).op,'voice.reply');await assert.rejects(access.execute(input),/expired/);assert.equal(calls,1);
  const old=await access.challenge({deviceId:phone.id,operation:'voice.reply',args:'{}'});time+=31000;await assert.rejects(access.execute({requestId:old.requestId,signature:proof(old.payload,phone)}),/expired/);
  await access.revoke(phone.id,()=>true);await assert.rejects(access.challenge({deviceId:phone.id,operation:'voice.reply',args:'{}'}),/Connect/);
});

test('check-ins require active explicit sharing, one-use exact-device frame, no cached image and immediate revoke/cancel',async t=>{
  let time=100000;const access=createCompanionAccess({directory:directory(t),now:()=>time,executeVoice:async()=>{throw Error('Camera requests must never reach AI.');}});t.after(()=>access.close());const phone=key(),other=key();await enroll(access,phone);await enroll(access,other);
  assert.throws(()=>access.frame(phone.id,()=>true),/Enable/);await execute(access,phone,'session.poll',{sharing:true});
  const pending=access.frame(phone.id,()=>true);const poll=await execute(access,phone,'session.poll',{sharing:true});assert(poll.capture.requestId);assert.equal((await execute(access,other,'session.poll',{sharing:true})).capture,null);
  await assert.rejects(execute(access,other,'session.frame',{requestId:poll.capture.requestId,sha256:hash(jpeg)},jpeg.toString('base64')),/ended/);
  await assert.rejects(execute(access,phone,'session.frame',{requestId:poll.capture.requestId,sha256:'wrong'},jpeg.toString('base64')),/changed/);
  await execute(access,phone,'session.frame',{requestId:poll.capture.requestId,sha256:hash(jpeg)},jpeg.toString('base64'));assert.deepEqual(await pending,jpeg);
  await assert.rejects(execute(access,phone,'session.frame',{requestId:poll.capture.requestId,sha256:hash(jpeg)},jpeg.toString('base64')),/ended/);assert.equal((await execute(access,phone,'session.poll',{sharing:true})).capture,null);
  const off=access.frame(phone.id,()=>true),offCheck=assert.rejects(off,/turned off/);await execute(access,phone,'session.poll',{sharing:false});await offCheck;assert.equal(access.list().find(item=>item.id===phone.id).camera,false);
  await execute(access,phone,'session.poll',{sharing:true});const controller=new AbortController(),cancelled=access.frame(phone.id,()=>true,controller.signal),cancelCheck=assert.rejects(cancelled,/cancelled/);controller.abort();await cancelCheck;
  const revoked=access.frame(phone.id,()=>true),revokeCheck=assert.rejects(revoked,/sharing ended/);await access.revoke(phone.id,()=>true);await revokeCheck;
  time+=21000;assert.equal(access.list().find(item=>item.id===other.id).camera,false);
});

test('camera protocol bounds dimensions and malformed images before retaining a frame',()=>{
  assert.equal(checkinJpeg(jpeg),jpeg);for(const bytes of[Buffer.alloc(600000),Buffer.from('not an image'),jpeg.subarray(0,-2)])assert.throws(()=>checkinJpeg(bytes));const huge=Buffer.from(jpeg);huge.writeUInt16BE(4000,9);assert.throws(()=>checkinJpeg(huge),/too large/);
});


test('signed companion response ownership is device-bound and revoked with pairing',async t=>{
 const {createVoiceFocus}=await import('../server/voice-focus.mjs');const {randomUUID}=await import('node:crypto');
 const focus=createVoiceFocus(),phone=key(),other=key();const access=createCompanionAccess({directory:directory(t),voiceFocus:focus,executeVoice:()=>{throw Error('Focus must not invoke AI');}});t.after(()=>access.close());await enroll(access,phone);await enroll(access,other);
 const claim=await execute(access,phone,'voice.claim',{attempt:randomUUID()});assert.equal(claim.granted,true);
 assert.equal((await execute(access,other,'voice.renew',{token:claim.token})).granted,false);
 await execute(access,other,'voice.release',{token:claim.token});assert.equal((await execute(access,other,'voice.claim',{attempt:randomUUID()})).granted,false);
 await access.revoke(phone.id,()=>true);assert.equal((await execute(access,other,'voice.claim',{attempt:randomUUID()})).granted,true);
});
