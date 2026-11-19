import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuild, growOptions, growBase, grownIds, growZone, zoneCenter, CLUTTER_FAMILIES } from '../js/core/build.js';
import { generate } from '../js/core/generator.js';
import { worldFromModules, SIDES, instanceCells, instanceInZone } from '../js/core/grid.js';
import { CELL_MM, STORY_MM, GROW_ZONE_CELLS } from '../js/config.js';
import { validateStructure, reopenSides, outwardMask, supportsUnder } from '../js/core/placement.js';
import { OPEN_SIDE_FAMILIES, openSides, normalizeVariant } from '../js/core/catalog.js';
import { buildRecipe } from '../js/core/recipes.js';
import { groupAt } from '../js/core/kit.js';
import { runChecks } from '../js/core/checks.js';

const CHOICES = { density: 1, height: 1, daring: 1, theme: 1 };
// barbican's block is full of caps once the services planner runs, so arco stands in
const BASE_SEEDS = ['habitat', 'nakagin', 'trellick', 'arco'];
// Lookout deck: rail height above it, its thickness, contact reach
const LOOKOUT_DECK_TOP_MM = 4;
const LOOKOUT_DECK_MM = 6.5;
const LOOKOUT_TOUCH_MM = 0.1;
const byId = (modules) => new Map(modules.map((instance) => [instance.id, instance]));

