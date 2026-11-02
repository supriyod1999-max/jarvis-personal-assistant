import test from 'node:test';
import assert from 'node:assert/strict';
import { runSpeechQueue } from '../src/speechQueue.ts';
import { nextSpeech } from '../src/talkAudio.ts';

const waitFor = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('Speech queue condition timed out.'); };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('speech generation overlaps playback but prepares no more than one segment ahead', async () => {
  const pending = ['one', 'two', 'three'], prepared = [], played = [], first = gate();
  const job = runSpeechQueue({ take: () => pending.shift(), done: () => true, valid: () => true,
    prepare: async text => { prepared.push(text); return text; },
    play: async text => { played.push(text); if (text === 'one') await first.promise; },
  });
  await waitFor(() => prepared.length === 2); assert.deepEqual(played, ['one']);
  await new Promise(r => setTimeout(r, 50)); assert.deepEqual(prepared, ['one', 'two']);
  first.resolve(); await job; assert.deepEqual(played, ['one', 'two', 'three']);
});

test('ending speech discards a prefetched segment and does not play late generation', async () => {
  const pending = ['one', 'two', 'three'], played = [], second = gate(), first = gate(); let active = true, preparing = 0;
  const job = runSpeechQueue({ take: () => pending.shift(), done: () => true, valid: () => active,
    prepare: async text => { preparing++; if (text === 'two') await second.promise; return text; },
    play: async text => { played.push(text); await first.promise; },
  });
  await waitFor(() => preparing === 2); active = false; first.resolve(); await job; second.resolve();
  await new Promise(r => setTimeout(r, 30)); assert.deepEqual(played, ['one']); assert.equal(preparing, 2);
});

test('speech queue propagates a synthesis failure without retrying it', async () => {
  let calls = 0;
  await assert.rejects(runSpeechQueue({ take: () => 'one', done: () => true, valid: () => true,
    prepare: async () => { calls++; throw new Error('GPU unavailable'); }, play: async () => assert.fail('No audio should play'),
  }), /GPU unavailable/); assert.equal(calls, 1);
});

test('short opening chunks preserve every character across growing text and a final tail', () => {
  const original = 'When we have a long and detailed explanation to share, we can start speaking at a natural pause while the rest is being prepared. Then we continue with a second sentence.';
  let consumed = '', chunks = [];
  for (let end = 1; end <= original.length; end++) {
    const final = end === original.length;
    let remaining = original.slice(0, end).slice(consumed.length), count;
    while ((count = nextSpeech(remaining, final, !consumed.trim())) > 0) { const chunk = remaining.slice(0, count); chunks.push(chunk); consumed += chunk; remaining = remaining.slice(count); }
  }
  assert.equal(chunks.join(''), original); assert.ok(chunks[0].length <= 140); assert.match(chunks[0], /,$/);
  assert.equal(nextSpeech('Still collecting words', false, true), 0);
});
