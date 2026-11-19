import test from 'node:test';
import assert from 'node:assert/strict';
import { toBody, worldFromModules, structureHash } from '../js/core/grid.js';
import { validateStructure } from '../js/core/placement.js';
import { checkStability } from '../js/core/stability.js';
import { assemblySteps } from '../js/core/assembly.js';
import { generate, SERVICE_LEVELS, normalizeOptions } from '../js/core/generator.js';
import { planServices } from '../js/core/services.js';

const HIGH = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };
const PIECES = ['raincatcher', 'pumproom', 'solar', 'turbine', 'generator'];
const sum = (list, key) => list.reduce((total, entry) => total + entry[key], 0);

// Water and power delivered, water supplied, running pumps and head-starved consumers, from the full solvers
function delivered(modules, seed) {
  const plan = planServices(modules, seed);
  const power = Object.values(plan.power.consumers).filter((report) => !report.relay);
  const water = Object.values(plan.water.consumers);
  return {
    water: sum(water, 'received'),
    power: sum(power, 'received'),
    supplied: plan.water.solved.totals.supplied,
    pumps: Object.values(plan.water.pumps).filter((pump) => pump.runs).length,
    headless: water.filter((report) => report.received === 0 && report.reason === 'out of head').length,
  };
}

test('services levels: Low is the default, the layout is legal and standing at every level, and it repeats', () => {
  assert.deepEqual(SERVICE_LEVELS, ['off', 'low', 'high']);
  assert.equal(normalizeOptions({}).services, 'low');
  assert.equal(normalizeOptions({ services: 'loud' }).services, 'low');
  for (const seed of ['barbican', 'habitat']) {
    for (const services of SERVICE_LEVELS) {
      const result = generate({ seed, ...HIGH, services });
      assert.deepEqual(validateStructure(worldFromModules(result.modules)), [], `${seed} ${services} rules`);
      assert.equal(checkStability(result.modules.map(toBody)).status, 'pass', `${seed} ${services} stability`);
      assert.ok(assemblySteps(result.modules).ok, `${seed} ${services} assembly`);
      assert.equal(generate({ seed, ...HIGH, services }).hash, result.hash, `${seed} ${services} repeats`);
    }
  }
});

test('services deliver more water from Off to Low, High supplies and pumps more with fewer short of head, and High gives more power', () => {
  for (const seed of ['barbican', 'golden']) {
    const levels = SERVICE_LEVELS.map((services) => {
      const { modules } = generate({ seed, ...HIGH, services });
      return { services, ...delivered(modules, seed), pieces: modules.filter((instance) => PIECES.includes(instance.family)).length + modules.filter((instance) => instance.jb).length };
    });
    const [off, low, high] = levels;
    assert.ok(low.pieces > off.pieces && high.pieces >= low.pieces, `${seed} pieces ${levels.map((level) => level.pieces)}`);
    assert.ok(low.water > off.water, `${seed} water ${levels.map((level) => level.water)}`);
    // Low and High are different layouts, so High is held to the planner's job: more water, more pumps, fewer short of head
    assert.ok(high.supplied >= low.supplied, `${seed} supplied ${levels.map((level) => level.supplied)}`);
    assert.ok(high.pumps >= low.pumps, `${seed} pumps running ${levels.map((level) => level.pumps)}`);
    assert.ok(high.headless <= low.headless, `${seed} dry for head ${levels.map((level) => level.headless)}`);
    // New pumps draw on the same sources, so Low may give a little less power than Off; High gives more
    assert.ok(high.power > off.power && high.power > low.power, `${seed} power ${levels.map((level) => level.power)}`);
  }
});

test('the planner varies by seed, so services do not look the same everywhere', () => {
  const placesOf = (seed) => generate({ seed, ...HIGH, services: 'high' }).modules.filter((instance) => PIECES.includes(instance.family)).map((instance) => `${instance.family}:${instance.x},${instance.y},${instance.z}`).sort();
  const first = placesOf('barbican');
  const second = placesOf('habitat');
  assert.notDeepEqual(first, second);
  const families = (places) => new Set(places.map((place) => place.split(':')[0]));
  assert.ok(families(first).size >= 3 && families(second).size >= 3, 'a mix of pieces');
  // Off leaves the structure to the other passes alone
  assert.notEqual(structureHash(generate({ seed: 'barbican', ...HIGH, services: 'off' }).modules), structureHash(generate({ seed: 'barbican', ...HIGH, services: 'low' }).modules));
});

test('every block with Utilities on has live power at Low and High', () => {
  for (const seed of ['quarry', 'golden', 'lumen', 'hulme', 'habitat', 'x9']) {
    for (const services of ['low', 'high']) {
      const { modules } = generate({ seed, scale: 'block', services });
      const reports = Object.values(planServices(modules, seed).power.consumers);
      assert.ok(reports.some((report) => report.received > 0), `${seed} ${services} has no powered consumer`);
    }
  }
  // Utilities off adds no power pieces
  const { modules } = generate({ seed: 'quarry', scale: 'block', categories: ['social', 'nature', 'industrial', 'walled'] });
  assert.ok(!modules.some((instance) => ['solar', 'turbine', 'generator'].includes(instance.family)));
});
