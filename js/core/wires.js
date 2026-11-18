import {
  CELL_MM, PLINTH_DIAMETER_CELLS, WIRE_SPAN_MAX_MM, WIRE_SPAN_FACING, WIRE_SAMPLE_MM, WIRE_BUNDLE_MM, CATENARY_STEPS, WIRE_OUT_MM,
} from '../config.js';
import { pipeGraph, boxIndex, createHeap, PIPE_OFF_MM } from './pipes.js';
import { inShape } from './mounts.js';
import { toLocal, standoff, pathLength, pathBlocked } from './strings.js';

const EPS_MM = 1e-3; // position slack
const RIM_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2; // plinth radius
const SEE_THROUGH = new Set(['glass', 'pane']); // groups that do not count as wall
const CAT_ITER = 80; // bisection rounds for the catenary shape
const CAT_B_MAX = 30; // widest catenary shape factor tried
const BUNDLE_SLOTS = 1; // most offsets to one side of a shared run
const WALL_DEPTHS_MM = [0.4, 1.2, 2, 2.8, 3.2]; // probe depths behind a wall face: panels end by 3, windows hold glass or nothing
const ROOF_DEPTHS_MM = [0.4, 1.5, 2.6, 3.5]; // probe depths under a roof face, past a sunken tray
const END_INSET_MM = 0.5; // wall checks start this far in from a run's ends
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const add = (point, step, scale = 1) => point.map((value, axis) => value + step[axis] * scale);
const distance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

// Local bounds of one kit shape
function shapeBounds(shape) {
  if (shape.kind === 'box') return { min: shape.min, max: shape.max };
  if (shape.kind === 'cyl') {
    const radius = Math.max(shape.radiusLow, shape.radiusHigh);
    return { min: [shape.center[0] - radius, shape.center[1] - radius, shape.from], max: [shape.center[0] + radius, shape.center[1] + radius, shape.to] };
  }
  const corners = shape.poly.flatMap(([first, second]) => [shape.from, shape.to].map((sweep) => [0, 1, 2].map((axis) => shape.origin[axis] + shape.axes[0][axis] * first + shape.axes[1][axis] * second + shape.axes[2][axis] * sweep)));
  return { min: [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]))), max: [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]))) };
}

const boundsCache = new WeakMap();
// Recipe ops with their bounds, so a point test skips ops that cannot hold it
function boundedOps(ops) {
  if (!boundsCache.has(ops)) boundsCache.set(ops, ops.map((op) => ({ op, bounds: shapeBounds(op.shape) })));
  return boundsCache.get(ops);
}

// True inside a real solid, glass excluded
export function solidPoint(context, near, point) {
  const group = groupPoint(context, near, point);
  return !!group && !SEE_THROUGH.has(group);
}

const instanceOps = new WeakMap();
// Bounded recipe ops of a placed module, cached on the instance
function opsFor(context, instance) {
  if (!instanceOps.has(instance)) instanceOps.set(instance, boundedOps(context.opsOf(instance)));
  return instanceOps.get(instance);
}

// Group at a local point, ops prefiltered by bounds
function groupIn(bounded, local) {
  const inside = new Map();
  for (let index = 0; index < bounded.length; index++) {
    const { op, bounds } = bounded[index];
    if (local[0] < bounds.min[0] - EPS_MM || local[0] > bounds.max[0] + EPS_MM || local[1] < bounds.min[1] - EPS_MM || local[1] > bounds.max[1] + EPS_MM || local[2] < bounds.min[2] - EPS_MM || local[2] > bounds.max[2] + EPS_MM) continue;
    if (op.cut) {
      if (inside.get(op.group) && inShape(op.shape, local)) inside.set(op.group, false);
    } else if (!inside.get(op.group) && inShape(op.shape, local)) inside.set(op.group, true);
  }
  for (const [group, filled] of inside) if (filled) return group;
  return null;
}

// Group of the solid at a point, 'plinth' under the plinth top, or null
export function groupPoint(context, near, point) {
  if (point[2] < 0 && Math.hypot(point[0], point[1]) <= RIM_MM) return 'plinth';
  const list = near.at(point);
  for (let item = 0; item < list.length; item++) {
    const box = context.boxes[list[item]];
    if (point[0] <= box.min[0] || point[0] >= box.max[0] || point[1] <= box.min[1] || point[1] >= box.max[1] || point[2] <= box.min[2] || point[2] >= box.max[2]) continue;
    const instance = context.byId.get(box.module);
    const group = groupIn(opsFor(context, instance), toLocal(instance, point));
    if (group) return group;
  }
  return null;
}

