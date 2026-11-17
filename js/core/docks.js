import {
  CELL_MM,
  CONNECTOR_CLEARANCE_MM,
  RAIL_OFFSET_MM,
  RAIL_NECK_MM,
  RAIL_DEPTH_MM,
  RAIL_FLANK_DEG,
  DOCK_LIP_MM,
  DOCK_HEAD_MM,
} from '../config.js';

const NORMALS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // side order of the grid
const OPEN_MM = 1; // slot box reach past the face and the top
const flankTan = Math.tan((RAIL_FLANK_DEG * Math.PI) / 180);
const flankCos = Math.cos((RAIL_FLANK_DEG * Math.PI) / 180);

// Slot box: as wide as the printed slot floor
const slotHalf = (gap) => RAIL_NECK_MM / 2 + (RAIL_DEPTH_MM + gap) * flankTan + gap / flankCos;
const slotDepth = (gap) => RAIL_DEPTH_MM + gap;
// Rail box: as wide as the printed rail neck
export const PLUG_RAIL_HALF_MM = RAIL_NECK_MM / 2;

// Outer cell edges of the docked local sides
function dockEdges(cells, dock) {
  const has = (cellX, cellY) => cells.some((cell) => cell[0] === cellX && cell[1] === cellY);
  const edges = [];
  NORMALS.forEach((normal, side) => {
    if (((dock >> side) & 1) === 0) return;
    for (const [cellX, cellY] of cells) {
      if (has(cellX + normal[0], cellY + normal[1])) continue;
      edges.push({ center: [(cellX + 0.5 + normal[0] / 2) * CELL_MM, (cellY + 0.5 + normal[1] / 2) * CELL_MM], normal, tangent: [-normal[1], normal[0]] });
    }
  });
  return edges;
}

// Box from (along, out) ranges on a cell edge
function edgeBox(edge, alongFrom, alongTo, outFrom, outTo, low, high) {
  const at = (along, out) => [edge.center[0] + edge.tangent[0] * along + edge.normal[0] * out, edge.center[1] + edge.tangent[1] * along + edge.normal[1] * out];
  const first = at(alongFrom, outFrom);
  const second = at(alongTo, outTo);
  return {
    kind: 'box',
    min: [Math.min(first[0], second[0]), Math.min(first[1], second[1]), low],
    max: [Math.max(first[0], second[0]), Math.max(first[1], second[1]), high],
  };
}

// Per dock slot: the open slot and the lip under it
export function dockSlots(cells, dock, height, gap = CONNECTOR_CLEARANCE_MM / 2) {
  const half = slotHalf(gap);
  const slots = [];
  for (const edge of dockEdges(cells, dock)) {
    for (const offset of [-RAIL_OFFSET_MM, RAIL_OFFSET_MM]) {
      slots.push({
        hole: edgeBox(edge, offset - half, offset + half, -slotDepth(gap), OPEN_MM, DOCK_LIP_MM, height + OPEN_MM),
        lip: edgeBox(edge, offset - half, offset + half, -slotDepth(gap), -gap, 0, DOCK_LIP_MM),
      });
    }
  }
  return slots;
}

// Rail boxes at the ends of a docked bridge
export function plugRails(cells, dock, gap = CONNECTOR_CLEARANCE_MM / 2) {
  const rails = [];
  for (const edge of dockEdges(cells, dock)) {
    for (const offset of [-RAIL_OFFSET_MM, RAIL_OFFSET_MM]) {
      rails.push(edgeBox(edge, offset - PLUG_RAIL_HALF_MM, offset + PLUG_RAIL_HALF_MM, -gap, RAIL_DEPTH_MM - gap, DOCK_LIP_MM, DOCK_LIP_MM + DOCK_HEAD_MM[1]));
    }
  }
  return rails;
}

// A box less a hole, as boxes; the part under the hole comes last
function carveBox(shape, hole) {
  const apart = [0, 1, 2].some((axis) => hole.min[axis] >= shape.max[axis] || hole.max[axis] <= shape.min[axis]);
  if (apart) return [shape];
  const pieces = [];
  const core = { min: shape.min.slice(), max: shape.max.slice() };
  for (let axis = 0; axis < 3; axis++) {
    if (hole.min[axis] > core.min[axis]) {
      const piece = { kind: 'box', min: core.min.slice(), max: core.max.slice() };
      piece.max[axis] = hole.min[axis];
      pieces.push(piece);
      core.min[axis] = hole.min[axis];
    }
    if (hole.max[axis] < core.max[axis]) {
      const piece = { kind: 'box', min: core.min.slice(), max: core.max.slice() };
      piece.min[axis] = hole.max[axis];
      pieces.push(piece);
      core.max[axis] = hole.max[axis];
    }
  }
  return pieces;
}

// Module colliders with the dock slots open down to their lips
export function dockColliders(shapes, cells, dock, height, gap = CONNECTOR_CLEARANCE_MM / 2) {
  let carved = shapes;
  for (const { hole } of dockSlots(cells, dock, height, gap)) carved = carved.flatMap((shape) => carveBox(shape, hole));
  return carved;
}

// Bridge colliders: the body above the lip line, plus its rails
export function plugColliders(shapes, cells, dock, gap = CONNECTOR_CLEARANCE_MM / 2) {
  const raised = shapes.map((shape) => ({ kind: 'box', min: [shape.min[0], shape.min[1], DOCK_LIP_MM], max: shape.max.slice() }));
  return [...raised, ...plugRails(cells, dock, gap)];
}
