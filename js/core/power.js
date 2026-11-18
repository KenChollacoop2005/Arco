import {
  CELL_MM, WATER_QUARTERS, POWER_SUPPLY, TURBINE_EXTRA_PER_STORY, SOLAR_PER_CELL, WHEEL_PER_UNIT, WHEEL_UP_CAP, POWER_RELAYS, POWER_DEMAND,
  POWER_FANOUT, POWER_CHILD_FANOUT, MAX_CHAIN_LINKS, REJOIN_CHANCE, POWER_SHORT_REACH, POWER_JITTER, POWER_OVERBOOK, WIRE_SLACK, WIRE_CABLES, MAX_WIRES_PER_PAIR,
} from '../config.js';
import { instanceCells } from './grid.js';
import { FAMILIES, hasPump } from './catalog.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { splitWater, topoOrder } from './water.js';
import { makeString } from './strings.js';
import { createHeap } from './pipes.js';
import { wireGraph, wireSearch, wirePath, drapeRoute, layCable, cablePoints, bundleCables, cableBlocked, conduitClear } from './wires.js';

const POWER_SEED = 0x90e4; // keeps wire rolls apart from other rolls
const MID_SLACK = (WIRE_SLACK[0] + WIRE_SLACK[1]) / 2; // slack used to test a route
const MAX_REACH = Math.max(...Object.values(POWER_RELAYS).map((row) => row[0]), ...Object.values(POWER_SUPPLY).map((row) => row[1])); // longest reach of any node
const SEARCH_MM = (MAX_REACH + POWER_SHORT_REACH) * CELL_MM; // wire searches stop past this length
const REACH_ROUND = 2; // shortfalls round up to half cells
const OFFER_BATCH = 4; // waiting nodes a feeder offers to at a time
const SLACK_TIGHTEN = 4; // halvings of a cable's slack before it is pulled taut
export const POWER_REASONS = ['out of reach', 'no route', 'source empty', 'relay at throughput', 'no free port', 'blocked by module'];

const toQuarters = (units) => Math.round(units * WATER_QUARTERS);
const toUnits = (quarters) => quarters / WATER_QUARTERS;
const roundReach = (cells) => Math.round(cells * 1e6) / 1e6;

// Source, relay or consumer role of one module, or null
export function powerRole(instance, wheels = {}) {
  const family = instance.family;
  if (family === 'turbine') return { kind: 'source', supply: POWER_SUPPLY.turbine[0] + TURBINE_EXTRA_PER_STORY * (instance.h - FAMILIES.turbine.minStories), reach: POWER_SUPPLY.turbine[1] };
  if (family === 'solar') return { kind: 'source', supply: Math.max(POWER_SUPPLY.solar[0], SOLAR_PER_CELL * instanceCells(instance).length), reach: POWER_SUPPLY.solar[1] };
  if (family === 'generator') return { kind: 'source', supply: POWER_SUPPLY.generator[0], reach: POWER_SUPPLY.generator[1] };
  if (family === 'wheel') return { kind: 'source', supply: POWER_SUPPLY.wheel[0], reach: POWER_SUPPLY.wheel[1] };
  if (family === 'wheelup') return { kind: 'source', supply: Math.min(WHEEL_UP_CAP, Math.floor((wheels[instance.id] || 0) * WHEEL_PER_UNIT * 2) / 2), reach: POWER_SUPPLY.wheelup[1] };
  if (POWER_RELAYS[family]) return { kind: 'relay', reach: POWER_RELAYS[family][0], throughput: POWER_RELAYS[family][1] };
  const demand = family === 'plant' ? (hasPump(instance) ? POWER_DEMAND.plantpump : 0) : POWER_DEMAND[family] || 0;
  return demand > 0 ? { kind: 'consumer', demand } : null;
}

