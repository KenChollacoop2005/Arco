import test from 'node:test';
import assert from 'node:assert/strict';
import { BED_MM, CELL_MM, STORY_MM, MIN_WALL_MM, MAX_BRIDGE_MM, DOCK_LIP_MM, DOCK_HEAD_MM, RAIL_OFFSET_MM, RAIL_DEPTH_MM, CONNECTOR_CLEARANCE_MM } from '../js/config.js';
import { FAMILIES, FAMILY_IDS, DOCK_BRIDGES, PLUG_ENDS, PROFILE_FAMILIES, isDocked, normalizeVariant, sideType } from '../js/core/catalog.js';
import { FOOTPRINTS, SIDES, footprintCells, instanceCells, moduleAt, toBody, variantKey, worldFromModules } from '../js/core/grid.js';
import { dockSlots, plugRails, PLUG_RAIL_HALF_MM } from '../js/core/docks.js';
import { checkPlacement, hasTwoSupports, supportsUnder, validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { checkPrintability } from '../js/core/printability.js';
import { meshStats } from '../js/core/meshtools.js';
import { assemblyOrder, assemblySteps, partsFromModules } from '../js/core/assembly.js';
import { createBuild, growOptions } from '../js/core/build.js';
import { generate } from '../js/core/generator.js';
import { variantOf, makeEntry, parseCollection, serializeCollection } from '../js/core/collection.js';
import { simulate, variantColliders } from '../js/core/physics.js';
import { packProfiles, PROFILE_IDS } from '../js/core/profiles.js';
import { makeRng } from '../js/core/rng.js';
import { getRapier, getSolids } from './helpers.js';

const GAP = CONNECTOR_CLEARANCE_MM / 2; // printed side gap per module
const EPS_MM = 0.001; // rounding slack on mesh positions
const LENGTHS = [2, 3, 4, 5]; // docked bridge lengths in cells
const SEEDS = ['arco', 'habitat', 'nakagin', 'k7m2qp', 'barbican', 'trellick', 'x9', 'blacksburg'];
const SWEEP_BUILDS = 300; // random variants in the suite sweep
const PLUG_REASON = 'A docked bridge needs a dock face at both ends, at its own level';
const DOCK_REASON = 'A dock face only takes a bridge end at its base';
const GAP_REASON = 'A docked bridge needs an open gap under it';
const DOCK_FAMILIES = FAMILY_IDS.filter((id) => FAMILIES[id].docks);

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
// Housing with one dock side, facade on the rest
const dockHouse = (id, x, y, z, side, h = 1) => part(id, 'housing', '1x1', h, x, y, z, 0, { mask: 15 & ~(1 << side), dock: 1 << side });

// Two towers, a dock on each, and a bridge of n cells between them
function docked(cells, { family = 'walkway', rot = 0, level = 2, dockH = 1, shift = 0 } = {}) {
  const [stepX, stepY] = SIDES[rot];
  const far = [stepX * (cells + shift), stepY * (cells + shift)];
  const near = [stepX * (shift - 1), stepY * (shift - 1)];
  const low = Math.min(shift, shift + cells - 1);
  const high = Math.max(shift, shift + cells - 1);
  const origin = [stepX > 0 ? low : stepX < 0 ? -high : 0, stepY > 0 ? low : stepY < 0 ? -high : 0];
  return [
    part(1, 'core', '1x1', level, near[0], near[1], 0),
    part(2, 'core', '1x1', level, far[0], far[1], 0),
    dockHouse(3, near[0], near[1], level, rot, dockH),
    dockHouse(4, far[0], far[1], level, (rot + 2) & 3, dockH),
    part(5, family, '1x' + cells, 1, origin[0], origin[1], level, rot, { dock: PLUG_ENDS }),
  ];
}

const generated = SEEDS.flatMap((seed, index) => [
  generate({ seed, scale: 'block', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }),
  generate({ seed, scale: 'mega', density: index % 3, height: (index + 1) % 3, daring: (index + 2) % 3, theme: 2 }),
]);

async function printCheck(variant, connectors) {
  const solids = await getSolids();
  const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
  return { built, result: checkPrintability(built.solid, { pieces: built.parts }) };
}

const failedRules = (result) =>
  Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name} ${JSON.stringify(rule.value)}`).join(', ');

// Heights where a vertical line enters or leaves a mesh
function crossings(mesh, pointX, pointY) {
  const { positions, index } = mesh;
  const heights = [];
  for (let face = 0; face < index.length; face += 3) {
    const [a, b, c] = [index[face] * 3, index[face + 1] * 3, index[face + 2] * 3];
    const area = (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[c] - positions[a]) * (positions[b + 1] - positions[a + 1]);
    if (Math.abs(area) < 1e-9) continue;
    const weightB = ((pointX - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[c] - positions[a]) * (pointY - positions[a + 1])) / area;
    const weightC = ((positions[b] - positions[a]) * (pointY - positions[a + 1]) - (pointX - positions[a]) * (positions[b + 1] - positions[a + 1])) / area;
    if (weightB < 0 || weightC < 0 || weightB + weightC > 1) continue;
    heights.push(positions[a + 2] + weightB * (positions[b + 2] - positions[a + 2]) + weightC * (positions[c + 2] - positions[a + 2]));
  }
  return heights.sort((first, second) => first - second).filter((height, order, list) => order === 0 || height - list[order - 1] > EPS_MM);
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= EPS_MM, `${label}: ${actual} against ${expected}`);

test('the dock field is kept on connector sides and docked bridges only', () => {
  const plain = normalizeVariant({ family: 'housing', fp: '1x1', h: 1, seed: 3, mask: 6, roof: false });
  assert.equal('dock' in plain, false, 'old variants have no dock field');
  assert.equal(variantKey(plain), 'housing:1x1:1:3:6:0', 'old keys are unchanged');
  const dock = normalizeVariant({ ...plain, dock: 15 });
  assert.equal(dock.dock, 9, 'docks only on connector sides');
  assert.equal(variantKey(dock), 'housing:1x1:1:3:6:0:d9');
  assert.equal('dock' in normalizeVariant({ ...plain, mask: 15, dock: 15 }), false, 'no dock on a facade side');
  assert.equal('dock' in normalizeVariant({ family: 'pilotis', fp: '1x1', h: 1, seed: 3, mask: 0, dock: 1 }), false, 'pilotis has no body at the slot foot');
  assert.equal('dock' in normalizeVariant({ family: 'tank', fp: '1x1', h: 1, seed: 3, mask: 0, dock: 1 }), false, 'no dock without rails');
  for (const family of DOCK_BRIDGES) {
    assert.deepEqual(FAMILIES[family].dockFootprints, ['1x2', '1x3', '1x4', '1x5']);
    for (const cells of LENGTHS) {
      const bridge = normalizeVariant({ family, fp: '1x' + cells, h: 1, seed: 3, mask: 15, dock: 1 });
      assert.equal(bridge.dock, PLUG_ENDS, `${family} 1x${cells} docks at both ends`);
      assert.ok(isDocked(bridge));
      assert.deepEqual(variantOf(bridge), bridge, `${family} 1x${cells} saves`);
      assert.deepEqual(normalizeVariant(JSON.parse(JSON.stringify(bridge))), bridge, 'a saved part reproduces exactly');
    }
    assert.equal('dock' in normalizeVariant({ family, fp: '2x3', h: 1, seed: 3, mask: 15, dock: 5 }), false, 'the 2x3 is carried only');
    assert.equal(variantOf({ family, fp: '1x2', h: 1, seed: 3, mask: 15 }), null, 'a 1x2 exists docked only');
    assert.equal(variantOf({ family, fp: '1x4', h: 1, seed: 3, mask: 15 }), null, 'a 1x4 exists docked only');
    assert.equal('dock' in variantOf({ family, fp: '1x3', h: 1, seed: 3, mask: 15 }), false, 'the carried 1x3 is unchanged');
  }
  const file = parseCollection(serializeCollection([makeEntry(dock, ''), makeEntry(normalizeVariant({ family: 'gantry', fp: '1x5', h: 1, seed: 9, dock: 5 }), '')]));
  assert.deepEqual(file.entries.map((entry) => entry.variant.dock), [9, 5], 'docks survive the collection file');
});

test('dock and plug side types follow the rotation', () => {
  const house = dockHouse(1, 0, 0, 0, 1);
  for (let rot = 0; rot < 4; rot++) {
    const turned = { ...house, rot };
    for (let side = 0; side < 4; side++) assert.equal(sideType(turned, side), side === ((1 + rot) & 3) ? 'dock' : 'facade', `rot ${rot} side ${side}`);
    const bridge = part(2, 'walkway', '1x3', 1, 0, 0, 1, rot, { dock: PLUG_ENDS });
    for (let side = 0; side < 4; side++) assert.equal(sideType(bridge, side), (side & 1) === (rot & 1) ? 'plug' : 'clear', `bridge rot ${rot} side ${side}`);
  }
  assert.equal(sideType(part(3, 'walkway', '1x3', 1, 0, 0, 1), 0), 'clear', 'a carried bridge has no plugs');
});

test('every docked length fits the bed and prints, with and without connectors', async () => {
  assert.equal(MAX_BRIDGE_MM, 20);
  for (const family of DOCK_BRIDGES) {
    for (const cells of LENGTHS) {
      for (const seed of [1, 2, 3]) {
        const variant = normalizeVariant({ family, fp: '1x' + cells, h: 1, seed, mask: 15, dock: PLUG_ENDS });
        for (const connectors of [false, true]) {
          const { built, result } = await printCheck(variant, connectors);
          const label = `${variantKey(variant)} connectors ${connectors}`;
          assert.equal(result.status, 'pass', `${label}: ${failedRules(result)}`);
          const stats = meshStats(built.solid);
          const length = stats.max[0] - stats.min[0];
          assert.ok(length <= BED_MM, `${label} is ${length} mm long`);
          near(length, cells * CELL_MM - 2 * GAP + (connectors ? 2 * (RAIL_DEPTH_MM - GAP + GAP) : 0), `${label} length`);
          near(stats.min[2], DOCK_LIP_MM, `${label} underside sits on the lip line`);
          if (connectors) assert.deepEqual(built.sockets.bottom, [], `${label} has no peg sockets`);
        }
      }
    }
  }
});

test('every dock variant prints, with and without connectors', async () => {
  let count = 0;
  for (const id of DOCK_FAMILIES) {
    const family = FAMILIES[id];
    for (const fp of family.footprints) {
      for (const h of new Set([family.minStories, family.maxStories])) {
        for (const [mask, dock] of [[0, 15], [10, 5], [14, 1], [7, 8], [12, 2]]) {
          const variant = normalizeVariant({ family: id, fp, h, seed: 60 + count, mask, roof: false, dock });
          assert.equal(variant.dock, dock, variantKey(variant));
          count++;
          for (const connectors of [false, true]) {
            const { result } = await printCheck(variant, connectors);
            assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failedRules(result)}`);
          }
        }
      }
    }
  }
  assert.ok(count >= 600, `dock variants built: ${count}`);
});

