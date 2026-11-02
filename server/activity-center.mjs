import { actionFeed } from './action-feed.mjs';
/** Read-only summaries; failures are visible and never trigger action retries. */
export function createActivityCenter({coding,transfers,connections,reviews,conversations,requests=()=>[],now=Date.now}){
  return {async snapshot(check){
    if(!check())throw Object.assign(Error('Unlock JARVIS to view activity.'),{status:401});
    const sources=[['coding',()=>coding?.snapshot(check)||{enabled:false,sessions:[]}],['transfers',()=>transfers?.list(check)||[]],['connections',()=>connections.check()],['reviews',()=>reviews()],['conversations',()=>conversations()],['requests',()=>requests()]];
    const values=await Promise.allSettled(sources.map(([,read])=>Promise.resolve().then(read)));
    if(!check())throw Object.assign(Error('Activity access ended.'),{status:401});
    const result={checkedAt:now(),unavailable:[]};
    values.forEach((value,index)=>{const key=sources[index][0];if(value.status==='fulfilled')result[key]=value.value;else result.unavailable.push(key);});
    result.actions=actionFeed(result);
    return result;
  }};
}
