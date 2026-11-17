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
