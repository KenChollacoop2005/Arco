import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, WATER_SOURCES, POWER_SUPPLY, POWER_RELAYS, WHEEL_UP_CAP } from '../js/config.js';
import { FAMILIES, JUNCTION_FAMILIES, DISABLED_FAMILIES, normalizeVariant } from '../js/core/catalog.js';
import { toBody, variantKey, worldFromModules, instanceCells } from '../js/core/grid.js';
import { checkPlacement, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { checkPrintability } from '../js/core/printability.js';
import { RECIPE_IDS, buildRecipe } from '../js/core/recipes.js';
import { generate } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { variantOf } from '../js/core/collection.js';
import { assemblySteps } from '../js/core/assembly.js';
import { variantMounts, MOUNT_PORTS, structureMounts } from '../js/core/mounts.js';
import { stringContext, pathBlocked } from '../js/core/strings.js';
import { pourPaths, pourQuads, POURING, FLOW_LENGTH_MM, FLOW_FADE_SHARE } from '../js/core/falls.js';
import { planWater, solveWater } from '../js/core/water.js';
import { planPower, powerRole } from '../js/core/power.js';
import { planServices } from '../js/core/services.js';
import { streamOf, streamFrom, streamRecord, onStream, STREAM_REASON, STREAM_TURN_REASON, WHEEL_REASON } from '../js/core/stream.js';
import { formOf, TURBINE_FORMS, SOLAR_FORMS } from '../js/core/pieces.js';
import { getSolids } from './helpers.js';

// New families and the ports each must have
const PIECES = {
  generator: ['power'],
  spring: ['water-out'],
  raincatcher: ['water-out'],
  well: ['water-out', 'power'],
  wheel: ['power'],
  wheelup: ['water-in', 'water-out', 'power'],
  runoff: ['water-in'],
  disposal: ['water-in'],
  arch: [],
};
const part = (id, family, fp, h, x, y, z, extra = {}) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false, ...extra }), id, x, y, z, rot: extra.rot || 0 });

function variantsOf(id, seeds) {
  const family = FAMILIES[id];
  const list = [];
  for (const fp of family.footprints) {
    for (let h = family.minStories; h <= family.maxStories; h++) for (const seed of seeds) list.push(normalizeVariant({ family: id, fp, h, seed, mask: seed % 16, roof: false }));
  }
  return list;
}

// Seeds with and without a stream, until every new family has shown up
let found = null;
function generated() {
  if (found) return found;
  found = { results: [], seen: new Map() };
  const seeds = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg', 'brunswick', 'lumen', 'golden', 'tower0', 'beton', 'pavilion', 'rotunda', 'quarry'];
  for (const [index, seed] of seeds.entries()) {
    for (const scale of ['block', 'mega']) {
      const result = generate({ seed, scale, density: 2 - (index % 2), height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 });
      found.results.push(result);
      for (const instance of result.modules) found.seen.set(instance.family, (found.seen.get(instance.family) || 0) + 1);
    }
    if (Object.keys(PIECES).every((id) => DISABLED_FAMILIES.includes(id) || found.seen.get(id) > 0) && found.results.length >= 12) break;
  }
  return found;
}

test('each new family has a catalog entry, a recipe and its ports', () => {
  for (const [id, types] of Object.entries(PIECES)) {
    assert.ok(FAMILIES[id], `${id} in the catalog`);
    assert.ok(RECIPE_IDS.includes(id), `${id} recipe`);
    for (const variant of variantsOf(id, [1, 2, 3])) {
      const ports = variantMounts(variant);
      for (const type of types) assert.ok(ports.some((port) => port.type === type), `${variantKey(variant)} ${type}`);
    }
  }
  assert.ok(MOUNT_PORTS.generator && variantMounts(normalizeVariant({ family: 'generator', fp: '1x2', h: 1, seed: 1, mask: 15 })).filter((port) => port.type === 'power').length >= 4, 'generator has several power ports');
  assert.ok(FAMILIES.spring.ground && FAMILIES.well.ground && FAMILIES.wheel.ground && FAMILIES.arch.ground);
  assert.ok(FAMILIES.arch.stack && FAMILIES.arch.rails, 'the arch carries modules like a base');
  assert.equal(normalizeVariant({ family: 'arch', fp: '1x1', h: 1, seed: 1, mask: 0 }).mask & 0b0101, 0b0101, 'arch ends stay open');
  // Pumps and pumped tanks now take power
  for (const id of ['smallpump', 'pumptank']) assert.ok(variantMounts(normalizeVariant({ family: id, fp: '1x1', h: 1, seed: 2, mask: 15 })).some((port) => port.type === 'power'), `${id} power port`);
});

