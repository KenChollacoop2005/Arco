import test from 'node:test';
import assert from 'node:assert/strict';
import { growOptions, growZone } from '../js/core/build.js';
import { generate } from '../js/core/generator.js';
import { worldFromModules, instanceInZone, instanceCells } from '../js/core/grid.js';
import { validateStructure, outwardMask } from '../js/core/placement.js';
import { OPEN_SIDE_FAMILIES } from '../js/core/catalog.js';
import { checkStability } from '../js/core/stability.js';
import { toBody } from '../js/core/grid.js';
import { CELL_MM, STORY_MM, GROW_ZONE_CELLS } from '../js/config.js';

const CHOICES = { density: 1, height: 1, daring: 1, theme: 1 };
const BASE_SEEDS = ['habitat', 'nakagin', 'trellick', 'arco'];

// Zone centred on the roof of the highest module, as the tool points at it
function roofZone(modules, cells) {
  const top = [...modules].sort((first, second) => second.z + second.h - (first.z + first.h) || first.id - second.id)[0];
  const [cellX, cellY] = instanceCells(top)[0];
  return growZone([(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM, (top.z + top.h) * STORY_MM], cells);
}

// Locked modules come back as given; platforms may only refresh their open sides
function assertKept(grown, locked) {
  const after = new Map(grown.map((instance) => [instance.id, instance]));
  const world = worldFromModules(grown);
  for (const instance of locked) {
    const kept = after.get(instance.id);
    assert.ok(kept, `${instance.family} ${instance.id} kept`);
    if (!OPEN_SIDE_FAMILIES.includes(instance.family)) assert.deepEqual(kept, instance);
    else {
      assert.deepEqual({ ...kept, mask: instance.mask }, instance);
      assert.equal(kept.mask, outwardMask(world, kept));
    }
  }
}

test('zone sizes are 2, 3 and 4 cells', () => {
  assert.deepEqual(GROW_ZONE_CELLS, { S: 2, M: 3, L: 4 });
  const zone = growZone([0, 0, 0], 2);
  assert.equal(zone.radius, 2 * CELL_MM);
  // A 1x1 one story module beside the centre is in, one 3 cells out is not
  assert.ok(instanceInZone({ fp: '1x1', rot: 0, x: 0, y: 0, z: 0, h: 1 }, zone));
  assert.ok(!instanceInZone({ fp: '1x1', rot: 0, x: 2, y: 0, z: 0, h: 1 }, zone));
  assert.ok(!instanceInZone({ fp: '1x1', rot: 0, x: 0, y: 0, z: 0, h: 3 }, zone));
});

test('grow here adds nothing outside the zone, keeps every locked module, and stands', () => {
  let added = 0;
  for (const seed of BASE_SEEDS) {
    for (const cells of Object.values(GROW_ZONE_CELLS)) {
      const base = generate({ seed, scale: 'block', ...CHOICES });
      const zone = roofZone(base.modules, cells);
      const grown = generate(growOptions({ seed: 'here-' + seed, scale: 'block', ...CHOICES }, base.modules, zone));
      assertKept(grown.modules, base.modules);
      const known = new Set(base.modules.map((instance) => instance.id));
      const fresh = grown.modules.filter((instance) => !known.has(instance.id));
      for (const instance of fresh) assert.ok(instanceInZone(instance, zone), `${seed} ${cells} ${instance.family} at ${instance.x},${instance.y},${instance.z}`);
      added += fresh.length;
      assert.deepEqual(validateStructure(worldFromModules(grown.modules)), [], `${seed} ${cells} rules`);
      assert.equal(checkStability(grown.modules.map(toBody)).status, 'pass', `${seed} ${cells} stability`);
    }
  }
  assert.ok(added > 0, 'some zone grows add modules');
});

test('same seed and zone give the same result; without the zone the same seed reaches outside it', () => {
  const base = generate({ seed: 'nakagin', scale: 'block', ...CHOICES });
  const zone = roofZone(base.modules, GROW_ZONE_CELLS.L);
  const first = generate(growOptions({ seed: 'same', scale: 'block', ...CHOICES }, base.modules, zone));
  const second = generate(growOptions({ seed: 'same', scale: 'block', ...CHOICES }, base.modules, zone));
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.modules, second.modules);
  // Each zone cell gets its own seed from the seed text
  assert.equal(growOptions({ seed: 'same' }, [], growZone([30, -10, 60], 2)).seed, 'same@1,-1,2');
  const known = new Set(base.modules.map((instance) => instance.id));
  const whole = generate(growOptions({ seed: 'same', scale: 'block', ...CHOICES }, base.modules));
  assert.ok(whole.modules.some((instance) => !known.has(instance.id) && !instanceInZone(instance, zone)), 'a whole grow places outside the zone');
});
