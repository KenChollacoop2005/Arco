import { makeRig, stepRig } from '../core/verlet.js';
import { project, drawShapes, accentCss } from './portrait.js';
import { convexHull } from '../core/hull.js';

const SHOWN_HEIGHT_PX = 110; // carried figure height on screen
const GRAVITY_PX = 0.9; // fall per frame
const DAMPING = 0.94; // swing kept per frame
const STILL_DAMPING = 0.2; // reduced motion: barely swings
const ITERATIONS = 8; // stick passes per frame
const GRIP_BELOW_PX = 4; // head hangs this far under the cursor
const ROUND_STEPS = 12; // points around each limb end
const PIXEL_SCALE = 2; // canvas pixels per CSS pixel
const JOINTS = ['head', 'neck', 'chest', 'pelvis', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR'];
// Bones drawn as capsules, plus hidden braces that keep the trunk in shape
const BONES = [['neck', 'head'], ['chest', 'neck'], ['pelvis', 'chest'], ['shoulderL', 'shoulderR'], ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'], ['hipL', 'hipR']];
const BRACES = [['head', 'shoulderL'], ['head', 'shoulderR'], ['head', 'chest'], ['neck', 'shoulderL'], ['neck', 'shoulderR'], ['chest', 'shoulderL'], ['chest', 'shoulderR'], ['pelvis', 'hipL'], ['pelvis', 'hipR'], ['chest', 'hipL'], ['chest', 'hipR'], ['shoulderL', 'hipR'], ['shoulderR', 'hipL']];
const ACCENT_BONES = ['pelvis-chest', 'chest-neck', 'shoulderL-shoulderR', 'shoulderL-elbowL', 'shoulderR-elbowR']; // bones in the accent colour

// Width of each bone from the figure's own parts
function boneRadius(figure, from, to) {
  const a = figure.joints[from];
  const b = figure.joints[to];
  const match = figure.parts.find((part) => part.kind === 'capsule' && ((part.a.join() === a.join() && part.b.join() === b.join()) || (part.a.join() === b.join() && part.b.join() === a.join())));
  return match ? match.r : (figure.parts.find((part) => part.kind === 'sphere') || { r: 1 }).r * 0.45;
}

const ring = (centre, radius) => Array.from({ length: ROUND_STEPS }, (unused, index) => [centre.x + Math.cos((index / ROUND_STEPS) * Math.PI * 2) * radius, centre.y + Math.sin((index / ROUND_STEPS) * Math.PI * 2) * radius]);

// A carried resident hanging from the cursor, drawn like the card portrait
export function createRagdoll(reducedMotion) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ragdoll';
  canvas.hidden = true;
  document.body.append(canvas);
  const context = canvas.getContext('2d');
  let carried = null;
  let cursor = [0, 0];
  let frame = 0;

  const follow = (event) => {
    cursor = [event.clientX, event.clientY];
  };
  // Always tracked, so a carry starts where the pointer is
  window.addEventListener('pointermove', follow);
  window.addEventListener('pointerdown', follow);
  window.addEventListener('dragover', follow);

  function size() {
    canvas.width = window.innerWidth * PIXEL_SCALE;
    canvas.height = window.innerHeight * PIXEL_SCALE;
  }

  function draw() {
    if (!carried) return;
    stepRig(carried.rig, { pin: carried.pin, at: [cursor[0], cursor[1] + GRIP_BELOW_PX], gravity: GRAVITY_PX, damping: reducedMotion ? STILL_DAMPING : DAMPING, iterations: ITERATIONS });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
    const at = (name) => carried.rig.points[JOINTS.indexOf(name)];
    const shapes = BONES.map(([from, to]) => {
      const radius = carried.radii[`${from}-${to}`];
      return { points: convexHull([...ring(at(from), radius), ...ring(at(to), radius)]), fill: ACCENT_BONES.includes(`${from}-${to}`) ? 'accent' : '#fbfaf7' };
    });
    shapes.push({ points: ring(at('head'), carried.head), fill: '#fbfaf7' });
    drawShapes(context, shapes, { seed: carried.seed, accent: carried.accent, line: 1.2 });
    frame = requestAnimationFrame(draw);
  }

  return {
    // figure from makeFigure; the pose starts from the side view of its joints
    start(figure, seed) {
      size();
      const scale = SHOWN_HEIGHT_PX / figure.heightMm;
      const flat = JOINTS.map((name) => project(figure.joints[name]));
      const grip = flat[JOINTS.indexOf('head')];
      const points = flat.map(([x, y]) => [cursor[0] + (x - grip[0]) * scale, cursor[1] + GRIP_BELOW_PX + (y - grip[1]) * scale]);
      const index = (name) => JOINTS.indexOf(name);
      const rig = makeRig(points, [...BONES, ...BRACES].map(([from, to]) => [index(from), index(to)]));
      const radii = Object.fromEntries(BONES.map(([from, to]) => [`${from}-${to}`, boneRadius(figure, from, to) * scale]));
      const head = (figure.parts.find((part) => part.kind === 'sphere') || { r: 1 }).r * scale;
      carried = { rig, pin: index('head'), radii, head, seed, accent: accentCss(figure.params.accent) };
      canvas.hidden = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    },
    stop() {
      carried = null;
      canvas.hidden = true;
      cancelAnimationFrame(frame);
    },
  };
}
