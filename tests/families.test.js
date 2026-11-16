import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, MAX_BRIDGE_MM, MAX_OVERHANG_DEG, CONNECTOR_CLEARANCE_MM } from '../js/config.js';
import { FAMILIES, canSupport, normalizeVariant } from '../js/core/catalog.js';
import { instanceCells, moduleAt, toBody, variantKey, worldFromModules } from '../js/core/grid.js';
import { BULGE, FLUSH, packProfiles, profilePlan } from '../js/core/profiles.js';
import { checkPlacement, hasTwoSupports, placementOf, supportsUnder, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { checkPrintability } from '../js/core/printability.js';
import { buildRecipe, RECIPE_IDS } from '../js/core/recipes.js';
import { generate } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { variantOf } from '../js/core/collection.js';
import { pegJoints } from '../js/core/exportplan.js';
import { PORT_TYPES, variantPorts } from '../js/core/ports.js';
import { simulate } from '../js/core/physics.js';
import { analyze } from '../js/core/analysis.js';
import { decorItems } from '../js/core/decor.js';
import { getRapier, getSolids } from './helpers.js';

const NEW_FAMILIES = ['penthouse', 'shacks', 'flared', 'strut'];
const SPANS = ['walkway', 'gantry'];
const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const ANGLE_TOL_DEG = 0.5; // slack the print check allows
const EDGE_MM = 0.5; // slice near the base and the top
const FLARE_MM = [3.5, 5]; // base inset range of a flared side
const SIZE_TOL_MM = 0.02; // rounding slack on mesh sizes

const part = (id, family, fp, h, x, y, z, rot = 0, extra = {}) => ({
  ...normalizeVariant({ family, fp, h, seed: 5, mask: 0, roof: false, ...extra }),
  id,
  x,
  y,
  z,
  rot,
});
const worldOf = (...parts) => worldFromModules(parts);
const allowed = (list, candidate) => checkPlacement(worldOf(...list), candidate);

const blocks = SEEDS.map((seed, index) => generate({ seed, scale: 'block', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }));
const megas = SEEDS.map((seed, index) => generate({ seed, scale: 'mega', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }));
const generated = [...blocks, ...megas];

async function printCheck(variant, connectors) {
  const solids = await getSolids();
  const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
  return { built, result: checkPrintability(built.solid, { pieces: built.parts }) };
}

function failedRules(result) {
  return Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name} ${JSON.stringify(rule.value)}`).join(', ');
}

// Variants of a family over footprints, heights and seeds
function variantsOf(id, seeds, mask = 15) {
  const family = FAMILIES[id];
  const list = [];
  for (const fp of family.footprints) {
    for (let h = family.minStories; h <= family.maxStories; h++) {
      for (const seed of seeds) list.push(normalizeVariant({ family: id, fp, h, seed, mask, roof: family.roofable && seed % 2 === 0 }));
    }
  }
  return list;
}

test('each new family has a catalog entry and a recipe', () => {
  for (const id of [...NEW_FAMILIES, ...SPANS]) {
    assert.ok(FAMILIES[id], `${id} in the catalog`);
    assert.ok(RECIPE_IDS.includes(id), `${id} recipe`);
  }
  for (const id of SPANS) {
    assert.ok(FAMILIES[id].spanning, `${id} spans`);
    assert.deepEqual(FAMILIES[id].footprints, ['1x3', '2x3']);
    assert.equal(placementOf(part(1, id, '1x3', 1, 0, 0, 0)), 'Spanning');
  }
  assert.equal(FAMILIES.walkway.group, 'Circulation');
  assert.ok(FAMILIES.strut.stack && !FAMILIES.strut.ground && !FAMILIES.strut.rails);
});

test('new variants print, with and without connectors', async () => {
  for (const id of [...NEW_FAMILIES, ...SPANS]) {
    for (const variant of [...variantsOf(id, [1, 2, 3, 4]), ...variantsOf(id, [5, 6], 5)]) {
      for (const connectors of [false, true]) {
        const { result } = await printCheck(variant, connectors);
        assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failedRules(result)}`);
      }
    }
  }
});

