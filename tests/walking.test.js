import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVariant } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { walkingNetwork, walkingLines } from '../js/core/walking.js';
import { walkingText } from '../js/ui/inspector.js';
import { COPY } from '../js/ui/copy.js';

const part = (id, family, fp, h, x, y, z, extra = {}) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false, ...extra }), id, x, y, z, rot: extra.rot || 0 });

test('a core joins levels step-free; a stair tower joins them with steps', () => {
  // House on the ground, the core beside it, a house two stories up on the core's far side
  const withCore = [part(1, 'housing', '1x1', 1, 1, 0, 0), part(2, 'core', '1x1', 3, 0, 0, 0), part(3, 'housing', '1x1', 1, -1, 0, 2)];
  const lift = walkingNetwork(withCore);
  assert.equal(lift.between(1, 3), 4, 'one step in, two up, one out');
  assert.equal(lift.modules[3].stepFree, true);
  const withStair = withCore.map((instance) => (instance.id === 2 ? part(2, 'stair', '1x1', 3, 0, 0, 0) : instance));
  const stairs = walkingNetwork(withStair);
  assert.equal(stairs.between(1, 3), 4);
  assert.equal(stairs.modules[3].reached, true);
  assert.equal(stairs.modules[3].stepFree, false, 'stairs are not step-free');
});

test('a walkway between two towers is a shortcut over going down and across the plinth', () => {
  const towers = [part(1, 'core', '1x1', 3, -2, 0, 0), part(2, 'core', '1x1', 3, 2, 0, 0), part(3, 'housing', '1x1', 1, -2, 1, 2), part(4, 'housing', '1x1', 1, 2, 1, 2)];
  const around = walkingNetwork(towers);
  // Across from house to house: out of the house, down two, across five plinth cells, up two, into the house
  const ground = around.between(3, 4);
  assert.ok(ground < Infinity && ground >= 9, `around ${ground}`);
  const bridged = walkingNetwork([...towers, part(5, 'walkway', '1x3', 1, -1, 0, 2)]);
  assert.ok(bridged.between(3, 4) < ground, `bridge ${bridged.between(3, 4)} against ${ground}`);
  // A capped end meets nothing: with both ends capped the walkway is no shortcut
  const capped = walkingNetwork([...towers, part(5, 'walkway', '1x3', 1, -1, 0, 2, { ends: 1 | (1 << 2) })]);
  assert.equal(capped.between(3, 4), ground);
  assert.equal(capped.modules[5].reached, false);
});

test('a module with no way up is unreachable, and the layer marks it', () => {
  // A house on pilotis, with nothing walkable leading up to it
  const modules = [part(1, 'housing', '1x1', 1, 0, 0, 0), part(2, 'housing', '1x1', 1, 0, -2, 1), part(3, 'market', '1x1', 1, 2, 0, 0), part(4, 'pilotis', '1x1', 1, 0, -2, 0)];
  const network = walkingNetwork(modules);
  assert.equal(network.modules[1].reached, true);
  assert.equal(network.modules[2].reached, false);
  assert.equal(network.between(1, 2), Infinity);
  assert.deepEqual(network.modules[1].nearest.market, { steps: 2, stepFree: true }, 'out of the house onto a plinth cell, then into the market');
  const lines = walkingLines(network, modules);
  assert.equal(lines.positions.length, lines.statuses.length * 6);
  assert.ok(lines.statuses.includes('fail'), 'the unreachable house is crossed out');
  assert.equal(walkingText({ modules: network.modules }, 2), COPY.walkUnreached);
  assert.equal(walkingText({ modules: network.modules }, 1, () => 'Market'), `${COPY.walkNearest} market: 2 ${COPY.walkSteps}, ${COPY.walkStepFree}. ${COPY.walkFromPlinthFree}`);
});

test('a plain stack of buildings is climbed by its inside stairs; a core beside it makes it step-free', () => {
  // Three houses stacked in one column, a two story studio on top
  const stack = [part(1, 'housing', '1x1', 1, 0, 0, 0), part(2, 'housing', '1x1', 1, 0, 0, 1), part(3, 'housing', '1x1', 1, 0, 0, 2), part(4, 'studio', '1x1', 2, 0, 0, 3)];
  const stairs = walkingNetwork(stack);
  for (const id of [1, 2, 3, 4]) assert.equal(stairs.modules[id].reached, true, `module ${id} reached`);
  for (const id of [2, 3, 4]) assert.equal(stairs.modules[id].stepFree, false, `module ${id} only by stairs`);
  assert.equal(stairs.between(1, 3), 2, 'two flights up the column');
  assert.equal(stairs.between(1, 4), 3);
  // A core beside the stack meets every story side by side
  const lift = walkingNetwork([...stack, part(5, 'core', '1x1', 4, 1, 0, 0)]);
  for (const id of [1, 2, 3, 4]) assert.equal(lift.modules[id].stepFree, true, `module ${id} step-free`);
});

test('an amenity stacked on housing is reached by the stairs inside both', () => {
  const modules = [part(1, 'housing', '1x2', 2, 0, 0, 0), part(2, 'clinic', '1x1', 1, 0, 0, 2), part(3, 'gym', '1x2', 1, 0, 0, 3), part(4, 'shrine', '1x1', 1, 0, 0, 4)];
  const network = walkingNetwork(modules);
  for (const id of [1, 2, 3]) assert.equal(network.modules[id].reached, true, `module ${id} reached`);
  assert.equal(network.modules[2].stepFree, false);
  assert.equal(network.modules[4].reached, false, 'a shrine cap has no stairs up into it');
});

test('generated structures: most modules are reached, and the network repeats', () => {
  for (const seed of ['barbican', 'habitat']) {
    const { modules } = generate({ seed, scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 });
    const network = walkingNetwork(modules);
    const reports = Object.values(network.modules);
    const reached = reports.filter((entry) => entry.reached).length;
    assert.ok(reached > reports.length / 2, `${seed} reached ${reached} of ${reports.length}`);
    assert.ok(reports.every((entry) => !entry.stepFree || entry.reached));
    assert.deepEqual(walkingNetwork(modules).modules, network.modules);
  }
});
