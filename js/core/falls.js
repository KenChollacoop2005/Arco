import { STORY_MM, CELL_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { instancePose, poseApply } from './grid.js';
import { buildRecipe } from './recipes.js';
import { pathBlocked } from './strings.js';
import { makeRng, mixSeed, hashString } from './rng.js';

export const SHEET_WIDE_MM = [2, 0.6, 5]; // sheet width: base, per unit, most
export const FALL_FADE_MM = 70; // falling water fades out over this drop
export const SHEET_FADE_MIN = 0.15; // overflow still shows where it lands
const FALL_PIECE_MM = STORY_MM / 2; // fall drawn in pieces this tall
export const POURING = ['runoff', 'disposal']; // families whose stubs pour
export const POUR_WIDE_MM = 1.2; // outlet flow sheet width
const POUR_START_MM = 0.4; // a flow starts this far past the stub tip
export const FLOW_LENGTH_MM = [1.5 * STORY_MM, 4 * STORY_MM]; // falling flow total length, seeded
export const FLOW_FADE_SHARE = [0.2, 0.6]; // fade starts at this share of the length
const FLOW_SEED = 0x5f17; // keeps flow rolls apart from shape rolls
const HIT_STEPS = 12; // halvings to find where a pour lands
const RIM_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2; // plinth radius

const minus = (first, second) => first.map((value, axis) => value - second[axis]);
const shift = (point, by, scale) => point.map((value, axis) => value + (by[axis] || 0) * scale);

// Fade of falling water after a drop
export const fallFade = (drop, floor = 0) => Math.max(floor, 1 - drop / FALL_FADE_MM);

// Quad corners: point, distance along the flow, fade
const corner = (point, along, fade) => ({ point, along, fade });

// Vertical ribbon from a top point straight down, width across a side
export function dropQuads(top, side, wide, drop, startAlong, floor = 0, startDrop = 0) {
  const quads = [];
  const pieces = Math.max(1, Math.ceil(drop / FALL_PIECE_MM));
  for (let piece = 0; piece < pieces; piece++) {
    const high = (drop * piece) / pieces;
    const low = (drop * (piece + 1)) / pieces;
    const at = (fallen) => [top[0], top[1], top[2] - fallen];
    const fadeHigh = fallFade(startDrop + high, floor);
    const fadeLow = fallFade(startDrop + low, floor);
    quads.push([
      corner(shift(at(high), side, -wide / 2), startAlong + high, fadeHigh),
      corner(shift(at(high), side, wide / 2), startAlong + high, fadeHigh),
      corner(shift(at(low), side, wide / 2), startAlong + low, fadeLow),
      corner(shift(at(low), side, -wide / 2), startAlong + low, fadeLow),
    ]);
  }
  return quads;
}

// Overflow sheet: a level spout over the edge, then a straight fall
export function sheetQuads(sheet) {
  const points = sheet.points;
  const root = points[0];
  const lip = points[points.length - 2];
  const foot = points[points.length - 1];
  const wide = Math.min(SHEET_WIDE_MM[2], SHEET_WIDE_MM[0] + SHEET_WIDE_MM[1] * sheet.units);
  const out = minus(lip, root);
  const reach = Math.hypot(out[0], out[1]) || 1;
  // Width runs along the wall the water spills over
  const side = [-out[1] / reach, out[0] / reach, 0];
  const spout = [
    corner(shift(root, side, -wide / 2), 0, 1),
    corner(shift(root, side, wide / 2), 0, 1),
    corner(shift(lip, side, wide / 2), reach, 1),
    corner(shift(lip, side, -wide / 2), reach, 1),
  ];
  return [spout, ...dropQuads(lip, side, wide, lip[2] - foot[2], reach, SHEET_FADE_MIN)];
}

// Seeded length and fade start of one falling flow
export function flowShape(seed) {
  const rng = makeRng(mixSeed(seed >>> 0, FLOW_SEED));
  const length = rng.range(FLOW_LENGTH_MM[0], FLOW_LENGTH_MM[1]);
  return { length, fadeStart: length * rng.range(FLOW_FADE_SHARE[0], FLOW_FADE_SHARE[1]) };
}

// Full down to the fade start, then linear to zero at the length
export const flowFade = (drop, shape) => (drop <= shape.fadeStart ? 1 : Math.max(0, 1 - (drop - shape.fadeStart) / (shape.length - shape.fadeStart)));

// Straight fall in pieces, broken at the fade start so the fade is exact
export function fallQuads(top, side, wide, drop, shape, startAlong = 0) {
  const marks = [0];
  for (let fallen = FALL_PIECE_MM; fallen < drop; fallen += FALL_PIECE_MM) marks.push(fallen);
  if (shape.fadeStart > 0 && shape.fadeStart < drop) marks.push(shape.fadeStart);
  marks.push(drop);
  marks.sort((first, second) => first - second);
  const at = (fallen) => [top[0], top[1], top[2] - fallen];
  const quads = [];
  for (let index = 1; index < marks.length; index++) {
    const [high, low] = [marks[index - 1], marks[index]];
    if (low - high <= 0) continue;
    quads.push([
      corner(shift(at(high), side, -wide / 2), startAlong + high, flowFade(high, shape)),
      corner(shift(at(high), side, wide / 2), startAlong + high, flowFade(high, shape)),
      corner(shift(at(low), side, wide / 2), startAlong + low, flowFade(low, shape)),
      corner(shift(at(low), side, -wide / 2), startAlong + low, flowFade(low, shape)),
    ]);
  }
  return quads;
}

// One outlet flow: straight down from the stub tip to where it lands, at most its length
function outletFall(context, instance, start, dir, shape) {
  const onPlinth = Math.hypot(start[0], start[1]) <= RIM_MM;
  const lowest = onPlinth ? Math.max(0, start[2] - shape.length) : start[2] - shape.length;
  let drop = start[2] - lowest;
  const below = (fallen) => [start[0], start[1], start[2] - fallen];
  if (onPlinth && pathBlocked(context, [start, below(drop)], [instance.id])) {
    // Halve back to where it meets a module
    let low = 0;
    let high = drop;
    for (let step = 0; step < HIT_STEPS; step++) {
      const middle = (low + high) / 2;
      if (pathBlocked(context, [start, below(middle)], [instance.id])) high = middle;
      else low = middle;
    }
    drop = low;
  }
  return { module: instance.id, family: instance.family, points: [start, below(drop)], drop, dir: [dir[0], dir[1], 0], length: shape.length, fadeStart: shape.fadeStart };
}

// Pours from every flowing stub of the runoff and disposal modules
export function pourPaths(modules, context) {
  const pours = [];
  for (const instance of modules) {
    if (!POURING.includes(instance.family)) continue;
    const pose = instancePose(instance);
    buildRecipe(instance).anchors.outlet.forEach((outlet, index) => {
      const dir = poseApply({ turns: pose.turns, x: 0, y: 0, z: 0 }, ...outlet.dir).map(Math.round);
      const mouth = poseApply(pose, ...outlet.at);
      // Each flow gets its own length and fade, seeded by where it is
      const shape = flowShape(mixSeed(instance.seed >>> 0, hashString(`${instance.x},${instance.y},${instance.z}:${index}`)));
      pours.push(outletFall(context, instance, mouth.map((value, axis) => value + dir[axis] * POUR_START_MM), dir, shape));
    });
  }
  return pours;
}

// Two crossed thin sheets falling from the stub tip
export function pourQuads(pour) {
  if (pour.drop <= 0) return [];
  const side = [-pour.dir[1], pour.dir[0], 0];
  const shape = { length: pour.length, fadeStart: pour.fadeStart };
  return [side, pour.dir].flatMap((across) => fallQuads(pour.points[0], across, POUR_WIDE_MM, pour.drop, shape));
}