// Kept as given; platforms may only refresh their open sides
function assertKept(grown, locked) {
  const after = byId(grown.modules);
  const world = worldFromModules(grown.modules);
  for (const instance of locked) {
    const kept = after.get(instance.id);
    if (!OPEN_SIDE_FAMILIES.includes(instance.family)) assert.deepEqual(kept, instance);
    else {
      assert.deepEqual({ ...kept, mask: instance.mask }, instance);
      assert.equal(kept.mask, outwardMask(world, kept), `${instance.family} ${instance.id} open sides`);
    }
  }
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

test('grow opens the sides of kept platforms beside new modules, as Build edits do', () => {
  // Seeds where Grow builds against a kept terrace or balcony
  const cases = [['nakagin', 'mega'], ['trellick', 'mega'], ['arco', 'mega'], ['golden', 'block'], ['habitat', 'mega'], ['beton', 'mega']];
  let opened = 0;
  for (const [seed, scale] of cases) {
    const base = generate({ seed, scale, ...CHOICES });
    const grown = generate(growOptions({ seed: 'grow-' + seed, scale, ...CHOICES }, base.modules));
    // Same masks as the Build path gives the grown list
    assert.deepEqual(reopenSides(grown.modules), grown.modules, `${seed} ${scale} masks`);
    const after = byId(grown.modules);
    for (const instance of base.modules.filter((entry) => OPEN_SIDE_FAMILIES.includes(entry.family))) {
      const mask = after.get(instance.id).mask;
      // Sides only open: a new neighbour never adds a rail
      assert.equal(mask & ~instance.mask, 0, `${seed} ${instance.family} ${instance.id} gained a rail`);
      if (mask !== instance.mask) opened++;
    }
    assertKept(grown, base.modules);
  }
  assert.ok(opened >= 4, `opened ${opened}`);
});

// Lookout shape for its mask: deck to the walls, a wall pier, rails toward air
function assertLookoutShape(variant, label) {
  const { ops, kit } = buildRecipe(variant);
  const open = openSides(variant);
  const middle = [kit.W / 2, kit.D / 2];
  const deckBottom = kit.H - LOOKOUT_DECK_TOP_MM - LOOKOUT_DECK_MM;
  // Local point just inside a side's cell edge, at a share along it
  const near = (side, inside, along, height) => {
    const [stepX, stepY] = SIDES[side];
    const across = [stepY !== 0 ? kit.W * along : stepX > 0 ? kit.W - inside : inside, stepX !== 0 ? kit.D * along : stepY > 0 ? kit.D - inside : inside];
    return [across[0], across[1], height];
  };
  const touch = LOOKOUT_TOUCH_MM;
  for (let side = 0; side < 4; side++) {
    if ((open >> side) & 1) {
      // Against a wall: deck and pier reach the cell edge from the floor up
      for (const height of [touch, deckBottom / 2, deckBottom + LOOKOUT_DECK_MM / 2]) {
        assert.equal(groupAt(ops, near(side, kit.inset + touch, 0.5, height)), 'concrete', `${label} side ${side} wall contact at ${height}`);
      }
      assert.equal(groupAt(ops, near(side, kit.clear / 2, 0.5, kit.H - 1)), null, `${label} side ${side} rail toward a wall`);
    } else {
      assert.equal(groupAt(ops, near(side, kit.clear + touch, 0.5, kit.H - 1)), 'steel', `${label} side ${side} no rail toward air`);
    }
  }
  // Free standing: the column stands on the floor
  if (!open) assert.equal(groupAt(ops, [middle[0], middle[1], touch]), 'concrete', `${label} column`);
}

test('lookouts stand on support, attach to walls beside the deck and rail only toward air', () => {
  // Every mask, one and two stories
  for (let h = 1; h <= 2; h++) for (let mask = 0; mask < 16; mask++) assertLookoutShape(normalizeVariant({ family: 'lookout', fp: '1x1', h, seed: 1, mask, roof: false }), `h${h} mask ${mask}`);
  // Generate and Grow: on support, mask from the walls at the deck
  let seen = 0;
  for (const seed of ['arco', 'habitat', 'barbican', 'nakagin', 'golden', 'brunswick', 'quarry', 'beton', 'lumen', 'hulme', 'trellick', 'rotunda', 'alton', 'byker', 'park', 'robin']) {
    for (const [scale, level] of [['block', 1], ['mega', 1], ['mega', 2]]) {
      const choices = { density: level, height: level, daring: level, theme: level };
      const base = generate({ seed, scale, ...choices });
      const grown = generate(growOptions({ seed: 'grow-' + seed, scale: 'mega', ...choices }, base.modules));
      for (const modules of [base.modules, grown.modules]) {
        const world = worldFromModules(modules);
        for (const instance of modules.filter((entry) => entry.family === 'lookout')) {
          seen++;
          assert.ok(supportsUnder(world, instance).every(Boolean), `${seed} ${scale} lookout ${instance.id} has nothing under it`);
          assert.equal(instance.mask, outwardMask(world, instance), `${seed} ${scale} lookout ${instance.id} mask`);
        }
      }
    }
  }
  assert.ok(seen >= 20, `lookouts seen: ${seen}`);
  // Build: sides follow neighbours at the deck, never hangs in a group
  const build = createBuild();
  const tower = { family: 'housing', fp: '1x1', h: 3, seed: 9, mask: 0, roof: false };
  const base = { family: 'housing', fp: '1x1', h: 1, seed: 9, mask: 0, roof: false };
  const lookout = (h) => ({ family: 'lookout', fp: '1x1', h, seed: 1, mask: 15, roof: false });
  assert.equal(build.place({ ...base, x: 1, y: 0, z: 0, rot: 0 }).ok, true);
  const placed = build.place({ ...lookout(1), x: 1, y: 0, z: 1, rot: 0 });
  assert.equal(build.modules.find((entry) => entry.id === placed.id).mask, 15, 'free standing lookout rails all round');
  const towerId = build.place({ ...tower, x: 0, y: 0, z: 0, rot: 0 }).id;
  assert.equal(build.modules.find((entry) => entry.id === placed.id).mask, 15 & ~4, 'opens toward the new tower');
  assert.equal(build.rotate(placed.id).ok, true);
  const turned = build.modules.find((entry) => entry.id === placed.id);
  assert.equal(turned.mask, outwardMask(worldFromModules(build.modules), turned), 'turned lookout keeps its wall side open');
  assert.equal(openSides(turned), 1 << 1, 'turned lookout opens its local +y side');
  assert.equal(build.remove([towerId]).ok, true);
  assert.equal(build.modules.find((entry) => entry.id === placed.id).mask, 15, 'rails come back when the tower goes');
  // A two story lookout beside a one story module faces air at its deck
  const low = createBuild();
  assert.equal(low.place({ ...base, x: 0, y: 0, z: 0, rot: 0 }).ok, true);
  const tall = low.place({ ...lookout(2), x: 1, y: 0, z: 0, rot: 0 });
  assert.equal(low.modules.find((entry) => entry.id === tall.id).mask, 15, 'deck above a low neighbour is railed');
  // Beside a module over a support, a lookout may not hang
  const group = createBuild();
  assert.equal(group.place({ family: 'support', fp: '1x1', h: 1, seed: 1, mask: 15, roof: false, x: 0, y: 0, z: 0, rot: 0 }).ok, true);
  assert.equal(group.place({ ...base, x: 0, y: 0, z: 1, rot: 0 }).ok, true);
  const hung = group.place({ ...lookout(1), x: 1, y: 0, z: 1, rot: 0 });
  assert.deepEqual(hung, { ok: false, reason: 'No support below' }, 'a lookout never hangs');
  assert.equal(group.place({ ...base, x: 1, y: 0, z: 1, rot: 0 }).ok, true, 'a housing may hang in the group');
  // Adopted structures get fresh sides too
  const adopted = createBuild();
  adopted.replace([{ ...base, x: 0, y: 0, z: 0, rot: 0, id: 1 }, { ...tower, x: 1, y: 0, z: 0, rot: 0, id: 2 }, { ...lookout(1), x: 0, y: 0, z: 1, rot: 0, id: 3 }]);
  assert.equal(adopted.modules.find((entry) => entry.id === 3).mask, 15 & ~1, 'adopted lookout opens toward the tower');
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

test('replace roof clutter clears only free roof pieces inside the zone, and nothing when off', () => {
  const base = generate({ seed: 'arco', scale: 'block', ...CHOICES, services: 'high' });
  const kept = (removed) => base.modules.filter((instance) => !removed.includes(instance.id));
  const restsOn = (other, piece) => other.z === piece.z + piece.h && instanceCells(other).some(([x, y]) => instanceCells(piece).some(([cellX, cellY]) => cellX === x && cellY === y));
  let cleared = 0;
  for (const piece of base.modules.filter((instance) => CLUTTER_FAMILIES.includes(instance.family))) {
    const [x, y] = instanceCells(piece)[0];
    const zone = growZone(zoneCenter([(x + 0.5) * CELL_MM, (y + 0.5) * CELL_MM, (piece.z + 0.5) * STORY_MM]), GROW_ZONE_CELLS.L);
    const off = growBase(base.modules, zone, false);
    assert.equal(off.base, base.modules, 'off leaves the build as it is');
    assert.deepEqual(off.removed, []);
    const on = growBase(base.modules, zone, true);
    const byIdBase = byId(base.modules);
    for (const id of on.removed) {
      const removed = byIdBase.get(id);
      assert.ok(CLUTTER_FAMILIES.includes(removed.family) && removed.z > 0, `${removed.family} is roof clutter`);
      assert.ok(instanceInZone(removed, zone), `${removed.family} ${id} inside the zone`);
      assert.ok(!kept(on.removed).some((other) => restsOn(other, removed)), `nothing kept rests on ${removed.family} ${id}`);
    }
    assert.equal(on.base.length + on.removed.length, base.modules.length);
    cleared += on.removed.length;
  }
  assert.ok(cleared > 0, 'some zones clear roof pieces');
});

test('a zone that would only clear roof clutter lands nothing; one that grows lands only its new modules', () => {
  const base = generate({ seed: 'arco', scale: 'block', ...CHOICES, services: 'high' });
  const clutter = base.modules.filter((instance) => CLUTTER_FAMILIES.includes(instance.family)).map((instance) => instance.id);
  const cleared = base.modules.filter((instance) => !clutter.includes(instance.id));
  assert.equal(grownIds(cleared, cleared, clutter), null, 'cleared but nothing grew: nothing lands');
  assert.deepEqual([...grownIds(base.modules, base.modules, [])], [], 'nothing cleared and nothing grew lands as before');
  // A real Grow here run with replace on, on the first zone that clears and grows
  for (const piece of base.modules.filter((instance) => clutter.includes(instance.id))) {
    const [x, y] = instanceCells(piece)[0];
    const zone = growZone(zoneCenter([(x + 0.5) * CELL_MM, (y + 0.5) * CELL_MM, (piece.z + 0.5) * STORY_MM]), GROW_ZONE_CELLS.L);
    const { base: kept, removed } = growBase(base.modules, zone, true);
    if (removed.length === 0) continue;
    const grown = generate(growOptions({ seed: 'arco', scale: 'block', ...CHOICES, services: 'high' }, kept, zone));
    const ids = grownIds(kept, grown.modules, removed);
    if (!ids || ids.size === 0) continue;
    const keptIds = new Set(kept.map((instance) => instance.id));
    assert.ok([...ids].every((id) => !keptIds.has(id)), 'only new modules are counted');
    assert.equal(grown.modules.length, kept.length + ids.size);
    return;
  }
  assert.fail('no zone cleared clutter and grew');
});
