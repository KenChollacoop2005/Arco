import {
  MAX_MODULES, OPENING_UNIT_MIN, OPENING_UNIT_MAX, BUDGET_HARD_CAP, POWER_SUPPLY, POWER_RELAYS, POWER_DEMAND, DEMAND_PER_CELL, DEMAND_PER_MODULE, SOURCE_FAMILIES, PUMP_KINDS, WATER_SOURCES,
} from '../config.js';
import {
  SIDES,
  FOOTPRINTS,
  footprintCells,
  instanceCells,
  plinthCells,
  cellInPlinth,
  worldFromModules,
  addModule,
  removeModule,
  moduleAt,
  worldHeight,
  columnTop,
  toBody,
  claimedCells,
  structureHash,
} from './grid.js';
import { CATEGORIES, UTILITIES, OPEN_SIDE_FAMILIES, categoryOn, FAMILIES, FAMILY_IDS, PLUG_ENDS, JUNCTION_FAMILIES, BUTT_SIDES, END_FAMILIES, END_OPEN, END_CAP, END_STEP, isDocked, hasPump, canSupport, normalizeVariant, sideType } from './catalog.js';
import { checkPlacement, validateStructure, outwardMask } from './placement.js';
import { streamOf, onStream, streamRecord } from './stream.js';
import { quickStable, checkStability } from './stability.js';
import { makeRng, mixSeed, hashString } from './rng.js';
import { PROFILE_FOOTPRINTS, FLUSH, INSET, INSET_BALCONY, INSET_BALCONY_OUT, BULGE, BULGE_BALCONY, WRAP, JETTY, cleanProfiles, packProfiles, profileAt, profileKinds } from './profiles.js';

export const SCALES = ['unit', 'block', 'mega'];

const BLOCK_HALF = [2, 3]; // block site half width range in cells
const OPENING_HALF = 2; // opening site half width in cells
const BLOCK_HEIGHT = [4, 6, 9]; // block tower stories by height choice
const MEGA_HEIGHT = [5, 8, 12]; // mega tower stories by height choice
const OPENING_HEIGHT = [3, 5]; // opening tower stories range
const HEIGHT_SPREAD = [2, 4]; // extra stories: block, mega
const MEGA_TOWERS = [3, 4, 5]; // tower count by density
const TOWER_GAP = 3.2; // least spacing between towers in cells
const SHORT_TOWER = 0.6; // height share of a minor tower
const SHORT_CHANCE = 0.35; // chance a mega tower is minor
const BLOCK_REACH = [2.1, 2.8, 3.4]; // mass radius by density, block
const MEGA_REACH = [2.6, 3.3, 4.1]; // mass radius by density, mega
const OPENING_REACH = 2.2; // mass radius, opening
const PROFILE = [[0.4, 1], [0.65, 0.7], [0.85, 0.45], [1, 0.25]]; // radius share, height share
const NOTCH_CHANCE = 0.25; // chance a cell is one story lower
const PLATE_REACH = [0.5, 0.7, 0.9]; // mega podium radius share by density
const PLATE_STORIES = 2; // tallest podium plate
const DATUMS = [3, 4]; // strata spacing choices in stories
const CANYON_LINES = [-2, -1, 0, 1]; // canyon positions in cells
const GATE_LENGTHS = [2, 2, 4]; // bridged canyon stretch choices
const GATE_START = [-3, 0]; // gate start range along the canyon
const GATE_RISE = [1, 3]; // stories above the bridge level
const BLOCK_CANYON_CHANCE = 0.3; // chance a large block gets a gate
const GATE_RETRIES = 2; // levels a gate bridge may move up when its ends are not ready
const MASS_SHARE = 0.62; // share of the budget for massing
const MASS_TRIES = 4; // family tries per cell
const BIG_FIRST = 0.65; // chance large footprints go first
const CANTILEVERS = [0, 5, 12]; // cantilever tries by daring
const UNSTABLE_TRIES = 10; // extra tries when unstable is allowed
const CANTILEVER_MIN_LEVEL = 2; // lowest cantilever story
const ROOF_CHANCE = 0.4; // chance a free top becomes a roof
const CAP_CHANCE = [0.45, 0.65, 0.85]; // roof dressing by density
const GROUND_CHANCE = [0.2, 0.35, 0.55]; // ground dressing by density
const THEME_SHARE = [0.25, 0.55, 0.85]; // themed share by theme mix
const STYLE_POOL = 4; // style seeds per structure
const STRAY_SEED = 0.15; // chance of a style from the pool
const CAP_SEEDS = 6; // variants per cap family
const PRUNE_ROUNDS = 24; // most repair passes
const TOPUP_ROUNDS = 4; // extra dressing passes for the opening
const UNIT_HEIGHT_TRIES = 2; // rolls toward a taller unit
const GROW_RISE = [1, 2]; // stories a grown build may add on top
const PROFILED_CHANCE = 0.35; // share of facade modules that get side profiles
const PROFILE_SEED = 0x9f0f11e; // keeps profile rolls apart from layout rolls
const PROFILE_ROUNDS = 6; // most stability repair passes for profiles
const SIDE_KINDS = [[FLUSH, 3], [INSET, 2], [INSET_BALCONY, 2.5], [INSET_BALCONY_OUT, 1.5], [BULGE, 1.5], [BULGE_BALCONY, 1.5], [WRAP, 1]];
// Kind used when a side has no open air
const INSIDE_KIND = { [INSET_BALCONY_OUT]: INSET_BALCONY, [BULGE]: INSET, [BULGE_BALCONY]: INSET_BALCONY, [WRAP]: INSET_BALCONY };

// Penthouse balconies, picked per side
const PENTHOUSE_KINDS = [[INSET_BALCONY_OUT, 2], [BULGE_BALCONY, 2], [WRAP, 1.5]];
const JETTY_CHANCE = 0.14; // share of facade modules that try a jetty
const JETTY_SEED = 0x1e77e; // keeps jetty rolls apart from other profile rolls
const PROP_KINDS = [BULGE, BULGE_BALCONY]; // profiles a strut may stand under
const PROP_CHANCE = 0.6; // chance a bulge gets a strut
const PROP_SEED = 0x57a17; // keeps strut rolls apart from layout rolls
const SPAN_TRIES = [1, 2, 3]; // gap bridges by density
const PENTHOUSE_CHANCE = 0.7; // chance a tower top gets a penthouse
const PENTHOUSE_CAP_CHANCE = 0.5; // share of those that end the tower
const SPAN_MEGA = 3; // gap bridge multiplier for megastructures
const DOCK_TRIES = [1, 2, 3]; // docked bridges by density
const DOCK_MEGA = 2; // docked bridge multiplier for megastructures
const DOCK_SPAN = [2, 5]; // docked bridge length range in cells
const DOCK_SEED = 0xd0c5; // keeps dock rolls apart from layout rolls
const PIER_SPAN = 4; // spans from this length get a pier
const SERVICE_SEED = 0x5e771c; // keeps service rolls apart from layout rolls
const UTILITIES_OFF_TEXT = 'noutil'; // seed text mark when utilities are off
const SERVICE_ROUNDS = 6; // most stability repair passes for services
const PUMP_ROOMS = [[0, 1], [1, 2], [1, 3]]; // pump rooms per structure by density: block, mega
const SMALL_PUMPS = [[0, 1], [1, 2], [1, 4]]; // small pumps per structure by density: block, mega
const MAINS = [[0, 1], [1, 2], [1, 2]]; // water main columns per structure by density: block, mega
const MAIN_RISE = [2, 9]; // water main column height range in stories
const POWER_ROOMS = [[0, 1], [1, 2], [1, 3]]; // power rooms per structure by density: block, mega
const HOMES = ['housing', 'studio', 'shacks', 'flared', 'penthouse', 'hall']; // families a power room goes near
const INDUSTRY = ['smokestack', 'chimney', 'cooling', 'tankfarm', 'pipes', 'pumproom']; // families industry goes near
const GENERATORS = [[0, 1], [0, 1], [1, 2]]; // generator rooms by density: block, mega
const GENERATOR_GROUND_SHARE = 0.5; // share of generator rooms on the ground, not a roof
const SPRINGS = [[0, 1], [0, 1], [0, 2]]; // springs by density: block, mega
const WELLS = [[0, 1], [0, 1], [0, 1]]; // wells by density: block, mega
const RAIN_CATCHERS = [[0, 1], [1, 2], [1, 3]]; // rain catchers by density: block, mega
const RAISED_WHEELS = [[0, 1], [0, 1], [0, 1]]; // raised water wheels by density: block, mega
const RUNOFFS = [[0, 1], [0, 1], [0, 1]]; // runoff outlets by density: block, mega
const DISPOSALS = [[0, 1], [0, 1], [0, 1]]; // disposal outlets by density: block, mega
const STREAM_WHEELS = [1, 2, 2]; // most stream wheels by density
const JUNCTION_CHANCE = 0.12; // share of wall-bearing modules with a junction box
const PLANNER_SEED = 0x91a11e; // keeps planner rolls apart from other rolls
export const SERVICE_LEVELS = ['off', 'low', 'high']; // services planner choices
const PLANNER_SHARE = { off: 0, low: 0.35, high: 0.9 }; // share of unserved consumers the planner serves
const PLANNER_WATER_REACH = 3; // cells a rain catcher or pump is put within
const PLANNER_POWER_REACH = 4; // cells a new power source is put within
const PLANNER_SOURCES = [['solar', 3], ['turbine', 2]]; // power sources the planner adds, weighted
const PLANNER_SOURCES_HIGH = [['generator', 3], ['turbine', 2], ['solar', 1]]; // power sources on High, weighted
const PLANNER_PUMP_REACH = 5; // cells within which a pump or source already serves a consumer
const PLANNER_PUMP_ROOM_SHARE = 0.5; // share of water fixes that try a pump room first
const PLANNER_ROOF_WATER = [['raincatcher', 3], ['pumptank', 1]]; // roof water fixes, weighted
const PLANNER_GROUND_WATER = [['pumproom', 3], ['well', 1]]; // ground water fixes, weighted
const PLANNER_TANK_SHARE = 0.25; // share of dry consumers given a pumped tank before power is planned
const PLANNER_ROUTE_FACTOR = 1.6; // real wire and pipe routes run about this much longer than a straight guess
const PLANNER_TRIES = 6; // nearest roof cells tried per piece
const PLANNER_WHEEL_GUESS = 1; // power guessed for a raised wheel before the water runs
const PUMPED_TANK_CHANCE = 0.4; // chance a tank gets a pump
const THIRSTY = ['farm', 'greenhouse', 'planted', 'garden', 'planter']; // families a pump goes near
const NEAR_CELLS = 2; // reach of near, in cells
const DOCK_HOUSES = [['housing', 3], ['studio', 1.5], ['shacks', 1], ['deck', 1], ['panel', 1]]; // new modules a bridge docks to

