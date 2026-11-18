import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, WATER_SOURCES, MAX_CHAIN_LINKS, MAX_WIRES_PER_PAIR, POWER_SUPPLY, POWER_RELAYS } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { structureMounts } from '../js/core/mounts.js';
import { stringContext, pathBlocked } from '../js/core/strings.js';
import { solvePower, powerStatus, planPower } from '../js/core/power.js';
import { solveWater } from '../js/core/water.js';
import { catenaryPoints, conduitClear, solidPoint } from '../js/core/wires.js';
import { boxIndex } from '../js/core/pipes.js';

const EPS = 1e-9; // rounding slack on unit sums
const part = (id, family, fp, h, x, y, z, mask = 15, seed = 3) => ({ ...normalizeVariant({ family, fp, h, seed, mask, roof: false }), id, x, y, z, rot: 0 });
const powerOf = (modules, seed = 'hand') => planPower(modules, seed, { ports: structureMounts(modules), context: stringContext(modules) });
const source = (id, family) => ({ id, kind: 'source', supply: POWER_SUPPLY[family][0], reach: POWER_SUPPLY[family][1] });
const relay = (id, family) => ({ id, kind: 'relay', reach: POWER_RELAYS[family][0], throughput: POWER_RELAYS[family][1] });
const consumer = (id, demand) => ({ id, kind: 'consumer', demand });
const link = (id, from, to, length, port = 0) => ({ id, from, to, length, port });
const balanced = (totals) => Math.abs(totals.supplied - totals.delivered - totals.unused) < EPS;
const chord = (points) => Math.hypot(...points[points.length - 1].map((value, axis) => value - points[0][axis]));
const polyline = (points) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])), 0);
const routeLength = (cable) => cable.pieces.reduce((sum, piece) => sum + (piece.kind === 'span' ? chord(piece.points) : polyline(piece.points)), 0);
const statusOf = (nodes, links, solved, id) => powerStatus(nodes.find((node) => node.id === id), solved, links);

test('a turbine powers a house 4 cells away with 2 cells of reach left', () => {
  const nodes = [source('turbine', 'turbine'), consumer('house', 0.5)];
  const links = [link(0, 'turbine', 'house', 4)];
  const solved = solvePower({ nodes, links });
  assert.deepEqual(statusOf(nodes, links, solved, 'house'), { received: 0.5, demand: 0.5, reachLeft: 2, status: 'full', reason: null, short: 0 });
  assert.equal(solved.totals.unused, 1.5);
  assert.ok(balanced(solved.totals));
  // The same on real modules: one wire, the house full, reach charged on the drawn wire
  const power = powerOf([part(1, 'turbine', '1x1', 2, -2, 0, 0), part(2, 'housing', '1x1', 1, 2, 0, 0, 0b0100)]);
  assert.equal(power.links.length, 1);
  assert.equal(power.consumers[2].status, 'full');
  const wire = power.cables[0];
  assert.ok(Math.abs(power.links[0].length - routeLength(wire) / CELL_MM) < 0.05, 'reach is charged on the route: conduit plus span chords');
  assert.ok(Math.abs(power.consumers[2].reachLeft - (6 - power.links[0].length)) < 1e-6);
});

test('a house 8 cells out is out of reach by 2, and a power room between reaches it', () => {
  const nodes = [source('turbine', 'turbine'), consumer('house', 0.5)];
  const far = [link(0, 'turbine', 'house', 8)];
  const solved = solvePower({ nodes, links: far });
  assert.deepEqual(statusOf(nodes, far, solved, 'house'), { received: 0, demand: 0.5, reachLeft: null, status: 'dry', reason: 'out of reach', short: 2 });
  const withRoom = [...nodes, relay('room', 'powerroom')];
  const relayed = [link(0, 'turbine', 'room', 4), link(1, 'room', 'house', 4)];
  const through = solvePower({ nodes: withRoom, links: relayed });
  assert.equal(statusOf(withRoom, relayed, through, 'house').status, 'full');
  assert.equal(statusOf(withRoom, relayed, through, 'house').reachLeft, 8, 'the room resets reach to 12');
  // Real modules: 8 cells apart, then a power room on the plinth between
  const turbine = part(1, 'turbine', '1x1', 2, -5, 0, 0);
  const house = part(2, 'housing', '1x1', 1, 3, 0, 0, 0b0100);
  const alone = powerOf([turbine, house]);
  assert.equal(alone.links.length, 0);
  assert.equal(alone.consumers[2].reason, 'out of reach');
  assert.equal(alone.consumers[2].short, 2);
  const roomed = powerOf([turbine, house, part(3, 'powerroom', '1x1', 1, -1, 0, 0)]);
  assert.equal(roomed.consumers[2].status, 'full');
  assert.deepEqual(roomed.links.map((entry) => [entry.from, entry.to]), [['1', '3'], ['3', '2']]);
});

