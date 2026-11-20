import { CELL_MM, PIPE_MAX_MM, MAX_WIRES_PER_PAIR, MAX_PIPES_PER_PAIR, MAX_LINES_PER_PAIR } from '../config.js';
import { structureMounts } from './mounts.js';
import { stringContext, pathBlocked } from './strings.js';
import { pipeSearch, pipePath, pathHead } from './pipes.js';
import { layCable, cablePoints } from './wires.js';
import { waterGraph, linkCost } from './water.js';
import { powerGraph, wireBetween } from './power.js';
import { lineBetween } from './lines.js';

export const WIRE_TYPES = ['power', 'water', 'line']; // string types a player can connect
export const WIRE_REASONS = ['missing-port', 'incompatible', 'same-port', 'same-part', 'port-full', 'pair-cap', 'too-long', 'blocked', 'no-route', 'not-level', 'not-power', 'not-water', 'loop']; // why a connection is refused
export const PAIR_CAPS = { power: MAX_WIRES_PER_PAIR, water: MAX_PIPES_PER_PAIR, line: MAX_LINES_PER_PAIR }; // most strings per port pair
const COST_ROUND = 10; // costs shown to a tenth

// String type a port takes, or null
export function stringTypeOf(portType) {
  if (portType === 'power') return 'power';
  if (portType === 'water-in' || portType === 'water-out') return 'water';
  if (portType === 'line') return 'line';
  return null;
}

export const endKey = (end) => end.module + ':' + end.index;
// One key for a port pair in either order
export const pairKey = (first, second) => [endKey(first), endKey(second)].sort().join('|');
const endOf = (port) => ({ module: port.module, index: port.index });
const sameEnd = (first, second) => first.module === second.module && first.index === second.index;

export const emptyWiring = () => ({ connections: [], cuts: [] });
export const wiringEmpty = (wiring) => !wiring || (wiring.connections.length === 0 && wiring.cuts.length === 0);

const endOk = (end) => !!end && typeof end === 'object' && Number.isInteger(end.module) && Number.isInteger(end.index) && end.index >= 0;

// Checked copy of stored wiring, or null when malformed
export function parseWiring(raw) {
  if (raw === undefined || raw === null) return emptyWiring();
  if (typeof raw !== 'object' || !Array.isArray(raw.connections) || !Array.isArray(raw.cuts)) return null;
  const entry = (item) => (item && endOk(item.a) && endOk(item.b) && WIRE_TYPES.includes(item.type) ? { a: endOf(item.a), b: endOf(item.b), type: item.type } : null);
  const connections = raw.connections.map(entry);
  const cuts = raw.cuts.map(entry);
  if (connections.includes(null) || cuts.includes(null)) return null;
  return { connections, cuts };
}

// Two ports as a connection: water runs out to in; else why not
export function orient(first, second) {
  if (sameEnd(first, second)) return { ok: false, reason: 'same-port' };
  const type = stringTypeOf(first.type);
  if (!type || type !== stringTypeOf(second.type)) return { ok: false, reason: 'incompatible' };
  if (type === 'water') {
    if (first.type === second.type) return { ok: false, reason: 'incompatible' };
    const [out, inlet] = first.type === 'water-out' ? [first, second] : [second, first];
    return { ok: true, connection: { a: endOf(out), b: endOf(inlet), type } };
  }
  return { ok: true, connection: { a: endOf(first), b: endOf(second), type } };
}

// Wiring with a connection added
export const withConnection = (wiring, connection) => ({ connections: [...wiring.connections, connection], cuts: wiring.cuts.filter((cut) => pairKey(cut.a, cut.b) !== pairKey(connection.a, connection.b)) });

