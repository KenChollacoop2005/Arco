import {
  CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS, WATER_QUARTERS, WATER_STEP, GRAVITY_HEAD, HEAD_PER_CELL, HEAD_PER_STORY_UP,
  WATER_SOURCES, SOURCE_FAMILIES, PUMP_KINDS, DEMAND_PER_CELL, DEMAND_PER_MODULE, HUB_INPUTS, BASIN_INPUTS, PIPE_MAX_MM, MAX_PIPES_PER_PAIR, TRICKLE_ON,
} from '../config.js';
import { SIDES, instanceCells, worldFromModules, columnTop, moduleAt } from './grid.js';
import { FAMILIES, hasPump } from './catalog.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { structureMounts } from './mounts.js';
import { stringContext, pathBlocked, pathLength } from './strings.js';
import { pipeGraph, pipeSearch, pipePath, pathHead, graphParts } from './pipes.js';

const WATER_SEED = 0x7a7e5; // keeps network rolls apart from other rolls
const STEP = WATER_STEP * WATER_QUARTERS; // split step in quarters
const SPILL_LIP_MM = 1; // overflow leaves this far past the wall
const SPILL_ROOT_MM = 3; // spout starts this far inside the cell edge
const SPILL_LIFT_MM = 0.5; // overflow starts this far above the roof
const SPILL_CLEAR_MM = 1; // sheet collision test stops this far above the landing
const SPLIT_ROUNDS_MAX = 1000; // safety cap on split rounds
const SEARCH_SLACK = 1e-6; // head slack when a search stops early
const SHORT_REACH = 4; // shortfalls past this much head are reported without a number
export const WATER_REASONS = ['out of head', 'no route', 'no wall route', 'source empty', 'no free port'];
export const NO_FALL = 'no clear fall'; // overflow with no straight drop beside it
const UNPOWERED_TANKS = ['pumptank']; // pumped tanks that drain by gravity when off
const WHEEL_JUNCTIONS = ['wheelup']; // families water passes through to turn a wheel

const toQuarters = (units) => Math.round(units * WATER_QUARTERS);
const toUnits = (quarters) => quarters / WATER_QUARTERS;

// Head a link costs: level cells, plus rise; falling is free
export const linkCost = (link) => link.flat * HEAD_PER_CELL + Math.max(0, link.up) * HEAD_PER_STORY_UP;

// Head left after a link, and the shortfall when it cannot run
export function linkHead(head, gravity, link) {
  const cost = linkCost(link);
  // Gravity water climbs nothing
  if (gravity && link.up > 0) return { left: -1, short: Math.max(0, link.flat * HEAD_PER_CELL - head) + link.up * HEAD_PER_STORY_UP };
  return { left: head - cost, short: Math.max(0, cost - head) };
}

// Even split in steps, capped by each branch's want; leftover steps go shortest first
export function splitWater(available, branches) {
  const given = branches.map(() => 0);
  let left = available;
  const order = branches.map((branch, index) => index).sort((first, second) => branches[first].length - branches[second].length || branches[first].port - branches[second].port);
  const room = (index) => branches[index].want - given[index];
  for (let guard = 0; guard < SPLIT_ROUNDS_MAX && left > 0; guard++) {
    const active = order.filter((index) => room(index) > 0);
    if (active.length === 0) break;
    const share = Math.floor(left / active.length / STEP) * STEP;
    if (share > 0) {
      for (const index of active) {
        const amount = Math.min(share, room(index));
        given[index] += amount;
        left -= amount;
      }
      continue;
    }
    // Fewer steps than branches: one step each, shortest first
    for (const index of active) {
      const amount = Math.min(STEP, room(index), left);
      given[index] += amount;
      left -= amount;
      if (left <= 0) break;
    }
  }
  return given;
}

