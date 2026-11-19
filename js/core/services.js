import { structureMounts } from './mounts.js';
import { stringContext, makeString, solidEntries } from './strings.js';
import { planWater } from './water.js';
import { planPower } from './power.js';
import { planLines } from './lines.js';
import { PUMP_KINDS } from '../config.js';
import { hasPump } from './catalog.js';

const WHEEL_FAMILIES = ['wheelup']; // wheels driven by water passing through them

const portKey = (module, index) => module + ':' + index;

// Ports with at least one string, pipe, wire, line or tarp on them
export function usedPorts(services) {
  const used = new Set();
  if (!services) return used;
  for (const string of [...services.pipes, ...services.wires, ...services.lines]) {
    used.add(portKey(string.from.module, string.from.index));
    used.add(portKey(string.to.module, string.to.index));
  }
  for (const tarp of services.tarps) for (const anchor of tarp.anchors) used.add(portKey(anchor.module, anchor.index));
  return used;
}

// Used out of capacity per port type of one module, in port type order
export function portUse(ports, services, moduleId) {
  const ends = new Map();
  const count = (end) => ends.set(portKey(end.module, end.index), (ends.get(portKey(end.module, end.index)) || 0) + 1);
  if (services) {
    for (const string of [...services.pipes, ...services.wires, ...services.lines]) {
      count(string.from);
      count(string.to);
    }
    for (const tarp of services.tarps) for (const anchor of tarp.anchors) count(anchor);
  }
  const byType = new Map();
  for (const port of ports) {
    if (port.module !== moduleId || port.active === false) continue;
    const row = byType.get(port.type) || { type: port.type, used: 0, capacity: 0 };
    row.used += Math.min(port.capacity, ends.get(portKey(port.module, port.index)) || 0);
    row.capacity += port.capacity;
    byType.set(port.type, row);
  }
  return [...byType.values()];
}

// Ports drawn in the main view: active (or not marked) and in use
export function drawnPorts(ports, services) {
  const used = usedPorts(services);
  return ports.filter((port) => port.active !== false && used.has(portKey(port.module, port.index)));
}

// Water, power and plain lines of a structure as strings, seeded and render only
export function planServices(modules, seedText, { mounts = structureMounts(modules), context = stringContext(modules) } = {}) {
  const byKey = new Map(mounts.map((port) => [portKey(port.module, port.index), port]));
  const portOf = (end) => byKey.get(portKey(end.module, end.index));
  // Gravity water, then power, then pumped water
  const shared = {};
  const gravity = planWater(modules, seedText, { ports: mounts, context, powered: new Set(), shared });
  const wheels = {};
  for (const instance of modules) if (WHEEL_FAMILIES.includes(instance.family)) wheels[instance.id] = (gravity.solved.nodes[String(instance.id)] || { received: 0 }).received;
  const power = planPower(modules, seedText, { ports: mounts, context, wheels });
  const pumpsOn = new Set(modules.filter((instance) => PUMP_KINDS[instance.family] && hasPump(instance) && power.consumers[instance.id] && power.consumers[instance.id].status === 'full').map((instance) => instance.id));
  const water = planWater(modules, seedText, { ports: mounts, context, powered: pumpsOn, shared });
  const pipes = water.links.map((link) => ({
    ...makeString('pipe', portOf(link.fromPort), portOf(link.toPort), link.points, { spans: link.spans, collars: solidEntries(context, link.points.slice(1, -1)) }),
    units: water.solved.links[link.id].units,
    link: link.id,
  }));
  const blockedPipes = water.blocked.map((attempt) => ({ ...makeString('pipe', attempt.from, attempt.to, attempt.points), blocked: attempt.blocked }));
  // Overflow sheets, basin to basin or down to the roof or plinth
  const sheets = water.solved.sheets.filter((sheet) => sheet.points).map((sheet) => ({ from: sheet.from, to: sheet.to, units: sheet.units, points: sheet.points }));
  const plain = planLines(modules, seedText, { ports: mounts, context });
  return { water: { ...water, pumps: water.pumps }, power: { links: power.links, powered: power.powered, consumers: power.consumers, nodes: power.nodes, totals: power.solved.totals }, pipes, sheets, wires: power.cables, lines: plain.lines, laundry: plain.laundry, tarps: plain.tarps, blocked: [...blockedPipes, ...power.blocked] };
}
