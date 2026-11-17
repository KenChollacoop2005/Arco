import {
  WIRE_MAX_MM, WIRE_SAG, POWER_SOURCES, POWER_ROOMS, ROOM_NEAR_MM, JUMPER_MAX_MM, WIRE_CROSS_MM, WIRE_LINKS_MAX,
  CABLES_PER_LINK, CABLE_SHIFT_MM, CABLE_TILT, SPARE_SHARE, SPARE_SAG, MAX_WIRES_PER_PAIR,
} from '../config.js';
import { SIDES, instanceCells } from './grid.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { hangString } from './strings.js';

const POWER_SEED = 0x90e4; // keeps wire rolls apart from other rolls
const MID_SAG = (WIRE_SAG[0] + WIRE_SAG[1]) / 2; // sag used to test a link

const distance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

// True when two plan segments cross away from their ends
export function planCross(firstA, firstB, secondA, secondB) {
  const turn = (from, to, point) => (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]);
  return turn(firstA, firstB, secondA) * turn(firstA, firstB, secondB) < 0 && turn(secondA, secondB, firstA) * turn(secondA, secondB, firstB) < 0;
}

// Cheapest clear option, shortest first: length plus a cost per wire crossed
export function chooseLink(options, plans, crossCost, hang) {
  let best = null;
  for (const option of options) {
    if (best && option.length >= best.cost) break;
    const wire = hang(option);
    if (wire.blocked) continue;
    const crossings = plans.filter((plan) => planCross(option.from.position, option.to.position, plan[0], plan[1])).length;
    const cost = option.length + crossCost * crossings;
    if (!best || cost < best.cost) best = { ...option, cost, crossings, wire };
  }
  return best;
}

// Modules that share a face, as a lookup of id pairs
function touching(modules) {
  const owner = new Map();
  for (const instance of modules) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) owner.set(cellX + ',' + cellY + ',' + level, instance.id);
    }
  }
  const pairs = new Set();
  for (const [key, id] of owner) {
    const [cellX, cellY, level] = key.split(',').map(Number);
    for (const [stepX, stepY, stepZ] of [...SIDES.map(([x, y]) => [x, y, 0]), [0, 0, 1], [0, 0, -1]]) {
      const other = owner.get(cellX + stepX + ',' + (cellY + stepY) + ',' + (level + stepZ));
      if (other !== undefined && other !== id) pairs.add(id + ':' + other);
    }
  }
  return (first, second) => first === second || pairs.has(first + ':' + second);
}

