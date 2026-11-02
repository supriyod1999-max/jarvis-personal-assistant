import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityCenter} from '../server/activity-center.mjs';
test('activity reports partial failures without inventing progress or retrying actions',async()=>{
  let reads=0;const activity=createActivityCenter({coding:{snapshot:async()=>({enabled:true,sessions:[{id:'one',state:'working'}]})},transfers:{list:async()=>{reads++;throw Error('offline');}},connections:{check:async()=>({services:[]})},reviews:()=>[],conversations:()=>[]});
  const result=await activity.snapshot(()=>true);assert.deepEqual(result.unavailable,['transfers']);assert.equal(result.coding.sessions[0].state,'working');assert.equal(reads,1);assert.equal(result.transfers,undefined);
});
test('a workspace lock during a slow snapshot prevents disclosure',async()=>{
  let allowed=true;const activity=createActivityCenter({connections:{check:async()=>{allowed=false;return {services:[]};}},reviews:()=>[],conversations:()=>[]});await assert.rejects(()=>activity.snapshot(()=>allowed),{status:401});
});
