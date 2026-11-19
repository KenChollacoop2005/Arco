import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM, PHYSICS_MOVE_TOL_CELLS } from '../js/config.js';
import { POSE_SIZE, createPhysicsWorld, createPoseStage, restPoses, simulate, variantColliders } from '../js/core/physics.js';
import { FOOTPRINT_IDS, FOOTPRINTS, instanceCells } from '../js/core/grid.js';
import { FAMILIES } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { runChecks } from '../js/core/checks.js';
import { getRapier } from './helpers.js';

const INSET = CONNECTOR_CLEARANCE_MM / 2;
const part = (id, family, fp, h, x, y, z, rot = 0) => ({ id, family, fp, h, x, y, z, rot, seed: 1, mask: 0, roof: false });
const tower = [part(1, 'core', '2x2', 3, 0, 0, 0), part(2, 'housing', '2x2', 2, 0, 0, 3), part(3, 'terrace', '1x1', 1, 0, 0, 5)];
const DROP_STEPS = 600; // steps for a module to leave the plinth
const FALL_STEPS = 360; // steps for an unstable block to tip
const FRAME_EVERY = 6; // steps between pose frames
const boxVolume = (shape) => (shape.max[0] - shape.min[0]) * (shape.max[1] - shape.min[1]) * (shape.max[2] - shape.min[2]);

function turned(turn, point) {
  const [x, y, z, w] = turn;
  const cross = [y * point[2] - z * point[1], z * point[0] - x * point[2], x * point[1] - y * point[0]];
  return [
    point[0] + 2 * (w * cross[0] + y * cross[2] - z * cross[1]),
    point[1] + 2 * (w * cross[1] + z * cross[0] - x * cross[2]),
    point[2] + 2 * (w * cross[2] + x * cross[1] - y * cross[0]),
  ];
}

test('default colliders are the cell boxes less the printed side gap', () => {
  for (const fp of FOOTPRINT_IDS) {
    const shapes = variantColliders({ family: 'housing', fp, h: 2 });
    const cells = FOOTPRINTS[fp];
    assert.equal(shapes.length, fp.startsWith('L') ? 2 : 1, fp);
    for (const shape of shapes) {
      assert.equal(shape.kind, 'box');
      assert.equal(shape.min[2], 0);
      assert.equal(shape.max[2], 2 * STORY_MM);
    }
    const sizeX = Math.max(...cells.map((cell) => cell[0])) + 1;
    const sizeY = Math.max(...cells.map((cell) => cell[1])) + 1;
    assert.ok(Math.abs(Math.min(...shapes.map((shape) => shape.min[0])) - INSET) < 1e-9);
    assert.ok(Math.abs(Math.max(...shapes.map((shape) => shape.max[0])) - (sizeX * CELL_MM - INSET)) < 1e-9);
    assert.ok(Math.abs(Math.max(...shapes.map((shape) => shape.max[1])) - (sizeY * CELL_MM - INSET)) < 1e-9);
    const full = cells.length * CELL_MM * CELL_MM * 2 * STORY_MM;
    const volume = shapes.reduce((sum, shape) => sum + boxVolume(shape), 0);
    assert.ok(volume < full && volume > full * 0.97, `${fp} volume ${volume} of ${full}`);
  }
});

test('a family can supply its own collider list', () => {
  const extra = [{ kind: 'box', min: [0, 0, 0], max: [10, 10, 10] }, { kind: 'box', min: [10, 0, 0], max: [40, 10, 5] }];
  FAMILIES.balcony.colliders = (variant) => (variant.h === 1 ? extra : []);
  try {
    assert.deepEqual(variantColliders({ family: 'balcony', fp: '1x1', h: 1 }), extra);
    assert.equal(variantColliders({ family: 'housing', fp: '1x1', h: 1 }).length, 1);
  } finally {
    delete FAMILIES.balcony.colliders;
  }
});

