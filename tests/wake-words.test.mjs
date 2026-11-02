import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeCommand, sleepCommand } from '../src/wakeWords.ts';
test('wake detection accepts exact prefix phrases, never embedded mentions or ordinary ambient speech', () => {
  for (const text of ['Hey Jarvis', 'Hello, Jarvis.', 'Wake up Jarvis!']) assert.equal(wakeCommand(text), '');
  assert.equal(wakeCommand('Hey Jarvis, add a task to study'), 'add a task to study');
  for (const text of ['Jarvis', 'I said hey Jarvis', 'Hello James', 'wake up Jarvison', 'the video says hello Jarvis']) assert.equal(wakeCommand(text), null);
  assert.equal(sleepCommand('Jarvis, go to sleep'), true); assert.equal(sleepCommand('Explain sleep now please'), false);
});
