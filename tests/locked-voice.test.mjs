import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChat } from '../server/chat.mjs';
import { directory } from './helpers.mjs';

test('locked voice answers general questions without personal recall, profile or action routes',async t=>{
  const cleanups=[];const path=directory({after:fn=>cleanups.push(fn)});const serverId=randomUUID(),conversationId=randomUUID();let prompt;
  const chat=createChat({directory:path,serverId,records:{get(){throw Error('No private records');},records(){throw Error('No recall');}},profile:()=>({displayName:'PRIVATE_OWNER'}),assistant:{run(){throw Error('No actions');},interpret(){throw Error('No action interpretation');},privateRequest(){throw Error('No connected apps');}},hermes:{run(value){prompt=value;return{cancel:async()=>{},done:Promise.resolve({text:'A general explanation.',provider:'chatgpt-direct'})};},status:async()=>({state:'ready'})}});t.after(async()=>{await chat.close();for(const cleanup of cleanups)cleanup();});
  const request={id:randomUUID(),serverId,conversationId,afterTurnId:null,message:'Explain rainbows.',sources:[],voice:true,lockedVoice:true};chat.send(request);
  while(chat.store.getTurn(request.id).status==='running')await new Promise(resolve=>setTimeout(resolve,5));
  const result=chat.store.getTurn(request.id);assert.equal(result.status,'complete');assert.equal(result.lockedVoice,true);assert.deepEqual(result.sources,[]);assert.match(prompt,/Explain rainbows/);assert.doesNotMatch(prompt,/PRIVATE_OWNER/);assert.match(prompt,/no access to personal records/);
  assert.throws(()=>chat.send({...request,id:randomUUID(),conversationId:randomUUID(),sources:[{id:randomUUID(),rev:1}]}),/without personal sources/);
  assert.throws(()=>chat.send({...request,lockedVoice:'yes'}),/Invalid voice mode/);
});