test('a penthouse cap ends the stack and the other variant carries one', () => {
  const tower = part(1, 'core', '2x2', 2, 0, 0, 0);
  const cap = part(2, 'penthouse', '2x2', 1, 0, 0, 2, 0, { roof: true, mask: 15 });
  const floor = part(2, 'penthouse', '2x2', 1, 0, 0, 2, 0, { mask: 15 });
  const above = part(3, 'housing', '2x2', 1, 0, 0, 3);
  assert.equal(placementOf(cap), 'Cap');
  assert.ok(!canSupport(cap) && canSupport(floor));
  assert.ok(allowed([tower], cap).ok);
  assert.ok(allowed([tower], floor).ok);
  assert.equal(allowed([tower, cap], above).ok, false);
  assert.ok(allowed([tower, floor], above).ok);
  assert.equal(checkStability([tower, floor, above].map(toBody)).status, 'pass');
});

test('generated penthouses have balconies on all sides but one', () => {
  const found = generated.flatMap((result) => result.modules.filter((instance) => instance.family === 'penthouse'));
  assert.ok(found.length >= 8, `penthouses in the seed set: ${found.length}`);
  for (const instance of found) {
    const facades = [0, 1, 2, 3].filter((side) => (instance.mask >> side) & 1).length;
    const plan = instance.prof ? profilePlan(instance) : [];
    const balconies = plan.filter((side) => side.reach > 0 && side.levels.length > 0).length;
    assert.equal(balconies, Math.min(3, facades), `penthouse ${instance.id} mask ${instance.mask} prof ${instance.prof}`);
  }
  assert.ok(found.some((instance) => instance.roof), 'a cap variant');
  assert.ok(found.some((instance) => !instance.roof), 'a carrying variant');
  const loaded = generated.some((result) => {
    const world = worldFromModules(result.modules);
    return result.modules.some(
      (instance) => instance.family === 'penthouse' && instanceCells(instance).some(([cellX, cellY]) => moduleAt(world, cellX, cellY, instance.z + instance.h))
    );
  });
  assert.ok(loaded, 'a penthouse carries a module');
});

test('stacked shacks put 2 to 4 seeded boxes on each outward side', () => {
  const boxesOf = (variant) => buildRecipe(variant, CONNECTOR_CLEARANCE_MM).ops.filter((op) => !op.cut && op.group !== 'glass' && op.shape.kind === 'prism');
  const counts = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const oneSide = normalizeVariant({ family: 'shacks', fp: '1x2', h: 3, seed, mask: 1, roof: false });
    const count = boxesOf(oneSide).length;
    assert.ok(count >= 2 && count <= 4, `seed ${seed}: ${count} boxes`);
    counts.add(count);
    const allSides = boxesOf({ ...oneSide, mask: 15 }).length;
    assert.ok(allSides >= 8 && allSides <= 16, `seed ${seed}: ${allSides} boxes on four sides`);
    assert.equal(boxesOf({ ...oneSide, mask: 0 }).length, 0, 'no shacks on connector sides');
  }
  assert.ok(counts.size >= 2, 'the count varies by seed');
  const low = normalizeVariant({ family: 'shacks', fp: '1x1', h: 1, seed: 3, mask: 1, roof: false });
  assert.equal(boxesOf(low).length, 2, 'one story still stacks two');
  const first = buildRecipe(low, CONNECTOR_CLEARANCE_MM).ops;
  assert.deepEqual(buildRecipe(low, CONNECTOR_CLEARANCE_MM).ops, first);
  assert.notDeepEqual(buildRecipe({ ...low, seed: 4 }, CONNECTOR_CLEARANCE_MM).ops, first);
});

