import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvance } from '../scripts/publish-android-release.mjs';

const release=(code,hash)=>({channels:Object.fromEntries(['phone','watch'].map(variant=>[variant,{versionCode:code,sha256:hash+variant}]))});
test('published Android releases cannot downgrade or replace a released version',()=>{
  const previous=release(13,'original');
  assert.doesNotThrow(()=>validateAdvance(undefined,previous));
  assert.doesNotThrow(()=>validateAdvance(previous,release(13,'original')));
  assert.doesNotThrow(()=>validateAdvance(previous,release(14,'new')));
  assert.throws(()=>validateAdvance(previous,release(12,'older')),/Bump/);
  assert.throws(()=>validateAdvance(previous,release(13,'replacement')),/Bump/);
  const mixed=release(14,'new');mixed.channels.watch={versionCode:13,sha256:'changed'};
  assert.throws(()=>validateAdvance(previous,mixed),/Bump/);
});
