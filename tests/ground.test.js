import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDES, instanceCells, worldFromModules, moduleAt, columnTop, variantKey, cellInPlinth } from '../js/core/grid.js';
import { FAMILIES, BUTT_SIDES, END_FAMILIES, END_OPEN, END_CAP, END_STEP, endCode, isDocked, normalizeVariant, canSupport } from '../js/core/catalog.js';
import { buildRecipe } from '../js/core/recipes.js';
import { checkPrintability } from '../js/core/printability.js';
import { variantOf } from '../js/core/collection.js';
import { generate } from '../js/core/generator.js';
import { getSolids } from './helpers.js';

const SEEDS = ['arco', 'habitat', 'barbican', 'nakagin', 'x9', 'blacksburg', 'golden', 'lumen', 'trellick', 'brunswick', 'pruitt', 'kowloon'];
let built = null;
const structures = () => (built = built || SEEDS.flatMap((seed, index) => ['block', 'mega'].map((scale) => generate({ seed, scale, density: 2 - (index % 2), height: 2, daring: 1, theme: 2 }))));
const key = (x, y) => x + ',' + y;

test('buttresses, steps and ramps meet a building all along their contact side', () => {
  let counted = 0;
  for (const { modules, seed } of structures()) {
    const world = worldFromModules(modules);
    for (const instance of modules) {
      if (!['buttress', 'steps', 'ramp'].includes(instance.family)) continue;
      counted++;
      const cells = instanceCells(instance);
      const own = new Set(cells.map(([x, y]) => key(x, y)));
      const [stepX, stepY] = SIDES[(BUTT_SIDES[instance.family] + instance.rot) & 3];
      const edge = cells.filter(([x, y]) => !own.has(key(x + stepX, y + stepY)));
      assert.ok(edge.length > 0);
      for (const [x, y] of edge) {
        const other = moduleAt(world, x + stepX, y + stepY, 0);
        assert.ok(other && FAMILIES[other.family].stack, `${seed} ${instance.family} ${instance.id} faces nothing at ${x + stepX}, ${y + stepY}`);
      }
    }
  }
  assert.ok(counted >= 2, `ground pieces checked: ${counted}`);
});

test('struts stand with their head against the module whose bulge they prop', () => {
  let counted = 0;
  for (const { modules, seed } of structures()) {
    const world = worldFromModules(modules);
    for (const instance of modules) {
      if (instance.family !== 'strut') continue;
      counted++;
      const [stepX, stepY] = SIDES[(BUTT_SIDES.strut + instance.rot) & 3];
      const top = instance.z + instance.h;
      const behind = moduleAt(world, instance.x + stepX, instance.y + stepY, top);
      assert.ok(behind && behind.prof, `${seed} strut ${instance.id} props nothing`);
    }
  }
  assert.ok(counted > 0, 'struts in the set');
});

test('bridge ends: open at a wall, steps down to a roof at deck level, capped in open air', () => {
  const counts = { [END_OPEN]: 0, [END_CAP]: 0, [END_STEP]: 0 };
  for (const { modules, seed } of structures()) {
    const world = worldFromModules(modules);
    for (const instance of modules) {
      if (!END_FAMILIES.includes(instance.family)) continue;
      if (isDocked(instance)) {
        assert.equal(instance.ends, undefined, 'docked ends plug in and stay open');
        continue;
      }
      const cells = instanceCells(instance);
      const own = new Set(cells.map(([x, y]) => key(x, y)));
      for (const end of [0, 1]) {
        const [stepX, stepY] = SIDES[((end === 0 ? 2 : 0) + instance.rot) & 3];
        const next = cells.filter(([x, y]) => !own.has(key(x + stepX, y + stepY))).map(([x, y]) => [x + stepX, y + stepY]);
        const walled = next.some(([x, y]) => moduleAt(world, x, y, instance.z));
        // A roof to step onto: the top of something that carries, at deck level
        const roofed = next.every(([x, y]) => {
          const under = cellInPlinth(x, y) && instance.z > 0 && columnTop(world, x, y, instance.z) === instance.z ? moduleAt(world, x, y, instance.z - 1) : null;
          return !!under && under.z + under.h === instance.z && canSupport(under);
        });
        const code = endCode(instance, end);
        counts[code]++;
        if (walled) assert.equal(code, END_OPEN, `${seed} ${instance.id} end ${end} at a wall`);
        else if (code === END_STEP) assert.ok(roofed, `${seed} ${instance.id} end ${end} steps onto nothing`);
        else assert.equal(code, roofed ? END_STEP : END_CAP, `${seed} ${instance.id} end ${end}`);
      }
    }
  }
  assert.ok(counts[END_OPEN] > 0 && counts[END_CAP] > 0 && counts[END_STEP] > 0, JSON.stringify(counts));
});

test('end treatments are printed geometry: a wall, steps cut down, a stop or a ramp, and each prints', async () => {
  const solids = await getSolids();
  for (const family of END_FAMILIES) {
    for (const fp of ['1x3', '2x3']) {
      const plain = buildRecipe(normalizeVariant({ family, fp, h: 1, seed: 4, mask: 15 })).ops;
      for (const ends of [END_CAP | (END_STEP << 2), END_STEP | (END_CAP << 2), END_CAP | (END_CAP << 2)]) {
        const variant = normalizeVariant({ family, fp, h: 1, seed: 4, mask: 15, ends });
        assert.equal(variant.ends, ends);
        assert.ok(variantKey(variant).endsWith(':e' + ends));
        assert.deepEqual(variantOf({ ...variant }).ends, ends, 'the collection keeps the ends');
        const ops = buildRecipe(variant).ops;
        assert.ok(ops.length > plain.length, `${family} ${fp} ends ${ends} add geometry`);
        for (const connectors of [false, true]) {
          const result = solids.buildVariant(variant, { connectors, render: false, edges: false });
          const check = checkPrintability(result.solid, { pieces: result.parts });
          assert.equal(check.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${JSON.stringify(Object.entries(check.rules).filter(([, rule]) => rule.status !== 'pass'))}`);
        }
      }
    }
  }
  // A docked bridge keeps no end codes
  assert.equal(normalizeVariant({ family: 'walkway', fp: '1x3', h: 1, seed: 4, mask: 15, dock: 5, ends: 5 }).ends, undefined);
});
