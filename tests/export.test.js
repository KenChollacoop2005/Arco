import test from 'node:test';
import assert from 'node:assert/strict';
import { partsList } from '../js/core/exportplan.js';
import { CELL_MM, STORY_MM, BED_MM, PLATE_GAP_MM, PLATE_EDGE_MM, CONNECTOR_CLEARANCE_MM, RAIL_DEPTH_MM } from '../js/config.js';
import { generate } from '../js/core/generator.js';
import { meshStats } from '../js/core/meshtools.js';
import { writeStl, parseStl } from '../js/core/stl.js';
import { packPlates } from '../js/core/packing.js';
import { crc32, zipStore } from '../js/core/zip.js';
import { buildExport, buildCoupon, pegJoints } from '../js/core/exportplan.js';
import { getSolids } from './helpers.js';

const TOL_MM = 0.01;
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= TOL_MM, `${label}: ${actual} should be ${expected}`);

const cube = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]),
  index: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
};

test('binary STL has the right size, count and normals, and reads back', () => {
  const bytes = writeStl(cube, 'cube');
  assert.equal(bytes.length, 80 + 4 + 12 * 50);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(80, true), 12);
  assert.notEqual(String.fromCharCode(...bytes.slice(0, 5)), 'solid');
  // First triangle is on the bottom, normal straight down
  near(view.getFloat32(84 + 8, true), -1, 'first normal z');
  const stats = meshStats(parseStl(bytes));
  assert.ok(stats.watertight);
  near(stats.volume, 1000, 'cube volume');
});

test('a module STL is manifold, watertight and matches the grid', async () => {
  const solids = await getSolids();
  const variant = { family: 'housing', fp: '2x3', h: 2, seed: 21, mask: 5, roof: false };
  const built = solids.buildVariant(variant, { connectors: true, render: false, edges: false });
  const stats = meshStats(parseStl(writeStl(built.solid, 'housing')));
  assert.ok(stats.watertight, 'watertight after a round trip');
  assert.ok(stats.volume > 0, 'positive volume');
  assert.equal(stats.triangles, built.solid.index.length / 3);
  const inset = CONNECTOR_CLEARANCE_MM / 2;
  // Sides 0 and 2 are facades at the cell faces, sides 1 and 3 carry rails
  near(stats.min[0], inset, 'min x');
  near(stats.max[0], 3 * CELL_MM - inset, 'max x');
  near(stats.max[0] - stats.min[0] + CONNECTOR_CLEARANCE_MM, 3 * CELL_MM, 'pitch x');
  near(stats.min[1], -RAIL_DEPTH_MM + inset, 'rail tip low y');
  near(stats.max[1], 2 * CELL_MM + RAIL_DEPTH_MM - inset, 'rail tip high y');
  near(stats.min[2], 0, 'base');
  near(stats.max[2], 2 * STORY_MM, 'height');
});

test('plate packing keeps parts on the bed and apart', () => {
  const parts = [];
  for (let count = 0; count < 40; count++) parts.push({ id: 'part ' + count, width: 20 + (count % 5) * 14, depth: 25 + (count % 3) * 25 });
  parts.push({ id: 'too big', width: 190, depth: 30 });
  const { plates, oversize } = packPlates(parts);
  assert.deepEqual(oversize, ['too big']);
  assert.equal(plates.flat().length, 40);
  assert.ok(plates.length > 1);
  for (const items of plates) {
    for (const item of items) {
      const part = parts.find((entry) => entry.id === item.id);
      assert.deepEqual([item.width, item.depth].sort(), [part.width, part.depth].sort());
      assert.equal(item.turned, part.depth > part.width);
      assert.ok(item.x >= PLATE_EDGE_MM && item.y >= PLATE_EDGE_MM, item.id + ' low edge');
      assert.ok(item.x + item.width <= BED_MM - PLATE_EDGE_MM + 1e-9 && item.y + item.depth <= BED_MM - PLATE_EDGE_MM + 1e-9, item.id + ' high edge');
      for (const other of items) {
        if (other === item) continue;
        const apartX = other.x >= item.x + item.width + PLATE_GAP_MM - 1e-9 || item.x >= other.x + other.width + PLATE_GAP_MM - 1e-9;
        const apartY = other.y >= item.y + item.depth + PLATE_GAP_MM - 1e-9 || item.y >= other.y + other.depth + PLATE_GAP_MM - 1e-9;
        assert.ok(apartX || apartY, `${item.id} and ${other.id} overlap`);
      }
    }
  }
  assert.deepEqual(packPlates(parts), { plates, oversize });
});

