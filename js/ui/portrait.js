import { convexHull } from '../core/hull.js';
import { makeRng } from '../core/rng.js';
import { figureTop } from '../core/figure.js';

const PORTRAIT_SIZE = [96, 120]; // card portrait in CSS pixels
const PIXEL_SCALE = 2; // canvas pixels per CSS pixel
const PAD = 0.1; // margin around the figure, share of height
const VIEW_YAW = -0.42; // three-quarter turn, radians
const VIEW_PITCH = 0.12; // slight look down, radians
const ROUND_STEPS = 14; // points around a circle
const JITTER_PX = 0.55; // hand wobble per point, canvas px
const LINE_PX = 1.6; // main stroke width, canvas px
const ECHO_ALPHA = 0.35; // second, lighter pass
const INK = '#26272a'; // pen colour
const PAPER = '#fbfaf7'; // fill behind each part
const DARK_WASH = '#b9b5ad'; // hair and props wash
const LEAF_WASH = '#b7c7a8'; // leaves wash
const ACCENT_ALPHA = 0.45; // accent wash strength
const cache = new Map();

const circle = (centre, radius, steps = ROUND_STEPS) => Array.from({ length: steps }, (unused, index) => {
  const angle = (index / steps) * Math.PI * 2;
  return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius];
});

// 3D point to screen: x right, y down, depth away from the viewer
export function project(point) {
  const [x, y, z] = point;
  const turnedX = x * Math.cos(VIEW_YAW) - y * Math.sin(VIEW_YAW);
  const depth = x * Math.sin(VIEW_YAW) + y * Math.cos(VIEW_YAW);
  return [turnedX, -(z * Math.cos(VIEW_PITCH) - depth * Math.sin(VIEW_PITCH)), depth];
}

// Circle around an axis in 3D, as points
function ring3d(centre, axis, radius) {
  const length = Math.hypot(...axis) || 1;
  const unit = axis.map((value) => value / length);
  const helper = Math.abs(unit[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const first = [unit[1] * helper[2] - unit[2] * helper[1], unit[2] * helper[0] - unit[0] * helper[2], unit[0] * helper[1] - unit[1] * helper[0]];
  const firstLength = Math.hypot(...first);
  const across = first.map((value) => value / firstLength);
  const second = [unit[1] * across[2] - unit[2] * across[1], unit[2] * across[0] - unit[0] * across[2], unit[0] * across[1] - unit[1] * across[0]];
  return Array.from({ length: ROUND_STEPS }, (unused, index) => {
    const angle = (index / ROUND_STEPS) * Math.PI * 2;
    return centre.map((value, axisIndex) => value + (across[axisIndex] * Math.cos(angle) + second[axisIndex] * Math.sin(angle)) * radius);
  });
}

const WASH = { dark: DARK_WASH, leaf: LEAF_WASH }; // part colour to fill wash

// Figure parts as flat outlines, far ones first
export function sketchShapes(figure) {
  const shapes = [];
  for (const part of figure.parts) {
    const fill = part.color === 'accent' ? 'accent' : WASH[part.color] || PAPER;
    if (part.kind === 'ring') {
      const outer = ring3d(part.c, part.axis, part.r + part.tube).map(project);
      const inner = ring3d(part.c, part.axis, part.r - part.tube).map(project);
      shapes.push({ points: outer, depth: project(part.c)[2], fill: null }, { points: inner, depth: project(part.c)[2], fill: null });
      continue;
    }
    let flat;
    if (part.kind === 'sphere') flat = circle(project(part.c), part.r);
    else if (part.kind === 'capsule') flat = [...circle(project(part.a), part.r), ...circle(project(part.b), part.r)];
    else if (part.kind === 'cone') {
      const axis = part.b.map((value, index) => value - part.a[index]);
      flat = [...ring3d(part.a, axis, part.r1), ...ring3d(part.b, axis, Math.max(part.r2, 1e-3))].map(project);
    } else {
      const half = part.size.map((value) => value / 2);
      flat = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) flat.push(project([part.c[0] + sx * half[0], part.c[1] + sy * half[1], part.c[2] + sz * half[2]]));
    }
    const centre = project(part.kind === 'capsule' || part.kind === 'cone' ? part.a.map((value, index) => (value + part.b[index]) / 2) : part.c);
    shapes.push({ points: convexHull(flat), depth: centre[2], fill });
  }
  return shapes.sort((first, second) => second.depth - first.depth);
}

// Draws outlines with a seeded wobble and a lighter echo
export function drawShapes(context, shapes, { seed = 1, accent = '#888', toPixel = (point) => point, line = LINE_PX } = {}) {
  const rng = makeRng(seed >>> 0);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = INK;
  for (const shape of shapes) {
    const points = shape.points.map(toPixel);
    for (const pass of [0, 1]) {
      context.beginPath();
      points.forEach((point, index) => {
        const x = point[0] + (rng.next() - 0.5) * JITTER_PX * 2 * (pass + 1);
        const y = point[1] + (rng.next() - 0.5) * JITTER_PX * 2 * (pass + 1);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      if (pass === 0 && shape.fill) {
        context.globalAlpha = 1;
        context.fillStyle = PAPER;
        context.fill();
        if (shape.fill !== PAPER) {
          context.globalAlpha = shape.fill === 'accent' ? ACCENT_ALPHA : 1;
          context.fillStyle = shape.fill === 'accent' ? accent : shape.fill;
          context.fill();
        }
      }
      context.globalAlpha = pass === 0 ? 1 : ECHO_ALPHA;
      context.lineWidth = pass === 0 ? line : line * 0.7;
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

export const accentCss = (color) => `#${color.toString(16).padStart(6, '0')}`;

// Portrait PNG of a figure, cached per looks seed
export function portraitOf(looks, figure) {
  if (cache.has(looks)) return cache.get(looks);
  const canvas = document.createElement('canvas');
  const [width, height] = PORTRAIT_SIZE.map((size) => size * PIXEL_SCALE);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const shapes = sketchShapes(figure);
  const all = shapes.flatMap((shape) => shape.points);
  const minX = Math.min(...all.map((point) => point[0]));
  const maxX = Math.max(...all.map((point) => point[0]));
  const top = Math.min(...all.map((point) => point[1]), -figureTop(figure));
  const bottom = Math.max(...all.map((point) => point[1]));
  const span = Math.max((maxX - minX) / width, (bottom - top) / height) * (1 + PAD * 2);
  const offset = [width / 2 - ((minX + maxX) / 2) / span, height / 2 - ((top + bottom) / 2) / span];
  drawShapes(context, shapes, { seed: looks, accent: accentCss(figure.params.accent), toPixel: (point) => [point[0] / span + offset[0], point[1] / span + offset[1]] });
  const url = canvas.toDataURL('image/png');
  cache.set(looks, url);
  return url;
}
