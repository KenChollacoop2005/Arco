import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_MM, CELL_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { analyze } from '../js/core/analysis.js';
import { walkingNetwork, plinthRoutes } from '../js/core/walking.js';
import { traitFocus } from '../js/core/focus.js';

const part = (id, family, fp, h, x, y, z) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false }), id, x, y, z, rot: 0 });
// A three story house with a flat on top, a house beside it, a generator, and a clinic farther off
const STACK = [part(1, 'housing', '1x1', 3, 0, 0, 0), part(2, 'housing', '1x1', 1, 0, 0, 3), part(3, 'housing', '1x1', 2, 1, 0, 0), part(4, 'generator', '1x1', 1, -1, 0, 0), part(5, 'clinic', '1x1', 1, 3, 3, 0)];

function context(homeId, extra = {}) {
  const network = walkingNetwork(STACK);
  const analysis = { ...analyze(STACK), walking: { modules: network.modules, routes: plinthRoutes(network) }, lights: { sources: [{ module: 9, kind: 'lamppost', point: [10, 20, 30], radius: 2, lit: true }, { module: 8, kind: 'floodlight', point: [0, 0, 0], radius: 3, lit: false }] }, flows: null };
  return { modules: STACK, home: STACK.find((instance) => instance.id === homeId), homeOf: (id) => ({ b: 3 })[id] ?? null, analysis, start: 1, ...extra };
}

test('plinth routes walk from a module down to free plinth cells', () => {
  const network = walkingNetwork(STACK);
  const routes = plinthRoutes(network);
  const top = routes[2];
  assert.ok(top && top.length >= 2, 'the top flat has a route');
  assert.ok(top[0][2] >= 3 * STORY_MM, 'starts in the flat');
  assert.ok(top[top.length - 1][2] < STORY_MM, 'ends on the plinth');
  // Each step moves at most one cell across and one story up or down
  for (let index = 1; index < top.length; index++) {
    assert.ok(Math.abs(top[index][0] - top[index - 1][0]) + Math.abs(top[index][1] - top[index - 1][1]) <= CELL_MM + 1e-6);
    assert.ok(Math.abs(top[index][2] - top[index - 1][2]) <= STORY_MM + 1e-6);
  }
});

test('trait focus: what each trait points at', () => {
  assert.deepEqual(traitFocus('want', { id: 'calm', cells: 2 }, context(1)).modules, [4]);
  assert.deepEqual(traitFocus('hate', { id: 'noise' }, context(1)).modules, [4]);
  assert.deepEqual(traitFocus('want', { id: 'amenity', type: 'clinic', steps: 8 }, context(1)).modules, [5]);
  const friend = traitFocus('want', { id: 'nextto', resident: 'b' }, context(1));
  assert.deepEqual([friend.residents, friend.modules], [['b'], [3]]);
  assert.equal(traitFocus('want', { id: 'high', story: 2 }, context(1)).level, 2 * STORY_MM);
  assert.equal(traitFocus('hate', { id: 'heights', story: 2 }, context(1)).level, 3 * STORY_MM);
  assert.equal(traitFocus('hate', { id: 'ground' }, context(1)).level, STORY_MM);
  assert.deepEqual(traitFocus('want', { id: 'lit' }, context(1)).rings, [{ point: [10, 20, 30], radius: 2 * CELL_MM, module: 9 }]);
  assert.equal(traitFocus('want', { id: 'stepfree' }, context(2)).lines.length, 1);
  assert.deepEqual(traitFocus('want', { id: 'neighbour' }, context(1)).modules.sort(), [2, 3]);
  assert.deepEqual(traitFocus('want', { id: 'stay' }, context(3)).modules, [1]);
  // Anything else points at the home itself
  assert.deepEqual(traitFocus('want', { id: 'outward' }, context(1)).modules, [1]);
  // A blocked cable into the home, its blocker and the nearest relay
  const flows = { services: { blocked: [{ type: 'wire', to: { module: 1 }, points: [[0, 0, 0], [1, 1, 1]], blocked: { module: 3 } }], power: { consumers: { 1: { nearestRelay: { module: 4 } } } } } };
  const power = traitFocus('need', { id: 'power' }, context(1, { analysis: { ...context(1).analysis, flows } }));
  assert.deepEqual([power.modules, power.lines.length], [[3, 4], 1]);
});
