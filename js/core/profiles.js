import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM, SIDE_CLEAR_MM } from '../config.js';
import { makeRng, mixSeed } from './rng.js';

// Side profile kinds, stored 3 bits per local side
export const PROFILE_IDS = ['flush', 'inset', 'insetBalcony', 'insetBalconyOut', 'bulge', 'bulgeBalcony', 'wrap', 'jetty'];
export const [FLUSH, INSET, INSET_BALCONY, INSET_BALCONY_OUT, BULGE, BULGE_BALCONY, WRAP, JETTY] = PROFILE_IDS.map((id, kind) => kind);
const KIND_BITS = 3; // bits per side in prof
const KIND_MASK = 7; // one side's bits

// Rectangular footprints take profiles, size in cells
export const PROFILE_FOOTPRINTS = { '1x1': [1, 1], '1x2': [2, 1], '2x2': [2, 2], '2x3': [3, 2] };

const INSET_SHARE = [0.12, 0.18]; // inset depth, share of a cell
const BULGE_SHARE = [0.1, 0.18]; // bulge depth, share of a cell
const BALCONY_SHARE = [0.18, 0.24]; // balcony reach past the wall, share of a cell
const PIER_IN_SHARE = 0.28; // corner pier beside an inset
const PIER_OUT_SHARE = 0.18; // corner strip beside a bulge or balcony
export const RESERVE_SHARE = 0.5; // near strip of the claimed cell
const LEVEL_CHANCE = 0.7; // chance a story gets its balcony
export const PARAPET_MM = 1.6; // balcony parapet thickness
export const BALCONY_FLOOR_MM = 1.6; // balcony floor at its thinnest
const RAIL_SHARE = 0.16; // parapet height, share of a story
export const BALCONY_LIP_MM = 0.5; // balcony ends inside a bulge front
const JETTY_SHARE = [0.12, 0.2]; // jetty depth, share of a cell
const JETTY_START_SHARE = 0.56; // jetty foot on a one story module, share of a story
export const JETTY_SUPPORTS = ['corbel', 'brace', 'arch']; // what carries a jetty
export const JETTY_BRACE_RAKE = 1.5; // brace drop per mm of reach
const JETTY_SALT = 9; // keeps jetty rolls apart from balcony rolls
const SEED_SALT = 0x51de0f; // keeps profile rolls apart from style rolls
const NORMALS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // side order of the grid

const insetKind = (kind) => kind === INSET || kind === INSET_BALCONY || kind === INSET_BALCONY_OUT;
const bulgeKind = (kind) => kind === BULGE || kind === BULGE_BALCONY;
const outKind = (kind) => kind === INSET_BALCONY_OUT || bulgeKind(kind) || kind === WRAP || kind === JETTY;

export const profileAt = (prof, side) => ((prof || 0) >> (KIND_BITS * side)) & KIND_MASK;
export const packProfiles = (kinds) => kinds.reduce((prof, kind, side) => prof | (kind << (KIND_BITS * side)), 0);
export const profileKinds = (prof) => [0, 1, 2, 3].map((side) => profileAt(prof, side));

// Profiles a variant may keep: facade sides, known kinds, legal wraps
export function cleanProfiles(prof, mask, footprintId, allowed) {
  if (!allowed || !PROFILE_FOOTPRINTS[footprintId] || !Number.isInteger(prof) || prof <= 0) return 0;
  const facade = (side) => ((mask >> side) & 1) === 1;
  const kinds = profileKinds(prof).map((kind, side) => (facade(side) && kind < PROFILE_IDS.length ? kind : FLUSH));
  for (let side = 0; side < 4; side++) {
    if (kinds[side] !== WRAP) continue;
    const next = (side + 1) & 3;
    if (!facade(next) || kinds[next] === WRAP) kinds[side] = FLUSH;
    else kinds[next] = FLUSH;
  }
  return packProfiles(kinds);
}