test('new families and every turbine and solar form print, with and without connectors', async () => {
  const solids = await getSolids();
  const variants = [...Object.keys(PIECES).flatMap((id) => variantsOf(id, [1, 2, 3, 4, 5])), ...variantsOf('turbine', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...variantsOf('solar', [1, 2, 3, 4, 5, 6, 7, 8])];
  for (const variant of variants) {
    for (const connectors of [false, true]) {
      const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
      const result = checkPrintability(built.solid, { pieces: built.parts });
      const failed = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name} ${JSON.stringify(rule.value)}`);
      assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failed}`);
    }
  }
});

test('the arch prints by its shape: a pointed crown steeper than 45 degrees, no flat crown', () => {
  const { ops } = buildRecipe(normalizeVariant({ family: 'arch', fp: '1x1', h: 1, seed: 1, mask: 15 }));
  const tunnel = ops.find((op) => op.cut);
  const crown = tunnel.shape.poly.reduce((best, point) => (point[1] > best[1] ? point : best));
  const springing = tunnel.shape.poly.filter((point) => point[1] > 0 && point[1] < crown[1]);
  for (const point of springing) {
    const slope = Math.atan2(crown[1] - point[1], Math.abs(crown[0] - point[0])) * (180 / Math.PI);
    assert.ok(slope > 45, `crown slope ${slope} degrees`);
  }
});

test('turbines and solar arrays come in several forms by seed, and vary within a form', () => {
  const turbine = new Set();
  const solar = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    turbine.add(formOf(normalizeVariant({ family: 'turbine', fp: '1x1', h: 2, seed, mask: 15 })));
    solar.add(formOf(normalizeVariant({ family: 'solar', fp: '1x1', h: 1, seed, mask: 15 })));
  }
  assert.deepEqual([...turbine].sort(), [...TURBINE_FORMS].sort());
  assert.deepEqual([...solar].sort(), [...SOLAR_FORMS].sort());
  // Two seeds of one form differ in size; a taller turbine stands taller
  const threes = [];
  for (let seed = 1; threes.length < 2; seed++) if (formOf({ family: 'turbine', seed }) === 'three') threes.push(seed);
  const reach = (seed, h) => {
    const blades = buildRecipe(normalizeVariant({ family: 'turbine', fp: '1x1', h, seed, mask: 15 })).ops.filter((op) => op.group === 'blade');
    return Math.max(...blades.flatMap((op) => op.shape.poly.map((point) => point[1])));
  };
  assert.notEqual(reach(threes[0], 2), reach(threes[1], 2));
  assert.ok(reach(threes[0], 3) > reach(threes[0], 2));
  // Spinning parts carry their axle
  const three = buildRecipe(normalizeVariant({ family: 'turbine', fp: '1x1', h: 2, seed: threes[0], mask: 15 }));
  assert.ok(three.anchors.spinX && three.anchors.spinX.length === 1);
  const wheel = buildRecipe(normalizeVariant({ family: 'wheel', fp: '1x1', h: 1, seed: 1, mask: 15 }));
  assert.ok(wheel.anchors.spinY && wheel.ops.some((op) => op.group === 'wheel'));
});

