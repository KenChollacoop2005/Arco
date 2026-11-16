import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/core/generator.js';
import { assemblyOrder, assemblySteps, partsFromModules } from '../js/core/assembly.js';

const SEEDS = ['habitat', 'nakagin', 'barbican', 'trellick', 'unite', 'alpha', 'beta', 'gamma'];

// True if every part can drop straight down when its turn comes
function orderIsValid(parts, order) {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const filled = new Map();
  for (const id of order) {
    for (const [cellX, cellY, level] of byId.get(id).voxels) {
      const top = filled.get(cellX + ',' + cellY);
      if (top !== undefined && top > level) return false;
    }
    for (const [cellX, cellY, level] of byId.get(id).voxels) {
      const key = cellX + ',' + cellY;
      filled.set(key, Math.max(filled.get(key) ?? -1, level));
    }
  }
  return order.length === parts.length;
}

test('every generated structure in the seed set has a valid assembly order', () => {
  for (const seed of SEEDS) {
    for (const scale of ['block', 'mega']) {
      const { modules } = generate({ seed, scale });
      const result = assemblySteps(modules);
      assert.ok(result.ok, `${seed} ${scale} has an order`);
      assert.equal(result.steps.length, modules.length);
      assert.equal(new Set(result.steps.map((step) => step.id)).size, modules.length);
      assert.ok(orderIsValid(partsFromModules(modules), result.steps.map((step) => step.id)), `${seed} ${scale} order is valid`);
      for (let step = 1; step < result.steps.length; step++) {
        assert.ok(result.steps[step].level >= result.steps[step - 1].level, `${seed} ${scale} builds upward`);
      }
    }
  }
});

test('a simple stack is ordered bottom to top', () => {
  const column = (id, level) => ({ id, voxels: [[0, 0, level]] });
  const result = assemblyOrder([column('top', 2), column('base', 0), column('middle', 1)]);
  assert.deepEqual(result.order, ['base', 'middle', 'top']);
  assert.ok(result.ok);
});

test('two interlocked hooks are reported as blocked', () => {
  // The hook reaches over the link, and the link sits over the hook's foot
  const hook = { id: 'hook', voxels: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 1, 2], [1, 1, 2], [1, 0, 2]] };
  const link = { id: 'link', voxels: [[0, 0, 1], [1, 0, 1], [1, 0, 0]] };
  const free = { id: 'free', voxels: [[5, 5, 0]] };
  const result = assemblyOrder([hook, link, free]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.order, ['free']);
  assert.deepEqual(result.blocked, [
    { id: 'hook', by: ['link'] },
    { id: 'link', by: ['hook'] },
  ]);
});

test('a part resting on a blocked part is blocked too', () => {
  const hook = { id: 'hook', voxels: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 1, 2], [1, 1, 2], [1, 0, 2]] };
  const link = { id: 'link', voxels: [[0, 0, 1], [1, 0, 1], [1, 0, 0]] };
  const rider = { id: 'rider', voxels: [[1, 0, 3]] };
  const result = assemblyOrder([hook, link, rider]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.blocked.find((entry) => entry.id === 'rider').by.sort(), ['hook', 'link']);
});
