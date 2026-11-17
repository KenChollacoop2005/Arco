import {
  CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS, HEAD_PER_CELL, HEAD_PER_STORY_UP,
  PIPE_RADIUS_MM, PIPE_GAP_MM, PIPE_CROSS_MAX_MM, PIPE_CROSS_FACING, BODY_MIN_MM,
} from '../config.js';
import { instancePose, poseApply, variantKey, worldFromModules, instanceCells, moduleAt } from './grid.js';
import { insideSolid } from './strings.js';

export const PIPE_OFF_MM = PIPE_RADIUS_MM + PIPE_GAP_MM; // pipe centreline off the surface it follows
const OFF = PIPE_OFF_MM;
const EPS_MM = 1e-3; // position slack
const KEY_SCALE = 1e3; // node keys round to a thousandth of a mm
const RUN_STEP_MM = 1; // sample spacing along runs and spans
const LENGTH_TIE = 1e-4; // search cost per mm, picks the shorter of equal head routes
const HEAD_ROUND = 1e6; // head sizes round to a millionth
const HEAD_SLACK = 1e-9; // rounding allowance on a search's head limit
const BODY_MIN_TALL_MM = 1; // thinnest solid counted as body
const RIM_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2; // plinth radius
const NEIGHBOUR_MM = 2 * OFF; // boxes this close shape a face's node lines
const WALL_STEP_MM = OFF + 1; // step back from a pipe point into its wall
const PROBES = []; // directions probed for a real surface near a drop
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) PROBES.push([x, y, z].map((value) => value / Math.hypot(x, y, z)));
const WRAP_STEP = Math.PI / 4; // largest turn between wrap points
const WRAP_SAMPLE_MM = 0.05; // sample spacing along a wrap
const INDEX_SHIFT = 64; // plan cells shift so index keys stay positive
const INDEX_ROW = 128; // plan cells per index row

