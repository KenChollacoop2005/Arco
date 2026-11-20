import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, CAMERA_ELEVATION_DEG } from '../js/config.js';
import { createBuild } from '../js/core/build.js';
import { generate, openingOptions } from '../js/core/generator.js';
import { generatePuzzle, layoutModules } from '../js/core/puzzle.js';
import { instanceCells, worldFromModules, columnTop, worldHeight, variantKey } from '../js/core/grid.js';
import { FAMILIES } from '../js/core/catalog.js';
import { streamFrom } from '../js/core/stream.js';

const SANDBOX_SEEDS = ['arco', 'balfron', 'habitat', 'quarry', 'golden', 'trellick', 'barbican', 'kowloon']; // sandbox structures
const SCALES = ['block', 'megastructure']; // sandbox scales swept
const PUZZLE_SEEDS = ['sweep-1', 'sweep-2', 'sweep-3']; // generated puzzles swept
const AZIMUTHS = 8; // slanted view directions tried for spans
const CAMERA_MM = 2000; // ray start distance from its target

// Footprint centre at the module's base, mm
function baseCentre(instance) {
  const cells = instanceCells(instance);
  const xs = cells.map((cell) => cell[0]);
  const ys = cells.map((cell) => cell[1]);
  return [((Math.min(...xs) + Math.max(...xs) + 1) / 2) * CELL_MM, ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * CELL_MM, instance.z * STORY_MM];
}

// Ray from a camera direction through a point
function rayThrough(point, azimuth, elevation) {
  const toward = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
  return { origin: point.map((value, axis) => value + toward[axis] * CAMERA_MM), direction: toward.map((value) => -value) };
}

const spot = (instance) => [instance.x, instance.y, instance.z, instance.rot & 3];

// Removes every module and puts it back through Build's rules; returns every refusal
function sweep(modules, stream, { variantOf = null, rules = null } = {}) {
  const problems = [];
  for (const instance of modules) {
    const rest = modules.filter((other) => other !== instance);
    const fresh = () => {
      const build = createBuild(rest, { cap: Infinity, stream });
      if (rules) build.setRules(rules);
      return build;
    };
    const { id, x, y, z, rot, ...own } = instance;
    const variant = (variantOf && variantOf(instance)) || own;
    const label = `${instance.family} ${instance.fp} at ${spot(instance).join(',')}`;
    const placed = fresh().place({ ...variant, x, y, z, rot });
    if (!placed.ok) {
      problems.push(`${label}: place refused, ${placed.reason}`);
      continue;
    }
    const world = worldFromModules(rest);
    const top = worldHeight(world);
    // Only a spot with nothing over it can be reached by pointing
    if (!instanceCells(instance).every(([cellX, cellY]) => columnTop(world, cellX, cellY, top) <= z)) continue;
    const centre = baseCentre(instance);
    const straight = fresh().ghost(variant, centre[0], centre[1], rot);
    if (!straight.ok || spot(straight.instance).join() !== spot(instance).join()) problems.push(`${label}: ghost gives ${spot(straight.instance)} ${straight.reason}`);
    const above = fresh().ghostOnRay(variant, rayThrough(centre, 0, Math.PI / 2 - 1e-3), rot, centre[2]);
    if (!above || !above.ok || spot(above.instance).join() !== spot(instance).join()) problems.push(`${label}: ray from above gives ${above && spot(above.instance)}`);
    // Spans over gaps: a slanted view ray through the span reaches it from some side
    if (FAMILIES[instance.family].spanning || instance.dock) {
      const elevation = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
      const reached = Array.from({ length: AZIMUTHS }, (unused, index) => (index / AZIMUTHS) * Math.PI * 2).some((azimuth) => {
        const found = fresh().ghostOnRay(variant, rayThrough(centre, azimuth, elevation), rot, 0);
        return found && found.ok && spot(found.instance).join() === spot(instance).join();
      });
      if (!reached) problems.push(`${label}: no slanted ray reaches the span`);
    }
  }
  return problems;
}

test('every generated sandbox module goes back in its own spot and turn through Build', () => {
  let spans = 0;
  for (const seed of SANDBOX_SEEDS) {
    for (const scale of SCALES) {
      const result = generate({ ...openingOptions(seed), seed, scale });
      spans += result.modules.filter((instance) => FAMILIES[instance.family].spanning).length;
      assert.deepEqual(sweep(result.modules, streamFrom(result.stream)), [], `${seed} ${scale}`);
    }
  }
  assert.ok(spans > 0, 'the sweep includes bridges');
});

test('every module of generated puzzles goes back in its own spot and turn through puzzle Build', () => {
  for (const seed of PUZZLE_SEEDS) {
    const puzzle = generatePuzzle(seed);
    assert.ok(puzzle.site, `${seed} generates`);
    const variants = new Map(puzzle.tray.map((entry) => [entry.key, entry.variant]));
    const modules = layoutModules(puzzle, puzzle.par.layout);
    const problems = sweep(modules, streamFrom(puzzle.stream), { variantOf: (instance) => variants.get(variantKey(instance)), rules: { keepMasks: true, idBase: 1000 } });
    assert.deepEqual(problems, [], seed);
  }
});

test('a raised bridge over a gap is reached by pointing at it, not at the ground under it', () => {
  // Two 2-story columns two cells wide with a one-cell gap, the 2x3 bridge across at level 2
  const column = (x, id) => [0, 1].flatMap((y) => [0, 1].map((level) => ({ id: id + y * 2 + level, family: 'housing', fp: '1x1', h: 1, seed: 3, mask: 0, roof: false, x, y, z: level, rot: 0 })));
  const modules = [...column(0, 1), ...column(2, 10)];
  const variant = { family: 'bridge', fp: '2x3', h: 1, seed: 5, mask: 0, roof: false };
  const build = createBuild(modules);
  const rot = 0;
  const placed = build.place({ ...variant, x: 0, y: 0, z: 2, rot });
  assert.ok(placed.ok, placed.reason);
  const target = build.modules.find((instance) => instance.id === placed.id);
  build.undo();
  const centre = baseCentre(target);
  const elevation = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
  const ray = rayThrough(centre, 0, elevation);
  // Where the ray lands on the plinth is far from the gap
  const landing = ray.origin.map((value, axis) => value + ray.direction[axis] * (-ray.origin[2] / ray.direction[2]));
  assert.ok(Math.abs(landing[0] - centre[0]) > CELL_MM, 'the plinth point is cells away');
  const found = build.ghostOnRay(variant, ray, rot, 0);
  assert.ok(found && found.ok, found && found.reason);
  assert.deepEqual(spot(found.instance), spot(target));
});
