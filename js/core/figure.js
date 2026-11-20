import { FIGURE_HEIGHT_M, FIGURE_STORY_M, FIGURE_ACCENTS, STORY_MM } from '../config.js';
import { makeRng } from './rng.js';

export const HEAD_SHAPES = ['round', 'wide', 'tall']; // head outline
export const FEATURES = ['none', 'glasses', 'tuft', 'bun', 'cap', 'hat']; // one feature on the head
export const ACCESSORIES = ['bag', 'umbrella', 'dog', 'plant', 'bicycle', 'book']; // one thing they carry
export const BUILDS = { slim: 0.82, medium: 1, stout: 1.2 }; // peg width factor
const MM_PER_M = STORY_MM / FIGURE_STORY_M; // model mm per real metre

// Peg proportions as shares of height
const HEAD_SHARE = 0.19; // head radius
const HEAD_SIZES = [0.88, 0.96, 1.04, 1.12]; // seeded head size factors, visibly apart
const HEIGHT_STEP_M = 0.05; // heights roll in steps people can see
const HEAD_STRETCH = 0.22; // wide or tall heads stretch by this share of the radius
const NECK_GAP = 0.03; // body top sits this far under the head
const BODY_BASE = 0.2; // peg radius at the base
const BODY_TOP = 0.12; // peg radius at the shoulders
const HAND_R = 0.05; // floating hand radius
const HAND_Z = 0.36; // hand height
const HAND_OUT = 0.08; // hand gap outside the body
const DARK_PARTS = 'dark'; // colour name for hair and props

