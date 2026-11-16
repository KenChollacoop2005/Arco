import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM } from '../js/config.js';
import { FAMILIES, PROFILE_FAMILIES, normalizeVariant } from '../js/core/catalog.js';
import { claimedCells, instanceCells, moduleAt, toBody, variantKey, worldFromModules } from '../js/core/grid.js';
import {
  PROFILE_IDS,
  PROFILE_FOOTPRINTS,
  FLUSH,
  INSET,
  INSET_BALCONY,
  INSET_BALCONY_OUT,
  BULGE,
  BULGE_BALCONY,
  WRAP,
  RESERVE_REACH_MM,
  RESERVE_SIDE_MM,
  packProfiles,
  profileBoxes,
  profileClaims,
  profileColliders,
  profileKinds,
  sideFrame,
} from '../js/core/profiles.js';
import { checkPlacement, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { createBuild, growOptions } from '../js/core/build.js';
import { generate, openingOptions } from '../js/core/generator.js';
import { variantOf, makeEntry, parseCollection, serializeCollection } from '../js/core/collection.js';
import { variantColliders, simulate } from '../js/core/physics.js';
import { assemblySteps } from '../js/core/assembly.js';
import { checkPrintability } from '../js/core/printability.js';
import { runChecks } from '../js/core/checks.js';
import { makeRng } from '../js/core/rng.js';
import { getRapier, getSolids } from './helpers.js';

const GAP = CONNECTOR_CLEARANCE_MM / 2;
const EPS_MM = 0.001; // rounding slack on mesh positions
const SWEEP_BUILDS = 400; // random variants in the suite sweep
const OUT_KINDS = [INSET_BALCONY_OUT, BULGE, BULGE_BALCONY, WRAP];
const KINDS = PROFILE_IDS.map((id, kind) => kind).filter((kind) => kind !== FLUSH);
const one = (kind, side = 0) => packProfiles([0, 1, 2, 3].map((index) => (index === side ? kind : FLUSH)));
const housing = (prof, extra = {}) => normalizeVariant({ family: 'housing', fp: '1x1', h: 2, seed: 7, mask: 15, roof: false, prof, ...extra });
const at = (variant, x, y, z, rot = 0, id = 0) => ({ ...variant, x, y, z, rot, id });
const profileFootprints = (family) => family.footprints.filter((fp) => PROFILE_FOOTPRINTS[fp]);

// Every kind on every side count, per family, footprint and height limit
function profiledVariants() {
  const variants = [];
  let seed = 101;
  for (const id of PROFILE_FAMILIES) {
    const family = FAMILIES[id];
    for (const fp of profileFootprints(family)) {
      for (const h of new Set([family.minStories, family.maxStories])) {
        for (const kind of KINDS) {
          const side = seed & 3;
          variants.push(normalizeVariant({ family: id, fp, h, seed: seed++, mask: 15, roof: false, prof: one(kind, side) }));
        }
        variants.push(normalizeVariant({ family: id, fp, h, seed: seed++, mask: 15, roof: family.roofable, prof: packProfiles([BULGE_BALCONY, INSET_BALCONY, INSET_BALCONY_OUT, BULGE]) }));
        variants.push(normalizeVariant({ family: id, fp, h, seed: seed++, mask: 7, roof: false, prof: packProfiles([WRAP, FLUSH, INSET, FLUSH]) }));
      }
    }
  }
  return variants;
}

function randomVariant(rng) {
  const family = FAMILIES[rng.pick(PROFILE_FAMILIES)];
  const mask = rng.int(1, 15);
  const kinds = [0, 1, 2, 3].map(() => (rng.chance(0.6) ? rng.pick(KINDS) : FLUSH));
  return normalizeVariant({
    family: family.id,
    fp: rng.pick(profileFootprints(family)),
    h: rng.int(family.minStories, family.maxStories),
    seed: rng.int(1, 0x7fffffff),
    mask,
    roof: family.roofable && rng.chance(0.3),
    prof: packProfiles(kinds),
  });
}

// Space a variant may fill: its cells and the claimed strips
function allowedBoxes(variant) {
  const [sizeX, sizeY] = PROFILE_FOOTPRINTS[variant.fp];
  const kinds = profileKinds(variant.prof);
  const claims = profileClaims(variant.prof);
  const boxes = [{ min: [GAP, GAP], max: [sizeX * CELL_MM - GAP, sizeY * CELL_MM - GAP] }];
  claims.sides.forEach((claimed, side) => {
    if (!claimed) return;
    const frame = sideFrame(variant.fp, side);
    const from = kinds[(side + 3) & 3] === WRAP ? -RESERVE_REACH_MM : RESERVE_SIDE_MM;
    const to = kinds[side] === WRAP ? frame.length + RESERVE_REACH_MM : frame.length - RESERVE_SIDE_MM;
    const corner = (along, out) => [frame.corner[0] + frame.tangent[0] * along + frame.normal[0] * out, frame.corner[1] + frame.tangent[1] * along + frame.normal[1] * out];
    const first = corner(from, -GAP);
    const second = corner(to, RESERVE_REACH_MM);
    boxes.push({ min: [Math.min(first[0], second[0]), Math.min(first[1], second[1])], max: [Math.max(first[0], second[0]), Math.max(first[1], second[1])] });
  });
  return boxes;
}

const inside = (boxes, x, y, z, slack) =>
  boxes.some((shape) => x >= shape.min[0] - slack && x <= shape.max[0] + slack && y >= shape.min[1] - slack && y <= shape.max[1] + slack && (shape.min.length < 3 || (z >= shape.min[2] - slack && z <= shape.max[2] + slack)));

function strays(mesh, boxes, slack) {
  let count = 0;
  for (let at3 = 0; at3 < mesh.positions.length; at3 += 3) {
    if (!inside(boxes, mesh.positions[at3], mesh.positions[at3 + 1], mesh.positions[at3 + 2], slack)) count++;
  }
  return count;
}

function printProblems(solids, variant, connectors) {
  const built = solids.buildVariant(variant, { render: false, edges: false, connectors });
  const result = checkPrintability(built.solid, { pieces: built.parts });
  if (result.status === 'pass') return '';
  const broken = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name}=${JSON.stringify(rule.value)}`);
  return `${variantKey(variant)} connectors=${connectors} ${broken.join(' ')}`;
}

test('profiles are kept on facade sides of profile families only', () => {
  const all = packProfiles([BULGE, INSET, BULGE_BALCONY, INSET_BALCONY]);
  assert.deepEqual(profileKinds(housing(all).prof), [BULGE, INSET, BULGE_BALCONY, INSET_BALCONY]);
  assert.deepEqual(profileKinds(housing(all, { mask: 5 }).prof), [BULGE, FLUSH, BULGE_BALCONY, FLUSH]);
  assert.equal('prof' in housing(all, { mask: 0 }), false);
  assert.equal('prof' in housing(all, { fp: 'L3' }), false);
  assert.equal('prof' in normalizeVariant({ family: 'pilotis', fp: '1x1', h: 1, seed: 1, mask: 15, prof: all }), false);
  assert.equal('prof' in normalizeVariant({ family: 'tank', fp: '1x1', h: 1, seed: 1, mask: 15, prof: all }), false);
  assert.equal('prof' in housing(one(WRAP, 0), { mask: 1 }), false);
  assert.deepEqual(profileKinds(housing(packProfiles([WRAP, BULGE, FLUSH, FLUSH])).prof), [WRAP, FLUSH, FLUSH, FLUSH]);
  assert.equal('prof' in housing(-3), false);
  assert.equal('prof' in housing(1.5), false);
});

test('old saved variants are flush and a saved profile reproduces exactly', () => {
  const old = { family: 'housing', fp: '1x1', h: 2, seed: 7, mask: 15, roof: false };
  assert.deepEqual(variantOf(old), old);
  assert.equal(variantKey(old), 'housing:1x1:2:7:15:0');
  const saved = housing(packProfiles([BULGE_BALCONY, FLUSH, INSET, FLUSH]));
  const entry = makeEntry(at(saved, 3, 1, 0, 2, 9), '');
  assert.deepEqual(entry.variant, saved);
  assert.notEqual(entry.key, variantKey(old));
  const parsed = parseCollection(serializeCollection([entry]));
  assert.deepEqual(parsed.entries[0].variant, saved);
  assert.deepEqual(profileBoxes(parsed.entries[0].variant), profileBoxes(saved));
});

test('protrusions stay inside their reserved space and flush sides stay in the cell', async () => {
  const solids = await getSolids();
  const rng = makeRng(4711);
  const variants = [...profiledVariants(), ...Array.from({ length: 60 }, () => randomVariant(rng))];
  for (const variant of variants) {
    const built = solids.buildVariant(variant, { render: false, edges: false });
    assert.equal(strays(built.solid, allowedBoxes(variant), EPS_MM), 0, `${variantKey(variant)} leaves its reserved space`);
    for (const shape of profileBoxes(variant)) {
      if (shape.sign < 0) continue;
      const flat = [{ min: shape.min, max: shape.max, positions: [...shape.min, ...shape.max] }];
      assert.equal(strays(flat[0], allowedBoxes(variant), EPS_MM), 0, `${variantKey(variant)} declares a box outside its reserved space`);
    }
  }
});

test('colliders match the declared list and cover the printed solid', async () => {
  const solids = await getSolids();
  for (const variant of profiledVariants()) {
    const declared = profileBoxes(variant).filter((shape) => shape.sign > 0).map((shape) => ({ kind: 'box', min: shape.min, max: shape.max }));
    const colliders = variantColliders(variant);
    assert.deepEqual(colliders, profileColliders(variant));
    assert.deepEqual(colliders.slice(colliders.length - declared.length), declared, variantKey(variant));
    const built = solids.buildVariant(variant, { render: false, edges: false });
    assert.equal(strays(built.solid, colliders, EPS_MM), 0, `${variantKey(variant)} has geometry outside its colliders`);
  }
  assert.equal(variantColliders(housing(0)).length, 1);
});

test('a claimed cell is reserved in placement', () => {
  const bulged = at(housing(one(BULGE, 0)), 0, 0, 0, 0, 1);
  const plain = housing(0);
  assert.deepEqual(claimedCells(bulged), [{ x: 1, y: 0, side: 0 }]);
  assert.deepEqual(claimedCells({ ...bulged, rot: 1 }), [{ x: 0, y: 1, side: 1 }]);
  assert.deepEqual(claimedCells(at(housing(one(INSET_BALCONY, 0)), 0, 0, 0)), []);
  const world = worldFromModules([bulged]);
  assert.deepEqual(checkPlacement(world, at(plain, 1, 0, 0)), { ok: false, reason: 'That space is kept clear for a balcony or bulge' });
  assert.equal(checkPlacement(world, at(plain, 0, 1, 0)).ok, true);
  assert.equal(checkPlacement(world, at(plain, 2, 0, 0)).ok, true);
  const beside = worldFromModules([at(plain, 1, 0, 0, 0, 1)]);
  assert.deepEqual(checkPlacement(beside, at(housing(one(BULGE, 0)), 0, 0, 0)), { ok: false, reason: 'A balcony or bulge needs open air on that side' });
  assert.equal(checkPlacement(beside, at(housing(one(BULGE, 0)), 0, 0, 0, 1)).ok, true);
  assert.equal(checkPlacement(beside, at(housing(one(INSET_BALCONY, 0)), 0, 0, 0)).ok, true);
  const edge = at(housing(one(BULGE_BALCONY, 0)), 4, 0, 0);
  assert.equal(checkPlacement(worldFromModules([]), { ...edge, prof: 0 }).ok, true);
  assert.deepEqual(checkPlacement(worldFromModules([]), edge), { ok: false, reason: 'A balcony or bulge would pass the plinth edge' });
});

test('claims may face each other across a cell but not meet at a corner', () => {
  const west = at(housing(one(BULGE_BALCONY, 0)), 0, 0, 0, 0, 1);
  const world = worldFromModules([west]);
  assert.equal(checkPlacement(world, at(housing(one(BULGE_BALCONY, 2)), 2, 0, 0)).ok, true);
  assert.deepEqual(checkPlacement(world, at(housing(one(BULGE, 1)), 1, -1, 0)), { ok: false, reason: 'Two balconies or bulges would meet there' });
  const wrap = at(housing(one(WRAP, 0)), 0, 0, 0, 0, 1);
  assert.deepEqual(claimedCells(wrap), [{ x: 1, y: 0, side: 0 }, { x: 1, y: 1, side: -1 }, { x: 0, y: 1, side: 1 }]);
  const corner = worldFromModules([wrap]);
  for (const [cellX, cellY] of [[1, 0], [1, 1], [0, 1]]) {
    assert.equal(checkPlacement(corner, at(housing(0), cellX, cellY, 0)).ok, false, `${cellX},${cellY}`);
  }
  assert.equal(checkPlacement(corner, at(housing(0), -1, 0, 0)).ok, true);
  const tall = worldFromModules([at(housing(0, { h: 3, fp: '1x1' }), 1, 0, 0, 0, 1)]);
  assert.equal(checkPlacement(tall, at(housing(one(BULGE, 0), { h: 1 }), 0, 0, 0)).ok, false);
  const low = worldFromModules([at(housing(0, { h: 1 }), 1, 0, 0, 0, 1), at(housing(0, { h: 1 }), 0, 0, 0, 0, 2)]);
  assert.equal(checkPlacement(low, at(housing(one(BULGE, 0), { h: 1 }), 0, 0, 1)).ok, true);
});

test('build refuses reserved cells and illegal protrusions with a reason', () => {
  const build = createBuild();
  assert.equal(build.place(at(housing(one(BULGE, 0)), 0, 0, 0)).ok, true);
  assert.equal(build.modules[0].prof, one(BULGE, 0));
  const before = build.modules;
  assert.deepEqual(build.place(at(housing(0), 1, 0, 0)), { ok: false, reason: 'That space is kept clear for a balcony or bulge' });
  const ghost = build.ghost(housing(0), 1.5 * CELL_MM, 0.5 * CELL_MM, 0);
  assert.deepEqual([ghost.ok, ghost.reason], [false, 'That space is kept clear for a balcony or bulge']);
  assert.equal(build.modules, before);
  assert.equal(build.place(at(housing(0), 0, 1, 0)).ok, true);
  assert.deepEqual(build.rotate(1), { ok: false, reason: 'A balcony or bulge needs open air on that side' });
  assert.deepEqual(build.place(at(housing(one(BULGE, 3)), 0, 2, 0)), { ok: false, reason: 'A balcony or bulge needs open air on that side' });
  assert.equal(build.place(at(housing(one(BULGE, 1)), 0, 2, 0)).ok, true);
  assert.equal(build.undo(), true);
  assert.equal(build.modules.length, 2);
});

const SEEDS = ['habitat', 'nakagin', 'trellick', 'barbican', 'unite', 'x9', 'park hill', 'k7m2qp'];
const SCALES = [['block', {}], ['block', { density: 2, height: 2, daring: 2 }], ['mega', {}]];

// Modules standing in a cell another module claims
function trespassers(modules) {
  const world = worldFromModules(modules);
  const found = [];
  for (const instance of modules) {
    for (const claim of claimedCells(instance)) {
      for (let level = instance.z; level < instance.z + instance.h; level++) {
        const other = moduleAt(world, claim.x, claim.y, level);
        if (other) found.push(`${instance.id} claims ${claim.x},${claim.y},${level} held by ${other.id}`);
      }
    }
  }
  return found;
}

test('the generator picks profiles by seed, mostly flush, legal and stable', () => {
  let profiled = 0;
  let eligible = 0;
  const kinds = new Set();
  for (const seed of SEEDS) {
    for (const [scale, choices] of SCALES) {
      const result = generate({ seed, scale, ...choices });
      assert.equal(generate({ seed, scale, ...choices }).hash, result.hash, `${seed} ${scale} repeats`);
      assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${seed} ${scale} rules`);
      assert.deepEqual(trespassers(result.modules), [], `${seed} ${scale} reserved cells`);
      assert.equal(runChecks(result.modules).stability, 'pass', `${seed} ${scale} stability`);
      assert.equal(assemblySteps(result.modules).ok, true, `${seed} ${scale} assembly`);
      for (const instance of result.modules) {
        if (instance.prof) {
          assert.deepEqual(normalizeVariant(instance).prof, instance.prof, `${seed} ${scale} module ${instance.id}`);
          assert.equal(instance.prof & ~instanceProfileMask(instance), 0, `${seed} ${scale} module ${instance.id} profile on a railed side`);
          profiled++;
          for (const kind of profileKinds(instance.prof)) kinds.add(kind);
        }
        if (FAMILIES[instance.family].profiles && PROFILE_FOOTPRINTS[instance.fp] && instance.mask) eligible++;
      }
    }
  }
  assert.ok(profiled > 0, 'some modules get profiles');
  assert.ok(profiled < eligible / 2, `mostly flush: ${profiled} of ${eligible}`);
  assert.deepEqual([...kinds].sort(), PROFILE_IDS.map((id, kind) => kind), 'every kind appears in the seed set');
});

