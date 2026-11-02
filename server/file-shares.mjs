import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { lstat, realpath, readdir, mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, join, sep, parse, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { createFileTransfers, MAX_FILE_BYTES, TRANSFER_CHUNK_BYTES } from './file-transfers.mjs';

const MAX=MAX_FILE_BYTES;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const inside=(base,path)=>path===base||path.startsWith(base.endsWith(sep)?base:base+sep);
function name(value){return typeof value==='string' && value.length>0 && value.length<=240 && !['.','..'].includes(value) && !value.startsWith('.jarvis-upload-') && !/[\\/:*?"<>|\x00-\x1f]/.test(value) && !/[. ]$/.test(value) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);}
function parts(value=''){if(typeof value!=='string'||value.length>3000)fail('Invalid folder path.');const list=value?value.split('/'):[];if(list.some(part=>!name(part)))fail('Choose a file inside the shared folder.');return list;}

export function createFileShares({directory,transferRoot,blocked=[],blockedWrite=[],discoverDrives}){
  const config=join(directory,'file-shares.json');let shares=[];
  try{const saved=JSON.parse(readFileSync(config,'utf8'));if(Array.isArray(saved.shares))shares=saved.shares.filter(s=>s&&typeof s.id==='string'&&typeof s.path==='string'&&typeof s.label==='string').slice(0,8);}catch{}
  let refreshed=0,discovering;
  async function refreshDrives(){if(!discoverDrives||Date.now()-refreshed<10000)return;if(discovering)return discovering;discovering=(async()=>{shares=await discoverDrives();refreshed=Date.now();})().finally(()=>discovering=undefined);return discovering;}
  const save=()=>{mkdirSync(directory,{recursive:true});writeFileSync(config+'.tmp',JSON.stringify({shares}),{mode:0o600});renameSync(config+'.tmp',config);};
  async function root(id){await refreshDrives();const share=shares.find(s=>s.id===id);if(!share)fail('This drive or folder is unavailable.',404);const actual=await realpath(share.path);if(actual!==share.path||!(await lstat(actual)).isDirectory())fail('The drive or folder moved. Refresh and try again.',409);return share;}
  async function locate(id,relative='',folder=false){const share=await root(id),path=resolve(share.path,...parts(relative));if(!inside(share.path,path))fail('Invalid file path.');if(discoverDrives&&blocked.some(base=>inside(resolve(base),path)))fail('Application sign-in and credential storage is protected.',403);let current=share.path;for(const part of parts(relative)){current=join(current,part);if((await lstat(current)).isSymbolicLink())fail('Linked folders and files are unavailable.',403);}const actual=await realpath(path);if(!inside(share.path,actual)||actual!==path)fail('Linked folders and files are unavailable.',403);const stat=await lstat(actual);if(folder?!stat.isDirectory():!stat.isFile())fail(folder?'Choose a folder.':'Choose a regular file.');return{share,path:actual,stat};}
  function authorized(id,check){if(!check()||!shares.some(s=>s.id===id))fail('Sharing stopped. Refresh before trying again.',403);}
  function writable(target){if(blockedWrite.some(base=>inside(resolve(base),target)))fail('This application or reference folder cannot be changed from file controls.',403);}
  const transfers=createFileTransfers({directory,locate,authorized,writable,validName:name});
  return {
    transfers,
    status(local){const snapshot=()=>({fullAccess:!!discoverDrives,canConfigure:local&&!discoverDrives,maximumBytes:MAX,chunkBytes:TRANSFER_CHUNK_BYTES,resumableUploads:true,shares:shares.map(s=>({id:s.id,label:s.label,...(local?{path:s.path}:{})}))});return discoverDrives?refreshDrives().then(snapshot):snapshot();},
    async configure(input,local,check=()=>true){if(discoverDrives)fail('Laptop drive access is already enabled.');if(!local||!check())fail('Choose shared folders on the unlocked laptop.',403);
      if(input.operation==='remove'){shares=shares.filter(s=>s.id!==input.id);save();return;}
      if(shares.length>=8)fail('Up to eight folders can be shared.');
      let target=input.path;
      if(input.operation==='create'){if(!transferRoot)fail('Transfer folder unavailable.');await mkdir(transferRoot);target=transferRoot;}
      if(typeof target!=='string'||target.length>2000||target.startsWith('\\\\'))fail('Choose a local folder.');
      target=await realpath(resolve(target));if(target===parse(target).root||target===homedir()||blocked.some(path=>inside(resolve(path),target)||inside(target,resolve(path))))fail('Choose a dedicated personal folder, outside application and credential storage.');
      if(!name(basename(target))||!(await lstat(target)).isDirectory())fail('Choose a regular local folder.');
      if(shares.some(s=>s.path===target))fail('This folder is already shared.');
      if(!check())fail('Unlock JARVIS before sharing this folder.',403);shares.push({id:randomUUID(),label:typeof input.label==='string'&&input.label.trim()?input.label.trim().slice(0,80):basename(target),path:target});save();
    },
    async list(id,relative,check){const item=await locate(id,relative,true);authorized(id,check);const entries=[];let truncated=false;
      for(const entry of await readdir(item.path,{withFileTypes:true})){if(!name(entry.name)||!discoverDrives&&entry.name.startsWith('.')||entry.isSymbolicLink()||!entry.isDirectory()&&!entry.isFile())continue;if(entries.length>=500){truncated=true;break;}try{const value=await locate(id,[relative,entry.name].filter(Boolean).join('/'),entry.isDirectory());entries.push({name:entry.name,directory:entry.isDirectory(),bytes:value.stat.size,modified:value.stat.mtime.toISOString()});}catch{}}
      authorized(id,check);entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));return{entries,truncated};
    },
    async upload(id,relative,filename,request,check){if(!name(filename))fail('Choose a valid file name.');if(Number(request.headers['content-length'])>MAX)fail('Files can be up to 20 GB.',413);
      const item=await locate(id,relative,true);authorized(id,check);const target=join(item.path,filename),temp=join(item.path,'.jarvis-upload-'+randomUUID());if(blockedWrite.some(base=>inside(resolve(base),target)))fail('This application or reference folder cannot be changed from file controls.',403);let file;let bytes=0;
      try{file=await open(temp,'wx',0o600);for await(const chunk of request){authorized(id,check);bytes+=chunk.length;if(bytes>MAX)fail('Files can be up to 20 GB.',413);await file.writeFile(chunk);}await file.sync();await file.close();file=null;
        await locate(id,relative,true);authorized(id,check);await link(temp,target);return{name:filename,bytes};
      }catch(error){if(error.code==='EEXIST')fail('A file with that name already exists. Choose a different name to keep both.',409);throw error;}
      finally{await file?.close().catch(()=>{});await unlink(temp).catch(()=>{});}
    },
    async download(id,relative,res,check,{method='GET',range,ifMatch}={}){const item=await locate(id,relative);authorized(id,check);if(item.stat.size>MAX)fail('Files can be up to 20 GB per transfer.',413);const file=await open(item.path,'r');
      try{const stat=await file.stat();if(!stat.isFile()||stat.ino!==item.stat.ino||stat.size!==item.stat.size)fail('The file changed. Refresh and try again.',409);authorized(id,check);
        const etag='"'+createHash('sha256').update([item.path,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('\n')).digest('hex')+'"';
        if(ifMatch&&ifMatch!==etag)fail('The laptop file changed. Start a fresh download to avoid mixing versions.',412);
        let start=0,end=stat.size-1,status=200;
        if(range&&method!=='HEAD'){
          const match=/^bytes=(\d+)-(\d*)$/.exec(range);
          if(!match)fail('Invalid download range.',416);
          start=Number(match[1]);end=match[2]?Number(match[2]):end;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||end>=stat.size)fail('Invalid download range.',416);
          status=206;
        }
        res.writeHead(status,{'Content-Type':'application/octet-stream','Content-Length':Math.max(0,end-start+1),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(basename(item.path)),'Cache-Control':'no-store','ETag':etag,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
        if(method==='HEAD'||stat.size===0){await file.close();res.end();return;}
        let sent=0;
        const guard=new Transform({transform(chunk,encoding,done){try{authorized(id,check);sent+=chunk.length;if(sent>end-start+1)fail('The file changed.',409);done(null,chunk);}catch(error){done(error);}}});const source=file.createReadStream({start,end});source.on('error',()=>res.destroy());guard.on('error',()=>{source.destroy();res.destroy();});res.on('close',()=>{source.destroy();guard.destroy();});source.pipe(guard).pipe(res);
      }catch(error){await file.close();throw error;}
    },
  };
}
