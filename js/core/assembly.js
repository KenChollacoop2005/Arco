import { instanceCells, claimedCells } from './grid.js';

// Lowest voxel of a part, by level, then y, then x
function lowest(part) {
  const compare = (first, second) => first[2] - second[2] || first[1] - second[1] || first[0] - second[0];
  return part.voxels.reduce((best, voxel) => (compare(voxel, best) < 0 ? voxel : best));
}

// Parts slide straight down, so each goes in after everything under it
export function assemblyOrder(parts) {
  const columns = new Map();
  for (const part of parts) {
    for (const [cellX, cellY, level] of part.voxels) {
      const key = cellX + ',' + cellY;
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push({ level, id: part.id });
    }
  }
  const under = new Map(parts.map((part) => [part.id, new Set()]));
  for (const column of columns.values()) {
    column.sort((first, second) => first.level - second.level);
    for (let upper = 1; upper < column.length; upper++) {
      for (let lower = 0; lower < upper; lower++) {
        if (column[lower].id !== column[upper].id && column[lower].level < column[upper].level) {
          under.get(column[upper].id).add(column[lower].id);
        }
      }
    }
  }
  const rank = new Map(parts.map((part) => [part.id, lowest(part)]));
  const waiting = parts.slice().sort((first, second) => {
    const lowA = rank.get(first.id);
    const lowB = rank.get(second.id);
    return lowA[2] - lowB[2] || lowA[1] - lowB[1] || lowA[0] - lowB[0] || (first.id < second.id ? -1 : 1);
  });
  const placed = new Set();
  const order = [];
  let moved = true;
  while (waiting.length > 0 && moved) {
    moved = false;
    for (let slot = 0; slot < waiting.length; slot++) {
      const part = waiting[slot];
      if ([...under.get(part.id)].every((id) => placed.has(id))) {
        placed.add(part.id);
        order.push(part.id);
        waiting.splice(slot, 1);
        moved = true;
        break;
      }
    }
  }
  const blocked = waiting.map((part) => ({ id: part.id, by: [...under.get(part.id)].filter((id) => !placed.has(id)) }));
  return { ok: blocked.length === 0, order, blocked };
}

export function partsFromModules(modules) {
  return modules.map((instance) => {
    const voxels = [];
    // Claimed cells count: balconies slide down through them
    const columns = [...instanceCells(instance), ...claimedCells(instance).map((claim) => [claim.x, claim.y])];
    for (const [cellX, cellY] of columns) {
      for (let level = instance.z; level < instance.z + instance.h; level++) voxels.push([cellX, cellY, level]);
    }
    return { id: instance.id, voxels };
  });
}

// Build manual steps for a structure
export function assemblySteps(modules) {
  const result = assemblyOrder(partsFromModules(modules));
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  return {
    ok: result.ok,
    steps: result.order.map((id) => ({ id, level: byId.get(id).z })),
    blocked: result.blocked,
  };
}