test('shack boxes differ in size, shift and windows', () => {
  let compared = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const variant = normalizeVariant({ family: 'shacks', fp: '1x2', h: 3, seed, mask: 1, roof: false });
    const ops = buildRecipe(variant, CONNECTOR_CLEARANCE_MM).ops;
    const boxes = ops.filter((op) => !op.cut && op.group !== 'glass' && op.shape.kind === 'prism');
    const starts = new Set(boxes.map((op) => op.shape.from.toFixed(3)));
    const widths = new Set(boxes.map((op) => (op.shape.to - op.shape.from).toFixed(3)));
    assert.equal(starts.size, boxes.length, `seed ${seed} shifts`);
    assert.equal(widths.size, boxes.length, `seed ${seed} widths`);
    // The first cut is the bay, the rest are windows
    const windows = ops.filter((op) => op.cut).slice(1);
    if (windows.length < 2) continue;
    compared++;
    const sizes = new Set(windows.map((op) => (op.shape.to - op.shape.from).toFixed(3)));
    assert.equal(sizes.size, windows.length, `seed ${seed} windows`);
  }
  assert.ok(compared >= 6, `variants with two or more windows: ${compared}`);
});

test('shack overhangs stay inside the overhang rule', async () => {
  for (const variant of variantsOf('shacks', [11, 12, 13])) {
    const { result } = await printCheck(variant, true);
    assert.equal(result.rules.overhang.status, 'pass', variantKey(variant));
    assert.ok(result.rules.overhang.value <= MAX_OVERHANG_DEG + ANGLE_TOL_DEG, `${variantKey(variant)} overhang ${result.rules.overhang.value}`);
    assert.ok(result.rules.bridge.value <= MAX_BRIDGE_MM, `${variantKey(variant)} bridge ${result.rules.bridge.value}`);
  }
});

test('flared housing is wider at the top and slants 45 degrees or less', async () => {
  for (const variant of variantsOf('flared', [21, 22, 23]).filter((entry) => !entry.roof)) {
    const { built, result } = await printCheck(variant, false);
    const { positions } = built.solid;
    const height = variant.h * STORY_MM;
    const widthAt = (low, high) => {
      let min = Infinity;
      let max = -Infinity;
      for (let at = 0; at < positions.length; at += 3) {
        if (positions[at + 2] < low || positions[at + 2] > high) continue;
        min = Math.min(min, positions[at]);
        max = Math.max(max, positions[at]);
      }
      return max - min;
    };
    const base = widthAt(-EDGE_MM, EDGE_MM);
    const top = widthAt(height - EDGE_MM, height + EDGE_MM);
    const key = variantKey(variant);
    assert.ok(top - base >= 2 * FLARE_MM[0] - SIZE_TOL_MM && top - base <= 2 * FLARE_MM[1] + SIZE_TOL_MM, `${key} flare ${(top - base).toFixed(2)}`);
    assert.equal(result.rules.overhang.status, 'pass', key);
    assert.ok(result.rules.overhang.value <= MAX_OVERHANG_DEG + ANGLE_TOL_DEG, `${key} slant ${result.rules.overhang.value}`);
    assert.equal(result.status, 'pass', `${key}: ${failedRules(result)}`);
  }
});

test('a strut stands under a bulge as a normal module', () => {
  const tower = part(1, 'core', '1x1', 1, 0, 0, 0);
  const bulged = part(2, 'housing', '1x1', 2, 0, 0, 1, 0, { mask: 1, prof: packProfiles([BULGE, FLUSH, FLUSH, FLUSH]) });
  assert.equal(bulged.prof, packProfiles([BULGE, FLUSH, FLUSH, FLUSH]));
  const strut = part(3, 'strut', '1x1', 1, 1, 0, 0);
  assert.ok(allowed([tower, bulged], strut).ok, allowed([tower, bulged], strut).reason);
  assert.equal(allowed([tower, bulged], part(3, 'strut', '1x1', 2, 1, 0, 0)).ok, false, 'a taller strut meets the bulge');
  assert.equal(allowed([tower, bulged, strut], part(4, 'housing', '1x1', 1, 1, 0, 1)).ok, false, 'the bulge keeps its cell');
  assert.deepEqual(validateStructure(worldOf(tower, bulged, strut)), []);
  assert.equal(checkStability([tower, bulged, strut].map(toBody)).status, 'pass');
  // Away from any bulge it is a column that carries
  const alone = part(5, 'strut', '1x1', 2, 3, 3, 0);
  assert.ok(allowed([], alone).ok);
  assert.ok(allowed([alone], part(6, 'housing', '1x1', 1, 3, 3, 2)).ok);
  assert.ok(allowed([tower], part(7, 'strut', '1x1', 1, 0, 0, 1)).ok, 'on another module');
});