// True when wall, not glass or air, is behind
function wallBehind(context, near, point, step) {
  for (const depth of step[2] < 0 ? ROOF_DEPTHS_MM : WALL_DEPTHS_MM) {
    const group = groupPoint(context, near, add(point, step, PIPE_OFF_MM + depth));
    if (group) return !SEE_THROUGH.has(group);
  }
  return false;
}

// Surface graph with wire options
export function wireGraph(modules, ports, context) {
  const graph = pipeGraph(modules, ports, context, { crossMax: WIRE_SPAN_MAX_MM, facing: WIRE_SPAN_FACING, sameMass: true, bands: true });
  graph.solids = boxIndex(context.boxes);
  graph.checked = new Map();
  return graph;
}

// True when a conduit run hugs wall, no protrusion
export function conduitClear(context, near, from, to) {
  const run = [0, 1, 2].map((axis) => to[axis] - from[axis]);
  const steps = Math.max(1, Math.ceil(distance(from, to) / WIRE_SAMPLE_MM));
  const samples = Array.from({ length: steps + 1 }, (unused, index) => from.map((value, axis) => value + ((to[axis] - value) * index) / steps));
  if (samples.some((point) => solidPoint(context, near, point))) return { ok: false, normal: null };
  // Wall samples stay off the very ends, where a corner edge would read as air
  const length = distance(from, to);
  const keep = Math.min(END_INSET_MM, length / 2) / Math.max(length, EPS_MM);
  const inset = samples.map((point, index) => {
    const share = Math.min(1 - keep, Math.max(keep, index / steps));
    return from.map((value, axis) => value + (to[axis] - value) * share);
  });
  for (const step of AXES) {
    if (Math.abs(step[0] * run[0] + step[1] * run[1] + step[2] * run[2]) > EPS_MM) continue;
    if (inset.every((point) => wallBehind(context, near, point, step))) return { ok: true, normal: step.map((value) => -value) };
  }
  return { ok: false, normal: null };
}

// Edge check, cached: runs hug solid wall, wraps pass no solid, spans are checked when hung
function edgeOk(graph, context, edgeId) {
  if (graph.checked.has(edgeId)) return graph.checked.get(edgeId).ok;
  const edge = graph.edges[edgeId];
  let result = { ok: true, normal: null };
  if (edge.kind === 'run') result = conduitClear(context, graph.solids, graph.nodes[edge.a].p, graph.nodes[edge.b].p);
  else if (edge.kind === 'wrap') {
    const points = [graph.nodes[edge.a].p, ...edge.via, graph.nodes[edge.b].p];
    result.ok = points.every((point) => !solidPoint(context, graph.solids, point));
  }
  graph.checked.set(edgeId, result);
  return result.ok;
}

// Shortest wire routes by length from every node to the target ports; other ports are ends
export function wireSearch(graph, context, targets, bound = Infinity, offsets = null) {
  const count = graph.nodes.length;
  const dist = new Float64Array(count).fill(Infinity);
  const next = new Int32Array(count).fill(-1);
  const heap = createHeap();
  const starts = new Set(targets);
  targets.forEach((id, index) => {
    const start = offsets ? offsets[index] : 0;
    if (start >= dist[id]) return;
    dist[id] = start;
    heap.push(start, id);
  });
  while (heap.size > 0) {
    const [cost, at] = heap.pop();
    if (cost > dist[at]) continue;
    if (graph.nodes[at].port !== undefined && !starts.has(at)) continue;
    for (const edgeId of graph.nodes[at].edges) {
      const edge = graph.edges[edgeId];
      const other = edge.a === at ? edge.b : edge.a;
      const total = cost + edge.length;
      if (total >= dist[other] || total > bound) continue;
      if (!edgeOk(graph, context, edgeId)) continue;
      dist[other] = total;
      next[other] = edgeId;
      heap.push(total, other);
    }
  }
  return { dist: (id) => dist[id], reached: (id) => dist[id] < Infinity, next };
}

