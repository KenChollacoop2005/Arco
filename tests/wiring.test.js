import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_PIPES_PER_PAIR } from '../js/config.js';
import { planServices } from '../js/core/services.js';
import { serviceBase, manualRoute, checkWiring, orient, stringTypeOf, parseWiring, withConnection, withCut, pairKey, emptyWiring } from '../js/core/wiring.js';
import { layoutModules, validateLayout, scorePuzzleLayout } from '../js/core/puzzle.js';
import { layoutOf } from '../js/core/puzzleplay.js';
import { createBuild } from '../js/core/build.js';

// Daily par layout with a resident moved into a home that gets no power
const puzzle = JSON.parse(readFileSync(new URL('../puzzles/2026-11-24.json', import.meta.url)));
const modules = layoutModules(puzzle, puzzle.par.layout);
const DRY_HOME = 1007; // housing unit the automatic wiring leaves short
const HELPING_WIRE = { a: { module: 1007, index: 0 }, b: { module: 1006, index: 0 }, type: 'power' }; // manual wire to the studio next door
const BUSY_WIRE = { a: { module: 1001, index: 1 }, b: { module: 1006, index: 6 }, type: 'power' }; // automatic wire that holds the studio's spare port
const SEED = puzzle.seed;
const base = serviceBase(modules);
const portsOf = (type) => base.mounts.filter((port) => port.active && port.type === type);
const strings = (services) => [...services.pipes.map((string) => ['water', string]), ...services.wires.map((string) => ['power', string]), ...services.lines.map((string) => ['line', string])];
const usesPair = (services, end, other) => strings(services).some(([, string]) => pairKey(string.from, string.to) === pairKey(end, other));

test('compatibility: power to power, water out to water in (oriented), line to line, nothing else', () => {
  const [power, otherPower] = portsOf('power');
  const [out, otherOut] = portsOf('water-out');
  const [inlet] = portsOf('water-in');
  const [line] = portsOf('line');
  assert.deepEqual(['power', 'water-in', 'water-out', 'line', 'seat'].map(stringTypeOf), ['power', 'water', 'water', 'line', null]);
  assert.equal(orient(power, otherPower).ok, true);
  const water = orient(inlet, out);
  assert.equal(water.ok, true);
  assert.deepEqual([water.connection.a.module, water.connection.a.index, water.connection.b.module, water.connection.b.index], [out.module, out.index, inlet.module, inlet.index]);
  assert.equal(orient(out, otherOut).reason, 'incompatible');
  assert.equal(orient(power, out).reason, 'incompatible');
  if (line) assert.equal(orient(power, line).reason, 'incompatible');
  assert.equal(orient(power, power).reason, 'same-port');
  // A connection that names water the wrong way round is refused
  assert.equal(manualRoute(base, { a: water.connection.b, b: water.connection.a, type: 'water' }).reason, 'incompatible');
});

test('capacity and the pair cap count manual strings, and no port or pair goes over with automatic ones', () => {
  // Every legal partner of one power port, more than it can take
  const [start] = portsOf('power').filter((port) => portsOf('power').filter((other) => orient(port, other).ok && manualRoute(base, orient(port, other).connection).ok).length > port.capacity);
  const partners = portsOf('power').filter((other) => orient(start, other).ok && manualRoute(base, orient(start, other).connection).ok).slice(0, start.capacity + 1);
  const wiring = { connections: partners.map((other) => orient(start, other).connection), cuts: [] };
  const checked = checkWiring(base, wiring).connections;
  assert.deepEqual(checked.map((entry) => entry.ok), [...Array(start.capacity).fill(true), false]);
  assert.equal(checked[start.capacity].reason, 'port-full');
  // One pipe per pair at most
  const pipe = portsOf('water-out').flatMap((out) => portsOf('water-in').map((inlet) => orient(out, inlet).connection)).find((connection) => manualRoute(base, connection).ok);
  const twice = checkWiring(base, { connections: [pipe, pipe], cuts: [] }).connections;
  assert.equal(MAX_PIPES_PER_PAIR, 1);
  assert.deepEqual(twice.map((entry) => entry.reason || 'ok'), ['ok', 'pair-cap']);
  // The planners fit automatic strings around the manual ones
  const services = planServices(modules, SEED, { base, wiring: { connections: [...wiring.connections.slice(0, start.capacity), pipe], cuts: [] } });
  // Capacity counts links (one power link may hang two cables); the pair cap counts strings
  const perPort = new Map();
  const perPair = new Map();
  strings(services).forEach(([type, string], index) => {
    const link = type === 'power' && string.link >= 0 ? 'link' + string.link : 'string' + index;
    for (const end of [string.from, string.to]) {
      const key = end.module + ':' + end.index;
      perPort.set(key, new Set([...(perPort.get(key) || []), link]));
    }
    perPair.set(type + pairKey(string.from, string.to), (perPair.get(type + pairKey(string.from, string.to)) || 0) + 1);
  });
  for (const port of base.mounts.filter((entry) => entry.active)) assert.ok((perPort.get(port.module + ':' + port.index) || new Set()).size <= port.capacity, `port ${port.module}:${port.index}`);
  for (const [key, count] of perPair) assert.ok(count <= (key.startsWith('water') ? 1 : 2), key);
  assert.equal(services.manual.filter((entry) => entry.ok).length, start.capacity + 1);
  assert.equal(services.wires.filter((wire) => wire.manual).length, start.capacity);
  assert.equal(services.pipes.filter((pipeString) => pipeString.manual).length, 1);
});