const GROUND_MASS = [
  ['podium', 4], ['shop', 3], ['pilotis', 2.5], ['housing', 1.5], ['deck', 0.5], ['shacks', 0.8], ['flared', 0.8],
  ['foodstall', 0.4], ['laundromat', 0.3], ['barber', 0.25], ['pharmacy', 0.4], ['workshop', 0.5], ['courier', 0.4], ['canteen', 0.4], ['gym', 0.25], ['clinic', 0.3], ['arcade', 0.25],
];
const UPPER_MASS = [
  ['housing', 5], ['studio', 2], ['hall', 1.5], ['deck', 1.5], ['brise', 1.2], ['fins', 1.2],
  ['panel', 1.2], ['transfer', 0.8], ['spout', 0.4], ['pilotis', 0.7], ['stair', 0.3],
  ['shacks', 1.5], ['flared', 1.2],
  ['school', 0.3], ['library', 0.3], ['bathhouse', 0.25], ['clinic', 0.2], ['gym', 0.2],
];
const CANTILEVER_FAMILIES = ['housing', 'studio', 'deck', 'brise', 'fins', 'hall'];
const CANTILEVER_SHAPES = ['2x3', 'L4', 'L3', '2x2'];
const SETBACK_CAPS = [['balcony', 2], ['terrace', 3], ['skylight', 0.6], ['garden', 1], ['playground', 0.4], ['teahouse', 0.3], ['lookout', 0.4], ['shrine', 0.3]];
const ROOF_CAPS = [['tank', 2], ['plant', 2], ['vent', 2], ['skylight', 1.5], ['antenna', 1.2], ['terrace', 1], ['penthouse', 1.5], ['playground', 0.6], ['lookout', 0.5], ['teahouse', 0.5], ['shrine', 0.4]];
const ROOF_INDUSTRIAL = [['smokestack', 3], ['pipes', 2], ['tankfarm', 2], ['chimney', 2], ['cooling', 2]];
const ROOF_ECO = [['solar', 3], ['turbine', 2], ['farm', 2], ['greenhouse', 2], ['market', 1], ['planted', 2], ['garden', 2]];
const GROUND_CAPS = [['steps', 2], ['planter', 2], ['patio', 2], ['ramp', 1], ['buttress', 1.5], ['shrine', 0.6]];
const GROUND_INDUSTRIAL = [['pipes', 2], ['tankfarm', 2], ['cooling', 1.5], ['smokestack', 1], ['chimney', 1]];
const GROUND_ECO = [['planter', 2], ['market', 2], ['farm', 2], ['greenhouse', 1.5], ['patio', 1], ['garden', 1.5]];
const UNIT_SKIP = ['bridge', 'gantry', 'walkway', 'wheel']; // need two supports, or the stream
const ARCH_SKIP = 0.25; // chance a stream cell inside the mass stays open water
const SUPPORT_SEED = 0x5a990; // keeps support rolls apart from layout rolls
const SUPPORT_CHANCE = 0.05; // chance a ground mass cell is a support instead
const SUPPORT_TRIES = 24; // ground cells tried per free standing support
const CANOPY_NEAR = 3; // a canopy stands within this many cells of the structure
const SUPPORT_TREES = [[0, 1], [1, 2], [1, 3]]; // free standing supports with a canopy, by density: block, mega
const CANOPY_FAMILIES = [['housing', 3], ['studio', 1.5], ['deck', 1], ['shacks', 1]]; // modules a support carries
const CANOPY_SIDES = [[2, 2], [4, 1]]; // canopy neighbours: opposite pair or all four, weighted

const cellKey = (cellX, cellY) => (cellX + 64) * 256 + (cellY + 64);
const area = (footprintId) => FOOTPRINTS[footprintId].length;

function supportedAt(world, cellX, cellY, level) {
  if (level === 0) return true;
  const below = moduleAt(world, cellX, cellY, level - 1);
  return !!below && below.z + below.h === level && canSupport(below);
}

function emptyAt(world, cellX, cellY, level, stories = 1) {
  for (let step = 0; step < stories; step++) {
    if (moduleAt(world, cellX, cellY, level + step)) return false;
  }
  return true;
}

// True when a locked module shows a facade to this side
function lockedFacade(ctx, instance, side) {
  for (const [cellX, cellY] of instanceCells(instance)) {
    for (let level = instance.z; level < instance.z + instance.h; level++) {
      const other = moduleAt(ctx.world, cellX + SIDES[side][0], cellY + SIDES[side][1], level);
      if (other && ctx.locked.has(other.id) && sideType(other, (side + 2) & 3) === 'facade') return true;
    }
  }
  return false;
}

function place(ctx, spec) {
  if (ctx.world.modules.size >= ctx.limit) {
    ctx.capped = true;
    return null;
  }
  const variant = normalizeVariant({ mask: 0, roof: false, ...spec });
  const instance = { ...variant, x: spec.x, y: spec.y, z: spec.z, rot: spec.rot & 3 };
  if (spec.placement) instance.placement = spec.placement;
  if (ctx.locked.size > 0 && FAMILIES[instance.family].rails) {
    for (let side = 0; side < 4; side++) {
      if (lockedFacade(ctx, instance, side)) instance.mask |= 1 << ((side - instance.rot + 4) & 3);
    }
  }
  if (!checkPlacement(ctx.world, instance, { cap: Math.max(MAX_MODULES, ctx.limit), stream: ctx.stream }).ok) return null;
  return addModule(ctx.world, instance);
}

// Footprint position covering the anchor cell
function fits(ctx, footprintId, anchor, cellOk) {
  for (const rot of ctx.rng.shuffle([0, 1, 2, 3])) {
    const cells = footprintCells(footprintId, rot);
    for (const [offsetX, offsetY] of ctx.rng.shuffle(cells)) {
      const originX = anchor[0] - offsetX;
      const originY = anchor[1] - offsetY;
      if (cells.every(([cellX, cellY]) => cellOk(originX + cellX, originY + cellY))) {
        return { fp: footprintId, rot, x: originX, y: originY, cells: cells.map(([cellX, cellY]) => [originX + cellX, originY + cellY]) };
      }
    }
  }
  return null;
}

function shapeOrder(ctx, footprints) {
  const shuffled = ctx.rng.shuffle(footprints);
  if (!ctx.rng.chance(BIG_FIRST)) return shuffled;
  return shuffled.sort((shapeA, shapeB) => area(shapeB) - area(shapeA));
}

function tallRoll(rng, low, high) {
  return Math.max(rng.int(low, high), rng.int(low, high));
}

function nearestTower(ctx, cellX, cellY) {
  let best = ctx.towers[0];
  let bestDistance = Infinity;
  for (const tower of ctx.towers) {
    const distance = Math.hypot(cellX + 0.5 - tower.centerX, cellY + 0.5 - tower.centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tower;
    }
  }
  return best;
}

function styleSeed(ctx, cellX, cellY) {
  if (ctx.towers.length === 0 || ctx.rng.chance(STRAY_SEED)) return ctx.rng.pick(ctx.pool);
  return nearestTower(ctx, cellX, cellY).seed;
}

function planSite(ctx) {
  const { rng, opts } = ctx;
  const mega = opts.scale === 'mega';
  let site = plinthCells();
  ctx.half = 0;
  if (!mega) {
    const half = opts.budget ? OPENING_HALF : rng.int(BLOCK_HALF[0], BLOCK_HALF[1]);
    const centerX = rng.int(-1, 0);
    const centerY = rng.int(-1, 0);
    site = site.filter(
      ([cellX, cellY]) => cellX >= centerX - half && cellX < centerX + half && cellY >= centerY - half && cellY < centerY + half
    );
    ctx.half = half;
    ctx.center = [centerX, centerY];
  }
  if (ctx.lockedCenter && !mega) {
    const center = ctx.lockedCenter.map(Math.round);
    site = plinthCells().filter(
      ([cellX, cellY]) => cellX >= center[0] - ctx.half && cellX < center[0] + ctx.half && cellY >= center[1] - ctx.half && cellY < center[1] + ctx.half
    );
    ctx.center = center;
  }
  ctx.site = site;
  ctx.inSite = new Set(site.map(([cellX, cellY]) => cellKey(cellX, cellY)));
  ctx.datum = rng.pick(DATUMS);
  ctx.canyon = null;
  if (mega || (ctx.half === BLOCK_HALF[1] && rng.chance(BLOCK_CANYON_CHANCE))) {
    const alongY = rng.chance(0.5);
    const line = mega ? rng.pick(CANYON_LINES) : (alongY ? ctx.center[0] : ctx.center[1]) + rng.int(-1, 0);
    const length = mega ? rng.pick(GATE_LENGTHS) : GATE_LENGTHS[0];
    const start = mega ? rng.int(GATE_START[0], GATE_START[1]) : (alongY ? ctx.center[1] : ctx.center[0]) - 1;
    ctx.canyon = { alongY, line, start, length, level: ctx.datum };
  }
}

function canyonCell(ctx, cellX, cellY) {
  if (!ctx.canyon) return null;
  const across = ctx.canyon.alongY ? cellX : cellY;
  const along = ctx.canyon.alongY ? cellY : cellX;
  if (across !== ctx.canyon.line) return null;
  return along >= ctx.canyon.start && along < ctx.canyon.start + ctx.canyon.length ? 'gate' : 'street';
}

// Gate cells and the cells beside them
function nearGate(ctx, cellX, cellY) {
  if (!ctx.canyon) return false;
  const across = ctx.canyon.alongY ? cellX : cellY;
  const along = ctx.canyon.alongY ? cellY : cellX;
  return Math.abs(across - ctx.canyon.line) <= 1 && along >= ctx.canyon.start && along < ctx.canyon.start + ctx.canyon.length;
}

