import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStability, quickStable } from '../js/core/stability.js';
import { STABILITY_MARGIN } from '../js/config.js';

const BLOCK_LENGTH = 100; // block length in mm
const BLOCK_WIDTH = 40; // block width in mm
const BLOCK_HEIGHT = 10; // block height in mm

// Table plus n blocks at harmonic offsets
function bookStack(count, scale) {
  const bodies = [{ id: 1, rects: [[-400, 0, 0, BLOCK_WIDTH]], z0: 0, z1: BLOCK_HEIGHT }];
  let right = 0;
  for (let fromTop = count; fromTop >= 1; fromTop--) {
    right += (scale * BLOCK_LENGTH) / (2 * fromTop);
    const level = count - fromTop + 1;
    bodies.push({
      id: level + 1,
      rects: [[right - BLOCK_LENGTH, 0, right, BLOCK_WIDTH]],
      z0: level * BLOCK_HEIGHT,
      z1: (level + 1) * BLOCK_HEIGHT,
    });
  }
  return { bodies, overhang: right };
}

test('book stacking overhang matches the harmonic formula', () => {
  for (let count = 1; count <= 8; count++) {
    let harmonic = 0;
    for (let term = 1; term <= count; term++) harmonic += 1 / term;
    const { overhang } = bookStack(count, 1);
    assert.ok(Math.abs(overhang - 0.5 * harmonic * BLOCK_LENGTH) < 1e-9);
  }
});

test('book stacks just inside the limit stand', () => {
  for (let count = 1; count <= 8; count++) {
    const { bodies } = bookStack(count, 0.999);
    assert.equal(checkStability(bodies, { margin: 0 }).status, 'pass', 'blocks: ' + count);
    assert.equal(quickStable(bodies, 0), true);
  }
});

test('book stacks just past the limit fall', () => {
  for (let count = 1; count <= 8; count++) {
    const { bodies } = bookStack(count, 1.001);
    const result = checkStability(bodies, { margin: 0 });
    assert.equal(result.status, 'fail', 'blocks: ' + count);
    assert.equal(quickStable(bodies, 0), false);
  }
});

test('one block pushed past the limit is the one reported', () => {
  const { bodies } = bookStack(4, 0.9);
  const top = bodies[bodies.length - 1];
  top.rects = [[top.rects[0][0] + 30, 0, top.rects[0][2] + 30, BLOCK_WIDTH]];
  const result = checkStability(bodies, { margin: 0 });
  assert.equal(result.modules.get(top.id).status, 'fail');
});

const cell = (cellX, cellY) => [cellX * 25, cellY * 25, (cellX + 1) * 25, (cellY + 1) * 25];

test('cantilever on a core tips without a counterweight', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0)], z0: 0, z1: 50 },
    { id: 2, rects: [cell(0, 0), cell(1, 0), cell(2, 0)], z0: 50, z1: 75 },
  ];
  const result = checkStability(bodies);
  assert.equal(result.status, 'fail');
  assert.equal(result.modules.get(2).status, 'fail');
});

test('cantilever on a core holds with a counterweight, margin by hand', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0)], z0: 0, z1: 50 },
    { id: 2, rects: [cell(0, 0), cell(1, 0)], z0: 50, z1: 75 },
    { id: 3, rects: [cell(0, 0)], z0: 75, z1: 100 },
  ];
  const result = checkStability(bodies);
  assert.equal(result.status, 'pass');
  const slabOnCore = result.interfaces.find((contact) => contact.upper === 2 && contact.lower === 1);
  const expected = 25 - (2 * 25 + 1 * 12.5) / 3;
  assert.ok(Math.abs(slabOnCore.margin - expected) < 1e-6, 'margin ' + slabOnCore.margin);
});

test('a two cell slab balanced on its edge is only a warning', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0)], z0: 0, z1: 50 },
    { id: 2, rects: [cell(0, 0), cell(1, 0)], z0: 50, z1: 75 },
  ];
  assert.equal(checkStability(bodies, { margin: 0 }).status, 'pass');
  assert.equal(checkStability(bodies).status, 'warn');
  assert.ok(STABILITY_MARGIN > 0);
});

test('L stack on a column under its corner cell holds, margin by hand', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0)], z0: 0, z1: 25 },
    { id: 2, rects: [cell(0, 0), cell(1, 0), cell(0, 1)], z0: 25, z1: 50 },
  ];
  const result = checkStability(bodies);
  assert.equal(result.status, 'pass');
  assert.ok(Math.abs(result.modules.get(2).margin - (25 - 62.5 / 3)) < 1e-6);
});

