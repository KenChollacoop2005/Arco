import { CELL_MM, STORY_MM, MAX_MODULES } from '../config.js';
import { columnTop, footprintCells, footprintSize, worldFromModules, worldHeight, instanceCells, instanceInZone } from './grid.js';
import { FAMILIES, isDocked, normalizeVariant } from './catalog.js';
import { checkPlacement, validateStructure, reopenSides } from './placement.js';

const UNDO_LIMIT = 100; // most steps kept for undo
const RESTS_REASON = 'Something rests on this part'; // draft UI copy
const DISABLED_REASON = 'This part is switched off for now'; // draft UI copy

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

// Lowest level where a docked bridge meets two docks
export function dockLevel(world, instance, cap = MAX_MODULES) {
  for (let level = instance.z; level <= worldHeight(world); level++) {
    if (checkPlacement(world, { ...instance, z: level }, { cap }).ok) return level;
  }
  return instance.z;
}

export const nextRot = (rot) => (rot + 1) & 3;

// Grow keeps every current module and never makes one unit
export function growOptions(choices, modules, zone = null) {
  const options = { ...choices, scale: choices.scale === 'unit' ? 'block' : choices.scale, budget: 0, budgetMin: 0, locked: modules.map((instance) => ({ ...instance })) };
  if (zone) Object.assign(options, { zone, seed: zoneSeed(choices.seed, zone) });
  return options;
}

// Roof and cap pieces Grow here may clear to build over
export const CLUTTER_FAMILIES = ['smallpump', 'pumptank', 'tank', 'raincatcher', 'solar', 'turbine', 'antenna', 'vent', 'skylight'];

// True when other sits directly on top of piece
function restsOn(other, piece) {
  if (other.z !== piece.z + piece.h) return false;
  const under = new Set(instanceCells(piece).map(([x, y]) => x + ',' + y));
  return instanceCells(other).some(([x, y]) => under.has(x + ',' + y));
}

// Base for a grow: with replace on, roof clutter inside the zone that carries nothing kept is left out
export function growBase(modules, zone, replace) {
  if (!replace || !zone) return { base: modules, removed: [] };
  const removed = new Set(modules.filter((instance) => CLUTTER_FAMILIES.includes(instance.family) && instance.z > 0 && instanceInZone(instance, zone)).map((instance) => instance.id));
  // A piece stays when anything that stays rests on it
  for (let changed = true; changed; ) {
    changed = false;
    for (const piece of modules) {
      if (!removed.has(piece.id) || !modules.some((other) => !removed.has(other.id) && restsOn(other, piece))) continue;
      removed.delete(piece.id);
      changed = true;
    }
  }
  return { base: modules.filter((instance) => !removed.has(instance.id)), removed: [...removed] };
}

// Grow here zone: a sphere of whole cells around a point in mm
export const growZone = (point, cells) => ({ center: point.slice(0, 3), radius: cells * CELL_MM });

// Seed of a Grow here press: the seed text plus the zone's cell and story
export const zoneSeed = (seed, zone) => `${seed}@${Math.floor(zone.center[0] / CELL_MM)},${Math.floor(zone.center[1] / CELL_MM)},${Math.floor(zone.center[2] / STORY_MM)}`;

// Centre of the cell and story holding a point in mm
export const zoneCenter = (point) => [(Math.floor(point[0] / CELL_MM) + 0.5) * CELL_MM, (Math.floor(point[1] / CELL_MM) + 0.5) * CELL_MM, (Math.floor(Math.max(0, point[2]) / STORY_MM) + 0.5) * STORY_MM];

export function createBuild(initial = [], { cap = MAX_MODULES, stream = null } = {}) {
  let modules = initial.slice();
  let placeCap = cap;
  let placeStream = stream;
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
    return checkPlacement(worldFromModules(modules), instance, { cap: placeCap, stream: placeStream });
  }

  return {
    get modules() {
      return modules;
    },
    // Most modules Build may place
    setCap(next) {
      placeCap = next;
    },
    // The plinth's stream, which only wheels and arches may stand on
    setStream(next) {
      placeStream = next || null;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    // Snapped, stacked candidate under a point in mm
    ghost(variant, xMm, yMm, rot) {
      const turn = rot & 3;
      const [originX, originY] = snapOrigin(xMm, yMm, variant.fp, turn);
      const world = worldFromModules(modules);
      const instance = { ...normalizeVariant(variant), x: originX, y: originY, z: restLevel(world, variant.fp, turn, originX, originY), rot: turn };
      if (isDocked(instance)) instance.z = dockLevel(world, instance, placeCap);
      if (FAMILIES[instance.family].disabled) return { instance, ok: false, reason: DISABLED_REASON };
      const result = checkPlacement(world, instance, { cap: placeCap, stream: placeStream });
      return { instance, ok: result.ok, reason: result.reason };
    },
    place(spec) {
      const instance = { ...normalizeVariant(spec), x: spec.x, y: spec.y, z: spec.z, rot: spec.rot & 3 };
      if (FAMILIES[instance.family].disabled) return { ok: false, reason: DISABLED_REASON };
      const result = check(instance);
      if (!result.ok) return { ok: false, reason: result.reason };
      instance.id = Math.max(0, ...modules.map((placed) => placed.id)) + 1;
      commit(reopenSides([...modules, instance]));
      return { ok: true, reason: '', id: instance.id };
    },
    remove(ids) {
      const next = modules.filter((instance) => !ids.includes(instance.id));
      if (next.length === modules.length) return { ok: false, reason: '' };
      if (breaksOthers(next, 0)) return { ok: false, reason: RESTS_REASON };
      commit(reopenSides(next));
      return { ok: true, reason: '' };
    },
    // Quarter turn of a placed module, in place
    rotate(id) {
      const current = modules.find((instance) => instance.id === id);
      if (!current) return { ok: false, reason: '' };
      const turned = { ...current, rot: nextRot(current.rot) };
      const rest = modules.filter((instance) => instance.id !== id);
      // Turning keeps the count, so the cap never refuses it
      const result = checkPlacement(worldFromModules(rest), { ...turned, id: 0 }, { ignoreCap: true, stream: placeStream });
      if (!result.ok) return { ok: false, reason: result.reason };
      const next = modules.map((instance) => (instance.id === id ? turned : instance));
      if (breaksOthers(next, id)) return { ok: false, reason: RESTS_REASON };
      commit(reopenSides(next));
      return { ok: true, reason: '' };
    },
    // Swap in a whole structure as one step
    replace(list) {
      commit(reopenSides(list.map((instance) => ({ ...instance }))));
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