function planTowers(ctx) {
  const { rng, opts } = ctx;
  const mega = opts.scale === 'mega';
  const count = mega ? MEGA_TOWERS[opts.density] + rng.int(0, 1) : 1;
  const base = opts.budget ? rng.int(OPENING_HEIGHT[0], OPENING_HEIGHT[1]) : (mega ? MEGA_HEIGHT : BLOCK_HEIGHT)[opts.height];
  const reach = opts.budget ? OPENING_REACH : (mega ? MEGA_REACH : BLOCK_REACH)[opts.density];
  ctx.towers = [];
  if (ctx.lockedCenter) {
    const [centerX, centerY] = ctx.lockedCenter;
    const stories = Math.max(base + rng.int(0, HEIGHT_SPREAD[mega ? 1 : 0]), worldHeight(ctx.world) + rng.int(GROW_RISE[0], GROW_RISE[1]));
    ctx.towers.push({ x: Math.floor(centerX), y: Math.floor(centerY), centerX, centerY, stories, reach, seed: ctx.pool[0], cells: [] });
  }
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    if (ctx.towers.length >= count) break;
    if (!mega && (Math.abs(cellX - ctx.center[0] + 0.5) > 1 || Math.abs(cellY - ctx.center[1] + 0.5) > 1)) continue;
    if (ctx.towers.some((tower) => Math.hypot(cellX - tower.x, cellY - tower.y) < TOWER_GAP)) continue;
    const family = FAMILIES[rng.chance(0.8) ? 'core' : 'stair'];
    const fit = fits(ctx, rng.pick(family.footprints), [cellX, cellY], (testX, testY) =>
      ctx.inSite.has(cellKey(testX, testY)) && !canyonCell(ctx, testX, testY) && !nearGate(ctx, testX, testY) && emptyAt(ctx.world, testX, testY, 0)
    );
    if (!fit) continue;
    const minor = mega && ctx.towers.length > 0 && rng.chance(SHORT_CHANCE);
    const stories = Math.max(2, Math.round((base + rng.int(0, HEIGHT_SPREAD[mega ? 1 : 0])) * (minor ? SHORT_TOWER : 1)));
    const seed = ctx.pool[ctx.towers.length % ctx.pool.length];
    let level = 0;
    while (level < stories) {
      const room = stories - level;
      const stack = Math.max(family.minStories, Math.min(family.maxStories, room, rng.int(2, 4)));
      if (!place(ctx, { family: family.id, fp: fit.fp, h: stack, seed, x: fit.x, y: fit.y, z: level, rot: fit.rot })) break;
      level += stack;
    }
    if (level === 0) continue;
    ctx.towers.push({
      x: cellX,
      y: cellY,
      centerX: fit.cells.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / fit.cells.length,
      centerY: fit.cells.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / fit.cells.length,
      stories: level,
      reach: reach * (minor ? 0.8 : 1),
      seed,
      cells: fit.cells,
    });
  }
}

function planHeights(ctx) {
  const { rng, opts } = ctx;
  const mega = opts.scale === 'mega';
  const heights = new Map();
  const plate = mega ? rng.int(1, PLATE_STORIES) : 0;
  for (const [cellX, cellY] of ctx.site) {
    let stories = 0;
    for (const tower of ctx.towers) {
      const offsetX = cellX + 0.5 - tower.centerX;
      const offsetY = cellY + 0.5 - tower.centerY;
      const distance = (0.6 * Math.max(Math.abs(offsetX), Math.abs(offsetY)) + 0.4 * Math.hypot(offsetX, offsetY)) / tower.reach;
      const band = PROFILE.find((entry) => distance <= entry[0]);
      if (band) stories = Math.max(stories, Math.max(1, Math.round(tower.stories * band[1])));
    }
    if (stories > 1 && rng.chance(NOTCH_CHANCE)) stories -= 1;
    if (mega && Math.hypot(cellX + 0.5, cellY + 0.5) <= PLATE_REACH[opts.density] * 6) stories = Math.max(stories, plate);
    heights.set(cellKey(cellX, cellY), stories);
  }
  if (ctx.canyon) {
    const { alongY, line, start, length, level } = ctx.canyon;
    const tallest = Math.max(...ctx.towers.map((tower) => tower.stories), level + GATE_RISE[0]);
    for (const [cellX, cellY] of ctx.site) {
      const kind = canyonCell(ctx, cellX, cellY);
      if (kind === 'street') heights.set(cellKey(cellX, cellY), 0);
    }
    for (let step = 0; step < length; step++) {
      const lift = Math.min(tallest, level + rng.int(GATE_RISE[0], GATE_RISE[1]));
      for (const across of [line - 1, line, line + 1]) {
        const cellX = alongY ? across : start + step;
        const cellY = alongY ? start + step : across;
        const key = cellKey(cellX, cellY);
        if (!ctx.inSite.has(key)) continue;
        heights.set(key, Math.max(heights.get(key) || 0, lift));
      }
    }
  }
  for (const tower of ctx.towers) {
    for (const [cellX, cellY] of tower.cells) heights.set(cellKey(cellX, cellY), tower.stories);
  }
  // Fantasy Grow stacks the plan on what already stands
  if (opts.rise) {
    const top = worldHeight(ctx.world);
    for (const [cellX, cellY] of ctx.site) {
      const key = cellKey(cellX, cellY);
      if (heights.get(key)) heights.set(key, heights.get(key) + columnTop(ctx.world, cellX, cellY, top));
    }
  }
  ctx.heights = heights;
}

function nextDatum(ctx, level) {
  return (Math.floor(level / ctx.datum) + 1) * ctx.datum;
}

function bridgeGate(ctx, level) {
  if (!ctx.canyon || ctx.canyon.level !== level) return;
  const { alongY, line, start, length } = ctx.canyon;
  let placed = 0;
  for (let step = 0; step + 1 < length; step += 2) {
    const originX = alongY ? line - 1 : start + step;
    const originY = alongY ? start + step : line - 1;
    const room = Math.min(2, (ctx.heights.get(cellKey(alongY ? line : start + step, alongY ? start + step : line)) || 0) - level);
    if (room < 1) continue;
    if (place(ctx, {
      family: 'bridge',
      fp: '2x3',
      h: ctx.rng.int(1, room),
      seed: styleSeed(ctx, originX, originY),
      x: originX,
      y: originY,
      z: level,
      rot: alongY ? 0 : 1,
    })) placed++;
  }
  // No gate bridge fits yet: keep the canyon open a level more and try again
  if (placed === 0 && (ctx.canyon.retries || 0) < GATE_RETRIES) {
    ctx.canyon.level++;
    ctx.canyon.retries = (ctx.canyon.retries || 0) + 1;
  }
}

// A weighted table without families whose category is off
const allowedIn = (ctx, table) => table.filter(([id]) => categoryOn(id, ctx.opts.categories));

function massCell(ctx, cell, level, open) {
  const { rng } = ctx;
  const table = allowedIn(ctx, level === 0 ? GROUND_MASS : UPPER_MASS);
  const heightOf = (target) => ctx.heights.get(cellKey(target[0], target[1])) || 0;
  for (let attempt = 0; attempt < MASS_TRIES; attempt++) {
    if (table.length === 0) break;
    const family = FAMILIES[rng.weighted(table)];
    for (const footprintId of shapeOrder(ctx, family.footprints)) {
      const fit = fits(ctx, footprintId, cell, open);
      if (!fit) continue;
      const room = Math.min(...fit.cells.map(heightOf)) - level;
      const most = Math.min(family.maxStories, room, nextDatum(ctx, level) - level);
      if (most < family.minStories) continue;
      const placed = place(ctx, {
        family: family.id,
        fp: fit.fp,
        h: tallRoll(rng, family.minStories, most),
        seed: styleSeed(ctx, cell[0], cell[1]),
        x: fit.x,
        y: fit.y,
        z: level,
        rot: fit.rot,
      });
      if (placed) return placed;
    }
  }
  const most = Math.min(heightOf(cell) - level, nextDatum(ctx, level) - level, FAMILIES.housing.maxStories);
  return place(ctx, {
    family: rng.chance(0.6) ? 'housing' : 'panel',
    fp: '1x1',
    h: Math.max(1, Math.min(most, 3)),
    seed: styleSeed(ctx, cell[0], cell[1]),
    x: cell[0],
    y: cell[1],
    z: level,
    rot: 0,
    placement: 'Filler',
  });
}

function massing(ctx) {
  const top = Math.max(0, ...ctx.heights.values());
  // A fantasy Grow spends its share on top of what is locked
  const massLimit = ctx.opts.rise ? ctx.locked.size + Math.floor((ctx.limit - ctx.locked.size) * MASS_SHARE) : Math.floor(ctx.limit * MASS_SHARE);
  for (let level = 0; level < top; level++) {
    bridgeGate(ctx, level);
    const open = (cellX, cellY) => {
      const key = cellKey(cellX, cellY);
      if (!ctx.inSite.has(key) || (ctx.heights.get(key) || 0) <= level) return false;
      if (canyonCell(ctx, cellX, cellY) === 'gate' && level < ctx.canyon.level) return false;
      return emptyAt(ctx.world, cellX, cellY, level) && supportedAt(ctx.world, cellX, cellY, level);
    };
    for (const cell of ctx.rng.shuffle(ctx.site)) {
      if (ctx.world.modules.size >= massLimit) return;
      if (!open(cell[0], cell[1])) continue;
      // Now and then the ground mass stands on a support instead
      if (level === 0 && ctx.supportRng.chance(SUPPORT_CHANCE)) {
        const most = Math.min(FAMILIES.support.maxStories, (ctx.heights.get(cellKey(cell[0], cell[1])) || 0) - 1);
        if (most >= 1 && !onStream(ctx.stream, cell[0], cell[1])) {
          const placed = place(ctx, { family: 'support', fp: '1x1', h: ctx.supportRng.int(1, most), seed: styleSeed(ctx, cell[0], cell[1]), x: cell[0], y: cell[1], z: 0, rot: 0 });
          if (placed) continue;
        }
      }
      // Stream cells get an arch or stay open
      if (level === 0 && onStream(ctx.stream, cell[0], cell[1])) {
        // Beside a gate the stream always gets an arch, so the canyon wall can rise
        const skip = ctx.rng.chance(ARCH_SKIP);
        if (!skip || nearGate(ctx, cell[0], cell[1])) place(ctx, { family: 'arch', fp: '1x1', h: 1, seed: styleSeed(ctx, cell[0], cell[1]), x: cell[0], y: cell[1], z: 0, rot: ctx.stream.alongX ? 0 : 1 });
        continue;
      }
      massCell(ctx, cell, level, (cellX, cellY) => open(cellX, cellY) && !(level === 0 && onStream(ctx.stream, cellX, cellY)));
    }
  }
}

const bodiesOf = (world) => [...world.modules.values()].map(toBody);

