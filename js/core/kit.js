import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM, SIDE_CLEAR_MM } from '../config.js';
import { FOOTPRINTS, SIDES } from './grid.js';
import { FAMILIES } from './catalog.js';
import { makeRng, mixSeed, hashString } from './rng.js';
import { profilePlan, PROFILE_FOOTPRINTS } from './profiles.js';

const END_MARGIN_MM = 4.5; // facade keep-out at closed corners
const OVERSHOOT_MM = 1; // cut distance past open corners
const JOIN_MM = 0.25; // overlap between joined cells
const ROUND_SIDES = 16; // default cylinder facets
const ZONE_EDGE_MM = 1.6; // openings kept off the piers of an inset
const MIN_LOBE_MM = 1.2; // narrowest outline step worth keeping

// Footprints as one or two rectangles, in cells
const RECTS = {
  '1x1': [[0, 0, 1, 1]],
  '1x2': [[0, 0, 2, 1]],
  '1x3': [[0, 0, 3, 1]],
  '1x4': [[0, 0, 4, 1]],
  '1x5': [[0, 0, 5, 1]],
  '2x2': [[0, 0, 2, 2]],
  '2x3': [[0, 0, 3, 2]],
  L3: [[0, 0, 2, 1], [0, 0, 1, 2]],
  L4: [[0, 0, 3, 1], [0, 0, 1, 2]],
};

export const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
  kind: 'box',
  min: [Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)],
  max: [Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)],
});

const prism = (origin, axisA, axisB, axisC, poly, from, to) => ({
  kind: 'prism',
  origin,
  axes: [axisA, axisB, axisC],
  poly,
  from: Math.min(from, to),
  to: Math.max(from, to),
});

// Profile in (y, z), swept along x
export const prismX = (poly, fromX, toX) => prism([0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], poly, fromX, toX);
// Profile in (x, z), swept along y
export const prismY = (poly, fromY, toY) => prism([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], poly, fromY, toY);
// Profile in (x, y), swept along z
export const prismZ = (poly, fromZ, toZ) => prism([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], poly, fromZ, toZ);

export const cyl = (centerX, centerY, fromZ, toZ, radiusLow, radiusHigh = radiusLow, sides = ROUND_SIDES, turnDeg = 0) => ({
  kind: 'cyl',
  center: [centerX, centerY],
  from: fromZ,
  to: toZ,
  radiusLow,
  radiusHigh,
  sides,
  turnDeg,
});

// Square frustum, half widths at each end
export const pyramid = (centerX, centerY, fromZ, toZ, halfLow, halfHigh) =>
  cyl(centerX, centerY, fromZ, toZ, halfLow * Math.SQRT2, halfHigh * Math.SQRT2, 4, 45);

// Flat-bottomed octagon profile
export function octagon(centerA, centerB, apothem) {
  const radius = apothem / Math.cos(Math.PI / 8);
  const points = [];
  for (let corner = 0; corner < 8; corner++) {
    const angle = Math.PI / 8 + (corner * Math.PI) / 4;
    points.push([centerA + radius * Math.cos(angle), centerB + radius * Math.sin(angle)]);
  }
  return points;
}