// Route from a node to the target: pieces with their kind, straight runs merged
export function wirePath(graph, search, start) {
  const pieces = [];
  let at = start;
  while (search.next[at] >= 0) {
    const edgeId = search.next[at];
    const edge = graph.edges[edgeId];
    const forward = edge.a === at;
    const to = forward ? edge.b : edge.a;
    const points = [graph.nodes[at].p, ...(forward ? edge.via : [...edge.via].reverse()), graph.nodes[to].p];
    const normal = graph.checked.has(edgeId) ? graph.checked.get(edgeId).normal : null;
    const kind = edge.kind === 'cross' ? 'span' : edge.kind === 'run' ? 'run' : edge.kind === 'wrap' ? 'wrap' : 'stub';
    // Runs stay as the graph checked them, one edge each
    pieces.push({ kind, points, normal });
    at = to;
  }
  return { pieces, end: graph.nodes[at].port, length: pieces.reduce((sum, piece) => sum + pathLength(piece.points), 0) };
}

// A direct drape between two ports: stub out, one free span, stub in
export function drapeRoute(from, to) {
  const start = standoff(from, WIRE_OUT_MM);
  const end = standoff(to, WIRE_OUT_MM);
  const pieces = [
    { kind: 'stub', points: [from.position, start], normal: null },
    { kind: 'span', points: [start, end], normal: null },
    { kind: 'stub', points: [end, to.position], normal: null },
  ];
  return { pieces, length: pieces.reduce((sum, piece) => sum + pathLength(piece.points), 0), drape: true };
}