const round = (value) => Math.round(value * HEAD_ROUND) / HEAD_ROUND;
const keyOf = (point) => point.map((value) => Math.round(value * KEY_SCALE)).join(',');
const boundsOf = (points) => ({ min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))), max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))) });
// Distance from a point to a box, zero inside
function boxDistance(box, point) {
  const dx = Math.max(box.min[0] - point[0], 0, point[0] - box.max[0]);
  const dy = Math.max(box.min[1] - point[1], 0, point[1] - box.max[1]);
  const dz = Math.max(box.min[2] - point[2], 0, point[2] - box.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Even-odd point in polygon
function inPolygon(poly, first, second) {
  let inside = false;
  for (let index = 0, last = poly.length - 1; index < poly.length; last = index++) {
    const [ax, ay] = poly[index];
    const [bx, by] = poly[last];
    if (ay > second !== by > second && first < ((bx - ax) * (second - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const prismPoint = (shape, first, second, sweep) => [0, 1, 2].map((axis) => shape.origin[axis] + shape.axes[0][axis] * first + shape.axes[1][axis] * second + shape.axes[2][axis] * sweep);
const axisAligned = (vector) => vector.filter((value) => Math.abs(value) > EPS_MM).length === 1;

// Plan boxes of one solid; upright outlines split into rows
function shapePieces(shape) {
  if (shape.kind === 'box') return [{ min: shape.min, max: shape.max }];
  if (shape.kind === 'cyl') {
    const radius = Math.max(shape.radiusLow, shape.radiusHigh);
    return [{ min: [shape.center[0] - radius, shape.center[1] - radius, shape.from], max: [shape.center[0] + radius, shape.center[1] + radius, shape.to] }];
  }
  const corners = shape.poly.flatMap(([first, second]) => [prismPoint(shape, first, second, shape.from), prismPoint(shape, first, second, shape.to)]);
  if (!(Math.abs(shape.axes[2][2]) > 1 - EPS_MM && axisAligned(shape.axes[0]) && axisAligned(shape.axes[1]))) return [boundsOf(corners)];
  const firsts = [...new Set(shape.poly.map((point) => point[0]))].sort((a, b) => a - b);
  const seconds = [...new Set(shape.poly.map((point) => point[1]))].sort((a, b) => a - b);
  const pieces = [];
  for (let row = 0; row + 1 < seconds.length; row++) {
    let start = null;
    for (let column = 0; column < firsts.length; column++) {
      const inside = column + 1 < firsts.length && inPolygon(shape.poly, (firsts[column] + firsts[column + 1]) / 2, (seconds[row] + seconds[row + 1]) / 2);
      if (inside && start === null) start = column;
      if (inside || start === null) continue;
      pieces.push(boundsOf([prismPoint(shape, firsts[start], seconds[row], shape.from), prismPoint(shape, firsts[column], seconds[row + 1], shape.to)]));
      start = null;
    }
  }
  return pieces;
}

// Body boxes of a recipe: added solids thick enough in plan
export function bodyPieces(ops) {
  const pieces = [];
  for (const op of ops) {
    if (op.cut) continue;
    for (const piece of shapePieces(op.shape)) {
      const size = [0, 1, 2].map((axis) => piece.max[axis] - piece.min[axis]);
      if (size[0] >= BODY_MIN_MM && size[1] >= BODY_MIN_MM && size[2] >= BODY_MIN_TALL_MM) pieces.push(piece);
    }
  }
  return pieces;
}

// World body boxes of a structure, tagged with their module
export function worldBodies(modules, context) {
  const cache = new Map();
  const boxes = [];
  for (const instance of modules) {
    const key = variantKey(instance);
    if (!cache.has(key)) cache.set(key, bodyPieces(context.opsOf(instance)));
    const pose = instancePose(instance);
    for (const piece of cache.get(key)) {
      const cornerA = poseApply(pose, piece.min[0], piece.min[1], piece.min[2]);
      const cornerB = poseApply(pose, piece.max[0], piece.max[1], piece.max[2]);
      boxes.push({ module: instance.id, min: cornerA.map((value, axis) => Math.min(value, cornerB[axis])), max: cornerA.map((value, axis) => Math.max(value, cornerB[axis])) });
    }
  }
  return boxes;
}

// Mass label of each occupied cell per story: side contact within that story
export function massesOf(modules) {
  const world = worldFromModules(modules);
  const parent = new Map();
  const find = (key) => (parent.get(key) === key ? key : find(parent.get(key)));
  const keyAt = (cellX, cellY, level) => cellX + ',' + cellY + ',' + level;
  for (const instance of modules) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) parent.set(keyAt(cellX, cellY, level), keyAt(cellX, cellY, level));
    }
  }
  for (const key of parent.keys()) {
    const [cellX, cellY, level] = key.split(',').map(Number);
    for (const [stepX, stepY] of [[1, 0], [0, 1]]) {
      if (!moduleAt(world, cellX + stepX, cellY + stepY, level)) continue;
      const other = keyAt(cellX + stepX, cellY + stepY, level);
      parent.set(find(other), find(key));
    }
  }
  return (point, level) => {
    const key = keyAt(Math.floor(point[0] / CELL_MM), Math.floor(point[1] / CELL_MM), level);
    return parent.has(key) ? find(key) : null;
  };
}

// Two wall points of different masses at both their stories
function apart(massAt, first, firstWall, second, secondWall) {
  for (const level of [Math.floor(first[2] / STORY_MM), Math.floor(second[2] / STORY_MM)]) {
    const own = massAt(firstWall, level);
    if (own !== null && own === massAt(secondWall, level)) return false;
  }
  return true;
}

// Plan grid of box indexes for nearby lookups
export function boxIndex(boxes) {
  const cells = new Map();
  const range = (low, high) => [Math.floor(low / CELL_MM), Math.floor(high / CELL_MM)];
  const keyAt = (cellX, cellY) => (cellX + INDEX_SHIFT) * INDEX_ROW + cellY + INDEX_SHIFT;
  boxes.forEach((box, index) => {
    const [fromX, toX] = range(box.min[0], box.max[0]);
    const [fromY, toY] = range(box.min[1], box.max[1]);
    for (let cellX = fromX; cellX <= toX; cellX++) {
      for (let cellY = fromY; cellY <= toY; cellY++) {
        const key = keyAt(cellX, cellY);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(index);
      }
    }
  });
  const near = (min, max) => {
    const found = new Set();
    const [fromX, toX] = range(min[0], max[0]);
    const [fromY, toY] = range(min[1], max[1]);
    for (let cellX = fromX; cellX <= toX; cellX++) {
      for (let cellY = fromY; cellY <= toY; cellY++) for (const index of cells.get(keyAt(cellX, cellY)) || []) found.add(index);
    }
    return [...found].sort((first, second) => first - second);
  };
  // Nearest box distance from a point, past the reach counts as the reach
  near.distance = (point, reach) => {
    let best = reach;
    const fromX = Math.floor((point[0] - reach) / CELL_MM);
    const toX = Math.floor((point[0] + reach) / CELL_MM);
    const fromY = Math.floor((point[1] - reach) / CELL_MM);
    const toY = Math.floor((point[1] + reach) / CELL_MM);
    for (let cellX = fromX; cellX <= toX; cellX++) {
      for (let cellY = fromY; cellY <= toY; cellY++) {
        const list = cells.get(keyAt(cellX, cellY));
        if (!list) continue;
        for (let item = 0; item < list.length; item++) {
          const distance = boxDistance(boxes[list[item]], point);
          if (distance < best) best = distance;
        }
      }
    }
    return best;
  };
  return near;
}

// Distance from a point to the plinth disc
function plinthDistance(point) {
  const out = Math.hypot(point[0], point[1]);
  if (out <= RIM_MM) return Math.max(point[2], 0);
  return Math.hypot(out - RIM_MM, Math.max(point[2], 0));
}

// Distance to the nearest body or the plinth, capped past the reach that matters
export function surfaceDistance(bodies, near, point) {
  return Math.min(plinthDistance(point), near.distance(point, NEIGHBOUR_MM));
}

// Head of a drawn pipe: level cells, stories climbed
export function pathHead(points) {
  let flat = 0;
  let up = 0;
  for (let index = 1; index < points.length; index++) {
    const [fromX, fromY, fromZ] = points[index - 1];
    const [toX, toY, toZ] = points[index];
    flat += Math.hypot(toX - fromX, toY - fromY) / CELL_MM;
    up += Math.max(0, toZ - fromZ) / STORY_MM;
  }
  return { flat: round(flat), up: round(up) };
}

const isCentre = (value, step) => Math.abs(value / step - Math.floor(value / step) - 0.5) < EPS_MM;

// Surface graph of a structure: runs on faces, corner wraps, gap spans, port stubs
export function pipeGraph(modules, ports, context) {
  const bodies = worldBodies(modules, context);
  const near = boxIndex(bodies);
  const massAt = massesOf(modules);
  const wallOf = (point, normal) => point.map((value, axis) => value - normal[axis] * WALL_STEP_MM);
  const clearance = (point) => surfaceDistance(bodies, near, point);
  const free = (point) => clearance(point) >= OFF - EPS_MM;
  const hugs = (point) => {
    const distance = clearance(point);
    return distance >= OFF - EPS_MM && distance <= OFF + EPS_MM;
  };
  const nodes = [];
  const keyed = new Map();
  const edges = [];
  const addNode = (point, extra = {}) => {
    const key = keyOf(point);
    if (keyed.has(key)) return keyed.get(key);
    keyed.set(key, nodes.length);
    nodes.push({ p: point, edges: [], ...extra });
    return nodes.length - 1;
  };
  const addEdge = (first, second, via, kind) => {
    const points = [nodes[first].p, ...via, nodes[second].p];
    let flat = 0;
    let rise = 0;
    let fall = 0;
    let length = 0;
    for (let index = 1; index < points.length; index++) {
      const step = [0, 1, 2].map((axis) => points[index][axis] - points[index - 1][axis]);
      flat += Math.hypot(step[0], step[1]) / CELL_MM;
      rise += Math.max(0, step[2]) / STORY_MM;
      fall += Math.max(0, -step[2]) / STORY_MM;
      length += Math.hypot(...step);
    }
    edges.push({ a: first, b: second, via, kind, flat, upAB: rise, upBA: fall, length });
    nodes[first].edges.push(edges.length - 1);
    nodes[second].edges.push(edges.length - 1);
  };
  const along = (from, to, test) => {
    const length = Math.hypot(...[0, 1, 2].map((axis) => to[axis] - from[axis]));
    const steps = Math.max(2, Math.ceil(length / RUN_STEP_MM));
    for (let index = 1; index < steps; index++) {
      if (!test([0, 1, 2].map((axis) => from[axis] + ((to[axis] - from[axis]) * index) / steps))) return false;
    }
    return true;
  };
  // Exact check of a straight run along one axis: never closer than the offset, covered all along
  const runHugs = (from, to, axis) => {
    const low = Math.min(from[axis], to[axis]);
    const high = Math.max(from[axis], to[axis]);
    const inner = OFF - EPS_MM;
    const outer = OFF + EPS_MM;
    const covers = [];
    const others = [0, 1, 2].filter((other) => other !== axis);
    // Plinth top: inside the rim its distance is the height
    if (axis === 2 && Math.hypot(from[0], from[1]) <= RIM_MM) {
      if (low < inner) return false;
      covers.push([-Infinity, outer]);
    } else if (axis !== 2 && Math.hypot(from[0], from[1]) <= RIM_MM && Math.hypot(to[0], to[1]) <= RIM_MM) {
      if (from[2] < inner) return false;
      if (from[2] <= outer) covers.push([-Infinity, Infinity]);
    }
    const min = [0, 1].map((plan) => Math.min(from[plan], to[plan]) - outer);
    const max = [0, 1].map((plan) => Math.max(from[plan], to[plan]) + outer);
    for (const index of near(min, max)) {
      const box = bodies[index];
      const across = Math.hypot(...others.map((other) => Math.max(box.min[other] - from[other], 0, from[other] - box.max[other])));
      if (across < inner) {
        const reach = Math.sqrt(inner * inner - across * across);
        if (box.min[axis] - reach < high && box.max[axis] + reach > low) return false;
      }
      if (across <= outer) {
        const reach = Math.sqrt(outer * outer - across * across);
        covers.push([box.min[axis] - reach, box.max[axis] + reach]);
      }
    }
    covers.sort((first, second) => first[0] - second[0]);
    let reached = low;
    for (const [start, end] of covers) {
      if (start > reached) break;
      reached = Math.max(reached, end);
    }
    return reached >= high;
  };
  // Stub point of each port: on its own wall's pipe plane, or straight out
  const stubs = ports.map((port) => {
    const axis = port.normal.findIndex((value) => Math.abs(value) > 0.5);
    const sign = Math.sign(port.normal[axis]);
    let best = null;
    for (const index of near([port.position[0] - CELL_MM, port.position[1] - CELL_MM], [port.position[0] + CELL_MM, port.position[1] + CELL_MM])) {
      const box = bodies[index];
      if (box.module !== port.module) continue;
      if ([0, 1, 2].some((other) => other !== axis && (port.position[other] < box.min[other] - EPS_MM || port.position[other] > box.max[other] + EPS_MM))) continue;
      const plane = sign > 0 ? box.max[axis] + OFF : box.min[axis] - OFF;
      const ahead = (plane - port.position[axis]) * sign;
      if (ahead >= 0 && (!best || ahead < best.ahead)) best = { ahead, plane };
    }
    const point = port.position.map((value, other) => (best ? (other === axis ? best.plane : value) : value + port.normal[other] * OFF));
    return { point, axis, sign, onPlane: !!best };
  });
  const planeKey = (axis, plane) => axis + ':' + Math.round(plane * KEY_SCALE);
  const onPlanes = new Map();
  for (const stub of stubs) {
    if (!stub.onPlane) continue;
    const key = planeKey(stub.axis, stub.point[stub.axis]);
    if (!onPlanes.has(key)) onPlanes.set(key, []);
    onPlanes.get(key).push(stub.point);
  }
  const loose = stubs.filter((stub) => !stub.onPlane).map((stub) => stub.point);
  // Node lines of one face along one axis
  function lines(box, axis, plane, other, neighbours) {
    const low = box.min[other];
    const high = box.max[other];
    const values = [low, high];
    // Story and half story lines up a wall, cell centres across
    if (other === 2) for (let line = Math.ceil(low / (STORY_MM / 2)) * (STORY_MM / 2); line <= high; line += STORY_MM / 2) values.push(line);
    else for (let line = (Math.floor(low / CELL_MM) + 0.5) * CELL_MM; line <= high; line += CELL_MM) values.push(line);
    if (other === 2 && low <= EPS_MM) values.push(OFF);
    for (const index of neighbours) values.push(bodies[index].min[other] - OFF, bodies[index].max[other] + OFF);
    for (const point of onPlanes.get(planeKey(axis, plane)) || []) values.push(point[other]);
    if (axis === 2) for (const point of loose) if (point[2] >= plane - EPS_MM) values.push(point[other]);
    const kept = new Map();
    // Lines may run just past the edge, where a set back neighbour leaves no room on the edge itself
    for (const value of values) if (value >= low - OFF - EPS_MM && value <= high + OFF + EPS_MM) kept.set(Math.round(value * KEY_SCALE), value);
    return [...kept.keys()].sort((first, second) => first - second).map((key) => kept.get(key));
  }
  // Nodes on every body face
  const faces = bodies.map(() => ({}));
  const anchors = [];
  bodies.forEach((box, boxIndex) => {
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        if (axis === 2 && sign < 0 && box.min[2] <= EPS_MM) continue;
        const plane = sign > 0 ? box.max[axis] + OFF : box.min[axis] - OFF;
        const [first, second] = [0, 1, 2].filter((other) => other !== axis);
        const regionMin = box.min.map((value, other) => (other === axis ? Math.min(plane, value) : value) - NEIGHBOUR_MM);
        const regionMax = box.max.map((value, other) => (other === axis ? Math.max(plane, value) : value) + NEIGHBOUR_MM);
        const neighbours = near(regionMin, regionMax).filter((index) => index !== boxIndex && [0, 1, 2].every((other) => bodies[index].max[other] >= regionMin[other] && bodies[index].min[other] <= regionMax[other]));
        const face = { plane, sign, lists: { [first]: lines(box, axis, plane, first, neighbours), [second]: lines(box, axis, plane, second, neighbours) } };
        faces[boxIndex][axis * 2 + (sign > 0 ? 1 : 0)] = face;
        for (const valueA of face.lists[first]) {
          for (const valueB of face.lists[second]) {
            const point = [0, 0, 0];
            point[axis] = plane;
            point[first] = valueA;
            point[second] = valueB;
            if (!free(point)) continue;
            const id = addNode(point);
            if (axis < 2 && isCentre(point[first === 2 ? second : first], CELL_MM) && isCentre(point[2], STORY_MM)) {
              const normal = [0, 0, 0];
              normal[axis] = sign;
              anchors.push({ id, normal });
            }
          }
        }
      }
    }
  });
  // Plinth top on a cell grid
  const cells = Math.ceil(RIM_MM / CELL_MM);
  for (let cellX = -cells; cellX < cells; cellX++) {
    for (let cellY = -cells; cellY < cells; cellY++) {
      const point = [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM, OFF];
      if (Math.hypot(point[0], point[1]) <= RIM_MM - OFF && free(point)) addNode(point);
    }
  }
  for (const point of loose) {
    const ground = [point[0], point[1], OFF];
    if (Math.hypot(point[0], point[1]) <= RIM_MM - OFF && free(ground)) addNode(ground);
  }
  // Straight runs between neighbouring nodes on one line
  for (let axis = 0; axis < 3; axis++) {
    const groups = new Map();
    nodes.forEach((node, id) => {
      const key = keyOf(node.p.map((value, other) => (other === axis ? 0 : value)));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    });
    for (const ids of groups.values()) {
      ids.sort((first, second) => nodes[first].p[axis] - nodes[second].p[axis]);
      for (let index = 1; index < ids.length; index++) {
        if (runHugs(nodes[ids[index - 1]].p, nodes[ids[index]].p, axis)) addEdge(ids[index - 1], ids[index], [], 'run');
      }
    }
  }
  // Wrap end on a face: at the edge, or the nearest node just past it, with its shift
  const wrapEnd = (exact, face, axis, edge, sign) => {
    if (keyed.has(keyOf(exact))) return { id: keyed.get(keyOf(exact)), shift: 0 };
    const past = face.lists[axis].filter((value) => (value - edge) * sign > EPS_MM && (value - edge) * sign <= OFF + EPS_MM).sort((first, second) => (first - second) * sign);
    for (const value of past) {
      const point = exact.map((coordinate, other) => (other === axis ? value : coordinate));
      if (keyed.has(keyOf(point)) && hugs(point)) return { id: keyed.get(keyOf(point)), shift: Math.min(OFF, (value - edge) * sign) };
    }
    return null;
  };
  // Wrap points round an edge, as an arc cut short where an end sits past the edge
  const wrapVia = (edgePoint, axisA, signA, axisB, signB, shiftA, shiftB) => {
    const start = Math.asin(Math.min(1, shiftA / OFF));
    const end = Math.acos(Math.min(1, shiftB / OFF));
    if (start > end + EPS_MM) return null;
    const pieces = Math.max(1, Math.ceil((end - start) / WRAP_STEP));
    const via = [];
    for (let piece = 0; piece <= pieces; piece++) {
      const angle = start + ((end - start) * piece) / pieces;
      const point = [...edgePoint];
      point[axisA] += signA * OFF * Math.cos(angle);
      point[axisB] += signB * OFF * Math.sin(angle);
      if ((piece > 0 && piece < pieces) || (piece === 0 && shiftA > EPS_MM) || (piece === pieces && shiftB > EPS_MM)) via.push(point);
    }
    return via;
  };
  // A short bent piece stays outside the pipe radius and within the offset all along
  const bendHugs = (points) => {
    for (let index = 1; index < points.length; index++) {
      const steps = Math.max(1, Math.ceil(Math.hypot(...[0, 1, 2].map((axis) => points[index][axis] - points[index - 1][axis])) / WRAP_SAMPLE_MM));
      for (let step = 0; step <= steps; step++) {
        const distance = clearance([0, 1, 2].map((axis) => points[index - 1][axis] + ((points[index][axis] - points[index - 1][axis]) * step) / steps));
        if (distance < PIPE_RADIUS_MM || distance > OFF + EPS_MM) return false;
      }
    }
    return true;
  };
  // Tight wraps round convex box edges
  bodies.forEach((box, boxIndex) => {
    for (let axisA = 0; axisA < 3; axisA++) {
      for (let axisB = axisA + 1; axisB < 3; axisB++) {
        const edgeAxis = 3 - axisA - axisB;
        for (const signA of [-1, 1]) {
          for (const signB of [-1, 1]) {
            const faceA = faces[boxIndex][axisA * 2 + (signA > 0 ? 1 : 0)];
            const faceB = faces[boxIndex][axisB * 2 + (signB > 0 ? 1 : 0)];
            if (!faceA || !faceB) continue;
            const edgeA = signA > 0 ? box.max[axisA] : box.min[axisA];
            const edgeB = signB > 0 ? box.max[axisB] : box.min[axisB];
            const shared = new Set(faceB.lists[edgeAxis].map((value) => Math.round(value * KEY_SCALE)));
            for (const value of faceA.lists[edgeAxis]) {
              if (!shared.has(Math.round(value * KEY_SCALE))) continue;
              const onA = [0, 0, 0];
              onA[axisA] = faceA.plane;
              onA[axisB] = edgeB;
              onA[edgeAxis] = value;
              const onB = [0, 0, 0];
              onB[axisA] = edgeA;
              onB[axisB] = faceB.plane;
              onB[edgeAxis] = value;
              const first = wrapEnd(onA, faceA, axisB, edgeB, signB);
              const second = wrapEnd(onB, faceB, axisA, edgeA, signA);
              if (!first || !second) continue;
              const edgePoint = [0, 0, 0];
              edgePoint[axisA] = edgeA;
              edgePoint[axisB] = edgeB;
              edgePoint[edgeAxis] = value;
              const via = wrapVia(edgePoint, axisA, signA, axisB, signB, first.shift, second.shift);
              if (via && bendHugs([nodes[first.id].p, ...via, nodes[second.id].p])) addEdge(first.id, second.id, via, 'wrap');
            }
          }
        }
      }
    }
  });
  // Port stubs, and drops from stubs that stand off a protrusion
  const portNodes = ports.map((port, index) => {
    const stub = stubs[index];
    let stubId = keyed.get(keyOf(stub.point));
    if (stubId === undefined) {
      if (stub.onPlane || !free(stub.point)) return null;
      stubId = addNode(stub.point);
      let landing = null;
      for (const box of near(stub.point, stub.point).map((boxId) => bodies[boxId])) {
        const top = box.max[2] + OFF;
        if (top > stub.point[2] + EPS_MM || [0, 1].some((axis) => stub.point[axis] < box.min[axis] - EPS_MM || stub.point[axis] > box.max[axis] + EPS_MM)) continue;
        if (landing === null || top > landing) landing = top;
      }
      if (landing === null) landing = OFF;
      const target = keyed.get(keyOf([stub.point[0], stub.point[1], landing]));
      // A drop must hug a body or the real solid all the way down
      const touching = (point) => hugs(point) || (free(point) && PROBES.some((probe) => insideSolid(context, point.map((value, axis) => value + probe[axis] * (OFF + EPS_MM)))));
      if (target === undefined || !along(stub.point, nodes[target].p, touching)) return null;
      addEdge(stubId, target, [], 'drop');
    }
    if (stub.onPlane && stub.axis < 2) anchors.push({ id: stubId, normal: port.normal });
    const id = nodes.length;
    nodes.push({ p: port.position, edges: [], port: index });
    addEdge(id, stubId, [], 'stub');
    return id;
  });
  // Straight spans across gaps between separate masses
  const anchorCells = new Map();
  const cellKey = (point) => Math.floor(point[0] / CELL_MM) + ',' + Math.floor(point[1] / CELL_MM);
  anchors.forEach((anchor, index) => {
    const key = cellKey(nodes[anchor.id].p);
    if (!anchorCells.has(key)) anchorCells.set(key, []);
    anchorCells.get(key).push(index);
  });
  const reach = Math.ceil(PIPE_CROSS_MAX_MM / CELL_MM);
  const spanned = new Set();
  anchors.forEach((anchor, index) => {
    const from = nodes[anchor.id].p;
    const [cellX, cellY] = [Math.floor(from[0] / CELL_MM), Math.floor(from[1] / CELL_MM)];
    for (let stepX = -reach; stepX <= reach; stepX++) {
      for (let stepY = -reach; stepY <= reach; stepY++) {
        for (const otherIndex of anchorCells.get(cellX + stepX + ',' + (cellY + stepY)) || []) {
          const other = anchors[otherIndex];
          if (otherIndex <= index || other.id === anchor.id) continue;
          const to = nodes[other.id].p;
          const step = [0, 1, 2].map((axis) => to[axis] - from[axis]);
          const length = Math.hypot(...step);
          if (length > PIPE_CROSS_MAX_MM || length < EPS_MM) continue;
          const leave = step.reduce((sum, value, axis) => sum + value * anchor.normal[axis], 0) / length;
          const meet = -step.reduce((sum, value, axis) => sum + value * other.normal[axis], 0) / length;
          if (leave < PIPE_CROSS_FACING || meet < PIPE_CROSS_FACING) continue;
          const pair = Math.min(anchor.id, other.id) + ',' + Math.max(anchor.id, other.id);
          if (spanned.has(pair) || !apart(massAt, from, wallOf(from, anchor.normal), to, wallOf(to, other.normal)) || !along(from, to, free)) continue;
          spanned.add(pair);
          addEdge(anchor.id, other.id, [], 'cross');
        }
      }
    }
  });
  return { nodes, edges, portNodes, bodies, near, massAt };
}

// Small binary heap on cost, then node id, in two flat lists
function createHeap() {
  const costs = [];
  const ids = [];
  const less = (first, second) => costs[first] < costs[second] || (costs[first] === costs[second] && ids[first] < ids[second]);
  const swap = (first, second) => {
    [costs[first], costs[second]] = [costs[second], costs[first]];
    [ids[first], ids[second]] = [ids[second], ids[first]];
  };
  return {
    get size() {
      return ids.length;
    },
    push(cost, id) {
      costs.push(cost);
      ids.push(id);
      let at = ids.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!less(at, parent)) break;
        swap(at, parent);
        at = parent;
      }
    },
    // Lowest entry as [cost, id]
    pop() {
      const top = [costs[0], ids[0]];
      const lastCost = costs.pop();
      const lastId = ids.pop();
      if (ids.length > 0) {
        costs[0] = lastCost;
        ids[0] = lastId;
        let at = 0;
        for (;;) {
          const left = at * 2 + 1;
          const right = left + 1;
          let best = at;
          if (left < ids.length && less(left, best)) best = left;
          if (right < ids.length && less(right, best)) best = right;
          if (best === at) break;
          swap(at, best);
          at = best;
        }
      }
      return top;
    },
  };
}

