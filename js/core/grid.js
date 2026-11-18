import { SUPPORT_FAMILIES } from './supports.js';
import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS, DOCK_LIP_MM } from '../config.js';
import { hashString } from './rng.js';
import { profileBoxes, profileClaims } from './profiles.js';
import { dockSlots, plugRails } from './docks.js';
import { isDocked } from './catalog.js';

export const FOOTPRINTS = {
  '1x1': [[0, 0]],
  '1x2': [[0, 0], [1, 0]],
  '1x3': [[0, 0], [1, 0], [2, 0]],
  '1x4': [[0, 0], [1, 0], [2, 0], [3, 0]],
  '1x5': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  '2x2': [[0, 0], [1, 0], [0, 1], [1, 1]],
  '2x3': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  L3: [[0, 0], [1, 0], [0, 1]],
  L4: [[0, 0], [1, 0], [2, 0], [0, 1]],
};

export const FOOTPRINT_IDS = Object.keys(FOOTPRINTS);

// Side order: +x, +y, -x, -y
export const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const rotatedCache = new Map();

export function footprintCells(footprintId, rotation = 0) {
  const cacheKey = footprintId + ':' + (rotation & 3);
  let cells = rotatedCache.get(cacheKey);
  if (cells) return cells;
  cells = FOOTPRINTS[footprintId].map((cell) => cell.slice());
  for (let turn = 0; turn < (rotation & 3); turn++) {
    cells = cells.map(([cellX, cellY]) => [-cellY, cellX]);
  }
  const minX = Math.min(...cells.map((cell) => cell[0]));
  const minY = Math.min(...cells.map((cell) => cell[1]));
  cells = cells.map(([cellX, cellY]) => [cellX - minX, cellY - minY]);
  rotatedCache.set(cacheKey, cells);
  return cells;
}

export function footprintSize(footprintId, rotation = 0) {
  const cells = footprintCells(footprintId, rotation);
  return [
    Math.max(...cells.map((cell) => cell[0])) + 1,
    Math.max(...cells.map((cell) => cell[1])) + 1,
  ];
}

export function instanceCells(instance) {
  return footprintCells(instance.fp, instance.rot).map(([cellX, cellY]) => [
    instance.x + cellX,
    instance.y + cellY,
  ]);
}

export function cellInPlinth(cellX, cellY) {
  const radius = PLINTH_DIAMETER_CELLS / 2;
  const farX = Math.max(Math.abs(cellX), Math.abs(cellX + 1));
  const farY = Math.max(Math.abs(cellY), Math.abs(cellY + 1));
  return farX * farX + farY * farY <= radius * radius + 1e-9;
}

export function plinthCells() {
  const radius = PLINTH_DIAMETER_CELLS / 2;
  const cells = [];
  for (let cellY = -radius; cellY < radius; cellY++) {
    for (let cellX = -radius; cellX < radius; cellX++) {
      if (cellInPlinth(cellX, cellY)) cells.push([cellX, cellY]);
    }
  }
  return cells;
}

export const voxelKey = (cellX, cellY, level) =>
  ((cellX + 64) << 20) | ((cellY + 64) << 12) | level;

export function createWorld() {
  return { modules: new Map(), voxels: new Map(), nextId: 1 };
}

export function addModule(world, instance) {
  if (!instance.id) instance.id = world.nextId++;
  else world.nextId = Math.max(world.nextId, instance.id + 1);
  world.modules.set(instance.id, instance);
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let level = instance.z; level < instance.z + instance.h; level++) {
      world.voxels.set(voxelKey(cellX, cellY, level), instance.id);
    }
  }
  return instance;
}

export function removeModule(world, instanceId) {
  const instance = world.modules.get(instanceId);
  if (!instance) return;
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let level = instance.z; level < instance.z + instance.h; level++) {
      world.voxels.delete(voxelKey(cellX, cellY, level));
    }
  }
  world.modules.delete(instanceId);
}

export function moduleAt(world, cellX, cellY, level) {
  const instanceId = world.voxels.get(voxelKey(cellX, cellY, level));
  return instanceId ? world.modules.get(instanceId) : null;
}

export function worldFromModules(modules) {
  const world = createWorld();
  for (const instance of modules) addModule(world, { ...instance });
  return world;
}

export function worldHeight(world) {
  let top = 0;
  for (const instance of world.modules.values()) {
    top = Math.max(top, instance.z + instance.h);
  }
  return top;
}

export function columnTop(world, cellX, cellY, fromLevel) {
  for (let level = fromLevel; level >= 0; level--) {
    if (world.voxels.has(voxelKey(cellX, cellY, level))) return level + 1;
  }
  return 0;
}

// Rigid block description in mm
export function toBody(instance) {
  const body = bodyBlock(instance);
  if (instance.dock) dockSurfaces(instance, body);
  if (!instance.prof) return body;
  const pose = instancePose(instance);
  // Notches, bulges and balconies as signed volumes
  body.lumps = profileBoxes(instance).map((shape) => {
    const size = [0, 1, 2].map((axis) => shape.max[axis] - shape.min[axis]);
    const center = poseApply(pose, (shape.min[0] + shape.max[0]) / 2, (shape.min[1] + shape.max[1]) / 2, 0);
    return { volume: shape.sign * size[0] * size[1] * size[2], x: center[0], y: center[1] };
  });
  return body;
}