// Nodes in an order where every link runs forward
export function topoOrder(nodes, links) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const link of links) incoming.set(link.to, incoming.get(link.to) + 1);
  const ready = nodes.filter((node) => incoming.get(node.id) === 0);
  const order = [];
  while (ready.length > 0) {
    const node = ready.shift();
    order.push(node);
    for (const link of links) {
      if (link.from !== node.id) continue;
      incoming.set(link.to, incoming.get(link.to) - 1);
      if (incoming.get(link.to) === 0) ready.push(nodes.find((entry) => entry.id === link.to));
    }
  }
  if (order.length !== nodes.length) throw new Error('water links form a loop');
  return order;
}

// A pump without full power passes water as a plain junction
const asJunction = (node) => (node.kind === 'pump' && node.powered === false ? { ...node, kind: 'junction', supply: 0, head: null, throughput: null, off: true } : node);

// Flow over a built network; nodes and links as plain data, units as numbers
export function solveWater({ nodes: given, links }) {
  const nodes = given.map(asJunction);
  const order = topoOrder(nodes, links);
  const outOf = new Map(nodes.map((node) => [node.id, links.filter((link) => link.from === node.id)]));
  const supply = new Map(nodes.map((node) => [node.id, toQuarters(node.supply || 0)]));
  const demand = new Map(nodes.map((node) => [node.id, toQuarters(node.demand || 0)]));
  // Want: what a node can use from upstream, deepest first
  const want = new Map();
  for (const node of [...order].reverse()) {
    const below = outOf.get(node.id).reduce((sum, link) => sum + want.get(link.to), 0);
    if (node.kind === 'pump') want.set(node.id, Math.max(0, Math.min(toQuarters(node.throughput), below) - supply.get(node.id)));
    else if (node.kind === 'consumer') want.set(node.id, demand.get(node.id) + below);
    else want.set(node.id, Math.max(0, below - supply.get(node.id)));
  }
  const received = new Map(nodes.map((node) => [node.id, 0]));
  const arrivals = new Map(nodes.map((node) => [node.id, []]));
  const state = new Map();
  const linkState = new Map();
  for (const node of order) {
    const inflow = received.get(node.id);
    const own = outOf.get(node.id).length > 0 || node.kind === 'consumer' ? supply.get(node.id) : 0;
    let available = inflow + own;
    let spill = 0;
    if (node.kind === 'pump') {
      const capped = Math.min(available, toQuarters(node.throughput));
      spill = available - capped;
      available = capped;
    }
    // Head: a pump resets it, a merge keeps the lowest
    const flows = arrivals.get(node.id).filter((arrival) => arrival.units > 0);
    if (own > 0 && node.kind !== 'pump') flows.push({ head: node.head === null || node.head === undefined ? GRAVITY_HEAD : node.head, gravity: node.head === null || node.head === undefined, units: own });
    let head = 0;
    let gravity = true;
    if (node.kind === 'pump') {
      head = available > 0 ? node.head : 0;
      gravity = false;
    } else if (flows.length > 0) {
      head = Math.min(...flows.map((flow) => flow.head));
      gravity = flows.some((flow) => flow.head === head && flow.gravity);
    }
    const taken = node.kind === 'consumer' ? Math.min(available, demand.get(node.id)) : 0;
    available -= taken;
    // Branches that can run on this head share the rest
    const runs = [];
    for (const link of outOf.get(node.id)) {
      const after = linkHead(head, gravity, link);
      const runnable = available > 0 && after.left >= 0;
      linkState.set(link.id, { units: 0, headLeft: after.left, short: after.short, runs: runnable });
      if (runnable) runs.push({ link, want: Math.max(0, want.get(link.to) - received.get(link.to)), length: link.length || 0, port: link.port || 0 });
    }
    const given = splitWater(available, runs);
    runs.forEach((run, index) => {
      if (given[index] <= 0) return;
      received.set(run.link.to, received.get(run.link.to) + given[index]);
      arrivals.get(run.link.to).push({ head: linkState.get(run.link.id).headLeft, gravity, units: given[index] });
      linkState.get(run.link.id).units = given[index];
    });
    const left = available - given.reduce((sum, amount) => sum + amount, 0);
    const unusedOwn = outOf.get(node.id).length > 0 || node.kind === 'consumer' ? 0 : supply.get(node.id);
    state.set(node.id, { received: inflow, taken, head, gravity, overflow: left + spill, unused: unusedOwn });
  }
  // Trickle: surplus falls to the nearest lower basin, top down
  const sheets = [];
  const byLevel = [...nodes].sort((first, second) => (second.level || 0) - (first.level || 0) || String(first.id).localeCompare(String(second.id)));
  let ground = 0;
  for (const node of byLevel) {
    const entry = state.get(node.id);
    if (entry.overflow <= 0) continue;
    const target = (node.spill || [])[0] || null;
    const receiver = target && target.node !== null ? state.get(target.node) : null;
    sheets.push({ from: node.id, to: receiver ? target.node : null, units: toUnits(entry.overflow), points: target ? target.points : null, reason: target ? null : NO_FALL });
    if (!receiver) {
      ground += entry.overflow;
      entry.spilled = entry.overflow;
      continue;
    }
    const room = Math.max(0, demand.get(target.node) - receiver.taken);
    const kept = Math.min(room, entry.overflow);
    receiver.taken += kept;
    receiver.trickled = (receiver.trickled || 0) + kept;
    receiver.overflow += entry.overflow - kept;
  }
  // Results in units
  const result = { nodes: {}, links: {}, sheets, totals: { supplied: 0, delivered: 0, overflow: toUnits(ground), unused: 0 } };
  for (const node of nodes) {
    const entry = state.get(node.id);
    result.totals.supplied += toUnits(supply.get(node.id));
    result.totals.delivered += toUnits(entry.taken);
    result.totals.unused += toUnits(entry.unused);
    result.nodes[node.id] = { received: toUnits(entry.received), taken: toUnits(entry.taken), head: entry.head, gravity: entry.gravity, overflow: toUnits(entry.overflow), trickled: toUnits(entry.trickled || 0), demand: toUnits(demand.get(node.id)) };
    if (given.find((entry) => entry.id === node.id).kind === 'pump') result.nodes[node.id].runs = !node.off;
  }
  for (const link of links) {
    const entry = linkState.get(link.id) || { units: 0, headLeft: -1, short: linkCost(link), runs: false };
    result.links[link.id] = { units: toUnits(entry.units), headLeft: entry.headLeft, short: entry.short, runs: entry.runs };
  }
  return result;
}