test('rest poses put the colliders on the module cells in every rotation', () => {
  for (const fp of FOOTPRINT_IDS) {
    for (let rot = 0; rot < 4; rot++) {
      const instance = part(1, 'housing', fp, 2, -2, 1, 3, rot);
      const pose = restPoses([instance]);
      assert.equal(pose.length, POSE_SIZE);
      const covered = new Set();
      for (const shape of variantColliders(instance)) {
        const low = turned([...pose.slice(3)], shape.min.map((value) => value / CELL_MM));
        const high = turned([...pose.slice(3)], shape.max.map((value) => value / CELL_MM));
        const min = [0, 1, 2].map((axis) => Math.min(low[axis], high[axis]) + pose[axis]);
        const max = [0, 1, 2].map((axis) => Math.max(low[axis], high[axis]) + pose[axis]);
        assert.ok(Math.abs(min[2] - 3) < 1e-6 && Math.abs(max[2] - 5) < 1e-6, `${fp} rot ${rot} height`);
        for (let cellX = Math.round(min[0]); cellX < Math.round(max[0]); cellX++) {
          for (let cellY = Math.round(min[1]); cellY < Math.round(max[1]); cellY++) covered.add(cellX + ',' + cellY);
        }
      }
      assert.deepEqual([...covered].sort(), instanceCells(instance).map((cell) => cell.join(',')).sort(), `${fp} rot ${rot}`);
    }
  }
});

test('a new world starts on the rest poses', async () => {
  const RAPIER = await getRapier();
  const { modules } = generate({ seed: 'habitat', scale: 'block' });
  const world = createPhysicsWorld(RAPIER, modules);
  const start = world.poses();
  const rest = restPoses(modules);
  world.free();
  assert.deepEqual(world.ids, modules.map((instance) => instance.id));
  assert.equal(start.length, rest.length);
  for (let index = 0; index < rest.length; index++) assert.ok(Math.abs(start[index] - rest[index]) < 1e-6, `float ${index}`);
});

test('a plain tower settles and stays', async () => {
  const sim = simulate(await getRapier(), tower);
  assert.deepEqual(sim.fallen, []);
  assert.ok(sim.resting);
  for (const moved of sim.drift.values()) assert.ok(moved < PHYSICS_MOVE_TOL_CELLS / 4, `drift ${moved}`);
});

test('a slab hung off one corner tips and falls', async () => {
  const sim = simulate(await getRapier(), [part(1, 'core', '1x1', 3, 0, 0, 0), part(2, 'transfer', '2x3', 1, 0, 0, 3)]);
  assert.deepEqual(sim.fallen, [2]);
  assert.ok(sim.drift.get(1) < PHYSICS_MOVE_TOL_CELLS);
});

test('a module with nothing under it drops', async () => {
  const sim = simulate(await getRapier(), [part(1, 'core', '1x1', 2, 0, 0, 0), part(2, 'housing', '1x1', 1, 2, 0, 3)]);
  assert.deepEqual(sim.fallen, [2]);
});

