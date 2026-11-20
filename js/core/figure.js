import { FIGURE_HEIGHT_M, FIGURE_STORY_M, FIGURE_ACCENTS, FIGURE_BOTTOMS, FIGURE_ITEM_COLORS, FIGURE_PATTERN_COLORS, FIGURE_PATTERN_SHARE, FIGURE_FEATURE_NONE_SHARE, FIGURE_FEATURE_WEIGHTS, FIGURE_ACCESSORY_NONE_SHARE, STORY_MM } from '../config.js';
import { makeRng } from './rng.js';

export const PROFILES = { shoulders: [0.17, 0.12], base: [0.11, 0.19], straight: [0.145, 0.145] }; // body radius at top and base, share of height
export const FEATURES = ['glasses', 'sunglasses', 'cap', 'beanie', 'bun', 'ponytail', 'headband', 'headphones']; // one head feature
export const ACCESSORIES = ['bag', 'backpack', 'briefcase', 'umbrella', 'book', 'coffee', 'shopping', 'newspaper', 'plant', 'dog', 'guitar', 'bicycle', 'balloon', 'scarf', 'toolbox']; // one thing they carry
export const PATTERNS = ['stripes', 'dots']; // body patterns
export const BUILDS = { slim: 0.88, medium: 1, stout: 1.14 }; // body width factor
export const BONES = ['head', 'torso', 'hips', 'handL', 'handR']; // parts that move apart when carried
const MM_PER_M = STORY_MM / FIGURE_STORY_M; // model mm per real metre

// Peg proportions as shares of height
const HEAD_SHARE = 0.2; // head radius
const HEAD_SIZES = [0.9, 1, 1.1]; // seeded head size factors
const HEIGHT_STEP_M = 0.05; // heights roll in steps people can see
const NECK_SINK = 0.9; // body top sits this far into the head radius
const WAIST_SHARE = 0.46; // waist height as a share of the body
const SHOULDER_DOME = 0.42; // rounded shoulder cap height, share of the top radius
const HAND_R = 0.055; // floating hand radius
const HAND_Z = 0.36; // hand height
const HAND_OUT = 0.075; // hand gap outside the body
const SHOULDER_DROP = 0.05; // shoulder pivot under the body top
const SIDES = [-1, 1]; // left and right
const FEATURE_GAP = 0.02; // features clear the head by this, share of its radius

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const pickOr = (rng, noneShare, options) => (rng.chance(noneShare) ? 'none' : rng.pick(options));
const weightedOr = (rng, noneShare, weights) => (rng.chance(noneShare) ? 'none' : rng.weighted(Object.entries(weights)));
const unit = (a) => scale(a, 1 / Math.hypot(...a));

// Seeded look of one resident; looks is the record's looks seed
export function figureParams(looks) {
  const rng = makeRng(looks >>> 0);
  const steps = Math.floor((FIGURE_HEIGHT_M[1] - FIGURE_HEIGHT_M[0]) / HEIGHT_STEP_M + 1e-9);
  const height = Math.round((FIGURE_HEIGHT_M[0] + HEIGHT_STEP_M * rng.int(0, steps)) * 100) / 100;
  const profile = rng.pick(Object.keys(PROFILES));
  const build = rng.pick(Object.keys(BUILDS));
  const headSize = rng.pick(HEAD_SIZES);
  const accent = rng.pick(FIGURE_ACCENTS);
  const bottom = rng.pick(FIGURE_BOTTOMS);
  const feature = weightedOr(rng, FIGURE_FEATURE_NONE_SHARE, FIGURE_FEATURE_WEIGHTS);
  const accessory = pickOr(rng, FIGURE_ACCESSORY_NONE_SHARE, ACCESSORIES);
  const item = rng.pick(FIGURE_ITEM_COLORS);
  const patterned = rng.chance(FIGURE_PATTERN_SHARE);
  const pattern = patterned ? { kind: rng.pick(PATTERNS), on: rng.chance(0.7) ? 'top' : 'bottom', color: rng.pick(FIGURE_PATTERN_COLORS) } : null;
  return { height, profile, build, headSize, accent, bottom, feature, accessory, item, pattern, side: rng.chance(0.5) ? 1 : -1 };
}

