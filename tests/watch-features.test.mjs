import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchFeatures } from '../server/watch-features.mjs';
test('companion speech preserves the requested pet voice and effect while ordinary speech stays unchanged',async()=>{
 const seen=[],run=createWatchFeatures({voice:{speak:async input=>{seen.push(input);return Buffer.from('audio');}}});
 await run('voice.speak',{text:'Hello.',voice:'af_heart',style:'pet'},()=>true);
 await run('voice.speak',{text:'Ready.'},()=>true);
 assert.deepEqual(seen,[{text:'Hello.',voice:'af_heart',style:'pet'},{text:'Ready.'}]);
});
test('watch file pages stay bounded and downloads bind an existing exact file',async()=>{
  const entries=Array.from({length:60},(_,i)=>({name:'日'.repeat(200)+i,directory:false,bytes:42,modified:'2026-10-27'}));let check=true;
  const run=createWatchFeatures({files:{status:()=>({shares:[{id:'drive-c',label:'C:',path:'private-path'}]}),list:async(id,path,authorized)=>{assert(authorized());assert.equal(id,'drive-c');assert.equal(path,'folder');return{entries,truncated:false};}}});
  assert.deepEqual(await run('files.roots',{},()=>check),{shares:[{id:'drive-c',label:'C:'}]});
  const page=await run('files.list',{share:'drive-c',path:'folder',offset:0},()=>check);assert(page.next>0&&page.next<20);assert(Buffer.byteLength(JSON.stringify(page))<12000);
  const file=await run('files.phone-download',{share:'drive-c',path:'folder/'+entries[0].name},()=>check);assert.equal(file.phoneDownload.path,'folder/'+entries[0].name);
  await assert.rejects(run('files.phone-download',{share:'drive-c',path:'folder/missing'},()=>check),/changed/);
});
