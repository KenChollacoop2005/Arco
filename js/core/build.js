import { CELL_MM, STORY_MM, MAX_MODULES } from '../config.js';
import { columnTop, footprintCells, footprintSize, worldFromModules, worldHeight, instanceCells, instanceInZone, SIDES } from './grid.js';
import { FAMILIES, isDocked, normalizeVariant } from './catalog.js';
import { checkPlacement, validateStructure, reopenSides } from './placement.js';

// Platform masks redone only beside the changed modules
function reopenNear(modules, changed, keepIds = []) {
  const near = new Set();
  for (const instance of changed) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) near.add(`${cellX},${cellY},${level}`);
    }
  }
  const beside = (instance) => instanceCells(instance).some(([cellX, cellY]) => SIDES.some(([stepX, stepY]) => near.has(`${cellX + stepX},${cellY + stepY},${instance.z + instance.h - 1}`)));
  const fresh = new Map(reopenSides(modules).map((instance) => [instance.id, instance]));
  const keep = new Set(keepIds);
  const changedIds = new Set(changed.map((instance) => instance.id));
  return modules.map((instance) => (!keep.has(instance.id) && (changedIds.has(instance.id) || beside(instance)) ? fresh.get(instance.id) : instance));
}

const UNDO_LIMIT = 100; // most steps kept for undo
const RAY_SLACK_MM = 0.5; // a level counts as visible this far under the surface hit
const RESTS_REASON = 'Something rests on this part'; // draft UI copy
const DISABLED_REASON = 'This part is switched off for now'; // draft UI copy
const LOCKED_REASON = 'This part anchors the site and stays put'; // draft UI copy

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