test('zip store has valid checksums and offsets', () => {
  // Standard CRC-32 check value
  assert.equal(crc32(Uint8Array.from('123456789', (letter) => letter.charCodeAt(0))), 0xcbf43926);
  const first = Uint8Array.from([1, 2, 3, 4, 5]);
  const second = Uint8Array.from([9, 8, 7]);
  const bytes = zipStore([{ name: 'a.stl', bytes: first }, { name: 'b.stl', bytes: second }]);
  const view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 30 + 5 + 5 + 30 + 5 + 3 + 2 * (46 + 5) + 22);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), crc32(first));
  assert.deepEqual([...bytes.slice(35, 40)], [...first]);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const indexStart = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(indexStart, true), 0x02014b50);
  const secondRecord = indexStart + 46 + 5;
  const secondOffset = view.getUint32(secondRecord + 42, true);
  assert.equal(view.getUint32(secondOffset, true), 0x04034b50);
  assert.deepEqual([...bytes.slice(secondOffset + 35, secondOffset + 38)], [...second]);
});

test('peg count is one per socket pair', () => {
  const sockets = (instance) => (instance.fp === '1x1' ? { top: [0], bottom: [0] } : { top: [0, 1], bottom: [0, 1] });
  const lower = { id: 1, fp: '1x2', rot: 0, x: 0, y: 0, z: 0, h: 1 };
  const upper = { id: 2, fp: '1x2', rot: 0, x: 1, y: 0, z: 1, h: 1 };
  const beside = { id: 3, fp: '1x1', rot: 0, x: 5, y: 0, z: 0, h: 1 };
  assert.equal(pegJoints([lower, upper, beside], sockets), 1);
  assert.equal(pegJoints([lower, { ...upper, x: 0 }], sockets), 2);
  assert.equal(pegJoints([lower, { ...upper, x: 0 }], (instance) => (instance.id === 2 ? { top: [], bottom: [] } : sockets(instance))), 0);
});

test('a generated structure exports as watertight plates with its pegs', async () => {
  const solids = await getSolids();
  const structure = generate({ seed: 'habitat', scale: 'block' });
  const result = buildExport(solids, structure.modules);
  assert.equal(result.oversize.length, 0);
  assert.equal(result.modules, structure.modules.length);
  assert.ok(result.pegs > 0, 'pegs');
  assert.equal(result.layout.flat().length, structure.modules.length + result.pegs);
  let volume = 0;
  for (const plate of result.plates) {
    const stats = meshStats(parseStl(writeStl(plate, 'plate')));
    assert.ok(stats.watertight, 'plate watertight');
    assert.ok(stats.min[0] >= PLATE_EDGE_MM - TOL_MM && stats.min[1] >= PLATE_EDGE_MM - TOL_MM, 'plate low edge');
    assert.ok(stats.max[0] <= BED_MM - PLATE_EDGE_MM + TOL_MM && stats.max[1] <= BED_MM - PLATE_EDGE_MM + TOL_MM, 'plate high edge');
    assert.ok(stats.max[2] <= BED_MM, 'plate height');
    near(stats.min[2], 0, 'parts sit on the bed');
    volume += stats.volume;
  }
  assert.ok(volume > 0);
  const single = buildExport(solids, [structure.modules[0]]);
  assert.equal(single.plates.length, 1);
  assert.equal(single.pegs, 0);
});

test('the fit coupon plate holds two blocks and a peg', async () => {
  const solids = await getSolids();
  const stats = meshStats(parseStl(writeStl(buildCoupon(solids), 'coupon')));
  assert.ok(stats.watertight);
  assert.ok(stats.max[0] < 50 && stats.max[1] < 50, 'coupon stays small');
  near(stats.min[2], 0, 'on the bed');
});

test('the parts list says which plate holds each module, every module once', async () => {
  const solids = await getSolids();
  const { modules } = generate({ seed: 'habitat', scale: 'block', density: 1, height: 1, daring: 1, theme: 1 });
  const built = buildExport(solids, modules);
  const text = partsList(built.layout, modules, 'arco-habitat');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines[0], `arco-habitat: ${built.plates.length} plates`);
  assert.equal(lines.filter((line) => line.startsWith('Plate ')).length, built.plates.length);
  for (const instance of modules) {
    const listed = lines.filter((line) => line.startsWith(`  module ${instance.id},`));
    assert.equal(listed.length, 1, `module ${instance.id} listed once`);
  }
  assert.ok(lines[2].startsWith('Plate 01: '));
  assert.ok(!/[–—]/.test(text), 'no long dashes');
});