function cantilevers(ctx) {
  const { rng, opts, world } = ctx;
  const tries = CANTILEVERS[opts.daring] * (opts.scale === 'mega' ? 2 : 1) + (opts.unstable ? UNSTABLE_TRIES : 0);
  for (let attempt = 0; attempt < tries; attempt++) {
    const [cellX, cellY] = rng.pick(ctx.site);
    const level = columnTop(world, cellX, cellY, worldHeight(world));
    if (level < CANTILEVER_MIN_LEVEL || !supportedAt(world, cellX, cellY, level)) continue;
    const side = SIDES[rng.int(0, 3)];
    const air = [cellX + side[0], cellY + side[1]];
    if (!ctx.inSite.has(cellKey(air[0], air[1])) || columnTop(world, air[0], air[1], worldHeight(world)) >= level) continue;
    const family = FAMILIES[rng.pick(CANTILEVER_FAMILIES.filter((id) => categoryOn(id, ctx.opts.categories)))];
    const shapes = opts.unstable ? [...CANTILEVER_SHAPES, '1x2'] : CANTILEVER_SHAPES;
    const footprintId = rng.pick(shapes.filter((shape) => family.footprints.includes(shape)));
    const stories = rng.int(family.minStories, Math.min(family.maxStories, 2));
    const fit = fits(ctx, footprintId, air, (testX, testY) => ctx.inSite.has(cellKey(testX, testY)) && emptyAt(world, testX, testY, level, stories));
    if (!fit || !fit.cells.some((cell) => cell[0] === cellX && cell[1] === cellY)) continue;
    const placed = place(ctx, { family: family.id, fp: fit.fp, h: stories, seed: styleSeed(ctx, cellX, cellY), x: fit.x, y: fit.y, z: level, rot: fit.rot });
    if (placed && !opts.unstable && !quickStable(bodiesOf(world))) removeModule(world, placed.id);
  }
}

// Penthouse on a tower top: a cap, or a floor that carries more
function penthouses(ctx) {
  const { rng, world } = ctx;
  const family = FAMILIES.penthouse;
  for (const tower of ctx.towers) {
    if (tower.cells.length === 0 || !rng.chance(PENTHOUSE_CHANCE)) continue;
    const cell = rng.pick(tower.cells);
    const level = columnTop(world, cell[0], cell[1], worldHeight(world));
    const cellOk = (cellX, cellY) =>
      ctx.inSite.has(cellKey(cellX, cellY)) && columnTop(world, cellX, cellY, worldHeight(world)) === level && supportedAt(world, cellX, cellY, level);
    for (const footprintId of shapeOrder(ctx, family.footprints)) {
      const fit = fits(ctx, footprintId, cell, cellOk);
      if (!fit) continue;
      const stories = rng.int(family.minStories, family.maxStories);
      const roof = rng.chance(PENTHOUSE_CAP_CHANCE);
      if (place(ctx, { family: family.id, fp: fit.fp, h: stories, seed: tower.seed, roof, x: fit.x, y: fit.y, z: level, rot: fit.rot })) break;
    }
  }
}

// Walkways and gantries over one cell gaps
function spans(ctx) {
  const { rng, opts, world } = ctx;
  let left = SPAN_TRIES[opts.density] * (opts.scale === 'mega' ? SPAN_MEGA : 1);
  const topOf = (cellX, cellY) => columnTop(world, cellX, cellY, worldHeight(world));
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    if (left === 0) return;
    for (const rot of rng.shuffle([0, 1])) {
      const [stepX, stepY] = SIDES[rot];
      const ends = [[cellX - stepX, cellY - stepY], [cellX + stepX, cellY + stepY]];
      if (!ends.every((end) => ctx.inSite.has(cellKey(end[0], end[1])))) continue;
      const level = topOf(ends[0][0], ends[0][1]);
      if (level === 0 || topOf(ends[1][0], ends[1][1]) !== level || topOf(cellX, cellY) >= level) continue;
      if (!ends.every((end) => supportedAt(world, end[0], end[1], level))) continue;
      const themedFamily = themed(ctx, cellX, cellY, 'walkway', 'gantry', 'walkway');
      const family = categoryOn(themedFamily, ctx.opts.categories) ? themedFamily : 'walkway';
      if (!place(ctx, { family, fp: '1x3', h: 1, seed: rng.int(1, CAP_SEEDS), x: ends[0][0], y: ends[0][1], z: level, rot })) continue;
      left--;
      break;
    }
  }
}

function freeAbove(world, instance) {
  const top = worldHeight(world);
  return instanceCells(instance).every(([cellX, cellY]) => emptyAt(world, cellX, cellY, instance.z + instance.h, top - instance.z - instance.h + 1));
}

function roofs(ctx) {
  for (const instance of ctx.world.modules.values()) {
    if (ctx.locked.has(instance.id) || !FAMILIES[instance.family].roofable || instance.roof) continue;
    if (freeAbove(ctx.world, instance) && ctx.rng.chance(ROOF_CHANCE)) instance.roof = true;
  }
}

function themed(ctx, cellX, cellY, neutral, industrial, eco) {
  if (!ctx.rng.chance(THEME_SHARE[ctx.opts.theme])) return neutral;
  return (cellX + 0.5) * ctx.themeAxis[0] + (cellY + 0.5) * ctx.themeAxis[1] > 0 ? industrial : eco;
}

function capCell(ctx, cell, level, given) {
  const { rng, world } = ctx;
  const table = allowedIn(ctx, given);
  if (table.length === 0) return null;
  const family = FAMILIES[rng.weighted(table)];
  if (family.ground && level !== 0) return null;
  const stories = rng.int(family.minStories, family.maxStories);
  const cellOk = (cellX, cellY) =>
    ctx.inSite.has(cellKey(cellX, cellY)) &&
    columnTop(world, cellX, cellY, worldHeight(world)) === level &&
    (level === 0 ? ctx.groundOk(cellX, cellY) : supportedAt(world, cellX, cellY, level));
  for (const footprintId of shapeOrder(ctx, family.footprints)) {
    const fit = fits(ctx, footprintId, cell, cellOk);
    if (!fit) continue;
    const placed = place(ctx, { family: family.id, fp: fit.fp, h: stories, seed: rng.int(1, CAP_SEEDS), roof: family.roofable, x: fit.x, y: fit.y, z: level, rot: fit.rot });
    if (placed) return placed;
  }
  return null;
}

function dressTops(ctx, chance) {
  const { rng, world } = ctx;
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    const level = columnTop(world, cellX, cellY, worldHeight(world));
    if (level === 0 || !supportedAt(world, cellX, cellY, level) || !rng.chance(chance)) continue;
    const setback = SIDES.some(([stepX, stepY]) => columnTop(world, cellX + stepX, cellY + stepY, worldHeight(world)) > level);
    const table = setback
      ? themed(ctx, cellX, cellY, SETBACK_CAPS, SETBACK_CAPS, ROOF_ECO)
      : themed(ctx, cellX, cellY, ROOF_CAPS, ROOF_INDUSTRIAL, ROOF_ECO);
    capCell(ctx, [cellX, cellY], level, table);
  }
}

// Buttress turned so its tall end meets the building
function leanButtress(ctx, cell) {
  const { rng, world } = ctx;
  for (const rot of rng.shuffle([0, 1, 2, 3])) {
    const back = [[-1, 0], [0, -1], [1, 0], [0, 1]][rot];
    const behind = moduleAt(world, cell[0] + back[0], cell[1] + back[1], 0);
    if (!behind || !FAMILIES[behind.family].stack) continue;
    const stories = rng.int(1, Math.min(FAMILIES.buttress.maxStories, behind.h));
    const placed = place(ctx, { family: 'buttress', fp: '1x1', h: stories, seed: rng.int(1, CAP_SEEDS), x: cell[0], y: cell[1], z: 0, rot });
    if (placed) return placed;
  }
  return null;
}

// Steps and ramps turned so their high end meets a building all along
function climbTo(ctx, cell, familyId) {
  const { rng, world } = ctx;
  const family = FAMILIES[familyId];
  const top = worldHeight(world);
  for (const footprintId of shapeOrder(ctx, family.footprints)) {
    for (const rot of rng.shuffle([0, 1, 2, 3])) {
      const shape = footprintCells(footprintId, rot);
      for (const [offsetX, offsetY] of rng.shuffle(shape)) {
        const cells = shape.map(([x, y]) => [cell[0] - offsetX + x, cell[1] - offsetY + y]);
        if (!cells.every(([x, y]) => ctx.inSite.has(cellKey(x, y)) && ctx.groundOk(x, y) && columnTop(world, x, y, top) === 0)) continue;
        const [stepX, stepY] = SIDES[(BUTT_SIDES[familyId] + rot) & 3];
        const own = new Set(cells.map(([x, y]) => cellKey(x, y)));
        const edge = cells.filter(([x, y]) => !own.has(cellKey(x + stepX, y + stepY)));
        if (!edge.every(([x, y]) => {
          const other = moduleAt(world, x + stepX, y + stepY, 0);
          return other && FAMILIES[other.family].stack;
        })) continue;
        const placed = place(ctx, { family: familyId, fp: footprintId, h: rng.int(family.minStories, family.maxStories), seed: rng.int(1, CAP_SEEDS), x: cell[0] - offsetX, y: cell[1] - offsetY, z: 0, rot });
        if (placed) return placed;
      }
    }
  }
  return null;
}

// Bridge ends: open at walls, steps to roofs, else capped
function setBridgeEnds(world, locked) {
  for (const instance of world.modules.values()) {
    if (!END_FAMILIES.includes(instance.family) || isDocked(instance) || locked.has(instance.id)) continue;
    const cells = instanceCells(instance);
    const own = new Set(cells.map(([x, y]) => cellKey(x, y)));
    let ends = 0;
    for (const end of [0, 1]) {
      const [stepX, stepY] = SIDES[((end === 0 ? 2 : 0) + instance.rot) & 3];
      const next = cells.filter(([x, y]) => !own.has(cellKey(x + stepX, y + stepY))).map(([x, y]) => [x + stepX, y + stepY]);
      const walled = next.some(([x, y]) => moduleAt(world, x, y, instance.z));
      const roofed = next.every(([x, y]) => cellInPlinth(x, y) && instance.z > 0 && columnTop(world, x, y, instance.z) === instance.z && supportedAt(world, x, y, instance.z));
      const code = walled ? END_OPEN : roofed ? END_STEP : END_CAP;
      ends |= code << (end * 2);
    }
    if (ends) instance.ends = ends;
    else delete instance.ends;
  }
}

function dressGround(ctx, chance) {
  const { rng, world } = ctx;
  const mega = ctx.opts.scale === 'mega';
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    if (!emptyAt(world, cellX, cellY, 0) || !ctx.groundOk(cellX, cellY)) continue;
    const beside = SIDES.some(([stepX, stepY]) => moduleAt(world, cellX + stepX, cellY + stepY, 0));
    if ((!beside && !mega) || !rng.chance(beside ? chance : chance / 2)) continue;
    const table = allowedIn(ctx, themed(ctx, cellX, cellY, GROUND_CAPS, GROUND_INDUSTRIAL, GROUND_ECO));
    if (table.length === 0) continue;
    const family = rng.weighted(table);
    if (family === 'buttress') leanButtress(ctx, [cellX, cellY]);
    else if (BUTT_SIDES[family] !== undefined) climbTo(ctx, [cellX, cellY], family);
    else capCell(ctx, [cellX, cellY], 0, [[family, 1]]);
  }
}

