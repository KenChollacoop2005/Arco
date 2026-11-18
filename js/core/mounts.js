import { CELL_MM, STORY_MM, PORT_RAY_OUT_MM, PORT_RAY_IN_MM, PORT_RAY_STEP_MM, PORT_TRIES, PORT_FRONT_MM } from '../config.js';
import { FOOTPRINTS, SIDES, instancePose, poseApply, variantKey, worldFromModules, moduleAt, instanceCells } from './grid.js';
import { FAMILIES, hasPump, JUNCTION_FAMILIES } from './catalog.js';
import { PORT_TYPES } from './ports.js';
import { buildRecipe } from './recipes.js';
import { variantColliders } from './physics.js';
import { makeRng, mixSeed, hashString } from './rng.js';
import { inShape, groupAt, inBox } from './kit.js';

export { inShape, groupAt };

const MOUNT_SEED = 0x90b7; // keeps port rolls apart from shape rolls
const REFINE_STEPS = 14; // halvings after the probe hits
const ALONG = [0.15, 0.85]; // default spot along a cell edge, share
const WIDE_Z = [0.08, 0.96]; // height range of the fallback tries, share
// Groups a bracket never sits on
const NO_MOUNT = new Set(['glass', 'pane', 'plant', 'plantDark', 'plantLight', 'soil', 'rotor', 'blade', 'wheel', 'tarpTerracotta', 'tarpMustard', 'tarpTeal']);
export const MOUNT_EACH = ['module', 'side', 'cell', 'story'];

// Rule presets: type, sides, each, height share (z) or mm (zMm), along, capacity, roof
const GUTTER = { type: 'water-out', sides: 'facade', each: 'module', z: [0.86, 0.96], roof: true };
const LIT = { type: 'power', sides: 'facade', each: 'module', z: [0.55, 0.9] };
const HOME = [
  { type: 'power', sides: 'facade', each: 'side', z: [0.55, 0.9] },
  { type: 'water-in', sides: 'facade', each: 'module', z: [0.15, 0.45] },
  { type: 'line', sides: 'facade', each: 'side', z: [0.5, 0.85] },
  GUTTER,
];
const BED = (low, high) => [
  { type: 'water-in', sides: 'any', each: 'module', zMm: [low, high], along: [0.3, 0.7] },
  { type: 'water-out', sides: 'any', each: 'module', zMm: [low, high], along: [0.3, 0.7] },
];
const TANK = [
  { type: 'water-out', sides: 'any', each: 'module', zMm: [4, 9], along: [0.4, 0.6] },
  { type: 'water-in', sides: 'any', each: 'module', z: [0.5, 0.7], along: [0.4, 0.6] },
];
const MACHINE = (low, high) => [{ type: 'power', sides: 'any', each: 'module', zMm: [low, high], along: [0.35, 0.65] }];
const JUNCTION = { type: 'power', sides: 'facade', each: 'module', z: [0.3, 0.6], along: [0.25, 0.75], capacity: 4, relay: true, when: 'jbox' };