// Flow of power over a built network; reach is spent per cell of wire and reset at relays
export function solvePower({ nodes, links }) {
  const order = topoOrder(nodes, links);
  const outOf = new Map(nodes.map((node) => [node.id, links.filter((link) => link.from === node.id)]));
  const want = new Map();
  for (const node of [...order].reverse()) {
    const below = outOf.get(node.id).reduce((sum, link) => sum + want.get(link.to), 0);
    if (node.kind === 'relay') want.set(node.id, Math.min(toQuarters(node.throughput), below));
    else if (node.kind === 'consumer') want.set(node.id, toQuarters(node.demand) + below);
    else want.set(node.id, below);
  }
  const received = new Map(nodes.map((node) => [node.id, 0]));
  const arrivals = new Map(nodes.map((node) => [node.id, []]));
  const state = new Map();
  const linkState = new Map();
  const totals = { supplied: 0, delivered: 0, unused: 0 };
  for (const node of order) {
    const inflow = received.get(node.id);
    const reaches = arrivals.get(node.id).filter((arrival) => arrival.units > 0).map((arrival) => arrival.reach);
    let available = inflow;
    let reach = reaches.length > 0 ? Math.min(...reaches) : 0;
    let capped = false;
    let excess = 0;
    if (node.kind === 'source') {
      available += toQuarters(node.supply);
      totals.supplied += toQuarters(node.supply);
      reach = node.reach;
    } else if (node.kind === 'relay') {
      available = Math.min(inflow, toQuarters(node.throughput));
      excess = inflow - available;
      const below = outOf.get(node.id).reduce((sum, link) => sum + want.get(link.to), 0);
      capped = inflow > 0 && available >= toQuarters(node.throughput) && below > available;
      reach = inflow > 0 ? node.reach : 0;
    }
    const taken = node.kind === 'consumer' ? Math.min(available, toQuarters(node.demand)) : 0;
    available -= taken;
    const runs = [];
    for (const link of outOf.get(node.id)) {
      const left = roundReach(reach - link.length);
      const runnable = available > 0 && left >= 0;
      linkState.set(link.id, { units: 0, reachLeft: left, short: Math.max(0, roundReach(link.length - reach)), runs: runnable });
      if (runnable) runs.push({ link, want: Math.max(0, want.get(link.to) - received.get(link.to)), length: link.length, port: link.port || 0 });
    }
    const given = splitWater(available, runs);
    runs.forEach((run, index) => {
      if (given[index] <= 0) return;
      received.set(run.link.to, received.get(run.link.to) + given[index]);
      arrivals.get(run.link.to).push({ reach: linkState.get(run.link.id).reachLeft, units: given[index] });
      linkState.get(run.link.id).units = given[index];
    });
    const left = available - given.reduce((sum, amount) => sum + amount, 0);
    totals.delivered += taken;
    totals.unused += left + excess;
    state.set(node.id, { received: inflow, taken, reach, capped, unused: left + excess });
  }
  const result = { nodes: {}, links: {}, totals: { supplied: toUnits(totals.supplied), delivered: toUnits(totals.delivered), unused: toUnits(totals.unused) } };
  for (const node of nodes) {
    const entry = state.get(node.id);
    result.nodes[node.id] = { received: toUnits(entry.received), taken: toUnits(entry.taken), demand: node.kind === 'consumer' ? node.demand : 0, reach: entry.reach, capped: entry.capped, unused: toUnits(entry.unused) };
  }
  for (const link of links) {
    const entry = linkState.get(link.id);
    result.links[link.id] = { units: toUnits(entry.units), reachLeft: entry.reachLeft, short: entry.short, runs: entry.runs };
  }
  return result;
}

// Upstream relays of a node that ran at their throughput
function cappedAbove(nodeId, links, solved) {
  const seen = new Set();
  const queue = [nodeId];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const link of links) {
      if (link.to !== at || seen.has(link.from)) continue;
      seen.add(link.from);
      if (solved.nodes[link.from].capped) return true;
      queue.push(link.from);
    }
  }
  return false;
}

// Status of a consumer and the reason it is short
export function powerStatus(node, solved, links, fail) {
  const entry = solved.nodes[node.id];
  const status = entry.taken >= entry.demand ? 'full' : entry.taken > 0 ? 'partial' : 'dry';
  const into = links.filter((link) => link.to === node.id);
  const arrived = into.filter((link) => solved.links[link.id].units > 0).map((link) => solved.links[link.id].reachLeft);
  const report = { received: entry.taken, demand: entry.demand, reachLeft: arrived.length > 0 ? Math.max(...arrived) : null, status, reason: null, short: 0 };
  if (status === 'full') return report;
  const stuck = into.filter((link) => !solved.links[link.id].runs && solved.links[link.id].short > 0);
  if (into.length === 0) Object.assign(report, fail || { reason: 'no route' });
  else if (stuck.length > 0) Object.assign(report, { reason: 'out of reach', short: Math.ceil(Math.min(...stuck.map((link) => solved.links[link.id].short)) * REACH_ROUND) / REACH_ROUND });
  else report.reason = cappedAbove(node.id, links, solved) ? 'relay at throughput' : 'source empty';
  return report;
}

