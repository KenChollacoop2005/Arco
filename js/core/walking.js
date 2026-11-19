import { CELL_MM, STORY_MM } from '../config.js';
import { SIDES, instanceCells, worldFromModules, moduleAt, plinthCells } from './grid.js';
import { FAMILIES, END_FAMILIES, END_OPEN, END_STEP, BUTT_SIDES, endCode, isDocked } from './catalog.js';

export const LIFTS = ['core']; // step-free between levels
export const CLIMBS = ['stair', 'ramp']; // join levels with steps
const BUILDING_FAMILIES = ['housing', 'studio', 'hall', 'penthouse', 'shacks', 'flared', 'shop']; // enclosed families with stairs inside
const OPEN_AMENITIES = ['market', 'shrine', 'playground', 'teahouse', 'lookout']; // open stall, caps and platform, no inside stairs
const WALK_GROUPS = ['Living', 'Circulation', 'Outdoor']; // groups people walk through
const WALK_EXTRA = ['core', 'podium', 'market', 'farm', 'greenhouse']; // other families people walk through
const WALK_LIFT_MM = 1.5; // walking lines sit this far over each floor
const MARK_MM = 2; // half width of an unreachable mark

const voxel = (x, y, level) => x + ',' + y + ',' + level;
const PLINTH = { family: 'plinth' }; // owner of the free plinth cells
export const building = (instance) => BUILDING_FAMILIES.includes(instance.family) || (!!FAMILIES[instance.family].amenity && !OPEN_AMENITIES.includes(instance.family));
export const walkable = (instance) => WALK_GROUPS.includes(FAMILIES[instance.family].group) || WALK_EXTRA.includes(instance.family) || !!FAMILIES[instance.family].amenity;

// Walking graph on story voxels: links of one step, each marked step-free or not
export function walkingGraph(modules) {
  const world = worldFromModules(modules);
  const owner = new Map();
  for (const instance of modules) {
    if (!walkable(instance)) continue;
    for (const [x, y] of instanceCells(instance)) for (let level = instance.z; level < instance.z + instance.h; level++) owner.set(voxel(x, y, level), instance);
  }
  const links = new Map();
  const link = (from, to, free) => {
    if (!links.has(from)) links.set(from, []);
    if (!links.has(to)) links.set(to, []);
    links.get(from).push({ to, free });
    links.get(to).push({ to: from, free });
  };
  const bridge = (instance) => END_FAMILIES.includes(instance.family);
  for (const [key, instance] of owner) {
    const [x, y, level] = key.split(',').map(Number);
    for (const [stepX, stepY] of SIDES) {
      const next = voxel(x + stepX, y + stepY, level);
      const other = owner.get(next);
      if (!other || key > next) continue;
      // Inside one module, side by side at one level, or a bridge end meeting what it touches
      if (other === instance) link(key, next, true);
      else if (!bridge(instance) && !bridge(other)) link(key, next, true);
    }
    // Levels join inside lifts, stairs, ramps and buildings
    const above = owner.get(voxel(x, y, level + 1));
    if (above === instance && (LIFTS.includes(instance.family) || CLIMBS.includes(instance.family))) link(key, voxel(x, y, level + 1), LIFTS.includes(instance.family));
    // Buildings have stairs inside, up their own stories and into the building above
    else if (above && building(instance) && building(above)) link(key, voxel(x, y, level + 1), false);
    // A ramp climbs one story to what its high end meets
    if (instance.family === 'ramp') {
      const [stepX, stepY] = SIDES[(BUTT_SIDES.ramp + instance.rot) & 3];
      if (owner.has(voxel(x + stepX, y + stepY, level + 1))) link(key, voxel(x + stepX, y + stepY, level + 1), false);
    }
  }
  // Bridge ends: open meets the wall or dock at deck level, stepped meets the roof, capped meets nothing
  for (const instance of modules) {
    if (!bridge(instance)) continue;
    const cells = instanceCells(instance);
    const own = new Set(cells.map(([x, y]) => x + ',' + y));
    for (const end of [0, 1]) {
      const code = isDocked(instance) ? END_OPEN : endCode(instance, end);
      const [stepX, stepY] = SIDES[((end === 0 ? 2 : 0) + instance.rot) & 3];
      for (const [x, y] of cells.filter(([cellX, cellY]) => !own.has(cellX + stepX + ',' + (cellY + stepY)))) {
        const from = voxel(x, y, instance.z);
        if (code === END_OPEN && owner.has(voxel(x + stepX, y + stepY, instance.z))) link(from, voxel(x + stepX, y + stepY, instance.z), true);
        if (code === END_STEP) {
          const roof = moduleAt(world, x + stepX, y + stepY, instance.z - 1);
          if (roof && owner.get(voxel(x + stepX, y + stepY, instance.z - 1)) === roof) link(from, voxel(x + stepX, y + stepY, instance.z - 1), false);
        }
      }
    }
  }
  // Free plinth cells are walked on, side to side and into the ground floors beside them
  const ground = [];
  for (const [x, y] of plinthCells()) {
    if (moduleAt(world, x, y, 0)) continue;
    const key = voxel(x, y, 0);
    owner.set(key, PLINTH);
    ground.push(key);
  }
  for (const key of ground) {
    const [x, y] = key.split(',').map(Number);
    for (const [stepX, stepY] of SIDES) {
      const next = voxel(x + stepX, y + stepY, 0);
      const other = owner.get(next);
      if (!other || (other === PLINTH && key > next) || (other !== PLINTH && bridge(other))) continue;
      link(key, next, true);
    }
  }
  return { owner, links, ground };
}

