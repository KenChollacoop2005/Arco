import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_DEMAND, LIGHT_RADIUS_CELLS, WINDOW_LIT_SHARE, POWER_DEMAND } from '../js/config.js';
import { normalizeVariant, FAMILIES } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { powerRole } from '../js/core/power.js';
import { planServices, portUse } from '../js/core/services.js';
import { structureMounts } from '../js/core/mounts.js';
import { lightDemand, lightPlan, windowLight, litCells } from '../js/core/lights.js';
import { variantKey } from '../js/core/grid.js';

const part = (id, family, fp, h, x, y, z, extra = {}) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false, ...extra }), id, x, y, z, rot: 0 });

test('lights count as power demand, always', () => {
  assert.deepEqual(powerRole(part(1, 'lamppost', '1x1', 1, 0, 0, 0)), { kind: 'consumer', demand: LIGHT_DEMAND.lamppost });
  assert.deepEqual(powerRole(part(1, 'floodlight', '1x1', 2, 0, 0, 0)), { kind: 'consumer', demand: LIGHT_DEMAND.floodlight });
  // A beacon makes an antenna a consumer; without one it draws nothing
  assert.equal(powerRole(part(1, 'antenna', '1x1', 3, 0, 0, 0)), null);
  const beacon = part(1, 'antenna', '1x1', 3, 0, 0, 0, { bc: 1 });
  assert.equal(beacon.bc, 1);
  assert.deepEqual(powerRole(beacon), { kind: 'consumer', demand: LIGHT_DEMAND.beacon });
  assert.equal(lightDemand(beacon), LIGHT_DEMAND.beacon);
  // Beacons only on antennas; the record keeps it and the key tells it apart
  assert.equal(normalizeVariant({ family: 'housing', fp: '1x1', h: 1, seed: 3, bc: 1 }).bc, undefined);
  assert.notEqual(variantKey(beacon), variantKey(part(1, 'antenna', '1x1', 3, 0, 0, 0)));
  // String lights add their demand to the module that feeds them
  assert.equal(powerRole(part(7, 'housing', '1x1', 1, 0, 0, 0), {}, { 7: LIGHT_DEMAND.stringlights }).demand, POWER_DEMAND.housing + LIGHT_DEMAND.stringlights);
  assert.ok(FAMILIES.lamppost.categories.includes('utilities') && FAMILIES.floodlight.categories.includes('utilities'));
});

test('window light follows the power share, flickers under half', () => {
  assert.deepEqual(windowLight(0), [0, 0]);
  assert.deepEqual(windowLight(1), [WINDOW_LIT_SHARE, 0]);
  assert.deepEqual(windowLight(0.5), [WINDOW_LIT_SHARE * 0.5, 0]);
  assert.deepEqual(windowLight(0.25), [WINDOW_LIT_SHARE * 0.25, 1]);
});

test('unpowered lights stay dark, powered ones light', () => {
  const alone = [part(1, 'lamppost', '1x1', 1, 0, 0, 0)];
  const dark = lightPlan(alone, planServices(alone, 'lamps'));
  assert.equal(dark.sources.length, 1);
  assert.equal(dark.sources[0].lit, false);
  assert.deepEqual(dark.modules[1].window, [0, 0]);
  assert.deepEqual(dark.cells, []);
  // A turbine two cells away feeds it
  const fed = [part(1, 'lamppost', '1x1', 1, 0, 0, 0), part(2, 'turbine', '1x1', 2, 2, 0, 0)];
  const services = planServices(fed, 'lamps');
  assert.equal(services.power.consumers[1].status, 'full');
  const lit = lightPlan(fed, services);
  assert.equal(lit.sources[0].lit, true);
  assert.equal(lit.modules[1].radius, LIGHT_RADIUS_CELLS.lamppost);
  assert.ok(lit.cells.length > 0);
});

test('a lamp post lights the cells within its radius, by hand', () => {
  // Lamp head centre at cell (0, 0), 23.4 mm up; radius 2 cells is 50 mm
  const source = { point: [12.5, 12.5, 23.4], radius: 2, lit: true };
  const keys = new Set(litCells([source], 4).map((cell) => cell.join(',')));
  // (1, 1, 0): 25, 25, 10.9 off, 37 mm, in
  assert.ok(keys.has('0,0,0') && keys.has('1,1,0') && keys.has('-1,-1,0'));
  // (2, 0, 0): 50, 0, 10.9 off, 51.2 mm, out; (0, 2, 0) the same
  assert.ok(!keys.has('2,0,0') && !keys.has('0,2,0'));
  // (0, 0, 2): 39.1 mm up, in; (0, 0, 3): 64.1 mm, out
  assert.ok(keys.has('0,0,2') && !keys.has('0,0,3'));
  // (1, 0, 1): 25, 0, 14.1 off, 28.7 mm, in; (1, 1, 2): 25, 25, 39.1, 52.7 mm, out
  assert.ok(keys.has('1,0,1') && !keys.has('1,1,2'));
  // Plan cells within 50 mm at level 0 (10.9 mm down): x and y offsets in cells with 625 (dx2 + dy2) <= 2500 - 118.8
  let expected = 0;
  for (let cellX = -2; cellX <= 2; cellX++) for (let cellY = -2; cellY <= 2; cellY++) if (625 * (cellX * cellX + cellY * cellY) + 10.9 ** 2 <= 2500) expected++;
  assert.equal([...keys].filter((key) => key.endsWith(',0')).length, expected);
  // Unlit lights light nothing
  assert.deepEqual(litCells([{ ...source, lit: false }], 4), []);
});

test('generated string lights hang between line hooks and feed from their owner', () => {
  let runs = 0;
  for (const seed of ['arco', 'habitat', 'barbican', 'golden', 'trellick', 'beton']) {
    const { modules } = generate({ seed, scale: 'mega', density: 2, services: 'high' });
    const services = planServices(modules, seed);
    const ports = structureMounts(modules);
    for (const run of services.lights) {
      runs++;
      assert.equal(run.type, 'lights');
      assert.equal(run.blocked, null);
      assert.ok([run.from.module, run.to.module].includes(run.owner));
      const owner = modules.find((instance) => instance.id === run.owner);
      assert.ok(powerRole(owner, {}, { [owner.id]: LIGHT_DEMAND.stringlights }).demand >= LIGHT_DEMAND.stringlights);
      assert.ok(services.power.consumers[run.owner], `${seed} owner ${run.owner} is a consumer`);
    }
    // String lights share line hook capacity with clotheslines and tarps
    for (const instance of modules) for (const row of portUse(ports, services, instance.id)) assert.ok(row.used <= row.capacity);
    const plan = lightPlan(modules, services);
    for (const run of plan.strings) assert.equal(run.lit, (plan.modules[run.owner].share > 0));
  }
  assert.ok(runs > 0, 'some string lights');
});