test('a module that leaves the plinth is retired with a zero pose', async () => {
  const RAPIER = await getRapier();
  const world = createPhysicsWorld(RAPIER, [part(1, 'housing', '1x1', 1, 9, 9, 0)]);
  for (let count = 0; count < DROP_STEPS; count++) world.step();
  const poses = world.poses();
  const moved = world.drift().get(1);
  world.free();
  assert.deepEqual([...poses], [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(moved, Infinity);
});

// Stands in for the module view
function fakeView(modules) {
  const view = { poses: restPoses(modules), frames: 0 };
  view.setPoses = (ids, poses) => {
    view.poses = Float32Array.from(poses);
    view.frames++;
  };
  view.restPoses = () => {
    view.poses = restPoses(modules);
  };
  return view;
}

test('switching physics off restores every pose exactly', async () => {
  const RAPIER = await getRapier();
  // An unstable block where parts tip
  const { modules } = generate({ seed: 'arco', scale: 'block', density: 0, height: 1, daring: 2, theme: 0, unstable: true });
  const before = structuredClone(modules);
  const rest = restPoses(modules);
  const view = fakeView(modules);
  const stage = createPoseStage(view);
  const world = createPhysicsWorld(RAPIER, modules);
  const feed = stage.start(world.ids);
  for (let count = 0; count < FALL_STEPS; count++) {
    world.step();
    if (count % FRAME_EVERY === 0) assert.equal(feed(world.poses(), false), true);
  }
  assert.ok(world.fallen().length > 0, 'something fell');
  assert.notDeepEqual(view.poses, rest);
  stage.stop();
  assert.deepEqual(view.poses, rest);
  world.step();
  assert.equal(feed(world.poses(), false), false);
  assert.deepEqual(view.poses, rest);
  world.free();
  assert.deepEqual(modules, before);
  assert.deepEqual(restPoses(modules), rest);
});

test('a new run takes over from the one before it', () => {
  const view = fakeView(tower);
  const stage = createPoseStage(view);
  const first = stage.start([1, 2, 3]);
  const second = stage.start([1, 2, 3]);
  assert.equal(first(new Float32Array(21).fill(9), false), false);
  assert.equal(view.frames, 0);
  assert.equal(second(new Float32Array(21).fill(4), false), true);
  assert.equal(view.poses[0], 4);
  stage.stop();
  assert.deepEqual(view.poses, restPoses(tower));
});

const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const UNSTABLE_MEGA_SEEDS = ['arco', 'habitat', 'x9'];
const looseBlock = (seed) => ({ seed, scale: 'block', density: 0, height: 1, daring: 2, theme: 0, unstable: true });
const looseMega = (seed) => ({ seed, scale: 'mega', density: 1, height: 1, daring: 2, theme: 2, unstable: true });

// Ids resting on any of the given ids, at any height
function ridersOf(checks, ids) {
  const riding = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, entry] of Object.entries(checks.modules)) {
      if (!riding.has(Number(id)) && entry.stability.supports.some((lower) => riding.has(lower))) {
        riding.add(Number(id));
        grew = true;
      }
    }
  }
  return riding;
}

// Ids under a module, down to the plinth
function chainUnder(checks, id, found = new Set()) {
  for (const lower of checks.modules[id].stability.supports) {
    if (lower !== 0 && !found.has(lower)) {
      found.add(lower);
      chainUnder(checks, lower, found);
    }
  }
  return found;
}

test('structures that pass the static check stay up in physics', async () => {
  const RAPIER = await getRapier();
  for (const seed of SEEDS) {
    for (const options of [{ seed, scale: 'block' }, { seed, scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 }]) {
      const { modules } = generate(options);
      assert.equal(runChecks(modules).stability, 'pass', `${seed} ${options.scale} static`);
      assert.deepEqual(simulate(RAPIER, modules).fallen, [], `${seed} ${options.scale} physics`);
    }
  }
});

test('modules the static check fails fall, and what is left stands', async () => {
  const RAPIER = await getRapier();
  let failed = 0;
  for (const options of [...SEEDS.map(looseBlock), ...UNSTABLE_MEGA_SEEDS.map(looseMega)]) {
    const { modules } = generate(options);
    const checks = runChecks(modules);
    const statusOf = (id) => checks.modules[id].stability.status;
    const flagged = modules.filter((instance) => statusOf(instance.id) !== 'pass').map((instance) => instance.id);
    let left = modules;
    let leftChecks = checks;
    while (leftChecks.stability !== 'pass') {
      const marked = left.filter((instance) => leftChecks.modules[instance.id].stability.status !== 'pass').map((instance) => instance.id);
      const doomed = ridersOf(leftChecks, marked);
      left = left.filter((instance) => !doomed.has(instance.id));
      leftChecks = runChecks(left);
    }
    assert.ok(left.length > 0, `${options.seed} ${options.scale} something is left`);
    assert.deepEqual(simulate(RAPIER, left).fallen, [], `${options.seed} ${options.scale} rest stands`);
    for (const id of flagged.filter((flag) => statusOf(flag) === 'fail')) {
      failed++;
      const kept = new Set([id, ...chainUnder(checks, id), ...ridersOf(checks, [id])]);
      const alone = modules.filter((instance) => kept.has(instance.id));
      assert.ok(simulate(RAPIER, alone).fallen.includes(id), `${options.seed} ${options.scale} module ${id} falls`);
    }
  }
  assert.ok(failed >= 10, `static failures in the set: ${failed}`);
});