test('a junction box passes no more than its throughput and says so', () => {
  const nodes = [source('generator', 'generator'), relay('box', 'junction'), ...[1, 2, 3, 4].map((index) => consumer('works' + index, 1))];
  const links = [link(0, 'generator', 'box', 1), ...[1, 2, 3, 4].map((index) => link(index, 'box', 'works' + index, index, index))];
  const solved = solvePower({ nodes, links });
  assert.equal(solved.nodes.box.received, 3);
  assert.ok(solved.nodes.box.capped);
  assert.equal(solved.totals.delivered, 3);
  assert.equal(solved.totals.unused, 3, 'the generator keeps what the box cannot pass');
  // Even split of 3 over four wants of 1: 0.5 each, then the last steps to the shortest wires
  assert.deepEqual([1, 2, 3, 4].map((index) => solved.nodes['works' + index].taken), [1, 1, 0.5, 0.5]);
  assert.equal(statusOf(nodes, links, solved, 'works4').reason, 'relay at throughput');
  assert.ok(balanced(solved.totals));
});

test('an uneven split sends the odd half to the shortest wire, ties by port', () => {
  const nodes = [{ id: 'solar', kind: 'source', supply: 1.5, reach: 6 }, consumer('near', 1), consumer('far', 1)];
  const links = [link(0, 'solar', 'far', 3, 1), link(1, 'solar', 'near', 2, 2)];
  const solved = solvePower({ nodes, links });
  assert.equal(solved.nodes.near.taken, 1);
  assert.equal(solved.nodes.far.taken, 0.5);
  assert.equal(statusOf(nodes, links, solved, 'far').reason, 'source empty');
  const tied = [link(0, 'solar', 'far', 2, 1), link(1, 'solar', 'near', 2, 2)];
  assert.equal(solvePower({ nodes, links: tied }).nodes.far.taken, 1, 'equal runs: lowest port wins');
});

test('a branch that wants less hands its share on to the others', () => {
  const nodes = [{ id: 'source', kind: 'source', supply: 3, reach: 6 }, consumer('small', 0.5), consumer('mid', 2), consumer('big', 2)];
  const links = [link(0, 'source', 'small', 1), link(1, 'source', 'mid', 2), link(2, 'source', 'big', 3)];
  const solved = solvePower({ nodes, links });
  // 1 each, small keeps 0.5, the spare half goes to the shorter of the two left
  assert.deepEqual([solved.nodes.small.taken, solved.nodes.mid.taken, solved.nodes.big.taken], [0.5, 1.5, 1]);
  assert.equal(solved.totals.delivered, 3);
});

test('an unpowered small pump is a plain junction, so a farm 4 stories up stays dry until it has power', () => {
  const pump = (powered) => ({ id: 'pump', kind: 'pump', supply: WATER_SOURCES.smallpump[0], head: WATER_SOURCES.smallpump[1], throughput: WATER_SOURCES.smallpump[2], level: 1, powered });
  const network = (powered) => ({
    nodes: [{ id: 'tank', kind: 'source', supply: 4, head: null, level: 1 }, pump(powered), { id: 'farm', kind: 'consumer', supply: 0, demand: 0.5, head: null, level: 5 }],
    links: [{ id: 0, from: 'tank', to: 'pump', flat: 1, up: 0, length: 10 }, { id: 1, from: 'pump', to: 'farm', flat: 0, up: 4, length: 100 }],
  });
  const off = solveWater(network(false));
  assert.equal(off.nodes.farm.taken, 0);
  assert.equal(off.nodes.pump.runs, false);
  assert.equal(off.links[1].runs, false, 'gravity water does not climb');
  const on = solveWater(network(true));
  assert.equal(on.nodes.farm.taken, 0.5);
  assert.equal(on.nodes.pump.runs, true);
  assert.equal(on.links[1].headLeft, 1);
});

