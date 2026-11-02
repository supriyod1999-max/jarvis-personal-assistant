import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { presenceBounds, springStep } = createRequire(import.meta.url)('../desktop/presence-layout.cjs');

test('notch stays attached to the physical display top across sizes, taskbars and negative display origins', () => {
  for (const bounds of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -2560, y: -400, width: 2560, height: 1440 }]) {
    const display = { bounds, workArea: { ...bounds, y: bounds.y + 48, height: bounds.height - 48 } };
    for (const size of ['compact', 'peek', 'expanded']) {
      const box = presenceBounds(display, 'island', size);
      assert.equal(box.y, bounds.y);
      assert.equal(box.x + box.width / 2, bounds.x + bounds.width / 2);
      assert.ok(box.height < 250);
    }
    const orb = presenceBounds(display, 'orb', 'expanded');
    assert.equal(orb.y + orb.height / 2, display.workArea.y + display.workArea.height / 2);
  }
  const tiny = presenceBounds({ bounds: { x: 0, y: 0, width: 400, height: 200 } }, 'island', 'expanded');
  assert.deepEqual(tiny, { x: 0, y: 0, width: 400, height: 200 });
});

test('interrupted expansion carries its current position and settles at the new compact target', () => {
  let p = 252, v = 0;
  for (let i = 0; i < 9; i++) { const step = springStep(p, v, 552, .016); p = step.position; v = step.velocity; }
  assert.ok(p > 252 && p < 552); assert.ok(v > 0);
  const before = p;
  for (let i = 0; i < 100; i++) { const step = springStep(p, v, 252, i === 0 ? .06 : .016); p = step.position; v = step.velocity; assert.ok(Number.isFinite(p) && p > 240 && p < 570); }
  assert.ok(before > p); assert.ok(Math.abs(p - 252) < .01); assert.ok(Math.abs(v) < .01);
});