// Body radius at a height, metres
function bodyRadius(params, z, neckZ) {
  const [top, base] = PROFILES[params.profile];
  const share = Math.max(0, Math.min(1, z / neckZ));
  return (base + (top - base) * share) * params.height * BUILDS[params.build];
}

// Joints in metres, facing -y, base on z 0
export function figureJoints(params) {
  const H = params.height;
  const headR = HEAD_SHARE * H * params.headSize;
  const headZ = H - headR;
  const neckZ = headZ - headR * NECK_SINK;
  const waistZ = neckZ * WAIST_SHARE;
  const topR = bodyRadius(params, neckZ, neckZ);
  const handX = bodyRadius(params, HAND_Z * H, neckZ) + HAND_OUT * H;
  const joints = {
    base: [0, 0, 0],
    waist: [0, 0, waistZ],
    neck: [0, 0, neckZ],
    head: [0, 0, headZ],
    shoulderL: [-topR * 0.85, 0, neckZ - SHOULDER_DROP * H],
    shoulderR: [topR * 0.85, 0, neckZ - SHOULDER_DROP * H],
    handL: [-handX, -0.02, HAND_Z * H],
    handR: [handX, -0.02, HAND_Z * H],
  };
  // Some things are held in front with both hands
  if (['plant', 'book', 'newspaper'].includes(params.accessory)) {
    for (const sign of SIDES) joints[sign < 0 ? 'handL' : 'handR'] = [sign * topR * 0.75, -topR * 1.5, HAND_Z * H + 0.08];
  }
  // A raised hand for the umbrella, cup and balloon
  if (['umbrella', 'coffee', 'balloon'].includes(params.accessory)) {
    const name = params.side > 0 ? 'handR' : 'handL';
    joints[name] = [params.side * handX * 0.95, -0.1, (HAND_Z + 0.14) * H];
  }
  return { ...joints, headR };
}

