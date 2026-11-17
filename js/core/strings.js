import { PIPE_STANDOFF_MM, PIPE_DIAGONAL_MM, STRING_CLEAR_MM } from '../config.js';
import { instancePose, variantKey } from './grid.js';
import { buildRecipe } from './recipes.js';
import { groupAt, worldColliders } from './mounts.js';

const SOLID_STEP_MM = 0.5; // sample spacing near an end module
const TURN_COS_SIN = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const PIPE_SHAPES = ['drop', 'run', 'direct']; // down then across, across then down, straight

const distance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
export const pathLength = (points) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);

// Collision context of a structure: boxes, modules and their solids
export function stringContext(modules) {
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const ops = new Map();
  return {
    boxes: worldColliders(modules),
    byId,
    opsOf(instance) {
      const key = variantKey(instance);
      if (!ops.has(key)) ops.set(key, buildRecipe(instance).ops);
      return ops.get(key);
    },
  };
}

// True when a segment passes through a box grown by a margin
export function segmentHitsBox(from, to, shape, margin = STRING_CLEAR_MM) {
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const low = shape.min[axis] - margin;
    const high = shape.max[axis] + margin;
    const step = to[axis] - from[axis];
    if (Math.abs(step) < 1e-12) {
      if (from[axis] <= low || from[axis] >= high) return false;
      continue;
    }
    let near = (low - from[axis]) / step;
    let far = (high - from[axis]) / step;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    leave = Math.min(leave, far);
    if (enter >= leave) return false;
  }
  return true;
}

// World point to a module's local mesh frame
function toLocal(instance, point) {
  const pose = instancePose(instance);
  const [cos, sin] = TURN_COS_SIN[pose.turns];
  const shiftX = point[0] - pose.x;
  const shiftY = point[1] - pose.y;
  return [shiftX * cos + shiftY * sin, -shiftX * sin + shiftY * cos, point[2] - pose.z];
}

// True when a segment passes through the real solid of a module
function hitsSolid(context, instance, from, to) {
  const ops = context.opsOf(instance);
  const steps = Math.max(1, Math.ceil(distance(from, to) / SOLID_STEP_MM));
  for (let index = 0; index <= steps; index++) {
    const share = index / steps;
    const point = [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * share);
    if (groupAt(ops, toLocal(instance, point))) return true;
  }
  return false;
}

// First module a polyline runs into, or null; end modules are checked on their solid
export function pathBlocked(context, points, ends = []) {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (from[2] < 0 || to[2] < 0) return { module: null, reason: 'plinth' };
    for (const shape of context.boxes) {
      if (!segmentHitsBox(from, to, shape)) continue;
      if (!ends.includes(shape.module)) return { module: shape.module, reason: 'module' };
      if (hitsSolid(context, context.byId.get(shape.module), from, to)) return { module: shape.module, reason: 'module' };
    }
  }
  return null;
}

// Point a set distance in front of a port
export const standoff = (port, reach = PIPE_STANDOFF_MM) => port.position.map((value, axis) => value + port.normal[axis] * reach);

// Rigid pipe points for one shape, port to port
export function pipePoints(from, to, shape) {
  const start = standoff(from);
  const end = standoff(to);
  if (shape === 'direct') return [from.position, start, end, to.position];
  const bend = shape === 'drop' ? [start[0], start[1], end[2]] : [end[0], end[1], start[2]];
  return [from.position, start, bend, end, to.position];
}

// First clear pipe between two ports, or the reason none runs
export function pipeRoute(context, from, to) {
  const ends = [from.module, to.module];
  let blocked = null;
  for (const shape of PIPE_SHAPES) {
    const points = pipePoints(from, to, shape);
    if (shape === 'direct' && distance(points[1], points[2]) > PIPE_DIAGONAL_MM) continue;
    const hit = pathBlocked(context, points, ends);
    if (!hit) return { shape, points, length: pathLength(points), blocked: null };
    blocked = blocked || hit;
  }
  return { shape: null, points: pipePoints(from, to, 'drop'), length: pathLength(pipePoints(from, to, 'drop')), blocked };
}
