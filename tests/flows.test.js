import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { columnTop, structureHash, worldFromModules, worldHeight } from '../js/core/grid.js';
import { instancePorts } from '../js/core/ports.js';
import { analyze } from '../js/core/analysis.js';
import { generate } from '../js/core/generator.js';
import { runChecks } from '../js/core/checks.js';
import { waterNetwork, WATER_ENDS, WATER_MAX_PATHS, FALL_DROP_MM } from '../js/core/flows.js';

const EPS_MM = 1e-6; // rounding slack
const SEEDS = ['arco', 'habitat', 'nakagin', 'barbican'];
const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };

const part = (id, family, fp, h, x, y, z, rot = 0) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 0, roof: false }), id, x, y, z, rot });

// A tank on a tower, with a farm on a lower roof beside it
const terrace = () => [
  part(1, 'core', '1x1', 3, 0, 0, 0),
  part(2, 'tank', '1x1', 1, 0, 0, 3),
  part(3, 'core', '1x1', 1, 1, 0, 0),
  part(4, 'farm', '1x1', 1, 1, 0, 1),
];

test('water from a tank runs down into the farm beside it', () => {
  const { paths } = waterNetwork(terrace(), 'seed');
  const fromTank = paths.filter((path) => path.source.kind === 'tank');
  assert.equal(fromTank.length, 1);
  const [path] = fromTank;
  assert.equal(path.source.module, 2);
  assert.equal(path.end, 'crop');
  assert.deepEqual(path.sink, { module: 4, port: 0 });
  // Starts on the tank top, ends on the farm inlet
  assert.deepEqual(path.cells, [[0, 0, 4], [1, 0, 2]]);
  const inlet = instancePorts(terrace()[3]).find((port) => port.type === 'inlet');
  const last = path.points[path.points.length - 1];
  assert.ok(Math.abs(last[0] - inlet.position[0]) < EPS_MM && Math.abs(last[1] - inlet.position[1]) < EPS_MM);
  assert.ok(last[2] >= 2 * STORY_MM && last[2] < 2 * STORY_MM + 1);
  assert.deepEqual(path.segments.map((segment) => segment.kind), ['run', 'drop']);
});

test('a full sink is passed by, and the water leaves over the rim', () => {
  // Two tanks above one farm cell with one inlet
  const modules = [...terrace(), part(5, 'core', '1x1', 3, 2, 0, 0), part(6, 'tank', '1x1', 1, 2, 0, 3)];
  const { paths } = waterNetwork(modules, 'seed');
  const tanks = paths.filter((path) => path.source.kind === 'tank');
  assert.equal(tanks.length, 2);
  assert.deepEqual(tanks.map((path) => path.end).sort(), ['crop', 'fall']);
  const fall = tanks.find((path) => path.end === 'fall');
  const last = fall.points[fall.points.length - 1];
  const before = fall.points[fall.points.length - 2];
  assert.equal(last[2], -FALL_DROP_MM);
  assert.ok(Math.hypot(last[0], last[1]) > (PLINTH_DIAMETER_CELLS * CELL_MM) / 2, 'falls outside the plinth');
  assert.ok(Math.abs(before[0] - last[0]) < EPS_MM && Math.abs(before[1] - last[1]) < EPS_MM, 'straight down');
  assert.equal(fall.segments[fall.segments.length - 1].kind, 'fall');
  // A garden basin takes four
  const basin = [part(1, 'core', '1x1', 1, 0, 0, 0), part(2, 'garden', '1x1', 1, 0, 0, 1)];
  const around = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  around.forEach(([cellX, cellY], index) => {
    basin.push(part(10 + index, 'core', '1x1', 3, cellX, cellY, 0), part(20 + index, 'tank', '1x1', 1, cellX, cellY, 3));
  });
  const filled = waterNetwork(basin, 'seed').paths.filter((path) => path.source.kind === 'tank');
  assert.equal(filled.length, 4);
  assert.ok(filled.every((path) => path.end === 'basin' && path.sink.module === 2));
});