test('L stack on a column under one leg tips', () => {
  const bodies = [
    { id: 1, rects: [cell(1, 0)], z0: 0, z1: 25 },
    { id: 2, rects: [cell(0, 0), cell(1, 0), cell(0, 1)], z0: 25, z1: 50 },
  ];
  assert.equal(checkStability(bodies).status, 'fail');
});

test('L stack on two columns under its legs holds, margin by hand', () => {
  const bodies = [
    { id: 1, rects: [cell(1, 0)], z0: 0, z1: 25 },
    { id: 2, rects: [cell(0, 1)], z0: 0, z1: 25 },
    { id: 3, rects: [cell(0, 0), cell(1, 0), cell(0, 1)], z0: 25, z1: 50 },
  ];
  const result = checkStability(bodies, { margin: 0 });
  assert.equal(result.status, 'pass');
  const centroid = 62.5 / 3;
  const expected = (2 * centroid - 25) / Math.SQRT2;
  const total = result.interfaces
    .filter((contact) => contact.upper === 3)
    .reduce((sum, contact) => sum + contact.force, 0);
  assert.ok(Math.abs(total - 3 * 625 * 25) < 1e-6);
  const points = [[25, 0], [50, 0], [50, 25], [25, 50], [0, 50], [0, 25]];
  let distance = Infinity;
  for (let index = 0; index < points.length; index++) {
    const [startX, startY] = points[index];
    const [endX, endY] = points[(index + 1) % points.length];
    const length = Math.hypot(endX - startX, endY - startY);
    distance = Math.min(distance, ((endX - startX) * (centroid - startY) - (endY - startY) * (centroid - startX)) / length);
  }
  assert.ok(Math.abs(distance - expected) < 1e-9);
});

test('a bridge on two towers stands', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0), cell(0, 1)], z0: 0, z1: 75 },
    { id: 2, rects: [cell(2, 0), cell(2, 1)], z0: 0, z1: 75 },
    { id: 3, rects: [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1)], z0: 75, z1: 100 },
  ];
  const result = checkStability(bodies);
  assert.equal(result.status, 'pass');
  const loads = result.interfaces.filter((contact) => contact.upper === 3);
  assert.equal(loads.length, 2);
  assert.ok(Math.abs(loads[0].force - loads[1].force) < 1e-6);
});

test('a module with nothing under it has no load path', () => {
  const bodies = [
    { id: 1, rects: [cell(0, 0)], z0: 0, z1: 25 },
    { id: 2, rects: [cell(3, 0)], z0: 50, z1: 75 },
    { id: 3, rects: [cell(3, 0)], z0: 75, z1: 100 },
  ];
  const result = checkStability(bodies);
  assert.equal(result.status, 'fail');
  assert.equal(result.modules.get(2).reason, 'No load path to the plinth');
  assert.equal(result.modules.get(3).status, 'fail');
  assert.equal(result.modules.get(1).status, 'pass');
});

test('a heavy beam can hold down a tippy support, found by the global solve', () => {
  const bodies = [
    { id: 1, rects: [[100, 0, 120, 25]], z0: 0, z1: 25 },
    { id: 2, rects: [[0, 0, 50, 25]], z0: 0, z1: 50 },
    { id: 3, rects: [[100, 0, 150, 25]], z0: 25, z1: 50 },
    { id: 4, rects: [[0, 0, 150, 25]], z0: 50, z1: 75 },
  ];
  const alone = checkStability(bodies.slice(0, 3), { margin: 0 });
  assert.equal(alone.modules.get(3).status, 'fail');
  const result = checkStability(bodies, { margin: 0 });
  assert.equal(result.status, 'pass');
  assert.equal(result.method, 'global');
  const onTippy = result.interfaces.find((contact) => contact.upper === 4 && contact.lower === 3);
  const weight = 50 * 25 * 25;
  assert.ok(onTippy.force * (120 - onTippy.x) >= 5 * weight - 1e-3);
});

test('a light beam cannot hold down the same tippy support', () => {
  const bodies = [
    { id: 1, rects: [[100, 0, 120, 25]], z0: 0, z1: 25 },
    { id: 2, rects: [[0, 0, 50, 25]], z0: 0, z1: 50 },
    { id: 3, rects: [[100, 0, 150, 25]], z0: 25, z1: 50, density: 40 },
    { id: 4, rects: [[0, 0, 150, 25]], z0: 50, z1: 75 },
  ];
  assert.equal(checkStability(bodies, { margin: 0 }).status, 'fail');
});
