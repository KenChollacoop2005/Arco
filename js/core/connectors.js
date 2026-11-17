import {
  CELL_MM,
  STORY_MM,
  CONNECTOR_CLEARANCE_MM,
  RAIL_OFFSET_MM,
  RAIL_NECK_MM,
  RAIL_DEPTH_MM,
  RAIL_FLANK_DEG,
  RAIL_LEAD_MM,
  DOCK_LIP_MM,
  DOCK_HEAD_MM,
  PEG_SIZE_MM,
  PEG_LENGTH_MM,
  SOCKET_CHAMFER_MM,
  MIN_WALL_MM,
  COUPON_DEPTH_MM,
  COUPON_HEIGHT_MM,
  COUPON_SOCKET_BACK_MM,
} from '../config.js';
import { FOOTPRINTS, SIDES } from './grid.js';
import { FAMILIES, isDocked } from './catalog.js';
import { box, pyramid } from './kit.js';

const BURY_MM = 0.3; // rail root sunk into the body
const PAST_MM = 0.5; // cuts start outside the surface
const UP = [0, 0, 1];

const flankTan = Math.tan((RAIL_FLANK_DEG * Math.PI) / 180);
const flankCos = Math.cos((RAIL_FLANK_DEG * Math.PI) / 180);

// Male dovetail in (along, outward) from the cell edge
export function maleProfile(clearance) {
  const half = clearance / 2;
  const widthAt = (out) => RAIL_NECK_MM / 2 + out * flankTan - half / flankCos;
  const root = widthAt(-half);
  const tip = widthAt(RAIL_DEPTH_MM - half);
  return [
    [-root, -half - BURY_MM],
    [root, -half - BURY_MM],
    [root, -half],
    [tip, RAIL_DEPTH_MM - half],
    [-tip, RAIL_DEPTH_MM - half],
    [-root, -half],
  ];
}

// Female slot in (along, outward) from the cell edge
export function femaleProfile(clearance) {
  const half = clearance / 2;
  const widthAt = (depth) => RAIL_NECK_MM / 2 + depth * flankTan + half / flankCos;
  const mouth = half - PAST_MM;
  const floor = RAIL_DEPTH_MM + half;
  return [
    [-widthAt(mouth), -mouth],
    [widthAt(mouth), -mouth],
    [widthAt(floor), -floor],
    [-widthAt(floor), -floor],
  ];
}

// Cell edges that carry rails, in local mm
export function railEdges(variant) {
  const plug = isDocked(variant);
  if (!FAMILIES[variant.family].rails && !plug) return [];
  const cells = FOOTPRINTS[variant.fp];
  const has = (cellX, cellY) => cells.some((cell) => cell[0] === cellX && cell[1] === cellY);
  const edges = [];
  for (let side = 0; side < 4; side++) {
    const docked = (((variant.dock || 0) >> side) & 1) === 1;
    if (plug ? !docked : (variant.mask >> side) & 1) continue;
    const normal = SIDES[side];
    for (const [cellX, cellY] of cells) {
      if (has(cellX + normal[0], cellY + normal[1])) continue;
      const edge = {
        center: [(cellX + 0.5 + normal[0] / 2) * CELL_MM, (cellY + 0.5 + normal[1] / 2) * CELL_MM],
        normal,
      };
      // Bridge ends are plugs, building sides are docks
      if (docked) edge[plug ? 'plug' : 'dock'] = true;
      edges.push(edge);
    }
  }
  return edges;
}

function edgeFrame(edge) {
  const normal = [edge.normal[0], edge.normal[1], 0];
  const tangent = [-edge.normal[1], edge.normal[0], 0];
  return { origin: [edge.center[0], edge.center[1], 0], normal, tangent };
}

const shifted = (poly, offset) => poly.map(([along, out]) => [along + offset, out]);