// Bits of the facade sides in prof
function instanceProfileMask(instance) {
  let bits = 0;
  for (let side = 0; side < 4; side++) if ((instance.mask >> side) & 1) bits |= 7 << (3 * side);
  return bits;
}

test('grow keeps profiled modules and stays out of their reserved cells', () => {
  const choices = { density: 1, height: 1, daring: 1, theme: 1 };
  for (const seed of SEEDS.slice(0, 4)) {
    const base = generate({ seed, scale: 'block', ...choices });
    const grown = generate(growOptions({ seed: 'grow-' + seed, scale: 'mega', ...choices }, base.modules));
    const after = new Map(grown.modules.map((instance) => [instance.id, instance]));
    for (const instance of base.modules) assert.deepEqual(after.get(instance.id), instance);
    assert.ok(grown.modules.length > base.modules.length);
    assert.deepEqual(trespassers(grown.modules), [], `${seed} reserved cells`);
    assert.deepEqual(validateStructure(worldFromModules(grown.modules)), [], `${seed} rules`);
  }
  const hand = [at(housing(packProfiles([WRAP, FLUSH, BULGE_BALCONY, FLUSH]), { h: 3 }), 0, 0, 0, 0, 1)];
  const grown = generate(growOptions({ seed: 'around', scale: 'block', ...choices, density: 2 }, hand));
  assert.deepEqual(grown.modules.find((instance) => instance.id === 1), hand[0]);
  assert.ok(grown.modules.length > 4);
  assert.deepEqual(trespassers(grown.modules), []);
  for (const instance of grown.modules) {
    for (const [cellX, cellY] of instanceCells(instance)) {
      const reserved = [[1, 0], [1, 1], [0, 1], [-1, 0]].some(([claimX, claimY]) => claimX === cellX && claimY === cellY);
      assert.ok(!reserved || instance.z >= 3, `module ${instance.id} stands in a reserved cell`);
    }
  }
});

