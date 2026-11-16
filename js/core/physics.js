import {
  CELL_MM,
  STORY_MM,
  PLINTH_DIAMETER_CELLS,
  CONNECTOR_CLEARANCE_MM,
  PHYSICS_GRAVITY,
  PHYSICS_FRICTION,
  PHYSICS_STEP_S,
  PHYSICS_SETTLE_S,
  PHYSICS_MOVE_TOL_CELLS,
} from '../config.js';
import { FOOTPRINTS, footprintSize, instancePose } from './grid.js';
import { FAMILIES } from './catalog.js';

export const POSE_SIZE = 7; // floats per pose: position, quaternion
const PLINTH_THICK_CELLS = 1; // plinth collider depth
const FLOOR_CELLS = -40; // bodies below this are retired
const DENSITY = 1; // uniform, as in the static check
const SIDE_INSET_MM = CONNECTOR_CLEARANCE_MM / 2; // printed side gap per module
const UNIT_MM = CELL_MM; // one physics length unit
const HALF_TURN_X = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // cylinder axis to z

// Footprint cells merged into rectangles, in cells
function footprintRects(footprintId) {
  const [sizeX, sizeY] = footprintSize(footprintId, 0);
  const filled = new Set(FOOTPRINTS[footprintId].map(([cellX, cellY]) => cellX + ',' + cellY));
  const rects = [];
  for (let cellY = 0; cellY < sizeY; cellY++) {
    let cellX = 0;
    while (cellX < sizeX) {
      if (!filled.has(cellX + ',' + cellY)) {
        cellX++;
        continue;
      }
      let endX = cellX;
      while (filled.has(endX + ',' + cellY)) endX++;
      const above = rects.find((rect) => rect.maxY === cellY && rect.minX === cellX && rect.maxX === endX);
      if (above) above.maxY = cellY + 1;
      else rects.push({ minX: cellX, maxX: endX, minY: cellY, maxY: cellY + 1 });
      cellX = endX;
    }
  }
  return { rects, filled };
}

// Default shapes: the cell boxes less the side gap
function cellBoxes(variant) {
  const { rects, filled } = footprintRects(variant.fp);
  const covered = (rect, cellY) => {
    for (let cellX = rect.minX; cellX < rect.maxX; cellX++) {
      if (!filled.has(cellX + ',' + cellY)) return false;
    }
    return true;
  };
  return rects.map((rect) => ({
    kind: 'box',
    min: [rect.minX * CELL_MM + SIDE_INSET_MM, rect.minY * CELL_MM + (covered(rect, rect.minY - 1) ? 0 : SIDE_INSET_MM), 0],
    max: [rect.maxX * CELL_MM - SIDE_INSET_MM, rect.maxY * CELL_MM - (covered(rect, rect.maxY) ? 0 : SIDE_INSET_MM), variant.h * STORY_MM],
  }));
}

// Collider shapes of a variant in local mm
export function variantColliders(variant) {
  const family = FAMILIES[variant.family];
  return family && family.colliders ? family.colliders(variant) : cellBoxes(variant);
}

const SHAPE_BUILDERS = {
  box(RAPIER, shape) {
    const half = [0, 1, 2].map((axis) => (shape.max[axis] - shape.min[axis]) / 2 / UNIT_MM);
    const center = [0, 1, 2].map((axis) => (shape.max[axis] + shape.min[axis]) / 2 / UNIT_MM);
    return RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(center[0], center[1], center[2]);
  },
};

// Farthest shape corner, tracked to see tilting
function farCorner(shapes) {
  const corner = [0, 0, 0];
  for (const shape of shapes) {
    for (let axis = 0; axis < 3; axis++) corner[axis] = Math.max(corner[axis], shape.max[axis] / UNIT_MM);
  }
  return corner;
}

function restPose(instance) {
  const pose = instancePose(instance);
  const half = (pose.turns * Math.PI) / 4;
  return [pose.x / UNIT_MM, pose.y / UNIT_MM, pose.z / UNIT_MM, 0, 0, Math.sin(half), Math.cos(half)];
}

// Grid poses of a module list, in cells
export function restPoses(modules) {
  const poses = new Float32Array(modules.length * POSE_SIZE);
  modules.forEach((instance, order) => poses.set(restPose(instance), order * POSE_SIZE));
  return poses;
}

