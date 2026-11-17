import { SIDES, instanceCells, claimedCells, moduleAt, worldFromModules, worldHeight } from './grid.js';
import { sideType } from './catalog.js';

// Lowest voxel of a part, by level, then y, then x
function lowest(part) {
  const compare = (first, second) => first[2] - second[2] || first[1] - second[1] || first[0] - second[0];
  return part.voxels.reduce((best, voxel) => (compare(voxel, best) < 0 ? voxel : best));
}

// Lowest level a part fills in a sorted column
const lowIn = (column, id) => column.find((entry) => entry.id === id).level;

// Parts slide straight down, so each goes in after everything under it
export function assemblyOrder(parts) {
  const columns = new Map();
  for (const part of parts) {
    for (const [cellX, cellY, level, claim] of part.voxels) {
      const key = cellX + ',' + cellY;
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push({ level, id: part.id, claim: !!claim });
    }
  }
  const under = new Map(parts.map((part) => [part.id, new Set()]));
  const after = new Map(parts.map((part) => [part.id, new Set()]));
  for (const column of columns.values()) {
    column.sort((first, second) => first.level - second.level);
    for (let upper = 1; upper < column.length; upper++) {
      for (let lower = 0; lower < upper; lower++) {
        if (column[lower].id === column[upper].id || column[lower].level >= column[upper].level) continue;
        // Two claims share a cell in opposite halves: lower first if it can
        const facing = column[lower].claim && column[upper].claim;
        if (!facing) under.get(column[upper].id).add(column[lower].id);
        // Claims that start level have no lower one
        else if (lowIn(column, column[lower].id) < lowIn(column, column[upper].id)) after.get(column[upper].id).add(column[lower].id);
      }
    }
  }
  // Parts that must be in place first, beyond the columns
  for (const part of parts) {
    for (const id of part.after || []) {
      if (under.has(id) && id !== part.id) under.get(part.id).add(id);
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
  const ready = (part, rules) => rules.every((rule) => [...rule.get(part.id)].every((id) => placed.has(id)));
  while (waiting.length > 0 && moved) {
    let slot = waiting.findIndex((part) => ready(part, [under, after]));
    if (slot < 0) slot = waiting.findIndex((part) => ready(part, [under]));
    moved = slot >= 0;
    if (!moved) break;
    placed.add(waiting[slot].id);
    order.push(waiting[slot].id);
    waiting.splice(slot, 1);
  }
  const blocked = waiting.map((part) => ({ id: part.id, by: [...under.get(part.id)].filter((id) => !placed.has(id)) }));
  return { ok: blocked.length === 0, order, blocked };
}

// Order rules of docks: lips stop rails, bridge rails need open slots
function dockRules(modules) {
  const world = worldFromModules(modules);
  const top = worldHeight(world);
  const after = new Map(modules.map((instance) => [instance.id, new Set()]));
  for (const instance of world.modules.values()) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let side = 0; side < 4; side++) {
        const mine = sideType(instance, side);
        if (mine !== 'plug' && mine !== 'dock') continue;
        const nextX = cellX + SIDES[side][0];
        const nextY = cellY + SIDES[side][1];
        if (mine === 'plug') {
          // Dock first, bridge next, railed parts above last
          const dock = moduleAt(world, nextX, nextY, instance.z);
          if (!dock || dock.id === instance.id) continue;
          after.get(instance.id).add(dock.id);
          for (let level = dock.z + dock.h; level < top; level++) {
            const above = moduleAt(world, nextX, nextY, level);
            if (above && sideType(above, (side + 2) & 3) !== 'clear') after.get(above.id).add(instance.id);
          }
          continue;
        }
        // A rail under a lip goes in before the lip
        for (let level = 0; level < instance.z; level++) {
          const below = moduleAt(world, nextX, nextY, level);
          const facing = below ? sideType(below, (side + 2) & 3) : 'clear';
          if (facing === 'connector' || facing === 'plug') after.get(instance.id).add(below.id);
        }
      }
    }
  }
  return after;
}

export function partsFromModules(modules) {
  const rules = modules.some((instance) => instance.dock) ? dockRules(modules) : null;
  return modules.map((instance) => {
    const voxels = [];
    // Claimed cells count: balconies slide down through them
    const columns = [
      ...instanceCells(instance).map(([cellX, cellY]) => [cellX, cellY, false]),
      ...claimedCells(instance).map((claim) => [claim.x, claim.y, true]),
    ];
    for (const [cellX, cellY, claim] of columns) {
      for (let level = instance.z; level < instance.z + instance.h; level++) voxels.push([cellX, cellY, level, claim]);
    }
    return rules ? { id: instance.id, voxels, after: [...rules.get(instance.id)] } : { id: instance.id, voxels };
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
