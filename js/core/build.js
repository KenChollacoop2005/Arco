import { CELL_MM } from '../config.js';
import { columnTop, footprintCells, footprintSize, worldFromModules, worldHeight } from './grid.js';
import { normalizeVariant } from './catalog.js';
import { checkPlacement, validateStructure } from './placement.js';

const UNDO_LIMIT = 100; // most steps kept for undo
const RESTS_REASON = 'Something rests on this part'; // draft UI copy

// Footprint origin cell that centers it on a point
export function snapOrigin(xMm, yMm, footprintId, rot) {
  const [sizeX, sizeY] = footprintSize(footprintId, rot);
  return [Math.round(xMm / CELL_MM - sizeX / 2) + 0, Math.round(yMm / CELL_MM - sizeY / 2) + 0];
}

// Lowest level where the footprint clears every column
export function restLevel(world, footprintId, rot, originX, originY) {
  const top = worldHeight(world);
  return Math.max(...footprintCells(footprintId, rot).map(([cellX, cellY]) => columnTop(world, originX + cellX, originY + cellY, top)));
}

export const nextRot = (rot) => (rot + 1) & 3;

// Grow keeps every current module and never makes one unit
export function growOptions(choices, modules) {
  return { ...choices, scale: choices.scale === 'unit' ? 'block' : choices.scale, budget: 0, budgetMin: 0, locked: modules.map((instance) => ({ ...instance })) };
}

export function createBuild(initial = []) {
  let modules = initial.slice();
  let undoStack = [];
  let redoStack = [];

  function commit(next) {
    undoStack.push(modules);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    modules = next;
  }

  const problemIds = (list) => new Set(validateStructure(worldFromModules(list)).map((problem) => problem.id));

  // True when a change breaks a module that was fine
  function breaksOthers(next, skipId) {
    const before = problemIds(modules);
    for (const id of problemIds(next)) {
      if (id !== skipId && !before.has(id)) return true;
    }
    return false;
  }

  function check(instance) {
    return checkPlacement(worldFromModules(modules), instance);
  }

  return {
    get modules() {
      return modules;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    // Snapped, stacked candidate under a point in mm
    ghost(variant, xMm, yMm, rot) {
      const turn = rot & 3;
      const [originX, originY] = snapOrigin(xMm, yMm, variant.fp, turn);
      const world = worldFromModules(modules);
      const instance = { ...normalizeVariant(variant), x: originX, y: originY, z: restLevel(world, variant.fp, turn, originX, originY), rot: turn };
      const result = checkPlacement(world, instance);
      return { instance, ok: result.ok, reason: result.reason };
    },
    place(spec) {
      const instance = { ...normalizeVariant(spec), x: spec.x, y: spec.y, z: spec.z, rot: spec.rot & 3 };
      const result = check(instance);
      if (!result.ok) return { ok: false, reason: result.reason };
      instance.id = Math.max(0, ...modules.map((placed) => placed.id)) + 1;
      commit([...modules, instance]);
      return { ok: true, reason: '', id: instance.id };
    },
    remove(ids) {
      const next = modules.filter((instance) => !ids.includes(instance.id));
      if (next.length === modules.length) return { ok: false, reason: '' };
      if (breaksOthers(next, 0)) return { ok: false, reason: RESTS_REASON };
      commit(next);
      return { ok: true, reason: '' };
    },
    // Quarter turn of a placed module, in place
    rotate(id) {
      const current = modules.find((instance) => instance.id === id);
      if (!current) return { ok: false, reason: '' };
      const turned = { ...current, rot: nextRot(current.rot) };
      const rest = modules.filter((instance) => instance.id !== id);
      const result = checkPlacement(worldFromModules(rest), { ...turned, id: 0 });
      if (!result.ok) return { ok: false, reason: result.reason };
      const next = modules.map((instance) => (instance.id === id ? turned : instance));
      if (breaksOthers(next, id)) return { ok: false, reason: RESTS_REASON };
      commit(next);
      return { ok: true, reason: '' };
    },
    // Swap in a whole structure as one step
    replace(list) {
      commit(list.map((instance) => ({ ...instance })));
    },
    clear() {
      if (modules.length === 0) return false;
      commit([]);
      return true;
    },
    undo() {
      if (undoStack.length === 0) return false;
      redoStack.push(modules);
      modules = undoStack.pop();
      return true;
    },
    redo() {
      if (redoStack.length === 0) return false;
      undoStack.push(modules);
      modules = redoStack.pop();
      return true;
    },
  };
}
