import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { SIDES, cellInPlinth, moduleAt, worldFromModules, worldHeight, columnTop } from './grid.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { instancePorts } from './ports.js';

const WATER_SEED = 0x3a7e12; // keeps water rolls apart from other rolls
const CATCH_CHANCE = 0.45; // chance a roof peak catches rain
const CATCH_MIN_LEVEL = 2; // lowest roof that catches rain
export const WATER_MAX_PATHS = 28; // most water paths per structure
export const WATER_LIGHT_PATHS = 10; // most water paths on weak devices
const WATER_MAX_STEPS = 80; // longest path in cells
const WATER_LIFT_MM = 0.4; // water surface above a roof
const FALL_PAST_MM = 4; // waterfall starts this far past the rim
export const FALL_DROP_MM = 70; // waterfall length under the plinth top
const HOP_MIN_MM = 0.01; // shorter hops to a port are skipped
const SOURCE_TYPES = ['outlet']; // port types that give water
// What a sink port ends a path as, by port type and family
const SINK_ENDS = { inlet: { farm: 'crop', tank: 'tank' }, basin: { garden: 'basin' } };
export const WATER_ENDS = ['crop', 'tank', 'basin', 'pool', 'fall'];

const cellKey = (cellX, cellY) => cellX + ',' + cellY;
const centerOf = (cellX, cellY, level) => [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM, level * STORY_MM + WATER_LIFT_MM];

// Roof level of every plinth cell, 0 on the bare plinth
function roofMap(world) {
  const top = worldHeight(world);
  const radius = PLINTH_DIAMETER_CELLS / 2;
  const roofs = new Map();
  for (let cellY = -radius; cellY < radius; cellY++) {
    for (let cellX = -radius; cellX < radius; cellX++) {
      if (cellInPlinth(cellX, cellY)) roofs.set(cellKey(cellX, cellY), columnTop(world, cellX, cellY, top));
    }
  }
  return roofs;
}

// Open top sink ports per module, with what is left of their capacity
function sinkPorts(modules) {
  const sinks = new Map();
  for (const instance of modules) {
    const own = instancePorts(instance)
      .filter((port) => port.face === 'top' && SINK_ENDS[port.type] && SINK_ENDS[port.type][instance.family])
      .map((port) => ({ module: instance.id, port: port.index, end: SINK_ENDS[port.type][instance.family], position: port.position, left: port.capacity }));
    if (own.length > 0) sinks.set(instance.id, own);
  }
  return sinks;
}

// Shortest way over bare plinth cells to the rim
function wayToRim(roofs, startX, startY) {
  const queue = [[startX, startY]];
  const from = new Map([[cellKey(startX, startY), null]]);
  while (queue.length > 0) {
    const [cellX, cellY] = queue.shift();
    for (const [stepX, stepY] of SIDES) {
      const nextX = cellX + stepX;
      const nextY = cellY + stepY;
      const key = cellKey(nextX, nextY);
      if (!roofs.has(key)) {
        const way = [[nextX, nextY]];
        for (let at = [cellX, cellY]; at; at = from.get(cellKey(at[0], at[1]))) way.unshift(at);
        return way;
      }
      if (from.has(key) || roofs.get(key) !== 0) continue;
      from.set(key, [cellX, cellY]);
      queue.push([nextX, nextY]);
    }
  }
  return null;
}