test('a cut pair stays cut after re-solving, after a reload of the wiring and with a fresh base', () => {
  const plain = planServices(modules, SEED, { base });
  const wire = plain.wires[0];
  const wiring = withCut(emptyWiring(), wire.from, wire.to, 'power', false);
  assert.equal(usesPair(plain, wire.from, wire.to), true);
  assert.equal(usesPair(planServices(modules, SEED, { base, wiring }), wire.from, wire.to), false);
  // Different resident demand re-solves everything
  assert.equal(usesPair(planServices(modules, SEED, { base, wiring, extra: { power: { [DRY_HOME]: 0.5 } } }), wire.from, wire.to), false);
  const reloaded = parseWiring(JSON.parse(JSON.stringify(wiring)));
  assert.deepEqual(reloaded, wiring);
  assert.equal(usesPair(planServices(modules, SEED, { base: serviceBase(modules), wiring: reloaded }), wire.from, wire.to), false);
  // Cutting a manual string removes it and records no cut
  const manual = withConnection(emptyWiring(), HELPING_WIRE);
  assert.deepEqual(withCut(manual, HELPING_WIRE.a, HELPING_WIRE.b, 'power', true), emptyWiring());
});

test('pinned strings survive unrelated edits and moves of other modules', () => {
  const build = createBuild(modules);
  assert.equal(build.setWiring(withConnection(build.wiring, HELPING_WIRE)), true);
  // A new module on a free corner of the plinth
  const extra = { family: 'housing', fp: '1x1', h: 1, seed: 3, mask: 0, roof: true };
  const spot = [[-5, -1], [4, 0], [0, 4], [0, -5], [-4, 2], [3, -3]].map(([x, y]) => build.ghost(extra, x * 25 + 12.5, y * 25 + 12.5, 0)).find((ghost) => ghost.ok && ghost.instance.z === 0);
  assert.ok(spot, 'a free spot');
  assert.equal(build.place(spot.instance).ok, true);
  assert.deepEqual(build.wiring.connections, [HELPING_WIRE]);
  const services = planServices(build.modules, SEED, { wiring: build.wiring });
  assert.deepEqual(services.manual.map((entry) => entry.ok), [true]);
  assert.equal(services.wires.filter((wire) => wire.manual && pairKey(wire.from, wire.to) === pairKey(HELPING_WIRE.a, HELPING_WIRE.b)).length, 1);
  // Undo takes the module away, keeps the wire; a second undo takes the wire
  build.undo();
  assert.deepEqual(build.wiring.connections, [HELPING_WIRE]);
  build.undo();
  assert.deepEqual(build.wiring, emptyWiring());
  build.redo();
  // Removing a wired module drops its connections
  const removable = build.modules.find((instance) => instance.id === DRY_HOME);
  if (build.remove([removable.id]).ok) assert.deepEqual(build.wiring.connections, []);
  // Parked and brought back with the build
  const parked = createBuild(modules);
  parked.setWiring(withConnection(parked.wiring, HELPING_WIRE));
  const other = createBuild();
  other.restore(parked.snapshot());
  assert.deepEqual(other.wiring.connections, [HELPING_WIRE]);
});

test('a blocked route is refused with the blocking module and the attempted route', () => {
  const power = portsOf('power');
  let refused = null;
  for (const first of power) {
    for (const second of power) {
      const oriented = orient(first, second);
      if (!oriented.ok || first.module === second.module) continue;
      const route = manualRoute(base, oriented.connection);
      if (!route.ok && route.reason === 'blocked' && route.blocker !== null) refused = { route, connection: oriented.connection };
      if (refused) break;
    }
    if (refused) break;
  }
  assert.ok(refused, 'a blocked pair exists');
  assert.ok(modules.some((instance) => instance.id === refused.route.blocker));
  assert.ok(refused.route.points.length > 1);
  const services = planServices(modules, SEED, { base, wiring: { connections: [refused.connection], cuts: [] } });
  assert.deepEqual(services.manual.map((entry) => [entry.ok, entry.reason]), [[false, 'blocked']]);
  assert.equal(services.wires.some((wire) => wire.manual), false);
});

