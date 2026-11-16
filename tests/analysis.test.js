import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPOSURE_REACH_CELLS } from '../js/config.js';
import { analyze, freezeDeep, FACE_TOP, FACE_BOTTOM, CLUSTER_KEYS } from '../js/core/analysis.js';
import { SIDES, instanceCells, moduleAt, structureHash, worldFromModules } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';

const part = (id, family, fp, h, x, y, z, rot = 0) => ({ id, family, fp, h, x, y, z, rot, seed: 1, mask: 0, roof: false });
// Two towers one cell apart, a farm pair and a far tank
const site = [
  part(1, 'core', '1x1', 2, 0, 0, 0),
  part(2, 'housing', '1x1', 2, 1, 0, 0),
  part(3, 'housing', '1x2', 1, 0, 0, 2),
  part(4, 'farm', '1x1', 1, 0, 0, 3),
  part(5, 'farm', '1x1', 1, 1, 0, 3),
  part(6, 'tank', '1x1', 1, 4, 0, 0),
];
const STEPS = [...SIDES.map(([stepX, stepY]) => [stepX, stepY, 0]), [0, 0, 1], [0, 0, -1]];

test('neighbours are listed by side, above and below', () => {
  const { modules } = analyze(site);
  assert.deepEqual([modules[1].side, modules[1].above, modules[1].below], [[2], [3], []]);
  assert.deepEqual([modules[3].side, modules[3].above, modules[3].below], [[], [4, 5], [1, 2]]);
  assert.deepEqual([modules[4].side, modules[4].above, modules[4].below], [[5], [], [3]]);
  assert.deepEqual([modules[6].side, modules[6].above, modules[6].below], [[], [], []]);
  assert.equal(modules[2].family, 'housing');
  assert.equal(modules[4].group, 'Eco');
  assert.equal(modules[6].theme, 'neutral');
});

test('edges count the shared cell faces once', () => {
  const { edges } = analyze(site);
  const find = (first, second) => edges.find((edge) => edge.a === first && edge.b === second);
  assert.deepEqual(find(1, 2), { a: 1, b: 2, kind: 'side', faces: 2 });
  assert.deepEqual(find(1, 3), { a: 1, b: 3, kind: 'stack', faces: 1 });
  assert.deepEqual(find(3, 5), { a: 3, b: 5, kind: 'stack', faces: 1 });
  assert.deepEqual(find(4, 5), { a: 4, b: 5, kind: 'side', faces: 1 });
  assert.equal(edges.length, 6);
  assert.equal(find(2, 1), undefined);
});

test('clusters join touching modules of one category', () => {
  const { clusters } = analyze(site);
  assert.deepEqual(Object.keys(clusters), Object.keys(CLUSTER_KEYS));
  assert.deepEqual(clusters.family.find((cluster) => cluster.key === 'housing'), { key: 'housing', modules: [2, 3], cells: 3 });
  assert.deepEqual(clusters.family.find((cluster) => cluster.key === 'farm'), { key: 'farm', modules: [4, 5], cells: 2 });
  assert.deepEqual(clusters.group.map((cluster) => [cluster.key, cluster.modules]), [
    ['Living', [2, 3]],
    ['Eco', [4, 5]],
    ['Structure', [1]],
    ['Roof and services', [6]],
  ]);
  assert.deepEqual(clusters.theme.map((cluster) => [cluster.key, cluster.modules]), [
    ['neutral', [1, 2, 3]],
    ['eco', [4, 5]],
    ['neutral', [6]],
  ]);
});

test('open faces carry reach and sky', () => {
  const { faces, modules } = analyze(site);
  const at = (module, level, dir) => faces.find((face) => face.module === module && face.level === level && face.dir === dir);
  assert.equal(at(1, 0, 0), undefined);
  assert.equal(at(1, 0, FACE_BOTTOM), undefined);
  assert.equal(at(1, 1, FACE_TOP), undefined);
  assert.equal(at(2, 0, 0).reach, 2);
  assert.equal(at(6, 0, 2).reach, 2);
  assert.equal(at(1, 0, 2).reach, EXPOSURE_REACH_CELLS);
  assert.deepEqual(at(4, 3, FACE_TOP), { module: 4, x: 0, y: 0, level: 3, dir: FACE_TOP, reach: EXPOSURE_REACH_CELLS, sky: true });
  assert.deepEqual(at(6, 0, FACE_TOP), { module: 6, x: 4, y: 0, level: 0, dir: FACE_TOP, reach: EXPOSURE_REACH_CELLS, sky: true });
  assert.equal(at(1, 0, 1).sky, undefined);
  assert.deepEqual([modules[1].openFaces, modules[1].totalFaces], [6, 10]);
  assert.deepEqual([modules[6].openFaces, modules[6].totalFaces], [5, 6]);
  const roofed = analyze([part(1, 'core', '1x1', 1, 0, 0, 0), part(2, 'core', '1x1', 3, 1, 0, 0), part(3, 'bridge', '1x2', 1, 0, 0, 3)]);
  const low = roofed.faces.find((face) => face.module === 1 && face.dir === FACE_TOP);
  assert.deepEqual([low.reach, low.sky], [2, false]);
});

test('a megastructure analysis matches the voxel world', () => {
  const { modules } = generate({ seed: 'habitat', scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 });
  const before = structuredClone(modules);
  const result = analyze(modules);
  assert.deepEqual(modules, before);
  assert.equal(result.hash, structureHash(modules));
  assert.deepEqual(result, analyze(modules));
  const world = worldFromModules(modules);
  let open = 0;
  for (const instance of modules) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) {
        STEPS.forEach((step, dir) => {
          const empty = !moduleAt(world, cellX + step[0], cellY + step[1], level + step[2]);
          if (empty && !(dir === FACE_BOTTOM && level === 0)) open++;
        });
      }
    }
    const entry = result.modules[instance.id];
    for (const other of entry.side) assert.ok(result.modules[other].side.includes(instance.id));
    for (const other of entry.above) assert.ok(result.modules[other].below.includes(instance.id));
    assert.ok(instance.z === 0 || entry.below.length > 0, `module ${instance.id} rests on something`);
  }
  assert.equal(result.faces.length, open);
  assert.equal(Object.values(result.modules).reduce((sum, entry) => sum + entry.openFaces, 0), open);
  for (const list of Object.values(result.clusters)) {
    assert.deepEqual(list.flatMap((cluster) => cluster.modules).sort((idA, idB) => idA - idB), modules.map((instance) => instance.id).sort((idA, idB) => idA - idB));
  }
});

test('a frozen result cannot be changed', () => {
  const result = freezeDeep(analyze(site));
  assert.throws(() => {
    'use strict';
    result.faces.push({});
  }, TypeError);
  assert.throws(() => {
    'use strict';
    result.modules[1].side[0] = 9;
  }, TypeError);
  assert.throws(() => {
    'use strict';
    result.clusters.family = [];
  }, TypeError);
  assert.ok(Object.isFrozen(result.edges[0]));
});

test('an empty plinth gives an empty result', () => {
  assert.deepEqual(analyze([]), { hash: structureHash([]), modules: {}, edges: [], clusters: { family: [], group: [], theme: [] }, faces: [] });
});