test('the slot of a dock stops on a lip of at least one wall', async () => {
  assert.ok(DOCK_LIP_MM >= MIN_WALL_MM);
  for (const id of ['housing', 'core', 'flared', 'shacks', 'deck']) {
    for (const h of [1, 2]) {
      if (h > FAMILIES[id].maxStories) continue;
      const variant = normalizeVariant({ family: id, fp: '1x1', h, seed: 8, mask: 14, roof: false, dock: 1 });
      const { built } = await printCheck(variant, true);
      for (const offset of [-RAIL_OFFSET_MM, RAIL_OFFSET_MM]) {
        for (const [depth, shift] of [[0.6, 0], [1.4, 1], [2.2, -1.3]]) {
          const label = `${id} h${h} slot ${offset} depth ${depth}`;
          const found = crossings(built.solid, CELL_MM - GAP - depth, CELL_MM / 2 + offset + shift);
          assert.equal(found.length, 2, `${label}: only the lip is solid, ${found}`);
          near(found[0], 0, `${label} lip underside`);
          near(found[1], DOCK_LIP_MM, `${label} lip top`);
        }
      }
      // The same spot on a plain connector side is open all the way
      const plain = await printCheck({ ...variant, dock: undefined }, true);
      assert.deepEqual(crossings(plain.built.solid, CELL_MM - GAP - 1.4, CELL_MM / 2 - RAIL_OFFSET_MM), [], `${id} h${h} plain slot runs through`);
    }
  }
});

