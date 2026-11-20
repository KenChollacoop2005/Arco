import {
  LINE_MAX_MM, LINE_SAG, LINE_RISE_MM, CLOTHESLINES_MAX, LAUNDRY_GAP_MM, LAUNDRY_CHANCE, LAUNDRY_SIZE_MM, LAUNDRY_COLORS,
  TARP_REACH_MM, TARP_RISE_MM, TARP_MIN_AREA_MM2, TARPS_MAX, TARP_COLORS, MAX_LINES_PER_PAIR,
  STRING_LIGHTS_MAX, STRING_LIGHTS_CHANCE, STRING_LIGHTS_SAG,
} from '../config.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { hangString, pathBlocked, standoff } from './strings.js';

const LINE_SEED = 0x11e5; // keeps line rolls apart from other rolls
const TARP_SEED = 0x7a59; // keeps tarp rolls apart from line rolls
const PEG_DROP_MM = 0.2; // laundry hangs this far under the line
const TARP_OFF_MM = 1; // tarp corners sit this far off the hook
const TARP_CORNERS = [3, 4]; // fewest and most hooks per tarp
const LIGHTS_SEED = 0x1167; // keeps string light rolls apart from line rolls

const distance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

// Tarps stretched between three or four free line hooks
function stringTarps(hooks, context, rng) {
  const tarps = [];
  for (const first of rng.shuffle(hooks.slice())) {
    if (tarps.length >= TARPS_MAX) break;
    if (first.left <= 0) continue;
    const near = hooks
      .filter((hook) => hook !== first && hook.left > 0 && Math.abs(hook.position[2] - first.position[2]) <= TARP_RISE_MM && distance(hook.position, first.position) <= TARP_REACH_MM)
      .sort((hookA, hookB) => distance(hookA.position, first.position) - distance(hookB.position, first.position) || hookA.module - hookB.module || hookA.index - hookB.index);
    const anchors = [first];
    const want = rng.int(TARP_CORNERS[0], TARP_CORNERS[1]);
    for (const hook of near) {
      if (anchors.length >= want) break;
      const clear = (anchor) => !pathBlocked(context, [standoff(anchor, TARP_OFF_MM), standoff(hook, TARP_OFF_MM)], [anchor.module, hook.module]);
      if (anchors.every((anchor) => distance(anchor.position, hook.position) <= TARP_REACH_MM && clear(anchor))) anchors.push(hook);
    }
    if (anchors.length < 3) continue;
    // Corners in order round the middle
    const corners = anchors.map((anchor) => standoff(anchor, TARP_OFF_MM));
    const middle = [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis], 0) / corners.length);
    const angle = (index) => Math.atan2(corners[index][1] - middle[1], corners[index][0] - middle[0]);
    const order = anchors.map((anchor, index) => index).sort((first, second) => angle(first) - angle(second));
    let area = 0;
    order.forEach((at, index) => {
      const next = order[(index + 1) % order.length];
      area += (corners[at][0] * corners[next][1] - corners[next][0] * corners[at][1]) / 2;
    });
    if (Math.abs(area) < TARP_MIN_AREA_MM2) continue;
    for (const anchor of anchors) anchor.left--;
    tarps.push({
      anchors: order.map((index) => ({ module: anchors[index].module, index: anchors[index].index })),
      points: order.map((index) => corners[index]),
      middle,
      area: Math.abs(area),
      color: TARP_COLORS[rng.int(0, TARP_COLORS.length - 1)],
    });
  }
  return tarps;
}

// Point and direction at a distance along a polyline
function pointAlong(points, at) {
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const piece = distance(points[index - 1], points[index]);
    if (piece > 0 && walked + piece >= at) {
      const share = (at - walked) / piece;
      return {
        spot: [0, 1, 2].map((axis) => points[index - 1][axis] + (points[index][axis] - points[index - 1][axis]) * share),
        along: [0, 1, 2].map((axis) => (points[index][axis] - points[index - 1][axis]) / piece),
      };
    }
    walked += piece;
  }
  return null;
}

// Seeded washing along a line, each piece clear of modules
function hangLaundry(line, context, rng) {
  const pieces = [];
  const inner = line.points.slice(1, -1);
  const total = inner.slice(1).reduce((sum, point, index) => sum + distance(inner[index], point), 0);
  for (let at = rng.range(LAUNDRY_GAP_MM[0], LAUNDRY_GAP_MM[1]); at < total - LAUNDRY_GAP_MM[0]; at += rng.range(LAUNDRY_GAP_MM[0], LAUNDRY_GAP_MM[1])) {
    if (!rng.chance(LAUNDRY_CHANCE)) continue;
    const place = pointAlong(inner, at);
    const width = rng.range(LAUNDRY_SIZE_MM[0][0], LAUNDRY_SIZE_MM[0][1]);
    const drop = rng.range(LAUNDRY_SIZE_MM[1][0], LAUNDRY_SIZE_MM[1][1]);
    const color = LAUNDRY_COLORS[rng.int(0, LAUNDRY_COLORS.length - 1)];
    if (!place) continue;
    const top = [place.spot[0], place.spot[1], place.spot[2] - PEG_DROP_MM];
    const bottom = [top[0], top[1], top[2] - drop];
    if (bottom[2] < 0 || pathBlocked(context, [top, bottom], [])) continue;
    pieces.push({ top, width, drop, along: place.along, color });
  }
  return pieces;
}

