import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MODULES, OPENING_UNIT_MIN, OPENING_UNIT_MAX } from '../js/config.js';
import { generate, openingOptions } from '../js/core/generator.js';
import { cellInPlinth, instanceCells, moduleAt, toBody, worldFromModules, worldHeight } from '../js/core/grid.js';
import { FAMILIES, sideType } from '../js/core/catalog.js';
import { hasTwoSupports, placementOf, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';

const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const LEVELS = [0, 1, 2];

function runs(scale) {
  const list = [];
  SEEDS.forEach((seed, index) => {
    list.push(generate({ seed, scale, density: LEVELS[index % 3], height: LEVELS[(index + 1) % 3], daring: LEVELS[(index + 2) % 3], theme: LEVELS[index % 3] }));
  });
  return list;
}

const blocks = runs('block');
const megas = runs('mega');
const openings = SEEDS.map((seed) => generate(openingOptions(seed)));
const everything = [...blocks, ...megas, ...openings];

test('the same seed and choices give an identical structure', () => {
  for (const scale of ['unit', 'block', 'mega']) {
    const first = generate({ seed: 'habitat', scale, density: 2, height: 1, daring: 2, theme: 2 });
    const second = generate({ seed: 'habitat', scale, density: 2, height: 1, daring: 2, theme: 2 });
    assert.equal(first.hash, second.hash);
    assert.deepEqual(first.modules, second.modules);
  }
  assert.equal(generate(openingOptions('k7m2qp')).hash, generate(openingOptions('k7m2qp')).hash);
});

test('a different seed or choice changes the structure', () => {
  const base = generate({ seed: 'habitat', scale: 'block' });
  assert.notEqual(base.hash, generate({ seed: 'habitat2', scale: 'block' }).hash);
  assert.notEqual(base.hash, generate({ seed: 'habitat', scale: 'block', density: 2 }).hash);
});

test('unit scale is one module standing on the plinth', () => {
  for (const seed of SEEDS) {
    const { modules } = generate({ seed, scale: 'unit' });
    assert.equal(modules.length, 1, seed);
    assert.equal(modules[0].z, 0);
    assert.deepEqual(validateStructure(worldFromModules(modules)), []);
  }
});

test('block scale stays within 6 by 6 cells', () => {
  for (const { modules, seed } of blocks) {
    assert.ok(modules.length >= 6, `${seed} has ${modules.length} modules`);
    const cells = modules.flatMap(instanceCells);
    const spanX = Math.max(...cells.map((cell) => cell[0])) - Math.min(...cells.map((cell) => cell[0])) + 1;
    const spanY = Math.max(...cells.map((cell) => cell[1])) - Math.min(...cells.map((cell) => cell[1])) + 1;
    assert.ok(spanX <= 6 && spanY <= 6, `${seed} spans ${spanX} by ${spanY}`);
  }
});

test('megastructures are larger and carry bridges', () => {
  megas.forEach(({ modules, seed }, index) => {
    assert.ok(modules.length > blocks[index].modules.length, `${seed} mega ${modules.length} vs block ${blocks[index].modules.length}`);
    assert.ok(modules.some((instance) => instance.family === 'bridge'), `${seed} has a bridge`);
  });
});

test('the opening structure has 12 to 30 modules', () => {
  for (const { modules, seed } of openings) {
    assert.ok(modules.length >= OPENING_UNIT_MIN && modules.length <= OPENING_UNIT_MAX, `${seed} has ${modules.length}`);
  }
});

test('no structure passes the module cap', () => {
  for (const { modules } of everything) assert.ok(modules.length <= MAX_MODULES);
});

test('every module is a valid catalog variant', () => {
  for (const { modules } of everything) {
    for (const instance of modules) {
      const family = FAMILIES[instance.family];
      assert.ok(family, instance.family);
      const docked = !!instance.dock && family.dockFootprints.includes(instance.fp);
      assert.ok(family.footprints.includes(instance.fp) || docked, `${instance.family} ${instance.fp}`);
      assert.ok(instance.h >= family.minStories && instance.h <= family.maxStories, `${instance.family} h ${instance.h}`);
    }
  }
});

test('placement rules hold in every generated structure', () => {
  for (const { modules, seed } of everything) {
    const world = worldFromModules(modules);
    assert.deepEqual(validateStructure(world), [], seed);
    const top = worldHeight(world);
    for (const instance of world.modules.values()) {
      for (const [cellX, cellY] of instanceCells(instance)) {
        assert.ok(cellInPlinth(cellX, cellY), `${seed} ${instance.family} past the plinth edge`);
        if (placementOf(instance) !== 'Cap') continue;
        for (let level = instance.z + instance.h; level <= top; level++) {
          assert.equal(moduleAt(world, cellX, cellY, level), null, `${seed} module above cap ${instance.family}`);
        }
      }
      if (placementOf(instance) === 'Spanning') assert.ok(hasTwoSupports(world, instance), `${seed} ${instance.family} span`);
      if (FAMILIES[instance.family].ground) assert.equal(instance.z, 0, `${seed} ${instance.family} off the ground`);
    }
  }
});

test('facades never face a railed neighbour', () => {
  const steps = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const { modules, seed } of everything) {
    const world = worldFromModules(modules);
    for (const instance of world.modules.values()) {
      if (!FAMILIES[instance.family].rails) continue;
      for (let side = 0; side < 4; side++) {
        if (sideType(instance, side) !== 'facade') continue;
        for (const [cellX, cellY] of instanceCells(instance)) {
          for (let level = instance.z; level < instance.z + instance.h; level++) {
            const other = moduleAt(world, cellX + steps[side][0], cellY + steps[side][1], level);
            assert.ok(!other || other.id === instance.id || !FAMILIES[other.family].rails, `${seed} facade against ${other && other.family}`);
          }
        }
      }
    }
  }
});

test('generated structures pass the stability check', () => {
  for (const { modules, seed } of everything) {
    const result = checkStability(modules.map(toBody));
    assert.equal(result.status, 'pass', seed);
  }
});

test('a high theme mix brings both industrial and eco parts', () => {
  for (const seed of SEEDS) {
    const { modules } = generate({ seed, scale: 'mega', theme: 2 });
    const themes = new Set(modules.map((instance) => FAMILIES[instance.family].theme));
    assert.ok(themes.has('industrial') && themes.has('eco'), seed);
  }
});

test('allow unstable keeps placement rules', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const { modules } = generate({ seed, scale: 'block', daring: 2, unstable: true });
    assert.deepEqual(validateStructure(worldFromModules(modules)), [], seed);
  }
});
