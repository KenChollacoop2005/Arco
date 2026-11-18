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

// Water and power delivered, from the full solvers
function delivered(modules, seed) {
  const plan = planServices(modules, seed);
  const power = Object.values(plan.power.consumers).filter((report) => !report.relay);
  return { water: sum(Object.values(plan.water.consumers), 'received'), power: sum(power, 'received') };
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

test('services deliver more water from Low up, and High more power than Off', () => {
  for (const seed of ['barbican', 'golden']) {
    const levels = SERVICE_LEVELS.map((services) => {
      const { modules } = generate({ seed, ...HIGH, services });
      return { services, ...delivered(modules, seed), pieces: modules.filter((instance) => PIECES.includes(instance.family)).length + modules.filter((instance) => instance.jb).length };
    });
    const [off, low, high] = levels;
    assert.ok(low.pieces > off.pieces && high.pieces >= low.pieces, `${seed} pieces ${levels.map((level) => level.pieces)}`);
    assert.ok(low.water > off.water && high.water >= low.water, `${seed} water ${levels.map((level) => level.water)}`);
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
