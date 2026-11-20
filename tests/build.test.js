import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, PLINTH_DIAMETER_CELLS } from '../js/config.js';
import { createBuild, nextRot, restLevel, snapOrigin } from '../js/core/build.js';
import { instanceCells, structureHash, variantKey, worldFromModules } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';
import { runChecks } from '../js/core/checks.js';

const housing = { family: 'housing', fp: '1x1', h: 2, seed: 9, mask: 0, roof: false };
const slab = { family: 'housing', fp: '1x2', h: 1, seed: 9, mask: 0, roof: false };
const wide = { family: 'housing', fp: '2x3', h: 1, seed: 9, mask: 0, roof: false };
const tank = { family: 'tank', fp: '1x1', h: 1, seed: 2, mask: 15, roof: true };
const at = (variant, x, y, z, rot = 0) => ({ ...variant, x, y, z, rot });
const cellsOf = (instance) => instanceCells(instance).map((cell) => cell.join(',')).sort();

test('a point snaps to the grid cell under it', () => {
  assert.deepEqual(snapOrigin(1, 1, '1x1', 0), [0, 0]);
  assert.deepEqual(snapOrigin(24.9, 49.9, '1x1', 0), [0, 1]);
  assert.deepEqual(snapOrigin(-0.1, -26, '1x1', 0), [-1, -2]);
  assert.deepEqual(snapOrigin(37.5, 25, '2x3', 0), [0, 0]);
  assert.deepEqual(snapOrigin(25, 37.5, '2x3', 1), [0, 0]);
  const build = createBuild();
  const ghost = build.ghost(housing, 2.4 * CELL_MM, -1.7 * CELL_MM, 0);
  assert.equal(ghost.ok, true);
  assert.deepEqual([ghost.instance.x, ghost.instance.y, ghost.instance.z, ghost.instance.rot], [2, -2, 0, 0]);
});

test('rotation turns the footprint a quarter turn each time', () => {
  assert.deepEqual([0, 1, 2, 3].map(nextRot), [1, 2, 3, 0]);
  const build = createBuild();
  const flat = build.ghost(slab, 25, 12.5, 0).instance;
  const turned = build.ghost(slab, 12.5, 25, 1).instance;
  assert.deepEqual(cellsOf(flat), ['0,0', '1,0']);
  assert.deepEqual(cellsOf(turned), ['0,0', '0,1']);
  assert.equal(build.place(flat).ok, true);
  const id = build.modules[0].id;
  for (const expected of [['0,0', '0,1'], ['0,0', '1,0'], ['0,0', '0,1'], ['0,0', '1,0']]) {
    assert.equal(build.rotate(id).ok, true);
    assert.deepEqual(cellsOf(build.modules[0]), expected);
  }
  assert.equal(build.modules[0].rot, 0);
  assert.equal(variantKey(build.modules[0]), variantKey(slab));
});

test('a part dropped on another one stacks on top of it', () => {
  const build = createBuild();
  assert.equal(build.place(at(housing, 0, 0, 0)).ok, true);
  const ghost = build.ghost(housing, 12, 12, 0);
  assert.equal(ghost.ok, true);
  assert.equal(ghost.instance.z, 2);
  assert.equal(build.place(ghost.instance).ok, true);
  assert.equal(build.ghost(housing, 12, 12, 0).instance.z, 4);
  const bridge = build.ghost(slab, 25, 12, 0);
  assert.equal(bridge.instance.z, 4);
  assert.equal(restLevel(worldFromModules(build.modules), '1x1', 0, 3, 3), 0);
});

test('a part past the plinth edge is refused', () => {
  const build = createBuild();
  const edge = (PLINTH_DIAMETER_CELLS / 2) * CELL_MM;
  const ghost = build.ghost(housing, edge + 5, 0, 0);
  assert.equal(ghost.ok, false);
  assert.equal(ghost.reason, 'Off the plinth');
  const corner = build.ghost(wide, edge - 30, edge - 30, 0);
  assert.equal(corner.ok, false);
  assert.deepEqual(build.place(ghost.instance), { ok: false, reason: 'Off the plinth' });
  assert.equal(build.modules.length, 0);
  assert.equal(build.canUndo(), false);
});

test('a part that overlaps another one is refused', () => {
  const build = createBuild();
  build.place(at(housing, 0, 0, 0));
  assert.deepEqual(build.place(at(housing, 0, 0, 1)), { ok: false, reason: 'Overlaps another module' });
  assert.deepEqual(build.place(at(slab, -1, 0, 0)), { ok: false, reason: 'Overlaps another module' });
  assert.equal(build.modules.length, 1);
});

test('a part with nothing under it is refused', () => {
  const build = createBuild();
  build.place(at(housing, 0, 0, 0));
  assert.deepEqual(build.place(at(housing, 3, 3, 1)), { ok: false, reason: 'No support below' });
  assert.deepEqual(build.place(at(housing, 0, 0, 3)), { ok: false, reason: 'No support below' });
  build.place(at(tank, 0, 0, 2));
  const onCap = build.ghost(housing, 12, 12, 0);
  assert.equal(onCap.ok, false);
  assert.equal(build.modules.length, 2);
});

