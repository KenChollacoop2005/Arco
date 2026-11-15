import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { hashString } from './rng.js';

export const FOOTPRINTS = {
  '1x1': [[0, 0]],
  '1x2': [[0, 0], [1, 0]],
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
  ].join(':');
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
