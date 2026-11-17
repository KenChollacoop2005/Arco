import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, STABILITY_MARGIN, CONNECTOR_CLEARANCE_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { toBody } from '../js/core/grid.js';
import { BULGE, BULGE_BALCONY, FLUSH, INSET, packProfiles, profileBoxes } from '../js/core/profiles.js';
import { checkStability } from '../js/core/stability.js';
import { simulate } from '../js/core/physics.js';
import { getRapier } from './helpers.js';

const GAP = CONNECTOR_CLEARANCE_MM / 2; // printed side gap per module
const EPS_MM = 0.001; // rounding slack

const part = (id, family, fp, h, x, y, z, rot = 0, extra = {}) => ({
  ...normalizeVariant({ family, fp, h, seed: 5, mask: 0, roof: false, ...extra }),
  id,
  x,
  y,
  z,
  rot,
});
const one = (kind, side = 0) => packProfiles([0, 1, 2, 3].map((index) => (index === side ? kind : FLUSH)));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= EPS_MM, `${label}: ${actual} against ${expected}`);

// A studio half off a 1x1, over the side that may carry a bulge
function halfOff(prof, seed = 5) {
  return [
    part(1, 'core', '1x1', 1, 0, 0, 0),
    part(2, 'housing', '1x1', 1, 0, 0, 1, 0, { mask: 1, prof, seed }),
    part(3, 'studio', '1x2', 1, 0, 0, 2, 0, { mask: 15 }),
  ];
}

test('the top of a bulge counts as support in the static check', () => {
  // Without a bulge the studio sits on a knife edge: a warning
  const plain = checkStability(halfOff(0).map(toBody));
  assert.equal(plain.modules.get(3).status, 'warn');
  near(plain.modules.get(3).margin, 0, 'center of mass on the cell edge');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const modules = halfOff(one(BULGE), seed);
    const bulge = profileBoxes(modules[1]).find((shape) => shape.part === 'bulge');
    const depth = bulge.max[0] - bulge.min[0];
    near(bulge.min[0], CELL_MM - GAP, 'bulge starts at the printed face');
    near(bulge.max[2], STORY_MM, 'bulge top is the module top');
    const body = toBody(modules[1]);
    assert.equal(body.tops.length, 2);
    near(body.tops[1].z, 2 * STORY_MM, 'ledge height');
    const result = checkStability(modules.map(toBody));
    assert.equal(result.modules.get(3).status, 'pass', `seed ${seed}`);
    // By hand: support now reaches the strip's inset edge, or its middle if narrow
    const reach = depth > 2 * STABILITY_MARGIN ? depth - STABILITY_MARGIN : depth / 2;
    const strict = checkStability(modules.map(toBody), { margin: STABILITY_MARGIN, skipGlobal: true });
    assert.equal(strict.modules.get(3).status, 'pass');
    near(result.modules.get(3).margin, depth - GAP, `seed ${seed} margin to the bulge edge`);
    assert.ok(reach - GAP > 0, 'the center of mass is inside the inset support');
  }
});

test('a module on a bulge alone, or beside an inset, is still refused', () => {
  // A 1x1 over the claimed cell rests on the strip only
  const strip = [...halfOff(one(BULGE)).slice(0, 2), part(3, 'studio', '1x1', 1, 1, 0, 2, 0, { mask: 15 })];
  const alone = checkStability(strip.map(toBody));
  assert.equal(alone.modules.get(3).status, 'fail');
  assert.equal(alone.modules.get(3).reason, 'Load falls outside its support');
  // An inset adds no ledge, its piers keep the cell edge
  const inset = checkStability(halfOff(one(INSET)).map(toBody));
  assert.equal(inset.modules.get(3).status, 'warn', 'an inset leaves the knife edge');
  // A bulge on another side does not help
  assert.equal(checkStability(halfOff(one(BULGE, 1)).map(toBody)).modules.get(3).status, 'warn');
  // A balcony top is below the module top, so nothing rests on it
  const balcony = toBody(halfOff(one(BULGE_BALCONY))[1]);
  assert.ok(balcony.tops.slice(2).every((ledge) => ledge.z < 2 * STORY_MM), 'balcony tops are lower ledges');
});

test('physics agrees: the studio stays on the bulge and falls without it', async () => {
  const RAPIER = await getRapier();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const modules = halfOff(one(BULGE), seed);
    assert.equal(checkStability(modules.map(toBody)).status, 'pass', `seed ${seed} static`);
    assert.deepEqual(simulate(RAPIER, modules).fallen, [], `seed ${seed} physics`);
  }
  assert.ok(simulate(RAPIER, halfOff(0)).fallen.includes(3), 'the knife edge falls');
  const strip = [...halfOff(one(BULGE)).slice(0, 2), part(3, 'studio', '1x1', 1, 1, 0, 2, 0, { mask: 15 })];
  assert.ok(simulate(RAPIER, strip).fallen.includes(3), 'a module on the strip alone falls');
});
