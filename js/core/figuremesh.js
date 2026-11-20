import { FIGURE_BODY_COLOR, FIGURE_DARK_COLOR } from '../config.js';
import { rasterThumb, viewBasis } from './thumb.js';

const LEAF_COLOR = 0x6f8f5e; // plant leaves
const PAPER_COLOR = 0xf2efe8; // cups and newspapers
const ROUND = { head: [28, 18], sphere: [14, 10], cone: 28, ring: [8, 24], capsule: [12, 6] }; // segments per shape
const STRIPES = 6; // stripe bands along a patterned part
const DOTS_AROUND = 9; // dot columns around a patterned part
const DOT_ROWS = 4; // dot rows along a patterned part
const DOT_RADIUS = 0.28; // dot radius, share of a cell
const BATCHES = ['matte', 'gloss', 'pattern']; // material groups per bone

// sRGB hex to linear rgb
export function linearColor(hex) {
  return [16, 8, 0].map((shift) => {
    const value = ((hex >> shift) & 255) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
}

export const figureColors = (params) => ({ skin: FIGURE_BODY_COLOR, top: params.accent, bottom: params.bottom, dark: FIGURE_DARK_COLOR, leaf: LEAF_COLOR, item: params.item, paper: PAPER_COLOR });

// Pattern colour at a surface spot: u around, v along, both 0 to 1
export function patternAt(pattern, base, u, v) {
  if (!pattern) return base;
  if (pattern.kind === 'stripes') return Math.floor(v * STRIPES) % 2 === 1 ? pattern.color : base;
  const row = Math.floor(v * DOT_ROWS);
  const across = u * DOTS_AROUND + (row % 2) * 0.5;
  const dx = across - Math.floor(across) - 0.5;
  const dy = v * DOT_ROWS - row - 0.5;
  return Math.hypot(dx, dy) < DOT_RADIUS ? pattern.color : base;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

// Two unit vectors square to an axis
function basis(axis) {
  const along = unit(axis);
  const helper = Math.abs(along[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const across = unit(cross(along, helper));
  return [along, across, cross(along, across)];
}

const emptyBatch = () => ({ positions: [], normals: [], colors: [], uvs: [], index: [] });

// Grid surface: point(u, v) returns [position, normal]
function grid(batch, cols, rows, point, color) {
  const start = batch.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const [position, normal] = point(col / cols, row / rows);
      batch.positions.push(...position);
      batch.normals.push(...unit(normal));
      batch.colors.push(...color);
      batch.uvs.push(col / cols, row / rows);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const first = start + row * (cols + 1) + col;
      const next = first + cols + 1;
      batch.index.push(first, first + 1, next, first + 1, next + 1, next);
    }
  }
}

// Flat disc at a cone end, facing out along normal
function disc(batch, centre, normal, across, second, radius, steps, color) {
  const start = batch.positions.length / 3;
  batch.positions.push(...centre);
  batch.normals.push(...normal);
  batch.colors.push(...color);
  batch.uvs.push(0.5, 0.5);
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * Math.PI * 2;
    batch.positions.push(...centre.map((value, axis) => value + (across[axis] * Math.cos(angle) + second[axis] * Math.sin(angle)) * radius));
    batch.normals.push(...normal);
    batch.colors.push(...color);
    batch.uvs.push(0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2);
  }
  const facing = cross(across, second)[0] * normal[0] + cross(across, second)[1] * normal[1] + cross(across, second)[2] * normal[2] > 0;
  for (let step = 0; step < steps; step++) batch.index.push(...(facing ? [start, start + 1 + step, start + 2 + step] : [start, start + 2 + step, start + 1 + step]));
}

// Sphere or upper half dome, optionally squashed per axis
function ellipsoid(batch, centre, radii, [cols, rows], color, fromV = 0) {
  grid(batch, cols, rows, (u, v) => {
    const theta = u * Math.PI * 2;
    const phi = (fromV + (1 - fromV) * v) * Math.PI;
    const dir = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), -Math.cos(phi)];
    return [centre.map((value, axis) => value + dir[axis] * radii[axis]), dir.map((value, axis) => value / radii[axis])];
  }, color);
}