// Connected part of the graph each node is in
export function graphParts(graph) {
  const part = new Int32Array(graph.nodes.length).fill(-1);
  let count = 0;
  for (let start = 0; start < graph.nodes.length; start++) {
    if (part[start] >= 0) continue;
    const queue = [start];
    part[start] = count;
    while (queue.length > 0) {
      const at = queue.pop();
      if (graph.nodes[at].port !== undefined && at !== start) continue;
      for (const edgeId of graph.nodes[at].edges) {
        const edge = graph.edges[edgeId];
        const other = edge.a === at ? edge.b : edge.a;
        if (part[other] >= 0) continue;
        part[other] = count;
        queue.push(other);
      }
    }
    count++;
  }
  return part;
}

// Graph packed into flat lists for the search: per node, its links and their costs inward
function packed(graph) {
  if (graph.packed) return graph.packed;
  const count = graph.nodes.length;
  const start = new Int32Array(count + 1);
  graph.nodes.forEach((node, id) => {
    start[id + 1] = start[id] + node.edges.length;
  });
  const total = start[count];
  const other = new Int32Array(total);
  const edgeOf = new Int32Array(total);
  const flat = new Float64Array(total);
  const climb = new Float64Array(total);
  const length = new Float64Array(total);
  const span = new Uint8Array(total);
  const isPort = new Uint8Array(count);
  graph.nodes.forEach((node, id) => {
    if (node.port !== undefined) isPort[id] = 1;
    node.edges.forEach((edgeId, slot) => {
      const edge = graph.edges[edgeId];
      const from = edge.a === id ? edge.b : edge.a;
      const at = start[id] + slot;
      other[at] = from;
      edgeOf[at] = edgeId;
      flat[at] = edge.flat;
      climb[at] = edge.a === from ? edge.upAB : edge.upBA;
      length[at] = edge.length;
      span[at] = edge.kind === 'cross' ? 1 : 0;
    });
  });
  graph.packed = { start, other, edgeOf, flat, climb, length, span, isPort };
  return graph.packed;
}