function prune(ctx) {
  const { world, opts } = ctx;
  for (let round = 0; round < PRUNE_ROUNDS; round++) {
    const problems = validateStructure(world).filter((problem) => !ctx.locked.has(problem.id));
    if (problems.length > 0) {
      for (const problem of problems) removeModule(world, problem.id);
      continue;
    }
    if (opts.unstable) return;
    const result = checkStability(bodiesOf(world));
    if (result.status === 'pass') return;
    let removed = 0;
    for (const [id, entry] of result.modules) {
      if (entry.status !== 'pass' && !ctx.locked.has(id)) {
        removeModule(world, id);
        removed++;
      }
    }
    if (removed === 0) return;
  }
}

// Facade where no railed neighbour touches the side
function setMasks(world, locked) {
  // World sides forced to facade: they meet a locked facade, or a forced one
  const forced = new Map();
  const closed = (other, side) => (locked.has(other.id) ? sideType(other, (side + 2) & 3) === 'facade' : !!forced.get(other.id) && forced.get(other.id).has((side + 2) & 3));
  const meets = (instance, side, test) => {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) {
        const other = moduleAt(world, cellX + SIDES[side][0], cellY + SIDES[side][1], level);
        if (other && other.id !== instance.id && FAMILIES[other.family].rails && test(other)) return true;
      }
    }
    return false;
  };
  const free = [...world.modules.values()].filter((instance) => FAMILIES[instance.family].rails && !locked.has(instance.id));
  for (let changed = locked.size > 0; changed; ) {
    changed = false;
    for (const instance of free) {
      for (let side = 0; side < 4; side++) {
        if ((forced.get(instance.id) || new Set()).has(side) || !meets(instance, side, (other) => closed(other, side))) continue;
        if (!forced.has(instance.id)) forced.set(instance.id, new Set());
        forced.get(instance.id).add(side);
        changed = true;
      }
    }
  }
  for (const instance of free) {
    let mask = 0;
    for (let side = 0; side < 4; side++) {
      const shut = !!forced.get(instance.id) && forced.get(instance.id).has(side);
      const joined = !shut && meets(instance, side, (other) => !closed(other, side));
      if (!joined) mask |= 1 << ((side - instance.rot + 4) & 3);
    }
    // A dock side stays a connector side
    instance.mask = mask & ~(instance.dock || 0);
  }
}

// Turns one side into a dock; returns an undo, or null
function openDock(ctx, instance, side) {
  const local = (side - instance.rot + 4) & 3;
  const kind = sideType(instance, side);
  if (kind === 'dock') return () => {};
  if (ctx.locked.has(instance.id) || !FAMILIES[instance.family].docks || kind !== 'connector') return null;
  instance.dock = (instance.dock || 0) | (1 << local);
  const undo = () => {
    instance.dock &= ~(1 << local);
    if (!instance.dock) delete instance.dock;
  };
  if (checkPlacement(ctx.world, instance).ok) return undo;
  undo();
  return null;
}

// Module that takes a bridge end: one already there, or a new one on a free top
function dockEnd(ctx, rng, cell, level, side) {
  const { world } = ctx;
  const [cellX, cellY] = cell;
  const existing = moduleAt(world, cellX, cellY, level);
  if (existing) {
    const undo = existing.z === level ? openDock(ctx, existing, side) : null;
    return undo ? { undo } : null;
  }
  if (columnTop(world, cellX, cellY, worldHeight(world)) !== level || !supportedAt(world, cellX, cellY, level)) return null;
  const family = FAMILIES[rng.weighted(allowedIn(ctx, DOCK_HOUSES))];
  const seed = ctx.towers.length > 0 ? nearestTower(ctx, cellX, cellY).seed : ctx.pool[0];
  const placed = place(ctx, { family: family.id, fp: '1x1', h: family.minStories, seed, x: cellX, y: cellY, z: level, rot: 0, dock: 1 << side });
  return placed ? { undo: () => removeModule(world, placed.id) } : null;
}

// Pier in the open cell under the middle of a long span
function pierUnder(ctx, rng, cells, level) {
  const [cellX, cellY] = cells[Math.floor(cells.length / 2)];
  const base = columnTop(ctx.world, cellX, cellY, level - 1);
  const stories = level - base;
  if (stories < FAMILIES.pier.minStories || stories > FAMILIES.pier.maxStories || !supportedAt(ctx.world, cellX, cellY, base)) return null;
  if (base === 0 && !ctx.groundOk(cellX, cellY)) return null;
  return place(ctx, { family: 'pier', fp: '1x1', h: stories, seed: rng.int(1, CAP_SEEDS), x: cellX, y: cellY, z: base, rot: 0 });
}

// Docked bridge from a cell across a gap
function dockSpan(ctx, rng, start, side, level) {
  const { world, opts } = ctx;
  const [stepX, stepY] = SIDES[side];
  const topOf = (cellX, cellY) => columnTop(world, cellX, cellY, worldHeight(world));
  const gap = [];
  let far = null;
  for (let step = 1; step <= DOCK_SPAN[1] + 1 && !far; step++) {
    const cell = [start[0] + stepX * step, start[1] + stepY * step];
    if (!ctx.inSite.has(cellKey(cell[0], cell[1]))) return null;
    // The gap floor is lower all the way across
    if (topOf(cell[0], cell[1]) < level) gap.push(cell);
    else far = cell;
  }
  if (!far || gap.length < DOCK_SPAN[0] || gap.length > DOCK_SPAN[1]) return null;
  const undos = [];
  const undoAll = () => undos.reverse().forEach((undo) => undo());
  for (const [cell, facing] of [[start, side], [far, (side + 2) & 3]]) {
    const end = dockEnd(ctx, rng, cell, level, facing);
    if (!end) {
      undoAll();
      return null;
    }
    undos.push(end.undo);
  }
  const industrial = (gap[0][0] + 0.5) * ctx.themeAxis[0] + (gap[0][1] + 0.5) * ctx.themeAxis[1] > 0;
  const bridge = place(ctx, {
    family: rng.chance(THEME_SHARE[opts.theme]) && industrial && categoryOn('gantry', opts.categories) ? 'gantry' : 'walkway',
    fp: '1x' + gap.length,
    h: 1,
    seed: rng.int(1, CAP_SEEDS),
    dock: PLUG_ENDS,
    x: Math.min(gap[0][0], gap[gap.length - 1][0]),
    y: Math.min(gap[0][1], gap[gap.length - 1][1]),
    z: level,
    rot: side & 1,
  });
  if (bridge) undos.push(() => removeModule(world, bridge.id));
  const pier = bridge && gap.length >= PIER_SPAN ? pierUnder(ctx, rng, gap, level) : null;
  if (pier) undos.push(() => removeModule(world, pier.id));
  if (bridge && (opts.unstable || quickStable(bodiesOf(world)))) return bridge;
  undoAll();
  return null;
}

// Docked walkways and gantries across gaps between buildings
function dockBridges(ctx) {
  const { world, opts } = ctx;
  const rng = makeRng(mixSeed(hashString(opts.seed), DOCK_SEED));
  let left = DOCK_TRIES[opts.density] * (opts.scale === 'mega' ? DOCK_MEGA : 1);
  for (const start of rng.shuffle(ctx.site)) {
    if (left === 0) return;
    const top = columnTop(world, start[0], start[1], worldHeight(world));
    const under = top > 0 ? moduleAt(world, start[0], start[1], top - 1) : null;
    // New dock module on a free top
    const levels = under && under.z > 0 ? [top, under.z] : [top];
    for (const level of levels.filter((entry) => entry > 0)) {
      const side = rng.shuffle([0, 1, 2, 3]).find((entry) => dockSpan(ctx, rng, start, entry, level));
      if (side === undefined) continue;
      left--;
      break;
    }
  }
}

// Drops dock sides that no bridge end meets
function dropIdleDocks(world, locked) {
  for (const instance of world.modules.values()) {
    if (!instance.dock || locked.has(instance.id) || !FAMILIES[instance.family].rails) continue;
    for (let local = 0; local < 4; local++) {
      if (((instance.dock >> local) & 1) === 0) continue;
      const side = (local + instance.rot) & 3;
      const met = instanceCells(instance).some(([cellX, cellY]) => {
        const other = moduleAt(world, cellX + SIDES[side][0], cellY + SIDES[side][1], instance.z);
        return !!other && sideType(other, (side + 2) & 3) === 'plug';
      });
      if (!met) instance.dock &= ~(1 << local);
    }
    if (!instance.dock) delete instance.dock;
  }
}

// Seeded side profiles, kept where legal and stable
function setProfiles(ctx) {
  const { world, opts } = ctx;
  const rng = makeRng(mixSeed(hashString(opts.seed), PROFILE_SEED));
  const changed = [];
  for (const instance of world.modules.values()) {
    const family = FAMILIES[instance.family];
    if (ctx.locked.has(instance.id) || !family.profiles || !PROFILE_FOOTPRINTS[instance.fp]) continue;
    const penthouse = instance.family === 'penthouse';
    if ((instance.mask & 15) === 0 || (!penthouse && !rng.chance(PROFILED_CHANCE))) continue;
    const kinds = [FLUSH, FLUSH, FLUSH, FLUSH];
    // A penthouse keeps one side without a balcony
    const bare = penthouse && (instance.mask & 15) === 15 ? rng.int(0, 3) : -1;
    const legal = () => {
      const prof = cleanProfiles(packProfiles(kinds), instance.mask, instance.fp, true);
      if (prof) instance.prof = prof;
      else delete instance.prof;
      return checkPlacement(world, instance).ok;
    };
    for (const side of rng.shuffle([0, 1, 2, 3])) {
      if (((instance.mask >> side) & 1) === 0 || side === bare) continue;
      // The side after a wrap already carries its arm
      if (penthouse && kinds[(side + 3) & 3] === WRAP) continue;
      let kind = rng.weighted(penthouse ? PENTHOUSE_KINDS : SIDE_KINDS);
      const next = (side + 1) & 3;
      if (penthouse && kind === WRAP && (next === bare || ((instance.mask >> next) & 1) === 0 || kinds[next] === WRAP)) kind = INSET_BALCONY_OUT;
      kinds[side] = kind;
      if (legal()) continue;
      kinds[side] = INSIDE_KIND[kind] || FLUSH;
      if (!legal()) kinds[side] = FLUSH;
    }
    if (!legal()) delete instance.prof;
    if (instance.prof) changed.push(instance);
  }
  if (opts.unstable || changed.length === 0) return;
  for (let round = 0; round < PROFILE_ROUNDS; round++) {
    const result = checkStability(bodiesOf(world));
    if (result.status === 'pass') return;
    const weak = changed.filter((instance) => instance.prof && result.modules.get(instance.id).status !== 'pass');
    if (weak.length === 0) break;
    for (const instance of weak) delete instance.prof;
  }
  if (checkStability(bodiesOf(world)).status !== 'pass') for (const instance of changed) delete instance.prof;
}

