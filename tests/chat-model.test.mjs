import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatModel } from '../server/chat-model.mjs';
import { createChatGPT } from '../server/chatgpt.mjs';
import { directory } from './helpers.mjs';

const choices=[{id:'gpt-5.6-luna',name:'GPT-5.6 Luna'},{id:'gpt-6.1-sol',name:'GPT-6.1 Sol'}];
test('manual and spoken model choices persist separately per workspace and reject invented models',async t=>{
  const path=directory(t),provider={models:async()=>choices},selection=createChatModel({directory:path,provider});
  await selection.select('gpt-6.1-sol');assert.equal(selection.get(),'gpt-6.1-sol');assert.equal(createChatModel({directory:path,provider}).get(),'gpt-6.1-sol');
  assert.equal(selection.run({message:'Please summarize a model comparison'}),null);
  const result=await selection.run({message:'Switch the model to GPT 5.6 Luna.'}).done;assert.equal(result.model,'gpt-5.6-luna');assert.equal(selection.get(),'gpt-5.6-luna');
  assert.match((await selection.run({message:'Use model imaginary-fast'}).done).text,/did not match/);await assert.rejects(selection.select('imaginary-fast'),/available/);
  const other=createChatModel({directory:directory(t),provider});assert.equal(other.get(),'gpt-5.6-luna');
});
test('cancelled voice model switch never saves a late catalog result',async t=>{
  let finish;const selected=createChatModel({directory:directory(t),provider:{models:()=>new Promise(resolve=>finish=resolve)}});
  const action=selected.run({message:'Switch model to GPT 6.1 Sol'});await action.cancel();finish(choices);assert.equal((await action.done).cancelled,true);assert.equal(selected.get(),'gpt-5.6-luna');
});
test('account model catalog is display-only, refreshed for a changed account and used without fallback',async()=>{
  let token='first',posts=0,model='';
  const provider=createChatGPT({auth:{getToken:async()=>token},fetcher:async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({models:token==='first'?[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'},{slug:'hidden',visibility:'hidden'}]:[{slug:'gpt-5.6-luna',visibility:'list'}]});
    posts++;model=JSON.parse(options.body).model;return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic reply'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{model}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});
  assert.deepEqual((await provider.models()).map(m=>m.id),['gpt-6.1-sol']);assert.equal((await provider.run('test',()=>{},{model:'gpt-6.1-sol'}).done).model,'gpt-6.1-sol');assert.equal(posts,1);
  token='second';assert.deepEqual((await provider.models()).map(m=>m.id),['gpt-5.6-luna']);await assert.rejects(provider.run('test',()=>{},{model:'gpt-6.1-sol'}).done,/No other model/);assert.equal(posts,1);
});
