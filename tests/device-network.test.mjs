import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceNetwork} from '../server/device-network.mjs';
test('device inventory reports enrolled capabilities without minting sign-in requests or assuming phone presence',async()=>{
  let shared=false,phones=[{id:'phone-1',name:'<script>untrusted name</script>',pairedAt:'2026-10-22T00:00:00Z'}];
  const network=createDeviceNetwork({serverId:'host-1',name:'Studio',computer:{pairedDevices:async()=>phones,status:()=>{throw Error('Must not touch Windows sign-in.');}},files:{status:async local=>{assert.equal(local,false);return{shares:shared?[{id:'C'}]:[]};}}});
  let snapshot=await network.snapshot(()=>true);assert.equal(snapshot.devices[0].capabilities.files,false);assert.equal(snapshot.devices[1].presence,'unknown');assert.equal(snapshot.devices[1].capabilities.files,false);assert.equal(snapshot.devices[1].name,phones[0].name);
  shared=true;phones=[];snapshot=await network.snapshot(()=>true);assert.equal(snapshot.devices.length,1);assert.equal(snapshot.devices[0].capabilities.files,true);assert.equal(snapshot.devices[0].capabilities.screen,false);
  await assert.rejects(network.snapshot(()=>false),error=>error.status===401);
});