function makeRun(cells, has, side, first, last, inset, mask, railed) {
  const normal = SIDES[side];
  const tangent = [-normal[1], normal[0]];
  const along = (cell) => tangent[0] * cell[0] + tangent[1] * cell[1];
  const reversed = tangent[0] + tangent[1] < 0;
  const outward = normal[0] + normal[1] > 0;
  const startConcave = has(first[0] - tangent[0], first[1] - tangent[1]);
  const endConcave = has(last[0] + tangent[0], last[1] + tangent[1]);
  const rawStart = along(first) * CELL_MM - (reversed ? CELL_MM : 0);
  const rawEnd = along(last) * CELL_MM + (reversed ? 0 : CELL_MM);
  const start = rawStart + (startConcave ? -inset : inset);
  const end = rawEnd + (endConcave ? inset : -inset);
  const plane = (normal[0] * first[0] + normal[1] * first[1]) * CELL_MM + (outward ? CELL_MM - inset : -inset);
  const origin = [normal[0] * plane + tangent[0] * start, normal[1] * plane + tangent[1] * start, 0];
  const sideOf = (vector) => SIDES.findIndex((entry) => entry[0] === vector[0] && entry[1] === vector[1]);
  const facadeAt = (index) => !railed || ((mask >> index) & 1) === 1;
  const startOpen = !startConcave && facadeAt(sideOf([-tangent[0], -tangent[1]]));
  const endOpen = !endConcave && facadeAt(sideOf(tangent));
  const length = end - start;
  return frameRun({
    side,
    facade: facadeAt(side),
    length,
    cells: Math.round((rawEnd - rawStart) / CELL_MM),
    shift: start - rawStart,
    lo: startOpen ? -OVERSHOOT_MM : END_MARGIN_MM,
    hi: endOpen ? length + OVERSHOOT_MM : length - END_MARGIN_MM,
    inLo: END_MARGIN_MM,
    inHi: length - END_MARGIN_MM,
    origin,
    normal,
    tangent,
  });
}

// Adds the drawing helpers to a wall run
function frameRun(run) {
  const { origin, normal, tangent } = run;
  const tangent3 = [tangent[0], tangent[1], 0];
  const inward = [-normal[0], -normal[1], 0];
  const up = [0, 0, 1];
  const point = (u, v, w) => [
    origin[0] + tangent[0] * u - normal[0] * w,
    origin[1] + tangent[1] * u - normal[1] * w,
    v,
  ];
  run.point = point;
  run.box = (u0, u1, v0, v1, w0, w1) => {
    const cornerA = point(u0, v0, w0);
    const cornerB = point(u1, v1, w1);
    return box(cornerA[0], cornerA[1], cornerA[2], cornerB[0], cornerB[1], cornerB[2]);
  };
  // Profile in (depth, height), swept along the wall
  run.prismU = (poly, u0, u1) => prism(origin, inward, up, tangent3, poly, u0, u1);
  // Profile in (along, depth), swept upward
  run.prismV = (poly, v0, v1) => prism(origin, tangent3, inward, up, poly, v0, v1);
  // Profile in (along, height), swept into the wall
  run.prismW = (poly, w0, w1) => prism(origin, tangent3, up, inward, poly, w0, w1);
  run.bayStart = (bay) => bay * CELL_MM - run.shift;
  return run;
}

// Middle stretch of a side, moved in or out between its piers
export function zoneRun(run, side) {
  const from = side.pier - run.shift;
  const length = run.length - 2 * from;
  const edge = side.shift < 0 ? ZONE_EDGE_MM : END_MARGIN_MM;
  return frameRun({
    side: run.side,
    facade: run.facade,
    length,
    cells: run.cells,
    shift: side.pier,
    lo: edge,
    hi: length - edge,
    inLo: edge,
    inHi: length - edge,
    origin: run.point(from, 0, -side.shift),
    normal: run.normal,
    tangent: run.tangent,
  });
}

// Body outline with inset and bulged sides, pulled in by a margin
function profiledOutline(footprintId, plan, inset, margin) {
  const [sizeX, sizeY] = PROFILE_FOOTPRINTS[footprintId];
  const width = sizeX * CELL_MM;
  const depth = sizeY * CELL_MM;
  const extra = margin - inset;
  const corners = [[width, 0], [width, depth], [0, depth], [0, 0]];
  const lengths = [depth, width, depth, width];
  const sides = plan.map((side, index) => {
    if (!side.shift) return { base: -margin, zone: null };
    const grow = side.shift > 0 ? extra : -extra;
    const from = side.pier + grow;
    const to = lengths[index] - side.pier - grow;
    if (side.shift < 0 && side.pier - extra - margin < MIN_LOBE_MM) return { base: -margin + side.shift, zone: null };
    if (to - from < MIN_LOBE_MM) return { base: -margin, zone: null };
    return { base: -margin, zone: [from, to, -margin + side.shift] };
  });
  const outline = [];
  sides.forEach((side, index) => {
    const normal = SIDES[index];
    const tangent = [-normal[1], normal[0]];
    const at = (along, out) => outline.push([
      corners[index][0] + tangent[0] * along + normal[0] * out,
      corners[index][1] + tangent[1] * along + normal[1] * out,
    ]);
    at(-sides[(index + 3) & 3].base, side.base);
    if (!side.zone) return;
    const [from, to, plane] = side.zone;
    at(from, side.base);
    at(from, plane);
    at(to, plane);
    at(to, side.base);
  });
  return outline;
}