// Physical string ports per family, resolved on the real surface
export const MOUNT_PORTS = {
  core: [GUTTER],
  pilotis: [GUTTER],
  transfer: [GUTTER],
  podium: [GUTTER],
  panel: [GUTTER],
  brise: [GUTTER],
  fins: [GUTTER],
  housing: HOME,
  studio: HOME,
  penthouse: HOME,
  shacks: HOME,
  flared: HOME,
  hall: [LIT, GUTTER],
  shop: [LIT, GUTTER],
  stair: [LIT, GUTTER],
  deck: [LIT, { type: 'line', sides: 'facade', each: 'module', z: [0.5, 0.85] }, GUTTER],
  spout: [{ type: 'water-out', sides: 'facade', each: 'module', z: [0.3, 0.7] }],
  balcony: [{ type: 'line', sides: 'any', each: 'module', zMm: [3, 7.5] }],
  terrace: [{ type: 'line', sides: 'any', each: 'side', zMm: [3, 5.5] }],
  market: [{ type: 'line', sides: 'any', each: 'side', zMm: [2.5, 11] }],
  farm: BED(2.8, 5.2),
  planter: BED(3.2, 6.5),
  planted: BED(3.2, 6.5),
  garden: BED(3.2, 6.5),
  greenhouse: BED(0.6, 2.6),
  tank: TANK,
  pumptank: TANK,
  turbine: [{ type: 'power', sides: 'any', each: 'module', zMm: [5, 12], along: [0.45, 0.55], capacity: 4 }],
  solar: [{ type: 'power', sides: 'any', each: 'module', zMm: [2.8, 4.5], along: [0.3, 0.7], capacity: 4 }],
  plant: [
    ...MACHINE(4, 15),
    { type: 'water-in', sides: 'any', each: 'module', zMm: [3, 15], when: 'pump' },
    { type: 'water-out', sides: 'any', each: 'module', zMm: [3, 15], when: 'pump' },
  ],
  smokestack: MACHINE(1, 4),
  chimney: MACHINE(1, 4),
  cooling: MACHINE(0.5, 2),
  tankfarm: MACHINE(3, 8),
  pumproom: [
    { type: 'water-in', sides: 'any', each: 'side', z: [0.12, 0.5] },
    { type: 'water-out', sides: 'any', each: 'side', z: [0.12, 0.5] },
    { type: 'power', sides: 'any', each: 'module', z: [0.6, 0.9] },
  ],
  watermain: [
    { type: 'water-in', sides: 'any', each: 'side', zMm: [4, 9], along: [0.42, 0.58] },
    { type: 'water-out', sides: 'any', each: 'story', z: [0.15, 0.3], along: [0.42, 0.58] },
  ],
  powerroom: [{ type: 'power', sides: 'any', each: 'cell', zMm: [5.5, 11], along: [0.38, 0.62], capacity: 4 }],
  smallpump: [
    { type: 'water-in', sides: 'any', each: 'module', zMm: [5, 13], along: [0.4, 0.5] },
    { type: 'water-out', sides: 'any', each: 'module', zMm: [5, 13], along: [0.4, 0.5] },
    ...MACHINE(1.5, 3.5),
  ],
  generator: [{ type: 'power', sides: 'any', each: 'side', z: [0.2, 0.5], along: [0.3, 0.7], capacity: 4 }],
  spring: [{ type: 'water-out', sides: 'any', each: 'module', zMm: [5.3, 5.8], along: [0.35, 0.65] }],
  raincatcher: [{ type: 'water-out', sides: 'any', each: 'module', zMm: [3, 9], along: [0.4, 0.6] }],
  well: [
    { type: 'water-out', sides: 'any', each: 'module', zMm: [1.5, 5.5], along: [0.4, 0.6] },
    { type: 'power', sides: 'any', each: 'module', zMm: [7, 10], along: [0.3, 0.7] },
  ],
  wheel: [{ type: 'power', sides: 'any', each: 'module', zMm: [4, 10], along: [0.2, 0.4], capacity: 4 }],
  wheelup: [
    { type: 'water-in', sides: 'any', each: 'module', zMm: [21.5, 23], along: [0.25, 0.4] },
    { type: 'water-out', sides: 'any', each: 'module', zMm: [1.5, 3.5], along: [0.4, 0.6] },
    { type: 'power', sides: 'any', each: 'module', zMm: [6, 12], along: [0.2, 0.35] },
  ],
  runoff: [{ type: 'water-in', sides: 'any', each: 'module', zMm: [2, 6], along: [0.4, 0.6] }],
  disposal: [{ type: 'water-in', sides: 'any', each: 'module', zMm: [2, 6], along: [0.4, 0.6] }],
};
// A pumped tank gets a power bracket after its water ports
MOUNT_PORTS.pumptank = [...TANK, ...MACHINE(4, 9)];
// A junction box sits on an outward wall of wall-bearing families that carry one
for (const family of JUNCTION_FAMILIES) MOUNT_PORTS[family] = [...(MOUNT_PORTS[family] || []), JUNCTION];

// First surface along a ray: the last free point and the group hit
export function probeSurface(ops, start, direction, reach) {
  const along = (distance) => [0, 1, 2].map((axis) => start[axis] + direction[axis] * distance);
  if (groupAt(ops, start)) return null;
  for (let distance = PORT_RAY_STEP_MM; distance <= reach; distance += PORT_RAY_STEP_MM) {
    if (!groupAt(ops, along(distance))) continue;
    let free = distance - PORT_RAY_STEP_MM;
    let solid = distance;
    for (let step = 0; step < REFINE_STEPS; step++) {
      const middle = (free + solid) / 2;
      if (groupAt(ops, along(middle))) solid = middle;
      else free = middle;
    }
    return { point: along(free), group: groupAt(ops, along(solid)), depth: free };
  }
  return null;
}

// Outer cell edges of one local side
function sideEdges(cells, side) {
  const normal = SIDES[side];
  const has = (cellX, cellY) => cells.some((cell) => cell[0] === cellX && cell[1] === cellY);
  return cells.filter(([cellX, cellY]) => !has(cellX + normal[0], cellY + normal[1]));
}

// Cell edges a rule may use, grouped as the rule repeats
function edgeGroups(rule, variant, cells) {
  const sides = [0, 1, 2, 3].filter((side) => rule.sides === 'any' || ((variant.mask >> side) & 1) === 1);
  const edges = sides.flatMap((side) => sideEdges(cells, side).map((cell) => ({ side, cell })));
  if (rule.each === 'module') return edges.length > 0 ? [edges] : [];
  if (rule.each === 'side') return sides.map((side) => edges.filter((edge) => edge.side === side)).filter((group) => group.length > 0);
  if (rule.each === 'cell') return edges.map((edge) => [edge]);
  return edges.flatMap((edge) => Array.from({ length: variant.h }, (unused, story) => [{ ...edge, story }]));
}