// Local box as a world rectangle
function worldRect(pose, shape) {
  const first = poseApply(pose, shape.min[0], shape.min[1], 0);
  const second = poseApply(pose, shape.max[0], shape.max[1], 0);
  return [Math.min(first[0], second[0]), Math.min(first[1], second[1]), Math.max(first[0], second[0]), Math.max(first[1], second[1])];
}

// Lips carry, and a docked bridge rests on its rail feet only
function dockSurfaces(instance, body) {
  const pose = instancePose(instance);
  const cells = FOOTPRINTS[instance.fp];
  const level = body.z0 + DOCK_LIP_MM;
  if (isDocked(instance)) {
    body.bottoms = [{ z: level, rects: plugRails(cells, instance.dock).map((rail) => worldRect(pose, rail)) }];
    return;
  }
  const lips = dockSlots(cells, instance.dock, instance.h * STORY_MM).map((slot) => worldRect(pose, slot.lip));
  body.tops = [{ z: body.z1, rects: body.rects }, { z: level, rects: lips }];
}

function bodyBlock(instance) {
  return {
    id: instance.id,
    rects: instanceCells(instance).map(([cellX, cellY]) => [
      cellX * CELL_MM,
      cellY * CELL_MM,
      (cellX + 1) * CELL_MM,
      (cellY + 1) * CELL_MM,
    ]),
    z0: instance.z * STORY_MM,
    z1: (instance.z + instance.h) * STORY_MM,
    ...(SUPPORT_FAMILIES.includes(instance.family) ? { support: true } : {}),
  };
}

const TURN_COS_SIN = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Where a module's local mesh sits, in mm
export function instancePose(instance) {
  const [sizeX, sizeY] = footprintSize(instance.fp, 0);
  const width = sizeX * CELL_MM;
  const depth = sizeY * CELL_MM;
  const turns = instance.rot & 3;
  const shift = [[0, 0], [depth, 0], [width, depth], [0, width]][turns];
  return { turns, x: instance.x * CELL_MM + shift[0], y: instance.y * CELL_MM + shift[1], z: instance.z * STORY_MM };
}

export function poseApply(pose, localX, localY, localZ) {
  const [cos, sin] = TURN_COS_SIN[pose.turns];
  return [pose.x + localX * cos - localY * sin, pose.y + localX * sin + localY * cos, pose.z + localZ];
}

// Footprint outline corners in local mm
export function footprintOutline(footprintId) {
  const [sizeX, sizeY] = footprintSize(footprintId, 0);
  const corners =
    FOOTPRINTS[footprintId].length === sizeX * sizeY
      ? [[0, 0], [sizeX, 0], [sizeX, sizeY], [0, sizeY]]
      : [[0, 0], [sizeX, 0], [sizeX, 1], [1, 1], [1, sizeY], [0, sizeY]];
  return corners.map(([cornerX, cornerY]) => [cornerX * CELL_MM, cornerY * CELL_MM]);
}

export function variantKey(variant) {
  return [
    variant.family,
    variant.fp,
    variant.h,
    variant.seed >>> 0,
    variant.mask & 15,
    variant.roof ? 1 : 0,
  ].join(':') + (variant.prof ? ':' + variant.prof : '') + (variant.dock ? ':d' + variant.dock : '') + (variant.jb ? ':j' : '');
}

// Claimed cells; side -1 marks a corner
export function claimedCells(instance) {
  if (!instance.prof) return [];
  const claims = profileClaims(instance.prof);
  const cells = instanceCells(instance);
  const turned = (local) => (local + instance.rot) & 3;
  const reach = (cell, side) => SIDES[side][0] * cell[0] + SIDES[side][1] * cell[1];
  const edgeCells = (side) => {
    const far = Math.max(...cells.map((cell) => reach(cell, side)));
    return cells.filter((cell) => reach(cell, side) === far);
  };
  const claimed = [];
  for (let local = 0; local < 4; local++) {
    const side = turned(local);
    if (claims.sides[local]) {
      for (const [cellX, cellY] of edgeCells(side)) claimed.push({ x: cellX + SIDES[side][0], y: cellY + SIDES[side][1], side });
    }
    if (!claims.corners[local]) continue;
    const next = turned(local + 1);
    const [cornerX, cornerY] = edgeCells(side).find((cell) => edgeCells(next).includes(cell));
    claimed.push({ x: cornerX + SIDES[side][0] + SIDES[next][0], y: cornerY + SIDES[side][1] + SIDES[next][1], side: -1 });
  }
  return claimed;
}

export function structureHash(modules) {
  const lines = modules
    .map((instance) =>
      [
        instance.x,
        instance.y,
        instance.z,
        instance.rot & 3,
        variantKey(instance),
        instance.placement || '',
      ].join(',')
    )
    .sort();
  const text = lines.join('|');
  const partA = hashString(text).toString(16).padStart(8, '0');
  const partB = hashString(text.split('').reverse().join('') + lines.length)
    .toString(16)
    .padStart(8, '0');
  return partA + partB;
}