test('protrusion mass moves the center of mass by the hand-calculated amount', () => {
  const flush = at(housing(0), 0, 0, 0, 0, 1);
  const bulged = at(housing(one(BULGE_BALCONY, 0)), 0, 0, 0, 0, 1);
  const boxes = profileBoxes(bulged);
  assert.ok(boxes.some((shape) => shape.part === 'bulge') && boxes.some((shape) => shape.part === 'balcony'));
  let volume = CELL_MM * CELL_MM * 2 * STORY_MM;
  let momentX = volume * CELL_MM / 2;
  let momentY = volume * CELL_MM / 2;
  for (const shape of boxes) {
    const lump = (shape.max[0] - shape.min[0]) * (shape.max[1] - shape.min[1]) * (shape.max[2] - shape.min[2]);
    volume += lump;
    momentX += lump * (shape.min[0] + shape.max[0]) / 2;
    momentY += lump * (shape.min[1] + shape.max[1]) / 2;
  }
  const com = checkStability([toBody(bulged)]).modules.get(1).com;
  assert.ok(Math.abs(com.x - momentX / volume) < 1e-9 && Math.abs(com.y - momentY / volume) < 1e-9);
  assert.ok(com.x > CELL_MM / 2 + 0.2, `center moves outward: ${com.x}`);
  assert.equal(checkStability([toBody(flush)]).modules.get(1).com.x, CELL_MM / 2);
  const turned = checkStability([toBody({ ...bulged, rot: 1 })]).modules.get(1).com;
  assert.ok(Math.abs(turned.y - momentX / volume) < 1e-9 && Math.abs(turned.x - (CELL_MM - momentY / volume)) < 1e-9);
  const notched = checkStability([toBody(at(housing(one(INSET, 0)), 0, 0, 0, 0, 1))]).modules.get(1).com;
  assert.ok(notched.x < CELL_MM / 2);
});