test('new families are reachable from Generate in legal, standing structures', () => {
  const { results, seen } = generated();
  for (const result of results) {
    assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${result.seed} ${result.options.scale} rules`);
    assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${result.seed} ${result.options.scale} stability`);
    assert.ok(assemblySteps(result.modules).ok, `${result.seed} ${result.options.scale} assembly`);
    // Stream cells hold only wheels and arches at plinth level, turned with the flow
    const stream = streamFrom(result.stream);
    for (const instance of result.modules) {
      if (instance.z !== 0) continue;
      for (const [cellX, cellY] of instanceCells(instance)) {
        if (!onStream(stream, cellX, cellY)) continue;
        assert.ok(['wheel', 'arch'].includes(instance.family), `${result.seed} ${instance.family} on the stream`);
        assert.equal((instance.rot & 1) === 0, stream.alongX);
      }
    }
  }
  for (const id of Object.keys(PIECES)) {
    // Switched off families are never generated
    if (DISABLED_FAMILIES.includes(id)) assert.ok(!seen.has(id), `${id} not generated`);
    else assert.ok(seen.get(id) > 0, `${id} generated`);
  }
  // An arch carries something above it somewhere
  const carried = results.some((result) => result.modules.some((arch) => arch.family === 'arch' && result.modules.some((other) => other.z === 1 && instanceCells(other).some(([x, y]) => x === arch.x && y === arch.y))));
  assert.ok(carried, 'a megastructure continues over the stream');
  assert.ok(results.some((result) => result.modules.some((instance) => instance.jb)), 'some junction boxes');
});

test('the stream: seeded, refuses ordinary modules, takes turned wheels and arches', () => {
  let record = null;
  let seed = 0;
  while (!record) record = streamOf('stream' + seed++);
  assert.deepEqual(streamOf('stream' + (seed - 1)), record, 'same seed, same stream');
  assert.deepEqual(streamRecord(streamFrom(streamRecord(record))), streamRecord(record), 'round trip as a plain record');
  const [cellX, cellY] = record.cells[Math.floor(record.cells.length / 2)];
  const along = record.alongX ? 0 : 1;
  const world = worldFromModules([]);
  const at = (family, rot, z = 0, extra = {}) => ({ ...part(1, family, '1x1', 1, cellX, cellY, z, extra), rot });
  assert.equal(checkPlacement(world, at('housing', 0), { stream: record }).reason, STREAM_REASON);
  assert.ok(checkPlacement(world, at('arch', along), { stream: record }).ok);
  assert.equal(checkPlacement(world, at('arch', 1 - along), { stream: record }).reason, STREAM_TURN_REASON);
  assert.ok(checkPlacement(world, at('wheel', along + 2), { stream: record }).ok);
  // A wheel off the stream, or with no stream at all, is refused
  const dry = [cellX + (record.alongX ? 0 : 2), cellY + (record.alongX ? 2 : 0)];
  assert.equal(checkPlacement(world, { ...at('wheel', 0), x: dry[0], y: dry[1] }, { stream: record }).reason, WHEEL_REASON);
  assert.equal(checkPlacement(world, at('wheel', along), { stream: null }).reason, WHEEL_REASON);
  // Build says why, and the arch carries what is placed on it
  const build = createBuild([], { stream: record });
  const ghost = build.ghost(normalizeVariant({ family: 'housing', fp: '1x1', h: 1, seed: 1, mask: 15 }), (cellX + 0.5) * 25, (cellY + 0.5) * 25, 0);
  assert.equal(ghost.reason, STREAM_REASON);
  assert.ok(build.place({ family: 'arch', fp: '1x1', h: 1, seed: 1, mask: 0, x: cellX, y: cellY, z: 0, rot: along }).ok);
  assert.ok(build.place({ family: 'housing', fp: '1x1', h: 2, seed: 1, mask: 15, x: cellX, y: cellY, z: 1, rot: 0 }).ok, 'a module stands on the arch');
});