// Cutting a string: a manual one is removed, an automatic one is recorded as cut
export function withCut(wiring, first, second, type, manual) {
  const key = pairKey(first, second);
  if (manual) {
    const at = wiring.connections.findIndex((connection) => pairKey(connection.a, connection.b) === key);
    return at < 0 ? wiring : { connections: wiring.connections.filter((unused, index) => index !== at), cuts: wiring.cuts };
  }
  if (wiring.cuts.some((cut) => pairKey(cut.a, cut.b) === key)) return wiring;
  return { connections: wiring.connections, cuts: [...wiring.cuts, { a: endOf(first), b: endOf(second), type }] };
}

// Ids mapped one by one; entries whose module maps to null are left out
export function mapWiring(wiring, mapId) {
  const move = (item) => {
    const a = mapId(item.a.module);
    const b = mapId(item.b.module);
    return a === null || a === undefined || b === null || b === undefined ? null : { ...item, a: { module: a, index: item.a.index }, b: { module: b, index: item.b.index } };
  };
  return { connections: wiring.connections.map(move).filter(Boolean), cuts: wiring.cuts.map(move).filter(Boolean) };
}

// Wiring kept across a structure change: both modules still there as the same family (strict: also unmoved)
export function keepWiring(wiring, before, after, strict = false) {
  if (wiringEmpty(wiring)) return wiring;
  const sign = (instance) => (strict ? [instance.family, instance.x, instance.y, instance.z, instance.rot & 3].join(':') : instance.family);
  const signBefore = new Map(before.map((instance) => [instance.id, sign(instance)]));
  const signAfter = new Map(after.map((instance) => [instance.id, sign(instance)]));
  const kept = mapWiring(wiring, (id) => (signAfter.has(id) && signAfter.get(id) === signBefore.get(id) ? id : null));
  return kept.connections.length === wiring.connections.length && kept.cuts.length === wiring.cuts.length ? wiring : kept;
}

// Ports, string context and route graphs of one structure, reused while only the wiring changes
export function serviceBase(modules) {
  return { modules, mounts: structureMounts(modules), context: stringContext(modules), water: {}, power: {}, inletSearches: new Map() };
}

const BASES_KEPT = 4; // structure bases a cache keeps
const BASE_PREFIX = 'base:'; // cache keys of structure bases

// Base for a structure from a cache map, made once per structure key; oldest dropped past the limit
export function baseFrom(store, key, modules) {
  if (!store) return serviceBase(modules);
  const found = store.get(BASE_PREFIX + key);
  if (found) return found;
  const made = serviceBase(modules);
  store.set(BASE_PREFIX + key, made);
  const kept = [...store.keys()].filter((name) => typeof name === 'string' && name.startsWith(BASE_PREFIX));
  for (const name of kept.slice(0, Math.max(0, kept.length - BASES_KEPT))) store.delete(name);
  return made;
}

const portIn = (base, end) => base.mounts.find((port) => port.module === end.module && port.index === end.index && port.active) || null;
const round = (value) => Math.round(value * COST_ROUND) / COST_ROUND;