test('a protrusion can tip a block that stands without it', () => {
  // Upper block rests on x 0 to 14.5; flush center 12.5 leaves 2 mm
  const lower = { id: 1, rects: [[-10.5, 0, 14.5, 25]], z0: 0, z1: 25 };
  const upper = (lumps) => ({ id: 2, rects: [[0, 0, 25, 25]], z0: 25, z1: 50, lumps });
  assert.equal(checkStability([lower, upper()]).modules.get(2).status, 'pass');
  // 1500 mm3 at x 28: center (195312.5 + 42000) / 17125 = 13.857, margin 0.643
  const light = checkStability([lower, upper([{ volume: 1500, x: 28, y: 12.5 }])]).modules.get(2);
  assert.ok(Math.abs(light.com.x - 237312.5 / 17125) < 1e-9);
  assert.equal(light.status, 'warn');
  // 4000 mm3 at x 30: center (195312.5 + 120000) / 19625 = 16.067, past the edge
  const heavy = checkStability([lower, upper([{ volume: 4000, x: 30, y: 12.5 }])]).modules.get(2);
  assert.ok(Math.abs(heavy.com.x - 315312.5 / 19625) < 1e-9);
  assert.equal(heavy.status, 'fail');
});

test('a profiled stack stays up in physics', async () => {
  const stack = [
    at(normalizeVariant({ family: 'core', fp: '2x2', h: 3, seed: 3, mask: 15, roof: false, prof: one(BULGE, 1) }), 0, 0, 0, 0, 1),
    at(normalizeVariant({ family: 'housing', fp: '2x2', h: 2, seed: 5, mask: 15, roof: false, prof: packProfiles([WRAP, FLUSH, BULGE_BALCONY, INSET_BALCONY]) }), 0, 0, 3, 0, 2),
    at(normalizeVariant({ family: 'housing', fp: '1x1', h: 2, seed: 6, mask: 15, roof: false, prof: one(BULGE_BALCONY, 0) }), 1, 1, 5, 0, 3),
  ];
  assert.equal(runChecks(stack).stability, 'pass');
  assert.deepEqual(simulate(await getRapier(), stack).fallen, []);
  const block = generate({ seed: 'habitat', scale: 'block' });
  assert.ok(block.modules.some((instance) => instance.prof));
  assert.deepEqual(simulate(await getRapier(), block.modules).fallen, []);
});

