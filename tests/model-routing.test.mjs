import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';

test('the saved selection reaches interpretation requests as well as ordinary responses',async t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)}),calls=[];
  const models=[{id:'gpt-5.6-luna',name:'GPT-5.6 Luna'},{id:'gpt-6.1-sol',name:'GPT-6.1 Sol'}];
  const provider={status:async()=>({state:'ready',provider:'chatgpt-direct'}),models:async()=>models,run(prompt,output,options){calls.push(options.model);assert.match(prompt,/JARVIS_INTENT_ROUTE/);return{done:Promise.resolve({text:JSON.stringify({route:'conversation',answer:'Synthetic answer from the selected model.'})}),cancel:async()=>{}};}};
  const app=createApplication({port:14445,directory:path,conversationProvider:provider});t.after(async()=>{await app.close();for(const fn of cleanups)fn();});app.listen();await once(app.server,'listening');const base='http://127.0.0.1:14445',headers={'Content-Type':'application/json','X-Second-Brain':'1'};
  const setup=await fetch(base+'/api/lock/setup',{method:'POST',headers,body:JSON.stringify({newPin:'654321',confirmPin:'654321'})});const cookie=setup.headers.get('set-cookie').split(';')[0];const auth={...headers,Cookie:cookie};
  const selection=await fetch(base+'/api/chat/model',{method:'POST',headers:auth,body:JSON.stringify({model:models[1].id})});assert.equal(selection.status,200);assert.equal((await selection.json()).selected,models[1].id);
  assert.equal((await(await fetch(base+'/api/chat/models',{headers:{Cookie:cookie}})).json()).selected,models[1].id);
  const input={id:randomUUID(),serverId:app.store.serverId,conversationId:randomUUID(),afterTurnId:null,message:'Explain a rainbow in one sentence.',sources:[]};app.chat.send(input);let deadline=Date.now()+3000;while(app.chat.store.getTurn(input.id).status==='running'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(app.chat.store.getTurn(input.id).status,'complete');assert.equal(app.chat.store.getTurn(input.id).model,models[1].id);assert.deepEqual(calls,[models[1].id]);
  const rejected=await fetch(base+'/api/chat/model',{method:'POST',headers:auth,body:JSON.stringify({model:'made-up-model'})});assert.equal(rejected.status,400);assert.equal((await(await fetch(base+'/api/chat/models',{headers:{Cookie:cookie}})).json()).selected,models[1].id);
});
