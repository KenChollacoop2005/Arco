import RAPIER from '../../vendor/rapier/rapier.mjs';
import { PHYSICS_STEP_S } from '../config.js';
import { createPhysicsWorld } from '../core/physics.js';

const TICK_MS = 16; // time between pose frames
const MAX_STEPS_PER_TICK = 6; // catch-up limit per frame
const MAX_TICK_S = 0.1; // longest real time counted per frame

const ready = RAPIER.init();
let current = null;

// Ends the running simulation, result null when cut short
function finish(result) {
  if (!current) return;
  clearInterval(current.timer);
  current.world.free();
  self.postMessage({ id: current.id, done: true, result });
  current = null;
}

function tick() {
  const run = current;
  const now = performance.now();
  run.owed += Math.min(MAX_TICK_S, (now - run.last) / 1000);
  run.last = now;
  const steps = Math.min(MAX_STEPS_PER_TICK, Math.floor(run.owed / PHYSICS_STEP_S));
  run.owed = steps === MAX_STEPS_PER_TICK ? 0 : run.owed - steps * PHYSICS_STEP_S;
  for (let count = 0; count < steps; count++) run.world.step();
  const settled = run.world.steps > 0 && run.world.resting();
  const poses = run.world.poses();
  self.postMessage({ id: run.id, poses, settled }, [poses.buffer]);
  if (settled) finish({ fallen: run.world.fallen().length, total: run.world.ids.length });
}

self.onmessage = async (event) => {
  const { id, kind, modules } = event.data;
  try {
    finish(null);
    if (kind === 'stop') {
      self.postMessage({ id, done: true, result: null });
      return;
    }
    await ready;
    if (current) finish(null);
    current = { id, world: createPhysicsWorld(RAPIER, modules), owed: 0, last: performance.now(), timer: setInterval(tick, TICK_MS) };
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