test('new families are reachable from Build and save as parts, junction boxes included', () => {
  const build = createBuild();
  const specs = [
    { family: 'core', fp: '1x1', h: 2, seed: 1, mask: 0, x: 0, y: 0, z: 0 },
    { family: 'generator', fp: '1x2', h: 2, seed: 7, mask: 15, x: -3, y: 0, z: 0 },
    { family: 'spring', fp: '1x2', h: 1, seed: 2, mask: 15, x: 2, y: -3, z: 0 },
    { family: 'well', fp: '1x1', h: 1, seed: 2, mask: 15, x: -2, y: -3, z: 0 },
    { family: 'raincatcher', fp: '1x1', h: 1, seed: 3, mask: 15, x: 0, y: 0, z: 2 },
    { family: 'core', fp: '1x1', h: 1, seed: 1, mask: 0, x: 3, y: 2, z: 0 },
    { family: 'housing', fp: '1x1', h: 2, seed: 4, mask: 15, x: -3, y: 3, z: 0, jb: 1 },
    { family: 'runoff', fp: '1x1', h: 1, seed: 4, mask: 15, x: -3, y: 3, z: 2 },
    { family: 'disposal', fp: '1x1', h: 1, seed: 4, mask: 15, x: 4, y: -1, z: 0 },
    { family: 'arch', fp: '1x1', h: 1, seed: 4, mask: 0, x: 1, y: 3, z: 0 },
  ];
  for (const spec of specs) {
    const result = build.place({ ...spec, roof: false, rot: 0 });
    assert.ok(result.ok, `${spec.family}: ${result.reason}`);
    const saved = variantOf(spec);
    assert.ok(saved, `${spec.family} saves`);
    assert.equal(variantKey(saved), variantKey(normalizeVariant(spec)));
  }
  // Switched off families are refused, as a ghost and when placed
  const raised = { family: 'wheelup', fp: '1x1', h: 1, seed: 3, mask: 15, x: 3, y: 2, z: 1, roof: false, rot: 0 };
  const refused = build.place(raised);
  assert.equal(refused.ok, false, 'wheelup placed');
  assert.equal(refused.reason, build.ghost(normalizeVariant(raised), 3.5 * CELL_MM, 2.5 * CELL_MM, 0).reason);
  // The junction box lives in the record, only where it may go
  assert.equal(variantOf({ family: 'housing', fp: '1x1', h: 2, seed: 4, mask: 15, jb: 1 }).jb, 1);
  assert.equal(normalizeVariant({ family: 'turbine', fp: '1x1', h: 2, seed: 4, mask: 15, jb: 1 }).jb, undefined);
  assert.notEqual(variantKey({ ...specs[6] }), variantKey({ ...specs[6], jb: 0 }));
  for (const family of JUNCTION_FAMILIES) {
    const relays = (jb) => variantMounts(normalizeVariant({ family, fp: FAMILIES[family].footprints[0], h: FAMILIES[family].minStories, seed: 5, mask: 15, jb })).filter((port) => port.relay);
    assert.equal(relays(0).length, 0, family);
    assert.equal(relays(1).length, 1, family);
  }
});