test('a bridge rail ends square on the lip line, with no chamfer', async () => {
  for (const family of DOCK_BRIDGES) {
    const variant = normalizeVariant({ family, fp: '1x2', h: 1, seed: 4, mask: 15, dock: PLUG_ENDS });
    const { built } = await printCheck(variant, true);
    const length = 2 * CELL_MM;
    for (const end of [0, 1]) {
      for (const offset of [-RAIL_OFFSET_MM, RAIL_OFFSET_MM]) {
        for (const [out, shift] of [[0.3, 0], [0.3, 1.7], [1.2, -2.2], [2.2, 2.9], [2.2, -2.9]]) {
          const pointX = end === 0 ? GAP - out : length - GAP + out;
          const found = crossings(built.solid, pointX, CELL_MM / 2 + offset + shift);
          const label = `${family} end ${end} rail ${offset} out ${out} shift ${shift}`;
          assert.equal(found.length, 2, `${label}: ${found}`);
          near(found[0], DOCK_LIP_MM, `${label} foot`);
          near(found[1], DOCK_LIP_MM + DOCK_HEAD_MM[1], `${label} top`);
        }
      }
    }
  }
});

test('the lip is a box in the collider list and solid in the printed part', async () => {
  const house = dockHouse(1, 0, 0, 0, 0);
  const colliders = variantColliders(house);
  const slots = dockSlots(FOOTPRINTS['1x1'], 1, STORY_MM, GAP);
  assert.equal(slots.length, 2);
  // By hand: slot floor half width 2 + 2.6 tan 30 + 0.1 / cos 30
  const half = 2 + 2.6 * Math.tan(Math.PI / 6) + 0.1 / Math.cos(Math.PI / 6);
  const byHand = [-RAIL_OFFSET_MM, RAIL_OFFSET_MM].map((offset) => ({
    kind: 'box',
    min: [CELL_MM - RAIL_DEPTH_MM - GAP, CELL_MM / 2 + offset - half, 0],
    max: [CELL_MM - GAP, CELL_MM / 2 + offset + half, DOCK_LIP_MM],
  }));
  slots.forEach((slot, order) => {
    for (let axis = 0; axis < 3; axis++) {
      near(slot.lip.min[axis], byHand[order].min[axis], `lip ${order} min ${axis}`);
      near(slot.lip.max[axis], byHand[order].max[axis], `lip ${order} max ${axis}`);
    }
    assert.ok(colliders.some((shape) => JSON.stringify(shape) === JSON.stringify(slot.lip)), `lip ${order} is a collider`);
    // Nothing else fills the slot above the lip
    const middle = [0, 1, 2].map((axis) => (slot.lip.min[axis] + slot.lip.max[axis]) / 2);
    const over = colliders.filter((shape) => [0, 1].every((axis) => middle[axis] > shape.min[axis] && middle[axis] < shape.max[axis]));
    assert.deepEqual(over, [slot.lip], `only lip ${order} is under the slot`);
  });
  const volume = colliders.reduce((sum, shape) => sum + (shape.max[0] - shape.min[0]) * (shape.max[1] - shape.min[1]) * (shape.max[2] - shape.min[2]), 0);
  const slotVolume = 2 * RAIL_DEPTH_MM * 2 * half * (STORY_MM - DOCK_LIP_MM);
  near(volume, (CELL_MM - 2 * GAP) ** 2 * STORY_MM - slotVolume, 'the body less two open slots');
  const { built } = await printCheck(house, true);
  for (const { lip } of slots) {
    // The neck is the narrow part of the printed lip
    for (const [alongShare, depthShare] of [[0.5, 0.1], [0.5, 0.9], [0.3, 0.5], [0.7, 0.5], [0.05, 0.05], [0.95, 0.05]]) {
      const pointX = lip.max[0] - depthShare * (lip.max[0] - lip.min[0]);
      const pointY = lip.min[1] + alongShare * (lip.max[1] - lip.min[1]);
      const found = crossings(built.solid, pointX, pointY);
      assert.ok(found.length >= 2 && Math.abs(found[0]) <= EPS_MM && found[1] >= DOCK_LIP_MM - EPS_MM, `lip is solid at ${pointX}, ${pointY}: ${found}`);
    }
  }
});