// Power wires: sources feed rooms, rooms and sources fan out; seeded, render only
export function planPower(modules, seedText, { ports, context, crossCost = WIRE_CROSS_MM, pairCap = MAX_WIRES_PER_PAIR }) {
  const rng = makeRng(mixSeed(hashString(String(seedText)), POWER_SEED));
  const familyOf = new Map(modules.map((instance) => [instance.id, instance.family]));
  const near = touching(modules);
  const live = ports.filter((port) => port.active && port.type === 'power').map((port) => ({ ...port, family: familyOf.get(port.module), left: port.capacity }));
  const isSource = (port) => POWER_SOURCES.includes(port.family);
  const isRoom = (port) => POWER_ROOMS.includes(port.family);
  const rooms = live.filter(isRoom);
  // Power rooms are always live: they also draw from the grid off the plinth
  const powered = new Set(live.filter((port) => isSource(port) || isRoom(port)).map((port) => port.module));
  const links = [];
  const blockedBy = new Map();
  const plans = [];
  const tested = new Map();

  // Cheapest clear link from the feeders to the waiting ports
  function bestLink(feeders, waiting, allow) {
    const options = [];
    for (const to of waiting) {
      if (to.left <= 0) continue;
      for (const from of feeders) {
        if (from.left <= 0 || from.module === to.module || !allow(from, to)) continue;
        const length = distance(from.position, to.position);
        if (length > WIRE_MAX_MM || (near(from.module, to.module) && length > JUMPER_MAX_MM)) continue;
        options.push({ from, to, length });
      }
    }
    options.sort((first, second) => first.length - second.length || first.from.module - second.from.module || first.to.module - second.to.module || first.from.index - second.from.index || first.to.index - second.to.index);
    return chooseLink(options, plans, crossCost, (option) => {
      const key = option.from.module + ':' + option.from.index + '>' + option.to.module + ':' + option.to.index;
      if (!tested.has(key)) tested.set(key, hangString(context, 'wire', option.from, option.to, option.length * MID_SAG, WIRE_MAX_MM));
      const wire = tested.get(key);
      if (wire.blocked && !blockedBy.has(option.to.module)) blockedBy.set(option.to.module, wire);
      return wire;
    });
  }

  function addLink(best) {
    best.from.left--;
    best.to.left--;
    plans.push([best.from.position, best.to.position]);
    links.push({ id: links.length, from: { module: best.from.module, index: best.from.index }, to: { module: best.to.module, index: best.to.index }, length: best.length, crossings: best.crossings, wire: best.wire, ends: [best.from, best.to] });
  }

  // Sources feed the power rooms first
  const sources = live.filter(isSource);
  for (const room of rooms) {
    if (links.length >= WIRE_LINKS_MAX) break;
    if (links.some((link) => link.to.module === room.module)) continue;
    const best = bestLink(sources, [room], () => true);
    if (best) addLink(best);
  }
  // Then out to every other bracket, nearest first; fed modules pass it on
  const waiting = rng.shuffle(live.filter((port) => !isSource(port) && !isRoom(port)));
  const feeders = live.filter((port) => isSource(port) || isRoom(port));
  // A source feeds directly only when no power room is near the bracket
  const roomNear = (port) => rooms.some((room) => distance(room.position, port.position) <= ROOM_NEAR_MM);
  while (links.length < WIRE_LINKS_MAX) {
    const open = waiting.filter((port) => !powered.has(port.module));
    if (open.length === 0) break;
    const best = bestLink(feeders, open, (from, to) => !isSource(from) || !roomNear(to));
    if (!best) break;
    addLink(best);
    powered.add(best.to.module);
    feeders.push(...live.filter((port) => port.module === best.to.module));
  }
  // One to three cables per link, each with its own sag, swing and ends; rolls are kept past the pair cap
  const cables = [];
  const perPair = new Map();
  const pairOf = (from, to) => [from.module + ':' + from.index, to.module + ':' + to.index].sort().join('|');
  const room = (link) => (perPair.get(pairOf(...link.ends)) || 0) < pairCap;
  const hang = (link, wire) => {
    cables.push(wire);
    perPair.set(pairOf(...link.ends), (perPair.get(pairOf(...link.ends)) || 0) + 1);
  };
  for (const link of links) {
    const count = rng.int(CABLES_PER_LINK[0], CABLES_PER_LINK[1]);
    const [from, to] = link.ends;
    const tangent = (port) => [-port.normal[1], port.normal[0], 0];
    for (let cable = 0; cable < count; cable++) {
      const share = cable === 0 ? MID_SAG : rng.range(WIRE_SAG[0], WIRE_SAG[1]);
      const shift = (port) => tangent(port).map((value, axis) => value * rng.range(-CABLE_SHIFT_MM, CABLE_SHIFT_MM) + (axis === 2 ? rng.range(-CABLE_SHIFT_MM, CABLE_SHIFT_MM) / 2 : 0));
      const options = cable === 0 ? {} : { tilt: rng.range(-CABLE_TILT, CABLE_TILT), shiftA: shift(from), shiftB: shift(to) };
      const wire = cable === 0 ? link.wire : hangString(context, 'wire', from, to, link.length * share, WIRE_MAX_MM, options);
      if (!wire.blocked && room(link)) hang(link, { ...wire, link: link.id });
    }
    // A few spares hang slack
    if (rng.chance(SPARE_SHARE)) {
      const spare = hangString(context, 'wire', from, to, link.length * rng.range(SPARE_SAG[0], SPARE_SAG[1]), WIRE_MAX_MM, { tilt: rng.range(-CABLE_TILT, CABLE_TILT) });
      if (!spare.blocked && room(link)) hang(link, { ...spare, link: link.id, spare: true });
    }
  }
  const blocked = [...blockedBy.entries()].filter(([module]) => !powered.has(module)).map(([, wire]) => wire);
  return { links: links.map(({ id, from, to, length, crossings }) => ({ id, from, to, length, crossings })), cables, powered: [...powered].sort((first, second) => first - second), blocked };
}
