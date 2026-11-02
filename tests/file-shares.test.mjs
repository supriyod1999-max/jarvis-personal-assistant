import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFileShares } from '../server/file-shares.mjs';
import { directory } from './helpers.mjs';

function incoming(bytes){const stream=Readable.from([Buffer.from(bytes)]);stream.headers={'content-length':Buffer.byteLength(bytes)};return stream;}
test('file shares expose only chosen folders and reject traversal, linked files and private storage',async t=>{
  const data=directory(t),root=directory(t),outside=directory(t);await mkdir(join(root,'sub'));await writeFile(join(root,'report.txt'),'Synthetic document');await writeFile(join(root,'.env'),'not for sharing');await writeFile(join(outside,'secret.txt'),'private fixture');
  const files=createFileShares({directory:data,blocked:[data],transferRoot:join(root,'new')});
  await assert.rejects(files.configure({operation:'add',path:root},false),/laptop/);await assert.rejects(files.configure({operation:'add',path:data},true),/outside/);
  await files.configure({operation:'add',path:root},true);const id=files.status(false).shares[0].id;assert.equal(files.status(false).shares[0].path,undefined);
  assert.deepEqual((await files.list(id,'',()=>true)).entries.map(x=>x.name),['sub','report.txt']);
  for(const path of ['../secret.txt','sub/../../secret.txt','.env','C:/Windows','sub\\..\\secret.txt'])await assert.rejects(files.list(id,path,()=>true));
  await symlink(outside,join(root,'escape'),'junction');await assert.rejects(files.list(id,'escape',()=>true),/Linked/);
  await files.configure({operation:'remove',id},true);await assert.rejects(files.list(id,'',()=>true),/unavailable/);
});
test('uploads stream to new files, never overwrite, and discard interrupted or revoked transfers',async t=>{
  const root=directory(t),files=createFileShares({directory:directory(t)});await files.configure({operation:'add',path:root},true);const id=files.status(false).shares[0].id;
  await files.upload(id,'','document.txt',incoming('Approved transfer'),()=>true);assert.equal(await readFile(join(root,'document.txt'),'utf8'),'Approved transfer');
  await assert.rejects(files.upload(id,'','document.txt',incoming('Replacement'),()=>true),/already exists/);assert.equal(await readFile(join(root,'document.txt'),'utf8'),'Approved transfer');
  let allowed=true;const aborted=Readable.from((async function*(){yield Buffer.from('partial');allowed=false;yield Buffer.from('more');})());aborted.headers={};
  await assert.rejects(files.upload(id,'','partial.txt',aborted,()=>allowed),/Sharing stopped/);assert.deepEqual(await readdir(root),['document.txt']);
  const huge=incoming('');huge.headers['content-length']=20*1024**3+1;await assert.rejects(files.upload(id,'','large.bin',huge,()=>true),/20 GB/);
});
test('full drive browsing includes normal hidden files while protecting credential storage and reference writes',async t=>{
  const root=directory(t),privateFolder=join(root,'signin'),reference=join(root,'reference');await mkdir(privateFolder);await mkdir(reference);await writeFile(join(root,'.draft.txt'),'A hidden document');await writeFile(join(privateFolder,'cookie.sqlite'),'private fixture');await writeFile(join(reference,'brief.txt'),'read only fixture');
  const files=createFileShares({directory:directory(t),discoverDrives:async()=>[{id:'drive-test',path:root,label:'Test drive'}],blocked:[privateFolder],blockedWrite:[reference]});
  const status=await files.status(false);assert.equal(status.fullAccess,true);assert.equal(status.canConfigure,false);assert.equal(status.shares[0].path,undefined);
  assert.deepEqual((await files.list('drive-test','',()=>true)).entries.map(e=>e.name),['reference','.draft.txt']);await assert.rejects(files.list('drive-test','signin',()=>true),/protected/);
  await assert.rejects(files.upload('drive-test','reference','new.txt',incoming('new'),()=>true),/cannot be changed/);assert.equal((await files.list('drive-test','reference',()=>true)).entries[0].name,'brief.txt');
});
