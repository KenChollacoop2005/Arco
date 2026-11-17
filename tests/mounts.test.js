import test from 'node:test';
import assert from 'node:assert/strict';
import { PORT_FRONT_MM } from '../js/config.js';
import { normalizeVariant, FAMILIES, hasPump } from '../js/core/catalog.js';
import { variantOf } from '../js/core/collection.js';
import { instancePose, poseApply } from '../js/core/grid.js';
import { PORT_TYPES, STRING_PORT_TYPES } from '../js/core/ports.js';
import { MOUNT_PORTS, MOUNT_EACH, variantMounts, instanceMounts, structureMounts, worldColliders, groupAt } from '../js/core/mounts.js';
import { buildRecipe } from '../js/core/recipes.js';
import { generate } from '../js/core/generator.js';
import { getSolids, sampleVariants } from './helpers.js';

const SURFACE_TOL_MM = 0.01; // port to mesh distance allowed
const OUTSIDE_MM = 0.05; // a point this far out is free air
const SEEDS = ['arco', 'habitat', 'barbican'];
const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };

const sub = (first, second) => [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
const along = (from, step, share) => [from[0] + step[0] * share, from[1] + step[1] * share, from[2] + step[2] * share];

// Distance from a point to a triangle (closest point by regions)
function triangleDistance(point, cornerA, cornerB, cornerC) {
  const edgeAB = sub(cornerB, cornerA);
  const edgeAC = sub(cornerC, cornerA);
  const fromA = sub(point, cornerA);
  const d1 = dot(edgeAB, fromA);
  const d2 = dot(edgeAC, fromA);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...fromA);
  const fromB = sub(point, cornerB);
  const d3 = dot(edgeAB, fromB);
  const d4 = dot(edgeAC, fromB);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(...fromB);
  const nearC = d1 * d4 - d3 * d2;
  if (nearC <= 0 && d1 >= 0 && d3 <= 0) return Math.hypot(...sub(point, along(cornerA, edgeAB, d1 / (d1 - d3))));
  const fromC = sub(point, cornerC);
  const d5 = dot(edgeAB, fromC);
  const d6 = dot(edgeAC, fromC);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(...fromC);
  const nearB = d5 * d2 - d1 * d6;
  if (nearB <= 0 && d2 >= 0 && d6 <= 0) return Math.hypot(...sub(point, along(cornerA, edgeAC, d2 / (d2 - d6))));
  const nearA = d3 * d6 - d5 * d4;
  if (nearA <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return Math.hypot(...sub(point, along(cornerB, sub(cornerC, cornerB), (d4 - d3) / (d4 - d3 + (d5 - d6)))));
  const scale = 1 / (nearA + nearB + nearC);
  return Math.hypot(...sub(point, along(along(cornerA, edgeAB, nearB * scale), edgeAC, nearC * scale)));
}

function meshDistance(mesh, point) {
  const { positions, index } = mesh;
  const corner = (at) => [positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]];
  let best = Infinity;
  for (let face = 0; face < index.length; face += 3) {
    // Zero area triangles give NaN and are skipped
    const distance = triangleDistance(point, corner(index[face]), corner(index[face + 1]), corner(index[face + 2]));
    if (distance < best) best = distance;
  }
  return best;
}

const insideBox = (shape, point) => point.every((value, axis) => value > shape.min[axis] && value < shape.max[axis]);
const part = (id, family, fp, h, x, y, z, rot, mask) => ({ ...normalizeVariant({ family, fp, h, seed: 5, mask, roof: false }), id, x, y, z, rot });

test('every port rule names a known family, string type and repeat', () => {
  for (const [family, rules] of Object.entries(MOUNT_PORTS)) {
    assert.ok(FAMILIES[family], family);
    for (const rule of rules) {
      assert.ok(STRING_PORT_TYPES.includes(rule.type), `${family} ${rule.type}`);
      assert.ok(PORT_TYPES[rule.type].string, rule.type);
      assert.ok(MOUNT_EACH.includes(rule.each), `${family} ${rule.each}`);
      assert.ok(['facade', 'any'].includes(rule.sides), `${family} ${rule.sides}`);
      assert.ok(!!rule.z !== !!rule.zMm || (rule.each === 'story' && !rule.zMm), `${family} height range`);
    }
  }
});