// One path downhill from a cell until a sink, a pool or the rim
function trace(world, roofs, sinks, rng, start, skipModule) {
  let [cellX, cellY] = start;
  let level = roofs.get(cellKey(cellX, cellY));
  const points = [centerOf(cellX, cellY, level)];
  const cells = [[cellX, cellY, level]];
  const finish = (end, extra = {}) => ({ points, cells, end, ...extra });
  for (let step = 0; step < WATER_MAX_STEPS; step++) {
    if (level === 0) {
      const way = wayToRim(roofs, cellX, cellY);
      if (!way) return finish('pool');
      for (const [nextX, nextY] of way.slice(1, -1)) {
        points.push(centerOf(nextX, nextY, 0));
        cells.push([nextX, nextY, 0]);
      }
      // Over the rim and down
      const [lastX, lastY] = way[way.length - 2];
      const [outX, outY] = way[way.length - 1];
      const rim = [(lastX + 0.5 + (outX - lastX) * 0.5) * CELL_MM, (lastY + 0.5 + (outY - lastY) * 0.5) * CELL_MM];
      const reach = Math.max(Math.hypot(rim[0], rim[1]), (PLINTH_DIAMETER_CELLS * CELL_MM) / 2) + FALL_PAST_MM;
      const angle = Math.atan2(rim[1], rim[0]);
      const lip = [Math.cos(angle) * reach, Math.sin(angle) * reach, WATER_LIFT_MM];
      points.push(lip, [lip[0], lip[1], -FALL_DROP_MM]);
      return finish('fall');
    }
    // Lower neighbours: an open sink first, then the gentlest step, ties by seed
    const lower = SIDES.map(([stepX, stepY]) => [cellX + stepX, cellY + stepY])
      .map(([nextX, nextY]) => ({ nextX, nextY, roof: roofs.has(cellKey(nextX, nextY)) ? roofs.get(cellKey(nextX, nextY)) : -1 }))
      .filter((next) => next.roof < level);
    if (lower.length === 0) return finish('pool');
    const thirsty = lower.filter((option) => {
      const roofModule = option.roof > 0 ? moduleAt(world, option.nextX, option.nextY, option.roof - 1) : null;
      return roofModule && roofModule.id !== skipModule && (sinks.get(roofModule.id) || []).some((sink) => sink.left > 0);
    });
    const wanted = thirsty.length > 0 ? thirsty : lower;
    const gentlest = Math.max(...wanted.map((option) => option.roof));
    const next = rng.pick(wanted.filter((option) => option.roof === gentlest));
    if (next.roof < 0) {
      // Straight off the plinth from a roof at the rim
      const lip = [(next.nextX + 0.5) * CELL_MM, (next.nextY + 0.5) * CELL_MM, level * STORY_MM + WATER_LIFT_MM];
      points.push(lip, [lip[0], lip[1], -FALL_DROP_MM]);
      return finish('fall');
    }
    // Flume to the next cell, then the drop
    points.push(centerOf(next.nextX, next.nextY, level), centerOf(next.nextX, next.nextY, next.roof));
    cellX = next.nextX;
    cellY = next.nextY;
    level = next.roof;
    cells.push([cellX, cellY, level]);
    if (level === 0) continue;
    const under = moduleAt(world, cellX, cellY, level - 1);
    const open = under && under.id !== skipModule ? (sinks.get(under.id) || []).filter((sink) => sink.left > 0) : [];
    if (open.length === 0) continue;
    // Nearest open port of the module it lands on
    const here = points[points.length - 1];
    open.sort((first, second) => Math.hypot(first.position[0] - here[0], first.position[1] - here[1]) - Math.hypot(second.position[0] - here[0], second.position[1] - here[1]) || first.port - second.port);
    open[0].left--;
    // A last hop to the port, unless it lands on it
    const spot = [open[0].position[0], open[0].position[1], open[0].position[2] + WATER_LIFT_MM];
    if (Math.hypot(spot[0] - here[0], spot[1] - here[1], spot[2] - here[2]) > HOP_MIN_MM) points.push(spot);
    return finish(open[0].end, { sink: { module: open[0].module, port: open[0].port } });
  }
  return finish('pool');
}

// Catch points: tank outlets, then seeded rain catchers on roof peaks
function catchPoints(world, roofs, modules, rng) {
  const sources = [];
  const taken = new Set();
  const add = (kind, instance, cellX, cellY) => {
    const key = cellKey(cellX, cellY);
    if (taken.has(key) || !roofs.has(key)) return;
    taken.add(key);
    sources.push({ kind, module: instance.id, x: cellX, y: cellY });
  };
  for (const instance of modules) {
    const outlets = instancePorts(instance).filter((port) => SOURCE_TYPES.includes(port.type));
    for (const port of outlets) {
      const cellX = Math.floor((port.position[0] - port.normal[0]) / CELL_MM);
      const cellY = Math.floor((port.position[1] - port.normal[1]) / CELL_MM);
      if (roofs.get(cellKey(cellX, cellY)) === instance.z + instance.h) add('tank', instance, cellX, cellY);
    }
  }
  for (const [key, roof] of roofs) {
    if (roof < CATCH_MIN_LEVEL) continue;
    const [cellX, cellY] = key.split(',').map(Number);
    const peak = SIDES.every(([stepX, stepY]) => (roofs.get(cellKey(cellX + stepX, cellY + stepY)) || 0) <= roof);
    const drains = SIDES.some(([stepX, stepY]) => (roofs.has(cellKey(cellX + stepX, cellY + stepY)) ? roofs.get(cellKey(cellX + stepX, cellY + stepY)) : -1) < roof);
    if (!peak || !drains || !rng.chance(CATCH_CHANCE)) continue;
    add('rain', moduleAt(world, cellX, cellY, roof - 1), cellX, cellY);
  }
  return sources;
}