test('struts come as a pipe bundle and as a raking brace', async () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const variant = normalizeVariant({ family: 'strut', fp: '1x1', h: 1 + (seed % 3), seed, mask: 15, roof: false });
    const ops = buildRecipe(variant, CONNECTOR_CLEARANCE_MM).ops;
    kinds.add(ops.some((op) => op.shape.kind === 'prism') ? 'brace' : 'bundle');
    const { built, result } = await printCheck(variant, true);
    assert.equal(result.status, 'pass', `${variantKey(variant)}: ${failedRules(result)}`);
    assert.deepEqual(built.sockets.top, [0], 'head plate takes a peg');
  }
  assert.deepEqual([...kinds].sort(), ['brace', 'bundle']);
});

test('a bridge is legal only with both ends supported', () => {
  for (const family of SPANS) {
    for (const rot of [0, 1]) {
      const far = rot === 0 ? [2, 0] : [0, 2];
      const middle = rot === 0 ? [1, 0] : [0, 1];
      const left = part(1, 'core', '1x1', 2, 0, 0, 0);
      const right = part(2, 'core', '1x1', 2, far[0], far[1], 0);
      const bridge = part(3, family, '1x3', 1, 0, 0, 2, rot);
      const label = `${family} rot ${rot}`;
      assert.deepEqual(instanceCells(bridge), [[0, 0], middle, far], label);
      assert.ok(allowed([left, right], bridge).ok, label);
      assert.ok(hasTwoSupports(worldOf(left, right), bridge), label);
      assert.equal(supportsUnder(worldOf(left, right), bridge)[1], null, `${label} spans an empty cell`);
      assert.equal(allowed([left], bridge).reason, 'Needs support at both ends', label);
      assert.equal(allowed([right], bridge).reason, 'Needs support at both ends', label);
      const post = part(4, 'core', '1x1', 2, middle[0], middle[1], 0);
      assert.equal(allowed([post], bridge).reason, 'Needs support at both ends', `${label} on a middle post`);
      const tall = part(2, 'core', '1x1', 3, far[0], far[1], 0);
      assert.equal(allowed([left, tall], bridge).ok, false, `${label} ends at different levels`);
      assert.equal(allowed([left, right, bridge], part(5, 'housing', '1x1', 1, 0, 0, 3)).ok, false, `${label} carries nothing`);
      assert.equal(checkStability([left, right, bridge].map(toBody)).status, 'pass', label);
    }
  }
});

test('bridges pass the span rule at the unchanged limit and key onto both ends', async () => {
  assert.equal(MAX_BRIDGE_MM, 20);
  const solids = await getSolids();
  const sockets = new Map();
  const socketsOf = (instance) => {
    const key = variantKey(instance);
    if (!sockets.has(key)) sockets.set(key, solids.buildVariant(instance, { connectors: true, render: false, edges: false }).sockets);
    return sockets.get(key);
  };
  for (const family of SPANS) {
    for (const fp of FAMILIES[family].footprints) {
      for (const seed of [1, 2, 3]) {
        const variant = normalizeVariant({ family, fp, h: 1, seed, mask: 15, roof: false });
        const { built, result } = await printCheck(variant, true);
        assert.equal(result.status, 'pass', `${variantKey(variant)}: ${failedRules(result)}`);
        assert.ok(result.rules.bridge.value <= MAX_BRIDGE_MM, `${variantKey(variant)} span ${result.rules.bridge.value}`);
        const ends = fp === '1x3' ? [0, 2] : [0, 2, 3, 5];
        for (const cell of ends) assert.ok(built.sockets.bottom.includes(cell), `${variantKey(variant)} socket under cell ${cell}`);
      }
    }
    const towers = [part(1, 'core', '1x1', 2, 0, 0, 0), part(2, 'core', '1x1', 2, 2, 0, 0)];
    const bridge = part(3, family, '1x3', 1, 0, 0, 2);
    assert.equal(pegJoints([...towers, bridge], socketsOf) - pegJoints(towers, socketsOf), 2, `${family} pegs at both ends`);
  }
});

