import { EXPOSURE_REACH_CELLS } from '../config.js';
import { SIDES, instanceCells, moduleAt, structureHash, worldFromModules, worldHeight } from './grid.js';
import { FAMILIES, sideType } from './catalog.js';

export const FACE_TOP = 4; // face direction after the four sides
export const FACE_BOTTOM = 5; // face direction under a cell
const FACE_STEPS = [...SIDES.map(([stepX, stepY]) => [stepX, stepY, 0]), [0, 0, 1], [0, 0, -1]];

// Category keys used for clusters
export const CLUSTER_KEYS = {
  family: (instance) => instance.family,
  group: (instance) => FAMILIES[instance.family].group,
  theme: (instance) => FAMILIES[instance.family].theme,
};

// Free cells in front of a face, up to the limit
function reachFrom(world, cellX, cellY, level, step) {
  let free = 0;
  while (free < EXPOSURE_REACH_CELLS) {
    const nextLevel = level + step[2] * (free + 1);
    if (nextLevel < 0 || moduleAt(world, cellX + step[0] * (free + 1), cellY + step[1] * (free + 1), nextLevel)) break;
    free++;
  }
  return free;
}

function skyAbove(world, cellX, cellY, level, top) {
  for (let above = level + 1; above < top; above++) {
    if (moduleAt(world, cellX, cellY, above)) return false;
  }
  return true;
}

// Connected groups of touching modules with one key
function clusterBy(modules, neighbours, keyOf) {
  const seen = new Set();
  const clusters = [];
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  for (const start of modules) {
    if (seen.has(start.id)) continue;
    const key = keyOf(start);
    const members = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift();
      members.push(id);
      const near = neighbours.get(id);
      for (const other of [...near.side, ...near.above, ...near.below]) {
        if (!seen.has(other) && keyOf(byId.get(other)) === key) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    members.sort((idA, idB) => idA - idB);
    clusters.push({ key, modules: members, cells: members.reduce((sum, id) => sum + instanceCells(byId.get(id)).length, 0) });
  }
  return clusters.sort((clusterA, clusterB) => clusterB.modules.length - clusterA.modules.length || clusterA.modules[0] - clusterB.modules[0]);
}

// Adjacency, clusters and open faces of a module list
export function analyze(modules) {
  const world = worldFromModules(modules);
  const top = worldHeight(world);
  const neighbours = new Map(modules.map((instance) => [instance.id, { side: new Set(), above: new Set(), below: new Set() }]));
  const shared = new Map();
  const counts = new Map(modules.map((instance) => [instance.id, { open: 0, total: 0 }]));
  const faces = [];
  for (const instance of modules) {
    const near = neighbours.get(instance.id);
    const count = counts.get(instance.id);
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) {
        FACE_STEPS.forEach((step, dir) => {
          const other = moduleAt(world, cellX + step[0], cellY + step[1], level + step[2]);
          if (other && other.id === instance.id) return;
          count.total++;
          if (other) {
            const kind = dir < SIDES.length ? 'side' : 'stack';
            near[dir < SIDES.length ? 'side' : dir === FACE_TOP ? 'above' : 'below'].add(other.id);
            // A docked bridge is carried by its docks
            if (dir < SIDES.length && sideType(instance, dir) === 'plug' && sideType(other, (dir + 2) & 3) === 'dock') {
              near.below.add(other.id);
              neighbours.get(other.id).above.add(instance.id);
            }
            if (dir < SIDES.length ? instance.id < other.id : dir === FACE_TOP) {
              const edgeKey = instance.id + ':' + other.id + ':' + kind;
              shared.set(edgeKey, (shared.get(edgeKey) || 0) + 1);
            }
            return;
          }
          if (dir === FACE_BOTTOM && level === 0) return;
          count.open++;
          const face = { module: instance.id, x: cellX, y: cellY, level, dir, reach: reachFrom(world, cellX, cellY, level, step) };
          if (dir === FACE_TOP) face.sky = skyAbove(world, cellX, cellY, level, top);
          faces.push(face);
        });
      }
    }
  }
  const sorted = (ids) => [...ids].sort((idA, idB) => idA - idB);
  const perModule = {};
  for (const instance of modules) {
    const near = neighbours.get(instance.id);
    const count = counts.get(instance.id);
    perModule[instance.id] = {
      family: instance.family,
      group: FAMILIES[instance.family].group,
      theme: FAMILIES[instance.family].theme,
      side: sorted(near.side),
      above: sorted(near.above),
      below: sorted(near.below),
      openFaces: count.open,
      totalFaces: count.total,
    };
  }
  const edges = [...shared].map(([edgeKey, faceCount]) => {
    const [first, second, kind] = edgeKey.split(':');
    return { a: Number(first), b: Number(second), kind, faces: faceCount };
  });
  const clusters = {};
  for (const [name, keyOf] of Object.entries(CLUSTER_KEYS)) clusters[name] = clusterBy(modules, neighbours, keyOf);
  return { hash: structureHash(modules), modules: perModule, edges, clusters, faces };
}

// Makes a result read-only, all the way down
export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const part of Object.values(value)) freezeDeep(part);
  }
  return value;
}
