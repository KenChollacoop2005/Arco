import test from 'node:test';
import assert from 'node:assert/strict';
import { portUse, planServices } from '../js/core/services.js';
import { structureMounts } from '../js/core/mounts.js';
import { generate } from '../js/core/generator.js';

const none = { pipes: [], wires: [], lines: [], tarps: [] };

test('port use by hand: ends counted per port, capped, inactive ports left out', () => {
  const ports = [
    { module: 1, index: 0, type: 'power', capacity: 2 },
    { module: 1, index: 1, type: 'power', capacity: 2 },
    { module: 1, index: 2, type: 'water-in', capacity: 2 },
    { module: 1, index: 3, type: 'line', capacity: 2, active: false },
    { module: 2, index: 0, type: 'power', capacity: 2 },
  ];
  const services = {
    ...none,
    wires: [
      { from: { module: 1, index: 0 }, to: { module: 2, index: 0 } },
      { from: { module: 1, index: 0 }, to: { module: 2, index: 0 } },
      { from: { module: 2, index: 0 }, to: { module: 1, index: 0 } },
    ],
  };
  assert.deepEqual(portUse(ports, services, 1), [
    { type: 'power', used: 2, capacity: 4 },
    { type: 'water-in', used: 0, capacity: 2 },
  ]);
  assert.deepEqual(portUse(ports, null, 2), [{ type: 'power', used: 0, capacity: 2 }]);
});

test('port use on a generated structure never passes capacity and adds up to the string ends', () => {
  const { modules } = generate({ seed: 'habitat', scale: 'block' });
  const services = planServices(modules, 'habitat');
  const ports = structureMounts(modules);
  let used = 0;
  for (const instance of modules) {
    for (const row of portUse(ports, services, instance.id)) {
      assert.ok(row.used >= 0 && row.used <= row.capacity, `${instance.family} ${row.type}`);
      used += row.used;
    }
  }
  const ends = 2 * (services.pipes.length + services.wires.length + services.lines.length) + services.tarps.reduce((sum, tarp) => sum + tarp.anchors.length, 0);
  assert.ok(ends > 0, 'some strings');
  assert.equal(used, ends);
});