// Balcony heights above its story line
export function balconyShape(reach) {
  const floor = Math.max(reach - PARAPET_MM, 0) + BALCONY_FLOOR_MM;
  return { floor, top: floor + RAIL_SHARE * STORY_MM };
}

// Jetty of one side: depth, foot height, support kind and its drop
function jettyPlan(variant, side) {
  const rng = makeRng(mixSeed(variant.seed >>> 0, SEED_SALT + JETTY_SALT + side));
  const out = rng.range(JETTY_SHARE[0], JETTY_SHARE[1]) * CELL_MM;
  const upper = variant.h > 1 ? rng.int(1, variant.h - 1) : 0;
  const start = variant.h > 1 ? (variant.h - upper) * STORY_MM : JETTY_START_SHARE * STORY_MM;
  const support = rng.pick(JETTY_SUPPORTS);
  return { out, start, support, drop: (support === 'brace' ? JETTY_BRACE_RAKE : 1) * out };
}

// Per local side: kind, wall shift, pier, balcony reach, distance past the wall
export function profilePlan(variant) {
  const prof = variant.prof || 0;
  if (!prof || !PROFILE_FOOTPRINTS[variant.fp]) return null;
  const rng = makeRng(mixSeed(variant.seed >>> 0, SEED_SALT));
  const inset = rng.range(INSET_SHARE[0], INSET_SHARE[1]) * CELL_MM;
  const bulge = rng.range(BULGE_SHARE[0], BULGE_SHARE[1]) * CELL_MM;
  const balcony = rng.range(BALCONY_SHARE[0], BALCONY_SHARE[1]) * CELL_MM;
  const kinds = profileKinds(prof);
  const plan = kinds.map((kind, side) => {
    const sideRng = makeRng(mixSeed(variant.seed >>> 0, SEED_SALT + 1 + side));
    const levels = [];
    for (let story = 0; story < variant.h; story++) if (sideRng.chance(LEVEL_CHANCE)) levels.push(story);
    if (levels.length === 0) levels.push(sideRng.int(0, variant.h - 1));
    const shift = insetKind(kind) ? -inset : bulgeKind(kind) ? bulge : 0;
    const past = kind === INSET_BALCONY_OUT || kind === BULGE_BALCONY || kind === WRAP ? balcony : 0;
    const reach = kind === INSET_BALCONY ? inset : kind === INSET_BALCONY_OUT ? inset + balcony : past;
    const jetty = kind === JETTY ? jettyPlan(variant, side) : null;
    return {
      kind,
      jetty,
      shift,
      pier: (insetKind(kind) ? PIER_IN_SHARE : PIER_OUT_SHARE) * CELL_MM,
      reach,
      out: jetty ? jetty.out : Math.max(shift, 0) + past,
      levels: reach > 0 ? levels : [],
      wrapped: false,
    };
  });
  kinds.forEach((kind, side) => {
    if (kind !== WRAP) return;
    const next = plan[(side + 1) & 3];
    next.wrapped = true;
    next.reach = plan[side].reach;
    next.out = plan[side].out;
    next.levels = plan[side].levels;
  });
  return plan;
}

// Which sides and corners reach into the next cell
export function profileClaims(prof) {
  const kinds = profileKinds(prof);
  const sides = kinds.map((kind, side) => outKind(kind) || kinds[(side + 3) & 3] === WRAP);
  return { sides, corners: kinds.map((kind) => kind === WRAP) };
}

// Start corner, direction and length of a side, local mm
export function sideFrame(footprintId, side) {
  const [sizeX, sizeY] = PROFILE_FOOTPRINTS[footprintId];
  const width = sizeX * CELL_MM;
  const depth = sizeY * CELL_MM;
  const normal = NORMALS[side];
  return {
    corner: [[width, 0], [width, depth], [0, depth], [0, 0]][side],
    normal,
    tangent: [-normal[1], normal[0]],
    length: side & 1 ? width : depth,
  };
}