// True when a module sits right over a newly claimed cell
function roofedClaim(world, instance, before) {
  const old = new Set(claimedCells({ ...instance, prof: before }).map((claim) => claim.x + ',' + claim.y));
  return claimedCells(instance).some((claim) => !old.has(claim.x + ',' + claim.y) && moduleAt(world, claim.x, claim.y, instance.z + instance.h));
}

// Jettied overhangs on a few flush facade sides
function setJetties(ctx) {
  const { world, opts } = ctx;
  const rng = makeRng(mixSeed(hashString(opts.seed), JETTY_SEED));
  const changed = [];
  for (const instance of world.modules.values()) {
    const family = FAMILIES[instance.family];
    if (ctx.locked.has(instance.id) || !family.profiles || !PROFILE_FOOTPRINTS[instance.fp]) continue;
    if ((instance.mask & 15) === 0 || !rng.chance(JETTY_CHANCE)) continue;
    const before = instance.prof || 0;
    const kinds = profileKinds(before);
    const free = [0, 1, 2, 3].filter((side) => ((instance.mask >> side) & 1) === 1 && kinds[side] === FLUSH && kinds[(side + 3) & 3] !== WRAP);
    for (const side of rng.shuffle(free)) {
      const prof = cleanProfiles(packProfiles(kinds.map((kind, index) => (index === side ? JETTY : kind))), instance.mask, instance.fp, true);
      instance.prof = prof;
      if (prof !== before && checkPlacement(world, instance).ok && !roofedClaim(world, instance, before)) {
        changed.push([instance, before]);
        break;
      }
      if (before) instance.prof = before;
      else delete instance.prof;
    }
  }
  if (opts.unstable || changed.length === 0 || checkStability(bodiesOf(world)).status === 'pass') return;
  for (const [instance, before] of changed) {
    if (before) instance.prof = before;
    else delete instance.prof;
  }
}

// Struts in the open cell under a bulge
function props(ctx) {
  const { world, opts } = ctx;
  const rng = makeRng(mixSeed(hashString(opts.seed), PROP_SEED));
  const struts = [];
  for (const instance of [...world.modules.values()]) {
    if (!instance.prof || instance.z === 0) continue;
    for (const claim of claimedCells(instance)) {
      if (claim.side < 0 || !PROP_KINDS.includes(profileAt(instance.prof, (claim.side - instance.rot + 4) & 3))) continue;
      if (!rng.chance(PROP_CHANCE)) continue;
      const base = columnTop(world, claim.x, claim.y, instance.z - 1);
      const stories = instance.z - base;
      if (stories < 1 || stories > FAMILIES.strut.maxStories || !supportedAt(world, claim.x, claim.y, base)) continue;
      const strut = place(ctx, { family: 'strut', fp: '1x1', h: stories, seed: rng.int(1, CAP_SEEDS), x: claim.x, y: claim.y, z: base, rot: claim.side });
      if (strut) struts.push(strut);
    }
  }
  if (opts.unstable || struts.length === 0 || checkStability(bodiesOf(world)).status === 'pass') return;
  for (const strut of struts) removeModule(world, strut.id);
}

// Free standing supports with a balanced canopy
function supportTrees(ctx) {
  const { world, opts } = ctx;
  const rng = ctx.supportRng;
  const trees = rng.int(0, SUPPORT_TREES[opts.density][opts.scale === 'mega' ? 1 : 0]);
  // Open plinth near the structure, so a canopy has room to spread
  const near = new Set();
  for (const instance of world.modules.values()) {
    for (const [x, y] of instanceCells(instance)) for (let stepX = -CANOPY_NEAR; stepX <= CANOPY_NEAR; stepX++) for (let stepY = -CANOPY_NEAR; stepY <= CANOPY_NEAR; stepY++) near.add(cellKey(x + stepX, y + stepY));
  }
  // A block keeps to its site; a megastructure may spread onto open plinth
  const spots = opts.scale === 'mega' ? plinthCells().filter(([x, y]) => near.has(cellKey(x, y))) : ctx.site;
  for (let tree = 0; tree < trees; tree++) {
    for (const [cellX, cellY] of rng.shuffle(spots).slice(0, SUPPORT_TRIES)) {
      const stories = rng.int(1, FAMILIES.support.maxStories);
      const window = [];
      for (let stepX = -1; stepX <= 1; stepX++) for (let stepY = -1; stepY <= 1; stepY++) window.push([cellX + stepX, cellY + stepY]);
      const allowed = (x, y) => (opts.scale === 'mega' ? cellInPlinth(x, y) : ctx.inSite.has(cellKey(x, y)));
      if (!window.every(([x, y]) => allowed(x, y) && ctx.groundOk(x, y) && !onStream(ctx.stream, x, y) && emptyAt(world, x, y, 0, stories + 1))) continue;
      const added = [];
      const add = (spec) => {
        const placed = place(ctx, spec);
        if (placed) added.push(placed);
        return placed;
      };
      if (!add({ family: 'support', fp: '1x1', h: stories, seed: rng.int(1, CAP_SEEDS), x: cellX, y: cellY, z: 0, rot: 0 })) continue;
      const family = rng.weighted(allowedIn(ctx, CANOPY_FAMILIES));
      const top = add({ family, fp: '1x1', h: 1, seed: rng.int(1, 0x7fffffff), x: cellX, y: cellY, z: stories, rot: rng.int(0, 3), mask: 15 });
      const sides = rng.weighted(CANOPY_SIDES) === 4 ? SIDES : rng.pick([[SIDES[0], SIDES[2]], [SIDES[1], SIDES[3]]]);
      if (top) for (const [stepX, stepY] of sides) add({ family, fp: '1x1', h: 1, seed: rng.int(1, 0x7fffffff), x: cellX + stepX, y: cellY + stepY, z: stories, rot: rng.int(0, 3), mask: 15 });
      // A canopy that does not stand, or has no neighbours, comes down
      const keep = top && added.length >= 3 && (opts.unstable || checkStability(bodiesOf(world)).status === 'pass');
      if (!keep) for (const instance of added.reverse()) removeModule(world, instance.id);
      if (keep) break;
    }
  }
}

// Empty ground cell beside a building, footprint turned to fit
function groundSpot(ctx, rng, family, footprintId, stories) {
  const { world } = ctx;
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    if (!emptyAt(world, cellX, cellY, 0, stories) || !ctx.groundOk(cellX, cellY)) continue;
    if (!SIDES.some(([stepX, stepY]) => moduleAt(world, cellX + stepX, cellY + stepY, 0))) continue;
    const fit = fits({ rng }, footprintId, [cellX, cellY], (x, y) => ctx.inSite.has(cellKey(x, y)) && ctx.groundOk(x, y) && emptyAt(world, x, y, 0, stories));
    if (!fit) continue;
    const placed = place(ctx, { family, fp: fit.fp, h: stories, seed: rng.int(1, 0x7fffffff), x: fit.x, y: fit.y, z: 0, rot: fit.rot });
    if (placed) return placed;
  }
  return null;
}

// Open roof cell for a 1x1 cap, near a wanted family when one is
function roofSpot(ctx, rng, family, near) {
  const { world } = ctx;
  const top = worldHeight(world);
  const wanted = [...world.modules.values()].filter((instance) => near.includes(instance.family)).flatMap(instanceCells);
  const close = ([cellX, cellY]) => wanted.some(([wantX, wantY]) => Math.abs(wantX - cellX) <= NEAR_CELLS && Math.abs(wantY - cellY) <= NEAR_CELLS);
  const cells = rng.shuffle(ctx.site).filter(([cellX, cellY]) => {
    const level = columnTop(world, cellX, cellY, top);
    return level > 0 && supportedAt(world, cellX, cellY, level);
  });
  for (const cell of [...cells.filter(close), ...cells.filter((cell) => !close(cell))]) {
    const level = columnTop(world, cell[0], cell[1], top);
    const placed = place(ctx, { family, fp: '1x1', h: 1, seed: rng.int(1, 0x7fffffff), x: cell[0], y: cell[1], z: level, rot: rng.int(0, 3) });
    if (placed) return placed;
  }
  return null;
}

// Turns an outlet's stub face (local +x) to its deepest open drop
function faceOut(world, instance) {
  if (!instance) return instance;
  const top = worldHeight(world);
  let best = null;
  for (let turn = 0; turn < 4; turn++) {
    const rot = (instance.rot + turn) & 3;
    const [stepX, stepY] = SIDES[rot];
    const drop = instance.z - columnTop(world, instance.x + stepX, instance.y + stepY, top);
    if (drop >= 0 && (!best || drop > best.drop)) best = { rot, drop };
  }
  // Every side walled: the stubs would pour into a wall
  if (!best) {
    removeModule(world, instance.id);
    return null;
  }
  instance.rot = best.rot;
  return instance;
}

// Water main column from the ground up beside a building
function mainColumn(ctx, rng) {
  const { world } = ctx;
  const top = worldHeight(world);
  for (const [cellX, cellY] of rng.shuffle(ctx.site)) {
    if (!emptyAt(world, cellX, cellY, 0) || !ctx.groundOk(cellX, cellY) || columnTop(world, cellX, cellY, top) !== 0) continue;
    const beside = Math.max(...SIDES.map(([stepX, stepY]) => columnTop(world, cellX + stepX, cellY + stepY, top)));
    if (beside < MAIN_RISE[0]) continue;
    const goal = rng.int(MAIN_RISE[0], Math.min(beside, MAIN_RISE[1]));
    const column = [];
    for (let level = 0; level < goal; ) {
      const stories = rng.int(1, Math.min(FAMILIES.watermain.maxStories, goal - level));
      const placed = place(ctx, { family: 'watermain', fp: '1x1', h: stories, seed: rng.int(1, CAP_SEEDS), x: cellX, y: cellY, z: level, rot: rng.int(0, 3) });
      if (!placed) break;
      column.push(placed);
      level += stories;
    }
    if (column.length > 0) return column;
  }
  return [];
}

