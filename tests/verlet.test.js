import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, stepRig } from '../js/core/verlet.js';

test('a pinned chain hangs straight down and keeps its lengths', () => {
  // Three links lying flat to the right of the pin
  const rig = makeRig([[0, 0], [10, 0], [20, 0], [30, 0]], [[0, 1], [1, 2], [2, 3]]);
  for (let frame = 0; frame < 600; frame++) stepRig(rig, { pin: 0, at: [0, 0], gravity: 0.5, damping: 0.9, iterations: 10 });
  const [pin, , , end] = rig.points;
  assert.deepEqual([pin.x, pin.y], [0, 0]);
  assert.ok(Math.abs(end.x) < 0.5, `end x ${end.x}`);
  assert.ok(Math.abs(end.y - 30) < 0.5, `end y ${end.y}`);
  for (const stick of rig.sticks) {
    const first = rig.points[stick.a];
    const second = rig.points[stick.b];
    assert.ok(Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - 10) < 0.2);
  }
});

test('moving the pin swings the chain behind it', () => {
  const rig = makeRig([[0, 0], [0, 10], [0, 20]], [[0, 1], [1, 2]]);
  for (let frame = 0; frame < 5; frame++) stepRig(rig, { pin: 0, at: [frame * 4, 0], gravity: 0.5, damping: 0.95, iterations: 8 });
  assert.equal(rig.points[0].x, 16);
  assert.ok(rig.points[2].x < 16, `trails at ${rig.points[2].x}`);
});