// Consumer status and the reason it is short
export function consumerStatus(node, solved, inLinks, noLink) {
  const entry = solved.nodes[node.id];
  const status = entry.taken >= entry.demand ? 'full' : entry.taken > 0 ? 'partial' : 'dry';
  const arrived = inLinks.filter((link) => solved.links[link.id].units > 0).map((link) => solved.links[link.id].headLeft);
  const report = { received: entry.taken, demand: entry.demand, headLeft: arrived.length > 0 ? Math.max(...arrived) : null, status, reason: null, short: 0 };
  if (status === 'full') return report;
  const stuck = inLinks.filter((link) => !solved.links[link.id].runs && solved.links[link.id].short > 0);
  if (inLinks.length === 0) Object.assign(report, noLink || { reason: 'no route' });
  else if (stuck.length > 0) Object.assign(report, { reason: 'out of head', short: Math.min(...stuck.map((link) => solved.links[link.id].short)) });
  else report.reason = 'source empty';
  return report;
}

// Source, pump, main and consumer roles of one module
function rolesOf(instance, roofOpen, powered, extra = {}) {
  const roles = [];
  const pump = hasPump(instance) ? PUMP_KINDS[instance.family] : null;
  const live = !powered || powered.has(instance.id);
  if (pump && !live && UNPOWERED_TANKS.includes(instance.family)) {
    // An unpowered pumped tank still drains its own water by gravity
    roles.push({ kind: 'source', supply: WATER_SOURCES[pump][0], head: null, row: pump, pumpOff: true });
  } else if (pump && !live) {
    roles.push({ kind: 'main', supply: 0, head: null, row: pump, pumpOff: true });
  } else if (pump) {
    const [own, head, throughput] = WATER_SOURCES[pump];
    roles.push({ kind: 'pump', supply: own, head, throughput, row: pump });
  } else if (SOURCE_FAMILIES[instance.family]) {
    roles.push({ kind: 'source', supply: WATER_SOURCES[SOURCE_FAMILIES[instance.family]][0], head: null, row: SOURCE_FAMILIES[instance.family] });
  }
  if (instance.family === 'watermain') roles.push({ kind: 'main', supply: 0, head: null });
  // A raised wheel passes water on; what passes by gravity turns it
  if (WHEEL_JUNCTIONS.includes(instance.family)) roles.push({ kind: 'main', supply: 0, head: null, wheel: true });
  const cells = instanceCells(instance).length;
  const demand = (DEMAND_PER_CELL[instance.family] || 0) * cells + (DEMAND_PER_MODULE[instance.family] || 0) + (extra[instance.id] || 0);
  if (demand > 0) roles.push({ kind: 'consumer', supply: 0, head: null, demand });
  // A flat roof with nothing on it sheds rain from its gutter
  if (roofOpen && FAMILIES[instance.family].stack && roles.every((role) => role.kind === 'consumer')) roles.push({ kind: 'source', supply: WATER_SOURCES.roof[0], head: null, row: 'roof', roof: true });
  return roles;
}

