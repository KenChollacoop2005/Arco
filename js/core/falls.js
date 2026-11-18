import { STORY_MM } from '../config.js';

export const SHEET_WIDE_MM = [2, 0.6, 5]; // sheet width: base, per unit, most
export const FALL_FADE_MM = 70; // falling water fades out over this drop
export const SHEET_FADE_MIN = 0.15; // overflow still shows where it lands
const FALL_PIECE_MM = STORY_MM / 2; // fall drawn in pieces this tall

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