// Kind of a segment: level run, drop between roofs, or the waterfall
function segmentsOf(path) {
  const segments = [];
  let across = [0, 1];
  for (let index = 1; index < path.points.length; index++) {
    const from = path.points[index - 1];
    const to = path.points[index];
    const flat = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (flat > 1e-6) across = [-(to[1] - from[1]) / flat, (to[0] - from[0]) / flat];
    const last = index === path.points.length - 1;
    const kind = flat > 1e-6 && Math.abs(to[2] - from[2]) < 1e-6 ? 'run' : last && path.end === 'fall' ? 'fall' : 'drop';
    segments.push({ from, to, kind, across });
  }
  return segments;
}

// Render-only water network of a structure, the same for the same seed
export function waterNetwork(modules, seedText) {
  const world = worldFromModules(modules);
  const roofs = roofMap(world);
  const sinks = sinkPorts(modules);
  const rng = makeRng(mixSeed(hashString(String(seedText)), WATER_SEED));
  const sources = catchPoints(world, roofs, modules, rng).slice(0, WATER_MAX_PATHS);
  const paths = sources.map((source) => {
    const path = trace(world, roofs, sinks, rng, [source.x, source.y], source.module);
    return { source, end: path.end, sink: path.sink || null, cells: path.cells, points: path.points, segments: segmentsOf(path) };
  });
  return { paths };
}

const WIRE_SEED = 0x77153; // keeps wire rolls apart from water rolls
export const WIRE_MAX_MM = 5 * CELL_MM; // longest single wire
const WIRE_CROSS_MM = 1.5 * CELL_MM; // cost added per wire crossed in plan
export const WIRE_MAX = 40; // most wires per structure
export const WIRE_LIGHT = 14; // most wires on weak devices
export const WIRE_SAG_SHARE = 0.12; // sag at mid span, share of the length
const WIRE_OUT_MM = 1.5; // wire ends this far off the wall
const SIGHT_STEP_MM = CELL_MM / 3; // spacing of line of sight samples
const WIRE_SOURCES = ['turbine', 'solar']; // families that give power
const TARP_REACH_MM = 2.3 * CELL_MM; // longest tarp edge
const TARP_RISE_MM = STORY_MM; // most height difference between anchors
const TARP_MIN_AREA_MM2 = 60; // smallest tarp in plan
export const TARP_MAX = 6; // most tarps per structure
export const TARP_LIGHT = 2; // most tarps on weak devices
export const TARP_COLORS = [0xb5694a, 0xc9a23f, 0x5f9c95]; // terracotta, mustard, faded teal

const distance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

// True when two plan segments cross away from their ends
export function planCross(firstA, firstB, secondA, secondB) {
  const turn = (from, to, point) => (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]);
  const sideA = turn(firstA, firstB, secondA);
  const sideB = turn(firstA, firstB, secondB);
  const sideC = turn(secondA, secondB, firstA);
  const sideD = turn(secondA, secondB, firstB);
  return sideA * sideB < 0 && sideC * sideD < 0;
}

// Links ports outward from the sources: nearest first, crossings cost extra
export function linkWires(sources, consumers, { maxLength = WIRE_MAX_MM, crossCost = WIRE_CROSS_MM, limit = WIRE_MAX, blocked = () => false } = {}) {
  const live = sources.map((port) => ({ ...port, left: port.capacity }));
  const waiting = consumers.map((port) => ({ ...port, left: port.capacity }));
  const fed = new Set(sources.map((port) => port.module));
  const wires = [];
  while (wires.length < limit) {
    const options = [];
    for (const from of live) {
      if (from.left <= 0) continue;
      for (const to of waiting) {
        if (fed.has(to.module)) continue;
        const length = distance(from.position, to.position);
        if (length <= maxLength) options.push({ from, to, length });
      }
    }
    options.sort((first, second) => first.length - second.length || first.from.module - second.from.module || first.to.module - second.to.module || first.to.port - second.to.port);
    let best = null;
    for (const option of options) {
      if (best && option.length >= best.cost) break;
      if (blocked(option.from.position, option.to.position)) continue;
      const crossings = wires.filter((wire) => planCross(option.from.position, option.to.position, wire.a, wire.b)).length;
      const cost = option.length + crossCost * crossings;
      if (!best || cost < best.cost) best = { ...option, cost, crossings };
    }
    if (!best) break;
    best.from.left--;
    best.to.left--;
    fed.add(best.to.module);
    live.push(best.to);
    wires.push({
      from: { module: best.from.module, port: best.from.port },
      to: { module: best.to.module, port: best.to.port },
      a: best.from.position,
      b: best.to.position,
      length: best.length,
      crossings: best.crossings,
      sag: best.length * WIRE_SAG_SHARE,
    });
  }
  return wires;
}

