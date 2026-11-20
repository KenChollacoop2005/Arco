import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, stepRig, makeSwing, stepSwing } from '../js/core/verlet.js';

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

test('a carried figure swings with the cursor, never past its cap, and settles when still', () => {
  const options = { push: 0.004, spring: 0.08, damping: 0.86, maxAngle: 0.35, handLag: 0.4, maxLag: 6, bob: 1.5, bobRate: 0.1 };
  const swing = makeSwing(0);
  // Wild cursor flicks
  let x = 0;
  for (let frame = 0; frame < 400; frame++) {
    x += (frame % 7 < 3 ? 1 : -1) * 180;
    stepSwing(swing, x, options);
    assert.ok(Math.abs(swing.angle) <= options.maxAngle + 1e-9, `frame ${frame} angle ${swing.angle}`);
    assert.ok(Math.abs(swing.lag[0]) <= options.maxLag && Math.abs(swing.lag[1]) <= options.bob);
  }
  // A move to the right swings the body back to the left (negative angle)
  const fresh = makeSwing(0);
  stepSwing(fresh, 40, options);
  assert.ok(fresh.angle < 0);
  for (let frame = 0; frame < 600; frame++) stepSwing(swing, x, options);
  assert.ok(Math.abs(swing.angle) < 1e-3 && Math.abs(swing.lag[0]) < 1e-3, `still: ${swing.angle} ${swing.lag[0]}`);
});