test('every profile on every profile family is printable, with and without connectors', async () => {
  const solids = await getSolids();
  const failures = [];
  for (const variant of profiledVariants()) {
    for (const connectors of [false, true]) {
      const problem = printProblems(solids, variant, connectors);
      if (problem) failures.push(problem);
    }
  }
  assert.deepEqual(failures, []);
});

test('a random sweep of profiled variants is printable', async () => {
  const solids = await getSolids();
  const rng = makeRng(20261116);
  const failures = [];
  for (let build = 0; build < SWEEP_BUILDS; build++) {
    const problem = printProblems(solids, randomVariant(rng), build % 2 === 1);
    if (problem) failures.push(problem);
  }
  assert.deepEqual(failures, []);
});

test('profiled modules of generated structures are printable', async () => {
  const solids = await getSolids();
  const failures = [];
  const seen = new Set();
  const structures = [generate({ seed: 'habitat', scale: 'mega' }), generate({ seed: 'nakagin', scale: 'block', density: 2, height: 2 }), generate(openingOptions('k7m2qp'))];
  for (const instance of structures.flatMap((structure) => structure.modules)) {
    if (!instance.prof || seen.has(variantKey(instance))) continue;
    seen.add(variantKey(instance));
    const problem = printProblems(solids, instance, true);
    if (problem) failures.push(problem);
  }
  assert.ok(seen.size > 10);
  assert.deepEqual(failures, []);
});

test('facing claims at different levels still have an assembly order', () => {
  const build = createBuild();
  assert.equal(build.place(at(housing(one(BULGE, 0), { h: 3 }), 0, 0, 0)).ok, true);
  assert.equal(build.place(at(housing(0, { h: 1 }), 2, 0, 0)).ok, true);
  assert.equal(build.place(at(housing(one(BULGE, 2), { h: 1 }), 2, 0, 1)).ok, true);
  assert.equal(build.place(at(housing(0, { h: 1 }), 2, 0, 2)).ok, true);
  const steps = assemblySteps(build.modules);
  assert.deepEqual(steps.blocked, []);
  assert.equal(steps.steps.length, 4);
});