test('every port sits on a real surface of its module', async () => {
  const solids = await getSolids();
  let checked = 0;
  for (const variant of sampleVariants()) {
    const ports = variantMounts(variant);
    if (ports.length === 0) continue;
    const { ops } = buildRecipe(variant);
    const mesh = solids.buildVariant(variant, { edges: false }).render;
    for (const port of ports) {
      const label = `${variant.family} ${variant.fp} h${variant.h} ${port.type} ${port.index}`;
      assert.ok(meshDistance(mesh, port.position) <= SURFACE_TOL_MM, `${label} off the surface`);
      // Free air just in front, solid just behind
      assert.equal(groupAt(ops, port.position.map((value, axis) => value + port.normal[axis] * OUTSIDE_MM)), null, `${label} buried`);
      assert.notEqual(groupAt(ops, port.position.map((value, axis) => value - port.normal[axis] * OUTSIDE_MM)), null, `${label} floating`);
      assert.ok(port.capacity >= 1);
      checked++;
    }
  }
  assert.ok(checked > 500, `ports checked: ${checked}`);
});

test('every family with rules gets each port type on a full facade variant', () => {
  for (const [family, rules] of Object.entries(MOUNT_PORTS)) {
    const spec = FAMILIES[family];
    const fp = spec.footprints.includes('1x2') ? '1x2' : spec.footprints[0];
    const variant = normalizeVariant({ family, fp, h: spec.maxStories, seed: 21, mask: 15, roof: false });
    const ports = variantMounts(variant);
    // Pump ports only on a variant that has the pump
    for (const rule of rules) if (!rule.when || hasPump(variant)) assert.ok(ports.some((port) => port.type === rule.type), `${family} ${rule.type}`);
  }
});

test('no active port is inside another module, ports on touching faces are off', () => {
  let active = 0;
  let off = 0;
  for (const seed of SEEDS) {
    for (const options of [{ seed, scale: 'block' }, { seed, ...MEGA }]) {
      const { modules } = generate(options);
      const boxes = worldColliders(modules);
      for (const port of structureMounts(modules, boxes)) {
        const front = port.position.map((value, axis) => value + port.normal[axis] * PORT_FRONT_MM);
        const others = boxes.filter((shape) => shape.module !== port.module);
        const buried = others.some((shape) => insideBox(shape, port.position) || insideBox(shape, front));
        if (port.active) {
          active++;
          assert.ok(!buried, `${seed} port ${port.module}:${port.index} inside a module`);
          assert.ok(port.position[2] >= 0);
        } else {
          off++;
          assert.ok(['neighbour', 'roofed'].includes(port.reason));
          if (port.reason === 'neighbour') assert.ok(buried);
        }
      }
    }
  }
  assert.ok(active > 300 && off > 20, `active ${active}, off ${off}`);
  // Two housing units with facing facades: those faces go dark
  const pair = [part(1, 'housing', '1x1', 2, 0, 0, 0, 0, 0b0001), part(2, 'housing', '1x1', 2, 1, 0, 0, 0, 0b0100)];
  const ports = structureMounts(pair);
  assert.ok(ports.length > 0);
  for (const port of ports) {
    if (port.type === 'water-out') assert.equal(port.reason, port.active ? null : port.reason);
    else assert.equal(port.reason, 'neighbour', `${port.module} ${port.type}`);
  }
  // A gutter goes dark under a module on its roof
  const tower = [part(1, 'housing', '1x1', 2, 0, 0, 0, 0, 15)];
  const gutter = (list) => structureMounts(list).find((port) => port.module === 1 && port.type === 'water-out');
  assert.equal(gutter(tower).active, true);
  assert.equal(gutter([...tower, part(2, 'core', '1x1', 1, 0, 0, 2, 0, 0)]).reason, 'roofed');
});

test('port positions reproduce from the seed, through saving and turning', () => {
  const record = normalizeVariant({ family: 'housing', fp: '2x2', h: 3, seed: 4242, mask: 0b1011, roof: false });
  const first = variantMounts(record);
  assert.ok(first.length >= 4);
  // A saved and reloaded record gives the same ports
  const saved = variantOf(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(variantMounts({ ...saved }), first);
  // A new seed moves them
  assert.notDeepEqual(variantMounts({ ...record, seed: 4243 }).map((port) => port.position), first.map((port) => port.position));
  for (let rot = 0; rot < 4; rot++) {
    const instance = { ...record, id: 3, x: -2, y: 1, z: 2, rot };
    const pose = instancePose(instance);
    instanceMounts(instance).forEach((port, order) => {
      assert.deepEqual(port.position, poseApply(pose, ...first[order].position));
      assert.equal(port.side, (first[order].side + rot) & 3);
    });
  }
  const { modules } = generate({ seed: 'habitat', scale: 'block' });
  assert.deepEqual(structureMounts(modules), structureMounts(generate({ seed: 'habitat', scale: 'block' }).modules));
});