function turnPoint(turn, point) {
  const { x, y, z, w } = turn;
  const crossX = y * point[2] - z * point[1];
  const crossY = z * point[0] - x * point[2];
  const crossZ = x * point[1] - y * point[0];
  return [
    point[0] + 2 * (w * crossX + y * crossZ - z * crossY),
    point[1] + 2 * (w * crossY + z * crossX - x * crossZ),
    point[2] + 2 * (w * crossZ + x * crossY - y * crossX),
  ];
}

// Rigid bodies for a module list on the plinth
export function createPhysicsWorld(RAPIER, modules) {
  const world = new RAPIER.World({ x: 0, y: 0, z: -PHYSICS_GRAVITY });
  world.timestep = PHYSICS_STEP_S;
  const plinth = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(PLINTH_THICK_CELLS / 2, PLINTH_DIAMETER_CELLS / 2)
      .setTranslation(0, 0, -PLINTH_THICK_CELLS / 2)
      .setRotation(HALF_TURN_X)
      .setFriction(PHYSICS_FRICTION),
    plinth
  );
  const entries = modules.map((instance) => {
    const rest = restPose(instance);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(rest[0], rest[1], rest[2])
        .setRotation({ x: rest[3], y: rest[4], z: rest[5], w: rest[6] })
    );
    const shapes = variantColliders(instance);
    for (const shape of shapes) {
      world.createCollider(SHAPE_BUILDERS[shape.kind](RAPIER, shape).setFriction(PHYSICS_FRICTION).setDensity(DENSITY), body);
    }
    const corner = farCorner(shapes);
    const startCorner = turnPoint({ x: rest[3], y: rest[4], z: rest[5], w: rest[6] }, corner);
    return { id: instance.id, body, corner, rest, startCorner: startCorner.map((part, axis) => part + rest[axis]), gone: false };
  });
  let steps = 0;

  function step() {
    world.step();
    steps++;
    for (const entry of entries) {
      if (!entry.gone && entry.body.translation().z < FLOOR_CELLS) {
        entry.gone = true;
        entry.body.setEnabled(false);
      }
    }
  }

  // Seven floats per module, all zero once retired
  function poses(target = new Float32Array(entries.length * POSE_SIZE)) {
    entries.forEach((entry, order) => {
      const at = order * POSE_SIZE;
      if (entry.gone) {
        target.fill(0, at, at + POSE_SIZE);
        return;
      }
      const position = entry.body.translation();
      const turn = entry.body.rotation();
      target[at] = position.x;
      target[at + 1] = position.y;
      target[at + 2] = position.z;
      target[at + 3] = turn.x;
      target[at + 4] = turn.y;
      target[at + 5] = turn.z;
      target[at + 6] = turn.w;
    });
    return target;
  }

  // Largest move of each module from its grid pose, in cells
  function drift() {
    const moved = new Map();
    for (const entry of entries) {
      if (entry.gone) {
        moved.set(entry.id, Infinity);
        continue;
      }
      const position = entry.body.translation();
      const corner = turnPoint(entry.body.rotation(), entry.corner);
      const origin = Math.hypot(position.x - entry.rest[0], position.y - entry.rest[1], position.z - entry.rest[2]);
      const far = Math.hypot(
        corner[0] + position.x - entry.startCorner[0],
        corner[1] + position.y - entry.startCorner[1],
        corner[2] + position.z - entry.startCorner[2]
      );
      moved.set(entry.id, Math.max(origin, far));
    }
    return moved;
  }

  return {
    ids: entries.map((entry) => entry.id),
    step,
    poses,
    drift,
    fallen: () => [...drift()].filter(([, moved]) => moved > PHYSICS_MOVE_TOL_CELLS).map(([id]) => id),
    resting: () => entries.every((entry) => entry.gone || entry.body.isSleeping()),
    get steps() {
      return steps;
    },
    free: () => world.free(),
  };
}

// Runs the settle time and reports what moved
export function simulate(RAPIER, modules, seconds = PHYSICS_SETTLE_S) {
  const world = createPhysicsWorld(RAPIER, modules);
  const total = Math.round(seconds / PHYSICS_STEP_S);
  for (let count = 0; count < total && !(count > 0 && world.resting()); count++) world.step();
  const drift = world.drift();
  const result = { fallen: world.fallen(), drift, steps: world.steps, resting: world.resting() };
  world.free();
  return result;
}

// Passes pose frames to a view until stopped
export function createPoseStage(view) {
  let run = 0;
  return {
    start(ids) {
      const token = ++run;
      return (poses, settled) => {
        if (token !== run) return false;
        view.setPoses(ids, poses, settled);
        return true;
      };
    },
    stop() {
      run++;
      view.restPoses();
    },
  };
}