// Cheapest routes from every node into the target ports; gravity never climbs, spans never chain
export function pipeSearch(graph, targets, gravity, bound = Infinity) {
  const { start, other, edgeOf, flat: edgeFlat, climb: edgeClimb, length: edgeLength, span: edgeSpan, isPort } = packed(graph);
  const count = graph.nodes.length * 2;
  // State 1: the next piece toward the target is a span
  const rank = new Float64Array(count).fill(Infinity);
  const flat = new Float64Array(count);
  const up = new Float64Array(count);
  const next = new Int32Array(count).fill(-1);
  const heap = createHeap();
  const starts = new Set(targets);
  const climbLimit = EPS_MM / STORY_MM;
  for (const id of targets) {
    rank[id * 2] = 0;
    heap.push(0, id * 2);
  }
  while (heap.size > 0) {
    const [cost, state] = heap.pop();
    if (cost > rank[state]) continue;
    const at = state >> 1;
    // Other ports are ends, never passed through
    if (isPort[at] && !starts.has(at)) continue;
    for (let slot = start[at]; slot < start[at + 1]; slot++) {
      const climb = edgeClimb[slot];
      if (gravity && climb > climbLimit) continue;
      if (edgeSpan[slot] && state & 1) continue;
      const from = other[slot] * 2 + edgeSpan[slot];
      const total = cost + edgeFlat[slot] * HEAD_PER_CELL + climb * HEAD_PER_STORY_UP + edgeLength[slot] * LENGTH_TIE;
      if (total >= rank[from]) continue;
      // The limit is on head alone; the length tie never stops a route
      if ((flat[state] + edgeFlat[slot]) * HEAD_PER_CELL + (up[state] + climb) * HEAD_PER_STORY_UP > bound + HEAD_SLACK) continue;
      rank[from] = total;
      flat[from] = flat[state] + edgeFlat[slot];
      up[from] = up[state] + climb;
      next[from] = edgeOf[slot] * 2 + (state & 1);
      heap.push(total, from);
    }
  }
  // Ports leave on a stub, never a span
  const view = (list) => (id) => list[id * 2];
  return { rank: view(rank), flat: view(flat), up: view(up), reached: (id) => next[id * 2] >= 0, next };
}