// Ids a grow added; null when it only cleared clutter, so nothing should land
export function grownIds(base, grown, removed = []) {
  const known = new Set(base.map((instance) => instance.id));
  const added = new Set(grown.filter((instance) => !known.has(instance.id)).map((instance) => instance.id));
  return added.size === 0 && removed.length > 0 ? null : added;
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
  // Puzzle rules: locked site ids, masks kept as given, ids from a base
  let rules = { locked: new Set(), keepMasks: false, idBase: 0 };
  // Module picked up to move; placement checks leave it out
  let lifted = null;
  const standing = () => (lifted === null ? modules : modules.filter((instance) => instance.id !== lifted));
  const near = (list, changed, keepIds) => (rules.keepMasks ? list : reopenNear(list, changed, keepIds));
  const lockedIn = (ids) => ids.some((id) => rules.locked.has(id));

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
      const world = worldFromModules(standing());
      const instance = { ...normalizeVariant(variant), x: originX, y: originY, z: restLevel(world, variant.fp, turn, originX, originY), rot: turn };
      if (isDocked(instance)) instance.z = dockLevel(world, instance, placeCap);
      if (FAMILIES[instance.family].disabled) return { instance, ok: false, reason: DISABLED_REASON };
      const result = checkPlacement(world, instance, { cap: placeCap, stream: placeStream });
      return { instance, ok: result.ok, reason: result.reason };
    },
    // Candidate along a pointer ray {origin, direction} in mm: the highest level the ray crosses
    // where the module would rest, down to the visible surface at floorMm; ok ones first
    ghostOnRay(variant, ray, rot, floorMm = 0) {
      const [originX, originY, originZ] = ray.origin;
      const [stepX, stepY, stepZ] = ray.direction;
      if (stepZ >= 0) return null;
      let refused = null;
      for (let level = worldHeight(worldFromModules(standing())); level >= 0 && level * STORY_MM >= floorMm - RAY_SLACK_MM; level--) {
        const reach = (level * STORY_MM - originZ) / stepZ;
        if (reach < 0) continue;
        const candidate = this.ghost(variant, originX + stepX * reach, originY + stepY * reach, rot);
        if (candidate.instance.z !== level) continue;
        if (candidate.ok) return candidate;
        refused = refused || candidate;
      }
      return refused;
    },
    place(spec) {
      const instance = { ...normalizeVariant(spec), x: spec.x, y: spec.y, z: spec.z, rot: spec.rot & 3 };
      if (FAMILIES[instance.family].disabled) return { ok: false, reason: DISABLED_REASON };
      const result = check(instance);
      if (!result.ok) return { ok: false, reason: result.reason };
      instance.id = Math.max(0, rules.idBase - 1, ...modules.map((placed) => placed.id)) + 1;
      // The placed module keeps its saved mask; neighbours adapt
      commit(near([...modules, instance], [instance], [instance.id]));
      return { ok: true, reason: '', id: instance.id };
    },
    // Picks a placed module up to move it; refused for anchors and supports
    lift(id) {
      const current = modules.find((instance) => instance.id === id);
      if (!current) return { ok: false, reason: '' };
      if (lockedIn([id])) return { ok: false, reason: LOCKED_REASON };
      if (breaksOthers(modules.filter((instance) => instance.id !== id), 0)) return { ok: false, reason: RESTS_REASON };
      lifted = id;
      return { ok: true, reason: '', instance: current };
    },
    // Puts a lifted module down without moving it
    drop() {
      lifted = null;
    },
    lifted: () => lifted,
    // Moves a placed module to a new spot as one step, keeping its id
    move(id, spec) {
      const current = modules.find((instance) => instance.id === id);
      if (!current) return { ok: false, reason: '' };
      if (lockedIn([id])) return { ok: false, reason: LOCKED_REASON };
      const moved = { ...current, x: spec.x, y: spec.y, z: spec.z, rot: spec.rot & 3 };
      const rest = modules.filter((instance) => instance.id !== id);
      const result = checkPlacement(worldFromModules(rest), { ...moved, id: 0 }, { ignoreCap: true, stream: placeStream });
      if (!result.ok) return { ok: false, reason: result.reason };
      const next = [...rest, moved];
      if (breaksOthers(next, id)) return { ok: false, reason: RESTS_REASON };
      lifted = null;
      commit(near(next, [current, moved], [id]));
      return { ok: true, reason: '', id };
    },
    remove(ids) {
      const next = modules.filter((instance) => !ids.includes(instance.id));
      if (next.length === modules.length) return { ok: false, reason: '' };
      if (lockedIn(ids)) return { ok: false, reason: LOCKED_REASON };
      if (breaksOthers(next, 0)) return { ok: false, reason: RESTS_REASON };
      if (ids.includes(lifted)) lifted = null;
      commit(near(next, modules.filter((instance) => ids.includes(instance.id))));
      return { ok: true, reason: '' };
    },
    // Quarter turn of a placed module, in place
    rotate(id) {
      const current = modules.find((instance) => instance.id === id);
      if (!current) return { ok: false, reason: '' };
      if (lockedIn([id])) return { ok: false, reason: LOCKED_REASON };
      const turned = { ...current, rot: nextRot(current.rot) };
      const rest = modules.filter((instance) => instance.id !== id);
      // Turning keeps the count, so the cap never refuses it
      const result = checkPlacement(worldFromModules(rest), { ...turned, id: 0 }, { ignoreCap: true, stream: placeStream });
      if (!result.ok) return { ok: false, reason: result.reason };
      const next = modules.map((instance) => (instance.id === id ? turned : instance));
      if (breaksOthers(next, id)) return { ok: false, reason: RESTS_REASON };
      commit(near(next, [current, turned]));
      return { ok: true, reason: '' };
    },
    // Swap in a whole structure as one step
    replace(list) {
      const copies = list.map((instance) => ({ ...instance }));
      commit(rules.keepMasks ? copies : reopenSides(copies));
    },
    // Clears everything but locked modules
    clear() {
      const next = modules.filter((instance) => rules.locked.has(instance.id));
      if (next.length === modules.length) return false;
      commit(next);
      return true;
    },
    // Whole state, to park one build while another is shown
    snapshot: () => ({ modules, undoStack, redoStack, cap: placeCap, stream: placeStream, rules }),
    restore(state) {
      lifted = null;
      ({ modules, undoStack, redoStack, cap: placeCap, stream: placeStream, rules } = state);
    },
    // Puzzle rules; locked ids can be selected but never moved or removed
    setRules({ locked = [], keepMasks = false, idBase = 0 } = {}) {
      rules = { locked: new Set(locked), keepMasks, idBase };
    },
    isLocked: (id) => rules.locked.has(id),
    undo() {
      lifted = null;
      if (undoStack.length === 0) return false;
      redoStack.push(modules);
      modules = undoStack.pop();
      return true;
    },
    redo() {
      lifted = null;
      if (redoStack.length === 0) return false;
      undoStack.push(modules);
      modules = redoStack.pop();
      return true;
    },
  };
}