// Points along a hanging line, ends exact, lowest at mid span
export function wirePoints(wire, count) {
  const points = [];
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    points.push([
      wire.a[0] + (wire.b[0] - wire.a[0]) * share,
      wire.a[1] + (wire.b[1] - wire.a[1]) * share,
      wire.a[2] + (wire.b[2] - wire.a[2]) * share - 4 * wire.sag * share * (1 - share),
    ]);
  }
  return points;
}

// Wall ports with open air in front, moved just off the wall
function openPorts(world, modules, type) {
  const ports = [];
  for (const instance of modules) {
    for (const port of instancePorts(instance)) {
      if (port.type !== type || port.normal[2] !== 0) continue;
      const frontX = Math.floor((port.position[0] + port.normal[0] * CELL_MM * 0.5) / CELL_MM);
      const frontY = Math.floor((port.position[1] + port.normal[1] * CELL_MM * 0.5) / CELL_MM);
      if (moduleAt(world, frontX, frontY, Math.floor(port.position[2] / STORY_MM))) continue;
      ports.push({
        module: instance.id,
        family: instance.family,
        port: port.index,
        capacity: port.capacity,
        normal: port.normal,
        position: [port.position[0] + port.normal[0] * WIRE_OUT_MM, port.position[1] + port.normal[1] * WIRE_OUT_MM, port.position[2]],
      });
    }
  }
  return ports;
}

// True when a straight line between two points passes through a module
function sightBlocked(world, from, to) {
  const steps = Math.ceil(distance(from, to) / SIGHT_STEP_MM);
  for (let index = 1; index < steps; index++) {
    const share = index / steps;
    const at = [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * share);
    if (at[2] >= 0 && moduleAt(world, Math.floor(at[0] / CELL_MM), Math.floor(at[1] / CELL_MM), Math.floor(at[2] / STORY_MM))) return true;
  }
  return false;
}

// Render-only power wires from turbines and solar arrays to wire ports
export function wireNetwork(modules, seedText) {
  const world = worldFromModules(modules);
  const rng = makeRng(mixSeed(hashString(String(seedText)), WIRE_SEED));
  const ports = openPorts(world, modules, 'wire');
  const sources = ports.filter((port) => WIRE_SOURCES.includes(port.family));
  // Seeded order breaks ties between equal ports
  const consumers = rng.shuffle(ports.filter((port) => !WIRE_SOURCES.includes(port.family)));
  return { wires: linkWires(sources, consumers, { blocked: (from, to) => sightBlocked(world, from, to) }) };
}

// Render-only tarps stretched between three or four free hooks
export function tarpNetwork(modules, seedText) {
  const world = worldFromModules(modules);
  const rng = makeRng(mixSeed(hashString(String(seedText)), WIRE_SEED + 1));
  const hooks = openPorts(world, modules, 'hook').map((port) => ({ ...port, left: port.capacity }));
  const tarps = [];
  for (const first of rng.shuffle(hooks.slice())) {
    if (tarps.length >= TARP_MAX) break;
    if (first.left <= 0) continue;
    const near = hooks
      .filter((hook) => hook !== first && hook.left > 0 && Math.abs(hook.position[2] - first.position[2]) <= TARP_RISE_MM && distance(hook.position, first.position) <= TARP_REACH_MM)
      .sort((hookA, hookB) => distance(hookA.position, first.position) - distance(hookB.position, first.position) || hookA.module - hookB.module || hookA.port - hookB.port);
    const anchors = [first];
    const want = rng.int(3, 4);
    for (const hook of near) {
      if (anchors.length >= want) break;
      const fits = anchors.every((anchor) => distance(anchor.position, hook.position) <= TARP_REACH_MM && !sightBlocked(world, anchor.position, hook.position));
      if (fits) anchors.push(hook);
    }
    if (anchors.length < 3) continue;
    // Corners in order round the middle
    const middle = [0, 1, 2].map((axis) => anchors.reduce((sum, anchor) => sum + anchor.position[axis], 0) / anchors.length);
    anchors.sort((hookA, hookB) => Math.atan2(hookA.position[1] - middle[1], hookA.position[0] - middle[0]) - Math.atan2(hookB.position[1] - middle[1], hookB.position[0] - middle[0]));
    let area = 0;
    anchors.forEach((anchor, index) => {
      const next = anchors[(index + 1) % anchors.length];
      area += (anchor.position[0] * next.position[1] - next.position[0] * anchor.position[1]) / 2;
    });
    if (Math.abs(area) < TARP_MIN_AREA_MM2) continue;
    for (const anchor of anchors) anchor.left--;
    tarps.push({
      anchors: anchors.map((anchor) => ({ module: anchor.module, port: anchor.port })),
      points: anchors.map((anchor) => anchor.position),
      middle,
      area: Math.abs(area),
      color: TARP_COLORS[rng.int(0, TARP_COLORS.length - 1)],
    });
  }
  return { tarps };
}