test('a catenary span hangs with the cable length it was given', () => {
  // Level span: 2a sinh(h / 2a) = L, sag a (cosh(h / 2a) - 1), solved here by Newton
  const span = 100;
  const cable = 104;
  let a = 50;
  for (let round = 0; round < 60; round++) {
    const value = 2 * a * Math.sinh(span / (2 * a)) - cable;
    const slope = 2 * Math.sinh(span / (2 * a)) - (span / a) * Math.cosh(span / (2 * a));
    a -= value / slope;
  }
  const sag = a * (Math.cosh(span / (2 * a)) - 1);
  const { points } = catenaryPoints([0, 0, 100], [span, 0, 100], cable, 200);
  const middle = points[100];
  assert.ok(Math.abs(100 - middle[2] - sag) < 0.01, `sag ${100 - middle[2]} against ${sag}`);
  const drawn = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])), 0);
  assert.ok(Math.abs(drawn - cable) < 0.01);
  // Uneven ends keep the length too, and the low point sits nearer the lower end
  const slope = catenaryPoints([0, 0, 100], [80, 0, 130], 95, 400).points;
  const length = slope.slice(1).reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - slope[index][axis])), 0);
  assert.ok(Math.abs(length - 95) < 0.02);
  const low = slope.reduce((best, point) => (point[2] < best[2] ? point : best));
  assert.ok(low[0] < 40 && low[2] < 100);
});

// Generated structures with sources added on the highest open roofs, so trees have room to grow
function powered(seed, scale) {
  const { modules } = generate({ seed, scale, density: 2, height: 2, daring: 2, theme: 2 });
  const tops = new Map();
  for (const instance of modules) {
    const key = instance.x + ',' + instance.y;
    if (instance.fp === '1x1' && (!tops.has(key) || tops.get(key).z < instance.z)) tops.set(key, instance);
  }
  const roofs = [...tops.values()].filter((instance) => !['turbine', 'solar', 'powerroom'].includes(instance.family)).sort((first, second) => second.z + second.h - first.z - first.h || first.id - second.id).slice(0, 3);
  let next = Math.max(...modules.map((instance) => instance.id)) + 1;
  const added = roofs.map((instance, index) => part(next++, index === 1 ? 'solar' : 'turbine', '1x1', index === 1 ? 1 : 2, instance.x, instance.y, instance.z + instance.h));
  return [...modules, ...added];
}

let built = null;
function plans() {
  if (built) return built;
  built = [['barbican', 'block'], ['beton', 'block'], ['habitat', 'mega']].map(([seed, scale]) => {
    const modules = powered(seed, scale);
    const mounts = structureMounts(modules);
    const context = stringContext(modules);
    return { name: `${seed} ${scale}`, seed, modules, mounts, context, power: planPower(modules, seed, { ports: mounts, context }) };
  });
  return built;
}

test('power trees branch: no more one-in-one-out links in a row than the limit', () => {
  let links = 0;
  for (const { name, power } of plans()) {
    const into = new Map();
    const outOf = new Map();
    for (const entry of power.links) {
      into.set(entry.to, [...(into.get(entry.to) || []), entry]);
      outOf.set(entry.from, [...(outOf.get(entry.from) || []), entry]);
    }
    const oneInOneOut = (id) => (into.get(id) || []).length === 1 && (outOf.get(id) || []).length === 1;
    const run = (id) => (oneInOneOut(id) ? 1 + run(into.get(id)[0].from) : 0);
    for (const node of power.nodes) assert.ok(run(node.id) <= MAX_CHAIN_LINKS, `${name} chain of ${run(node.id)} at ${node.id}`);
    const fanned = power.nodes.filter((node) => (outOf.get(node.id) || []).length >= 2).length;
    assert.ok(power.links.length === 0 || fanned > 0, `${name} some node fans out`);
    links += power.links.length;
  }
  assert.ok(links >= 10, `links ${links}`);
});