test('cutting one automatic wire and adding one manual wire powers a resident who had none', () => {
  const layout = { ...puzzle.par.layout, residents: { ...puzzle.par.layout.residents, r1: DRY_HOME } };
  const power = (wires) => scorePuzzleLayout(puzzle, wires ? { ...layout, wires } : layout).evaluations.find((entry) => entry.id === 'r1').needs.find((need) => need.id === 'power');
  assert.equal(power(null).met, false);
  assert.equal(power({ connections: [HELPING_WIRE], cuts: [] }).met, false);
  assert.equal(power({ connections: [], cuts: [BUSY_WIRE] }).met, false);
  assert.equal(power({ connections: [HELPING_WIRE], cuts: [BUSY_WIRE] }).met, true);
});

test('layouts save and restore connections and cuts, and score the same after a round trip', () => {
  const wiring = { connections: [HELPING_WIRE], cuts: [BUSY_WIRE] };
  const assignments = { ...puzzle.par.layout.residents, r1: DRY_HOME };
  const { layout } = layoutOf(modules, assignments, puzzle.site, wiring);
  assert.deepEqual(layout.wires, wiring);
  const back = JSON.parse(JSON.stringify(layout));
  assert.deepEqual(parseWiring(back.wires), wiring);
  assert.equal(scorePuzzleLayout(puzzle, back).score.points, scorePuzzleLayout(puzzle, layout).score.points);
  // Empty wiring leaves the layout format as it was
  assert.equal('wires' in layoutOf(modules, assignments, puzzle.site, emptyWiring()).layout, false);
  // Restored into a build with layout ids, the wiring comes back as it was saved
  const build = createBuild();
  build.restore({ modules: layoutModules(puzzle, back), wiring: parseWiring(back.wires), undoStack: [], redoStack: [], cap: Infinity, stream: null, rules: { locked: new Set(), keepMasks: true, idBase: 1000 } });
  assert.deepEqual(layoutOf(build.modules, assignments, puzzle.site, build.wiring).layout, layout);
});

test('the validator rejects an illegal manual string and a malformed wiring', () => {
  const power = portsOf('power')[0];
  const out = portsOf('water-out')[0];
  const wrongTypes = { ...puzzle.par.layout, wires: { connections: [{ a: { module: power.module, index: power.index }, b: { module: out.module, index: out.index }, type: 'power' }], cuts: [] } };
  assert.deepEqual(validateLayout(puzzle, wrongTypes).problems, ['bad-wire']);
  const missing = { ...puzzle.par.layout, wires: { connections: [{ a: { module: 9999, index: 0 }, b: { module: power.module, index: power.index }, type: 'power' }], cuts: [] } };
  assert.deepEqual(validateLayout(puzzle, missing).problems, ['bad-wire']);
  const malformed = { ...puzzle.par.layout, wires: { connections: [{ a: 1, b: 2 }], cuts: [] } };
  assert.deepEqual(validateLayout(puzzle, malformed).problems, ['bad-layout']);
  const fine = { ...puzzle.par.layout, wires: { connections: [HELPING_WIRE], cuts: [BUSY_WIRE] } };
  assert.equal(validateLayout(puzzle, fine).ok, true);
  assert.equal(scorePuzzleLayout(puzzle, wrongTypes).valid, false);
});

test('wiring is deterministic, and a reused base gives the same result as a fresh one', () => {
  const wiring = { connections: [HELPING_WIRE], cuts: [BUSY_WIRE] };
  const fresh = planServices(modules, SEED, { wiring });
  assert.deepEqual(planServices(modules, SEED, { wiring }), fresh);
  // The base keeps graphs, searches and collision results between calls
  const kept = serviceBase(modules);
  planServices(modules, SEED, { base: kept });
  planServices(modules, SEED, { base: kept, wiring: { connections: [], cuts: [BUSY_WIRE] } });
  assert.deepEqual(planServices(modules, SEED, { base: kept, wiring }), fresh);
  // No wiring and empty wiring plan the same as before
  assert.deepEqual(planServices(modules, SEED, { base: kept, wiring: emptyWiring() }), planServices(modules, SEED));
});