test('bridge rail colliders sit inside the printed rails and land on the lips', async () => {
  for (const family of DOCK_BRIDGES) {
    for (const cells of LENGTHS) {
      const bridge = part(5, family, '1x' + cells, 1, 0, 0, 2, 0, { dock: PLUG_ENDS });
      const rails = plugRails(FOOTPRINTS[bridge.fp], bridge.dock, GAP);
      assert.equal(rails.length, 4);
      const colliders = variantColliders(bridge);
      for (const rail of rails) assert.ok(colliders.some((shape) => JSON.stringify(shape) === JSON.stringify(rail)), 'rail is a collider');
      assert.ok(colliders.every((shape) => shape.min[2] >= DOCK_LIP_MM), 'nothing of the bridge is under the lip line');
      const { built } = await printCheck(bridge, true);
      for (const rail of rails) {
        near(rail.max[1] - rail.min[1], 2 * PLUG_RAIL_HALF_MM, 'rail box width');
        for (const [shareX, shareY] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) {
          const found = crossings(built.solid, rail.min[0] + shareX * (rail.max[0] - rail.min[0]), rail.min[1] + shareY * (rail.max[1] - rail.min[1]));
          assert.ok(found.length >= 2 && found[0] <= rail.min[2] + EPS_MM && found[1] >= rail.max[2] - EPS_MM, `${family} 1x${cells} rail box is printed solid: ${found}`);
        }
      }
    }
  }
  // World frame: every rail foot overlaps a lip by neck width times rail depth less the gaps
  const modules = docked(3);
  const bridgeBody = toBody(modules[4]);
  const lipRects = [modules[2], modules[3]].flatMap((dock) => toBody(dock).tops[1].rects);
  assert.equal(bridgeBody.bottoms.length, 1);
  near(bridgeBody.bottoms[0].z, 2 * STORY_MM + DOCK_LIP_MM, 'the bridge rests at the lip line');
  for (const foot of bridgeBody.bottoms[0].rects) {
    const overlaps = lipRects.map((lip) => Math.max(0, Math.min(foot[2], lip[2]) - Math.max(foot[0], lip[0])) * Math.max(0, Math.min(foot[3], lip[3]) - Math.max(foot[1], lip[1])));
    near(Math.max(...overlaps), 2 * PLUG_RAIL_HALF_MM * (RAIL_DEPTH_MM - 2 * GAP), 'bearing area of one rail foot');
  }
});

test('a docked bridge is legal across an open gap between two docks', () => {
  for (const family of DOCK_BRIDGES) {
    for (const cells of LENGTHS) {
      for (let rot = 0; rot < 4; rot++) {
        const modules = docked(cells, { family, rot, shift: -2 });
        const bridge = modules[4];
        const rest = modules.slice(0, 4);
        const label = `${family} 1x${cells} rot ${rot}`;
        assert.deepEqual(validateStructure(worldOf(...modules)), [], label);
        assert.ok(allowed(rest, bridge).ok, `${label}: ${allowed(rest, bridge).reason}`);
        assert.ok(hasTwoSupports(worldOf(...modules), bridge), `${label} has two docks`);
        assert.ok(supportsUnder(worldOf(...modules), bridge).every((support) => support === null), `${label} hangs over open air`);
        assert.equal(allowed(rest.slice(0, 3), bridge).reason, PLUG_REASON, `${label} one dock missing`);
        assert.equal(allowed(rest.map((entry) => (entry.id === 4 ? { ...entry, dock: undefined } : entry)), bridge).reason, PLUG_REASON, `${label} a plain connector side`);
        assert.equal(allowed(rest.map((entry) => (entry.id === 4 ? { ...entry, mask: 15, dock: undefined } : entry)), bridge).reason, PLUG_REASON, `${label} a facade`);
        assert.equal(allowed(rest, { ...bridge, z: bridge.z + 1 }).reason, PLUG_REASON, `${label} one level up`);
        assert.equal(allowed(modules, part(9, 'housing', '1x1', 1, bridge.x, bridge.y, bridge.z + 1)).ok, false, `${label} carries nothing`);
      }
    }
  }
});