// Seeded look of one resident; looks is the record's looks seed
export function figureParams(looks) {
  const rng = makeRng(looks >>> 0);
  return {
    height: Math.round((FIGURE_HEIGHT_M[0] + HEIGHT_STEP_M * rng.int(0, Math.floor((FIGURE_HEIGHT_M[1] - FIGURE_HEIGHT_M[0]) / HEIGHT_STEP_M + 1e-9))) * 100) / 100,
    headShape: rng.pick(HEAD_SHAPES),
    headSize: rng.pick(HEAD_SIZES),
    feature: rng.pick(FEATURES),
    accessory: rng.pick(ACCESSORIES),
    build: rng.pick(Object.keys(BUILDS)),
    accent: FIGURE_ACCENTS[rng.int(0, FIGURE_ACCENTS.length - 1)],
    side: rng.chance(0.5) ? 1 : -1,
  };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// Head radius and its half stretch across and up, metres
function headSize(params) {
  const radius = HEAD_SHARE * params.height * params.headSize;
  const stretch = HEAD_STRETCH * radius;
  return { radius, across: params.headShape === 'wide' ? stretch : 0, up: params.headShape === 'tall' ? stretch : 0 };
}

// Joints in metres, facing -y, base on z 0: base, neck, head centre, hands
export function figureJoints(params) {
  const H = params.height;
  const head = headSize(params);
  const headZ = H - head.radius - head.up;
  const neckZ = headZ - head.radius - head.up + NECK_GAP * H;
  const width = BUILDS[params.build];
  const handX = BODY_BASE * H * width * 0.8 + HAND_OUT * H;
  const joints = {
    base: [0, 0, 0],
    neck: [0, 0, neckZ],
    head: [0, 0, headZ],
    handL: [-handX, -0.02, HAND_Z * H],
    handR: [handX, -0.02, HAND_Z * H],
  };
  // Some things are carried in front with both hands
  if (params.accessory === 'plant' || params.accessory === 'book') {
    joints.handL = [-BODY_TOP * H * width, -BODY_BASE * H * width * 1.3, HAND_Z * H + 0.05];
    joints.handR = [BODY_TOP * H * width, -BODY_BASE * H * width * 1.3, HAND_Z * H + 0.05];
  }
  if (params.accessory === 'umbrella') {
    const side = params.side > 0 ? 'R' : 'L';
    joints['hand' + side] = [params.side * handX * 0.9, -0.08, (HAND_Z + 0.16) * H];
  }
  return joints;
}

// Parts in metres: capsule {a, b, r}, sphere {c, r}, box {c, size}, cone {a, b, r1, r2}, ring {c, r, tube, axis}
function partsInMetres(params, joints) {
  const H = params.height;
  const width = BUILDS[params.build];
  const parts = [];
  const capsule = (a, b, r, color = 'body', name) => parts.push({ kind: 'capsule', a, b, r, color, ...(name ? { name } : {}) });
  const sphere = (c, r, color = 'body', name) => parts.push({ kind: 'sphere', c, r, color, ...(name ? { name } : {}) });
  // Peg body in the accent colour, rounded at the shoulders
  parts.push({ kind: 'cone', a: joints.base, b: joints.neck, r1: BODY_BASE * H * width, r2: BODY_TOP * H * width, color: 'accent', name: 'body' });
  sphere(joints.neck, BODY_TOP * H * width, 'accent', 'shoulders');
  // Head: a ball, or a short capsule across or up
  const head = headSize(params);
  const centre = joints.head;
  if (head.across > 0) capsule(add(centre, [-head.across, 0, 0]), add(centre, [head.across, 0, 0]), head.radius, 'body', 'head');
  else if (head.up > 0) capsule(add(centre, [0, 0, -head.up]), add(centre, [0, 0, head.up]), head.radius, 'body', 'head');
  else sphere(centre, head.radius, 'body', 'head');
  for (const name of ['handL', 'handR']) sphere(joints[name], HAND_R * H, 'body', name);
  // One feature on the head
  const R = head.radius;
  const top = add(centre, [0, 0, R + head.up]);
  if (params.feature === 'glasses') {
    for (const sign of [-1, 1]) parts.push({ kind: 'ring', c: add(centre, [sign * R * 0.38, -R * 0.93, R * 0.08]), r: R * 0.24, tube: R * 0.05, axis: [0, 1, 0], color: DARK_PARTS });
    capsule(add(centre, [-R * 0.14, -R * 0.98, R * 0.1]), add(centre, [R * 0.14, -R * 0.98, R * 0.1]), R * 0.04, DARK_PARTS);
  }
  if (params.feature === 'tuft') capsule(add(top, [0, 0, -R * 0.15]), add(top, [R * 0.12, R * 0.05, R * 0.35]), R * 0.13, DARK_PARTS);
  if (params.feature === 'bun') sphere(add(centre, [0, R * 0.55, R * 0.8 + head.up]), R * 0.36, DARK_PARTS);
  if (params.feature === 'cap') {
    parts.push({ kind: 'cone', a: add(top, [0, 0, -R * 0.42]), b: add(top, [0, 0, R * 0.05]), r1: R * 0.93, r2: R * 0.62, color: DARK_PARTS });
    parts.push({ kind: 'box', c: add(top, [0, -R * 0.9, -R * 0.38]), size: [R * 1.1, R * 0.7, R * 0.08], color: DARK_PARTS });
  }
  if (params.feature === 'hat') {
    parts.push({ kind: 'cone', a: add(top, [0, 0, -R * 0.3]), b: add(top, [0, 0, -R * 0.24]), r1: R * 1.45, r2: R * 1.45, color: DARK_PARTS });
    parts.push({ kind: 'cone', a: add(top, [0, 0, -R * 0.28]), b: add(top, [0, 0, R * 0.32]), r1: R * 0.8, r2: R * 0.7, color: DARK_PARTS });
  }
  // One accessory, its parts marked for the card crop
  const accessoryFrom = parts.length;
  const sign = params.side;
  const hand = joints[sign > 0 ? 'handR' : 'handL'];
  if (params.accessory === 'bag') {
    capsule(hand, add(hand, [0, 0, -0.08]), 0.01, DARK_PARTS);
    parts.push({ kind: 'box', c: add(hand, [sign * 0.03, 0, -0.2]), size: [0.1, 0.3, 0.24], color: DARK_PARTS });
  }
  if (params.accessory === 'book') parts.push({ kind: 'box', c: add(joints.handL, [BODY_TOP * H * width, -0.04, 0.06]), size: [0.3, 0.05, 0.22], color: DARK_PARTS });
  if (params.accessory === 'umbrella') {
    const peak = [hand[0], hand[1], H + 0.3];
    capsule(add(hand, [0, 0, -0.08]), peak, 0.012, DARK_PARTS);
    parts.push({ kind: 'cone', a: add(peak, [0, 0, -0.22]), b: peak, r1: 0.55, r2: 0.02, color: DARK_PARTS });
  }
  if (params.accessory === 'plant') {
    const pot = [0, -BODY_BASE * H * width * 1.45, HAND_Z * H];
    parts.push({ kind: 'cone', a: add(pot, [0, 0, -0.1]), b: add(pot, [0, 0, 0.08]), r1: 0.09, r2: 0.12, color: DARK_PARTS });
    for (const [x, y, z] of [[0, 0, 0.22], [-0.09, 0.02, 0.16], [0.09, -0.02, 0.18], [0.02, -0.07, 0.28]]) sphere(add(pot, [x, y, z]), 0.08, 'leaf');
  }
  if (params.accessory === 'dog') {
    const dogX = sign * 0.62;
    capsule([dogX, 0.15, 0.3], [dogX, -0.22, 0.32], 0.1, DARK_PARTS);
    sphere([dogX, -0.36, 0.44], 0.1, DARK_PARTS);
    for (const [x, y] of [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.2], [0.06, -0.2]]) capsule([dogX + x, y, 0.28], [dogX + x, y, 0.03], 0.03, DARK_PARTS);
    capsule([dogX, 0.2, 0.34], [dogX, 0.34, 0.5], 0.025, DARK_PARTS);
    capsule(hand, [dogX, -0.32, 0.46], 0.006, DARK_PARTS);
  }
  if (params.accessory === 'bicycle') {
    const bikeX = sign * 0.55;
    const wheel = 0.3;
    for (const y of [-0.48, 0.48]) parts.push({ kind: 'ring', c: [bikeX, y, wheel], r: wheel, tube: 0.025, axis: [1, 0, 0], color: DARK_PARTS });
    const seat = [bikeX, 0.16, 0.78];
    const bars = [bikeX, -0.38, 0.86];
    const crank = [bikeX, 0, wheel];
    capsule([bikeX, 0.48, wheel], crank, 0.02, DARK_PARTS);
    capsule(crank, seat, 0.02, DARK_PARTS);
    capsule(seat, [bikeX, -0.32, 0.74], 0.02, DARK_PARTS);
    capsule([bikeX, -0.48, wheel], bars, 0.02, DARK_PARTS);
    capsule(add(bars, [-0.18, 0, 0]), add(bars, [0.18, 0, 0]), 0.018, DARK_PARTS);
  }
  for (const part of parts.slice(accessoryFrom)) part.role = 'accessory';
  return parts;
}