function wallRuns(cells, inset, mask, railed) {
  const has = (cellX, cellY) => cells.some((cell) => cell[0] === cellX && cell[1] === cellY);
  const runs = [];
  for (let side = 0; side < 4; side++) {
    const normal = SIDES[side];
    const tangent = [-normal[1], normal[0]];
    const along = (cell) => tangent[0] * cell[0] + tangent[1] * cell[1];
    const across = (cell) => normal[0] * cell[0] + normal[1] * cell[1];
    const exposed = cells
      .filter((cell) => !has(cell[0] + normal[0], cell[1] + normal[1]))
      .sort((cellA, cellB) => across(cellA) - across(cellB) || along(cellA) - along(cellB));
    let first = null;
    let last = null;
    for (const cell of exposed) {
      if (last && across(cell) === across(last) && along(cell) === along(last) + 1) {
        last = cell;
        continue;
      }
      if (first) runs.push(makeRun(cells, has, side, first, last, inset, mask, railed));
      first = last = cell;
    }
    if (first) runs.push(makeRun(cells, has, side, first, last, inset, mask, railed));
  }
  return runs;
}

export function createKit(variant, clearance = CONNECTOR_CLEARANCE_MM) {
  const family = FAMILIES[variant.family];
  const cells = FOOTPRINTS[variant.fp];
  const inset = clearance / 2;
  const width = (Math.max(...cells.map((cell) => cell[0])) + 1) * CELL_MM;
  const depth = (Math.max(...cells.map((cell) => cell[1])) + 1) * CELL_MM;
  const height = variant.h * STORY_MM;
  const ops = [];
  const profile = profilePlan(variant);
  const kit = {
    variant,
    profile,
    family,
    cells,
    inset,
    W: width,
    D: depth,
    H: height,
    stories: variant.h,
    roof: !!variant.roof,
    ops,
    anchors: { smoke: [], outlet: [], spin: null },
    rng: makeRng(mixSeed(variant.seed >>> 0, hashString(variant.family))),
    // Style choices shared across sizes of one seed
    styleRng: makeRng(mixSeed(variant.seed >>> 0, 0x51f15e)),
    add(group, shape) {
      ops.push({ group, cut: false, shape });
    },
    cut(shape, group = 'concrete') {
      ops.push({ group, cut: true, shape });
    },
    // Footprint rectangles pulled in from the outline
    rects(margin = inset) {
      return RECTS[variant.fp].map(([minX, minY, maxX, maxY]) => [
        minX * CELL_MM + margin,
        minY * CELL_MM + margin,
        maxX * CELL_MM - margin,
        maxY * CELL_MM - margin,
      ]);
    },
    // Footprint as one solid, so L shapes have no shared faces
    block(margin, fromZ, toZ) {
      if (profile) return prismZ(profiledOutline(variant.fp, profile, inset, margin), fromZ, toZ);
      const rects = kit.rects(margin);
      if (rects.length === 1) return box(rects[0][0], rects[0][1], fromZ, rects[0][2], rects[0][3], toZ);
      const [long, tall] = rects;
      const outline = [[long[0], long[1]], [long[2], long[1]], [long[2], long[3]], [tall[2], long[3]], [tall[2], tall[3]], [tall[0], tall[3]]];
      return prismZ(outline, fromZ, toZ);
    },
    slab(group, margin, fromZ, toZ) {
      kit.add(group, kit.block(margin, fromZ, toZ));
    },
    carve(margin, fromZ, toZ, group = 'concrete') {
      kit.cut(kit.block(margin, fromZ, toZ), group);
    },
    // One cell, overlapping its neighbours inside the body
    cellBox(index, margin = inset) {
      const [cellX, cellY] = cells[index];
      const joined = (stepX, stepY) => cells.some((cell) => cell[0] === cellX + stepX && cell[1] === cellY + stepY);
      return [
        cellX * CELL_MM + (joined(-1, 0) ? -JOIN_MM : margin),
        cellY * CELL_MM + (joined(0, -1) ? -JOIN_MM : margin),
        (cellX + 1) * CELL_MM - (joined(1, 0) ? -JOIN_MM : margin),
        (cellY + 1) * CELL_MM - (joined(0, 1) ? -JOIN_MM : margin),
      ];
    },
    cellCenters() {
      return cells.map(([cellX, cellY]) => [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM]);
    },
    walls: wallRuns(cells, family.rails ? inset : SIDE_CLEAR_MM, variant.mask, family.rails),
    clear: SIDE_CLEAR_MM,
  };
  if (profile) kit.walls = kit.walls.map((run) => (profile[run.side].shift && run.facade ? zoneRun(run, profile[run.side]) : run));
  kit.facades = kit.walls.filter((run) => run.facade);
  return kit;
}

