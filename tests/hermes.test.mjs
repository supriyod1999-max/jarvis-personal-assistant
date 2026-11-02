import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_ARGS, chatArgs, parseHermesLine } from '../server/hermes.mjs';
test('Hermes transport tolerates its exact startup diagnostic while refusing non-protocol output', () => {
  assert.equal(parseHermesLine('Warning: Unknown toolsets: none\r'), null);
  assert.equal(parseHermesLine(''), null);
  assert.equal(parseHermesLine('{"type":"text","text":" hi "}').text, ' hi ');
  assert.throws(() => parseHermesLine('Unexpected output'));
  assert.ok(CHAT_ARGS.includes('--safe-mode')); assert.ok(CHAT_ARGS.includes('gpt-5.6-luna'));
  assert.equal(CHAT_ARGS.at(-1), '-');
});

test('Talk uses lower reasoning on the same model without changing normal chat arguments', () => {
  const original = [...CHAT_ARGS];
  assert.deepEqual(chatArgs({ voice: true }), [...original, '--reasoning', 'low']);
  assert.deepEqual(chatArgs({ voice: true, reasoning: 'high' }), [...original, '--reasoning', 'high']);
  assert.deepEqual(chatArgs({ reasoning: 'none' }), [...original, '--reasoning', 'none']);
  assert.throws(() => chatArgs({ reasoning: 'unexpected' }), /Unsupported thinking effort/);
  assert.deepEqual(chatArgs(), original); assert.deepEqual(chatArgs({ voice: false }), original);
  assert.deepEqual(CHAT_ARGS, original);
});