test('wires: conduit runs are upright or level, hug solid wall past every opening, and no wire enters a module', () => {
  let conduit = 0;
  let spans = 0;
  for (const { name, modules, context, power } of plans()) {
    const near = boxIndex(context.boxes);
    for (const cable of power.cables) {
      const ends = [cable.from.module, cable.to.module];
      assert.equal(pathBlocked(context, cable.points, ends), null, `${name} cable through a module`);
      for (let index = 1; index < cable.points.length; index++) {
        const [from, to] = [cable.points[index - 1], cable.points[index]];
        const steps = Math.ceil(Math.hypot(...to.map((value, axis) => value - from[axis])) / 0.5);
        for (let step = 1; step < steps; step++) assert.ok(!solidPoint(context, near, from.map((value, axis) => value + ((to[axis] - value) * step) / steps)), `${name} wire inside a solid`);
      }
      for (const piece of cable.pieces) {
        if (piece.kind === 'run') {
          conduit++;
          const step = piece.points[1].map((value, axis) => Math.abs(value - piece.points[0][axis]));
          assert.equal(step.filter((value) => value > 1e-6).length, 1, `${name} diagonal conduit`);
          assert.ok(conduitClear(context, near, piece.points[0], piece.points[1]).ok, `${name} conduit over an opening`);
        }
        if (piece.kind === 'span') {
          spans++;
          const drawn = piece.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - piece.points[index][axis])), 0);
          assert.ok(Math.abs(drawn - piece.cable) <= 0.01 * piece.cable + 0.05, `${name} span ${drawn} against cable ${piece.cable}`);
        }
      }
      // Total cable is the route times one plus its slack; the spans take the extra
      const drawn = cable.pieces.reduce((sum, piece) => sum + (piece.kind === 'span' ? piece.cable : polyline(piece.points)), 0);
      assert.ok(Math.abs(drawn - cable.total) <= 0.01 * cable.total + 0.5 || !cable.pieces.some((piece) => piece.kind === 'span'), `${name} cable length ${drawn} against ${cable.total}`);
    }
    for (const point of power.cables.flatMap((cable) => cable.points)) assert.ok(point[2] >= 0, `${name} wire under the plinth`);
    assert.ok(modules.length > 0);
  }
  assert.ok(conduit > 0 && spans > 0, `conduit ${conduit}, spans ${spans}`);
});

test('ports and pairs: capacity and the pair cap hold, and reach is never overspent', () => {
  for (const { name, mounts, power } of plans()) {
    const used = new Map();
    for (const entry of power.links) {
      for (const end of [entry.fromPort, entry.toPort]) {
        const key = end.module + ':' + end.index;
        used.set(key, (used.get(key) || 0) + 1);
        const port = mounts.find((mount) => mount.module === end.module && mount.index === end.index);
        assert.ok(used.get(key) <= port.capacity, `${name} port ${key} over capacity`);
      }
    }
    const pairs = new Map();
    for (const cable of power.cables) {
      const key = [cable.from.module + ':' + cable.from.index, cable.to.module + ':' + cable.to.index].sort().join('|');
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    for (const count of pairs.values()) assert.ok(count <= MAX_WIRES_PER_PAIR);
    for (const entry of Object.values(power.solved.links)) if (entry.units > 0) assert.ok(entry.reachLeft >= 0, `${name} reach overspent`);
    assert.ok(balanced(power.solved.totals), `${name} balance`);
  }
});

test('the same seed gives the same network, and one module more changes little', () => {
  const [first] = plans();
  assert.deepEqual(planPower(first.modules, first.seed, { ports: first.mounts, context: first.context }), first.power);
  for (const { name, seed, modules, power } of plans()) {
    if (power.links.length < 4) continue;
    // Add a small module on the far side of the plinth from most wires
    const keyOf = (instance) => `${instance.family}:${instance.x},${instance.y},${instance.z}`;
    const place = new Map(modules.map((instance) => [String(instance.id), keyOf(instance)]));
    const named = (list, places) => new Set(list.map((entry) => places.get(entry.from.split(':')[0]) + '>' + places.get(entry.to.split(':')[0])));
    const before = named(power.links, place);
    const tops = new Set(modules.map((instance) => instance.x + ',' + instance.y));
    const spot = [[-5, 0], [5, 0], [0, -5], [0, 5], [-4, -3], [4, 3]].find(([x, y]) => !tops.has(x + ',' + y));
    const extra = part(9999, 'housing', '1x1', 1, spot[0], spot[1], 0, 15, 11);
    const more = [...modules, extra];
    const after = named(planPower(more, seed, { ports: structureMounts(more), context: stringContext(more) }).links, new Map([...place, ['9999', keyOf(extra)]]));
    const kept = [...before].filter((key) => after.has(key)).length;
    assert.ok(kept >= 0.7 * before.size, `${name} kept ${kept} of ${before.size}`);
  }
});