// Parts in metres: sphere {c, r, squash}, dome {c, r, h}, cone {a, b, r1, r2}, capsule {a, b, r}, box {c, size}, ring {c, r, tube, axis, start, arc}
function partsInMetres(params, joints) {
  const H = params.height;
  const R = joints.headR;
  const parts = [];
  const put = (part, bone, color, extra = {}) => parts.push({ ...part, bone, color, ...extra });
  const neckZ = joints.neck[2];
  const topR = bodyRadius(params, neckZ, neckZ);
  const waistR = bodyRadius(params, joints.waist[2], neckZ);
  const baseR = bodyRadius(params, 0, neckZ);
  const patternOn = (where) => (params.pattern && params.pattern.on === where ? { pattern: true } : {});
  // Two-tone peg body: torso over hips, one frustum together
  put({ kind: 'cone', a: joints.waist, b: joints.neck, r1: waistR, r2: topR }, 'torso', 'top', { name: 'torso', ...patternOn('top') });
  put({ kind: 'dome', c: joints.neck, r: topR, h: topR * SHOULDER_DOME }, 'torso', 'top', { name: 'shoulders' });
  put({ kind: 'cone', a: joints.base, b: joints.waist, r1: baseR, r2: waistR }, 'hips', 'bottom', { name: 'hips', ...patternOn('bottom') });
  // Round glossy head and two floating hands
  put({ kind: 'sphere', c: joints.head, r: R }, 'head', 'skin', { name: 'head', gloss: true });
  for (const name of ['handL', 'handR']) put({ kind: 'sphere', c: joints[name], r: HAND_R * H }, name, 'skin', { name, gloss: true });
  // One head feature
  const c = joints.head;
  const feature = (part, color = 'dark', extra = {}) => put(part, 'head', color, { role: 'feature', ...extra });
  const gap = FEATURE_GAP;
  // Point on a ray from the head centre, lift past the surface in head radii
  const onHead = (direction, lift) => add(c, scale(unit(direction), R * (1 + lift)));
  // Ring radius whose tube clears the head at a height above its centre
  const clearRing = (height, tube) => R * Math.sqrt((1 + tube + gap) ** 2 - height ** 2);
  if (params.feature === 'glasses' || params.feature === 'sunglasses') {
    for (const sign of SIDES) {
      const toward = unit([sign * 0.36, -0.92, 0.1]);
      if (params.feature === 'glasses') feature({ kind: 'ring', c: onHead(toward, 0.05 + gap), r: R * 0.24, tube: R * 0.05, axis: toward });
      else feature({ kind: 'sphere', c: onHead(toward, 0.135 + gap), r: R * 0.27, squash: [1, 0.3, 0.8] }, 'dark', { gloss: true });
    }
    const bridgeLift = params.feature === 'glasses' ? 0.08 : 0.16;
    feature({ kind: 'capsule', a: onHead([-0.14, -0.98, 0.12], bridgeLift + gap), b: onHead([0.14, -0.98, 0.12], bridgeLift + gap), r: R * 0.04 });
  }
  if (params.feature === 'cap') {
    feature({ kind: 'dome', c: add(c, [0, 0, R * 0.32]), r: R * 0.97, h: R * 0.78 }, 'item');
    feature({ kind: 'box', c: add(c, [0, -R * (0.92 + gap + 0.25), R * 0.36]), size: [R * 0.8, R * 0.5, R * 0.07] }, 'item');
  }
  if (params.feature === 'beanie') {
    feature({ kind: 'dome', c: add(c, [0, 0, R * 0.3]), r: R * 1.0, h: R * 0.9 }, 'item');
    feature({ kind: 'ring', c: add(c, [0, 0, R * 0.32]), r: clearRing(0.32, 0.12), tube: R * 0.12, axis: [0, 0, 1] }, 'item');
    feature({ kind: 'sphere', c: add(c, [0, 0, R * 1.26]), r: R * 0.2 }, 'item');
  }
  if (params.feature === 'bun') feature({ kind: 'sphere', c: onHead([0, 0.5, 0.78], 0.36 + gap), r: R * 0.36 });
  if (params.feature === 'ponytail') {
    feature({ kind: 'sphere', c: onHead([0, 0.92, 0.3], 0.2 + gap), r: R * 0.2 });
    feature({ kind: 'capsule', a: add(c, [0, R * 1.19, R * 0.25]), b: add(c, [0, R * 1.26, -R * 0.5]), r: R * 0.16 });
  }
  if (params.feature === 'headband') feature({ kind: 'ring', c: add(c, [0, 0, R * 0.4]), r: clearRing(0.4, 0.09), tube: R * 0.09, axis: [0, 0, 1] }, 'item');
  if (params.feature === 'headphones') {
    feature({ kind: 'ring', c, r: R * 1.1, tube: R * 0.07, axis: [0, 1, 0], start: Math.PI, arc: Math.PI });
    const cupIn = 1 + gap;
    for (const sign of SIDES) feature({ kind: 'cone', a: add(c, [sign * R * cupIn, 0, 0]), b: add(c, [sign * R * (cupIn + 0.24), 0, 0]), r1: R * 0.34, r2: R * 0.3 }, 'item');
  }
  // One accessory
  const sign = params.side;
  const handName = sign > 0 ? 'handR' : 'handL';
  const hand = joints[handName];
  const held = (part, color = 'item', bone = handName) => put(part, bone, color, { role: 'accessory' });
  const onBody = (part, color = 'item') => put(part, 'torso', color, { role: 'accessory' });
  const onGround = (part, color = 'dark') => put(part, 'hips', color, { role: 'accessory' });
  const strap = (from, to) => held({ kind: 'capsule', a: from, b: to, r: 0.012 }, 'dark');
  const accessory = params.accessory;
  if (accessory === 'bag') {
    strap(hand, add(hand, [0, 0, -0.09]));
    held({ kind: 'box', c: add(hand, [sign * 0.02, 0, -0.2]), size: [0.09, 0.28, 0.22] });
  }
  if (accessory === 'briefcase') {
    held({ kind: 'ring', c: add(hand, [0, 0, -0.05]), r: 0.05, tube: 0.012, axis: [1, 0, 0], start: 0, arc: Math.PI }, 'dark');
    held({ kind: 'box', c: add(hand, [0, 0, -0.24]), size: [0.08, 0.38, 0.28] }, 'dark');
  }
  if (accessory === 'shopping') {
    held({ kind: 'ring', c: add(hand, [0, 0, -0.06]), r: 0.07, tube: 0.01, axis: [1, 0, 0], start: 0, arc: Math.PI }, 'dark');
    held({ kind: 'box', c: add(hand, [0, 0, -0.27]), size: [0.12, 0.26, 0.3] });
  }
  if (accessory === 'toolbox') {
    held({ kind: 'capsule', a: add(hand, [0, -0.08, -0.04]), b: add(hand, [0, 0.08, -0.04]), r: 0.018 }, 'dark');
    held({ kind: 'box', c: add(hand, [0, 0, -0.18]), size: [0.15, 0.36, 0.2] });
  }
  if (accessory === 'backpack') {
    onBody({ kind: 'box', c: add(joints.neck, [0, topR + 0.06, -0.3]), size: [topR * 1.5, 0.14, 0.42] });
    for (const strapSide of SIDES) onBody({ kind: 'ring', c: add(joints.neck, [strapSide * topR * 0.55, 0, -0.1]), r: topR * 0.95, tube: 0.014, axis: [1, 0, 0] }, 'dark');
  }
  if (accessory === 'guitar') {
    onBody({ kind: 'capsule', a: add(joints.neck, [-0.22, topR + 0.09, -0.62]), b: add(joints.neck, [0.16, topR + 0.09, 0.3]), r: 0.13 }, 'dark');
    onBody({ kind: 'ring', c: add(joints.neck, [0, 0, -0.18]), r: topR * 1.05, tube: 0.013, axis: [0.4, 0, 1] }, 'dark');
  }
  if (accessory === 'scarf') {
    onBody({ kind: 'ring', c: add(joints.neck, [0, 0, 0.01]), r: topR * 0.72, tube: 0.055, axis: [0, 0, 1] });
    onBody({ kind: 'capsule', a: add(joints.neck, [topR * 0.4, -topR * 0.75, 0]), b: add(joints.neck, [topR * 0.5, -topR * 0.95, -0.32]), r: 0.045 });
  }
  if (accessory === 'book') onBody({ kind: 'box', c: add(joints.handL, [-joints.handL[0], -0.03, 0.06]), size: [0.3, 0.05, 0.22] });
  if (accessory === 'newspaper') onBody({ kind: 'box', c: add(joints.handL, [-joints.handL[0], -0.02, 0.1]), size: [0.36, 0.02, 0.28] }, 'paper');
  if (accessory === 'plant') {
    const pot = [0, joints.handL[1] - 0.04, joints.handL[2]];
    onBody({ kind: 'cone', a: add(pot, [0, 0, -0.1]), b: add(pot, [0, 0, 0.08]), r1: 0.08, r2: 0.11 });
    for (const [x, y, z] of [[0, 0, 0.22], [-0.09, 0.02, 0.16], [0.09, -0.02, 0.18], [0.02, -0.07, 0.28]]) onBody({ kind: 'sphere', c: add(pot, [x, y, z]), r: 0.08 }, 'leaf');
  }
  if (accessory === 'coffee') {
    held({ kind: 'cone', a: add(hand, [0, -0.02, -0.02]), b: add(hand, [0, -0.02, 0.12]), r1: 0.035, r2: 0.045 }, 'paper');
    held({ kind: 'cone', a: add(hand, [0, -0.02, 0.12]), b: add(hand, [0, -0.02, 0.14]), r1: 0.047, r2: 0.04 }, 'dark');
  }
  if (accessory === 'umbrella') {
    const peak = [hand[0], hand[1], H + 0.32];
    held({ kind: 'capsule', a: add(hand, [0, 0, -0.08]), b: peak, r: 0.012 }, 'dark');
    held({ kind: 'cone', a: add(peak, [0, 0, -0.22]), b: peak, r1: 0.55, r2: 0.02 });
  }
  if (accessory === 'balloon') {
    const knot = [hand[0], hand[1], H + 0.25];
    held({ kind: 'capsule', a: hand, b: knot, r: 0.004 }, 'dark');
    held({ kind: 'sphere', c: add(knot, [0, 0, 0.16]), r: 0.16, squash: [1, 1, 1.18] }, 'item', handName);
    parts[parts.length - 1].gloss = true;
  }
  if (accessory === 'dog') {
    const dogX = sign * 0.6;
    onGround({ kind: 'capsule', a: [dogX, 0.15, 0.3], b: [dogX, -0.22, 0.32], r: 0.1 });
    onGround({ kind: 'sphere', c: [dogX, -0.36, 0.44], r: 0.1 });
    for (const [x, y] of [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.2], [0.06, -0.2]]) onGround({ kind: 'capsule', a: [dogX + x, y, 0.28], b: [dogX + x, y, 0.03], r: 0.03 });
    onGround({ kind: 'capsule', a: [dogX, 0.2, 0.34], b: [dogX, 0.34, 0.5], r: 0.025 });
  }
  if (accessory === 'bicycle') {
    const bikeX = sign * 0.55;
    const wheel = 0.3;
    for (const y of [-0.48, 0.48]) onGround({ kind: 'ring', c: [bikeX, y, wheel], r: wheel, tube: 0.025, axis: [1, 0, 0] });
    const seat = [bikeX, 0.16, 0.78];
    const bars = [bikeX, -0.38, 0.86];
    const crank = [bikeX, 0, wheel];
    for (const [from, to] of [[[bikeX, 0.48, wheel], crank], [crank, seat], [seat, [bikeX, -0.32, 0.74]], [[bikeX, -0.48, wheel], bars], [add(bars, [-0.18, 0, 0]), add(bars, [0.18, 0, 0])]]) onGround({ kind: 'capsule', a: from, b: to, r: 0.02 }, 'item');
  }
  return parts;
}

const PART_POINTS = { capsule: ['a', 'b'], sphere: ['c'], dome: ['c'], box: ['c'], cone: ['a', 'b'], ring: ['c'] }; // point fields per part kind
const PART_SIZES = { capsule: ['r'], sphere: ['r'], dome: ['r', 'h'], box: [], cone: ['r1', 'r2'], ring: ['r', 'tube'] }; // length fields per part kind

// A whole figure in model mm: params, joints and parts
export function makeFigure(looks) {
  const params = figureParams(looks);
  const { headR, ...joints } = figureJoints(params);
  const parts = partsInMetres(params, { ...joints, headR }).map((part) => {
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
  if (part.kind === 'dome') return part.c[2] + part.h;
  if (part.kind === 'sphere') return part.c[2] + part.r * (part.squash ? part.squash[2] : 1);
  const reach = part.kind === 'box' ? part.size[2] / 2 : part.kind === 'ring' ? part.r + part.tube : part.kind === 'cone' ? 0 : part.r;
  return Math.max(...PART_POINTS[part.kind].map((field) => part[field][2] + reach));
}

// Highest point of any part, mm
export const figureTop = (figure) => Math.max(0, ...figure.parts.map(partTop));