// Where a node's surplus lands: the shortest fall beside it
function spillOf(world, node, instances, consumerAt, context) {
  const own = new Set(instances.flatMap(instanceCells).map(([cellX, cellY]) => cellX + ',' + cellY));
  const level = node.level;
  let best = null;
  for (const [cellX, cellY] of instances.flatMap(instanceCells)) {
    for (const [stepX, stepY] of SIDES) {
      const nextX = cellX + stepX;
      const nextY = cellY + stepY;
      if (own.has(nextX + ',' + nextY)) continue;
      const landing = columnTop(world, nextX, nextY, level - 1);
      if (landing >= level) continue;
      const below = landing > 0 ? moduleAt(world, nextX, nextY, landing - 1) : null;
      const target = below ? consumerAt.get(below.id) || null : null;
      // Short level spout over the edge, then a straight drop
      const edgeAt = (reach) => [(cellX + 0.5 + stepX * 0.5) * CELL_MM + stepX * reach, (cellY + 0.5 + stepY * 0.5) * CELL_MM + stepY * reach, level * STORY_MM + SPILL_LIFT_MM];
      const root = edgeAt(-SPILL_ROOT_MM);
      const lip = edgeAt(SPILL_LIP_MM);
      // Water past the rim would fall off the plinth, not onto it
      if (Math.hypot(lip[0], lip[1]) > (PLINTH_DIAMETER_CELLS * CELL_MM) / 2) continue;
      const option = { node: target, landing, points: [root, lip, [lip[0], lip[1], landing * STORY_MM]], key: (target ? 0 : 1) * 1000 - landing };
      // A sheet may not start in or fall through a module
      if (best && option.key >= best.key) continue;
      if (pathBlocked(context, [root, lip, [lip[0], lip[1], landing * STORY_MM + SPILL_CLEAR_MM]], node.members)) continue;
      best = option;
    }
  }
  return best ? [best] : [];
}