// String lights between line hooks; the owner end takes power for the run
const cutOf = (cuts, first, second) => cuts.size > 0 && cuts.has([first.module + ':' + first.index, second.module + ':' + second.index].sort().join('|'));

// Clothesline between two given hooks by the auto rules, sag at the middle of the range
export function lineBetween(context, first, second) {
  if (first.module === second.module) return { fail: 'same-part' };
  if (Math.abs(first.position[2] - second.position[2]) > LINE_RISE_MM) return { fail: 'not-level' };
  const length = distance(first.position, second.position);
  const line = hangString(context, 'line', first, second, length * ((LINE_SAG[0] + LINE_SAG[1]) / 2), LINE_MAX_MM);
  if (line.blocked) return { fail: line.blocked.reason === 'length' ? 'too-long' : 'blocked', line };
  return { line };
}

function stringLights(hooks, context, rng, owners, cuts) {
  const runs = [];
  for (const first of rng.shuffle(hooks.slice())) {
    if (runs.length >= STRING_LIGHTS_MAX) break;
    if (first.left <= 0 || !rng.chance(STRING_LIGHTS_CHANCE)) continue;
    const options = hooks
      .filter((hook) => hook.module !== first.module && hook.left > 0 && (owners.has(first.module) || owners.has(hook.module)) && Math.abs(hook.position[2] - first.position[2]) <= LINE_RISE_MM && !cutOf(cuts, first, hook))
      .map((hook) => ({ hook, length: distance(hook.position, first.position) }))
      .filter((option) => option.length <= LINE_MAX_MM)
      .sort((optionA, optionB) => optionA.length - optionB.length || optionA.hook.module - optionB.hook.module || optionA.hook.index - optionB.hook.index);
    for (const { hook, length } of options) {
      const run = hangString(context, 'lights', first, hook, length * rng.range(STRING_LIGHTS_SAG[0], STRING_LIGHTS_SAG[1]), LINE_MAX_MM);
      if (run.blocked) continue;
      first.left--;
      hook.left--;
      runs.push({ ...run, owner: owners.has(first.module) ? first.module : hook.module });
      break;
    }
  }
  return runs;
}

// String lights, tarps, then clotheslines with laundry, on the line hooks; seeded, render only
// pinned: manual lines {a, b, line}, hung first; cuts: pair keys never auto-strung
export function planLines(modules, seedText, { ports, context, owners = new Set(), pinned = [], cuts = new Set() }) {
  const hooks = ports.filter((port) => port.active && port.type === 'line').map((port) => ({ ...port, left: port.capacity }));
  const manual = [];
  const dropped = [];
  const hookOf = (end) => hooks.find((hook) => hook.module === end.module && hook.index === end.index);
  for (const pin of pinned) {
    const first = hookOf(pin.a);
    const second = hookOf(pin.b);
    if (!first || !second || first.left <= 0 || second.left <= 0) {
      dropped.push({ pin, reason: !first || !second ? 'missing-port' : 'port-full' });
      continue;
    }
    first.left--;
    second.left--;
    manual.push({ ...pin.line, manual: true });
  }
  const lights = owners.size > 0 ? stringLights(hooks, context, makeRng(mixSeed(hashString(String(seedText)), LIGHTS_SEED)), owners, cuts) : [];
  const tarps = stringTarps(hooks, context, makeRng(mixSeed(hashString(String(seedText)), TARP_SEED)));
  const rng = makeRng(mixSeed(hashString(String(seedText)), LINE_SEED));
  const lines = [];
  const laundry = [];
  const strung = new Map();
  const pairCount = (hookA, hookB) => strung.get(pairKey(hookA, hookB)) || 0;
  const pairKey = (hookA, hookB) => [hookA.module + ':' + hookA.index, hookB.module + ':' + hookB.index].sort().join('-');
  for (const line of manual) strung.set(pairKey(line.from, line.to), pairCount(line.from, line.to) + 1);
  for (const first of rng.shuffle(hooks.slice())) {
    if (lines.length >= CLOTHESLINES_MAX) break;
    if (first.left <= 0) continue;
    // Nearest free hook on another module, about level, with a clear line
    const options = hooks
      .filter((hook) => hook.module !== first.module && hook.left > 0 && pairCount(first, hook) < MAX_LINES_PER_PAIR && Math.abs(hook.position[2] - first.position[2]) <= LINE_RISE_MM && !cutOf(cuts, first, hook))
      .map((hook) => ({ hook, length: distance(hook.position, first.position) }))
      .filter((option) => option.length <= LINE_MAX_MM)
      .sort((optionA, optionB) => optionA.length - optionB.length || optionA.hook.module - optionB.hook.module || optionA.hook.index - optionB.hook.index);
    for (const { hook, length } of options) {
      const line = hangString(context, 'line', first, hook, length * rng.range(LINE_SAG[0], LINE_SAG[1]), LINE_MAX_MM);
      if (line.blocked) continue;
      first.left--;
      hook.left--;
      strung.set(pairKey(first, hook), pairCount(first, hook) + 1);
      lines.push(line);
      laundry.push(...hangLaundry(line, context, rng).map((piece) => ({ ...piece, line: lines.length - 1 })));
      break;
    }
  }
  return { lines: [...manual, ...lines], laundry: laundry.map((piece) => ({ ...piece, line: piece.line + manual.length })), tarps, lights, dropped };
}
