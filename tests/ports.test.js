import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM } from '../js/config.js';
import { PORT_TYPES, PORT_FACES, PORT_REPEATS, FAMILY_PORTS, variantPorts, instancePorts } from '../js/core/ports.js';
import { FAMILIES, FAMILY_IDS } from '../js/core/catalog.js';
import { FOOTPRINTS, SIDES, instanceCells } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';

const variant = (family, fp, h, mask = 15) => ({ family, fp, h, seed: 1, mask, roof: false });
const placed = (id, family, fp, h, x, y, z, rot, mask = 15) => ({ id, family, fp, h, x, y, z, rot, seed: 1, mask, roof: false });
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

// True when a point lies on the outer wall of a cell set
function onWall(cells, position, normal) {
  const cellX = Math.floor((position[0] - normal[0] * 0.5) / CELL_MM);
  const cellY = Math.floor((position[1] - normal[1] * 0.5) / CELL_MM);
  const has = (x, y) => cells.some((cell) => cell[0] === x && cell[1] === y);
  const wall = normal[0] !== 0 ? (cellX + (normal[0] > 0 ? 1 : 0)) * CELL_MM : (cellY + (normal[1] > 0 ? 1 : 0)) * CELL_MM;
  const onPlane = near(normal[0] !== 0 ? position[0] : position[1], wall);
  return onPlane && has(cellX, cellY) && !has(cellX + normal[0], cellY + normal[1]);
}

test('every port rule names a known family, type, face and repeat', () => {
  for (const [family, rules] of Object.entries(FAMILY_PORTS)) {
    assert.ok(FAMILIES[family], family);
    for (const rule of rules) {
      assert.ok(PORT_TYPES[rule.type], `${family} type ${rule.type}`);
      assert.ok(PORT_FACES.includes(rule.face), `${family} face ${rule.face}`);
      assert.ok(PORT_REPEATS.includes(rule.each), `${family} each ${rule.each}`);
      assert.ok(rule.at.length === 2 && rule.at.every((part) => part >= 0 && part <= 1), `${family} at`);
    }
  }
  for (const [id, kind] of Object.entries(PORT_TYPES)) {
    assert.ok(kind.label && Number.isInteger(kind.capacity) && kind.capacity > 0, id);
  }
});

test('families without rules have no ports', () => {
  const bare = FAMILY_IDS.filter((family) => !FAMILY_PORTS[family]);
  assert.ok(bare.length > 0);
  for (const family of bare) assert.deepEqual(variantPorts(variant(family, FAMILIES[family].footprints[0], FAMILIES[family].minStories)), []);
});

test('housing ports follow the facade mask, cells and stories', () => {
  const ports = variantPorts(variant('housing', '1x2', 3, 0b0001));
  const count = (type) => ports.filter((port) => port.type === type).length;
  assert.equal(count('wire'), 1);
  assert.equal(count('balcony'), 3);
  assert.equal(count('infill'), 3);
  for (const port of ports) {
    assert.equal(port.side, 0);
    assert.deepEqual(port.normal, [1, 0, 0]);
    assert.ok(near(port.position[0], 2 * CELL_MM) && near(port.position[1], 0.5 * CELL_MM));
  }
  assert.deepEqual(ports.filter((port) => port.type === 'balcony').map((port) => port.position[2]), [0.3, 1.3, 2.3].map((part) => part * STORY_MM));
  assert.ok(near(ports.find((port) => port.type === 'wire').position[2], 0.85 * 3 * STORY_MM));
  assert.deepEqual(ports.map((port) => port.index), ports.map((port, order) => order));
  assert.equal(variantPorts(variant('housing', '1x2', 3, 0)).length, 0);
  assert.equal(variantPorts(variant('housing', '2x2', 1, 15)).filter((port) => port.type === 'wire').length, 8);
});

test('capacity comes from the rule, else from the type', () => {
  assert.equal(variantPorts(variant('turbine', '1x1', 2))[0].capacity, 8);
  assert.equal(variantPorts(variant('housing', '1x1', 1)).find((port) => port.type === 'wire').capacity, PORT_TYPES.wire.capacity);
  assert.equal(variantPorts(variant('garden', '2x2', 1))[0].capacity, PORT_TYPES.basin.capacity);
});

test('top ports sit on the roof inside a cell, side ports on an outer wall', () => {
  for (const family of Object.keys(FAMILY_PORTS)) {
    for (const fp of FAMILIES[family].footprints) {
      for (const stories of [FAMILIES[family].minStories, FAMILIES[family].maxStories]) {
        const cells = FOOTPRINTS[fp];
        const ports = variantPorts(variant(family, fp, stories));
        assert.ok(ports.length > 0, `${family} ${fp}`);
        for (const port of ports) {
          const label = `${family} ${fp} ${port.type} ${port.index}`;
          assert.ok(port.position[2] >= 0 && port.position[2] <= stories * STORY_MM, label);
          if (port.face === 'side') {
            assert.deepEqual(port.normal, [...SIDES[port.side], 0], label);
            assert.ok(onWall(cells, port.position, port.normal), label);
          } else {
            assert.equal(port.side, null, label);
            assert.equal(port.position[2], port.face === 'top' ? stories * STORY_MM : 0, label);
            const cell = [Math.floor(port.position[0] / CELL_MM), Math.floor(port.position[1] / CELL_MM)];
            assert.ok(cells.some((own) => own[0] === cell[0] && own[1] === cell[1]), label);
          }
        }
      }
    }
  }
});

test('placed ports turn and move with the module', () => {
  for (const fp of FAMILIES.housing.footprints) {
    for (let rot = 0; rot < 4; rot++) {
      const instance = placed(7, 'housing', fp, 2, -2, 1, 3, rot, 0b0110);
      const cells = instanceCells(instance);
      const ports = instancePorts(instance);
      assert.equal(ports.length, variantPorts(instance).length);
      for (const port of ports) {
        const label = `${fp} rot ${rot} ${port.type} ${port.index}`;
        assert.equal(port.module, 7);
        assert.deepEqual(port.normal, [...SIDES[port.side], 0], label);
        assert.ok(port.position[2] > 3 * STORY_MM && port.position[2] < 5 * STORY_MM, label);
        assert.ok(onWall(cells, port.position, port.normal), label);
      }
      const sides = new Set(ports.map((port) => port.side));
      assert.deepEqual([...sides].sort(), [(1 + rot) & 3, (2 + rot) & 3].sort(), `${fp} rot ${rot} sides`);
    }
  }
});

test('a new port type needs only data', () => {
  PORT_TYPES.lantern = { label: 'Lantern', capacity: 3 };
  try {
    const ports = variantPorts(variant('balcony', '1x1', 1), [{ type: 'lantern', face: 'bottom', each: 'cell', at: [0.25, 0.75] }]);
    assert.equal(ports.length, 1);
    assert.deepEqual(ports[0], { index: 0, type: 'lantern', capacity: 3, face: 'bottom', side: null, position: [0.25 * CELL_MM, 0.75 * CELL_MM, 0], normal: [0, 0, -1] });
    assert.deepEqual(variantPorts(variant('balcony', '1x1', 1), [{ type: 'missing', face: 'top', each: 'cell', at: [0.5, 0.5] }]), []);
  } finally {
    delete PORT_TYPES.lantern;
  }
});

test('ports of a generated structure are the same on every run', () => {
  const first = generate({ seed: 'habitat', scale: 'block' }).modules.flatMap(instancePorts);
  const second = generate({ seed: 'habitat', scale: 'block' }).modules.flatMap(instancePorts);
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
});
