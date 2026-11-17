import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, STABILITY_MARGIN, CONNECTOR_CLEARANCE_MM } from '../js/config.js';
import { FAMILIES, PROFILE_FAMILIES, normalizeVariant } from '../js/core/catalog.js';
import { toBody, cellInPlinth, claimedCells, instanceCells, moduleAt, variantKey, worldFromModules } from '../js/core/grid.js';
import {
  BULGE,
  BULGE_BALCONY,
  FLUSH,
  INSET,
  JETTY,
  JETTY_BRACE_RAKE,
  JETTY_SUPPORTS,
  PROFILE_FOOTPRINTS,
  PROFILE_IDS,
  RESERVE_REACH_MM,
  packProfiles,
  profileBoxes,
  profileKinds,
  profilePlan,
} from '../js/core/profiles.js';
import { checkPlacement, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { createBuild, growOptions } from '../js/core/build.js';
import { generate } from '../js/core/generator.js';
import { variantOf, makeEntry, parseCollection, serializeCollection } from '../js/core/collection.js';
import { simulate, variantColliders } from '../js/core/physics.js';
import { assemblySteps } from '../js/core/assembly.js';
import { checkPrintability } from '../js/core/printability.js';
import { runChecks } from '../js/core/checks.js';
import { makeRng } from '../js/core/rng.js';
import { getRapier, getSolids } from './helpers.js';

const GAP = CONNECTOR_CLEARANCE_MM / 2; // printed side gap per module
const EPS_MM = 0.001; // rounding slack

const part = (id, family, fp, h, x, y, z, rot = 0, extra = {}) => ({
  ...normalizeVariant({ family, fp, h, seed: 5, mask: 0, roof: false, ...extra }),
  id,
  x,
  y,
  z,
  rot,
});
const one = (kind, side = 0) => packProfiles([0, 1, 2, 3].map((index) => (index === side ? kind : FLUSH)));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= EPS_MM, `${label}: ${actual} against ${expected}`);

// A studio half off a 1x1, over the side that may carry a bulge
function halfOff(prof, seed = 5) {
  return [
    part(1, 'core', '1x1', 1, 0, 0, 0),
    part(2, 'housing', '1x1', 1, 0, 0, 1, 0, { mask: 1, prof, seed }),
    part(3, 'studio', '1x2', 1, 0, 0, 2, 0, { mask: 15 }),
  ];
}

test('the top of a bulge counts as support in the static check', () => {
  // Without a bulge the studio sits on a knife edge: a warning
  const plain = checkStability(halfOff(0).map(toBody));
  assert.equal(plain.modules.get(3).status, 'warn');
  near(plain.modules.get(3).margin, 0, 'center of mass on the cell edge');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const modules = halfOff(one(BULGE), seed);
    const bulge = profileBoxes(modules[1]).find((shape) => shape.part === 'bulge');
    const depth = bulge.max[0] - bulge.min[0];
    near(bulge.min[0], CELL_MM - GAP, 'bulge starts at the printed face');
    near(bulge.max[2], STORY_MM, 'bulge top is the module top');
    const body = toBody(modules[1]);
    assert.equal(body.tops.length, 2);
    near(body.tops[1].z, 2 * STORY_MM, 'ledge height');
    const result = checkStability(modules.map(toBody));
    assert.equal(result.modules.get(3).status, 'pass', `seed ${seed}`);
    // By hand: support now reaches the strip's inset edge, or its middle if narrow
    const reach = depth > 2 * STABILITY_MARGIN ? depth - STABILITY_MARGIN : depth / 2;
    const strict = checkStability(modules.map(toBody), { margin: STABILITY_MARGIN, skipGlobal: true });
    assert.equal(strict.modules.get(3).status, 'pass');
    near(result.modules.get(3).margin, depth - GAP, `seed ${seed} margin to the bulge edge`);
    assert.ok(reach - GAP > 0, 'the center of mass is inside the inset support');
  }
});

