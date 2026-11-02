import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';

test('real direct-provider dispatch routes broad change requests to an action card and keeps locked voice source-free',async t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)});let classified=0;
  const provider={status:async()=>({state:'ready',provider:'chatgpt-direct'}),models:async()=>[{id:'gpt-5.6-luna',name:'GPT-5.6 Luna'}],run(prompt){assert.match(prompt,/JARVIS_INTENT_ROUTE/);classified++;return{done:Promise.resolve({text:JSON.stringify({route:'action',actionId:'media.volume-down',answer:'I changed the volume.'})}),cancel:async()=>{}};}};
  const app=createApplication({port:14441,directory:path,conversationProvider:provider});t.after(async()=>{await app.close();for(const fn of cleanups)fn();});app.listen();await once(app.server,'listening');
  const input={id:randomUUID(),serverId:app.store.serverId,conversationId:randomUUID(),afterTurnId:null,message:'Change the sound on my laptop so it is a little quieter',sources:[]};app.chat.send(input);
  let deadline=Date.now()+3000;while(app.chat.store.getTurn(input.id).status==='running'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));const result=app.chat.store.getTurn(input.id);assert.equal(result.status,'complete',result.error);assert.equal(result.provider,'jarvis-actions');assert.equal(result.action.id,'media.volume-down');assert.doesNotMatch(result.reply,/I changed/);assert.equal(classified,1);
  const locked={...input,id:randomUUID(),conversationId:randomUUID(),voice:true,lockedVoice:true};app.chat.send(locked);deadline=Date.now()+3000;while(app.chat.store.getTurn(locked.id).status==='running'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));const voice=app.chat.store.getTurn(locked.id);assert.equal(voice.status,'complete',voice.error);assert.equal(voice.action.id,'media.volume-down');assert.deepEqual(voice.sources,[]);
});