// Frustum from a to b with end discs
function cone(batch, a, b, r1, r2, color, steps = ROUND.cone) {
  const [along, across, second] = basis(sub(b, a));
  const length = Math.hypot(...sub(b, a));
  grid(batch, steps, 1, (u, v) => {
    const theta = u * Math.PI * 2;
    const radial = across.map((value, axis) => value * Math.cos(theta) + second[axis] * Math.sin(theta));
    const radius = r1 + (r2 - r1) * v;
    return [a.map((value, axis) => value + along[axis] * length * v + radial[axis] * radius), radial.map((value, axis) => value * length + along[axis] * (r1 - r2))];
  }, color);
  disc(batch, a, along.map((value) => -value), across, second, r1, steps, color);
  if (r2 > 1e-6) disc(batch, b, along, across, second, r2, steps, color);
}

// Torus around an axis, part of a turn when arc is given
function ring(batch, part, color) {
  const [along, across, second] = basis(part.axis);
  const start = part.start || 0;
  const arc = part.arc || Math.PI * 2;
  const [tubeSteps, ringSteps] = ROUND.ring;
  grid(batch, ringSteps, tubeSteps, (u, v) => {
    const angle = start + u * arc;
    const out = across.map((value, axis) => value * Math.cos(angle) + second[axis] * Math.sin(angle));
    const tube = v * Math.PI * 2;
    const normal = out.map((value, axis) => value * Math.cos(tube) + along[axis] * Math.sin(tube));
    return [part.c.map((value, axis) => value + out[axis] * part.r + normal[axis] * part.tube), normal];
  }, color);
}

function box(batch, part, color) {
  const half = part.size.map((value) => value / 2);
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const normal = [0, 0, 0];
      normal[axis] = sign;
      const uAxis = (axis + 1) % 3;
      const vAxis = (axis + 2) % 3;
      const start = batch.positions.length / 3;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = [...part.c];
        corner[axis] += sign * half[axis];
        corner[uAxis] += du * half[uAxis];
        corner[vAxis] += dv * half[vAxis];
        batch.positions.push(...corner);
        batch.normals.push(...normal);
        batch.colors.push(...color);
        batch.uvs.push((du + 1) / 2, (dv + 1) / 2);
      }
      batch.index.push(...(sign > 0 ? [start, start + 1, start + 2, start, start + 2, start + 3] : [start, start + 2, start + 1, start, start + 3, start + 2]));
    }
  }
}

// Adds one part's triangles to a batch
function tessellate(batch, part, color) {
  if (part.kind === 'sphere') {
    const squash = part.squash || [1, 1, 1];
    ellipsoid(batch, part.c, squash.map((value) => value * part.r), part.name === 'head' ? ROUND.head : ROUND.sphere, color);
  } else if (part.kind === 'dome') ellipsoid(batch, part.c, [part.r, part.r, part.h], ROUND.head, color, 0.5);
  else if (part.kind === 'cone') cone(batch, part.a, part.b, part.r1, part.r2, color);
  else if (part.kind === 'capsule') {
    cone(batch, part.a, part.b, part.r, part.r, color, ROUND.capsule[0]);
    for (const end of [part.a, part.b]) ellipsoid(batch, end, [part.r, part.r, part.r], ROUND.capsule, color);
  } else if (part.kind === 'ring') ring(batch, part, color);
  else box(batch, part, color);
}

// Triangles per bone and material: {bones: {head: {matte, gloss, pattern}}, pattern}
export function figureBatches(figure) {
  const palette = figureColors(figure.params);
  const bones = {};
  for (const part of figure.parts) {
    const key = part.pattern ? 'pattern' : part.gloss ? 'gloss' : 'matte';
    bones[part.bone] = bones[part.bone] || Object.fromEntries(BATCHES.map((name) => [name, emptyBatch()]));
    tessellate(bones[part.bone][key], part, linearColor(part.pattern ? 0xffffff : palette[part.color]));
  }
  const patterned = figure.parts.find((part) => part.pattern);
  return { bones, pattern: patterned ? { ...figure.params.pattern, base: palette[patterned.color] } : null };
}

