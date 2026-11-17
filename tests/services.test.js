import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, normalizeVariant } from '../js/core/catalog.js';
import { toBody, variantKey, worldFromModules } from '../js/core/grid.js';
import { validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { checkPrintability } from '../js/core/printability.js';
import { RECIPE_IDS } from '../js/core/recipes.js';
import { generate } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { variantOf } from '../js/core/collection.js';
import { assemblySteps } from '../js/core/assembly.js';
import { variantMounts, MOUNT_PORTS } from '../js/core/mounts.js';
import { getSolids } from './helpers.js';

// Families added for water and power, with the ports each must have
const SERVICE_FAMILIES = {
  pumproom: ['water-in', 'water-out', 'power'],
  smallpump: ['water-in', 'water-out'],
  pumptank: ['water-in', 'water-out'],
};
const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const generated = SEEDS.flatMap((seed, index) => [
  generate({ seed, scale: 'block', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }),
  generate({ seed, scale: 'mega', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }),
]);

// Every footprint and height of a family over a few seeds
function variantsOf(id, seeds) {
  const family = FAMILIES[id];
  const list = [];
  for (const fp of family.footprints) {
    for (let h = family.minStories; h <= family.maxStories; h++) {
      for (const seed of seeds) list.push(normalizeVariant({ family: id, fp, h, seed, mask: 15, roof: false }));
    }
  }
  return list;
}

test('each service family has a catalog entry, a recipe and its ports', () => {
  for (const [id, types] of Object.entries(SERVICE_FAMILIES)) {
    assert.ok(FAMILIES[id], `${id} in the catalog`);
    assert.ok(RECIPE_IDS.includes(id), `${id} recipe`);
    assert.ok(MOUNT_PORTS[id], `${id} port rules`);
    for (const variant of variantsOf(id, [1, 2, 3])) {
      const ports = variantMounts(variant);
      for (const type of types) assert.ok(ports.some((port) => port.type === type), `${variantKey(variant)} ${type}`);
    }
  }
  assert.ok(FAMILIES.pumproom.stack && !FAMILIES.pumproom.rails && FAMILIES.pumproom.theme === 'industrial');
  assert.deepEqual(FAMILIES.pumptank.footprints, FAMILIES.tank.footprints);
  assert.ok(!FAMILIES.smallpump.stack && FAMILIES.smallpump.footprints.join() === '1x1');
  assert.ok(variantMounts(normalizeVariant({ family: 'pumproom', fp: '1x1', h: 1, seed: 1, mask: 15 })).filter((port) => port.type.startsWith('water')).length >= 6);
});

test('service families print, with and without connectors', async () => {
  const solids = await getSolids();
  for (const id of Object.keys(SERVICE_FAMILIES)) {
    for (const variant of variantsOf(id, [1, 2, 3, 4, 5])) {
      for (const connectors of [false, true]) {
        const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
        const result = checkPrintability(built.solid, { pieces: built.parts });
        const failed = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name} ${JSON.stringify(rule.value)}`);
        assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failed}`);
      }
    }
  }
});

test('service families are reachable from Generate in legal, standing structures', () => {
  const seen = new Map();
  for (const result of generated) {
    for (const instance of result.modules) seen.set(instance.family, (seen.get(instance.family) || 0) + 1);
    assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${result.seed} ${result.options.scale} rules`);
    assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${result.seed} ${result.options.scale} stability`);
    assert.ok(assemblySteps(result.modules).ok, `${result.seed} ${result.options.scale} assembly`);
  }
  for (const id of Object.keys(SERVICE_FAMILIES)) assert.ok(seen.get(id) > 0, `${id} generated`);
});

test('service families are reachable from Build and save as parts', () => {
  const build = createBuild();
  assert.ok(build.place({ family: 'core', fp: '1x1', h: 2, seed: 1, mask: 0, roof: false, x: 0, y: 0, z: 0, rot: 0 }).ok);
  const specs = [
    { family: 'pumproom', fp: '1x2', h: 2, seed: 7, mask: 15, roof: false, x: -3, y: 0, z: 0 },
    { family: 'core', fp: '1x1', h: 1, seed: 1, mask: 0, roof: false, x: -3, y: 0, z: 2 },
    { family: 'smallpump', fp: '1x1', h: 1, seed: 3, mask: 15, roof: true, x: 0, y: 0, z: 2 },
    { family: 'pumptank', fp: '2x2', h: 2, seed: 4, mask: 15, roof: true, x: 2, y: -3, z: 0 },
  ];
  for (const spec of specs) {
    const result = build.place({ ...spec, rot: 0 });
    assert.ok(result.ok, `${spec.family}: ${result.reason}`);
    const saved = variantOf(spec);
    assert.ok(saved, `${spec.family} saves`);
    assert.equal(variantKey(saved), variantKey(normalizeVariant(spec)));
  }
});