// Catenary shape factor b from sinh(b) / b = ratio, by bisection
function shapeFactor(ratio) {
  let low = 1e-9;
  let high = CAT_B_MAX;
  for (let round = 0; round < CAT_ITER; round++) {
    const middle = (low + high) / 2;
    if (Math.sinh(middle) / middle < ratio) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// Points of a cable of a given length hung between two points, as a catenary
export function catenaryPoints(from, to, length, steps = CATENARY_STEPS) {
  const plan = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const rise = to[2] - from[2];
  const chord = Math.hypot(plan, rise);
  const straight = () => Array.from({ length: steps + 1 }, (unused, index) => from.map((value, axis) => value + ((to[axis] - value) * index) / steps));
  if (length <= chord + EPS_MM || plan < EPS_MM) return { points: straight(), a: Infinity, vertex: null };
  const shape = shapeFactor(Math.sqrt(length * length - rise * rise) / plan);
  const a = plan / (2 * shape);
  const vertex = plan / 2 - a * Math.atanh(rise / length);
  const lift = from[2] - a * Math.cosh(-vertex / a);
  const points = [];
  for (let index = 0; index <= steps; index++) {
    const along = (plan * index) / steps;
    const share = along / plan;
    points.push([from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share, index === steps ? to[2] : index === 0 ? from[2] : a * Math.cosh((along - vertex) / a) + lift]);
  }
  return { points, a, vertex };
}

// Cable on a route; spans share the slack by chord
export function layCable(route, slack) {
  const total = route.length * (1 + slack);
  const spans = route.pieces.filter((piece) => piece.kind === 'span');
  const chords = spans.reduce((sum, piece) => sum + distance(piece.points[0], piece.points[1]), 0);
  const leftover = total - route.length;
  const pieces = route.pieces.map((piece) => {
    if (piece.kind !== 'span') return { ...piece, points: piece.points.map((point) => [...point]) };
    const chord = distance(piece.points[0], piece.points[1]);
    const cable = chord + (chords > 0 ? (leftover * chord) / chords : 0);
    return { ...piece, points: catenaryPoints(piece.points[0], piece.points[1], cable).points, cable };
  });
  return { pieces, total, slack };
}

// Flat point list of a laid cable, with the indexes where spans start
export function cablePoints(laid) {
  const points = [];
  const spans = [];
  for (const piece of laid.pieces) {
    piece.points.forEach((point, index) => {
      if (index === 0 && points.length > 0 && distance(points[points.length - 1], point) < EPS_MM) return;
      if (piece.kind === 'span' && index > 0) spans.push(points.length - 1);
      points.push(point);
    });
  }
  return { points, spans };
}

// Sideways step of a run within its wall: across the run, in the wall plane
function sideOf(piece) {
  const [from, to] = piece.points;
  const run = [0, 1, 2].map((axis) => to[axis] - from[axis]);
  const length = Math.hypot(...run);
  if (!piece.normal || length < EPS_MM) return null;
  const unit = run.map((value) => value / length);
  const normal = piece.normal;
  return [normal[1] * unit[2] - normal[2] * unit[1], normal[2] * unit[0] - normal[0] * unit[2], normal[0] * unit[1] - normal[1] * unit[0]].map((value) => Math.round(value));
}

const pieceKey = (piece) => piece.points.slice(0, 2).map((point) => point.map((value) => Math.round(value * 10)).join(',')).sort().join('|');

// Cables sharing a conduit run sit side by side, alternating sides of the first
export function bundleCables(cables, fits = () => true) {
  const slots = new Map();
  for (const cable of cables) {
    const pieces = cable.laid.pieces;
    for (const piece of pieces) {
      if (piece.kind !== 'run') continue;
      const key = pieceKey(piece);
      const slot = slots.get(key) || 0;
      slots.set(key, slot + 1);
      const side = sideOf(piece);
      const step = Math.min(BUNDLE_SLOTS, Math.ceil(slot / 2)) * (slot % 2 ? 1 : -1) * WIRE_BUNDLE_MM;
      // A shift that leaves the wall tries the other side, then stays put
      piece.shift = null;
      for (const sign of [1, -1]) {
        const shift = side && slot > 0 ? side.map((value) => value * step * sign) : null;
        if (shift && fits(piece.points.map((point) => add(point, shift)))) {
          piece.shift = shift;
          break;
        }
      }
    }
    // Wraps follow the run before them
    pieces.forEach((piece, index) => {
      if (piece.kind === 'wrap') piece.shift = (pieces[index - 1] && pieces[index - 1].shift) || (pieces[index + 1] && pieces[index + 1].shift) || null;
    });
    const moved = pieces.map((piece) => piece.points.map((point) => (piece.shift && piece.kind !== 'span' ? add(point, piece.shift) : [...point])));
    // Runs keep their shift; other pieces meet them
    pieces.forEach((piece, index) => {
      if (index === 0) return;
      const before = pieces[index - 1];
      const corner = piece.points[0];
      const at = (shift) => (shift ? add(corner, shift) : [...corner]);
      if (before.kind === 'run' && piece.kind === 'run') {
        // Each run keeps its own shift; the short step between them stays at the joint
        moved[index - 1][moved[index - 1].length - 1] = at(before.shift);
        moved[index][0] = at(piece.shift);
      } else if (before.kind === 'run') moved[index][0] = moved[index - 1][moved[index - 1].length - 1] = at(before.shift);
      else if (piece.kind === 'run') moved[index - 1][moved[index - 1].length - 1] = moved[index][0] = at(piece.shift);
      else moved[index - 1][moved[index - 1].length - 1] = moved[index][0] = at(before.kind === 'span' ? piece.shift : before.shift);
    });
    pieces.forEach((piece, index) => {
      piece.points = moved[index];
    });
    rehang(cable.laid);
  }
  return cables;
}

// A laid cable again on its own route: total from the route and slack, spans share the extra
export function rehang(laid) {
  const chordOf = (piece) => distance(piece.points[0], piece.points[piece.points.length - 1]);
  const spans = laid.pieces.filter((piece) => piece.kind === 'span');
  const route = laid.pieces.reduce((sum, piece) => sum + (piece.kind === 'span' ? chordOf(piece) : pathLength(piece.points)), 0);
  const chords = spans.reduce((sum, piece) => sum + chordOf(piece), 0);
  laid.total = route * (1 + laid.slack);
  for (const piece of spans) {
    const chord = chordOf(piece);
    piece.cable = chord + (chords > 0 ? ((laid.total - route) * chord) / chords : 0);
    piece.points = catenaryPoints(piece.points[0], piece.points[piece.points.length - 1], piece.cable).points;
  }
  return laid;
}

// First module or the plinth a laid cable runs into, ends checked on their solids
export function cableBlocked(context, laid, ends) {
  return pathBlocked(context, cablePoints(laid).points, ends);
}
