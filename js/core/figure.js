import { FIGURE_HEIGHT_M, FIGURE_STORY_M, FIGURE_ACCENTS, STORY_MM } from '../config.js';
import { makeRng } from './rng.js';

export const PRESENTATIONS = ['masculine', 'feminine', 'neutral'];
export const BUILDS = { slim: 0.86, medium: 1, broad: 1.18 }; // build to width factor
export const POSTURES = ['upright', 'lean', 'slouch', 'akimbo'];
export const HAIRS = ['bald', 'short', 'long', 'bun', 'ponytail', 'curly', 'tall'];
export const PROPS = ['bag', 'umbrella', 'hat', 'dog', 'bicycle', 'plant'];

// Hair odds per presentation, the rest even
const HAIR_WEIGHTS = {
  masculine: { bald: 2, short: 4, long: 1, bun: 0.5, ponytail: 0.5, curly: 2, tall: 1.5 },
  feminine: { bald: 0.3, short: 1.5, long: 4, bun: 2.5, ponytail: 2.5, curly: 2, tall: 0.7 },
  neutral: { bald: 1, short: 3, long: 1.5, bun: 1, ponytail: 1, curly: 2, tall: 2 },
};
const SHOULDER_SHAPE = { masculine: 1.1, feminine: 0.9, neutral: 1 }; // shoulder width by presentation
const HIP_SHAPE = { masculine: 0.94, feminine: 1.12, neutral: 1 }; // hip width by presentation
const SKIRT_CHANCE = { masculine: 0, feminine: 0.55, neutral: 0.25 }; // share with a skirt shape
const MM_PER_M = STORY_MM / FIGURE_STORY_M; // model mm per real metre

// Body proportions as shares of height
const HEAD_R = 0.068;
const NECK_Z = 0.84;
const SHOULDER_Z = 0.8;
const SHOULDER_W = 0.115;
const CHEST_Z = 0.74;
const PELVIS_Z = 0.53;
const HIP_W = 0.075;
const KNEE_Z = 0.28;
const FOOT_Z = 0.025;
const UPPER_ARM = 0.18;
const LOWER_ARM = 0.17;
const TORSO_R = 0.085;
const LEG_R = 0.05;
const SHIN_R = 0.04;
const ARM_R = 0.032;
const FOREARM_R = 0.027;
const NECK_R = 0.03;
const SHOULDER_R = 0.045;

// Posture: forward lean of the body and head, arm swing out
const POSTURE_SHAPE = {
  upright: { lean: 0, head: 0, armOut: 0.12, slump: 0 },
  lean: { lean: 0.12, head: 0.08, armOut: 0.16, slump: 0 },
  slouch: { lean: 0.06, head: 0.28, armOut: 0.08, slump: 0.02 },
  akimbo: { lean: 0, head: -0.05, armOut: 0, slump: 0 },
};

