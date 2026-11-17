import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS, WIRE_MAX_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { instanceMounts } from '../js/core/mounts.js';
import { stringContext, segmentHitsBox, pathBlocked, sagPoints, hangString, pathLength } from '../js/core/strings.js';
import { planServices } from '../js/core/services.js';

const EPS_MM = 1e-6; // rounding slack
const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };
const part = (id, family, fp, h, x, y, z, seed = 3, mask = 15) => ({ ...normalizeVariant({ family, fp, h, seed, mask, roof: false }), id, x, y, z, rot: 0 });
const portOf = (instance, type) => instanceMounts(instance).find((port) => port.type === type);

test('a segment hits a box only when it passes through it', () => {
  const shape = { min: [0, 0, 0], max: [10, 10, 10] };
  assert.ok(segmentHitsBox([-5, 5, 5], [15, 5, 5], shape));
  assert.ok(segmentHitsBox([5, 5, 5], [5, 5, 20], shape));
  assert.ok(!segmentHitsBox([-5, 5, 5], [-1, 5, 5], shape));
  assert.ok(!segmentHitsBox([-5, -5, 5], [-5, 15, 5], shape));
  // Running along a face within the clearance counts as a hit
  assert.ok(segmentHitsBox([-0.1, -5, 5], [-0.1, 15, 5], shape));
  assert.ok(!segmentHitsBox([-1, -5, 5], [-1, 15, 5], shape));
});

test('a hanging string sags lowest at mid span, keeps exact ends and counts the sag in its length', () => {
  const points = sagPoints([0, 0, 50], [60, 0, 50], 6, 10);
  assert.deepEqual(points[0], [0, 0, 50]);
  assert.deepEqual(points[10], [60, 0, 50]);
  assert.ok(Math.abs(points[5][2] - 44) < EPS_MM);
  assert.ok(points.every((point) => point[2] <= 50 + EPS_MM));
  assert.ok(pathLength(points) > 60);
  // Across the gap between two towers, then past the length limit, then into a module
  const left = part(1, 'housing', '1x1', 3, -2, 0, 0, 3, 0b0001);
  const right = part(2, 'housing', '1x1', 3, 1, 0, 0, 3, 0b0100);
  const from = portOf(left, 'power');
  const to = portOf(right, 'power');
  const context = stringContext([left, right]);
  const wire = hangString(context, 'wire', from, to, 3, WIRE_MAX_MM);
  assert.equal(wire.blocked, null);
  assert.ok(wire.length > Math.hypot(...to.position.map((value, axis) => value - from.position[axis])));
  assert.deepEqual(hangString(context, 'wire', from, to, 3, 10).blocked, { module: null, reason: 'length' });
  const block = part(3, 'core', '1x1', 4, -1, 0, 0);
  assert.equal(hangString(stringContext([left, right, block]), 'wire', from, to, 3, WIRE_MAX_MM).blocked.module, 3);
});

test('no string of a generated structure passes through a module or below the plinth', () => {
  let pipes = 0;
  let sheets = 0;
  for (const seed of ['barbican', 'habitat', 'arco']) {
    const { modules } = generate({ seed, ...MEGA });
    const context = stringContext(modules);
    const plan = planServices(modules, seed, { context });
    // Pipes follow the walls and may pass thin protrusions; tests/pipes.test.js checks them on the bodies
    for (const string of [...plan.pipes, ...plan.wires, ...plan.lines]) {
      if (string.type !== 'pipe') assert.equal(pathBlocked(context, string.points, [string.from.module, string.to.module]), null, `${seed} ${string.type} ${string.from.module} to ${string.to.module}`);
      assert.ok(string.points.every((point) => point[2] >= 0));
      pipes++;
    }
    for (const string of plan.blocked) assert.ok(string.blocked && string.blocked.reason, `${seed} blocked string has a reason`);
    const rim = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2;
    for (const sheet of plan.sheets) {
      const [lip, foot] = sheet.points;
      assert.ok(foot[2] >= 0 && foot[2] < lip[2], `${seed} sheet falls`);
      assert.ok(Math.hypot(foot[0], foot[1]) <= rim + EPS_MM, `${seed} sheet stops at the rim`);
      assert.equal(foot[2] % STORY_MM, 0);
      sheets++;
    }
    assert.deepEqual(planServices(modules, seed), plan);
  }
  assert.ok(pipes >= 20 && sheets >= 5, `pipes ${pipes}, sheets ${sheets}`);
});

test('overflow sheets never start in or fall through a module', () => {
  // Structures where sheets used to cut through bridges, shops, cores and decks
  const cases = [['barbican', 'mega', 0], ['habitat', 'mega', 2], ['arco', 'mega', 0], ['barbican', 'block', 0], ['brunswick', 'mega', 2]];
  let sheets = 0;
  for (const [seed, scale, density] of cases) {
    const { modules } = generate({ seed, scale, density });
    const context = stringContext(modules);
    const plan = planServices(modules, seed, { context });
    const members = new Map(plan.water.nodes.map((node) => [node.id, node.members]));
    for (const sheet of plan.sheets) {
      const [lip, foot] = sheet.points;
      const fall = [lip, [foot[0], foot[1], foot[2] + 1]];
      assert.equal(pathBlocked(context, fall, members.get(sheet.from)), null, `${seed} ${scale} ${density} sheet from ${sheet.from}`);
      sheets++;
    }
  }
  assert.ok(sheets >= 10, `sheets ${sheets}`);
});
