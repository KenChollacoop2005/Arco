import test from 'node:test';
import assert from 'node:assert/strict';
import { WIRE_MAX_MM, JUMPER_MAX_MM, CABLES_PER_LINK, ROOM_NEAR_MM, POWER_SOURCES, POWER_ROOMS } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { instanceCells } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';
import { structureMounts } from '../js/core/mounts.js';
import { stringContext, pathBlocked } from '../js/core/strings.js';
import { planPower, planCross, chooseLink } from '../js/core/power.js';

const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };
const EPS_MM = 1e-6; // rounding slack
const part = (id, family, fp, h, x, y, z, mask = 15, seed = 3) => ({ ...normalizeVariant({ family, fp, h, seed, mask, roof: false }), id, x, y, z, rot: 0 });
const powerOf = (modules, seed, extra = {}) => planPower(modules, seed, { ports: structureMounts(modules), context: stringContext(modules), ...extra });

test('plan crossings count only real crossings', () => {
  assert.ok(planCross([0, 0], [10, 10], [0, 10], [10, 0]));
  assert.ok(!planCross([0, 0], [10, 0], [0, 5], [10, 5]));
  assert.ok(!planCross([0, 0], [10, 0], [10, 0], [10, 10]));
});

test('a power room on a roof wires across the gap to a facing tower', () => {
  const modules = [
    part(1, 'core', '1x1', 2, 0, 0, 0, 0),
    part(2, 'powerroom', '1x1', 1, 0, 0, 2),
    part(3, 'housing', '1x1', 3, 3, 0, 0, 0b0100),
  ];
  const power = powerOf(modules, 'gap');
  assert.equal(power.links.length, 1);
  assert.deepEqual([power.links[0].from.module, power.links[0].to.module], [2, 3]);
  assert.deepEqual(power.powered, [2, 3]);
  const cables = power.cables.filter((cable) => !cable.spare);
  assert.ok(cables.length >= CABLES_PER_LINK[0] && cables.length <= CABLES_PER_LINK[1]);
  for (const cable of power.cables) {
    assert.equal(cable.type, 'wire');
    assert.ok(cable.length <= WIRE_MAX_MM + EPS_MM);
    assert.ok(cable.length > Math.hypot(...cable.to.position.map((value, axis) => value - cable.from.position[axis])), 'sag adds length');
    // Lowest point between the ends
    const low = Math.min(...cable.points.map((point) => point[2]));
    assert.ok(low < Math.min(cable.from.position[2], cable.to.position[2]));
  }
  // Each cable of a link hangs its own way
  if (cables.length > 1) assert.notDeepEqual(cables[0].points, cables[1].points);
  // A tower in the gap stops it
  const shut = powerOf([...modules, part(4, 'core', '1x1', 4, 1, 0, 0)], 'gap');
  assert.equal(shut.links.length, 0);
  assert.ok(shut.blocked.length > 0 && shut.blocked[0].blocked.reason === 'module');
});