test('water with nowhere lower to go ends in a pool', () => {
  // A low roof walled in by higher towers on all four sides
  const modules = [part(1, 'core', '1x1', 2, 0, 0, 0)];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([cellX, cellY], index) => modules.push(part(2 + index, 'core', '1x1', 4, cellX, cellY, 0)));
  modules.push(part(9, 'tank', '1x1', 1, 1, 0, 4));
  const { paths } = waterNetwork(modules, 'pit');
  const tank = paths.find((path) => path.source.kind === 'tank');
  // The gentlest step from the tank is the pit, never back up
  assert.equal(tank.end, 'pool');
  assert.deepEqual(tank.cells[tank.cells.length - 1], [0, 0, 2]);
  assert.deepEqual(waterNetwork([], 'empty'), { paths: [] });
});

test('every path of a generated structure runs downhill on top of the roofs to a legal end', () => {
  let total = 0;
  const ends = new Set();
  for (const seed of SEEDS) {
    for (const options of [{ seed, scale: 'block' }, { seed, ...MEGA }]) {
      const { modules } = generate(options);
      const world = worldFromModules(modules);
      const top = worldHeight(world);
      const byId = new Map(modules.map((instance) => [instance.id, instance]));
      const { paths } = waterNetwork(modules, seed);
      assert.ok(paths.length <= WATER_MAX_PATHS);
      const used = new Map();
      for (const path of paths) {
        total++;
        ends.add(path.end);
        assert.ok(WATER_ENDS.includes(path.end), path.end);
        assert.ok(['tank', 'rain'].includes(path.source.kind));
        // On top of the column in every cell it visits
        for (const [cellX, cellY, level] of path.cells) assert.equal(level, columnTop(world, cellX, cellY, top), `${seed} cell ${cellX},${cellY}`);
        for (let index = 1; index < path.cells.length; index++) {
          const [fromX, fromY, fromLevel] = path.cells[index - 1];
          const [toX, toY, toLevel] = path.cells[index];
          assert.equal(Math.abs(toX - fromX) + Math.abs(toY - fromY), 1, `${seed} one cell per step`);
          assert.ok(toLevel <= fromLevel, `${seed} never uphill`);
        }
        for (let index = 1; index < path.points.length; index++) {
          assert.ok(path.points[index][2] <= path.points[index - 1][2] + 1, `${seed} point ${index} rises`);
        }
        assert.equal(path.segments.length, path.points.length - 1);
        for (const segment of path.segments) {
          assert.ok(['run', 'drop', 'fall'].includes(segment.kind));
          assert.ok(Math.abs(Math.hypot(segment.across[0], segment.across[1]) - 1) < EPS_MM);
        }
        const last = path.points[path.points.length - 1];
        if (path.end === 'fall') {
          assert.equal(last[2], -FALL_DROP_MM);
          assert.equal(path.sink, null);
        } else if (path.end === 'pool') {
          assert.equal(path.sink, null);
        } else {
          const port = instancePorts(byId.get(path.sink.module)).find((entry) => entry.index === path.sink.port);
          assert.ok(Math.abs(last[0] - port.position[0]) < EPS_MM && Math.abs(last[1] - port.position[1]) < EPS_MM, `${seed} ends on its port`);
          const key = path.sink.module + ':' + path.sink.port;
          used.set(key, (used.get(key) || 0) + 1);
          assert.ok(used.get(key) <= port.capacity, `${seed} port ${key} over capacity`);
          assert.notEqual(path.sink.module, path.source.module);
        }
      }
    }
  }
  assert.ok(total >= 20, `paths in the seed set: ${total}`);
  assert.ok(ends.has('fall') && ends.size >= 2, `ends seen: ${[...ends]}`);
});

test('the water network repeats for a seed and leaves the structure alone', () => {
  const { modules } = generate({ seed: 'habitat', ...MEGA });
  const before = JSON.stringify(modules);
  const hash = structureHash(modules);
  const checks = JSON.stringify(runChecks(modules));
  const first = waterNetwork(modules, 'habitat');
  assert.ok(first.paths.length > 3);
  assert.deepEqual(waterNetwork(modules, 'habitat'), first);
  assert.notDeepEqual(waterNetwork(modules, 'nakagin'), first);
  assert.equal(JSON.stringify(modules), before);
  assert.equal(structureHash(modules), hash);
  assert.equal(JSON.stringify(runChecks(modules)), checks);
  // The analysis itself carries no flow data
  assert.equal(analyze(modules).flows, undefined);
});