test('a bridge on two towers stays up in physics', async () => {
  const RAPIER = await getRapier();
  for (const family of SPANS) {
    const modules = [part(1, 'core', '1x1', 2, 0, 0, 0), part(2, 'core', '1x1', 2, 2, 0, 0), part(3, family, '1x3', 1, 0, 0, 2)];
    assert.deepEqual(simulate(RAPIER, modules).fallen, [], family);
    assert.ok(simulate(RAPIER, modules.slice(1)).fallen.includes(3), `${family} falls with one end gone`);
  }
});

test('the generator bridges one cell gaps between supported cells', () => {
  let count = 0;
  const families = new Set();
  for (const result of generated) {
    const world = worldFromModules(result.modules);
    for (const instance of result.modules) {
      if (!SPANS.includes(instance.family)) continue;
      count++;
      families.add(instance.family);
      const label = `${result.seed} ${result.options.scale} ${instance.family} ${instance.id}`;
      assert.equal(instance.fp, '1x3', label);
      const cells = instanceCells(instance);
      const supports = supportsUnder(world, instance);
      assert.ok(supports[0] && supports[0] !== 'plinth' && supports[2] && supports[2] !== 'plinth', `${label} rests on both ends`);
      assert.notEqual(supports[0].id, supports[2].id, `${label} joins two modules`);
      assert.equal(supports[0].z + supports[0].h, instance.z, `${label} level`);
      assert.equal(supports[2].z + supports[2].h, instance.z, `${label} level`);
      assert.equal(moduleAt(world, cells[1][0], cells[1][1], instance.z - 1), null, `${label} gap is empty`);
      assert.ok(hasTwoSupports(world, instance), label);
    }
  }
  assert.ok(count >= megas.length, `gap bridges in the seed set: ${count}`);
  assert.deepEqual([...families].sort(), ['gantry', 'walkway']);
  const megaCount = megas.reduce((sum, result) => sum + result.modules.filter((instance) => SPANS.includes(instance.family)).length, 0);
  assert.ok(megaCount >= megas.length / 2, `megastructure gap bridges: ${megaCount}`);
});

test('every new family is reachable from Generate', () => {
  const seen = new Set(generated.flatMap((result) => result.modules.map((instance) => instance.family)));
  for (const id of [...NEW_FAMILIES, ...SPANS]) assert.ok(seen.has(id), `${id} generated`);
  for (const result of generated) {
    assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${result.seed} ${result.options.scale} rules`);
    assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${result.seed} ${result.options.scale} stability`);
  }
});

test('generated struts stand under a bulge of a neighbour', () => {
  let count = 0;
  for (const result of generated) {
    const world = worldFromModules(result.modules);
    for (const instance of result.modules) {
      if (instance.family !== 'strut') continue;
      count++;
      const back = [[-1, 0], [0, -1], [1, 0], [0, 1]][instance.rot];
      const owner = moduleAt(world, instance.x + back[0], instance.y + back[1], instance.z + instance.h);
      assert.ok(owner && owner.prof, `${result.seed} strut ${instance.id} faces a profiled module`);
      assert.equal(moduleAt(world, instance.x, instance.y, instance.z + instance.h), null, `${result.seed} strut ${instance.id} is under open air`);
    }
  }
  assert.ok(count >= 4, `struts in the seed set: ${count}`);
});