test('placement refuses illegal docked cases with a plain reason', () => {
  const [towerA, towerB, dockA, dockB, bridge] = docked(2);
  // A dock module that starts below the bridge has its lip at the wrong level
  const tall = dockHouse(4, 2, 0, 1, 2, 2);
  const shortTower = part(2, 'core', '1x1', 1, 2, 0, 0);
  assert.equal(allowed([towerA, shortTower, dockA, tall], bridge).reason, PLUG_REASON);
  assert.ok(allowed([towerA, shortTower, dockA, tall], { ...bridge, z: 1 }).reason === PLUG_REASON, 'and one dock is not enough at the lower level');
  // No gap: on the ground, or with a module under every cell
  const groundDocks = [dockHouse(3, -1, 0, 0, 0), dockHouse(4, 2, 0, 0, 2)];
  assert.equal(allowed(groundDocks, { ...bridge, z: 0 }).reason, GAP_REASON);
  const floor = part(6, 'core', '1x2', 2, 0, 0, 0);
  assert.equal(allowed([towerA, towerB, dockA, dockB, floor], bridge).reason, GAP_REASON);
  // And a module may not fill the last open cell under a bridge that is there
  assert.equal(allowed([towerA, towerB, dockA, dockB, bridge], floor).reason, 'That would close the gap under a docked bridge');
  const half = part(6, 'core', '1x1', 2, 0, 0, 0);
  assert.ok(allowed([towerA, towerB, dockA, dockB, bridge], half).ok, 'one cell of two may be filled');
  assert.equal(allowed([towerA, towerB, dockA, dockB, bridge, half], part(7, 'core', '1x1', 2, 1, 0, 0)).reason, 'That would close the gap under a docked bridge');
  const post = part(6, 'pier', '1x1', 2, 1, 0, 0);
  assert.ok(allowed([towerA, towerB, dockA, dockB, post], bridge).ok, 'a pier under one cell leaves a gap');
  assert.equal(allowed([towerA, towerB, dockA, dockB, part(7, 'housing', '1x1', 1, 1, 0, 2)], bridge).reason, 'Overlaps another module');
  // A carried bridge still needs supports, a docked one cannot swap in for it
  assert.equal(allowed([towerA, towerB], part(8, 'walkway', '1x2', 1, 0, 0, 2, 0, { dock: PLUG_ENDS })).reason, PLUG_REASON);
  const carried = part(8, 'walkway', '1x3', 1, 0, 0, 2);
  assert.ok(allowed([part(1, 'core', '1x1', 2, 0, 0, 0), part(2, 'core', '1x1', 2, 2, 0, 0)], carried).ok, 'the carried 1x3 still works');
  assert.equal(allowed(docked(3).slice(0, 4), carried).reason, 'No support below');
});

test('a dock side keeps the side rules, with one exception above its base', () => {
  const tower = part(1, 'core', '1x1', 1, 0, 0, 0);
  const dock = dockHouse(2, 0, 0, 1, 0, 2);
  const base = [tower, part(3, 'core', '1x1', 1, 1, 0, 0), dock];
  const railed = (z, mask = 0) => part(4, 'housing', '1x1', 1, 1, 0, z, 0, { mask });
  assert.equal(allowed(base, railed(1)).reason, DOCK_REASON, 'a rail at the base would hit the lip');
  assert.equal(allowed(base, railed(1, 4)).reason, 'Facade meets a connector face. Try rotating it (R)', 'a facade against a dock');
  const low = part(5, 'pier', '1x1', 1, 1, 0, 1);
  assert.ok(allowed(base, low).ok, 'a part without rails may stand beside a dock');
  assert.ok(allowed([...base, low], railed(2)).ok, 'a railed module may start above the lip');
  assert.equal(allowed([...base, low], railed(2, 4)).reason, 'Facade meets a connector face. Try rotating it (R)');
  const facing = dockHouse(4, 1, 0, 1, 2);
  assert.ok(allowed(base, facing).ok, 'two docks may face each other');
  // The dock module is checked the same way when it comes second
  assert.equal(allowed([tower, part(3, 'core', '1x1', 1, 1, 0, 0), railed(1)], dock).reason, DOCK_REASON);
});

test('the static check carries a docked bridge on its lips only', () => {
  for (const family of DOCK_BRIDGES) {
    for (const cells of LENGTHS) {
      const modules = docked(cells, { family });
      const result = checkStability(modules.map(toBody));
      const label = `${family} 1x${cells}`;
      assert.equal(result.status, 'pass', label);
      assert.deepEqual(result.modules.get(5).supports.sort(), [3, 4], `${label} rests on both docks`);
      // By hand: the load sits in the middle of a 4 by 2.3 mm bearing patch
      near(result.modules.get(5).margin, (RAIL_DEPTH_MM - 2 * GAP) / 2, `${label} margin`);
      const loads = result.interfaces.filter((contact) => contact.upper === 5);
      near(loads.reduce((sum, contact) => sum + contact.force, 0), cells * CELL_MM * CELL_MM * STORY_MM, `${label} whole weight goes to the docks`);
      near(loads[0].force, loads[1].force, `${label} both ends carry the same`);
      const oneEnd = checkStability(modules.filter((entry) => entry.id !== 4 && entry.id !== 2).map(toBody));
      assert.equal(oneEnd.modules.get(5).status, 'fail', `${label} with one end gone`);
      // A module right under the bridge does not carry it
      const under = part(6, 'core', '1x' + cells, 2, 0, 0, 0);
      const lifted = checkStability([...modules.slice(0, 2), under, { ...modules[4] }].map(toBody));
      assert.equal(lifted.modules.get(5).status, 'fail', `${label} without docks`);
      assert.equal(lifted.modules.get(5).reason, 'No load path to the plinth');
    }
  }
});

