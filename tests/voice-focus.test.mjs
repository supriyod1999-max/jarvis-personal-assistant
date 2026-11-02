import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVoiceFocus} from '../server/voice-focus.mjs';
test('only one device responds, duplicate claim is stable, foreign release is powerless',()=>{
  let now=100;const focus=createVoiceFocus({now:()=>now}),attempt=randomUUID();
  const a=focus.claim('phone',attempt);assert.equal(a.granted,true);
  assert.deepEqual(focus.claim('phone',attempt),a);
  assert.equal(focus.claim('pet',randomUUID()).granted,false);
  focus.release('pet',a.token);assert.equal(focus.renew('pet',a.token).granted,false);
  assert.equal(focus.renew('phone',a.token).granted,true);
  now+=12001;assert.equal(focus.claim('pet',randomUUID()).granted,true);
  assert.equal(focus.renew('phone',a.token).granted,false);
});
test('active conversations renew without a conversation timer; revocation releases ownership',()=>{
  let now=0;const focus=createVoiceFocus({now:()=>now});const a=focus.claim('a',randomUUID());
  for(let i=0;i<17;i++){now+=10000;assert.equal(focus.renew('a',a.token).granted,true);}
  now=180000;assert.equal(focus.renew('a',a.token).granted,true);focus.revoke('a');
  const b=focus.claim('b',randomUUID());assert.equal(b.granted,true);focus.revoke('b');assert.equal(focus.claim('a',randomUUID()).granted,true);
});
