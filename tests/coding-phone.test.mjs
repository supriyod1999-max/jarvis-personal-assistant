import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPhoneCoding } from '../server/coding-sessions.mjs';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';

test('phone coding snapshots honor pause and revocation during a scan', async t => {
  const path=directory(t);let allowed=true,reads=0,clears=0,finish;
  const sessions={clear:()=>clears++,scan:()=>{reads++;return new Promise(resolve=>finish=resolve);}};
  const coding=createPhoneCoding({directory:path,sessions});
  const pending=coding.snapshot(()=>allowed);while(!finish)await new Promise(resolve=>setTimeout(resolve,5));allowed=false;finish({sessions:[{title:'Must disappear'}]});
  assert.deepEqual((await pending).sessions,[]);assert.equal(clears,1);
  allowed=true;await mkdir(join(path,'desktop'));await writeFile(join(path,'desktop/preferences.json'),'{"codingEnabled":false}');
  assert.equal((await coding.snapshot(()=>allowed)).enabled,false);assert.equal(reads,1);
});

test('coding API is primary PIN gated, read-only, private and not cached', async t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)});let reads=0;
  const app=createApplication({directory:path,port:14384,hermes:fixtureHermes(),coding:{clear(){},snapshot:async authorized=>{assert.equal(authorized(),true);reads++;return{enabled:true,sessions:[{title:'Synthetic coding session'}]};}}});
  t.after(async()=>{await app.close();for(const fn of cleanups)fn();});app.listen();await once(app.server,'listening');
  const base='http://127.0.0.1:14384',headers={'Content-Type':'application/json','X-Second-Brain':'1'};
  assert.equal((await fetch(base+'/api/coding/sessions')).status,403);assert.equal(reads,0);
  const setup=await fetch(base+'/api/lock/setup',{method:'POST',headers,body:JSON.stringify({newPin:'654321',confirmPin:'654321'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0],auth={...headers,Cookie:cookie};
  const result=await fetch(base+'/api/coding/sessions',{headers:auth});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).sessions[0].title,'Synthetic coding session');
  assert.equal((await fetch(base+'/api/coding/approve',{method:'POST',headers:auth,body:'{}'})).status,405);
  assert.equal((await fetch(base+'/api/coding/sessions',{headers:{...auth,Origin:'https://evil.test'}})).status,403);
  await fetch(base+'/api/lock/lock',{method:'POST',headers:auth,body:'{}'});assert.equal((await fetch(base+'/api/coding/sessions',{headers:auth})).status,401);assert.equal(reads,1);
});