// Pump rooms, pumps, mains and power rooms, on their own rng
function services(ctx) {
  const { world, opts } = ctx;
  if (!opts.categories.includes(UTILITIES)) return;
  const rng = makeRng(mixSeed(hashString(opts.seed), SERVICE_SEED));
  const mega = opts.scale === 'mega' ? 1 : 0;
  const added = [];
  const keep = (instance) => instance && added.push(instance);
  const pumpRooms = rng.int(0, PUMP_ROOMS[opts.density][mega]);
  for (let room = 0; room < pumpRooms; room++) {
    const family = FAMILIES.pumproom;
    keep(groundSpot(ctx, rng, family.id, rng.pick(family.footprints), rng.int(family.minStories, family.maxStories)));
  }
  const mains = rng.int(0, MAINS[opts.density][mega]);
  for (let main = 0; main < mains; main++) mainColumn(ctx, rng).forEach(keep);
  // Some tanks get a pump, same footprint and seed
  const pumped = [];
  for (const instance of world.modules.values()) {
    if (instance.family === 'tank' && !ctx.locked.has(instance.id) && rng.chance(PUMPED_TANK_CHANCE)) {
      instance.family = 'pumptank';
      pumped.push(instance);
    }
  }
  const pumps = rng.int(0, SMALL_PUMPS[opts.density][mega]);
  for (let pump = 0; pump < pumps; pump++) keep(roofSpot(ctx, rng, 'smallpump', THIRSTY));
  const rooms = rng.int(0, POWER_ROOMS[opts.density][mega]);
  for (let room = 0; room < rooms; room++) keep(roofSpot(ctx, rng, 'powerroom', HOMES));
  // Power and water pieces, each a few per structure
  const roll = (table) => rng.int(0, table[opts.density][mega]);
  for (let count = categoryOn('generator', opts.categories) ? roll(GENERATORS) : 0; count > 0; count--) {
    const family = FAMILIES.generator;
    keep(rng.chance(GENERATOR_GROUND_SHARE) ? groundSpot(ctx, rng, family.id, rng.pick(family.footprints), rng.int(family.minStories, family.maxStories)) : roofSpot(ctx, rng, family.id, INDUSTRY));
  }
  for (let count = roll(SPRINGS); count > 0; count--) keep(groundSpot(ctx, rng, 'spring', rng.pick(FAMILIES.spring.footprints), 1));
  for (let count = roll(WELLS); count > 0; count--) keep(groundSpot(ctx, rng, 'well', '1x1', 1));
  for (let count = roll(RAIN_CATCHERS); count > 0; count--) keep(roofSpot(ctx, rng, 'raincatcher', THIRSTY));
  for (let count = categoryOn('wheelup', opts.categories) ? roll(RAISED_WHEELS) : 0; count > 0; count--) keep(roofSpot(ctx, rng, 'wheelup', ['tank', 'raincatcher']));
  for (let count = roll(RUNOFFS); count > 0; count--) keep(faceOut(world, roofSpot(ctx, rng, 'runoff', THIRSTY)));
  for (let count = categoryOn('disposal', opts.categories) ? roll(DISPOSALS) : 0; count > 0; count--) keep(faceOut(world, roofSpot(ctx, rng, 'disposal', INDUSTRY)));
  // Water wheels stand on open stream cells, turned with the flow
  if (ctx.stream) {
    let wheels = rng.int(0, STREAM_WHEELS[opts.density]);
    for (const [cellX, cellY] of rng.shuffle(ctx.stream.cells)) {
      if (wheels <= 0) break;
      if (!ctx.inSite.has(cellKey(cellX, cellY)) || !emptyAt(world, cellX, cellY, 0, FAMILIES.wheel.maxStories)) continue;
      const placed = place(ctx, { family: 'wheel', fp: '1x1', h: rng.int(1, FAMILIES.wheel.maxStories), seed: rng.int(1, CAP_SEEDS), x: cellX, y: cellY, z: 0, rot: (ctx.stream.alongX ? 0 : 1) + rng.int(0, 1) * 2 });
      if (placed) {
        keep(placed);
        wheels--;
      }
    }
  }
  // Some wall-bearing modules carry a junction box
  for (const instance of world.modules.values()) {
    if (!ctx.locked.has(instance.id) && JUNCTION_FAMILIES.includes(instance.family) && !instance.jb && rng.chance(JUNCTION_CHANCE)) instance.jb = 1;
  }
  if (opts.unstable) return;
  // New parts go again until the structure passes
  for (let round = 0; round < SERVICE_ROUNDS && added.length > 0; round++) {
    const result = checkStability(bodiesOf(world));
    if (result.status === 'pass') return;
    const failing = added.filter((instance) => result.modules.get(instance.id).status !== 'pass');
    for (const instance of failing.length > 0 ? failing : added.splice(0)) removeModule(world, instance.id);
    for (const instance of failing) added.splice(added.indexOf(instance), 1);
  }
  // Still failing: drop every service part and pumped tank
  if (checkStability(bodiesOf(world)).status === 'pass') return;
  for (const instance of added) removeModule(world, instance.id);
  for (const instance of pumped) instance.family = 'tank';
}

// Plan centre of a module in cells, and the story of its top
const centreOf = (instance) => {
  const cells = instanceCells(instance);
  return [cells.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / cells.length, cells.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / cells.length, instance.z + instance.h];
};
// Wire run between two modules as cells across plus stories between: a short guess at the real route
const runBetween = (first, second) => {
  const [ax, ay, az] = centreOf(first);
  const [bx, by, bz] = centreOf(second);
  return (Math.hypot(ax - bx, ay - by) + Math.abs(az - bz)) * PLANNER_ROUTE_FACTOR;
};
// Power and water role of a module from the tables, without the solvers
function roleOf(instance) {
  const family = instance.family;
  if (POWER_SUPPLY[family] || family === 'wheelup') return { power: 'source', supply: (POWER_SUPPLY[family] || POWER_SUPPLY.wheelup)[0] || PLANNER_WHEEL_GUESS, reach: (POWER_SUPPLY[family] || POWER_SUPPLY.wheelup)[1] };
  if (POWER_RELAYS[family]) return { power: 'relay', reach: POWER_RELAYS[family][0] };
  const demand = family === 'plant' ? (hasPump(instance) ? POWER_DEMAND.plantpump : 0) : POWER_DEMAND[family] || 0;
  return { power: demand > 0 ? 'consumer' : null, demand };
}
const thirst = (instance) => (DEMAND_PER_CELL[instance.family] || 0) * instanceCells(instance).length + (DEMAND_PER_MODULE[instance.family] || 0);

// Open roof cell near a module, the nearest first, at or above a story when asked
function roofNear(ctx, rng, family, target, reach, lowest = 0) {
  const { world } = ctx;
  const top = worldHeight(world);
  const [x, y] = centreOf(target);
  const cells = ctx.site
    .map(([cellX, cellY]) => ({ cellX, cellY, level: columnTop(world, cellX, cellY, top), gap: Math.hypot(cellX + 0.5 - x, cellY + 0.5 - y) }))
    .filter(({ cellX, cellY, level, gap }) => level > 0 && level >= lowest && gap <= reach && supportedAt(world, cellX, cellY, level))
    .sort((first, second) => first.gap - second.gap || first.cellX - second.cellX || first.cellY - second.cellY);
  for (const { cellX, cellY, level } of cells.slice(0, PLANNER_TRIES)) {
    const placed = place(ctx, { family, fp: '1x1', h: FAMILIES[family].minStories, seed: rng.int(1, 0x7fffffff), x: cellX, y: cellY, z: level, rot: rng.int(0, 3) });
    if (placed) return placed;
  }
  return null;
}

// Empty ground cell beside a building near a module, the nearest first
function groundNear(ctx, rng, family, target, reach) {
  const { world } = ctx;
  const [x, y] = centreOf(target);
  const spec = FAMILIES[family];
  // A megastructure may use open plinth beside it; a block keeps to its site
  const cells = (ctx.opts.scale === 'mega' ? plinthCells() : ctx.site)
    .map(([cellX, cellY]) => ({ cellX, cellY, gap: Math.hypot(cellX + 0.5 - x, cellY + 0.5 - y) }))
    .filter(({ cellX, cellY, gap }) => gap <= reach && ctx.groundOk(cellX, cellY) && !onStream(ctx.stream, cellX, cellY) && emptyAt(world, cellX, cellY, 0, spec.maxStories) && SIDES.some(([stepX, stepY]) => moduleAt(world, cellX + stepX, cellY + stepY, 0)))
    .sort((first, second) => first.gap - second.gap || first.cellX - second.cellX || first.cellY - second.cellY);
  for (const { cellX, cellY } of cells.slice(0, PLANNER_TRIES)) {
    const placed = place(ctx, { family, fp: '1x1', h: spec.minStories, seed: rng.int(1, 0x7fffffff), x: cellX, y: cellY, z: 0, rot: rng.int(0, 3) });
    if (placed) return placed;
  }
  return null;
}

// Water a module holds of its own, in units, from the source table
function ownWater(instance) {
  if (SOURCE_FAMILIES[instance.family]) return WATER_SOURCES[SOURCE_FAMILIES[instance.family]][0];
  return hasPump(instance) && PUMP_KINDS[instance.family] ? WATER_SOURCES[PUMP_KINDS[instance.family]][0] : 0;
}

// Greedy cover: each consumer takes from the nearest source in reach that has enough left
function cover(consumers, sources, need, reachOf, left) {
  const unserved = [];
  for (const consumer of consumers) {
    const options = sources.filter((source) => left.get(source.id) >= need(consumer) && runBetween(source, consumer) <= reachOf(source, consumer)).sort((first, second) => runBetween(first, consumer) - runBetween(second, consumer) || first.id - second.id);
    if (options.length === 0) unserved.push(consumer);
    else left.set(options[0].id, left.get(options[0].id) - need(consumer));
  }
  return unserved;
}

