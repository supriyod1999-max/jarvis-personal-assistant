import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApplication } from '../server/index.mjs';
import { directory } from './helpers.mjs';
import { fixtureHermes } from './fixtures/hermes.mjs';
test('watch delegation endpoints preserve the private identity, Origin, pairing and signature gates',async t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)}),origin='https://fixture.tailtest.ts.net';const app=createApplication({directory:path,port:14586,hermes:fixtureHermes(),privateAccess:{version:1,origin,ownerLogin:'owner@example.test',port:14587}});
  t.after(async()=>{await app.close();for(const cleanup of cleanups)cleanup();});app.listen();await once(app.server,'listening');const headers={'Content-Type':'application/json','X-Second-Brain':'1'};
  const unsigned={watchId:'a'.repeat(64),operation:'status',args:'{}'};
  assert.equal((await fetch('http://127.0.0.1:14586/api/watch/challenge',{method:'POST',headers,body:JSON.stringify(unsigned)})).status,403);
  function phone(route,body,extra={}){return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:14587,path:route,method:body?'POST':'GET',headers:{Host:'fixture.tailtest.ts.net','Tailscale-User-Login':'owner@example.test',Origin:origin,...headers,...extra}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});req.on('error',reject);req.end(body&&JSON.stringify(body));});}
  assert.equal(await phone('/api/watch/challenge',unsigned,{'Tailscale-User-Login':'someone-else@example.test'}),403);
  assert.equal(await phone('/api/watch/challenge',unsigned,{Origin:'https://evil.test'}),403);
  assert.equal(await phone('/api/watch/challenge',unsigned),403);
  assert.equal(await phone('/api/watch/execute',{requestId:'missing',signature:'bad'}),401);
  assert.equal(await phone('/api/watch/status'),403);
});