function frameBox(frame, alongFrom, alongTo, outFrom, outTo, low, high) {
  const at = (along, out) => [
    frame.corner[0] + frame.tangent[0] * along + frame.normal[0] * out,
    frame.corner[1] + frame.tangent[1] * along + frame.normal[1] * out,
  ];
  const first = at(alongFrom, outFrom);
  const second = at(alongTo, outTo);
  return {
    kind: 'box',
    min: [Math.min(first[0], second[0]), Math.min(first[1], second[1]), low],
    max: [Math.max(first[0], second[0]), Math.max(first[1], second[1]), high],
  };
}

// Declared volumes: notches (sign -1), bulges and balconies (sign 1)
export function profileBoxes(variant, gap = CONNECTOR_CLEARANCE_MM / 2) {
  const plan = profilePlan(variant);
  if (!plan) return [];
  const height = variant.h * STORY_MM;
  const boxes = [];
  plan.forEach((side, index) => {
    const frame = sideFrame(variant.fp, index);
    const from = side.pier;
    const to = frame.length - side.pier;
    const wall = -gap + side.shift;
    const declare = (part, sign, shape) => boxes.push({ ...shape, sign, part, side: index });
    if (side.shift < 0) declare('notch', -1, frameBox(frame, from, to, wall, -gap, 0, height));
    if (side.shift > 0) declare('bulge', 1, frameBox(frame, from, to, -gap, wall, 0, height));
    if (side.jetty) {
      const { out, start, drop } = side.jetty;
      declare('jetty', 1, frameBox(frame, from, to, -gap, -gap + out, start, height));
      declare('corbel', 1, frameBox(frame, from, to, -gap, -gap + out, start - drop, start));
    }
    if (side.reach <= 0) return;
    const { top } = balconyShape(side.reach);
    for (const story of side.levels) {
      const low = story * STORY_MM;
      let alongFrom = side.kind === BULGE_BALCONY ? from + BALCONY_LIP_MM : from;
      let alongTo = side.kind === BULGE_BALCONY ? to - BALCONY_LIP_MM : to;
      if (side.kind === WRAP) alongTo = frame.length - gap + side.reach;
      if (side.wrapped) alongFrom = gap;
      declare('balcony', 1, frameBox(frame, alongFrom, alongTo, wall, wall + side.reach, low, low + top));
    }
  });
  return boxes;
}

// Collider boxes: the body less its notches, plus what sticks out
export function profileColliders(variant, gap = CONNECTOR_CLEARANCE_MM / 2) {
  const plan = profilePlan(variant);
  if (!plan) return null;
  const height = variant.h * STORY_MM;
  const [sizeX, sizeY] = PROFILE_FOOTPRINTS[variant.fp];
  const cut = plan.map((side) => (side.shift < 0 ? -side.shift : 0));
  const shapes = [{
    kind: 'box',
    min: [gap + cut[2], gap + cut[3], 0],
    max: [sizeX * CELL_MM - gap - cut[0], sizeY * CELL_MM - gap - cut[1], height],
  }];
  plan.forEach((side, index) => {
    if (cut[index] === 0) return;
    const frame = sideFrame(variant.fp, index);
    const low = index & 1 ? gap + cut[(index + 3) & 3] : gap;
    const high = frame.length - (index & 1 ? gap + cut[(index + 1) & 3] : gap);
    if (side.pier > low) shapes.push(frameBox(frame, low, side.pier, -gap - cut[index], -gap, 0, height));
    if (frame.length - side.pier < high) shapes.push(frameBox(frame, frame.length - side.pier, high, -gap - cut[index], -gap, 0, height));
  });
  for (const shape of profileBoxes(variant, gap)) {
    if (shape.sign > 0) shapes.push({ kind: 'box', min: shape.min, max: shape.max });
  }
  return shapes;
}

// Largest distance a protrusion may reach past the cell edge
export const RESERVE_REACH_MM = RESERVE_SHARE * CELL_MM;
// Protrusions keep this far from the claimed cell's other sides
export const RESERVE_SIDE_MM = SIDE_CLEAR_MM;