test('a heavy bridge can tip a light dock tower, and the static check says so', () => {
  // By hand: 5 cells of bridge put 2.5 cell weights 1.25 mm inside the dock edge
  const modules = docked(5);
  const result = checkStability(modules.map(toBody));
  assert.equal(result.status, 'pass');
  const dock = result.interfaces.find((contact) => contact.upper === 3 && contact.lower === 1);
  const expected = (1 * CELL_MM / 2 + 2.5 * (GAP + (RAIL_DEPTH_MM - 2 * GAP) / 2)) / 3.5;
  near(CELL_MM - (dock.x - -CELL_MM), expected, 'resultant under the dock, from its bridge edge');
});

test('docked bridges stay up in physics and fall with one end gone', async () => {
  const RAPIER = await getRapier();
  for (const family of DOCK_BRIDGES) {
    for (const cells of LENGTHS) {
      for (const rot of [0, 1]) {
        for (const dockH of [1, 2]) {
          const modules = docked(cells, { family, rot, dockH });
          const label = `${family} 1x${cells} rot ${rot} dock h${dockH}`;
          assert.equal(checkStability(modules.map(toBody)).status, 'pass', label);
          assert.deepEqual(simulate(RAPIER, modules).fallen, [], label);
        }
      }
      const modules = docked(cells, { family });
      assert.ok(simulate(RAPIER, modules.filter((entry) => entry.id !== 4 && entry.id !== 2)).fallen.includes(5), `${family} 1x${cells} falls with one end gone`);
    }
  }
});

