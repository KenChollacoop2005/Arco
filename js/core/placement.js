import { MAX_MODULES } from '../config.js';
import {
  SIDES,
  claimedCells,
  cellInPlinth,
  footprintSize,
  instanceCells,
  moduleAt,
  worldHeight,
} from './grid.js';
import { FAMILIES, canSupport, defaultPlacement, sideType } from './catalog.js';

export const placementOf = (instance) => instance.placement || defaultPlacement(instance);

// Per cell: 'plinth', a module, or null
export function supportsUnder(world, instance) {
  return instanceCells(instance).map(([cellX, cellY]) => {
    if (instance.z === 0) return 'plinth';
    const below = moduleAt(world, cellX, cellY, instance.z - 1);
    return below && below.id !== instance.id && below.z + below.h === instance.z ? below : null;
  });
}

export function hasTwoSupports(world, instance) {
  const cells = instanceCells(instance);
  const supports = supportsUnder(world, instance);
  const [sizeX, sizeY] = footprintSize(instance.fp, instance.rot);
  const axes = sizeX === sizeY ? [0, 1] : [sizeX > sizeY ? 0 : 1];
  return axes.some((axis) => {
    const low = Math.min(...cells.map((cell) => cell[axis]));
    const high = Math.max(...cells.map((cell) => cell[axis]));
    if (low === high) return false;
    const lowHeld = cells.some((cell, index) => cell[axis] === low && supports[index]);
    const highHeld = cells.some((cell, index) => cell[axis] === high && supports[index]);
    return lowHeld && highHeld;
  });
}

function sideConflict(world, instance) {
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let side = 0; side < 4; side++) {
      const mine = sideType(instance, side);
      if (mine === 'clear') continue;
      for (let level = instance.z; level < instance.z + instance.h; level++) {
        const other = moduleAt(world, cellX + SIDES[side][0], cellY + SIDES[side][1], level);
        if (!other || other.id === instance.id) continue;
        const theirs = sideType(other, (side + 2) & 3);
        if (theirs !== 'clear' && theirs !== mine) return other;
      }
    }
  }
  return null;
}

function anythingAbove(world, instance, top) {
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let level = instance.z + instance.h; level < top; level++) {
      const other = moduleAt(world, cellX, cellY, level);
      if (other && other.id !== instance.id) return true;
    }
  }
  return false;
}

function capBelow(world, instance) {
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let level = instance.z - 1; level >= 0; level--) {
      const other = moduleAt(world, cellX, cellY, level);
      if (other && other.id !== instance.id && placementOf(other) === 'Cap') return true;
    }
  }
  return false;
}

const RESERVED_REASON = 'That space is kept clear for a balcony or bulge'; // draft UI copy
const AROUND = [...SIDES, [1, 1], [-1, 1], [-1, -1], [1, -1]]; // cells a claim can come from

// Claims other modules hold on one voxel
function claimsOn(world, cellX, cellY, level, skipId) {
  const found = [];
  const seen = new Set();
  for (const [stepX, stepY] of AROUND) {
    const other = moduleAt(world, cellX + stepX, cellY + stepY, level);
    if (!other || !other.prof || other.id === skipId || seen.has(other.id)) continue;
    seen.add(other.id);
    for (const claim of claimedCells(other)) {
      if (claim.x === cellX && claim.y === cellY) found.push(claim);
    }
  }
  return found;
}

// Reason a protrusion is illegal, or ''
function reserveConflict(world, instance, cells) {
  for (let level = instance.z; level < instance.z + instance.h; level++) {
    for (const [cellX, cellY] of cells) {
      if (claimsOn(world, cellX, cellY, level, instance.id).length > 0) return RESERVED_REASON;
    }
    for (const claim of claimedCells(instance)) {
      if (!cellInPlinth(claim.x, claim.y)) return 'A balcony or bulge would pass the plinth edge';
      const other = moduleAt(world, claim.x, claim.y, level);
      if (other && other.id !== instance.id) return 'A balcony or bulge needs open air on that side';
      const clash = claimsOn(world, claim.x, claim.y, level, instance.id).some(
        (theirs) => claim.side >= 0 && theirs.side >= 0 && theirs.side !== ((claim.side + 2) & 3)
      );
      if (clash) return 'Two balconies or bulges would meet there';
    }
  }
  return '';
}

// Reason text is draft UI copy
export function checkPlacement(world, instance, options = {}) {
  const family = FAMILIES[instance.family];
  const cells = instanceCells(instance);
  const exists = world.modules.has(instance.id);
  if (!exists && !options.ignoreCap && world.modules.size >= MAX_MODULES) {
    return { ok: false, reason: 'Module limit reached' };
  }
  for (const [cellX, cellY] of cells) {
    if (!cellInPlinth(cellX, cellY)) return { ok: false, reason: 'Off the plinth' };
    for (let level = instance.z; level < instance.z + instance.h; level++) {
      const other = moduleAt(world, cellX, cellY, level);
      if (other && other.id !== instance.id) return { ok: false, reason: 'Overlaps another module' };
    }
  }
  const reserve = reserveConflict(world, instance, cells);
  if (reserve) return { ok: false, reason: reserve };
  if (family.ground && instance.z !== 0) return { ok: false, reason: 'Ground level only' };
  const supports = supportsUnder(world, instance);
  if (!supports.some(Boolean)) return { ok: false, reason: 'No support below' };
  for (const support of supports) {
    if (support && support !== 'plinth' && !canSupport(support)) {
      return { ok: false, reason: 'Nothing can sit on that part' };
    }
  }
  if (placementOf(instance) === 'Spanning' && !hasTwoSupports(world, instance)) {
    return { ok: false, reason: 'Needs support at both ends' };
  }
  const top = worldHeight(world) + 1;
  if (placementOf(instance) === 'Cap' && anythingAbove(world, instance, top)) {
    return { ok: false, reason: 'Top level only' };
  }
  if (capBelow(world, instance)) return { ok: false, reason: 'Nothing can sit over a cap' };
  if (!canSupport(instance)) {
    for (const [cellX, cellY] of cells) {
      const above = moduleAt(world, cellX, cellY, instance.z + instance.h);
      if (above && above.id !== instance.id && above.z === instance.z + instance.h) {
        return { ok: false, reason: 'Something rests on this spot' };
      }
    }
  }
  if (sideConflict(world, instance)) return { ok: false, reason: 'Facade meets a connector face' };
  return { ok: true, reason: '' };
}

// Rule violations across a finished structure
export function validateStructure(world) {
  const problems = [];
  for (const instance of world.modules.values()) {
    const result = checkPlacement(world, instance);
    if (!result.ok) problems.push({ id: instance.id, reason: result.reason });
  }
  return problems;
}
