import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { createVoiceService } from '../server/voice-service.mjs';
import { createApplication } from '../server/index.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
import { directory } from './helpers.mjs';

const choices = () => ['kokoro-gpu','chatterbox','kokoro'].map(id => ({id,name:id,voice:'Synthetic',device:id==='kokoro'?'cpu':'cuda',available:true}));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const workers = [], events = []; let release, blocked = false, failWarm = false, active = 0;
  const createWorker = ({engine}) => {
    let state = 'idle'; const item = {engine,closed:false}; workers.push(item); events.push('create:'+engine);
    return {status:()=>({state,engine,local:true}),warm:async()=>{events.push('warm:'+engine);if(failWarm){state='error';throw Error('Synthetic failure');}state='ready';active++;assert.equal(active,1,'only one warmed model');},
      speak:async()=>{state='generating';}, async close(){events.push('stop:'+engine);if(blocked)await new Promise(resolve=>release=resolve);if(state==='ready'||state==='generating')active--;state='idle';item.closed=true;events.push('stopped:'+engine);}};
  };
  return {createWorker,workers,events,block(){blocked=true;},release(){blocked=false;release();},fail(){failWarm=true;}};
}

test('only the selected worker starts; switching waits for teardown, persists, and rejects concurrent or stale changes',async t=>{
  const root=directory(t),f=fixture(),service=createVoiceService({directory:root,createWorker:f.createWorker,choices});t.after(()=>service.close());
  assert.equal(service.models().selected,'kokoro-gpu');assert.equal(f.workers.length,0);
  await service.warm();assert.deepEqual(f.workers.map(x=>x.engine),['kokoro-gpu']);
  f.block();const change=service.select({engine:'chatterbox',baseRevision:0});await tick();
  assert.equal(service.status().state,'restarting');assert.equal(f.workers.length,1);
  await assert.rejects(service.select({engine:'kokoro',baseRevision:0}),e=>e.status===409);
  await assert.rejects(service.speak({text:'Synthetic'}),/restarting/);
  f.release();const result=await change;assert.equal(result.selected,'chatterbox');assert.equal(result.revision,1);
  assert.ok(f.events.indexOf('stopped:kokoro-gpu')<f.events.indexOf('create:chatterbox'));
  await service.select({engine:'chatterbox',baseRevision:1});assert.equal(f.workers.length,2);
  await assert.rejects(service.select({engine:'kokoro',baseRevision:0}),e=>e.status===409);
  await service.close();const second=fixture(),restarted=createVoiceService({directory:root,createWorker:second.createWorker,choices});t.after(()=>restarted.close());
  assert.equal(second.workers.length,0);await restarted.warm();assert.deepEqual(second.workers.map(x=>x.engine),['chatterbox']);
});

test('invalid, unavailable, busy or revoked changes cannot start a replacement; failed warm-up never falls back',async t=>{
  const f=fixture(),service=createVoiceService({directory:directory(t),createWorker:f.createWorker,choices});t.after(()=>service.close());
  await assert.rejects(service.select({engine:'cloud',baseRevision:0}),e=>e.status===400);
  await assert.rejects(service.select({engine:'chatterbox',baseRevision:0},()=>false),e=>e.status===401);assert.equal(f.workers.length,0);
  await service.warm();await service.speak({text:'Synthetic'});await assert.rejects(service.select({engine:'chatterbox',baseRevision:0}),e=>e.status===409);assert.equal(f.workers.length,1);
  await service.close();
  const root=directory(t),g=fixture(),failed=createVoiceService({directory:root,createWorker:g.createWorker,choices});t.after(()=>failed.close());g.fail();
  const saved=await failed.select({engine:'chatterbox',baseRevision:0});assert.equal(saved.selected,'chatterbox');assert.equal(saved.output.state,'error');
  assert.deepEqual(g.workers.map(x=>x.engine),['chatterbox']);await assert.rejects(failed.warm(),/could not start/);
  const missing=createVoiceService({directory:directory(t),createWorker:g.createWorker,choices:()=>choices().map(x=>({...x,available:false}))});t.after(()=>missing.close());
  await assert.rejects(missing.select({engine:'chatterbox',baseRevision:0}),/not installed/);
});