test('assembly: a bridge slides down the slots of a tall dock, after both docks', () => {
  const modules = docked(3, { dockH: 3 });
  const result = assemblySteps(modules);
  assert.ok(result.ok);
  const order = result.steps.map((step) => step.id);
  assert.ok(order.indexOf(5) > order.indexOf(3) && order.indexOf(5) > order.indexOf(4), `bridge after its docks: ${order}`);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('assembly: a bridge goes in before the modules above its docks', () => {
  const modules = docked(3);
  const aboveA = part(6, 'housing', '1x1', 2, -1, 0, 3, 0, { mask: 15 });
  const aboveB = part(7, 'housing', '1x1', 1, 3, 0, 3, 0, { mask: 0 });
  const loose = part(8, 'tank', '1x1', 1, 3, 0, 4);
  // Listed first on purpose: the order must not follow the list
  const result = assemblySteps([aboveA, aboveB, loose, ...modules]);
  assert.ok(result.ok);
  const order = result.steps.map((step) => step.id);
  for (const id of [6, 7]) assert.ok(order.indexOf(id) > order.indexOf(5), `module ${id} waits for the bridge: ${order}`);
  assert.ok(order.indexOf(5) > order.indexOf(3) && order.indexOf(5) > order.indexOf(4));
  for (let step = 1; step < result.steps.length; step++) assert.ok(result.steps[step].level >= result.steps[step - 1].level, 'builds upward');
  // Without the bridge the same modules have no such rule
  const plain = partsFromModules([...modules.slice(0, 4), aboveA, aboveB]);
  assert.ok(plain.every((entry) => !(entry.after || []).includes(5)));
});

test('assembly: a rail under a lip goes in before the dock', () => {
  const [towerA, towerB, dockA, dockB, bridge] = docked(2, { level: 2 });
  // A railed module in the gap, under the bridge, with a rail toward dock A's column
  const lowTower = part(6, 'core', '1x1', 1, 0, 0, 0);
  const inGap = part(7, 'housing', '1x1', 1, 0, 0, 1, 0, { mask: 11 });
  const modules = [dockA, dockB, bridge, inGap, lowTower, towerA, towerB];
  assert.deepEqual(validateStructure(worldOf(...modules)), []);
  const parts = partsFromModules(modules);
  assert.ok(parts.find((entry) => entry.id === 3).after.includes(7), 'dock A waits for the module under its lip');
  const result = assemblySteps(modules);
  assert.ok(result.ok);
  const order = result.steps.map((step) => step.id);
  assert.ok(order.indexOf(7) < order.indexOf(3), `${order}`);
  assert.ok(order.indexOf(5) === order.length - 1, 'the bridge goes in last');
});

test('assembly: a bridge that cannot be built names the part that blocks it', () => {
  // Hand built: a hook that sits under dock A and closes the slot above it
  const dockA = { id: 1, voxels: [[0, 0, 1]] };
  const dockB = { id: 2, voxels: [[3, 0, 1]] };
  const bridge = { id: 3, voxels: [[1, 0, 1], [2, 0, 1]], after: [1, 2] };
  const hook = { id: 4, voxels: [[0, 0, 0], [-1, 0, 0], [-1, 0, 1], [-1, 0, 2], [0, 0, 2]], after: [3] };
  const result = assemblyOrder([dockA, dockB, bridge, hook]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.order, [2]);
  const blocked = new Map(result.blocked.map((entry) => [entry.id, entry.by]));
  assert.deepEqual(blocked.get(3), [1], 'the bridge waits for dock A');
  assert.deepEqual(blocked.get(1), [4], 'dock A waits for the hook under it');
  assert.deepEqual(blocked.get(4), [1, 3], 'the hook waits for dock A under its arm, and for the bridge');
  // With the hook cut in two the same parts go together
  const lower = { id: 4, voxels: [[0, 0, 0]] };
  const upper = { id: 5, voxels: [[0, 0, 2]], after: [3] };
  const fixed = assemblyOrder([dockA, dockB, bridge, lower, upper]);
  assert.ok(fixed.ok);
  assert.deepEqual(fixed.order, [4, 1, 2, 3, 5]);
});

test('assembly: two facing claims that start level do not wait on each other', () => {
  const left = { id: 1, voxels: [[0, 0, 0], [0, 0, 1], [1, 0, 0, true], [1, 0, 1, true]] };
  const right = { id: 2, voxels: [[2, 0, 0], [2, 0, 1], [1, 0, 0, true], [1, 0, 1, true]] };
  const roof = { id: 3, voxels: [[5, 0, 0], [5, 0, 1], [5, 0, 2]] };
  const top = { id: 4, voxels: [[5, 0, 3]] };
  assert.deepEqual(assemblyOrder([top, roof, right, left]).order, [1, 2, 3, 4]);
  // A claim that starts lower still goes first
  const high = { id: 2, voxels: [[2, 0, 1], [2, 0, 2], [1, 0, 1, true], [1, 0, 2, true]] };
  const post = { id: 5, voxels: [[2, 0, 0]] };
  assert.deepEqual(assemblyOrder([high, post, left]).order, [1, 5, 2]);
});

test('Build places a saved docked bridge at the dock level and guards its docks', () => {
  const build = createBuild();
  const spec = (instance) => ({ ...instance, id: undefined });
  const [towerA, towerB, dockA, dockB, bridge] = docked(4);
  for (const instance of [towerA, towerB, dockA]) assert.ok(build.place(spec(instance)).ok);
  const variant = variantOf(bridge);
  const early = build.ghost(variant, 2 * CELL_MM, 0.5 * CELL_MM, 0);
  assert.equal(early.ok, false);
  assert.equal(early.reason, GAP_REASON, 'no dock yet, and the ghost rests on the plinth');
  assert.equal(build.place({ ...variant, x: 0, y: 0, z: 2, rot: 0 }).reason, PLUG_REASON);
  assert.ok(build.place(spec(dockB)).ok);
  const ghost = build.ghost(variant, 2 * CELL_MM, 0.5 * CELL_MM, 0);
  assert.ok(ghost.ok, ghost.reason);
  assert.deepEqual([ghost.instance.x, ghost.instance.y, ghost.instance.z], [0, 0, 2], 'the ghost rises to the docks');
  assert.equal(build.ghost(variant, 2 * CELL_MM, 0.5 * CELL_MM, 1).ok, false, 'turned across the gap');
  assert.equal(build.ghost(variant, 3 * CELL_MM, 0.5 * CELL_MM, 0).ok, false, 'one cell over');
  assert.equal(build.ghost(variantOf(part(0, 'walkway', '1x3', 1, 0, 0, 0, 0, { dock: PLUG_ENDS })), 1.5 * CELL_MM, 0.5 * CELL_MM, 0).ok, false, 'too short for the gap');
  const placed = build.place({ ...variant, x: 0, y: 0, z: 2, rot: 0 });
  assert.ok(placed.ok, placed.reason);
  const dockId = build.modules.find((instance) => instance.dock && !isDocked(instance)).id;
  assert.equal(build.remove([dockId]).ok, false, 'a dock that holds a bridge stays');
  assert.equal(build.rotate(dockId).ok, false, 'and cannot turn its dock away');
  assert.equal(build.rotate(placed.id).ok, false, 'the bridge cannot turn across');
  assert.ok(build.remove([placed.id]).ok);
  assert.ok(build.remove([dockId]).ok);
  build.undo();
  build.undo();
  assert.equal(build.modules.length, 5);
  assert.deepEqual(validateStructure(worldOf(...build.modules)), []);
  assert.equal(checkStability(build.modules.map(toBody)).status, 'pass');
});

test('Grow keeps a docked bridge and its docks as they are', () => {
  const base = docked(3, { family: 'gantry', rot: 1 });
  for (const scale of ['block', 'mega']) {
    const grown = generate(growOptions({ seed: 'dockgrow', scale, density: 1, height: 1, daring: 1, theme: 1 }, base));
    for (const instance of base) assert.deepEqual(grown.modules.find((entry) => entry.id === instance.id), instance, `${scale} module ${instance.id}`);
    assert.ok(grown.modules.length > base.length, `${scale} grew`);
    assert.deepEqual(validateStructure(worldFromModules(grown.modules)), [], scale);
    assert.equal(checkStability(grown.modules.map(toBody)).status, 'pass', scale);
    assert.ok(assemblySteps(grown.modules).ok, scale);
  }
});

test('the generator docks bridges of 2 to 5 cells across open gaps', () => {
  let count = 0;
  const lengths = new Set();
  const families = new Set();
  for (const result of generated) {
    const world = worldFromModules(result.modules);
    const label = `${result.seed} ${result.options.scale}`;
    assert.deepEqual(validateStructure(world), [], `${label} rules`);
    assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${label} stability`);
    assert.ok(assemblySteps(result.modules).ok, `${label} assembly`);
    for (const instance of result.modules) {
      if (instance.dock && !isDocked(instance)) {
        // Every dock side holds a bridge end at its base
        for (let side = 0; side < 4; side++) {
          if (sideType(instance, side) !== 'dock') continue;
          const met = instanceCells(instance).some(([cellX, cellY]) => {
            const other = moduleAt(world, cellX + SIDES[side][0], cellY + SIDES[side][1], instance.z);
            return !!other && isDocked(other) && sideType(other, (side + 2) & 3) === 'plug';
          });
          assert.ok(met, `${label} dock ${instance.id} side ${side} holds a bridge`);
        }
      }
      if (!isDocked(instance)) continue;
      count++;
      const cells = instanceCells(instance);
      lengths.add(cells.length);
      families.add(instance.family);
      assert.ok(DOCK_BRIDGES.includes(instance.family) && cells.length >= 2 && cells.length <= 5, `${label} bridge ${instance.id} ${instance.fp}`);
      assert.ok(hasTwoSupports(world, instance), `${label} bridge ${instance.id} meets two docks`);
      assert.ok(instance.z > 0, `${label} bridge ${instance.id} is off the ground`);
      // The floor is lower under every cell, with at most a pier in the middle
      cells.forEach(([cellX, cellY], order) => {
        const under = moduleAt(world, cellX, cellY, instance.z - 1);
        if (!under) return;
        assert.equal(under.family, 'pier', `${label} bridge ${instance.id} has ${under.family} under it`);
        const middle = [Math.floor(cells.length / 2), Math.ceil(cells.length / 2) - 1];
        assert.ok(cells.length >= 4 && middle.includes(order), `${label} pier under a middle cell of a long span`);
      });
    }
  }
  assert.ok(count >= generated.length / 2, `docked bridges in the seed set: ${count}`);
  assert.ok(lengths.size >= 3, `lengths in the seed set: ${[...lengths]}`);
  assert.deepEqual([...families].sort(), ['gantry', 'walkway']);
});

test('generated structures with docked bridges stay up in physics', async () => {
  const RAPIER = await getRapier();
  const withDocks = generated.filter((result) => result.modules.some(isDocked));
  assert.ok(withDocks.length >= 4, `structures with docked bridges: ${withDocks.length}`);
  for (const result of withDocks) assert.deepEqual(simulate(RAPIER, result.modules).fallen, [], `${result.seed} ${result.options.scale}`);
});

test('every generated dock and docked bridge prints', async () => {
  const byKey = new Map();
  for (const result of generated) {
    for (const instance of result.modules) {
      if (instance.dock || instance.family === 'pier') byKey.set(variantKey(instance), instance);
    }
  }
  assert.ok(byKey.size >= 20, `variants: ${byKey.size}`);
  for (const variant of byKey.values()) {
    const { result } = await printCheck(variant, true);
    assert.equal(result.status, 'pass', `${variantKey(variant)}: ${failedRules(result)}`);
  }
});

test('a pier prints at every height and carries like a column', async () => {
  for (let h = FAMILIES.pier.minStories; h <= FAMILIES.pier.maxStories; h++) {
    for (const seed of [1, 2, 3]) {
      const variant = normalizeVariant({ family: 'pier', fp: '1x1', h, seed, mask: 15, roof: false });
      for (const connectors of [false, true]) {
        const { built, result } = await printCheck(variant, connectors);
        assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failedRules(result)}`);
        if (connectors) assert.deepEqual([built.sockets.top, built.sockets.bottom], [[0], [0]], 'takes a peg at both ends');
      }
    }
  }
  const pier = part(1, 'pier', '1x1', 2, 0, 0, 0);
  assert.ok(allowed([], pier).ok);
  assert.ok(allowed([pier], part(2, 'housing', '1x1', 1, 0, 0, 2)).ok);
});