test('delete removes a part unless something rests on it', () => {
  const build = createBuild();
  build.place(at(housing, 0, 0, 0));
  build.place(at(housing, 0, 0, 2));
  const [lower, upper] = build.modules.map((instance) => instance.id);
  assert.deepEqual(build.remove([lower]), { ok: false, reason: 'Something rests on this part' });
  assert.equal(build.modules.length, 2);
  assert.equal(build.remove([upper]).ok, true);
  assert.equal(build.remove([lower]).ok, true);
  assert.equal(build.modules.length, 0);
  assert.equal(build.remove([lower]).ok, false);
  build.undo();
  build.undo();
  assert.equal(build.remove([lower, upper]).ok, true);
});

test('undo and redo walk the same steps both ways', () => {
  const build = createBuild();
  const hashes = [structureHash(build.modules)];
  build.place(at(housing, 0, 0, 0));
  hashes.push(structureHash(build.modules));
  build.place(at(slab, 0, 0, 2));
  hashes.push(structureHash(build.modules));
  build.rotate(build.modules[1].id);
  hashes.push(structureHash(build.modules));
  build.remove([build.modules[1].id]);
  hashes.push(structureHash(build.modules));
  build.clear();
  hashes.push(structureHash(build.modules));
  assert.equal(new Set(hashes).size, 4);
  assert.equal(hashes[4], hashes[1]);
  assert.equal(hashes[5], hashes[0]);
  assert.equal(build.canRedo(), false);
  for (let step = hashes.length - 2; step >= 0; step--) {
    assert.equal(build.undo(), true);
    assert.equal(structureHash(build.modules), hashes[step]);
  }
  assert.equal(build.undo(), false);
  for (let step = 1; step < hashes.length; step++) {
    assert.equal(build.redo(), true);
    assert.equal(structureHash(build.modules), hashes[step]);
  }
  assert.equal(build.redo(), false);
});

test('a new step after undo drops the redo steps', () => {
  const build = createBuild();
  build.place(at(housing, 0, 0, 0));
  build.place(at(housing, 1, 0, 0));
  build.undo();
  assert.equal(build.canRedo(), true);
  build.place(at(housing, 2, 2, 0));
  assert.equal(build.canRedo(), false);
  assert.deepEqual(build.modules.map((instance) => [instance.x, instance.y]), [[0, 0], [2, 2]]);
  assert.equal(new Set(build.modules.map((instance) => instance.id)).size, 2);
});

test('a refused step leaves undo history alone', () => {
  const build = createBuild();
  build.place(at(housing, 0, 0, 0));
  build.undo();
  build.place(at(housing, 99, 0, 0));
  assert.equal(build.canRedo(), true);
  assert.equal(build.redo(), true);
  assert.equal(build.modules.length, 1);
});

test('a generated structure becomes the build and can be edited and undone', () => {
  const generated = generate({ seed: 'habitat', scale: 'block' });
  const build = createBuild();
  build.replace(generated.modules);
  assert.equal(structureHash(build.modules), generated.hash);
  const ghost = build.ghost(tank, -4.5 * CELL_MM, 0.5 * CELL_MM, 0);
  assert.deepEqual([ghost.instance.x, ghost.instance.y, ghost.instance.z], [-5, 0, 0]);
  assert.equal(ghost.ok, true);
  assert.equal(build.place(ghost.instance).ok, true);
  assert.equal(build.modules.length, generated.modules.length + 1);
  assert.equal(new Set(build.modules.map((instance) => instance.id)).size, build.modules.length);
  assert.equal(runChecks(build.modules).placement, 'pass');
  build.undo();
  assert.equal(structureHash(build.modules), generated.hash);
  build.undo();
  assert.equal(build.modules.length, 0);
});

test('a lifted module moves as one undo step, keeps its id, and anchors or supports refuse', () => {
  const build = createBuild();
  assert.equal(build.place(at(housing, 0, 0, 0)).ok, true);
  assert.equal(build.place(at(housing, 3, 0, 0)).ok, true);
  assert.equal(build.place(at(housing, 3, 0, 2)).ok, true);
  const [first, base, top] = build.modules.map((instance) => instance.id);
  // A module that carries another stays put
  assert.equal(build.lift(base).ok, false);
  assert.equal(build.lifted(), null);
  assert.equal(build.lift(first).ok, true);
  // While lifted the ghost may use its old cells
  const ghost = build.ghost(housing, 12.5, 12.5, 1);
  assert.equal(ghost.ok, true);
  assert.equal(ghost.instance.z, 0);
  const spot = build.ghost(housing, -2 * CELL_MM + 12.5, 12.5, 1).instance;
  assert.equal(build.move(first, spot).ok, true);
  assert.equal(build.lifted(), null);
  const moved = build.modules.find((instance) => instance.id === first);
  assert.deepEqual([moved.x, moved.y, moved.z, moved.rot], [-2, 0, 0, 1]);
  assert.equal(build.modules.length, 3);
  assert.equal(build.undo(), true);
  const back = build.modules.find((instance) => instance.id === first);
  assert.deepEqual([back.x, back.y, back.z, back.rot], [0, 0, 0, 0]);
  assert.equal(build.redo(), true);
  // A move onto another module is refused and nothing changes
  build.lift(top);
  const before = build.modules;
  assert.equal(build.move(top, at(housing, -2, 0, 0)).ok, false);
  assert.equal(build.modules, before);
  build.drop();
  // Locked ids refuse
  build.setRules({ locked: [first] });
  assert.equal(build.lift(first).ok, false);
  assert.equal(build.move(first, at(housing, 5, 0, 0)).ok, false);
});