// Fewest steps from start voxels to every voxel, over all links or step-free ones only
function spread(graph, starts, freeOnly) {
  const steps = new Map(starts.map((key) => [key, 0]));
  const queue = [...starts];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const { to, free } of graph.links.get(at) || []) {
      if ((freeOnly && !free) || steps.has(to)) continue;
      steps.set(to, steps.get(at) + 1);
      queue.push(to);
    }
  }
  return steps;
}

const voxelsOf = (graph, instance) => [...graph.owner].filter(([, owner]) => owner === instance).map(([key]) => key);
const nearestIn = (steps, keys) => keys.reduce((best, key) => (steps.has(key) ? Math.min(best, steps.get(key)) : best), Infinity);

// Walking network of a structure: steps between modules, nearest amenity of each type, step-free reach from the plinth
export function walkingNetwork(modules) {
  const graph = walkingGraph(modules);
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const fromPlinth = spread(graph, graph.ground, false);
  const freeFromPlinth = spread(graph, graph.ground, true);
  const types = new Map();
  for (const instance of modules) {
    const type = FAMILIES[instance.family].amenity;
    if (!type || !walkable(instance)) continue;
    if (!types.has(type)) types.set(type, []);
    types.get(type).push(...voxelsOf(graph, instance));
  }
  const fields = new Map([...types].map(([type, keys]) => [type, { any: spread(graph, keys, false), free: spread(graph, keys, true) }]));
  const report = {};
  for (const instance of modules) {
    const keys = voxelsOf(graph, instance);
    if (keys.length === 0) continue;
    const nearest = {};
    for (const [type, field] of fields) {
      const steps = nearestIn(field.any, keys);
      if (steps < Infinity) nearest[type] = { steps, stepFree: nearestIn(field.free, keys) < Infinity };
    }
    report[instance.id] = { reached: nearestIn(fromPlinth, keys) < Infinity, stepFree: nearestIn(freeFromPlinth, keys) < Infinity, nearest };
  }
  // Steps between two modules, Infinity when no route
  const between = (fromId, toId) => nearestIn(spread(graph, voxelsOf(graph, byId.get(fromId)), false), voxelsOf(graph, byId.get(toId)));
  return { graph, modules: report, between };
}

// Drawing lines: links between modules, step-free in walk colour, with steps in warn; unreachable modules crossed in fail
export function walkingLines(network, modules) {
  const target = { positions: [], statuses: [] };
  if (!network) return target;
  const point = (key) => {
    const [x, y, level] = key.split(',').map(Number);
    return [(x + 0.5) * CELL_MM, (y + 0.5) * CELL_MM, level * STORY_MM + WALK_LIFT_MM];
  };
  for (const [from, list] of network.graph.links) {
    for (const { to, free } of list) {
      const [first, second] = [network.graph.owner.get(from), network.graph.owner.get(to)];
      if (from > to || first === second || first === PLINTH || second === PLINTH) continue;
      target.positions.push(...point(from), ...point(to));
      target.statuses.push(free ? 'walk' : 'warn');
    }
  }
  for (const instance of modules) {
    const entry = network.modules[instance.id];
    if (!entry || entry.reached) continue;
    const [x, y] = instanceCells(instance)[0];
    const centre = [(x + 0.5) * CELL_MM, (y + 0.5) * CELL_MM, instance.z * STORY_MM + WALK_LIFT_MM];
    target.positions.push(centre[0] - MARK_MM, centre[1] - MARK_MM, centre[2], centre[0] + MARK_MM, centre[1] + MARK_MM, centre[2]);
    target.positions.push(centre[0] - MARK_MM, centre[1] + MARK_MM, centre[2], centre[0] + MARK_MM, centre[1] - MARK_MM, centre[2]);
    target.statuses.push('fail', 'fail');
  }
  return target;
}
