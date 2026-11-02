import { hostname } from 'node:os';
import { MAX_FILE_BYTES } from './file-transfers.mjs';

// Network membership is enrolled trust, not a scan of nearby or Tailscale peers.
// A paired phone has no file/screen agent yet. Do not infer readiness or presence.
export function createDeviceNetwork({serverId,computer,files,remote,name=hostname()}) {
  return {async snapshot(authorized){
    const [phones,storage]=await Promise.all([computer?.pairedDevices()||[],files?.status(false)]);
    if(!authorized())throw Object.assign(new Error('Unlock JARVIS to view your devices.'),{status:401});
    return {version:1,hostId:serverId,devices:[
      {id:serverId,name,kind:process.platform==='win32'?'windows':'computer',presence:'online',role:'host',
        capabilities:{files:!!storage?.shares?.length,transfers:!!storage?.shares?.length,screen:false,remoteInput:!!remote?.status().available},
        detail:storage?.shares?.length?'Files and transfers are ready.':'No accessible drives are currently available.'},
      ...phones.map(phone=>({id:phone.id,name:phone.name,pairedAt:phone.pairedAt,kind:'android',presence:'unknown',role:'paired-phone',capabilities:{files:false,transfers:false,screen:false,remoteInput:false},detail:'Paired for biometric laptop controls. Phone files and screen access are not connected yet.'}))
    ],transport:'private',transferLimitBytes:storage?.maximumBytes||MAX_FILE_BYTES};
  }};
}
