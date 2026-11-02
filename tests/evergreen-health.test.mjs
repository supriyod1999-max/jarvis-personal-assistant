import test from 'node:test';
import assert from 'node:assert/strict';
import { evergreenHealth } from '../server/evergreen-health.mjs';

test('Evergreen health distinguishes held, consent, pairing and verified live connection',()=>{
  const privacy={processWithAI:true};
  assert.equal(evergreenHealth({state:'release-held',privacy}).state,'held');
  assert.equal(evergreenHealth({state:'disconnected',privacy:{processWithAI:false}}).state,'needs_attention');
  assert.equal(evergreenHealth({state:'disconnected',privacy}).state,'not_connected');
  assert.match(evergreenHealth({state:'pairing',pairing:{pairingId:'synthetic'},privacy}).detail,/original pairing/);
  assert.equal(evergreenHealth({state:'connected',connection:{},liveEnabled:true,privacy}).state,'ready');
});
test('paired, expired, revoked or synthetic states cannot imply live readiness or expose private metadata',()=>{
  const base={state:'connected',connection:{memberUid:'private-member',householdId:'private-household'},privacy:{processWithAI:true},liveEnabled:true};
  for(const patch of [{liveEnabled:false},{state:'suspended'},{state:'denied'},{problem:'permissions_changed'},{synthetic:true}]){
    const result=evergreenHealth({...base,...patch});assert.notEqual(result.state,'ready');assert.doesNotMatch(JSON.stringify(result),/private-member|private-household|permissions_changed/);
  }
});