test('a module on a bulge alone, or beside an inset, is still refused', () => {
  // A 1x1 over the claimed cell rests on the strip only
  const strip = [...halfOff(one(BULGE)).slice(0, 2), part(3, 'studio', '1x1', 1, 1, 0, 2, 0, { mask: 15 })];
  const alone = checkStability(strip.map(toBody));
  assert.equal(alone.modules.get(3).status, 'fail');
  assert.equal(alone.modules.get(3).reason, 'Load falls outside its support');
  // An inset adds no ledge, its piers keep the cell edge
  const inset = checkStability(halfOff(one(INSET)).map(toBody));
  assert.equal(inset.modules.get(3).status, 'warn', 'an inset leaves the knife edge');
  // A bulge on another side does not help
  assert.equal(checkStability(halfOff(one(BULGE, 1)).map(toBody)).modules.get(3).status, 'warn');
  // A balcony top is below the module top, so nothing rests on it
  const balcony = toBody(halfOff(one(BULGE_BALCONY))[1]);
  assert.ok(balcony.tops.slice(2).every((ledge) => ledge.z < 2 * STORY_MM), 'balcony tops are lower ledges');
});

test('physics agrees: the studio stays on the bulge and falls without it', async () => {
  const RAPIER = await getRapier();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const modules = halfOff(one(BULGE), seed);
    assert.equal(checkStability(modules.map(toBody)).status, 'pass', `seed ${seed} static`);
    assert.deepEqual(simulate(RAPIER, modules).fallen, [], `seed ${seed} physics`);
  }
  assert.ok(simulate(RAPIER, halfOff(0)).fallen.includes(3), 'the knife edge falls');
  const strip = [...halfOff(one(BULGE)).slice(0, 2), part(3, 'studio', '1x1', 1, 1, 0, 2, 0, { mask: 15 })];
  assert.ok(simulate(RAPIER, strip).fallen.includes(3), 'a module on the strip alone falls');
});

// Jettied overhangs

const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const SWEEP_BUILDS = 400; // random variants in the suite sweep
const RESERVED_REASON = 'That space is kept clear for a balcony or bulge';
const AIR_REASON = 'A balcony or bulge needs open air on that side';
const jettied = (family, fp, h, seed, prof, extra = {}) => normalizeVariant({ family, fp, h, seed, mask: 15, roof: false, prof, ...extra });
const placed = (variant, x, y, z, rot = 0, id = 0) => ({ ...variant, x, y, z, rot, id });
const profileFootprints = (family) => family.footprints.filter((fp) => PROFILE_FOOTPRINTS[fp]);

// First seed whose jetty on a side has the wanted support
function withSupport(family, fp, h, support, side = 0, extra = {}) {
  for (let seed = 1; seed < 500; seed++) {
    const variant = jettied(family, fp, h, seed, one(JETTY, side), extra);
    if (profilePlan(variant)[side].jetty.support === support) return variant;
  }
  throw new Error(`no seed gives ${support}`);
}