// True when three points lie on one line, heading the same way
function straightOn(first, middle, last) {
  const before = [0, 1, 2].map((axis) => middle[axis] - first[axis]);
  const after = [0, 1, 2].map((axis) => last[axis] - middle[axis]);
  const cross = [before[1] * after[2] - before[2] * after[1], before[2] * after[0] - before[0] * after[2], before[0] * after[1] - before[1] * after[0]];
  const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
  return Math.hypot(...cross) <= EPS_MM * Math.hypot(...before) * Math.hypot(...after) && dot > 0;
}

// Points of the route from a node down to its target, straight runs merged, gap spans kept apart
export function pipePath(graph, search, start) {
  const points = [graph.nodes[start].p];
  const spans = [];
  let at = start;
  let state = start * 2;
  let lastSpan = false;
  while (search.next[state] >= 0) {
    const edge = graph.edges[search.next[state] >> 1];
    const forward = edge.a === at;
    const to = forward ? edge.b : edge.a;
    const span = edge.kind === 'cross';
    for (const point of [...(forward ? edge.via : [...edge.via].reverse()), graph.nodes[to].p]) {
      const count = points.length;
      if (!span && !lastSpan && count >= 2 && straightOn(points[count - 2], points[count - 1], point)) points[count - 1] = point;
      else points.push(point);
      if (span) spans.push(points.length - 2);
      lastSpan = span;
    }
    state = to * 2 + (search.next[state] & 1);
    at = to;
  }
  return { points, spans, end: graph.nodes[at].port };
}
