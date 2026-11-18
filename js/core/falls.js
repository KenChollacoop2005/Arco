import { STORY_MM, CELL_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { instancePose, poseApply } from './grid.js';
import { buildRecipe } from './recipes.js';
import { pathBlocked } from './strings.js';

export const SHEET_WIDE_MM = [2, 0.6, 5]; // sheet width: base, per unit, most
export const FALL_FADE_MM = 70; // falling water fades out over this drop
export const SHEET_FADE_MIN = 0.15; // overflow still shows where it lands
const FALL_PIECE_MM = STORY_MM / 2; // fall drawn in pieces this tall
export const POURING = ['runoff', 'disposal']; // families whose stubs pour
export const POUR_WIDE_MM = 2.2; // pour ribbon width
const POUR_START_MM = 0.4; // a pour starts this far past the stub mouth
const POUR_CURVE = 1 / 12; // arc drop per mm squared of reach
const POUR_STEP_MM = 2; // arc sampled about this often along its length
const POUR_PAST_MM = 60; // off the plinth a pour falls this far as it fades
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

// Point on a pour's arc a reach out from its start
const arcAt = (start, dir, reach) => [start[0] + dir[0] * reach, start[1] + dir[1] * reach, start[2] - POUR_CURVE * reach * reach];

// One pour: arcs out of the stub, falls, stops where it lands or fades out
function pourArc(context, instance, start, dir) {
  const points = [start];
  const along = [0];
  let reach = 0;
  for (;;) {
    const last = points[points.length - 1];
    // Step along the arc by about the same length each time
    reach += POUR_STEP_MM / Math.sqrt(1 + (2 * POUR_CURVE * reach) ** 2);
    let next = arcAt(start, dir, reach);
    const onPlinth = Math.hypot(next[0], next[1]) <= RIM_MM;
    const floor = onPlinth ? 0 : -POUR_PAST_MM;
    let landed = false;
    // Leaving the plinth below its top: it lands on the top first
    if (!onPlinth && next[2] < 0 && Math.hypot(last[0], last[1]) <= RIM_MM) {
      const share = last[2] / (last[2] - next[2]);
      const touch = last.map((value, axis) => value + (next[axis] - value) * share);
      if (Math.hypot(touch[0], touch[1]) <= RIM_MM) {
        next = touch;
        landed = true;
      }
    }
    if (!landed && next[2] <= floor) {
      // Lands on the plinth top, or falls past the rim to the end
      const share = (last[2] - floor) / (last[2] - next[2]);
      next = last.map((value, axis) => value + (next[axis] - value) * share);
      landed = true;
    }
    const clear = (point) => (point[2] < 0 && !onPlinth) || !pathBlocked(context, [last, point], [instance.id]);
    if (!clear(next)) {
      // Halve back to where it meets a module
      let low = 0;
      let high = 1;
      for (let step = 0; step < HIT_STEPS; step++) {
        const middle = (low + high) / 2;
        if (clear(last.map((value, axis) => value + (next[axis] - value) * middle))) low = middle;
        else high = middle;
      }
      next = last.map((value, axis) => value + (next[axis] - value) * low);
      landed = true;
    }
    const length = along[along.length - 1] + Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]);
    if (length > along[along.length - 1]) {
      points.push(next);
      along.push(length);
    }
    if (landed || length >= FALL_FADE_MM) break;
  }
  return { module: instance.id, family: instance.family, points, along, dir: [dir[0], dir[1], 0] };
}

// Pours from every flowing stub of the runoff and disposal modules
export function pourPaths(modules, context) {
  const pours = [];
  for (const instance of modules) {
    if (!POURING.includes(instance.family)) continue;
    const pose = instancePose(instance);
    for (const outlet of buildRecipe(instance).anchors.outlet) {
      const dir = poseApply({ turns: pose.turns, x: 0, y: 0, z: 0 }, ...outlet.dir).map(Math.round);
      const mouth = poseApply(pose, ...outlet.at);
      pours.push(pourArc(context, instance, mouth.map((value, axis) => value + dir[axis] * POUR_START_MM), dir));
    }
  }
  return pours;
}

// Two crossed ribbons along a pour, fading with the length fallen
export function pourQuads(pour) {
  const side = [-pour.dir[1], pour.dir[0], 0];
  const quads = [];
  for (let index = 1; index < pour.points.length; index++) {
    const from = pour.points[index - 1];
    const to = pour.points[index];
    const run = minus(to, from);
    const length = Math.hypot(...run) || 1;
    // Second ribbon lies in the fall plane, across the flow
    const flat = [pour.dir[0] * -run[2] / length, pour.dir[1] * -run[2] / length, Math.hypot(run[0], run[1]) / length];
    for (const across of [side, flat]) {
      quads.push([
        corner(shift(from, across, -POUR_WIDE_MM / 2), pour.along[index - 1], fallFade(pour.along[index - 1])),
        corner(shift(from, across, POUR_WIDE_MM / 2), pour.along[index - 1], fallFade(pour.along[index - 1])),
        corner(shift(to, across, POUR_WIDE_MM / 2), pour.along[index], fallFade(pour.along[index])),
        corner(shift(to, across, -POUR_WIDE_MM / 2), pour.along[index], fallFade(pour.along[index])),
      ]);
    }
  }
  return quads;
}
