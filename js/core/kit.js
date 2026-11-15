import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM, SIDE_CLEAR_MM } from '../config.js';
import { FOOTPRINTS, SIDES } from './grid.js';
import { FAMILIES } from './catalog.js';
import { makeRng, mixSeed, hashString } from './rng.js';

const END_MARGIN_MM = 4.5; // facade keep-out at closed corners
const OVERSHOOT_MM = 1; // cut distance past open corners
const JOIN_MM = 0.25; // overlap between joined cells
const ROUND_SIDES = 16; // default cylinder facets

// Footprints as one or two rectangles, in cells
const RECTS = {
  '1x1': [[0, 0, 1, 1]],
  '1x2': [[0, 0, 2, 1]],
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
  const tangent3 = [tangent[0], tangent[1], 0];
  const inward = [-normal[0], -normal[1], 0];
  const up = [0, 0, 1];
  const point = (u, v, w) => [
    origin[0] + tangent[0] * u - normal[0] * w,
    origin[1] + tangent[1] * u - normal[1] * w,
    v,
  ];
  const run = {
    side,
    facade: facadeAt(side),
    length,
    cells: Math.round((rawEnd - rawStart) / CELL_MM),
    shift: start - rawStart,
    lo: startOpen ? -OVERSHOOT_MM : END_MARGIN_MM,
    hi: endOpen ? length + OVERSHOOT_MM : length - END_MARGIN_MM,
    origin,
    normal,
    tangent,
    point,
    box(u0, u1, v0, v1, w0, w1) {
      const cornerA = point(u0, v0, w0);
      const cornerB = point(u1, v1, w1);
      return box(cornerA[0], cornerA[1], cornerA[2], cornerB[0], cornerB[1], cornerB[2]);
    },
    // Profile in (depth, height), swept along the wall
    prismU: (poly, u0, u1) => prism(origin, inward, up, tangent3, poly, u0, u1),
    // Profile in (along, depth), swept upward
    prismV: (poly, v0, v1) => prism(origin, tangent3, inward, up, poly, v0, v1),
    // Profile in (along, height), swept into the wall
    prismW: (poly, w0, w1) => prism(origin, tangent3, up, inward, poly, w0, w1),
    bayStart: (bay) => bay * CELL_MM - (start - rawStart),
  };
  return run;
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
  const kit = {
    variant,
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
    slab(group, margin, fromZ, toZ) {
      for (const [minX, minY, maxX, maxY] of kit.rects(margin)) {
        kit.add(group, box(minX, minY, fromZ, maxX, maxY, toZ));
      }
    },
    carve(margin, fromZ, toZ, group = 'concrete') {
      for (const [minX, minY, maxX, maxY] of kit.rects(margin)) {
        kit.cut(box(minX, minY, fromZ, maxX, maxY, toZ), group);
      }
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
  kit.facades = kit.walls.filter((run) => run.facade);
  return kit;
}