test('springs, rain catchers and wells feed water; a well only with full power', () => {
  // Gravity sources by the numbers in the table
  assert.deepEqual(WATER_SOURCES.spring.slice(0, 2), [2, null]);
  assert.deepEqual(WATER_SOURCES.rain.slice(0, 2), [1, null]);
  assert.deepEqual(WATER_SOURCES.well, [3, 6, 3]);
  // A well beside a farm: water only when the well is powered
  const modules = [part(1, 'well', '1x1', 1, 0, 0, 0), part(2, 'farm', '1x1', 1, 1, 0, 0)];
  const ports = structureMounts(modules);
  const context = stringContext(modules);
  const off = planWater(modules, 'well', { ports, context, powered: new Set() });
  const on = planWater(modules, 'well', { ports, context, powered: new Set([1]) });
  assert.equal(off.pumps[1].runs, false);
  assert.equal(on.pumps[1].runs, true);
  assert.equal(off.consumers[2].received, 0);
  assert.equal(on.consumers[2].status, 'full');
  assert.equal(on.solved.totals.supplied, 3);
  // A spring and a rain catcher are gravity sources of 2 and 1
  const springs = [part(1, 'spring', '1x1', 1, 0, 0, 0), part(2, 'raincatcher', '1x1', 1, 3, 0, 0)];
  const fed = planWater(springs, 'spring', { ports: structureMounts(springs), context: stringContext(springs), powered: new Set() });
  const sourceOf = (id) => fed.nodes.find((node) => node.module === id && node.kind === 'source');
  assert.deepEqual([sourceOf(1).supply, sourceOf(1).head], [2, null]);
  assert.deepEqual([sourceOf(2).supply, sourceOf(2).head], [1, null]);
  // The spout no longer stands in for a rain catcher
  const spout = [part(1, 'spout', '1x1', 1, 0, 0, 0)];
  assert.equal(planWater(spout, 'spout', { ports: structureMounts(spout), context: stringContext(spout) }).solved.totals.supplied, 0);
});

test('water wheels: a base wheel makes 3, a raised wheel 1 per unit of gravity water up to 3, and the water goes on', () => {
  assert.deepEqual(powerRole({ family: 'wheel', h: 1, fp: '1x1' }), { kind: 'source', supply: POWER_SUPPLY.wheel[0], reach: POWER_SUPPLY.wheel[1] });
  const raised = (units) => powerRole({ id: 5, family: 'wheelup', h: 1, fp: '1x1' }, { 5: units }).supply;
  assert.deepEqual([raised(0), raised(1.5), raised(2), raised(5)], [0, 1.5, 2, WHEEL_UP_CAP]);
  // Water through a wheel junction carries on to the farm below
  const nodes = [{ id: 'tank', kind: 'source', supply: 2, head: null, level: 3 }, { id: 'wheel', kind: 'main', supply: 0, head: null, level: 2 }, { id: 'farm', kind: 'consumer', supply: 0, demand: 1, head: null, level: 1 }];
  const links = [{ id: 0, from: 'tank', to: 'wheel', flat: 1, up: 0, length: 10 }, { id: 1, from: 'wheel', to: 'farm', flat: 1, up: 0, length: 10 }];
  const solved = solveWater({ nodes, links });
  // Only what the farm can use passes, so the wheel turns on 1 unit
  assert.equal(solved.nodes.wheel.received, 1);
  assert.equal(solved.nodes.farm.taken, 1);
  // In a services plan, raised wheels make power from the gravity run only, never pumped water
  for (const result of generated().results) {
    if (!result.modules.some((instance) => instance.family === 'wheelup')) continue;
    const plan = planServices(result.modules, result.seed);
    const gravity = planWater(result.modules, result.seed, { powered: new Set() });
    for (const node of plan.power.nodes.filter((entry) => result.modules.find((instance) => instance.id === entry.module).family === 'wheelup')) {
      const passing = (gravity.solved.nodes[String(node.module)] || { received: 0 }).received;
      assert.equal(node.supply, Math.min(WHEEL_UP_CAP, Math.floor(passing * 2) / 2));
    }
  }
});

test('a junction box is a small relay of its own on its module', () => {
  const modules = [part(1, 'turbine', '1x1', 2, -2, 0, 0), part(2, 'housing', '1x1', 2, 1, 0, 0, { jb: 1, mask: 0b0100 })];
  const power = planPower(modules, 'box', { ports: structureMounts(modules), context: stringContext(modules) });
  const box = power.nodes.find((node) => node.id === '2:box');
  assert.ok(box, 'junction box node');
  assert.deepEqual([box.kind, box.reach, box.throughput], ['relay', POWER_RELAYS.junction[0], POWER_RELAYS.junction[1]]);
  assert.ok(power.nodes.some((node) => node.id === '2' && node.kind === 'consumer'));
});