// One male rail and one female slot on a cell edge
export function railOps(edge, clearance, fromZ, toZ) {
  const { origin, normal, tangent } = edgeFrame(edge);
  const half = clearance / 2;
  const tipOut = RAIL_DEPTH_MM - half;
  const lead = fromZ > 0 ? RAIL_DEPTH_MM : RAIL_LEAD_MM;
  const male = shifted(maleProfile(clearance), RAIL_OFFSET_MM);
  const reach = RAIL_NECK_MM / 2 + RAIL_DEPTH_MM * flankTan + PAST_MM;
  const wedge = (poly) => ({
    kind: 'prism',
    origin,
    axes: [normal, UP, tangent],
    poly,
    from: RAIL_OFFSET_MM - reach,
    to: RAIL_OFFSET_MM + reach,
  });
  const adds = [{ kind: 'prism', origin, axes: [tangent, normal, UP], poly: male, from: fromZ, to: toZ }];
  const cuts = [
    // Foot chamfer, a 45 degree corbel on raised rails
    wedge([
      [tipOut - lead, fromZ],
      [tipOut - lead, fromZ - PAST_MM],
      [tipOut + PAST_MM, fromZ - PAST_MM],
      [tipOut + PAST_MM, fromZ + lead + PAST_MM],
    ]),
    // Top lead-in chamfer
    wedge([
      [tipOut - RAIL_LEAD_MM, toZ],
      [tipOut + PAST_MM, toZ - RAIL_LEAD_MM - PAST_MM],
      [tipOut + PAST_MM, toZ + PAST_MM],
      [tipOut - RAIL_LEAD_MM, toZ + PAST_MM],
    ]),
    {
      kind: 'prism',
      origin,
      axes: [tangent, normal, UP],
      poly: shifted(femaleProfile(clearance), -RAIL_OFFSET_MM),
      from: -PAST_MM,
      to: toZ + PAST_MM,
    },
  ];
  return { adds, cuts };
}

// Dock side: two slots that stop on a floor lip
export function dockOps(edge, clearance, toZ) {
  const { origin, normal, tangent } = edgeFrame(edge);
  const cuts = [-RAIL_OFFSET_MM, RAIL_OFFSET_MM].map((offset) => ({
    kind: 'prism',
    origin,
    axes: [tangent, normal, UP],
    poly: shifted(femaleProfile(clearance), offset),
    from: DOCK_LIP_MM,
    to: toZ + PAST_MM,
  }));
  return { adds: [], cuts };
}

// Bridge end: two square footed rails, no chamfers
export function plugOps(edge, clearance) {
  const { origin, normal, tangent } = edgeFrame(edge);
  const adds = [-RAIL_OFFSET_MM, RAIL_OFFSET_MM].map((offset) => ({
    kind: 'prism',
    origin,
    axes: [tangent, normal, UP],
    poly: shifted(maleProfile(clearance), offset),
    from: DOCK_LIP_MM,
    to: DOCK_LIP_MM + DOCK_HEAD_MM[1],
  }));
  return { adds, cuts: [] };
}

export const socketHalf = (clearance) => (PEG_SIZE_MM + clearance) / 2;
export const socketDepth = (clearance) => (PEG_LENGTH_MM + clearance) / 2;

// Socket cut with a chamfered mouth, top or bottom
export function socketCuts(centerX, centerY, faceZ, onTop, clearance) {
  const half = socketHalf(clearance);
  const depth = socketDepth(clearance);
  const chamfer = SOCKET_CHAMFER_MM;
  if (onTop) {
    return [
      box(centerX - half, centerY - half, faceZ - depth, centerX + half, centerY + half, faceZ + PAST_MM),
      pyramid(centerX, centerY, faceZ - chamfer, faceZ + chamfer, half, half + 2 * chamfer),
    ];
  }
  return [
    box(centerX - half, centerY - half, faceZ - PAST_MM, centerX + half, centerY + half, faceZ + depth),
    pyramid(centerX, centerY, faceZ - chamfer, faceZ + chamfer, half + 2 * chamfer, half),
  ];
}