const PART_POINTS = { capsule: ['a', 'b'], sphere: ['c'], box: ['c'], cone: ['a', 'b'], ring: ['c'] }; // point fields per part kind
const PART_SIZES = { capsule: ['r'], sphere: ['r'], box: [], cone: ['r1', 'r2'], ring: ['r', 'tube'] }; // length fields per part kind

// A whole figure in model mm: params, joints and parts
export function makeFigure(looks) {
  const params = figureParams(looks);
  const joints = figureJoints(params);
  const parts = partsInMetres(params, joints).map((part) => {
    const out = { ...part };
    for (const field of PART_POINTS[part.kind]) out[field] = scale(part[field], MM_PER_M);
    for (const field of PART_SIZES[part.kind]) out[field] = part[field] * MM_PER_M;
    if (part.size) out.size = scale(part.size, MM_PER_M);
    return out;
  });
  return { params, joints: Object.fromEntries(Object.entries(joints).map(([name, point]) => [name, scale(point, MM_PER_M)])), parts, heightMm: params.height * MM_PER_M };
}

// Highest point of one part, mm
export function partTop(part) {
  const reach = part.kind === 'box' ? part.size[2] / 2 : part.kind === 'ring' ? part.r + part.tube : part.kind === 'cone' ? 0 : part.r;
  return Math.max(...PART_POINTS[part.kind].map((field) => part[field][2] + reach));
}

// Highest point of any part, mm
export const figureTop = (figure) => Math.max(0, ...figure.parts.map(partTop));
