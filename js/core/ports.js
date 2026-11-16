import { CELL_MM, STORY_MM } from '../config.js';
import { FOOTPRINTS, SIDES, instancePose, poseApply } from './grid.js';

// Port types: label and default capacity
export const PORT_TYPES = {
  wire: { label: 'Wire', capacity: 2 },
  pipe: { label: 'Pipe', capacity: 1 },
  outlet: { label: 'Outlet', capacity: 1 },
  inlet: { label: 'Inlet', capacity: 1 },
  basin: { label: 'Catch basin', capacity: 4 },
  hook: { label: 'Cable hook', capacity: 2 },
  balcony: { label: 'Balcony slot', capacity: 1 },
  infill: { label: 'Infill slot', capacity: 1 },
  seat: { label: 'Bearing seat', capacity: 1 },
};

export const PORT_FACES = ['top', 'bottom', 'facade', 'connector', 'side'];
export const PORT_REPEATS = ['module', 'cell', 'story'];

// Rules per family: type, face, each, at, capacity
export const FAMILY_PORTS = {
  housing: [
    { type: 'wire', face: 'facade', each: 'cell', at: [0.5, 0.85] },
    { type: 'balcony', face: 'facade', each: 'story', at: [0.5, 0.3] },
    { type: 'infill', face: 'facade', each: 'story', at: [0.5, 0.5] },
  ],
  penthouse: [
    { type: 'balcony', face: 'facade', each: 'story', at: [0.5, 0.1] },
    { type: 'wire', face: 'facade', each: 'cell', at: [0.5, 0.85] },
  ],
  shacks: [
    { type: 'hook', face: 'facade', each: 'story', at: [0.5, 0.9] },
    { type: 'wire', face: 'facade', each: 'cell', at: [0.5, 0.85] },
  ],
  flared: [{ type: 'wire', face: 'facade', each: 'cell', at: [0.5, 0.85] }],
  strut: [{ type: 'seat', face: 'top', each: 'module', at: [0.5, 0.5] }],
  walkway: [{ type: 'seat', face: 'bottom', each: 'cell', at: [0.5, 0.5] }],
  gantry: [{ type: 'seat', face: 'bottom', each: 'cell', at: [0.5, 0.5] }],
  tank: [
    { type: 'inlet', face: 'top', each: 'module', at: [0.5, 0.5] },
    { type: 'outlet', face: 'side', each: 'module', at: [0.5, 0.15] },
  ],
  pipes: [{ type: 'pipe', face: 'side', each: 'cell', at: [0.5, 0.5] }],
  turbine: [{ type: 'wire', face: 'side', each: 'module', at: [0.5, 0.2], capacity: 8 }],
  solar: [{ type: 'wire', face: 'side', each: 'module', at: [0.5, 0.5], capacity: 4 }],
  farm: [{ type: 'inlet', face: 'top', each: 'cell', at: [0.5, 0.5] }],
  garden: [{ type: 'basin', face: 'top', each: 'module', at: [0.5, 0.5] }],
  market: [{ type: 'hook', face: 'facade', each: 'cell', at: [0.5, 0.9] }],
};

// Outer cell edges of one local side
function sideEdges(cells, side) {
  const normal = SIDES[side];
  const has = (cellX, cellY) => cells.some((cell) => cell[0] === cellX && cell[1] === cellY);
  return cells.filter(([cellX, cellY]) => !has(cellX + normal[0], cellY + normal[1]));
}

function sideMatches(face, variant, side) {
  if (face === 'side') return true;
  const facade = ((variant.mask >> side) & 1) === 1;
  return face === 'facade' ? facade : !facade;
}

function flatPorts(rule, variant, cells) {
  const top = rule.face === 'top';
  const used = rule.each === 'module' ? cells.slice(0, 1) : cells;
  return used.map(([cellX, cellY]) => ({
    face: rule.face,
    side: null,
    position: [(cellX + rule.at[0]) * CELL_MM, (cellY + rule.at[1]) * CELL_MM, top ? variant.h * STORY_MM : 0],
    normal: [0, 0, top ? 1 : -1],
  }));
}

function wallPorts(rule, variant, cells) {
  const ports = [];
  const stories = rule.each === 'story' ? variant.h : 1;
  const span = rule.each === 'story' ? STORY_MM : variant.h * STORY_MM;
  for (let side = 0; side < SIDES.length; side++) {
    if (!sideMatches(rule.face, variant, side)) continue;
    const normal = SIDES[side];
    for (const [cellX, cellY] of sideEdges(cells, side)) {
      const along = rule.at[0] - 0.5;
      const centerX = (cellX + 0.5 + normal[0] / 2 - normal[1] * along) * CELL_MM;
      const centerY = (cellY + 0.5 + normal[1] / 2 + normal[0] * along) * CELL_MM;
      for (let story = 0; story < stories; story++) {
        ports.push({ face: 'side', side, position: [centerX, centerY, (story + rule.at[1]) * span], normal: [normal[0], normal[1], 0] });
      }
      if (rule.each === 'module') return ports;
    }
  }
  return ports;
}

// Ports of a variant in its local mesh frame, mm
export function variantPorts(variant, rules = FAMILY_PORTS[variant.family] || []) {
  const cells = FOOTPRINTS[variant.fp];
  const ports = [];
  for (const rule of rules) {
    const kind = PORT_TYPES[rule.type];
    if (!kind) continue;
    const flat = rule.face === 'top' || rule.face === 'bottom';
    for (const port of flat ? flatPorts(rule, variant, cells) : wallPorts(rule, variant, cells)) {
      ports.push({ index: ports.length, type: rule.type, capacity: rule.capacity === undefined ? kind.capacity : rule.capacity, ...port });
    }
  }
  return ports;
}

// Ports of a placed module in world mm
export function instancePorts(instance) {
  const pose = instancePose(instance);
  return variantPorts(instance).map((port) => {
    const turned = poseApply({ turns: pose.turns, x: 0, y: 0, z: 0 }, port.normal[0], port.normal[1], port.normal[2]);
    return {
      ...port,
      module: instance.id,
      side: port.side === null ? null : (port.side + instance.rot) & 3,
      position: poseApply(pose, port.position[0], port.position[1], port.position[2]),
      normal: turned.map((part) => Math.round(part)),
    };
  });
}
