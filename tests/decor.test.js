import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM } from '../js/config.js';
import { DECOR_TYPES, decorItems } from '../js/core/decor.js';
import { analyze, freezeDeep, FACE_TOP } from '../js/core/analysis.js';
import { canSupport } from '../js/core/catalog.js';
import { instanceCells, structureHash } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';
import { runChecks } from '../js/core/checks.js';

const MEGA = { seed: 'barbican', scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };

test('decor is the same for the same structure and seed', () => {
  const { modules } = generate(MEGA);
  const analysis = freezeDeep(analyze(modules));
  const first = decorItems(analysis, modules, 'habitat');
  assert.ok(first.length > 0);
  assert.deepEqual(decorItems(analysis, modules, 'habitat'), first);
  assert.notDeepEqual(decorItems(analysis, modules, 'nakagin'), first);
});

test('decor sits on open flat roofs, inside its cell', () => {
  const { modules } = generate(MEGA);
  const analysis = analyze(modules);
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const open = analysis.faces.filter((face) => face.dir === FACE_TOP && face.sky && canSupport(byId.get(face.module)));
  const items = decorItems(analysis, modules, 'habitat');
  for (const item of items) {
    const instance = byId.get(item.module);
    assert.ok(DECOR_TYPES[item.type], item.type);
    assert.ok(canSupport(instance));
    assert.equal(item.position[2], (instance.z + instance.h) * STORY_MM);
    const cell = [Math.floor(item.position[0] / CELL_MM), Math.floor(item.position[1] / CELL_MM)];
    assert.ok(instanceCells(instance).some((own) => own[0] === cell[0] && own[1] === cell[1]));
    assert.ok(open.some((face) => face.module === item.module && face.x === cell[0] && face.y === cell[1]));
    const reach = Math.hypot(...DECOR_TYPES[item.type].size.slice(0, 2)) / 2;
    for (const axis of [0, 1]) {
      const inCell = item.position[axis] - cell[axis] * CELL_MM;
      assert.ok(inCell >= reach && inCell <= CELL_MM - reach, `axis ${axis} at ${inCell}`);
    }
    assert.ok(item.turn >= 0 && item.turn < Math.PI / 2);
  }
  assert.ok(items.length < open.length);
});

test('decor leaves the structure and its checks alone', () => {
  const { modules } = generate({ seed: 'arco', scale: 'block' });
  const before = structuredClone(modules);
  const checks = runChecks(modules);
  const items = decorItems(analyze(modules), modules, 'arco');
  assert.deepEqual(modules, before);
  assert.equal(structureHash(modules), structureHash(before));
  assert.deepEqual(runChecks(modules), checks);
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['module', 'position', 'turn', 'type']);
});

test('nothing to place gives no decor', () => {
  assert.deepEqual(decorItems(analyze([]), [], 'arco'), []);
  const cap = [{ id: 1, family: 'antenna', fp: '1x1', h: 2, x: 0, y: 0, z: 0, rot: 0, seed: 1, mask: 15, roof: true }];
  assert.deepEqual(decorItems(analyze(cap), cap, 'arco'), []);
});