test('runoff and disposal: a full body with 2 to 5 printed stubs, 1 or 2 pouring, and pours that fall straight from past the cell edge and fade, clear of modules', async () => {
  const solids = await getSolids();
  const counts = new Set();
  for (const family of POURING) {
    for (let seed = 1; seed <= 24; seed++) {
      const variant = normalizeVariant({ family, fp: '1x1', h: 1, seed: seed * 7919, mask: 15, roof: true });
      const { ops, anchors } = buildRecipe(variant);
      const stubs = ops.filter((op) => !op.cut && (op.group === 'steel' || op.group === 'rust') && op.shape.kind === 'prism');
      counts.add(stubs.length);
      assert.ok(stubs.length >= 2 && stubs.length <= 5, `${family} ${seed} stubs ${stubs.length}`);
      assert.ok(anchors.outlet.length >= 1 && anchors.outlet.length <= 2, `${family} ${seed} pouring ${anchors.outlet.length}`);
      // Stubs are printed: the whole part passes the print rules
      const built = solids.buildVariant(variant, { connectors: seed % 2 === 0, render: false, edges: false });
      assert.equal(checkPrintability(built.solid, { pieces: built.parts }).status, 'pass', `${family} ${seed} prints`);
    }
  }
  assert.ok(counts.size >= 3, `stub counts vary: ${[...counts]}`);
  // Pours in generated structures
  let pours = 0;
  for (let index = 0; index < 30; index++) {
    const seed = 'p' + index;
    const { modules } = generate({ seed, scale: index % 2 ? 'mega' : 'block', density: index % 3, height: 1, services: 'high' });
    const context = stringContext(modules);
    const byId = new Map(modules.map((instance) => [instance.id, instance]));
    for (const pour of pourPaths(modules, context)) {
      pours++;
      const name = `${seed} ${pour.family} ${pour.module}`;
      const [top, foot] = pour.points;
      // Starts past its own cell edge, outward along the stub
      const module = byId.get(pour.module);
      const past = Math.min(...instanceCells(module).map(([cellX, cellY]) => Math.max(cellX * CELL_MM - top[0], top[0] - (cellX + 1) * CELL_MM, cellY * CELL_MM - top[1], top[1] - (cellY + 1) * CELL_MM)));
      assert.ok(past > 1, `${name} starts past the cell edge (${past.toFixed(2)} mm)`);
      // Straight down, within its seeded length
      assert.equal(pour.points.length, 2, `${name} two points`);
      assert.ok(foot[0] === top[0] && foot[1] === top[1] && foot[2] <= top[2], `${name} falls straight`);
      assert.ok(pour.length >= FLOW_LENGTH_MM[0] - 1e-9 && pour.length <= FLOW_LENGTH_MM[1] + 1e-9, `${name} length`);
      assert.ok(pour.fadeStart >= pour.length * FLOW_FADE_SHARE[0] - 1e-9 && pour.fadeStart <= pour.length * FLOW_FADE_SHARE[1] + 1e-9, `${name} fade start`);
      assert.ok(Math.abs(top[2] - foot[2] - pour.drop) < 1e-9 && pour.drop <= pour.length + 1e-9, `${name} drop`);
      // Full at the top; one that never lands fades to exactly zero
      const quads = pourQuads(pour);
      if (pour.drop > 0) {
        assert.equal(quads[0][0].fade, 1, `${name} full at the top`);
        if (pour.drop >= pour.length - 1e-9) assert.equal(quads.at(-1)[2].fade, 0, `${name} fades out`);
        assert.ok(quads.every((quad) => quad.every((corner) => corner.point[0] === top[0] || corner.point[1] === top[1])), `${name} crossed sheets`);
      }
      if (top[2] > 0) assert.equal(pathBlocked(context, [top, [foot[0], foot[1], Math.max(foot[2], 0)]], [pour.module]), null, `${name} through a module`);
      assert.ok(POURING.includes(byId.get(pour.module).family));
    }
  }
  assert.ok(pours >= 8, `pours ${pours}`);
});