// Water network of a structure: nodes, pipes, flows and diagnostics, seeded
export function planWater(modules, seedText, { ports = structureMounts(modules), context = stringContext(modules), powered = null, shared = {}, extra = {} } = {}) {
  const world = worldFromModules(modules);
  const rng = makeRng(mixSeed(hashString(String(seedText)), WATER_SEED));
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const portsOf = new Map();
  for (const port of ports) {
    if (!port.active || !port.type.startsWith('water')) continue;
    if (!portsOf.has(port.module)) portsOf.set(port.module, []);
    portsOf.get(port.module).push({ ...port, left: port.capacity });
  }
  // Main columns are one hub
  const mainOf = new Map();
  for (const instance of [...modules].sort((first, second) => first.z - second.z)) {
    if (instance.family !== 'watermain') continue;
    const under = instance.z > 0 ? moduleAt(world, instance.x, instance.y, instance.z - 1) : null;
    mainOf.set(instance.id, under && mainOf.has(under.id) ? mainOf.get(under.id) : instance.id);
  }
  const waterPorts = [...portsOf.values()].flat();
  // The surface graph depends only on the ports, so runs share it
  if (!shared.graph) shared.graph = pipeGraph(modules, waterPorts, context);
  const graph = shared.graph;
  waterPorts.forEach((port, index) => {
    port.node = graph.portNodes[index];
  });
  if (!shared.parts) shared.parts = graphParts(graph);
  const parts = shared.parts;
  const nodes = [];
  const consumerAt = new Map();
  for (const instance of modules) {
    if (mainOf.has(instance.id) && mainOf.get(instance.id) !== instance.id) continue;
    const members = mainOf.has(instance.id) ? modules.filter((other) => mainOf.get(other.id) === instance.id) : [instance];
    const roofOpen = instanceCells(instance).every(([cellX, cellY]) => !moduleAt(world, cellX, cellY, instance.z + instance.h));
    const level = Math.max(...members.map((member) => member.z + member.h));
    for (const role of rolesOf(instance, roofOpen, powered, extra)) {
      const own = members.flatMap((member) => portsOf.get(member.id) || []);
      const gutter = role.roof ? own.filter((port) => port.type === 'water-out' && port.roof) : own.filter((port) => !port.roof);
      const node = { id: role.roof ? `${instance.id}:roof` : String(instance.id), module: instance.id, members: members.map((member) => member.id), level, ...role, ins: gutter.filter((port) => port.type === 'water-in'), outs: gutter.filter((port) => port.type === 'water-out') };
      if (role.roof && node.outs.length === 0) continue;
      nodes.push(node);
      if (role.kind === 'consumer') consumerAt.set(instance.id, node.id);
    }
  }
  // Trickle off: surplus stays unused, nothing falls
  for (const node of nodes) node.spill = !TRICKLE_ON ? [] : spillOf(world, node, node.members.map((id) => byId.get(id)), consumerAt, context);
  // Estimated water and head at each node while building
  const estimate = new Map(nodes.map((node) => [node.id, { units: node.kind === 'source' ? node.supply : node.kind === 'pump' ? node.supply : 0, head: node.kind === 'pump' ? node.head : GRAVITY_HEAD, gravity: node.kind !== 'pump', used: 0, entry: null }]));
  const links = [];
  const downstream = (from, to) => {
    const seen = new Set([to]);
    const queue = [to];
    while (queue.length > 0) {
      const at = queue.shift();
      if (at === from) return true;
      for (const link of links) if (link.from === at && !seen.has(link.to)) seen.add(link.to) && queue.push(link.to);
    }
    return false;
  };
  const spare = (node) => {
    const entry = estimate.get(node.id);
    const kept = node.kind === 'consumer' ? node.demand : 0;
    return entry.units - entry.used - kept;
  };
  // Rise inside a main column from where water enters to the outlet
  const mainRise = (from, out) => {
    const entry = estimate.get(from.id).entry;
    return from.kind === 'main' && entry ? Math.max(0, out.position[2] - entry.position[2]) / STORY_MM : 0;
  };
  // Cheapest pipe along the walls from any upstream node into this one, or why none
  function bestLink(node, need) {
    const tried = { head: Infinity, port: false, empty: false };
    const inlets = node.ins.filter((inlet) => inlet.left > 0 && inlet.node !== null);
    if (inlets.length === 0 && node.ins.length > 0) tried.port = true;
    const candidates = [];
    for (const from of nodes) {
      if (from === node || !['source', 'pump', 'main', 'consumer'].includes(from.kind) || from.outs.length === 0) continue;
      if (spare(from) <= 0) {
        tried.empty = true;
        continue;
      }
      if (downstream(from.id, node.id)) continue;
      for (const out of from.outs) {
        // Pair cap, kept per outlet and consumer so a search needs no per pair targets
        if (links.filter((link) => link.to === node.id && link.fromPort.module === out.module && link.fromPort.index === out.index).length >= MAX_PIPES_PER_PAIR) continue;
        if (out.left <= 0 || out.node === null) {
          tried.port = true;
          continue;
        }
        if (inlets.some((inlet) => Math.hypot(...[0, 1, 2].map((axis) => inlet.position[axis] - out.position[axis])) <= PIPE_MAX_MM)) candidates.push({ from, out });
      }
    }
    if (inlets.length === 0 || candidates.length === 0) return { fail: { reason: tried.port ? 'no free port' : tried.empty ? 'source empty' : 'no route' } };
    // One search per head kind, stopped past the most head on offer
    const targets = inlets.map((inlet) => inlet.node);
    const searches = {};
    const searchFor = (gravity, bound) => {
      const key = gravity + ':' + bound;
      if (!searches[key]) searches[key] = pipeSearch(graph, targets, gravity, bound);
      return searches[key];
    };
    const bound = (gravity) => Math.max(...candidates.filter(({ from }) => estimate.get(from.id).gravity === gravity).map(({ from, out }) => estimate.get(from.id).head - mainRise(from, out) * HEAD_PER_STORY_UP)) + SEARCH_SLACK;
    const options = [];
    for (const { from, out } of candidates) {
      const fromState = estimate.get(from.id);
      const search = searchFor(fromState.gravity, bound(fromState.gravity));
      if (!search.reached(out.node)) continue;
      const size = { flat: Math.round(search.flat(out.node) * 1e6) / 1e6, up: Math.round((search.up(out.node) + mainRise(from, out)) * 1e6) / 1e6 };
      const after = linkHead(fromState.head, fromState.gravity, size);
      if (after.left < 0) continue;
      options.push({ from, out, size, rank: search.rank(out.node), search });
    }
    options.sort((first, second) => first.rank - second.rank || first.from.module - second.from.module || first.out.index - second.out.index);
    for (const option of options) {
      const path = pipePath(graph, option.search, option.out.node);
      const head = pathHead(path.points);
      const size = { flat: head.flat, up: Math.round((head.up + mainRise(option.from, option.out)) * 1e6) / 1e6 };
      if (linkHead(estimate.get(option.from.id).head, estimate.get(option.from.id).gravity, size).left < 0) continue;
      const inlet = waterPorts[path.end];
      return { ...option, inlet, size, route: { points: path.points, spans: path.spans, length: pathLength(path.points) }, need };
    }
    // Nothing runs: out of head when a wall route exists, else no wall route
    const joined = (out) => targets.some((target) => parts[target] === parts[out.node]);
    const reachable = candidates.filter(({ out }) => joined(out));
    if (reachable.length === 0) return { fail: { reason: 'no wall route', attempt: { from: candidates[0].out, to: inlets[0] } } };
    const limit = Math.max(...reachable.map(({ from, out }) => estimate.get(from.id).head - mainRise(from, out) * HEAD_PER_STORY_UP)) + SHORT_REACH;
    const wide = searchFor(false, limit);
    for (const { from, out } of reachable) {
      if (!wide.reached(out.node)) continue;
      const fromState = estimate.get(from.id);
      const size = { flat: wide.flat(out.node), up: wide.up(out.node) + mainRise(from, out) };
      tried.head = Math.min(tried.head, Math.round(linkHead(fromState.head, fromState.gravity, size).short * 1e6) / 1e6);
    }
    if (tried.head === Infinity) return { fail: { reason: 'out of head', short: null } };
    if (tried.head < Infinity) return { fail: { reason: 'out of head', short: tried.head } };
    return { fail: { reason: 'no route' } };
  }
  function addLink(option, node) {
    const fromState = estimate.get(option.from.id);
    const toState = estimate.get(node.id);
    const amount = Math.min(spare(option.from), option.need);
    fromState.used += amount;
    toState.units += amount;
    const arrived = linkHead(fromState.head, fromState.gravity, option.size).left;
    if (node.kind === 'pump') {
      toState.head = node.head;
      toState.gravity = false;
    } else if (!toState.entry || arrived < toState.head) {
      toState.head = toState.entry ? Math.min(toState.head, arrived) : arrived;
      toState.gravity = fromState.gravity;
    }
    if (!toState.entry) toState.entry = option.inlet;
    option.out.left--;
    option.inlet.left--;
    links.push({ id: links.length, from: option.from.id, to: node.id, flat: option.size.flat, up: option.size.up, length: option.route.length, port: option.inlet.index, fromPort: { module: option.out.module, index: option.out.index }, toPort: { module: option.inlet.module, index: option.inlet.index }, points: option.route.points, spans: option.route.spans });
  }
  // Hubs first, lowest first, then consumers in a seeded order
  const hubs = nodes.filter((node) => (node.kind === 'pump' || node.kind === 'main') && node.ins.length > 0).sort((first, second) => first.level - second.level || first.module - second.module);
  for (const hub of hubs) {
    for (let input = 0; input < HUB_INPUTS; input++) {
      const need = hub.kind === 'pump' ? hub.throughput - estimate.get(hub.id).units : Infinity;
      if (need <= 0) break;
      const option = bestLink(hub, need);
      if (option.fail) break;
      addLink(option, hub);
    }
  }
  const noLink = new Map();
  const consumers = rng.shuffle(nodes.filter((node) => node.kind === 'consumer'));
  for (const node of consumers) {
    for (let input = 0; input < BASIN_INPUTS; input++) {
      const need = node.demand - estimate.get(node.id).units;
      if (need <= 0 || node.ins.length === 0) {
        if (node.ins.length === 0 && input === 0) noLink.set(node.id, { reason: 'no free port' });
        break;
      }
      const option = bestLink(node, need);
      if (option.fail) {
        if (input === 0) noLink.set(node.id, option.fail);
        break;
      }
      addLink(option, node);
    }
  }
  const solved = solveWater({ nodes, links });
  // Pipes that would have run but hit a module
  const blocked = [...noLink.values()].filter((fail) => fail.attempt).map(({ attempt }) => ({ from: attempt.from, to: attempt.to, points: [attempt.from.position, attempt.to.position], blocked: { module: null, reason: 'no wall route' } }));
  const report = {};
  for (const node of nodes) {
    if (node.kind !== 'consumer') continue;
    const fail = noLink.get(node.id);
    report[node.module] = consumerStatus(node, solved, links.filter((link) => link.to === node.id), fail && { reason: fail.reason, short: fail.short === undefined ? 0 : fail.short });
  }
  // Pumps say whether they run
  const pumps = {};
  for (const node of nodes) if (node.row && PUMP_KINDS[byId.get(node.module).family]) pumps[node.module] = { runs: !node.pumpOff, row: node.row };
  return { blocked, nodes: nodes.map(({ id, module, members, kind, level, supply, demand, head, throughput }) => ({ id, module, members, kind, level, supply, demand: demand || 0, head, throughput })), links, solved, consumers: report, pumps };
}