// Solid needed around a socket for it to be cut
export function socketProbe(centerX, centerY, faceZ, onTop, clearance) {
  const half = socketHalf(clearance) + MIN_WALL_MM;
  const depth = socketDepth(clearance) + MIN_WALL_MM;
  return onTop
    ? box(centerX - half, centerY - half, faceZ - depth, centerX + half, centerY + half, faceZ)
    : box(centerX - half, centerY - half, faceZ, centerX + half, centerY + half, faceZ + depth);
}

// Where a variant may carry rails and sockets
export function connectorPlan(variant, railBase = 0) {
  const family = FAMILIES[variant.family];
  const height = variant.h * STORY_MM;
  const centers = FOOTPRINTS[variant.fp].map(([cellX, cellY]) => [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM]);
  return {
    height,
    railBase,
    edges: railEdges(variant),
    top: family.stack && !variant.roof ? centers.map((center, cell) => ({ cell, center })) : [],
    // A docked bridge hangs on its rails, no pegs
    bottom: family.ground || isDocked(variant) ? [] : centers.map((center, cell) => ({ cell, center })),
  };
}

// Ops applied to a finished body, sockets already chosen
export function connectorOps(plan, clearance = CONNECTOR_CLEARANCE_MM, top = plan.top, bottom = plan.bottom) {
  const adds = [];
  const cuts = [];
  for (const edge of plan.edges) {
    const rail = edge.dock ? dockOps(edge, clearance, plan.height) : edge.plug ? plugOps(edge, clearance) : railOps(edge, clearance, plan.railBase, plan.height);
    adds.push(...rail.adds);
    cuts.push(...rail.cuts);
  }
  for (const site of top) cuts.push(...socketCuts(site.center[0], site.center[1], plan.height, true, clearance));
  for (const site of bottom) cuts.push(...socketCuts(site.center[0], site.center[1], 0, false, clearance));
  return [
    ...adds.map((shape) => ({ group: 'concrete', cut: false, shape })),
    ...cuts.map((shape) => ({ group: 'concrete', cut: true, shape })),
  ];
}

// Loose square peg, standing on the bed at the origin
export function pegOps(clearance = CONNECTOR_CLEARANCE_MM) {
  const half = (PEG_SIZE_MM - clearance) / 2;
  const length = PEG_LENGTH_MM - clearance;
  const chamfer = SOCKET_CHAMFER_MM;
  const shapes = [
    pyramid(0, 0, 0, chamfer, half - chamfer, half),
    box(-half, -half, chamfer, half, half, length - chamfer),
    pyramid(0, 0, length - chamfer, length, half, half - chamfer),
  ];
  return shapes.map((shape) => ({ group: 'concrete', cut: false, shape }));
}

// Fit test block: one rail pair and one socket
export function couponOps(clearance = CONNECTOR_CLEARANCE_MM) {
  const inset = clearance / 2;
  const edge = { center: [CELL_MM / 2, COUPON_DEPTH_MM], normal: [0, 1] };
  const rail = railOps(edge, clearance, 0, COUPON_HEIGHT_MM);
  const shapes = [box(inset, 0, 0, CELL_MM - inset, COUPON_DEPTH_MM - inset, COUPON_HEIGHT_MM), ...rail.adds];
  const cuts = [...rail.cuts, ...socketCuts(CELL_MM / 2, COUPON_SOCKET_BACK_MM, COUPON_HEIGHT_MM, true, clearance)];
  return [
    ...shapes.map((shape) => ({ group: 'concrete', cut: false, shape })),
    ...cuts.map((shape) => ({ group: 'concrete', cut: true, shape })),
  ];
}

// Turns a coupon mesh into its mating partner
export function couponMate(mesh) {
  const positions = new Float32Array(mesh.positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    positions[offset] = CELL_MM - mesh.positions[offset];
    positions[offset + 1] = 2 * COUPON_DEPTH_MM - mesh.positions[offset + 1];
    positions[offset + 2] = mesh.positions[offset + 2];
  }
  return { positions, index: mesh.index };
}