// Seeded look of one resident; looks is the record's looks seed
export function figureParams(looks) {
  const rng = makeRng(looks >>> 0);
  const presentation = rng.pick(PRESENTATIONS);
  const hairs = HAIR_WEIGHTS[presentation];
  return {
    height: Math.round(rng.range(...FIGURE_HEIGHT_M) * 100) / 100,
    presentation,
    build: rng.pick(Object.keys(BUILDS)),
    posture: rng.pick(POSTURES),
    hair: rng.weighted(HAIRS.map((hair) => [hair, hairs[hair]])),
    prop: rng.pick(PROPS),
    skirt: rng.chance(SKIRT_CHANCE[presentation]),
    accent: FIGURE_ACCENTS[rng.int(0, FIGURE_ACCENTS.length - 1)],
    side: rng.chance(0.5) ? 1 : -1,
  };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// Joints in metres, facing -y, feet on z 0
export function figureJoints(params) {
  const H = params.height;
  const pose = POSTURE_SHAPE[params.posture];
  const width = BUILDS[params.build];
  const shoulder = SHOULDER_W * H * width * SHOULDER_SHAPE[params.presentation];
  const hip = HIP_W * H * width * HIP_SHAPE[params.presentation];
  const forward = (z) => -pose.lean * (z - PELVIS_Z * H);
  const at = (x, z) => [x, forward(z), z - (z > PELVIS_Z * H ? pose.slump * H : 0)];
  const joints = {
    pelvis: [0, 0, PELVIS_Z * H],
    chest: at(0, CHEST_Z * H),
    neck: at(0, NECK_Z * H),
    shoulderL: at(-shoulder, SHOULDER_Z * H),
    shoulderR: at(shoulder, SHOULDER_Z * H),
    hipL: [-hip, 0, PELVIS_Z * H],
    hipR: [hip, 0, PELVIS_Z * H],
    kneeL: [-hip * 0.9, -0.01, KNEE_Z * H],
    kneeR: [hip * 0.9, -0.01, KNEE_Z * H],
    footL: [-hip * 0.85, -0.02, FOOT_Z * H],
    footR: [hip * 0.85, -0.02, FOOT_Z * H],
  };
  const neck = joints.neck;
  joints.head = add(neck, [0, -pose.head * HEAD_R * H * 2, (1 - HEAD_R - NECK_Z) * H]);
  // Arms hang with a little swing; akimbo puts hands on the hips
  for (const [name, sign] of [['L', -1], ['R', 1]]) {
    const top = joints['shoulder' + name];
    if (params.posture === 'akimbo') {
      joints['elbow' + name] = add(top, [sign * UPPER_ARM * H * 0.6, 0.02, -UPPER_ARM * H * 0.75]);
      joints['hand' + name] = [sign * hip * 1.05, 0, PELVIS_Z * H + 0.04];
    } else {
      joints['elbow' + name] = add(top, [sign * pose.armOut * UPPER_ARM * H, -0.02, -UPPER_ARM * H]);
      joints['hand' + name] = add(joints['elbow' + name], [sign * pose.armOut * LOWER_ARM * H * 0.6, -0.05, -LOWER_ARM * H]);
    }
  }
  // The prop hand changes for some props
  const side = params.side > 0 ? 'R' : 'L';
  const sign = params.side;
  if (params.prop === 'umbrella') {
    joints['elbow' + side] = add(joints['shoulder' + side], [sign * 0.08, -0.12, -0.2]);
    joints['hand' + side] = add(joints['elbow' + side], [sign * -0.02, -0.18, 0.08]);
  } else if (params.prop === 'plant') {
    for (const [name, mark] of [['L', -1], ['R', 1]]) {
      joints['elbow' + name] = add(joints['shoulder' + name], [mark * 0.04, -0.08, -UPPER_ARM * H * 0.9]);
      joints['hand' + name] = [mark * 0.07, -0.24, PELVIS_Z * H + 0.12];
    }
  } else if (params.prop === 'bicycle') {
    joints['hand' + side] = add(joints['elbow' + side], [sign * 0.12, -0.12, -LOWER_ARM * H * 0.6]);
  }
  return joints;
}

// Parts in metres: capsule {a, b, r}, sphere {c, r}, box {c, size}, cone {a, b, r1, r2}, ring {c, r, tube, axis}
function partsInMetres(params, joints) {
  const H = params.height;
  const width = BUILDS[params.build];
  const parts = [];
  const capsule = (a, b, r, color = 'body') => parts.push({ kind: 'capsule', a, b, r, color });
  const sphere = (c, r, color = 'body') => parts.push({ kind: 'sphere', c, r, color });
  const headR = HEAD_R * H;
  // Legs, or a skirt over the upper legs
  for (const name of ['L', 'R']) {
    capsule(joints['hip' + name], joints['knee' + name], LEG_R * H * width);
    capsule(joints['knee' + name], joints['foot' + name], SHIN_R * H * width);
  }
  if (params.skirt) {
    const hip = Math.abs(joints.hipL[0]);
    parts.push({ kind: 'cone', a: [0, 0, PELVIS_Z * H + 0.06], b: [0, -0.02, KNEE_Z * H + 0.06], r1: hip + LEG_R * H, r2: hip * 2 + LEG_R * H, color: 'body' });
  }
  // Torso carries the accent colour
  capsule(joints.pelvis, joints.chest, TORSO_R * H * width * (params.presentation === 'feminine' ? 0.95 : 1), 'accent');
  capsule(joints.shoulderL, joints.shoulderR, SHOULDER_R * H * width, 'accent');
  capsule(joints.chest, joints.neck, NECK_R * H * 1.4, 'accent');
  for (const name of ['L', 'R']) {
    capsule(joints['shoulder' + name], joints['elbow' + name], ARM_R * H * width, 'accent');
    capsule(joints['elbow' + name], joints['hand' + name], FOREARM_R * H * width);
  }
  capsule(joints.neck, joints.head, NECK_R * H);
  sphere(joints.head, headR);
  // Hair shapes sit on the head
  const head = joints.head;
  const cap = () => sphere(add(head, [0, headR * 0.18, headR * 0.34]), headR * 0.95, 'dark');
  if (params.hair === 'short') cap();
  if (params.hair === 'long') {
    cap();
    parts.push({ kind: 'box', c: add(head, [0, headR * 0.55, -headR * 1.2]), size: [headR * 1.7, headR * 0.6, headR * 2], color: 'dark' });
  }
  if (params.hair === 'bun') {
    cap();
    sphere(add(head, [0, headR * 0.75, headR * 0.95]), headR * 0.45, 'dark');
  }
  if (params.hair === 'ponytail') {
    cap();
    capsule(add(head, [0, headR * 0.9, headR * 0.2]), add(head, [0, headR * 1.4, -headR * 1.6]), headR * 0.22, 'dark');
  }
  if (params.hair === 'curly') {
    for (const [x, y, z] of [[0, 0.1, 0.75], [-0.6, 0.2, 0.45], [0.6, 0.2, 0.45], [0, 0.65, 0.5], [-0.4, 0.55, 0.05], [0.4, 0.55, 0.05]]) sphere(add(head, [x * headR, y * headR, z * headR]), headR * 0.48, 'dark');
  }
  if (params.hair === 'tall') {
    cap();
    capsule(add(head, [0, 0, headR * 0.7]), add(head, [0, headR * 0.3, headR * 1.6]), headR * 0.4, 'dark');
  }
  const side = params.side > 0 ? 'R' : 'L';
  const hand = joints['hand' + side];
  const sign = params.side;
  if (params.prop === 'bag') parts.push({ kind: 'box', c: add(hand, [0, 0, -0.13]), size: [0.1, 0.32, 0.24], color: 'dark' });
  if (params.prop === 'hat') {
    const top = add(head, [0, 0, headR * 0.55]);
    parts.push({ kind: 'cone', a: top, b: add(top, [0, 0, 0.025]), r1: headR * 1.8, r2: headR * 1.8, color: 'dark' });
    parts.push({ kind: 'cone', a: top, b: add(top, [0, 0, headR * 1.05]), r1: headR * 0.95, r2: headR * 0.85, color: 'dark' });
  }
  if (params.prop === 'umbrella') {
    const top = [hand[0], hand[1], H + 0.32];
    capsule(hand, top, 0.012, 'dark');
    parts.push({ kind: 'cone', a: add(top, [0, 0, -0.22]), b: top, r1: 0.55, r2: 0.02, color: 'dark' });
  }
  if (params.prop === 'plant') {
    const pot = [0, -0.26, PELVIS_Z * H + 0.1];
    parts.push({ kind: 'cone', a: add(pot, [0, 0, -0.1]), b: add(pot, [0, 0, 0.1]), r1: 0.09, r2: 0.12, color: 'dark' });
    for (const [x, y, z] of [[0, 0, 0.24], [-0.09, 0.02, 0.18], [0.09, -0.02, 0.2], [0.02, -0.07, 0.3]]) sphere(add(pot, [x, y, z]), 0.08, 'leaf');
  }
  if (params.prop === 'dog') {
    const dogX = sign * 0.55;
    const body = [[dogX, 0.15, 0.32], [dogX, -0.25, 0.34]];
    capsule(body[0], body[1], 0.1, 'dark');
    sphere([dogX, -0.38, 0.45], 0.09, 'dark');
    capsule([dogX, -0.38, 0.45], [dogX, -0.48, 0.42], 0.05, 'dark');
    for (const [x, y] of [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.22], [0.06, -0.22]]) capsule([dogX + x, y, 0.3], [dogX + x, y, 0.02], 0.03, 'dark');
    capsule(body[0], [dogX, 0.32, 0.5], 0.025, 'dark');
    capsule(hand, [dogX, -0.33, 0.48], 0.006, 'dark');
  }
  if (params.prop === 'bicycle') {
    const bikeX = sign * 0.42;
    const wheel = 0.33;
    for (const y of [-0.52, 0.52]) parts.push({ kind: 'ring', c: [bikeX, y, wheel], r: wheel, tube: 0.025, axis: [1, 0, 0], color: 'dark' });
    const seat = [bikeX, 0.18, 0.85];
    const bars = [bikeX, -0.42, 0.95];
    const crank = [bikeX, 0, wheel];
    capsule([bikeX, 0.52, wheel], crank, 0.02, 'dark');
    capsule(crank, seat, 0.02, 'dark');
    capsule(seat, [bikeX, -0.36, 0.8], 0.02, 'dark');
    capsule([bikeX, -0.52, wheel], bars, 0.02, 'dark');
    capsule(crank, [bikeX, -0.36, 0.8], 0.02, 'dark');
    capsule(add(bars, [-0.2, 0, 0]), add(bars, [0.2, 0, 0]), 0.018, 'dark');
  }
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

// Highest point of any part, mm
export function figureTop(figure) {
  let top = 0;
  for (const part of figure.parts) {
    const reach = part.kind === 'box' ? part.size[2] / 2 : part.kind === 'ring' ? part.r + part.tube : part.kind === 'cone' ? 0 : part.r;
    for (const field of PART_POINTS[part.kind]) top = Math.max(top, part[field][2] + reach);
  }
  return top;
}