// Stable key of a module from where it stands, not its id
const placeKey = (instance) => `${instance.family}:${instance.x},${instance.y},${instance.z}:${instance.rot}`;

// Power network of a structure: a seeded branching tree of wires, flows and diagnostics
export function planPower(modules, seedText, { ports, context, wheels = {}, pairCap = MAX_WIRES_PER_PAIR, shared = {} }) {
  const seed = mixSeed(hashString(String(seedText)), POWER_SEED);
  const localRng = (key) => makeRng(mixSeed(seed, hashString(key)));
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const live = ports.filter((port) => port.active && port.type === 'power').map((port) => ({ ...port, left: port.capacity }));
  if (!shared.graph) shared.graph = wireGraph(modules, live, context);
  const graph = shared.graph;
  live.forEach((port, index) => {
    port.node = graph.portNodes[index];
  });
  // One node per module with a role; junction boxes are relays of their own
  const nodes = [];
  for (const instance of modules) {
    const own = live.filter((port) => port.module === instance.id);
    const role = powerRole(instance, wheels);
    const box = own.filter((port) => port.relay);
    if (box.length > 0) nodes.push({ id: `${instance.id}:box`, module: instance.id, kind: 'relay', reach: POWER_RELAYS.junction[0], throughput: POWER_RELAYS.junction[1], ports: box, key: placeKey(instance) + ':box' });
    if (role) nodes.push({ id: String(instance.id), module: instance.id, ...role, ports: own.filter((port) => !port.relay), key: placeKey(instance) });
  }
  nodes.sort((first, second) => (first.key < second.key ? -1 : first.key > second.key ? 1 : 0));
  for (const node of nodes) {
    const instance = byId.get(node.module);
    const rng = localRng(node.key);
    node.level = instance.z + instance.h;
    node.fanout = node.kind === 'consumer' ? rng.int(POWER_CHILD_FANOUT[0], POWER_CHILD_FANOUT[1]) : rng.int(POWER_FANOUT[0], POWER_FANOUT[1]);
    node.rejoin = rng.chance(REJOIN_CHANCE);
    node.in = [];
    node.out = [];
    node.connected = false;
    node.fails = new Set();
  }
  const searches = new Map();
  // Route search from a node's free ports, grown only when a longer reach is asked for
  const searchOf = (node, reach) => {
    const free = node.ports.filter((port) => port.left > 0 && port.node !== null);
    const key = node.id + ':' + free.map((port) => port.index).join(',');
    const bound = Math.min(SEARCH_MM, Math.ceil(reach) * CELL_MM);
    const known = searches.get(key);
    if (known && known.bound >= bound) return known;
    const fresh = { free, bound, search: free.length > 0 ? wireSearch(graph, context, free.map((port) => port.node), bound) : null };
    searches.set(key, fresh);
    return fresh;
  };
  const jitter = (from, to) => localRng(from.key + '>' + to.key).range(0, POWER_JITTER);
  const lowerBound = (from, to) => {
    let best = Infinity;
    for (const first of from.ports) for (const second of to.ports) best = Math.min(best, Math.hypot(...[0, 1, 2].map((axis) => first.position[axis] - second.position[axis])));
    return best / CELL_MM;
  };
  // Shortest clear route from a feeder's free ports to a node's, within a reach; one search per feeder serves every child
  function bestRoute(from, to, reach) {
    const { free: fromPorts, search } = searchOf(from, reach);
    const free = to.ports.filter((port) => port.left > 0);
    if (from.ports.every((port) => port.left <= 0) || free.length === 0) return { fail: 'no free port' };
    const options = [];
    for (const end of free) {
      if (search && end.node !== null && search.reached(end.node)) options.push({ kind: 'graph', toPort: end, length: search.dist(end.node) });
      for (const port of from.ports.filter((entry) => entry.left > 0)) options.push({ kind: 'drape', fromPort: port, toPort: end, length: drapeRoute(port, end).length });
    }
    options.sort((first, second) => first.length - second.length || first.toPort.index - second.toPort.index || (first.kind < second.kind ? -1 : 1) || (first.fromPort ? first.fromPort.index : 0) - (second.fromPort ? second.fromPort.index : 0));
    let blocked = null;
    for (const option of options) {
      const cells = option.length / CELL_MM;
      if (cells > reach + 1e-9) break;
      let route;
      let fromPort = option.fromPort;
      if (option.kind === 'graph') {
        // The search runs out from the feeder, so the path comes back from the child
        const path = wirePath(graph, search, option.toPort.node);
        fromPort = live[path.end];
        if (!fromPorts.includes(fromPort)) continue;
        const pieces = [...path.pieces].reverse().map((piece) => ({ ...piece, points: [...piece.points].reverse() }));
        route = { pieces, length: path.length };
      } else route = drapeRoute(fromPort, option.toPort);
      // A route counts when the cable pulled taut is clear; slack is fitted later
      const hit = cableBlocked(context, layCable(route, 0), [from.module, to.module]);
      if (hit) {
        blocked = blocked || { route, fromPort, toPort: option.toPort, hit };
        continue;
      }
      return { route, fromPort, toPort: option.toPort, cells: route.length / CELL_MM };
    }
    const beyond = options.some((option) => option.length / CELL_MM > reach + 1e-9);
    return { fail: beyond ? 'out of reach' : blocked ? 'blocked by module' : 'no route', blocked };
  }
  const chainOf = (node) => {
    if (node.in.length !== 1 || node.out.length !== 1) return 0;
    return 1 + chainOf(nodes.find((other) => other.id === node.in[0].from));
  };
  const pools = new Map();
  const canFeed = (node) => node.connected && node.out.length < node.fanout && node.reachLeft > 0 && node.ports.some((port) => port.left > 0) && pools.get(node.id).every((pool) => pool.spare > 0);
  // A first child on a one-in node must not stretch a chain past the limit
  const chainOk = (from) => from.out.length > 0 || from.in.length !== 1 || 1 + chainOf(nodes.find((other) => other.id === from.in[0].from)) <= MAX_CHAIN_LINKS;
  const links = [];
  const heap = createHeap();
  const entries = [];
  const push = (cost, entry) => {
    entries.push(entry);
    heap.push(cost, entries.length - 1);
  };
  // A feeder offers to its nearest waiting nodes a few at a time, more when those are spent
  const offer = (from) => {
    if (!canFeed(from)) return;
    if (!from.queue) {
      from.queue = nodes.filter((to) => to.kind !== 'source' && to !== from && !to.connected).map((to) => ({ to, bound: lowerBound(from, to) })).filter(({ to, bound }) => {
        if (bound <= from.reachLeft + 1e-9) return true;
        to.fails.add('out of reach');
        return false;
      }).sort((first, second) => first.bound - second.bound || (first.to.key < second.to.key ? -1 : 1));
      from.pending = 0;
    }
    while (from.pending < OFFER_BATCH && from.queue.length > 0) {
      const { to, bound } = from.queue.shift();
      if (to.connected) continue;
      from.pending++;
      push(bound + jitter(from, to), { from, to, exact: null });
    }
  };
  const settle = (from) => {
    from.pending--;
    if (from.pending <= 0) offer(from);
  };
  function connect(from, to, found) {
    found.fromPort.left--;
    found.toPort.left--;
    const link = { id: links.length, from: from.id, to: to.id, length: roundReach(found.cells), port: found.toPort.module * 1000 + found.toPort.index, fromPort: found.fromPort, toPort: found.toPort, route: found.route };
    links.push(link);
    from.out.push(link);
    to.in.push(link);
    if (to.connected) return;
    to.connected = true;
    to.reachLeft = to.kind === 'relay' ? to.reach : roundReach(from.reachLeft - found.cells);
    const above = pools.get(from.id);
    pools.set(to.id, to.kind === 'relay' ? [...above, { spare: to.throughput }] : above);
    if (to.kind === 'consumer') for (const pool of above) pool.spare -= to.demand / POWER_OVERBOOK;
    offer(to);
  }
  for (const node of nodes) {
    if (node.kind !== 'source') continue;
    node.connected = true;
    node.reachLeft = node.reach;
    pools.set(node.id, [{ spare: node.supply }]);
  }
  for (const node of nodes) if (node.kind === 'relay') node.throughput = node.throughput || 0;
  for (const node of nodes) if (node.kind === 'source') offer(node);
  // Cheapest link first; routes are found when an entry first comes up
  while (heap.size > 0) {
    const [, index] = heap.pop();
    const entry = entries[index];
    const { from, to } = entry;
    if (to.connected || !canFeed(from)) {
      // A feeder out of supply, or out of children and ports
      if (!to.connected) to.fails.add(pools.get(from.id).every((pool) => pool.spare > 0) ? 'no free port' : 'source empty');
      settle(from);
      continue;
    }
    if (!chainOk(from)) {
      to.fails.add('no free port');
      settle(from);
      continue;
    }
    const stale = entry.exact && (entry.exact.fromPort.left <= 0 || entry.exact.toPort.left <= 0);
    if (!entry.exact || stale) {
      const found = bestRoute(from, to, from.reachLeft);
      if (found.fail) {
        to.fails.add(found.fail);
        if (found.fail === 'blocked by module' && !to.blocked) to.blocked = found.blocked;
        settle(from);
        continue;
      }
      push(found.cells + jitter(from, to), { from, to, exact: found });
      continue;
    }
    connect(from, to, entry.exact);
    settle(from);
  }
  // A few branch ends rejoin a relay higher up
  const downstream = (from, to) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift();
      if (at === to) return true;
      for (const link of links) if (link.from === at && !seen.has(link.to)) seen.add(link.to) && queue.push(link.to);
    }
    return false;
  };
  for (const leaf of nodes) {
    if (!leaf.connected || leaf.kind !== 'consumer' || leaf.out.length > 0 || !leaf.rejoin || leaf.reachLeft <= 0 || !chainOk(leaf)) continue;
    let best = null;
    for (const relay of nodes) {
      if (relay.kind !== 'relay' || !relay.connected || relay.level <= leaf.level || downstream(relay.id, leaf.id)) continue;
      if (lowerBound(leaf, relay) > leaf.reachLeft) continue;
      const found = bestRoute(leaf, relay, leaf.reachLeft);
      if (!found.fail && (!best || found.cells < best.found.cells)) best = { relay, found };
    }
    if (best) connect(leaf, best.relay, best.found);
  }
  const solved = solvePower({ nodes, links });
  // Why a node with no wire got none: one search from every feeder, started at what each has left to spend
  const feeders = nodes.filter((node) => node.connected && node.reachLeft > 0);
  const spend = Math.max(0, ...feeders.map((node) => node.reachLeft)) * CELL_MM;
  const feederPorts = feeders.flatMap((node) => node.ports.filter((port) => port.node !== null).map((port) => ({ port, offset: spend - node.reachLeft * CELL_MM })));
  const reachSearch = feederPorts.length > 0 ? wireSearch(graph, context, feederPorts.map(({ port }) => port.node), spend + POWER_SHORT_REACH * CELL_MM, feederPorts.map(({ offset }) => offset)) : null;
  const shortOf = (node) => {
    let best = Infinity;
    for (const port of node.ports) if (reachSearch && port.node !== null && reachSearch.reached(port.node)) best = Math.min(best, (reachSearch.dist(port.node) - spend) / CELL_MM);
    // Straight drapes count only when they hang clear
    const drapes = [];
    for (const from of feeders) for (const first of from.ports) for (const second of node.ports) drapes.push({ from, route: drapeRoute(first, second) });
    drapes.sort((first, second) => first.route.length / CELL_MM - first.from.reachLeft - (second.route.length / CELL_MM - second.from.reachLeft));
    for (const { from, route } of drapes) {
      const short = route.length / CELL_MM - from.reachLeft;
      if (short >= best) break;
      if (!cableBlocked(context, layCable(route, 0), [from.module, node.module])) best = short;
    }
    return best;
  };
  const report = {};
  for (const node of nodes) {
    if (node.kind === 'source') continue;
    let fail = null;
    if (node.in.length === 0) {
      const short = node.ports.length > 0 ? shortOf(node) : Infinity;
      if (node.ports.length === 0) fail = { reason: 'no free port' };
      else if (short > 1e-9 && short <= POWER_SHORT_REACH) fail = { reason: 'out of reach', short: Math.ceil(short * REACH_ROUND) / REACH_ROUND };
      else if (short > POWER_SHORT_REACH) fail = { reason: feeders.length > 0 ? 'out of reach' : 'no route', short: feeders.length > 0 ? null : 0 };
      else if (node.fails.has('blocked by module')) fail = { reason: 'blocked by module' };
      else if (node.fails.has('source empty') || !node.fails.has('no free port')) fail = { reason: 'source empty' };
      else fail = { reason: 'no free port' };
    }
    if (node.kind === 'consumer') report[node.module] = powerStatus(node, solved, links, fail);
    else report[node.id] = { relay: true, fed: solved.nodes[node.id].received > 0, received: solved.nodes[node.id].received, capped: solved.nodes[node.id].capped, reason: node.in.length === 0 ? fail && fail.reason : null };
  }
  // Cables: one or two per link, each with its own slack, kept under the pair cap
  const cables = [];
  const perPair = new Map();
  const pairOf = (link) => [link.fromPort.module + ':' + link.fromPort.index, link.toPort.module + ':' + link.toPort.index].sort().join('|');
  for (const link of links) {
    const rng = localRng(nodes.find((node) => node.id === link.from).key + '~' + nodes.find((node) => node.id === link.to).key);
    const count = rng.int(WIRE_CABLES[0], WIRE_CABLES[1]);
    for (let cable = 0; cable < count; cable++) {
      if ((perPair.get(pairOf(link)) || 0) >= pairCap) break;
      const ends = [link.fromPort.module, link.toPort.module];
      // Seeded slack, pulled tighter in halves until the cable hangs clear
      let slack = rng.range(WIRE_SLACK[0], WIRE_SLACK[1]);
      let laid = layCable(link.route, slack);
      for (let tighten = 0; tighten < SLACK_TIGHTEN && cableBlocked(context, laid, ends); tighten++) {
        slack = tighten === SLACK_TIGHTEN - 1 ? 0 : slack / 2;
        laid = layCable(link.route, slack);
      }
      if (cableBlocked(context, laid, ends)) continue;
      perPair.set(pairOf(link), (perPair.get(pairOf(link)) || 0) + 1);
      cables.push({ link, laid });
    }
  }
  // Shared conduit runs become bundles; a shifted cable that hits something goes back
  const unshifted = cables.map((cable) => cable.laid.pieces.map((piece) => piece.points.map((point) => [...point])));
  bundleCables(cables, ([first, second]) => conduitClear(context, graph.solids, first, second).ok);
  cables.forEach((cable, index) => {
    const offWall = cable.laid.pieces.some((piece) => piece.kind === 'run' && !conduitClear(context, graph.solids, piece.points[0], piece.points[1]).ok);
    if (offWall || cableBlocked(context, cable.laid, [cable.link.fromPort.module, cable.link.toPort.module])) cable.laid.pieces.forEach((piece, at) => (piece.points = unshifted[index][at]));
  });
  const strings = cables.map(({ link, laid }) => {
    const { points, spans } = cablePoints(laid);
    const pieces = laid.pieces.map(({ kind, points: piecePoints, cable }) => ({ kind, points: piecePoints, cable }));
    return makeString('wire', link.fromPort, link.toPort, points, { spans, link: link.id, slack: laid.slack, total: laid.total, pieces, conduit: pieces.some((piece) => piece.kind === 'run') });
  });
  const blocked = nodes.filter((node) => node.in.length === 0 && node.blocked).map((node) => ({ ...makeString('wire', node.blocked.fromPort, node.blocked.toPort, cablePoints(layCable(node.blocked.route, MID_SLACK)).points), blocked: node.blocked.hit }));
  const powered = [...new Set(nodes.filter((node) => (node.kind === 'source' && node.supply > 0) || (node.kind === 'relay' && solved.nodes[node.id].received > 0) || (node.kind === 'consumer' && report[node.module].status === 'full')).map((node) => node.module))].sort((first, second) => first - second);
  return {
    nodes: nodes.map(({ id, module, kind, supply, demand, reach, throughput, level }) => ({ id, module, kind, supply: supply || 0, demand: demand || 0, reach: reach || 0, throughput: throughput || 0, level })),
    links: links.map(({ id, from, to, length, port, fromPort, toPort }) => ({ id, from, to, length, port, fromPort: { module: fromPort.module, index: fromPort.index }, toPort: { module: toPort.module, index: toPort.index } })),
    solved,
    consumers: report,
    cables: strings,
    powered,
    blocked,
  };
}
