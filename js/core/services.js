import { structureMounts } from './mounts.js';
import { stringContext, makeString, solidEntries } from './strings.js';
import { planWater } from './water.js';
import { planPower } from './power.js';
import { planLines } from './lines.js';

const portKey = (module, index) => module + ':' + index;

// Water, power and plain lines of a structure as strings, seeded and render only
export function planServices(modules, seedText, { mounts = structureMounts(modules), context = stringContext(modules) } = {}) {
  const byKey = new Map(mounts.map((port) => [portKey(port.module, port.index), port]));
  const portOf = (end) => byKey.get(portKey(end.module, end.index));
  const water = planWater(modules, seedText, { ports: mounts, context });
  const pipes = water.links.map((link) => ({
    ...makeString('pipe', portOf(link.fromPort), portOf(link.toPort), link.points, { spans: link.spans, collars: solidEntries(context, link.points.slice(1, -1)) }),
    units: water.solved.links[link.id].units,
    link: link.id,
  }));
  const blockedPipes = water.blocked.map((attempt) => ({ ...makeString('pipe', attempt.from, attempt.to, attempt.points), blocked: attempt.blocked }));
  // Overflow sheets, basin to basin or down to the roof or plinth
  const sheets = water.solved.sheets.filter((sheet) => sheet.points).map((sheet) => ({ from: sheet.from, to: sheet.to, units: sheet.units, points: sheet.points }));
  const power = planPower(modules, seedText, { ports: mounts, context });
  const plain = planLines(modules, seedText, { ports: mounts, context });
  return { water, power: { links: power.links, powered: power.powered }, pipes, sheets, wires: power.cables, lines: plain.lines, laundry: plain.laundry, tarps: plain.tarps, blocked: [...blockedPipes, ...power.blocked] };
}