// Route of one connection by the automatic rules: points, length and cost, or a reason with the attempt and blocker
export function manualRoute(base, connection) {
  const context = base.context;
  const first = portIn(base, connection.a);
  const second = portIn(base, connection.b);
  if (!first || !second) return { ok: false, reason: 'missing-port', points: [], blocker: null };
  const oriented = orient(first, second);
  if (!oriented.ok) return { ok: false, reason: oriented.reason, points: [], blocker: null };
  if (oriented.connection.type !== connection.type || !sameEnd(oriented.connection.a, connection.a)) return { ok: false, reason: 'incompatible', points: [], blocker: null };
  const straight = [first.position, second.position];
  const between = (ends) => pathBlocked(context, straight, ends);
  if (first.module === second.module) return { ok: false, reason: 'same-part', points: straight, blocker: null };
  if (connection.type === 'power') {
    const { graph, live } = powerGraph(base.modules, base.mounts, context, base.power);
    const from = live.find((port) => sameEnd(port, first));
    const to = live.find((port) => sameEnd(port, second));
    const found = wireBetween(graph, context, from, to);
    if (found.fail) {
      const points = cablePoints(layCable(found.blocked.route, 0)).points;
      return { ok: false, reason: found.fail, points, blocker: found.blocked.hit ? found.blocked.hit.module : null };
    }
    return { ok: true, type: 'power', route: found.route, points: cablePoints(layCable(found.route, 0)).points, length: found.route.length, cost: { reach: round(found.cells) } };
  }
  if (connection.type === 'water') {
    if (Math.hypot(...[0, 1, 2].map((axis) => first.position[axis] - second.position[axis])) > PIPE_MAX_MM) return { ok: false, reason: 'too-long', points: straight, blocker: null };
    const { graph, waterPorts } = waterGraph(base.modules, base.mounts, context, base.water);
    const out = waterPorts.find((port) => sameEnd(port, first));
    const inlet = waterPorts.find((port) => sameEnd(port, second));
    if (out.node === null || inlet.node === null) return { ok: false, reason: 'no-route', points: straight, blocker: null };
    if (!base.inletSearches.has(inlet.node)) base.inletSearches.set(inlet.node, pipeSearch(graph, [inlet.node], false));
    const search = base.inletSearches.get(inlet.node);
    if (!search.reached(out.node)) {
      const hit = between([first.module, second.module]);
      return { ok: false, reason: hit ? 'blocked' : 'no-route', points: straight, blocker: hit ? hit.module : null };
    }
    const path = pipePath(graph, search, out.node);
    const size = pathHead(path.points);
    const length = path.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...[0, 1, 2].map((axis) => point[axis] - path.points[index][axis])), 0);
    return { ok: true, type: 'water', route: { points: path.points, spans: path.spans, length }, size, points: path.points, length, cost: { head: round(linkCost(size)), climbs: size.up > 0 } };
  }
  const found = lineBetween(context, first, second);
  if (found.fail) return { ok: false, reason: found.fail, points: found.line ? found.line.points : straight, blocker: found.line && found.line.blocked ? found.line.blocked.module : null };
  return { ok: true, type: 'line', line: found.line, points: found.line.points, length: found.line.length, cost: { cells: round(found.line.length / CELL_MM) } };
}

// Every connection checked in order (capacity and pair cap count earlier ones); pinned routes per type and the cut keys
export function checkWiring(base, wiring) {
  const used = new Map();
  const pairs = new Map();
  const pinned = { power: [], water: [], line: [] };
  const connections = wiring.connections.map((connection, at) => {
    const first = portIn(base, connection.a);
    const second = portIn(base, connection.b);
    let result = !first || !second ? { ok: false, reason: 'missing-port', points: [], blocker: null } : null;
    if (!result && [first, second].some((port) => (used.get(endKey(port)) || 0) >= port.capacity)) result = { ok: false, reason: 'port-full', points: [first.position, second.position], blocker: null };
    if (!result && (pairs.get(pairKey(first, second)) || 0) >= PAIR_CAPS[connection.type]) result = { ok: false, reason: 'pair-cap', points: [first.position, second.position], blocker: null };
    if (!result) result = manualRoute(base, connection);
    if (result.ok) {
      for (const port of [first, second]) used.set(endKey(port), (used.get(endKey(port)) || 0) + 1);
      pairs.set(pairKey(first, second), (pairs.get(pairKey(first, second)) || 0) + 1);
      pinned[connection.type].push({ at, a: connection.a, b: connection.b, out: connection.a, in: connection.b, route: result.route, size: result.size, line: result.line });
    }
    return { ...connection, ...result };
  });
  return { connections, pinned, cuts: new Set(wiring.cuts.map((cut) => pairKey(cut.a, cut.b))) };
}

// Manual connections that break the rules, as indices, for the validator
export function wiringProblems(base, wiring) {
  if (wiringEmpty(wiring)) return [];
  return checkWiring(base, wiring).connections.map((result, index) => (result.ok ? null : { index, reason: result.reason })).filter(Boolean);
}