test('generated wires keep port capacity, length, jumper and source rules, and stay clear of modules', () => {
  let links = 0;
  let cables = 0;
  let spares = 0;
  for (const seed of ['barbican', 'habitat', 'arco']) {
    const { modules } = generate({ seed, ...MEGA });
    const mounts = structureMounts(modules);
    const context = stringContext(modules);
    const power = planPower(modules, seed, { ports: mounts, context });
    const byId = new Map(modules.map((instance) => [instance.id, instance]));
    const portOf = (end) => mounts.find((port) => port.module === end.module && port.index === end.index);
    const used = new Map();
    const fed = new Set();
    const rooms = mounts.filter((port) => port.active && POWER_ROOMS.includes(byId.get(port.module).family));
    const cellsOf = (id) => new Set(instanceCells(byId.get(id)).map((cell) => cell.join()));
    for (const link of power.links) {
      links++;
      for (const end of [link.from, link.to]) {
        const key = end.module + ':' + end.index;
        used.set(key, (used.get(key) || 0) + 1);
        assert.ok(used.get(key) <= portOf(end).capacity, `${seed} port ${key} over capacity`);
        assert.ok(portOf(end).active && portOf(end).type === 'power');
      }
      assert.ok(link.length <= WIRE_MAX_MM + EPS_MM);
      if (!POWER_ROOMS.includes(byId.get(link.to.module).family)) {
        assert.ok(!fed.has(link.to.module), `${seed} module ${link.to.module} fed twice`);
        fed.add(link.to.module);
      }
      // Touching modules (sharing a face) only get a short jumper
      const from = byId.get(link.from.module);
      const to = byId.get(link.to.module);
      const shared = [...cellsOf(from.id)].filter((cell) => cellsOf(to.id).has(cell)).length > 0;
      const stacked = shared && (from.z + from.h === to.z || to.z + to.h === from.z);
      const side = [...cellsOf(from.id)].some((cell) => { const [x, y] = cell.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([stepX, stepY]) => cellsOf(to.id).has([x + stepX, y + stepY].join())); }) && from.z < to.z + to.h && to.z < from.z + from.h;
      if (stacked || side) assert.ok(link.length <= JUMPER_MAX_MM + EPS_MM, `${seed} long wire between touching modules`);
      // A source feeds a bracket directly only with no power room near
      if (POWER_SOURCES.includes(from.family) && !POWER_ROOMS.includes(to.family)) {
        const end = portOf(link.to).position;
        assert.ok(rooms.every((room) => Math.hypot(...room.position.map((value, axis) => value - end[axis])) > ROOM_NEAR_MM), `${seed} source skipped a near room`);
      }
    }
    for (const cable of power.cables) {
      cables++;
      if (cable.spare) spares++;
      assert.ok(cable.length <= WIRE_MAX_MM + EPS_MM, `${seed} cable too long`);
      assert.equal(pathBlocked(context, cable.points, [cable.from.module, cable.to.module]), null, `${seed} cable through a module`);
      assert.ok(cable.points.every((point) => point[2] >= 0));
    }
    const perLink = new Map();
    for (const cable of power.cables) if (!cable.spare) perLink.set(cable.link, (perLink.get(cable.link) || 0) + 1);
    for (const count of perLink.values()) assert.ok(count >= 1 && count <= CABLES_PER_LINK[1]);
    assert.deepEqual(planPower(modules, seed, { ports: mounts, context }), power);
  }
  assert.ok(links >= 40 && cables >= links && spares >= 1, `links ${links}, cables ${cables}, spares ${spares}`);
});

test('a crossing cost picks the longer clear wire over the shorter crossing one', () => {
  const end = (module, position) => ({ module, index: 0, position });
  // An existing wire runs from (0, 0) to (40, 40); the nearest option crosses it
  const plans = [[[0, 0, 10], [40, 40, 10]]];
  const crossing = { from: end(1, [0, 40, 10]), to: end(2, [40, 0, 10]), length: 56.6 };
  const clear = { from: end(1, [0, 40, 10]), to: end(3, [-30, 10, 10]), length: 70 };
  const hang = () => ({ blocked: null });
  assert.equal(chooseLink([crossing, clear], plans, 0, hang).to.module, 2);
  const bundled = chooseLink([crossing, clear], plans, 37.5, hang);
  assert.equal(bundled.to.module, 3);
  assert.equal(bundled.crossings, 0);
  // A blocked option is never chosen
  assert.equal(chooseLink([crossing, clear], plans, 0, (option) => ({ blocked: option.to.module === 2 ? { reason: 'module' } : null })).to.module, 3);
  // A generated megastructure still gets wires with the cost on
  const { modules } = generate({ seed: 'habitat', ...MEGA });
  const power = powerOf(modules, 'habitat');
  assert.ok(power.links.length > 0);
});
