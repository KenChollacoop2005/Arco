import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, STABILITY_MARGIN } from '../js/config.js';
import { runChecks, marginStatus } from '../js/core/checks.js';
import { centerMarks, loadPaths, connectorMarks, edgeLines } from '../js/core/drafting.js';
import { generate } from '../js/core/generator.js';

const part = (id, family, fp, h, x, y, z, extra = {}) => ({ id, family, fp, h, seed: 1, mask: 0, roof: false, x, y, z, rot: 0, ...extra });
const tower = [part(1, 'housing', '1x1', 2, 0, 0, 0), part(2, 'housing', '1x1', 1, 0, 0, 2)];

test('margin status follows the safety margin', () => {
  assert.equal(marginStatus(-0.1), 'fail');
  assert.equal(marginStatus(STABILITY_MARGIN / 2), 'warn');
  assert.equal(marginStatus(STABILITY_MARGIN + 1), 'pass');
});

test('a generated structure passes with an entry per module', () => {
  const { modules } = generate({ seed: 'habitat', scale: 'block' });
  const checks = runChecks(modules);
  assert.equal(checks.stability, 'pass');
  assert.equal(checks.placement, 'pass');
  assert.equal(Object.keys(checks.modules).length, modules.length);
  for (const instance of modules) {
    const entry = checks.modules[instance.id];
    assert.equal(entry.stability.status, 'pass');
    assert.equal(entry.placement.status, 'pass');
    assert.ok(checks.interfaces.some((contact) => contact.upper === instance.id), `module ${instance.id} has a load path`);
  }
  assert.ok(checks.critical && checks.critical.margin >= STABILITY_MARGIN);
  assert.doesNotThrow(() => structuredClone(checks));
});

test('a stacked tower reports centers of mass and contact points by hand', () => {
  const checks = runChecks(tower);
  assert.deepEqual(checks.modules[1].com, [CELL_MM / 2, CELL_MM / 2, STORY_MM]);
  assert.deepEqual(checks.modules[2].com, [CELL_MM / 2, CELL_MM / 2, 2.5 * STORY_MM]);
  const top = checks.interfaces.find((contact) => contact.upper === 2);
  assert.equal(top.lower, 1);
  assert.ok(Math.abs(top.at[0] - 12.5) < 1e-6 && Math.abs(top.at[1] - 12.5) < 1e-6 && top.at[2] === 2 * STORY_MM);
  assert.ok(Math.abs(top.margin - 12.5) < 1e-6, `margin ${top.margin}`);
  const base = checks.interfaces.find((contact) => contact.upper === 1);
  assert.equal(base.lower, 0);
  assert.ok(Math.abs(base.force - 3 * top.force) < 1e-6 * base.force);
});

test('a half supported slab fails stability and is the critical joint', () => {
  const checks = runChecks([...tower, part(3, 'housing', '2x3', 1, -2, 0, 3)]);
  assert.equal(checks.stability, 'fail');
  assert.equal(checks.modules[3].stability.status, 'fail');
  assert.ok(checks.modules[3].stability.margin < 0);
  assert.equal(checks.critical.upper, 3);
  assert.equal(checks.critical.status, 'fail');
});

test('floating and off plinth modules are flagged', () => {
  const floating = runChecks([...tower, part(3, 'housing', '1x1', 1, 3, 3, 2)]);
  assert.equal(floating.placement, 'fail');
  assert.equal(floating.modules[3].placement.status, 'fail');
  assert.equal(floating.modules[3].stability.status, 'fail');
  assert.equal(floating.modules[3].stability.margin, null);
  const off = runChecks([part(1, 'housing', '1x1', 1, 6, 0, 0)]);
  assert.equal(off.modules[1].placement.status, 'fail');
});

test('drawing marks: three per center, load paths down to the plinth', () => {
  const checks = runChecks(tower);
  const centers = centerMarks(checks);
  assert.equal(centers.statuses.length, 6);
  assert.equal(centers.positions.length, 6 * 6);
  const paths = loadPaths(checks);
  assert.equal(paths.statuses.length, 5);
  assert.ok(paths.statuses.every((status) => status === 'pass'));
  const lowest = Math.min(...paths.positions.filter((unused, index) => index % 3 === 2));
  assert.ok(lowest >= 0 && lowest < 1);
});

test('connector marks: rails on connector sides, sockets on stackable tops', () => {
  const open = connectorMarks([part(1, 'housing', '1x1', 1, 0, 0, 0)]);
  assert.equal(open.statuses.length, 4 + 8);
  const closed = connectorMarks([part(1, 'housing', '1x1', 1, 0, 0, 0, { mask: 15 })]);
  assert.equal(closed.statuses.length, 4);
  const roofed = connectorMarks([part(1, 'housing', '1x1', 1, 0, 0, 0, { mask: 15, roof: true })]);
  assert.equal(roofed.statuses.length, 0);
  const cap = connectorMarks([part(1, 'tank', '1x1', 1, 0, 0, 0, { mask: 15, roof: true })]);
  assert.equal(cap.statuses.length, 0);
  const long = connectorMarks([part(1, 'housing', '1x2', 1, 0, 0, 0, { mask: 0b1010 })]);
  assert.equal(long.statuses.length, 8 + 4);
});

test('edge lines follow the module pose', () => {
  const instance = part(1, 'housing', '1x2', 1, 2, 1, 3, { rot: 1 });
  const lines = edgeLines([instance], () => new Float32Array([0, 0, 0, 50, 0, 0]));
  assert.deepEqual(lines, [75, 25, 75, 75, 75, 75]);
});