test('random sweep over docks and docked bridges has no print failure', async () => {
  const rng = makeRng(0xd0c5);
  const kinds = PROFILE_IDS.map((id, kind) => kind);
  const problems = [];
  for (let build = 0; build < SWEEP_BUILDS; build++) {
    let variant;
    if (rng.chance(0.25)) {
      variant = normalizeVariant({ family: rng.pick(DOCK_BRIDGES), fp: '1x' + rng.pick(LENGTHS), h: 1, seed: rng.int(1, 0x7fffffff), mask: 15, dock: PLUG_ENDS });
    } else {
      const family = FAMILIES[rng.pick(DOCK_FAMILIES)];
      const side = rng.int(0, 3);
      const mask = rng.int(0, 15) & ~(1 << side);
      variant = normalizeVariant({
        family: family.id,
        fp: rng.pick(family.footprints),
        h: rng.int(family.minStories, family.maxStories),
        seed: rng.int(1, 0x7fffffff),
        mask,
        roof: family.roofable && rng.chance(0.3),
        dock: (1 << side) | (rng.int(0, 15) & ~mask),
        prof: PROFILE_FAMILIES.includes(family.id) && rng.chance(0.5) ? packProfiles([0, 1, 2, 3].map(() => rng.pick(kinds))) : 0,
      });
    }
    assert.ok(variant.dock, variantKey(variant));
    for (const connectors of [false, true]) {
      const { result } = await printCheck(variant, connectors);
      if (result.status !== 'pass') problems.push(`${variantKey(variant)} connectors ${connectors}: ${failedRules(result)}`);
    }
  }
  assert.deepEqual(problems, []);
});
