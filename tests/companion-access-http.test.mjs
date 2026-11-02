import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createApplication} from '../server/index.mjs';
import {directory} from './helpers.mjs';
import {fixtureHermes} from './fixtures/hermes.mjs';

test('companion HTTP keeps private identity/Origin, PIN enrollment and revocation gates while permitting signed locked general access',async t=>{
  const cleanups=[],path=directory({after:fn=>cleanups.push(fn)}),origin='https://fixture.tailtest.ts.net';const app=createApplication({directory:path,port:14588,hermes:fixtureHermes(),privateAccess:{version:1,origin,ownerLogin:'owner@example.test',port:14589}});t.after(async()=>{await app.close();for(const cleanup of cleanups)cleanup();});app.listen();await once(app.server,'listening');
  const headers={'Content-Type':'application/json','X-Second-Brain':'1'},base='http://127.0.0.1:14588';const local=(route,body,cookie)=>fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{...headers,...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const setup=await local('lock/setup',{newPin:'135790',confirmPin:'135790'});assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0];
  function phone(route,body,extra={}){return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:14589,path:'/api/'+route,method:body?'POST':'GET',headers:{Host:'fixture.tailtest.ts.net','Tailscale-User-Login':'owner@example.test',Origin:origin,...headers,...extra}},response=>{let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(data)}));});req.on('error',reject);req.end(body&&JSON.stringify(body));});}
  const keys=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),deviceId=createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('hex'),enrollment={publicKey,name:'Synthetic camera',voice:false,camera:true};
  assert.equal((await phone('companions/prepare',enrollment)).status,401);assert.equal((await phone('companions/prepare',enrollment,{cookie,Origin:'https://evil.test'})).status,403);
  const prepared=await phone('companions/prepare',enrollment,{cookie});assert.equal(prepared.status,200);const approved=await phone('companions/approve',{requestId:prepared.data.requestId,signature:sign('sha256',Buffer.from(prepared.data.payload),keys.privateKey).toString('base64')},{cookie});assert.equal(approved.status,200);
  await local('lock/lock',{},cookie);assert.equal((await local('companions/status')).status,401);assert.equal((await phone('companions/status')).status,401);
  const input={deviceId,operation:'session.poll',args:'{"sharing":true}'};assert.equal((await local('companions/challenge',input)).status,403);assert.equal((await phone('companions/challenge',input,{'Tailscale-User-Login':'other@example.test'})).status,403);
  const challenge=await phone('companions/challenge',input);assert.equal(challenge.status,200);assert.equal((await phone('companions/execute',{requestId:challenge.data.requestId,signature:sign('sha256',Buffer.from(challenge.data.payload),keys.privateKey).toString('base64')})).status,200);
  assert.equal((await phone('companions/challenge',{...input,operation:'voice.reply'})).status,400);assert.equal((await phone('companions/challenge',{...input,operation:'windows.unlock'})).status,400);assert.equal((await phone('companions/revoke',{deviceId})).status,401);assert.equal((await phone('companions/frame',{deviceId})).status,401);
});