function printProblems(solids, variant, connectors) {
  const built = solids.buildVariant(variant, { render: false, edges: false, connectors });
  const result = checkPrintability(built.solid, { pieces: built.parts });
  if (result.status === 'pass') return '';
  const broken = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name}=${JSON.stringify(rule.value)}`);
  return `${variantKey(variant)} connectors=${connectors} ${broken.join(' ')}`;
}

// Mesh vertices past the printed face of local side 0
function pastFace(mesh, width) {
  const points = [];
  for (let at3 = 0; at3 < mesh.positions.length; at3 += 3) {
    if (mesh.positions[at3] > width - GAP + EPS_MM) points.push([mesh.positions[at3], mesh.positions[at3 + 1], mesh.positions[at3 + 2]]);
  }
  return points;
}

test('a jetty is stored in the variant record and rebuilds the same part', async () => {
  const variant = jettied('housing', '1x1', 2, 7, one(JETTY, 1));
  assert.deepEqual(profileKinds(variant.prof), [FLUSH, JETTY, FLUSH, FLUSH]);
  assert.ok(variantKey(variant).endsWith(':' + variant.prof));
  // Railed sides, other families and L footprints stay flush
  assert.equal(jettied('housing', '1x1', 2, 7, one(JETTY, 1), { mask: 13 }).prof, undefined);
  assert.equal(jettied('pilotis', '1x1', 2, 7, one(JETTY, 1)).prof, undefined);
  assert.equal(jettied('housing', FAMILIES.housing.footprints.find((fp) => !PROFILE_FOOTPRINTS[fp]), 2, 7, one(JETTY, 1)).prof, undefined);
  // The plan comes from the record alone
  const jetty = profilePlan(variant)[1].jetty;
  assert.deepEqual(profilePlan({ ...variant })[1].jetty, jetty);
  assert.ok(JETTY_SUPPORTS.includes(jetty.support));
  assert.ok(jetty.out >= 0.12 * CELL_MM && jetty.out <= 0.2 * CELL_MM, `depth ${jetty.out}`);
  assert.ok(jetty.out <= RESERVE_REACH_MM);
  near(jetty.start, STORY_MM, 'a two story jetty starts at the story line');
  assert.ok(profilePlan(jettied('housing', '1x1', 2, 7, one(BULGE, 1))).every((side) => side.jetty === null));
  // Saved and loaded through the collection file
  const loaded = parseCollection(serializeCollection([makeEntry(variant, '')]));
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.entries[0].variant, variant);
  assert.deepEqual(variantOf({ ...variant, id: 9, x: 1, y: 2, z: 0, rot: 3 }), variant);
  const solids = await getSolids();
  const first = solids.buildVariant(variant, { render: false, edges: false, connectors: true }).solid;
  const second = solids.buildVariant(loaded.entries[0].variant, { render: false, edges: false, connectors: true }).solid;
  assert.deepEqual(Array.from(second.positions), Array.from(first.positions));
  assert.deepEqual(Array.from(second.index), Array.from(first.index));
});

test('the printed jetty matches its plan for corbel, brace and arch', async () => {
  const solids = await getSolids();
  for (const support of JETTY_SUPPORTS) {
    for (const stories of [1, 2, 3]) {
      const variant = withSupport('housing', '1x1', stories, support);
      const { out, start, drop } = profilePlan(variant)[0].jetty;
      near(drop, (support === 'brace' ? JETTY_BRACE_RAKE : 1) * out, `${support} drop`);
      assert.ok(start - drop > 0 && start < stories * STORY_MM, `${support} h${stories} foot above the bed`);
      const points = pastFace(solids.buildVariant(variant, { render: false, edges: false, connectors: false }).solid, CELL_MM);
      assert.ok(points.length > 0);
      const reach = Math.max(...points.map((point) => point[0]));
      near(reach, CELL_MM - GAP + out, `${support} h${stories} reach`);
      near(Math.max(...points.map((point) => point[2])), stories * STORY_MM, `${support} h${stories} top`);
      // The front face starts at the jetty foot, nothing hangs lower than the support
      const front = points.filter((point) => point[0] > reach - EPS_MM);
      near(Math.min(...front.map((point) => point[2])), start, `${support} h${stories} foot`);
      assert.ok(Math.min(...points.map((point) => point[2])) >= start - drop - EPS_MM, `${support} h${stories} lowest point`);
      // Everything past the wall is inside the declared boxes
      const boxes = profileBoxes(variant).filter((shape) => shape.sign > 0);
      assert.deepEqual(boxes.map((shape) => shape.part), ['jetty', 'corbel']);
      for (const [x, y, z] of points) {
        assert.ok(boxes.some((shape) => [x, y, z].every((value, axis) => value >= shape.min[axis] - EPS_MM && value <= shape.max[axis] + EPS_MM)), `${support} point ${x},${y},${z} outside the declared boxes`);
      }
    }
  }
});

test('jetty and support boxes are in the collider list and the static mass', () => {
  for (const support of JETTY_SUPPORTS) {
    const variant = withSupport('housing', '1x2', 2, support, 1);
    const boxes = profileBoxes(variant, CONNECTOR_CLEARANCE_MM / 2).filter((shape) => shape.sign > 0);
    const colliders = variantColliders(variant);
    for (const shape of boxes) {
      assert.ok(colliders.some((collider) => collider.min.every((value, axis) => Math.abs(value - shape.min[axis]) < EPS_MM) && collider.max.every((value, axis) => Math.abs(value - shape.max[axis]) < EPS_MM)), `${support} ${shape.part} collider`);
    }
    assert.equal(colliders.length, 1 + boxes.length);
    // Center of mass by hand: the body plus both boxes
    const instance = placed(variant, 0, 0, 0, 0, 1);
    let volume = 2 * CELL_MM * CELL_MM * 2 * STORY_MM;
    let momentX = volume * CELL_MM;
    let momentY = volume * CELL_MM / 2;
    for (const shape of profileBoxes(variant)) {
      const lump = (shape.max[0] - shape.min[0]) * (shape.max[1] - shape.min[1]) * (shape.max[2] - shape.min[2]);
      volume += lump;
      momentX += lump * (shape.min[0] + shape.max[0]) / 2;
      momentY += lump * (shape.min[1] + shape.max[1]) / 2;
    }
    const com = checkStability([toBody(instance)]).modules.get(1).com;
    assert.ok(Math.abs(com.x - momentX / volume) < 1e-9 && Math.abs(com.y - momentY / volume) < 1e-9, `${support} center of mass`);
    assert.ok(com.y > CELL_MM / 2 + 0.1, `${support} center moves outward: ${com.y}`);
  }
});

test('a jetty reserves the next cell in placement and Build', () => {
  const build = createBuild();
  assert.equal(build.place(placed(jettied('housing', '1x1', 2, 7, one(JETTY, 0)), 0, 0, 0)).ok, true);
  assert.deepEqual(build.place(placed(jettied('housing', '1x1', 1, 7, 0), 1, 0, 0)), { ok: false, reason: RESERVED_REASON });
  assert.deepEqual(build.place(placed(jettied('housing', '1x1', 3, 7, 0), 1, 0, 0)), { ok: false, reason: RESERVED_REASON });
  assert.equal(build.place(placed(jettied('housing', '1x1', 2, 7, 0), 0, 1, 0)).ok, true);
  // A jetty needs open air, and may not face the wall beside it
  assert.deepEqual(build.place(placed(jettied('housing', '1x1', 2, 7, one(JETTY, 3)), 0, 2, 0)), { ok: false, reason: AIR_REASON });
  assert.equal(build.place(placed(jettied('housing', '1x1', 2, 7, one(JETTY, 1)), 0, 2, 0)).ok, true);
  assert.equal(build.modules.length, 3);
  assert.deepEqual(validateStructure(worldFromModules(build.modules)), []);
  // Rotation moves the claim with the side
  const turned = placed(jettied('housing', '1x1', 2, 7, one(JETTY, 0)), 3, 3, 0, 1, 5);
  assert.deepEqual(claimedCells(turned).map((claim) => [claim.x, claim.y]), [[3, 4]]);
  // The claimed cell must be on the plinth
  const world = worldFromModules([]);
  const edge = [0, 1, 2, 3, 4, 5, 6].find((cellX) => !cellInPlinth(cellX + 1, 0));
  assert.equal(checkPlacement(world, placed(jettied('housing', '1x1', 2, 7, 0), edge, 0, 0, 0, 1)).ok, true);
  assert.equal(checkPlacement(world, placed(jettied('housing', '1x1', 2, 7, one(JETTY, 0)), edge, 0, 0, 0, 1)).ok, false);
  // A module may stand over the jetty when it rests on the body
  const stack = createBuild();
  assert.equal(stack.place(placed(jettied('core', '1x1', 1, 7, 0, { mask: 0 }), 0, 0, 0)).ok, true);
  assert.equal(stack.place(placed(jettied('housing', '1x1', 1, 7, one(JETTY, 0), { mask: 1 }), 0, 0, 1)).ok, true);
  assert.equal(stack.place(placed(jettied('studio', '1x2', 1, 7, 0), 0, 0, 2)).ok, true);
});

test('grow keeps a jettied module and stays out of its reserved cells', () => {
  const choices = { density: 2, height: 1, daring: 1, theme: 1 };
  const hand = [placed(jettied('housing', '1x1', 3, 7, packProfiles([JETTY, FLUSH, JETTY, FLUSH])), 0, 0, 0, 0, 1)];
  for (const seed of ['around', 'beside', 'again']) {
    const grown = generate(growOptions({ seed, scale: 'block', ...choices }, hand));
    assert.deepEqual(grown.modules.find((instance) => instance.id === 1), hand[0]);
    assert.ok(grown.modules.length > 4, `${seed} grew`);
    assert.deepEqual(validateStructure(worldFromModules(grown.modules)), [], `${seed} rules`);
    assert.equal(runChecks(grown.modules).stability, 'pass', `${seed} stability`);
    assert.equal(assemblySteps(grown.modules).ok, true, `${seed} assembly`);
    for (const instance of grown.modules) {
      for (const [cellX, cellY] of instanceCells(instance)) {
        const reserved = (cellX === 1 || cellX === -1) && cellY === 0;
        assert.ok(!reserved || instance.z >= 3, `${seed} module ${instance.id} stands in a reserved cell`);
      }
    }
  }
});

test('the top of a jetty carries in the static check and in physics', async () => {
  const RAPIER = await getRapier();
  assert.ok(simulate(RAPIER, halfOff(0)).fallen.includes(3), 'the knife edge falls without a jetty');
  for (const support of JETTY_SUPPORTS) {
    const housing = withSupport('housing', '1x1', 1, support, 0, { mask: 1 });
    const modules = halfOff(housing.prof, housing.seed);
    const { out } = profilePlan(modules[1])[0].jetty;
    const result = checkStability(modules.map(toBody));
    assert.equal(result.status, 'pass', `${support} static`);
    near(result.modules.get(3).margin, out - GAP, `${support} margin to the jetty edge`);
    assert.deepEqual(simulate(RAPIER, modules).fallen, [], `${support} physics`);
    // On the jetty alone a module is refused and falls
    const strip = [...modules.slice(0, 2), part(3, 'studio', '1x1', 1, 1, 0, 2, 0, { mask: 15 })];
    assert.equal(checkStability(strip.map(toBody)).modules.get(3).status, 'fail', `${support} strip static`);
    assert.ok(simulate(RAPIER, strip).fallen.includes(3), `${support} strip physics`);
  }
});

test('a jettied tower with a rider agrees in both checks', async () => {
  const RAPIER = await getRapier();
  // Four jetties on one module, a slab on top, a rider over the body
  const tower = [
    part(1, 'core', '1x1', 2, 0, 0, 0),
    { ...jettied('housing', '1x1', 2, 11, packProfiles([JETTY, JETTY, JETTY, JETTY])), id: 2, x: 0, y: 0, z: 2, rot: 0 },
    part(3, 'studio', '1x2', 1, 0, 0, 4, 0, { mask: 15 }),
    part(4, 'studio', '1x1', 2, 0, 0, 5, 0, { mask: 15 }),
  ];
  assert.deepEqual(validateStructure(worldFromModules(tower)), []);
  assert.equal(checkStability(tower.map(toBody)).status, 'pass');
  assert.deepEqual(simulate(RAPIER, tower).fallen, []);
  // The same rider moved out over the jetty tips the slab
  const tipped = [...tower.slice(0, 3), part(4, 'studio', '1x1', 2, 1, 0, 5, 0, { mask: 15 })];
  assert.equal(checkStability(tipped.map(toBody)).modules.get(3).status, 'fail');
  assert.ok(simulate(RAPIER, tipped).fallen.includes(3));
});

test('a jetty on every profile family prints, with and without connectors', async () => {
  const solids = await getSolids();
  const failures = [];
  let builds = 0;
  for (const id of PROFILE_FAMILIES) {
    const family = FAMILIES[id];
    for (const fp of profileFootprints(family)) {
      for (const stories of new Set([family.minStories, family.maxStories])) {
        const variants = JETTY_SUPPORTS.map((support, index) => withSupport(id, fp, stories, support, (index + stories) & 3));
        variants.push(jettied(id, fp, stories, 301 + builds, packProfiles([JETTY, JETTY, JETTY, JETTY]), { roof: family.roofable }));
        variants.push(jettied(id, fp, stories, 302 + builds, packProfiles([JETTY, BULGE_BALCONY, JETTY, INSET]), { roof: false }));
        for (const variant of variants) {
          for (const connectors of [false, true]) {
            builds++;
            const problem = printProblems(solids, variant, connectors);
            if (problem) failures.push(problem);
          }
        }
      }
    }
  }
  assert.ok(builds > 300, `builds ${builds}`);
  assert.deepEqual(failures, []);
});

test('a random sweep of jettied variants is printable', async () => {
  const solids = await getSolids();
  const rng = makeRng(20261117);
  const failures = [];
  const supports = new Set();
  for (let build = 0; build < SWEEP_BUILDS; build++) {
    const family = FAMILIES[rng.pick(PROFILE_FAMILIES)];
    const kinds = [0, 1, 2, 3].map(() => (rng.chance(0.5) ? JETTY : rng.int(0, PROFILE_IDS.length - 1)));
    const variant = normalizeVariant({
      family: family.id,
      fp: rng.pick(profileFootprints(family)),
      h: rng.int(family.minStories, family.maxStories),
      seed: rng.int(1, 0x7fffffff),
      mask: rng.int(1, 15),
      roof: family.roofable && rng.chance(0.3),
      prof: packProfiles(kinds),
    });
    for (const side of profilePlan(variant) || []) if (side.jetty) supports.add(side.jetty.support);
    const problem = printProblems(solids, variant, build % 2 === 1);
    if (problem) failures.push(problem);
  }
  assert.deepEqual([...supports].sort(), [...JETTY_SUPPORTS].sort());
  assert.deepEqual(failures, []);
});

test('the generator adds a few jetties, legal, stable and printable', async () => {
  const solids = await getSolids();
  const supports = new Set();
  const seen = new Set();
  const failures = [];
  let jetties = 0;
  let eligible = 0;
  for (const seed of SEEDS) {
    for (const options of [{ seed, scale: 'block' }, { seed, scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 }]) {
      const result = generate(options);
      assert.equal(generate(options).hash, result.hash, `${seed} ${options.scale} repeats`);
      const world = worldFromModules(result.modules);
      assert.deepEqual(validateStructure(world), [], `${seed} ${options.scale} rules`);
      assert.equal(runChecks(result.modules).stability, 'pass', `${seed} ${options.scale} stability`);
      assert.equal(assemblySteps(result.modules).ok, true, `${seed} ${options.scale} assembly`);
      for (const instance of result.modules) {
        if (FAMILIES[instance.family].profiles && PROFILE_FOOTPRINTS[instance.fp] && instance.mask) eligible++;
        if (!instance.prof || !profileKinds(instance.prof).includes(JETTY)) continue;
        jetties++;
        assert.deepEqual(normalizeVariant(instance).prof, instance.prof, `${seed} module ${instance.id} record`);
        const plan = profilePlan(instance);
        plan.forEach((side) => side.jetty && supports.add(side.jetty.support));
        // Nothing sits right over a jetty
        for (const claim of claimedCells(instance)) {
          const local = (claim.side - instance.rot + 4) & 3;
          if (claim.side >= 0 && plan[local].jetty) assert.equal(moduleAt(world, claim.x, claim.y, instance.z + instance.h), null, `${seed} module ${instance.id} roofed jetty`);
        }
        if (seen.has(variantKey(instance))) continue;
        seen.add(variantKey(instance));
        const problem = printProblems(solids, instance, true);
        if (problem) failures.push(problem);
      }
    }
  }
  assert.ok(jetties >= 10, `jetties in the seed set: ${jetties}`);
  assert.ok(jetties < eligible * 0.15, `mostly absent: ${jetties} of ${eligible}`);
  assert.deepEqual([...supports].sort(), [...JETTY_SUPPORTS].sort());
  assert.deepEqual(failures, []);
});