test('corrupt saved selection fails visibly without loading any model; authority is rechecked after stopping',async t=>{
  const root=directory(t);writeFileSync(join(root,'voice-output.json'),'{broken');
  const f=fixture(),service=createVoiceService({directory:root,createWorker:f.createWorker,choices});t.after(()=>service.close());
  await assert.rejects(service.warm(),/saved voice setting/);assert.equal(f.workers.length,0);
  await service.select({engine:'kokoro-gpu',baseRevision:0});f.block();let authorized=true;
  const change=service.select({engine:'chatterbox',baseRevision:1},()=>authorized);await tick();authorized=false;f.release();
  await assert.rejects(change,e=>e.status===401);assert.equal(service.models().selected,'kokoro-gpu');assert.equal(f.workers.length,1);
});

test('a failed process stop prevents saving or constructing a second model',async t=>{
  let created=0;
  const service=createVoiceService({directory:directory(t),choices,createWorker:()=>{created++;return{status:()=>({state:'ready'}),warm:async()=>{},close:async()=>{throw Error('Previous process is still running');}};}});
  await service.warm();await assert.rejects(service.select({engine:'chatterbox',baseRevision:0}),/still running/);
  assert.equal(created,1);assert.equal(service.models().selected,'kokoro-gpu');assert.equal(service.models().revision,0);assert.equal(service.status().state,'error');
  await assert.rejects(service.close(),/still running/);
});

test('voice model changes use the primary PIN, same-origin marker and fixed model allowlist',async t=>{
  const cleanups=[],root=directory({after:fn=>cleanups.push(fn)}),f=fixture();
  const voice=createVoiceService({directory:root,createWorker:f.createWorker,choices});
  const app=createApplication({port:14409,directory:root,voice,hermes:fixtureHermes(),privateAccess:null});app.listen();await once(app.server,'listening');
  const secondary=createApplication({port:14419,directory:directory({after:fn=>cleanups.push(fn)}),profile:{id:'second',displayName:'Synthetic second',addressAs:''},voice,standby:true,hermes:fixtureHermes(),privateAccess:null});secondary.listen();await once(secondary.server,'listening');
  t.after(async()=>{await secondary.close();await app.close();cleanups.forEach(fn=>fn());});
  const call=(path,data,cookie,headers={})=>fetch('http://127.0.0.1:14409/api/'+path,{headers:{'Content-Type':'application/json','X-Second-Brain':'1',...(cookie?{cookie}:{}),...headers},...(data?{method:'POST',body:JSON.stringify(data)}:{})});
  assert.equal((await call('voice/model',{engine:'chatterbox',baseRevision:0})).status,403);
  const setup=await call('lock/setup',{newPin:'123456',confirmPin:'123456'}),cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('voice/model',{engine:'chatterbox',baseRevision:0})).status,401);
  assert.equal((await call('voice/model',{engine:'chatterbox',baseRevision:0},cookie,{Origin:'https://evil.test'})).status,403);
  assert.equal((await call('voice/model',{engine:'chatterbox',baseRevision:0},cookie,{'X-Second-Brain':''})).status,403);
  assert.equal((await call('voice/model',{engine:'arbitrary',baseRevision:0},cookie)).status,400);assert.equal(f.workers.length,0);
  const result=await call('voice/model',{engine:'chatterbox',baseRevision:0},cookie);assert.equal(result.status,200);assert.equal((await result.json()).selected,'chatterbox');
  assert.equal((await call('voice/model',{engine:'kokoro',baseRevision:0},cookie)).status,409);
  const models=await call('voice/models',null,cookie);assert.equal(models.headers.get('cache-control'),'no-store');assert.equal((await models.json()).canManage,true);
  const headers={'Content-Type':'application/json','X-Second-Brain':'1'};
  const secondSetup=await fetch('http://127.0.0.1:14419/api/lock/setup',{method:'POST',headers,body:JSON.stringify({newPin:'246802',confirmPin:'246802'})});
  const secondCookie=secondSetup.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch('http://127.0.0.1:14419/api/voice/model',{method:'POST',headers:{...headers,cookie:secondCookie},body:JSON.stringify({engine:'kokoro',baseRevision:1})})).status,403);
  const secondModels=await (await fetch('http://127.0.0.1:14419/api/voice/models',{headers:{cookie:secondCookie}})).json();assert.equal(secondModels.canManage,false);assert.equal(secondModels.selected,'chatterbox');
});
