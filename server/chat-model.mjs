import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL } from './hermes.mjs';
import { commandLanguage } from './command-language.mjs';

export function createChatModel({directory,provider}) {
  const file=join(directory,'conversation-model.json');let selected=MODEL;
  try{const data=JSON.parse(readFileSync(file,'utf8'));if(typeof data.model==='string'&&/^[a-z0-9][a-z0-9._-]{0,99}$/.test(data.model))selected=data.model;}catch{}
  async function models(){return provider.models?provider.models():[];}
  async function select(id,authorized=()=>true){
    const choices=await models();if(!choices.some(item=>item.id===id))throw Object.assign(new Error('Choose a model available to your signed-in ChatGPT account.'),{status:400});
    if(!authorized())return {cancelled:true};
    mkdirSync(directory,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({model:id}),{mode:0o600});renameSync(file+'.tmp',file);selected=id;return {selected,models:choices};
  }
  const normalize=value=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
  return {get:()=>selected,models,select,
    run(request){
      const match=commandLanguage(request.message).match(/^(?:switch (?:the )?(?:ai )?model to|change (?:the )?(?:ai )?model to|use (?:the )?model)\s+(.+?)[.!?]?$/i);
      if(!match)return null;let cancelled=false;
      return {cancel:async()=>{cancelled=true;},done:(async()=>{const choices=await models();if(cancelled)return{cancelled:true};const requested=normalize(match[1]);const matches=choices.filter(item=>normalize(item.id)===requested||normalize(item.name)===requested);if(matches.length!==1)return{text:'That model name did not match one available choice. Open the model picker and select it there.',provider:'jarvis-model'};await select(matches[0].id,()=>!cancelled);if(cancelled)return{cancelled:true};return{text:`I'll use ${matches[0].name} for your next conversation reply.`,provider:'jarvis-model',model:matches[0].id};})()};
    },
  };
}