// Services planner: powers pumps, adds pumps and sources near consumers left without, a share by level; never removes
function fillServices(ctx) {
  const { world, opts } = ctx;
  const share = PLANNER_SHARE[opts.services];
  if (!share || !opts.categories.includes(UTILITIES)) return;
  const rng = makeRng(mixSeed(hashString(opts.seed), PLANNER_SEED));
  const added = [];
  const keep = (instance) => {
    if (instance) added.push(instance);
    return instance;
  };
  const all = () => [...world.modules.values()];
  // A source near a module: on a roof when one is free, else on the ground beside a building
  const powerNear = (target) => {
    const family = rng.weighted(allowedIn(ctx, opts.services === 'high' ? PLANNER_SOURCES_HIGH : PLANNER_SOURCES));
    return keep(roofNear(ctx, rng, family, target, PLANNER_POWER_REACH)) || keep(groundNear(ctx, rng, family, target, PLANNER_POWER_REACH));
  };
  // Water: dry consumers get a pump room beside them now; rain catchers wait until power has its roofs
  const order = rng.shuffle(all().filter((instance) => thirst(instance) > 0));
  const waterLeft = new Map(all().map((instance) => [instance.id, ownWater(instance)]));
  const waterReach = (source, consumer) => (hasPump(source) || source.z + source.h >= consumer.z + consumer.h ? PLANNER_PUMP_REACH : 0);
  const stillDry = [];
  for (const consumer of cover(order, all().filter((instance) => ownWater(instance) > 0), thirst, waterReach, waterLeft)) {
    if (!rng.chance(share)) continue;
    const piece = rng.chance(PLANNER_PUMP_ROOM_SHARE) ? keep(groundNear(ctx, rng, rng.weighted(PLANNER_GROUND_WATER), consumer, PLANNER_PUMP_REACH)) : null;
    if (!piece) {
      stillDry.push(consumer);
      continue;
    }
    waterLeft.set(piece.id, ownWater(piece) - thirst(consumer));
    // Later consumers may share the new piece
    for (const other of all()) if (!waterLeft.has(other.id)) waterLeft.set(other.id, ownWater(other));
  }
  // Power: pumps first, then the rest; each source serves up to its supply
  // A copy, since served consumers leave the list
  for (const consumer of [...stillDry]) {
    const piece = rng.chance(PLANNER_TANK_SHARE) ? keep(roofNear(ctx, rng, 'pumptank', consumer, PLANNER_WATER_REACH, consumer.z + consumer.h)) : null;
    if (piece) stillDry.splice(stillDry.indexOf(consumer), 1);
  }
  const powerLeft = new Map(all().map((instance) => [instance.id, roleOf(instance).power === 'source' ? roleOf(instance).supply : 0]));
  const consumers = all().filter((instance) => roleOf(instance).power === 'consumer');
  const pumpsFirst = [...rng.shuffle(consumers.filter((instance) => hasPump(instance))), ...rng.shuffle(consumers.filter((instance) => !hasPump(instance)))];
  const relayReach = (instance) => (POWER_RELAYS[instance.family] ? POWER_RELAYS[instance.family][0] : instance.jb ? POWER_RELAYS.junction[0] : 0);
  // A source reaches straight or through a relay within both reaches
  const powerReach = (source, consumer) => Math.max(roleOf(source).reach, ...all().filter((relay) => relayReach(relay) > 0 && runBetween(source, relay) <= roleOf(source).reach && runBetween(relay, consumer) <= relayReach(relay)).map(() => Infinity));
  for (const consumer of cover(pumpsFirst, all().filter((instance) => roleOf(instance).power === 'source'), (instance) => roleOf(instance).demand, powerReach, powerLeft)) {
    if (!rng.chance(share)) continue;
    // A junction box when a source with power to spare is near, else a source of its own
    const spare = all().find((source) => powerLeft.get(source.id) >= roleOf(consumer).demand && runBetween(source, consumer) <= roleOf(source).reach + POWER_RELAYS.junction[0]);
    if (spare && JUNCTION_FAMILIES.includes(consumer.family) && !consumer.jb && !ctx.locked.has(consumer.id)) {
      consumer.jb = 1;
      powerLeft.set(spare.id, powerLeft.get(spare.id) - roleOf(consumer).demand);
      continue;
    }
    const source = powerNear(consumer);
    if (source) powerLeft.set(source.id, roleOf(source).supply - roleOf(consumer).demand);
  }
  // Rain catchers on the roofs left, above consumers still dry
  for (const consumer of stillDry) {
    const piece = keep(roofNear(ctx, rng, rng.weighted(PLANNER_ROOF_WATER), consumer, PLANNER_WATER_REACH, consumer.z + consumer.h));
    if (!piece) keep(groundNear(ctx, rng, rng.weighted(PLANNER_GROUND_WATER), consumer, PLANNER_PUMP_REACH));
  }
  if (opts.unstable || added.length === 0) return;
  // New parts go again until the structure passes, as the services pass does
  for (let round = 0; round < SERVICE_ROUNDS && added.length > 0; round++) {
    const result = checkStability(bodiesOf(world));
    if (result.status === 'pass') return;
    const failing = added.filter((instance) => result.modules.get(instance.id).status !== 'pass');
    for (const instance of failing.length > 0 ? failing : added.splice(0)) removeModule(world, instance.id);
    for (const instance of failing) added.splice(added.indexOf(instance), 1);
  }
}

function unit(ctx) {
  const { rng } = ctx;
  const family = FAMILIES[rng.pick(FAMILY_IDS.filter((id) => !UNIT_SKIP.includes(id) && categoryOn(id, ctx.opts.categories)))];
  const footprintId = rng.pick(family.footprints);
  const rot = rng.int(0, 3);
  const cells = footprintCells(footprintId, rot);
  const sizeX = Math.max(...cells.map((cell) => cell[0])) + 1;
  const sizeY = Math.max(...cells.map((cell) => cell[1])) + 1;
  let stories = family.minStories;
  for (let roll = 0; roll < UNIT_HEIGHT_TRIES; roll++) stories = Math.max(stories, rng.int(family.minStories, family.maxStories));
  place(ctx, {
    family: family.id,
    fp: footprintId,
    h: stories,
    seed: rng.int(1, 0x7fffffff),
    roof: family.roofable && rng.chance(0.5),
    x: -Math.ceil(sizeX / 2),
    y: -Math.ceil(sizeY / 2),
    z: 0,
    rot,
  });
}

// Categories from a list, a comma string or an object of flags; unknown names drop out
export function categoryList(given) {
  if (given === undefined || given === null) return CATEGORIES.slice();
  const names = Array.isArray(given) ? given : typeof given === 'string' ? given.split(',') : Object.keys(given).filter((name) => given[name]);
  return CATEGORIES.filter((name) => names.map((entry) => String(entry).trim()).includes(name));
}

export function normalizeOptions(options = {}) {
  const level = (value) => Math.min(2, Math.max(0, Number.isFinite(+value) ? Math.round(+value) : 1));
  return {
    seed: String(options.seed === undefined ? 'arco' : options.seed),
    scale: SCALES.includes(options.scale) ? options.scale : 'block',
    density: level(options.density),
    height: level(options.height),
    daring: level(options.daring),
    theme: level(options.theme),
    unstable: !!options.unstable,
    budget: options.budget ? Math.min(MAX_MODULES, options.budget) : 0,
    budgetMin: options.budgetMin || 0,
    // Module cap from the budget control; a plain limit, not part of the seed
    cap: options.cap ? Math.min(BUDGET_HARD_CAP, Math.max(1, Math.round(options.cap))) : 0,
    rise: !!options.rise,
    // Services planner level; its own rolls, so the layout stays the same
    services: SERVICE_LEVELS.includes(options.services) ? options.services : 'low',
    // Categories on, as a sorted list; all on by default
    categories: categoryList(options.categories),
    locked: options.locked || [],
  };
}

// Small random block for the first view
export function openingOptions(seed) {
  const rng = makeRng(mixSeed(hashString(String(seed)), 0x0be9));
  return {
    seed: String(seed),
    scale: 'block',
    density: 1,
    height: 1,
    daring: 1,
    theme: 1,
    budget: rng.int(Math.round((OPENING_UNIT_MIN + OPENING_UNIT_MAX) / 2), OPENING_UNIT_MAX),
    budgetMin: OPENING_UNIT_MIN,
  };
}

export function generate(options) {
  const opts = normalizeOptions(options);
  // Categories join the seed only when some are off, so all on keeps the layout
  // Theme categories as before, so old links keep their layout; utilities off adds a mark
  const themes = CATEGORIES.filter((name) => name !== UTILITIES);
  const themesOn = opts.categories.filter((name) => themes.includes(name));
  const choiceText = [opts.scale, opts.density, opts.height, opts.daring, opts.theme, opts.unstable ? 1 : 0, opts.budget].join(':') + (themesOn.length < themes.length ? ':' + themesOn.join(',') : '') + (opts.categories.includes(UTILITIES) ? '' : ':' + UTILITIES_OFF_TEXT);
  const rng = makeRng(mixSeed(hashString(opts.seed), hashString(choiceText)));
  const world = worldFromModules(opts.locked);
  const ctx = {
    rng,
    opts,
    world,
    locked: new Set(world.modules.keys()),
    limit: opts.budget || opts.cap || MAX_MODULES,
    capped: false,
    towers: [],
    pool: Array.from({ length: STYLE_POOL }, () => rng.int(1, 0x7fffffff)),
    // A unit stands alone; larger scales share the seed's stream
    stream: opts.scale === 'unit' ? null : streamOf(opts.seed),
    supportRng: makeRng(mixSeed(hashString(opts.seed), SUPPORT_SEED)),
  };
  const angle = rng.range(0, Math.PI * 2);
  ctx.themeAxis = [Math.cos(angle), Math.sin(angle)];
  const lockedCells = [...world.modules.values()].flatMap(instanceCells);
  ctx.lockedCenter = lockedCells.length === 0 ? null : [0, 1].map((axis) => lockedCells.reduce((sum, cell) => sum + cell[axis] + 0.5, 0) / lockedCells.length);
  if (opts.scale === 'unit') {
    unit(ctx);
  } else {
    planSite(ctx);
    ctx.groundOk = (cellX, cellY) => canyonCell(ctx, cellX, cellY) !== 'gate';
    planTowers(ctx);
    planHeights(ctx);
    massing(ctx);
    cantilevers(ctx);
    penthouses(ctx);
    spans(ctx);
    dockBridges(ctx);
    roofs(ctx);
    // The planner goes before dressing, while roofs and ground are still free
    fillServices(ctx);
    dressTops(ctx, CAP_CHANCE[opts.density]);
    dressGround(ctx, GROUND_CHANCE[opts.density]);
    for (let round = 0; round < TOPUP_ROUNDS && world.modules.size < opts.budgetMin; round++) {
      dressTops(ctx, 1);
      dressGround(ctx, 1);
    }
    prune(ctx);
  }
  // Canopies first, so shared sides become rails
  if (opts.scale !== 'unit') supportTrees(ctx);
  dropIdleDocks(world, ctx.locked);
  setMasks(world, ctx.locked);
  setProfiles(ctx);
  if (opts.scale !== 'unit') props(ctx);
  setJetties(ctx);
  if (opts.scale !== 'unit') services(ctx);
  setBridgeEnds(world, ctx.locked);
  // Platforms open toward walls, railed where they face out
  for (const instance of world.modules.values()) if (OPEN_SIDE_FAMILIES.includes(instance.family) && !ctx.locked.has(instance.id)) instance.mask = outwardMask(world, instance);
  const modules = [...world.modules.values()].sort(
    (first, second) => first.z - second.z || first.y - second.y || first.x - second.x || first.id - second.id
  );
  return { modules, seed: opts.seed, options: opts, capped: ctx.capped, hash: structureHash(modules), stream: streamRecord(ctx.stream) };
}
