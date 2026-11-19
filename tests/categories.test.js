import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, FAMILY_IDS, CATEGORIES, categoryOn, normalizeVariant } from '../js/core/catalog.js';
import { GROUPS } from '../js/core/palette.js';
import { RECIPE_IDS, buildRecipe } from '../js/core/recipes.js';
import { toBody, worldFromModules, variantKey } from '../js/core/grid.js';
import { validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { checkPrintability } from '../js/core/printability.js';
import { generate, normalizeOptions, categoryList } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { variantOf } from '../js/core/collection.js';
import { AMENITY_KINDS } from '../js/core/amenities.js';
import { getSolids } from './helpers.js';
import { inShape, groupAt } from '../js/core/mounts.js';

const LISTED = {
  social: ['market', 'shop', 'hall', ...AMENITY_KINDS],
  nature: ['farm', 'garden', 'greenhouse', 'planted'],
  industrial: ['smokestack', 'chimney', 'tankfarm', 'gantry', 'cooling', 'generator', 'disposal'],
  walled: ['shacks', 'flared'],
  utilities: ['smallpump', 'pumptank', 'pumproom', 'watermain', 'powerroom', 'turbine', 'solar', 'spring', 'well', 'raincatcher', 'wheel', 'wheelup', 'runoff'],
};
const ALWAYS = ['core', 'pilotis', 'transfer', 'housing', 'walkway', 'bridge', 'stair', 'ramp', 'deck', 'support'];
const SEEDS = ['arco', 'habitat', 'barbican', 'nakagin', 'x9', 'golden', 'lumen', 'quarry'];

test('every family carries a category; the listed ones toggle, the rest are always on', () => {
  for (const id of FAMILY_IDS) assert.ok(['base', ...CATEGORIES].includes(FAMILIES[id].category), id);
  for (const [category, ids] of Object.entries(LISTED)) for (const id of ids) assert.equal(FAMILIES[id].category, category, id);
  for (const id of ALWAYS) assert.equal(FAMILIES[id].category, 'base', id);
  for (const id of ALWAYS) assert.ok(categoryOn(id, []), `${id} is on with every category off`);
});

test('amenities: a recipe, a type tag, a render-only sign and a detail of their own each', () => {
  assert.equal(AMENITY_KINDS.length, 17);
  const shapes = new Set();
  for (const kind of AMENITY_KINDS) {
    assert.ok(RECIPE_IDS.includes(kind), kind);
    assert.equal(FAMILIES[kind].amenity, kind);
    const family = FAMILIES[kind];
    const variant = normalizeVariant({ family: kind, fp: family.footprints[family.footprints.length - 1], h: family.maxStories, seed: 3, mask: 15, roof: family.roofable });
    const ops = buildRecipe(variant).ops;
    const signs = ops.filter((op) => op.group === 'signSocial');
    assert.ok(signs.length > 0, `${kind} sign`);
    assert.equal(GROUPS.signSocial[2], false, 'signs never print');
    // A detail of its own: the shapes added and cut past the plain body differ kind to kind
    shapes.add(ops.filter((op) => op.group !== 'glass').map((op) => (op.cut ? 'cut:' : '') + op.shape.kind + ':' + op.group + ':' + (op.shape.poly ? op.shape.poly.length : '')).sort().join('|'));
  }
  assert.ok(shapes.size >= 15, `distinct amenity shapes: ${shapes.size}`);
  for (const id of ['market', 'shop', 'hall']) assert.equal(FAMILIES[id].amenity, id);
});

// Sign contact: points of each sign within this of a wall or post
const SIGN_TOUCH_MM = 0.1;
const SIGN_SAMPLES = 7;

// True when a sign has a point touching the solid that holds it
function signTouches(ops, sign) {
  const holders = ops.filter((op) => op.group !== 'signSocial' && op.group !== 'glass');
  const shape = sign.shape;
  const low = shape.kind === 'box' ? shape.min : [shape.center[0] - shape.radiusLow, shape.center[1] - shape.radiusLow, shape.from];
  const high = shape.kind === 'box' ? shape.max : [shape.center[0] + shape.radiusLow, shape.center[1] + shape.radiusLow, shape.to];
  const nudges = [[0, 0, 0]];
  for (let axis = 0; axis < 3; axis++) for (const step of [-SIGN_TOUCH_MM, SIGN_TOUCH_MM]) nudges.push([0, 1, 2].map((other) => (other === axis ? step : 0)));
  for (let a = 0; a < SIGN_SAMPLES; a++) for (let b = 0; b < SIGN_SAMPLES; b++) for (let c = 0; c < SIGN_SAMPLES; c++) {
    const point = [a, b, c].map((step, axis) => low[axis] + ((step + 0.5) / SIGN_SAMPLES) * (high[axis] - low[axis]));
    if (!inShape(shape, point)) continue;
    if (nudges.some((nudge) => groupAt(holders, point.map((value, axis) => value + nudge[axis])))) return true;
  }
  return false;
}

test('amenity signs sit flush on a wall of their own module or on a post', () => {
  let signs = 0;
  const floating = [];
  for (const kind of AMENITY_KINDS) {
    const family = FAMILIES[kind];
    for (const fp of family.footprints) {
      for (let h = family.minStories; h <= family.maxStories; h++) {
        for (const seed of [1, 2, 3, 4]) {
          for (const mask of [15, 1, 2, 4, 8, 5, 10, 0]) {
            const variant = normalizeVariant({ family: kind, fp, h, seed, mask, roof: family.roofable && seed % 2 === 0 });
            const ops = buildRecipe(variant).ops;
            for (const sign of ops.filter((op) => op.group === 'signSocial')) {
              signs++;
              if (!signTouches(ops, sign)) floating.push(variantKey(variant));
            }
          }
        }
      }
    }
  }
  assert.deepEqual(floating, [], `${floating.length} of ${signs} signs float`);
  assert.ok(signs > 500, `signs checked: ${signs}`);
});

test('amenities print, with and without connectors', async () => {
  const solids = await getSolids();
  for (const kind of AMENITY_KINDS) {
    const family = FAMILIES[kind];
    for (const fp of family.footprints) {
      for (let h = family.minStories; h <= family.maxStories; h++) {
        for (const seed of [1, 2, 3]) {
          for (const roof of family.roofable ? [false, true] : [false]) {
            const variant = normalizeVariant({ family: kind, fp, h, seed, mask: seed === 1 ? 15 : 1 + (seed % 15), roof });
            for (const connectors of [false, true]) {
              const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
              const result = checkPrintability(built.solid, { pieces: built.parts });
              assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${JSON.stringify(Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass'))}`);
            }
          }
        }
      }
    }
  }
});

test('amenities are reachable from Generate and from Build', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    for (const scale of ['block', 'mega']) {
      const result = generate({ seed, scale, density: 2, height: 1, daring: 1, theme: 1 });
      for (const instance of result.modules) seen.add(instance.family);
    }
  }
  for (const kind of AMENITY_KINDS) assert.ok(seen.has(kind), `${kind} generated`);
  const build = createBuild();
  assert.ok(build.place({ family: 'clinic', fp: '1x2', h: 2, seed: 2, mask: 15, roof: false, x: 0, y: 0, z: 0, rot: 0 }).ok);
  assert.ok(build.place({ family: 'lookout', fp: '1x1', h: 1, seed: 2, mask: 15, roof: false, x: 0, y: 0, z: 2, rot: 0 }).ok);
  assert.ok(variantOf({ family: 'teahouse', fp: '1x2', h: 1, seed: 4, mask: 15 }));
});

test('categories switch families off in Generate and Grow, never in Build, and old links load', () => {
  assert.deepEqual(normalizeOptions({}).categories, CATEGORIES);
  assert.deepEqual(categoryList('nature,walled,nonsense'), ['nature', 'walled']);
  assert.deepEqual(categoryList({ social: true, industrial: false }), ['social']);
  assert.equal(normalizeOptions({ theme: 2 }).theme, 2, 'an old link keeps its theme mix');
  // All on is today's layout
  assert.equal(generate({ seed: 'arco', scale: 'mega' }).hash, generate({ seed: 'arco', scale: 'mega', categories: CATEGORIES }).hash);
  for (const off of CATEGORIES) {
    const categories = CATEGORIES.filter((name) => name !== off);
    for (const seed of ['arco', 'barbican']) {
      const result = generate({ seed, scale: 'mega', density: 2, height: 1, daring: 1, theme: 2, categories });
      for (const instance of result.modules) assert.notEqual(FAMILIES[instance.family].category, off, `${seed} ${off} off but ${instance.family} generated`);
      assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${seed} ${off} rules`);
      assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${seed} ${off} stability`);
    }
  }
  // Nothing on still builds the always-on families
  const plain = generate({ seed: 'golden', scale: 'mega', categories: [] });
  assert.ok(plain.modules.length > 50 && plain.modules.every((instance) => FAMILIES[instance.family].category === 'base'));
  // Build places a family of any category
  const build = createBuild();
  assert.ok(build.place({ family: 'smokestack', fp: '1x1', h: 2, seed: 1, mask: 15, roof: false, x: 0, y: 0, z: 0, rot: 0 }).ok);
});
