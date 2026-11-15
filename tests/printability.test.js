import test from 'node:test';
import assert from 'node:assert/strict';
import { box, prismY } from '../js/core/kit.js';
import { variantKey } from '../js/core/grid.js';
import { checkPrintability } from '../js/core/printability.js';
import { getSolids, sampleVariants } from './helpers.js';

const add = (shape) => ({ group: 'concrete', cut: false, shape });
const cut = (shape) => ({ group: 'concrete', cut: true, shape });
const tan = (deg) => Math.tan((deg * Math.PI) / 180);

async function check(ops, options) {
  const solids = await getSolids();
  return checkPrintability(solids.buildOps(ops), options);
}

// Block with one face leaning out from vertical
const leaning = (deg) => [add(prismY([[0, 0], [20, 0], [20 + 10 * tan(deg), 10], [0, 10]], 0, 20))];
// Two posts carrying a lintel over a gap
const portal = (gap) => [add(box(0, 0, 0, 5, 10, 12)), add(box(5 + gap, 0, 0, 10 + gap, 10, 12)), add(box(0, 0, 10, 10 + gap, 10, 14))];
// Slab with an upright wall on it
const fin = (thick) => [add(box(0, 0, 0, 20, 20, 3)), add(box(0, 5, 2, 20, 5 + thick, 20))];

test('a plain block passes every rule', async () => {
  const result = await check([add(box(0, 0, 0, 25, 25, 25))]);
  assert.equal(result.status, 'pass');
  for (const rule of Object.values(result.rules)) assert.equal(rule.status, 'pass');
});

test('a 50 degree overhang fails, 45 and 40 pass', async () => {
  const steep = await check(leaning(50));
  assert.equal(steep.rules.overhang.status, 'fail');
  assert.equal(steep.status, 'fail');
  assert.ok(Math.abs(steep.rules.overhang.value - 50) < 0.1, `measured ${steep.rules.overhang.value}`);
  assert.equal((await check(leaning(45))).rules.overhang.status, 'pass');
  assert.equal((await check(leaning(40))).rules.overhang.status, 'pass');
});

test('a wall under 1.2 mm fails, 1.6 mm passes', async () => {
  const thin = await check(fin(1.0));
  assert.equal(thin.rules.wall.status, 'fail');
  assert.equal(thin.status, 'fail');
  assert.ok(Math.abs(thin.rules.wall.value - 1.0) < 0.01, `measured ${thin.rules.wall.value}`);
  assert.equal((await check(fin(1.6))).rules.wall.status, 'pass');
});

test('a footprint over 180 mm fails', async () => {
  const wide = await check([add(box(0, 0, 0, 181, 40, 10))]);
  assert.equal(wide.rules.size.status, 'fail');
  assert.equal(wide.status, 'fail');
  assert.equal((await check([add(box(0, 0, 0, 180, 40, 10))])).rules.size.status, 'pass');
});

test('a 26 mm bridge fails, an 18 mm bridge passes', async () => {
  const long = await check(portal(26));
  assert.equal(long.rules.bridge.status, 'fail');
  assert.ok(Math.abs(long.rules.bridge.value - 26) < 1.5, `measured ${long.rules.bridge.value}`);
  const short = await check(portal(18));
  assert.equal(short.rules.bridge.status, 'pass');
  assert.ok(Math.abs(short.rules.bridge.value - 18) < 1.5, `measured ${short.rules.bridge.value}`);
});

test('a chamfered ceiling passes where a flat one fails', async () => {
  const room = [add(box(0, 0, 0, 40, 40, 30))];
  const flatCeiling = await check([...room, cut(box(5, -1, 5, 35, 20, 20))]);
  assert.equal(flatCeiling.rules.bridge.status, 'fail');
  const chamfered = await check([...room, cut(prismY([[5, 5], [35, 5], [20, 20]], -1, 20))]);
  assert.equal(chamfered.rules.bridge.status, 'pass');
  assert.equal(chamfered.rules.overhang.status, 'pass');
});

test('a tiny base fails the flat base rule', async () => {
  const result = await check([add(box(0, 0, 0, 5, 5, 20))]);
  assert.equal(result.rules.base.status, 'fail');
});

test('two loose pieces fail the solid rule', async () => {
  const result = await check([add(box(0, 0, 0, 10, 10, 10)), add(box(20, 0, 0, 30, 10, 10))], { pieces: 2 });
  assert.equal(result.rules.solid.status, 'fail');
});

test('every catalog module passes printability', async () => {
  const solids = await getSolids();
  const failures = [];
  for (const variant of sampleVariants()) {
    const built = solids.buildVariant(variant, { render: false, edges: false });
    const result = checkPrintability(built.solid, { pieces: built.parts });
    if (result.status === 'pass') continue;
    const broken = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name}=${JSON.stringify(rule.value)}`);
    failures.push(`${variantKey(variant)} ${broken.join(' ')}`);
  }
  assert.deepEqual(failures, []);
});