// Every batch in one list with per vertex gloss and pattern flags, for thumbnails
export function figureSurface(figure, keep = () => true) {
  const { bones, pattern } = figureBatches(figure);
  const out = { positions: [], normals: [], colors: [], uvs: [], gloss: [], mask: [], index: [] };
  for (const [bone, batches] of Object.entries(bones)) {
    if (!keep(bone)) continue;
    for (const [key, batch] of Object.entries(batches)) {
      const offset = out.positions.length / 3;
      out.positions.push(...batch.positions);
      out.normals.push(...batch.normals);
      out.colors.push(...batch.colors);
      out.uvs.push(...batch.uvs);
      for (let vertex = 0; vertex < batch.positions.length / 3; vertex++) {
        out.gloss.push(key === 'gloss' ? 1 : 0);
        out.mask.push(key === 'pattern' ? 1 : 0);
      }
      out.index.push(...batch.index.map((corner) => corner + offset));
    }
  }
  return { ...out, pattern };
}

export const FIGURE_VIEW = { azimuth: -68, elevation: 10 }; // portraits: front three-quarter, slightly above
const CARD_BELOW_NECK = 0.24; // card crop this far under the shoulders, share of height
const CARD_ABOVE_HEAD = 0.04; // card room over the head, share of height

// Head-and-shoulders crop line and top, mm
export function cardFrame(figure) {
  return { bottom: figure.joints.neck[2] - CARD_BELOW_NECK * figure.heightMm, top: figureTopOf(figure) + CARD_ABOVE_HEAD * figure.heightMm };
}

const figureTopOf = (figure) => Math.max(...figure.parts.filter((part) => part.bone === 'head').map((part) => (part.kind === 'sphere' ? part.c[2] + part.r : part.kind === 'dome' ? part.c[2] + part.h : part.c ? part.c[2] + (part.r || 0) : 0)));

// Portrait pixels from the 3D figure with the module thumbnail renderer; frame 'card' or 'full'
export function figurePortrait(figure, { width, height, frame = 'full' }) {
  const surface = figureSurface(figure);
  const { right, up } = viewBasis(FIGURE_VIEW);
  const flat = (index) => {
    const point = surface.positions.slice(index * 3, index * 3 + 3);
    return [dot3(point, right), dot3(point, up), point[2]];
  };
  const count = surface.positions.length / 3;
  let bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const crop = frame === 'card' ? cardFrame(figure) : null;
  for (let vertex = 0; vertex < count; vertex++) {
    const [x, y, z] = flat(vertex);
    if (crop && (z < crop.bottom || z > crop.top)) continue;
    bounds = { minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x), minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y) };
  }
  // Card: centred on the head, as wide as it is tall
  if (crop) {
    const head = figure.joints.head;
    const middle = dot3(head, right);
    const span = Math.max(bounds.maxY - bounds.minY, (bounds.maxX - bounds.minX) * 0.8) / 2;
    const centreY = (bounds.maxY + bounds.minY) / 2;
    bounds = { minX: middle - span * (width / height), maxX: middle + span * (width / height), minY: centreY - span, maxY: centreY + span };
  }
  const sample = surface.pattern ? (u, v) => linearColor(patternAt(surface.pattern, surface.pattern.base, u, v)) : null;
  return rasterThumb(Float32Array.from(surface.positions), Uint32Array.from(surface.index), Float32Array.from(surface.colors), width, {
    height,
    view: FIGURE_VIEW,
    bounds,
    normals: Float32Array.from(surface.normals),
    gloss: Uint8Array.from(surface.gloss),
    pattern: sample ? { uvs: Float32Array.from(surface.uvs), mask: Uint8Array.from(surface.mask), sample } : null,
  });
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
