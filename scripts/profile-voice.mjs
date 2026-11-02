// Synthetic local-only TTS timings. No microphone, personal records or playback.
import { createVoice } from '../server/voice.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const voice = createVoice(); const report = { measuredAt: new Date().toISOString(), engine: voice.status().engine, voice: voice.status().voice, samples: [] };
const texts = [
  'I am ready to help. What would you like to do?',
  'I can help you plan your day. Let us choose the most important task and break it into a few simple steps.',
];
try {
  let start = performance.now(); await voice.warm(); report.warmMs = Math.round(performance.now() - start); console.log(JSON.stringify({ warmMs: report.warmMs }));
  for (let round = 1; round <= 3; round++) for (const [index, text] of texts.entries()) {
    start = performance.now(); const wav = await voice.speak({ text });
    const sample = { round, text: index + 1, characters: text.length, elapsedMs: Math.round(performance.now() - start), wavBytes: wav.length, audioSeconds: (wav.length - 44) / 48000 };
    report.samples.push(sample); console.log(JSON.stringify(sample));
  }
  mkdirSync('output/qa', { recursive: true }); writeFileSync(`output/qa/voice-latency-${process.argv.includes('--optimized') ? 'optimized' : 'baseline'}.json`, JSON.stringify(report, null, 2));
} finally { await voice.close(); }