export const inBox = (shape, point) => point.every((value, axis) => value > shape.min[axis] && value < shape.max[axis]);

// Even-odd test on a closed outline
function inPolygon(poly, pointA, pointB) {
  let inside = false;
  for (let index = 0, last = poly.length - 1; index < poly.length; last = index++) {
    const [fromA, fromB] = poly[index];
    const [toA, toB] = poly[last];
    if (fromB > pointB !== toB > pointB && pointA < ((toA - fromA) * (pointB - fromB)) / (toB - fromB) + fromA) inside = !inside;
  }
  return inside;
}

// Faceted frustum, first corner at the turn angle
function inCylinder(shape, point) {
  if (point[2] <= shape.from || point[2] >= shape.to) return false;
  const share = (point[2] - shape.from) / (shape.to - shape.from);
  const radius = shape.radiusLow + (shape.radiusHigh - shape.radiusLow) * share;
  const apothem = radius * Math.cos(Math.PI / shape.sides);
  const localX = point[0] - shape.center[0];
  const localY = point[1] - shape.center[1];
  const turn = (shape.turnDeg * Math.PI) / 180;
  for (let face = 0; face < shape.sides; face++) {
    const angle = turn + ((face + 0.5) * 2 * Math.PI) / shape.sides;
    if (localX * Math.cos(angle) + localY * Math.sin(angle) >= apothem) return false;
  }
  return true;
}

function inPrism(shape, point) {
  const offset = [point[0] - shape.origin[0], point[1] - shape.origin[1], point[2] - shape.origin[2]];
  const dot = (axis) => offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
  const sweep = dot(shape.axes[2]);
  if (sweep <= shape.from || sweep >= shape.to) return false;
  return inPolygon(shape.poly, dot(shape.axes[0]), dot(shape.axes[1]));
}

// True when a point is inside one kit shape
export function inShape(shape, point) {
  if (shape.kind === 'box') return inBox(shape, point);
  if (shape.kind === 'cyl') return inCylinder(shape, point);
  return inPrism(shape, point);
}

// Group of the solid at a point, adds and cuts in order per group
export function groupAt(ops, point) {
  const inside = new Map();
  for (const op of ops) {
    if (op.cut) {
      if (inside.get(op.group) && inShape(op.shape, point)) inside.set(op.group, false);
    } else if (!inside.get(op.group) && inShape(op.shape, point)) {
      inside.set(op.group, true);
    }
  }
  for (const [group, filled] of inside) if (filled) return group;
  return null;
}
