import { makeSwing, stepSwing } from '../core/verlet.js';
import { sketchShapes, drawShapes, accentCss, FRONT } from './portrait.js';
import { partTop } from '../core/figure.js';

const SHOWN_HEIGHT_PX = 96; // carried figure height on screen
const GRIP_BELOW_PX = 4; // head hangs this far under the cursor
const PIXEL_SCALE = 2; // canvas pixels per CSS pixel
const LINE_PX = 1.2; // outline width
const HANDS = ['handL', 'handR']; // parts that lag and bob
// Swing tuning: push per pixel moved, spring back, damping, cap in radians, hand lag in px
const SWING = { push: 0.0035, spring: 0.07, damping: 0.88, maxAngle: 0.32, handLag: 0.35, maxLag: 7, bob: 1.6, bobRate: 0.09 };
const STILL_SWING = { ...SWING, push: 0, bob: 0, handLag: 0 }; // reduced motion: hangs still

// A carried peg figure on top of everything, held by the head
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

  // Shapes turned about the head; hands also lag and bob
  function posed() {
    const { swing, shapes, scale, pivot, hang } = carried;
    const cos = Math.cos(swing.angle);
    const sin = Math.sin(swing.angle);
    const at = [cursor[0], cursor[1] + GRIP_BELOW_PX + hang];
    return shapes.map((shape) => {
      const lag = HANDS.includes(shape.part) ? swing.lag : [0, 0];
      const points = shape.points.map(([x, y]) => {
        const dx = (x - pivot[0]) * scale + lag[0];
        const dy = (y - pivot[1]) * scale + lag[1];
        return [at[0] + dx * cos - dy * sin, at[1] + dx * sin + dy * cos];
      });
      return { ...shape, points };
    });
  }

  function draw() {
    if (!carried) return;
    stepSwing(carried.swing, cursor[0], reducedMotion ? STILL_SWING : SWING);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
    // Far parts first, each filled before its outline, so nearer fills cover what is behind
    drawShapes(context, posed(), { seed: carried.seed, accent: carried.accent, line: LINE_PX });
    frame = requestAnimationFrame(draw);
  }

  return {
    // figure from makeFigure, drawn straight on like the card
    start(figure, seed) {
      size();
      const shapes = sketchShapes(figure, FRONT);
      const head = figure.parts.find((part) => part.name === 'head');
      const centre = head.kind === 'sphere' ? head.c : head.a.map((value, index) => (value + head.b[index]) / 2);
      const scale = SHOWN_HEIGHT_PX / figure.heightMm;
      // The head top sits at the cursor; the figure turns about the head's centre
      carried = { swing: makeSwing(cursor[0]), shapes, scale, pivot: [centre[0], -centre[2]], hang: (partTop(head) - centre[2]) * scale, seed, accent: accentCss(figure.params.accent) };
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
