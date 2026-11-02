import { randomUUID } from 'node:crypto';

/** Ephemeral response ownership. Contains no audio, transcript, or device name. */
export function createVoiceFocus({now=Date.now}={}) {
  let current=null;
  const expire=()=>{if(current&&current.until<=now())current=null;};
  return {
    claim(owner,attempt){
      expire();
      if(typeof attempt!=='string'||!/^[a-f0-9-]{36}$/i.test(attempt))throw Object.assign(Error('Invalid voice attempt.'),{status:400});
      if(current){
        if(current.owner===owner&&current.attempt===attempt)return {granted:true,token:current.token,expiresAt:current.until};
        return {granted:false,retryAfterMs:Math.min(8000,current.until-now())};
      }
      current={owner,attempt,token:randomUUID(),started:now(),until:now()+12000};
      return {granted:true,token:current.token,expiresAt:current.until};
    },
    renew(owner,token){
      expire();if(!current||current.owner!==owner||current.token!==token)return {granted:false};
      current.until=now()+12000;return {granted:true,expiresAt:current.until};
    },
    release(owner,token){expire();if(current?.owner===owner&&current.token===token)current=null;return {released:true};},
    revoke(owner){if(current?.owner===owner)current=null;},
  };
}
