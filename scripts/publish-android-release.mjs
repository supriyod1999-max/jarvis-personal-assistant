import { readFile, writeFile, mkdir, copyFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function describeApk(file,variant,aapt){
  const metadata=execFileSync(aapt,['dump','badging',file],{encoding:'utf8',windowsHide:true});
  const match=metadata.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  if(!match||match[1]!=='org.jarvisassistant.app')throw Error('Only the personal production package can be published; preview APKs are excluded.');
  const versionCode=Number(match[2]),versionName=match[3];if(!Number.isSafeInteger(versionCode)||versionCode<1||!/^\d+\.\d+\.\d+$/.test(versionName))throw Error('Invalid release version.');
  const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);const sha256=hash.digest('hex'),bytes=(await stat(file)).size;
  if(bytes<1024||bytes>150*1024*1024)throw Error('Release APK size is outside the allowed range.');
  const minimumSdk=Number(metadata.match(/^sdkVersion:'(\d+)'/m)?.[1]);if(!minimumSdk)throw Error('APK minimum Android version is missing.');
  const watch=/uses-feature: name='android.hardware.type.watch'/.test(metadata);if(watch!==(variant==='watch'))throw Error('The APK does not match its device channel.');
  return{packageName:match[1],versionCode,versionName,minimumSdk,bytes,sha256,url:`/downloads/JARVIS-${variant}-${versionName}-${sha256.slice(0,12)}.apk`};
}
export function validateAdvance(previous,next){
  if(!previous)return;
  for(const variant of ['phone','watch']){const old=previous.channels?.[variant],value=next.channels[variant];if(old&&(value.versionCode<old.versionCode||value.versionCode===old.versionCode&&value.sha256!==old.sha256))throw Error('Bump the Android version before publishing a different APK. Releases cannot silently change or go backwards.');}
}
export async function publishAndroid({aapt,base=root}={}){
  const sources={phone:resolve(base,'output/android/JARVIS.apk'),watch:resolve(base,'output/android/JARVIS-Watch.apk')};
  const channels={};for(const variant of ['phone','watch'])channels[variant]=await describeApk(sources[variant],variant,aapt);
  if(channels.phone.versionCode!==channels.watch.versionCode||channels.phone.versionName!==channels.watch.versionName)throw Error('Phone and watch release versions must match.');
  const next={format:'jarvis-android-release',version:1,publishedAt:new Date().toISOString(),channels};
  let previous;try{previous=JSON.parse(await readFile(resolve(base,'public/downloads/android-release.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  validateAdvance(previous,next);
  for(const directory of ['public/downloads','dist/downloads']){
    const target=resolve(base,directory);await mkdir(target,{recursive:true});
    for(const variant of ['phone','watch'])await copyFile(sources[variant],join(target,channels[variant].url.split('/').at(-1)));
    await writeFile(join(target,'android-release.json.tmp'),JSON.stringify(next,null,2));await rename(join(target,'android-release.json.tmp'),join(target,'android-release.json'));
  }
  await writeFile(resolve(base,'output/android/android-release.json'),JSON.stringify(next,null,2));return next;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv.includes('--publish'))throw Error('Publishing is explicit. Use --publish after reviewing the tested APKs.');
  const sdk=process.env.ANDROID_HOME||resolve(process.env.LOCALAPPDATA || '', 'Android/Sdk');
  const result=await publishAndroid({aapt:resolve(sdk,'build-tools/36.0.0/aapt.exe')});console.log(`Published JARVIS ${result.channels.phone.versionName} for phone and watch.`);
}
