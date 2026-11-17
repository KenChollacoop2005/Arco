import { STRING_CLEAR_MM, CURVE_STEPS, WIRE_OUT_MM } from '../config.js';
import { instancePose, variantKey } from './grid.js';
import { buildRecipe } from './recipes.js';
import { groupAt, worldColliders } from './mounts.js';

const SOLID_STEP_MM = 0.5; // sample spacing near an end module
const TURN_COS_SIN = [[1, 0], [0, 1], [-1, 0], [0, -1]];

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
export const standoff = (port, reach) => port.position.map((value, axis) => value + port.normal[axis] * reach);

// True when a point is inside the real solid of any module
export function insideSolid(context, point, shapes = context.boxes) {
  return shapes.some((shape) => segmentHitsBox(point, point, shape, 0) && groupAt(context.opsOf(context.byId.get(shape.module)), toLocal(context.byId.get(shape.module), point)));
}

// Points where a pipe enters a module's real solid, for collars
export function solidEntries(context, points) {
  const entries = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance(from, to);
    const hits = context.boxes.filter((shape) => segmentHitsBox(from, to, shape, 0));
    if (hits.length === 0 || length < SOLID_STEP_MM) continue;
    const steps = Math.ceil(length / SOLID_STEP_MM);
    const direction = [0, 1, 2].map((axis) => (to[axis] - from[axis]) / length);
    let inside = null;
    for (let step = 0; step <= steps; step++) {
      const point = [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * (step / steps));
      const now = insideSolid(context, point, hits);
      if (now && inside === false) entries.push({ at: point, direction });
      inside = now;
    }
  }
  return entries;
}

// Points of a hanging string, ends exact, lowest at mid span; tilt swings the sag sideways
export function sagPoints(from, to, sag, steps, tilt = 0) {
  const flat = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const side = flat > 1e-9 ? [-(to[1] - from[1]) / flat, (to[0] - from[0]) / flat] : [0, 0];
  const drop = [side[0] * Math.sin(tilt), side[1] * Math.sin(tilt), -Math.cos(tilt)];
  const points = [];
  for (let index = 0; index <= steps; index++) {
    const share = index / steps;
    const hang = 4 * sag * share * (1 - share);
    points.push([0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * share + drop[axis] * hang));
  }
  return points;
}

// One string between two ports: type, ends, points, length with sag
export function makeString(type, from, to, points, extra = {}) {
  const end = (port) => ({ module: port.module, index: port.index, position: port.position, normal: port.normal });
  return { type, from: end(from), to: end(to), points, length: pathLength(points), blocked: null, ...extra };
}

// A hanging wire or line, checked against modules and its length limit
export function hangString(context, type, from, to, sag, limit, { tilt = 0, shiftA = [0, 0, 0], shiftB = [0, 0, 0] } = {}) {
  const start = standoff(from, WIRE_OUT_MM).map((value, axis) => value + shiftA[axis]);
  const end = standoff(to, WIRE_OUT_MM).map((value, axis) => value + shiftB[axis]);
  const curve = sagPoints(start, end, sag, CURVE_STEPS, tilt);
  const string = makeString(type, from, to, [from.position, ...curve, to.position], { sag, tilt });
  if (string.length > limit) string.blocked = { module: null, reason: 'length' };
  else string.blocked = pathBlocked(context, string.points, [from.module, to.module]);
  return string;
}
