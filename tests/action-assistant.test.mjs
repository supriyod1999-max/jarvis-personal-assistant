import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ACTION_CATALOG, actionCard, verifiedAction } from '../shared/action-catalog.mjs';
import { createActionAssistant } from '../server/action-assistant.mjs';
import { createSemanticAssistant } from '../server/semantic-assistant.mjs';
import { createMemoryAssistant } from '../server/memory-assistant.mjs';
import { openStore } from '../server/store.mjs';
import { directory } from './helpers.mjs';

const request = message => ({id:randomUUID(),conversationId:randomUUID(),afterTurnId:null,message,sources:[]});
const models={get:()=> 'gpt-6.1-sol',models:async()=>[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol'}]};
test('action cards use only app-owned destinations and reject stale or forged network metadata',()=>{
  const id=randomUUID();for(const item of ACTION_CATALOG){const card=actionCard(item.id,id);assert.deepEqual(verifiedAction(card,id),card);assert.equal(verifiedAction(card,randomUUID()),null);assert.equal(verifiedAction({...card,href:'javascript:alert(1)'},id),null);assert.equal(verifiedAction({...card,nativeHref:'/api/computer/approve'},id),null);}
  assert.throws(()=>actionCard('shell.execute',id));assert.equal(new Set(ACTION_CATALOG.map(a=>a.id)).size,ACTION_CATALOG.length);
});
test('model-selected intents reach fixed handlers, not fabricated prose or execution payloads',async()=>{
  const actions=createActionAssistant({models,primary:true});
  const examples=[['Would you bring my files up?','files.browse'],['Could my phone act as a trackpad?','remote.open'],['Make the music a little quieter on the laptop','media.volume-down'],['Let me back into Windows from my phone','computer.unlock'],['What are my coding agents doing?','coding.list'],['Keep an ear out on my watch','watch.open'],['Can you see what is on my display?','screen.inspect']];
  for(const [message,actionId] of examples){const input=request(message);const router=createSemanticAssistant({generate:async()=>JSON.stringify({route:'action',actionId,answer:'ALREADY DONE',command:'powershell.exe'}),capabilities:actions.catalog,routes:{action:actions.run}});const result=await router.run(input,()=>{},'bounded owner conversation').done;assert.equal(result.action.id,actionId);assert.equal(result.action.requestId,input.id);assert.doesNotMatch(result.text,/ALREADY DONE|powershell/);}
});
test('unsupported actions, unclear destinations and cancellation never fall through to execution',async()=>{
  const actions=createActionAssistant({models,primary:true});let plan={route:'action',actionId:'shell.execute',answer:''};const router=createSemanticAssistant({generate:async()=>JSON.stringify(plan),capabilities:actions.catalog,routes:{action:actions.run}});
  await assert.rejects(router.run(request('run something'),()=>{},'').done,/not connected/);
  plan={route:'clarify',answer:'Which file and destination do you mean?'};assert.match((await router.run(request('move that over'),()=>{},'').done).text,/Which file/);
  let resolve;const delayed=createSemanticAssistant({generate:()=>new Promise(r=>resolve=r),capabilities:actions.catalog,routes:{action:()=>assert.fail('Cancelled interpretations cannot dispatch')}});const pending=delayed.run(request('open controls'),()=>{},'');await pending.cancel();resolve(JSON.stringify({route:'action',actionId:'remote.open',answer:''}));assert.equal((await pending.done).cancelled,true);
});
test('general phone/watch voice can prepare handoffs without reading personal stores or approving writes',async()=>{
  const actions=createActionAssistant({models,primary:true,devices:{snapshot:()=>assert.fail('No device reads while locked')},coding:{snapshot:()=>assert.fail('No coding reads while locked')},voice:{status:()=>assert.fail('No voice settings reads while locked')}});
  let plan={route:'action',actionId:'devices.list',answer:''};const router=createSemanticAssistant({generate:async()=>JSON.stringify(plan),capabilities:actions.catalog,pendingReview:()=>assert.fail('No private review in locked voice'),routes:{action:actions.run,records:()=>assert.fail('No private records')}});
  const input={...request('show my devices'),voice:true,lockedVoice:true};assert.equal((await router.run(input,()=>{},'general conversation only').done).action.id,'devices.list');
  plan={route:'records',command:'delete all my notes',answer:''};assert.equal((await router.run(input,()=>{},'').done).action.id,'personal.review');
});

test('a lock-screen companion key offers model review rather than mutating the shared selection',async()=>{
  const actions=createActionAssistant({models,primary:true});let mutations=0;const router=createSemanticAssistant({generate:async()=>JSON.stringify({route:'model',command:'switch the AI model to GPT-6.1 Sol',answer:''}),capabilities:actions.catalog,routes:{action:actions.run,model:()=>{mutations++;throw Error('Delegated general voice must not write settings');}}});
  const result=await router.run({...request('change models'),voice:true,lockedVoice:true,delegateReadOnly:true},()=>{},'general conversation').done;assert.equal(result.action.id,'chat.models');assert.equal(mutations,0);
});
test('actual read results replace invented model claims; secondary workspaces never invoke primary device readers',async()=>{
  let reads=0;const devices={snapshot:async allowed=>{reads++;assert.ok(allowed());return{devices:[{name:'Synthetic laptop',role:'host',presence:'online',detail:'Ready.'}]};}};
  const actions=createActionAssistant({models,devices,primary:true,voice:{status:()=>({engine:'kokoro',voice:'bm_daniel',state:'ready'})}});
  assert.match((await actions.run(request('what devices'),()=>{},'devices.list').done).text,/Synthetic laptop.*online/);assert.equal(reads,1);
  assert.match((await actions.run(request('which voice'),()=>{},'voice.status').done).text,/kokoro, bm_daniel/);
  assert.match((await createActionAssistant({models,devices,primary:false}).run(request('devices'),()=>{},'devices.list').done).text,/primary workspace/);assert.equal(reads,1);
});
test('broad record verbs do not intercept model, media or file intents before semantic routing',t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)}),records=openStore(path);const memory=createMemoryAssistant({directory:path,records,generate:()=>assert.fail('A record parser must not receive these device requests')});t.after(()=>{memory.close();records.close();for(const fn of cleanups)fn();});
  for(const message of ['Change the laptop volume','Delete a file on my laptop','Set up the watch','Move my download to the phone'])assert.equal(memory.run({...request(message),followupOnly:true,preserveReview:true},()=>{}),null);
});
test('confirmation words inside a proposed note are content, never permission to approve a review',async()=>{
  let called=false;const router=createSemanticAssistant({generate:async()=>JSON.stringify({route:'records',command:'add a note The words send it are a confirmation example.',answer:''}),routes:{records:()=>{called=true;return{done:Promise.resolve({text:'Review only'}),cancel:async()=>{}};}}});
  assert.equal((await router.run(request('Make a note explaining send it'),()=>{},'').done).text,'Review only');assert.ok(called);
});