// One port on a real surface, or null when every try misses
function placePort(ops, rule, variant, group, rng) {
  const height = variant.h * STORY_MM;
  const [alongLow, alongHigh] = rule.along || ALONG;
  for (let attempt = 0; attempt < PORT_TRIES * 2; attempt++) {
    // Second half of the tries uses the whole wall height
    const wide = attempt >= PORT_TRIES;
    const { side, cell, story } = rng.pick(group);
    const normal = SIDES[side];
    const tangent = [-normal[1], normal[0]];
    let low = rule.zMm ? rule.zMm[0] : rule.z[0] * height;
    let high = rule.zMm ? rule.zMm[1] : rule.z[1] * height;
    if (story !== undefined) {
      low = story * STORY_MM + (rule.z ? rule.z[0] : 0) * STORY_MM;
      high = story * STORY_MM + (rule.z ? rule.z[1] : 1) * STORY_MM;
    }
    if (wide && rule.z) [low, high] = story === undefined ? [WIDE_Z[0] * height, WIDE_Z[1] * height] : [story * STORY_MM, (story + 1) * STORY_MM];
    const along = rng.range(alongLow, alongHigh) - 0.5;
    const edgeX = (cell[0] + 0.5 + normal[0] / 2 + tangent[0] * along) * CELL_MM;
    const edgeY = (cell[1] + 0.5 + normal[1] / 2 + tangent[1] * along) * CELL_MM;
    const start = [edgeX + normal[0] * PORT_RAY_OUT_MM, edgeY + normal[1] * PORT_RAY_OUT_MM, rng.range(low, Math.min(high, height))];
    const hit = probeSurface(ops, start, [-normal[0], -normal[1], 0], PORT_RAY_OUT_MM + PORT_RAY_IN_MM);
    if (!hit || NO_MOUNT.has(hit.group)) continue;
    return { side, position: hit.point, normal: [normal[0], normal[1], 0], surface: hit.group };
  }
  return null;
}

const portCache = new Map();

// String ports of a variant in its local mesh frame, from its seed
export function variantMounts(variant, rules = MOUNT_PORTS[variant.family] || []) {
  const key = variantKey(variant);
  if (rules === MOUNT_PORTS[variant.family] && portCache.has(key)) return portCache.get(key);
  const ports = [];
  if (rules.length > 0) {
    const { ops } = buildRecipe(variant);
    const cells = FOOTPRINTS[variant.fp];
    const rng = makeRng(mixSeed(variant.seed >>> 0, MOUNT_SEED));
    for (const rule of rules) {
      const kind = PORT_TYPES[rule.type];
      if (!kind || (rule.when === 'pump' && !hasPump(variant)) || (rule.when === 'jbox' && !variant.jb)) continue;
      for (const group of edgeGroups(rule, variant, cells)) {
        const port = placePort(ops, rule, variant, group, rng);
        if (!port) continue;
        ports.push({ index: ports.length, type: rule.type, capacity: rule.capacity === undefined ? kind.capacity : rule.capacity, roof: !!rule.roof, ...(rule.relay ? { relay: true } : {}), ...port });
      }
    }
  }
  if (rules === MOUNT_PORTS[variant.family]) portCache.set(key, ports);
  return ports;
}

// String ports of a placed module in world mm
export function instanceMounts(instance) {
  const pose = instancePose(instance);
  return variantMounts(instance).map((port) => {
    const turned = poseApply({ turns: pose.turns, x: 0, y: 0, z: 0 }, port.normal[0], port.normal[1], port.normal[2]);
    return {
      ...port,
      module: instance.id,
      side: (port.side + instance.rot) & 3,
      position: poseApply(pose, port.position[0], port.position[1], port.position[2]),
      normal: turned.map((part) => Math.round(part)),
    };
  });
}

// Collider boxes of every module in world mm
export function worldColliders(modules) {
  const boxes = [];
  for (const instance of modules) {
    const pose = instancePose(instance);
    for (const shape of variantColliders(instance)) {
      const cornerA = poseApply(pose, shape.min[0], shape.min[1], shape.min[2]);
      const cornerB = poseApply(pose, shape.max[0], shape.max[1], shape.max[2]);
      boxes.push({ module: instance.id, min: cornerA.map((value, axis) => Math.min(value, cornerB[axis])), max: cornerA.map((value, axis) => Math.max(value, cornerB[axis])) });
    }
  }
  return boxes;
}

// True when a module has nothing on any of its top cells
function roofOpen(world, instance) {
  return instanceCells(instance).every(([cellX, cellY]) => !moduleAt(world, cellX, cellY, instance.z + instance.h));
}

// Every string port of a structure, with active false when blocked
export function structureMounts(modules, boxes = worldColliders(modules)) {
  const world = worldFromModules(modules);
  const ports = [];
  for (const instance of modules) {
    const open = roofOpen(world, instance);
    for (const port of instanceMounts(instance)) {
      const front = port.position.map((value, axis) => value + port.normal[axis] * PORT_FRONT_MM);
      const blocker = boxes.find((shape) => shape.module !== instance.id && inBox(shape, front));
      const reason = blocker ? 'neighbour' : port.roof && !open ? 'roofed' : null;
      ports.push({ ...port, active: !reason, reason });
    }
  }
  return ports;
}
