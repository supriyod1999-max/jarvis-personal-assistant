// Synthetic local speech only. Each owned worker is closed before the next starts.
import {createVoice} from '../server/voice.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const gpu=process.argv.includes('--gpu');
const output=resolve(root,gpu?'output/qa/kokoro-daniel/gpu-comparison':'output/qa/kokoro-daniel');mkdirSync(output,{recursive:true});
const texts=[
  'I am ready to help. What would you like to do?',
  'I can help you plan your day. Let us choose the most important task and break it into a few simple steps.',
  'Good morning, sir. Your laptop is connected. I can help you find a file, review your tasks, or continue our conversation. Just tell me what you would like to do next.',
];
function audioDetails(wav){
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Invalid benchmark WAV');
  let rate=0,channels=0,bits=0,bytes=0;
  for(let offset=12;offset+8<=wav.length;){const size=wav.readUInt32LE(offset+4),tag=wav.toString('ascii',offset,offset+4);if(tag==='fmt '){channels=wav.readUInt16LE(offset+10);rate=wav.readUInt32LE(offset+12);bits=wav.readUInt16LE(offset+22);}if(tag==='data')bytes+=size;offset+=8+size+(size%2);}
  if(rate!==24000||channels!==1||bits!==16||!bytes||bytes>90*48000)throw Error('Unexpected benchmark audio format');
  return{sampleRate:rate,audioSeconds:bytes/(rate*channels*bits/8)};
}
const report={measuredAt:new Date().toISOString(),method:`Sequential local ${gpu?'GPU':'CPU'} Kokoro and GPU Chatterbox, identical texts, 3 warm repetitions. Measures complete segment availability, not phone-network or AI latency.`,texts,engines:[]};
for(const engine of ['chatterbox',gpu?'kokoro-gpu':'kokoro']){
  const voice=createVoice({engine,idleMs:0});const result={...voice.status(),warmMs:0,samples:[]};
  try{
    const start=performance.now();await voice.warm();result.warmMs=Math.round(performance.now()-start);Object.assign(result,voice.status());console.log(JSON.stringify({engine,warmMs:result.warmMs,...(result.gpuMemoryDeltaMiB?{gpuMemoryDeltaMiB:result.gpuMemoryDeltaMiB}:{})}));
    for(let round=1;round<=3;round++)for(const[index,text]of texts.entries()){
      const started=performance.now(),wav=await voice.speak({text}),elapsedMs=Math.round(performance.now()-started),audio=audioDetails(wav);
      const sample={round,text:index+1,characters:text.length,elapsedMs,...audio,realTimeFactor:Number((elapsedMs/1000/audio.audioSeconds).toFixed(3))};result.samples.push(sample);console.log(JSON.stringify({engine,...sample}));
      if(round===1)writeFileSync(resolve(output,`${engine}-sample-${index+1}.wav`),wav);
    }
    report.engines.push(result);
  }finally{await voice.close();}
}
writeFileSync(resolve(output,'comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log('Local voice comparison saved.');
