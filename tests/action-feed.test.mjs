import test from 'node:test';
import assert from 'node:assert/strict';
import {actionFeed} from '../server/action-feed.mjs';
import {openChatStore} from '../server/chat-store.mjs';
import {directory} from './helpers.mjs';
import {randomUUID} from 'node:crypto';

test('action centre distinguishes saved progress, stale observations, reviews and completed replies',()=>{
 const rows=actionFeed({requests:[{id:'r',conversationId:'a&b',title:'Reply',status:'complete',updatedAt:'2026-10-30'}],reviews:[{id:'m',title:'Remember',kind:'task'}],coding:{sessions:[{id:'c',title:'Stale work',status:'working',stale:true},{id:'d',title:'Done',status:'complete'}]},transfers:[{id:'t',name:'Upload',state:'uploading'}],connections:{services:[{id:'x',name:'Service',state:'error',detail:'Offline',href:'https://untrusted.invalid'}]}});
 assert.equal(rows.find(r=>r.id==='coding:c').state,'unknown');
 assert.equal(rows.find(r=>r.id==='coding:d').state,'completed');
 assert.equal(rows.find(r=>r.id==='transfer:t').state,'waiting');
 assert.equal(rows.find(r=>r.id==='review:m').href,'#/tasks');
 assert.equal(rows.find(r=>r.id==='connection:x').href,'#/settings');
 assert.equal(rows.find(r=>r.id==='conversation:r').href,'?conversation=a%26b#/command');
 assert.equal(rows[0].state,'needs_review');
 assert.match(rows.find(r=>r.id==='conversation:r').detail,/Reply finished/);
});

test('conversation action summaries survive restart without exposing private content or replaying work',t=>{
 const dir=directory(t); let store=openChatStore(dir);const conversationId=randomUUID(),id=randomUUID();
 store.start({id,conversationId,afterTurnId:null,message:'Private Evergreen details'},[],false,true);
 assert.equal(store.activity()[0].title,'Evergreen conversation');
 store.close();store=openChatStore(dir);
 try {assert.equal(store.activity()[0].status,'interrupted');assert.equal(store.activity()[0].id,id);assert.equal(store.activity()[0].title,'Evergreen conversation');assert.deepEqual(Object.keys(store.activity()[0]).sort(),['conversationId','id','status','title','updatedAt']);} finally {store.close();}
});