test('every new family is reachable from Build and saves as a part', () => {
  const build = createBuild();
  const place = (spec) => build.place(spec);
  assert.ok(place({ family: 'core', fp: '1x1', h: 2, seed: 1, mask: 0, roof: false, x: 0, y: 0, z: 0, rot: 0 }).ok);
  assert.ok(place({ family: 'core', fp: '1x1', h: 2, seed: 1, mask: 0, roof: false, x: 2, y: 0, z: 0, rot: 0 }).ok);
  for (const family of SPANS) {
    const variant = { family, fp: '1x3', h: 1, seed: 4, mask: 15, roof: true };
    const ghost = build.ghost(variant, 1.5 * CELL_MM, 0.5 * CELL_MM, 0);
    assert.ok(ghost.ok, `${family}: ${ghost.reason}`);
    assert.deepEqual([ghost.instance.x, ghost.instance.y, ghost.instance.z], [0, 0, 2]);
    const off = build.ghost(variant, 2.5 * CELL_MM, 0.5 * CELL_MM, 0);
    assert.equal(off.ok, false, `${family} one cell over`);
    assert.ok(variantOf(variant), `${family} saves`);
  }
  assert.ok(place({ family: 'walkway', fp: '1x3', h: 1, seed: 4, mask: 15, roof: true, x: 0, y: 0, z: 2, rot: 0 }).ok);
  const specs = [
    { family: 'penthouse', fp: '2x2', h: 1, seed: 2, mask: 15, roof: true, prof: packProfiles([BULGE, FLUSH, FLUSH, FLUSH]) },
    { family: 'penthouse', fp: '1x2', h: 2, seed: 2, mask: 15, roof: false },
    { family: 'shacks', fp: '1x2', h: 2, seed: 2, mask: 15, roof: false },
    { family: 'flared', fp: '2x2', h: 3, seed: 2, mask: 15, roof: false },
    { family: 'strut', fp: '1x1', h: 2, seed: 2, mask: 15, roof: false },
  ];
  const spots = [[-4, -2], [-4, 1], [-1, -4], [-1, 2], [3, 2]];
  specs.forEach((variant, index) => {
    const result = place({ ...variant, x: spots[index][0], y: spots[index][1], z: 0, rot: 0 });
    assert.ok(result.ok, `${variant.family}: ${result.reason}`);
    const saved = variantOf(variant);
    assert.ok(saved, `${variant.family} saves`);
    assert.equal(variantKey(saved), variantKey(normalizeVariant(variant)));
  });
  assert.equal(build.modules.length, 8);
  build.undo();
  assert.equal(build.modules.length, 7);
});

test('seats are a port type added as data', () => {
  assert.ok(PORT_TYPES.seat);
  const head = variantPorts(normalizeVariant({ family: 'strut', fp: '1x1', h: 2, seed: 1, mask: 15, roof: false }));
  assert.deepEqual(head.map((port) => [port.type, port.face, port.position[2]]), [['seat', 'top', 2 * STORY_MM]]);
  for (const family of SPANS) {
    const seats = variantPorts(normalizeVariant({ family, fp: '1x3', h: 1, seed: 1, mask: 15, roof: false }));
    assert.equal(seats.length, 3);
    assert.ok(seats.every((port) => port.type === 'seat' && port.face === 'bottom' && port.position[2] === 0));
  }
  const balconies = variantPorts(normalizeVariant({ family: 'penthouse', fp: '2x2', h: 1, seed: 1, mask: 7, roof: false })).filter((port) => port.type === 'balcony');
  assert.equal(balconies.length, 6, 'one balcony slot per facade cell edge');
});

test('decor stays out of the space a bulge reaches into', () => {
  const tower = part(1, 'core', '1x1', 1, 0, 0, 0);
  const bulged = part(2, 'housing', '1x1', 2, 0, 0, 1, 0, { mask: 1, prof: packProfiles([BULGE, FLUSH, FLUSH, FLUSH]) });
  const strut = part(3, 'strut', '1x1', 1, 1, 0, 0);
  const free = part(4, 'strut', '1x1', 1, 3, 3, 0);
  const modules = [tower, bulged, strut, free];
  const analysis = analyze(modules);
  let onFree = 0;
  for (let seed = 0; seed < 60; seed++) {
    const items = decorItems(analysis, modules, 'seed' + seed);
    assert.ok(items.every((item) => item.module !== strut.id), `seed ${seed} decor under the bulge`);
    onFree += items.filter((item) => item.module === free.id).length;
  }
  assert.ok(onFree > 0, 'a free strut head can carry decor');
});
