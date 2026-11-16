import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuild, growOptions } from '../js/core/build.js';
import { generate } from '../js/core/generator.js';
import { worldFromModules } from '../js/core/grid.js';
import { validateStructure } from '../js/core/placement.js';
import { runChecks } from '../js/core/checks.js';

const CHOICES = { density: 1, height: 1, daring: 1, theme: 1 };
const BASE_SEEDS = ['habitat', 'nakagin', 'trellick', 'barbican'];
const byId = (modules) => new Map(modules.map((instance) => [instance.id, instance]));

function assertKept(grown, locked) {
  const after = byId(grown.modules);
  for (const instance of locked) assert.deepEqual(after.get(instance.id), instance);
  assert.equal(after.size, grown.modules.length);
}

test('grow keeps every module of a generated block and adds to it', () => {
  for (const seed of BASE_SEEDS) {
    const base = generate({ seed, scale: 'block', ...CHOICES });
    const grown = generate(growOptions({ seed: 'grow-' + seed, scale: 'block', ...CHOICES }, base.modules));
    assertKept(grown, base.modules);
    assert.ok(grown.modules.length > base.modules.length, `${seed}: ${base.modules.length} to ${grown.modules.length}`);
  }
});

test('grow keeps every module of a generated megastructure', () => {
  const base = generate({ seed: 'habitat', scale: 'mega', ...CHOICES, density: 0, height: 0 });
  const grown = generate(growOptions({ seed: 'more', scale: 'mega', ...CHOICES }, base.modules));
  assertKept(grown, base.modules);
  assert.ok(grown.modules.length > base.modules.length);
});

test('grow is reproducible from its seed and build', () => {
  const base = generate({ seed: 'habitat', scale: 'block', ...CHOICES });
  const options = growOptions({ seed: 'again', scale: 'block', ...CHOICES }, base.modules);
  const first = generate(options);
  const second = generate(growOptions({ seed: 'again', scale: 'block', ...CHOICES }, base.modules));
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.modules, second.modules);
  const other = generate(growOptions({ seed: 'different', scale: 'block', ...CHOICES }, base.modules));
  assert.notEqual(other.hash, first.hash);
  assertKept(other, base.modules);
});

test('grow does not change the modules it was given', () => {
  const base = generate({ seed: 'nakagin', scale: 'block', ...CHOICES });
  const before = JSON.stringify(base.modules);
  generate(growOptions({ seed: 'safe', scale: 'mega', ...CHOICES }, base.modules));
  assert.equal(JSON.stringify(base.modules), before);
});

test('grown structures follow the placement rules and stand', () => {
  for (const seed of BASE_SEEDS) {
    const base = generate({ seed, scale: 'block', ...CHOICES });
    const grown = generate(growOptions({ seed: 'rules-' + seed, scale: 'block', ...CHOICES }, base.modules));
    assert.deepEqual(validateStructure(worldFromModules(grown.modules)), []);
    const checks = runChecks(grown.modules);
    assert.equal(checks.placement, 'pass');
    assert.equal(checks.stability, 'pass');
  }
});

test('grow extends a hand built start where it stands', () => {
  const build = createBuild();
  const core = { family: 'core', fp: '1x1', h: 3, seed: 5, mask: 0, roof: false };
  const housing = { family: 'housing', fp: '2x2', h: 2, seed: 8, mask: 0, roof: false };
  assert.equal(build.place({ ...core, x: 3, y: 2, z: 0, rot: 0 }).ok, true);
  assert.equal(build.place({ ...housing, x: 1, y: 2, z: 0, rot: 1 }).ok, true);
  const grown = generate(growOptions({ seed: 'by-hand', scale: 'block', ...CHOICES }, build.modules));
  assertKept(grown, build.modules);
  assert.ok(grown.modules.length > build.modules.length + 3);
  assert.deepEqual(validateStructure(worldFromModules(grown.modules)), []);
  const added = grown.modules.filter((instance) => instance.id > 2);
  const nearX = added.reduce((sum, instance) => sum + instance.x, 0) / added.length;
  const nearY = added.reduce((sum, instance) => sum + instance.y, 0) / added.length;
  assert.ok(Math.hypot(nearX - 2, nearY - 2) < 3, `added modules center on ${nearX.toFixed(1)}, ${nearY.toFixed(1)}`);
});

test('grow from an empty plinth is a plain generator run', () => {
  const plain = generate({ seed: 'empty', scale: 'block', ...CHOICES });
  const grown = generate(growOptions({ seed: 'empty', scale: 'block', ...CHOICES }, []));
  assert.equal(grown.hash, plain.hash);
});

test('grow never makes a single unit', () => {
  const options = growOptions({ seed: 'one', scale: 'unit', ...CHOICES }, []);
  assert.equal(options.scale, 'block');
  assert.ok(generate(options).modules.length > 1);
});

test('a grown result can be grown again and undone', () => {
  const build = createBuild();
  const base = generate({ seed: 'trellick', scale: 'block', ...CHOICES });
  build.replace(base.modules);
  const first = generate(growOptions({ seed: 'round-1', scale: 'block', ...CHOICES }, build.modules));
  build.replace(first.modules);
  const second = generate(growOptions({ seed: 'round-2', scale: 'block', ...CHOICES }, build.modules));
  assertKept(second, first.modules);
  build.replace(second.modules);
  build.undo();
  assert.deepEqual(build.modules, first.modules);
  build.undo();
  assert.deepEqual(build.modules, base.modules);
});
