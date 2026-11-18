import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, normalizeVariant } from '../js/core/catalog.js';
import { toBody, worldFromModules, instanceCells, variantKey } from '../js/core/grid.js';
import { checkStability } from '../js/core/stability.js';
import { validateStructure, checkPlacement } from '../js/core/placement.js';
import { rigidGroups, moduleItems, GROUP_REACH } from '../js/core/supports.js';
import { simulate } from '../js/core/physics.js';
import { checkPrintability } from '../js/core/printability.js';
import { RECIPE_IDS } from '../js/core/recipes.js';
import { generate } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { variantOf } from '../js/core/collection.js';
import { assemblySteps } from '../js/core/assembly.js';
import { getRapier, getSolids } from './helpers.js';

const part = (id, family, x, y, z, h = 1, fp = '1x1') => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false }), id, x, y, z, rot: 0 });
// A support two stories tall with a housing module on it and neighbours at that level
const canopy = (cells) => [part(1, 'support', 0, 0, 0, 2), part(2, 'housing', 0, 0, 2), ...cells.map(([x, y], index) => part(10 + index, 'housing', x, y, 2))];
const RING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const groupsOf = (modules) => rigidGroups(moduleItems(modules, instanceCells));

test('support family: catalog, recipe, two forms, prints with and without connectors, pegs on top only', async () => {
  assert.ok(FAMILIES.support && RECIPE_IDS.includes('support'));
  assert.ok(FAMILIES.support.stack && !FAMILIES.support.rails && !FAMILIES.support.ground);
  const solids = await getSolids();
  let pegged = 0;
  for (let h = 1; h <= 3; h++) {
    for (let seed = 1; seed <= 12; seed++) {
      const variant = normalizeVariant({ family: 'support', fp: '1x1', h, seed, mask: 15, roof: false });
      for (const connectors of [false, true]) {
        const built = solids.buildVariant(variant, { connectors, render: false, edges: false });
        const result = checkPrintability(built.solid, { pieces: built.parts });
        const failed = Object.entries(result.rules).filter(([, rule]) => rule.status !== 'pass').map(([name, rule]) => `${name} ${JSON.stringify(rule.value)}`);
        assert.equal(result.status, 'pass', `${variantKey(variant)} connectors ${connectors}: ${failed}`);
        if (connectors) {
          assert.equal(built.sockets.bottom.length, 0, 'the base rests with no connectors');
          if (built.sockets.top.length > 0) pegged++;
        }
      }
    }
  }
  assert.ok(pegged > 0, 'the top takes a peg into the module above');
});

test('a 3 by 3 group on one central support stands in the static check and in physics', async () => {
  const modules = canopy(RING);
  assert.deepEqual(validateStructure(worldFromModules(modules)), []);
  const groups = groupsOf(modules);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 9);
  const result = checkStability(modules.map(toBody));
  assert.equal(result.status, 'pass');
  for (const instance of modules) assert.equal(result.modules.get(instance.id).status, 'pass');
  assert.deepEqual(simulate(await getRapier(), modules).fallen, []);
});

test('a lopsided group tips in both checks', async () => {
  const modules = canopy([[1, -1], [1, 0], [1, 1]]);
  assert.deepEqual(validateStructure(worldFromModules(modules)), []);
  const result = checkStability(modules.map(toBody));
  assert.equal(result.status, 'fail');
  // The group's centre of mass sits three quarters of a cell off the support: past its edge
  for (const id of [2, 10, 11, 12]) assert.equal(result.modules.get(id).status, 'fail');
  assert.equal(result.modules.get(1).status, 'pass');
  const fallen = simulate(await getRapier(), modules).fallen.sort((first, second) => first - second);
  assert.deepEqual(fallen, [2, 10, 11, 12]);
});

test('groups never pass 3 by 3, and a module outside the window is not carried', () => {
  // A neighbour two cells out is left out of the group and refused with nothing under it
  const modules = canopy([[1, 0], [2, 0]]);
  const groups = groupsOf(modules);
  assert.deepEqual(groups[0].members, [2, 10]);
  const problems = validateStructure(worldFromModules(modules));
  assert.deepEqual(problems.map((problem) => problem.id), [11]);
  assert.equal(problems[0].reason, 'No support below');
  // A wide module whose cells leave the window is not a member
  const wide = [part(1, 'support', 0, 0, 0, 2), part(2, 'housing', 0, 0, 2), part(3, 'housing', 1, 0, 2, 1, '2x2')];
  assert.deepEqual(groupsOf(wide), []);
  // Every group of generated structures fits a 3 by 3 window over its support
  let seen = 0;
  for (const seed of ['arco', 'habitat', 'barbican', 'nakagin', 'x9', 'blacksburg', 'trellick', 'lumen']) {
    for (const scale of ['block', 'mega']) {
      const { modules: built } = generate({ seed, scale, density: 2, height: 1, daring: 1, theme: 2 });
      const byId = new Map(built.map((instance) => [instance.id, instance]));
      for (const group of groupsOf(built)) {
        seen++;
        const [supportX, supportY] = instanceCells(byId.get(group.support))[0];
        for (const id of group.members) {
          for (const [x, y] of instanceCells(byId.get(id))) assert.ok(Math.abs(x - supportX) <= GROUP_REACH && Math.abs(y - supportY) <= GROUP_REACH, `${seed} ${scale} group past 3 by 3`);
        }
        assert.ok(group.members.length <= 9);
      }
    }
  }
  assert.ok(seen > 0, 'generated structures have support groups');
});

test('supports are reachable from Generate and Build, and the canopy assembles', () => {
  let found = 0;
  for (const seed of ['arco', 'habitat', 'barbican', 'nakagin', 'x9', 'blacksburg']) {
    const result = generate({ seed, scale: 'mega', density: 2, height: 1, daring: 1, theme: 2 });
    found += result.modules.filter((instance) => instance.family === 'support').length;
    assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${seed} rules`);
    assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${seed} stability`);
    assert.ok(assemblySteps(result.modules).ok, `${seed} assembly`);
  }
  assert.ok(found > 0, 'supports generated');
  const build = createBuild();
  // Sides first: a corner joins the group through its side neighbours
  const steps = canopy([[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]);
  for (const instance of steps) {
    const result = build.place(instance);
    assert.ok(result.ok, `${instance.family} at ${instance.x}, ${instance.y}: ${result.reason}`);
  }
  assert.ok(variantOf({ family: 'support', fp: '1x1', h: 2, seed: 4, mask: 15 }));
  assert.ok(assemblySteps(steps).ok, 'the canopy assembles');
  // Taking the support away leaves the ring with nothing under it
  assert.equal(build.remove([1]).ok, false);
  // A neighbour with nothing under it and no support group is refused
  assert.equal(checkPlacement(worldFromModules([part(2, 'housing', 0, 0, 0, 2)]), part(5, 'housing', 1, 0, 2)).reason, 'No support below');
});
