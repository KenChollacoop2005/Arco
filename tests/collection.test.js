import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_KEY, createCollection, makeEntry, parseCollection, serializeCollection, variantOf } from '../js/core/collection.js';
import { variantKey } from '../js/core/grid.js';
import { rasterThumb } from '../js/core/thumb.js';
import { generate } from '../js/core/generator.js';
import { createBuild } from '../js/core/build.js';
import { FAMILIES, FAMILY_IDS } from '../js/core/catalog.js';
import { CELL_MM } from '../js/config.js';
import { streamFrom } from '../js/core/stream.js';
import { getSolids, sampleVariants } from './helpers.js';

const THUMB = 'data:image/png;base64,AAAA';
const housing = { family: 'housing', fp: '2x2', h: 3, seed: 583524249, mask: 5, roof: true };
const tank = { family: 'tank', fp: '1x1', h: 2, seed: 4, mask: 15, roof: true };

function memoryStore() {
  const items = new Map();
  return { items, getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, value) };
}

test('a saved module keeps its variant record and nothing else', () => {
  const instance = { ...housing, id: 7, x: 2, y: -1, z: 3, rot: 2, placement: 'Filler' };
  const entry = makeEntry(instance, THUMB);
  assert.deepEqual(entry.variant, housing);
  assert.equal(entry.key, variantKey(instance));
  assert.equal(entry.thumb, THUMB);
});

test('collection JSON round trip gives identical variants', () => {
  const { modules } = generate({ seed: 'habitat', scale: 'block' });
  const entries = [];
  const seen = new Set();
  for (const instance of modules) {
    const entry = makeEntry(instance, THUMB);
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
  }
  assert.ok(entries.length > 3);
  const parsed = parseCollection(serializeCollection(entries));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries, entries);
  assert.deepEqual(parsed.entries.map((entry) => variantKey(entry.variant)), entries.map((entry) => entry.key));
});

test('files that are not a collection are refused', () => {
  assert.equal(parseCollection('not json').ok, false);
  assert.equal(parseCollection('{"modules":[]}').ok, false);
  assert.equal(parseCollection(JSON.stringify({ kind: 'arco-collection', modules: 'x' })).ok, false);
  assert.equal(parseCollection(JSON.stringify({ kind: 'arco-collection', modules: [{ family: 'castle' }] })).ok, false);
});

test('bad records are dropped and good ones kept', () => {
  assert.equal(variantOf({ ...housing, fp: '9x9' }), null);
  assert.equal(variantOf({ ...housing, h: 9 }), null);
  assert.equal(variantOf({ ...housing, seed: 'abc' }), null);
  const text = JSON.stringify({ kind: 'arco-collection', version: 1, modules: [housing, { family: 'castle' }, null, { ...tank, thumb: 'javascript:alert(1)' }] });
  const parsed = parseCollection(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries.map((entry) => entry.variant), [housing, tank]);
  assert.equal(parsed.entries[1].thumb, '');
});

test('the store saves, reloads, skips duplicates and removes', () => {
  const storage = memoryStore();
  const first = createCollection(storage);
  assert.deepEqual(first.load(), []);
  assert.deepEqual(first.add(housing, THUMB), { ok: true, added: true, stored: true, key: variantKey(housing) });
  assert.equal(first.add(housing, THUMB).added, false);
  first.add(tank, THUMB);
  const second = createCollection(storage);
  assert.deepEqual(second.load().map((entry) => entry.variant), [housing, tank]);
  assert.equal(second.remove(variantKey(housing)).stored, true);
  assert.deepEqual(createCollection(storage).load().map((entry) => entry.variant), [tank]);
});

test('import merges a file into the collection', () => {
  const source = createCollection(memoryStore());
  source.add(housing, THUMB);
  source.add(tank, THUMB);
  const target = createCollection(memoryStore());
  target.add(tank, '');
  assert.deepEqual(target.merge(source.toJson()), { ok: true, added: 1, stored: true });
  assert.deepEqual(target.list().map((entry) => entry.variant), [tank, housing]);
  assert.equal(target.merge('{}').ok, false);
  assert.equal(target.list().length, 2);
});

test('a full or blocked store reports failure and keeps working', () => {
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const collection = createCollection(full);
  assert.deepEqual(collection.load(), []);
  const result = collection.add(housing, THUMB);
  assert.equal(result.ok, true);
  assert.equal(result.added, true);
  assert.equal(result.stored, false);
  assert.deepEqual(collection.list().map((entry) => entry.variant), [housing]);
  assert.equal(collection.remove(result.key).stored, false);
  assert.deepEqual(collection.list(), []);
  assert.equal(parseCollection(collection.toJson()).ok, true);

  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
  };
  const second = createCollection(blocked);
  assert.deepEqual(second.load(), []);
  assert.equal(second.add(tank, THUMB).stored, false);
  assert.equal(second.merge(serializeCollection([makeEntry(housing, THUMB)])).stored, false);
  assert.equal(second.list().length, 2);
});

test('damaged stored text loads as an empty collection', () => {
  const storage = memoryStore();
  storage.items.set(COLLECTION_KEY, '{"kind":"arco-collection","modules":[{"family"');
  assert.deepEqual(createCollection(storage).load(), []);
  storage.items.set(COLLECTION_KEY, '[1,2,3]');
  assert.deepEqual(createCollection(storage).load(), []);
});

test('a thumbnail of a box has covered and empty pixels', () => {
  const positions = new Float32Array([0, 0, 0, 25, 0, 0, 25, 25, 0, 0, 25, 0, 0, 0, 50, 25, 0, 50, 25, 25, 50, 0, 25, 50]);
  const index = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  const colors = new Float32Array(24).fill(0.5);
  const size = 32;
  const pixels = rasterThumb(positions, index, colors, size);
  assert.equal(pixels.length, size * size * 4);
  let covered = 0;
  for (let pixel = 0; pixel < size * size; pixel++) if (pixels[pixel * 4 + 3] === 255) covered++;
  assert.ok(covered > size * size * 0.15 && covered < size * size * 0.8);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(size * (size / 2) + size / 2) * 4 + 3], 255);
});

test('saved modules carry a rarity, common by default, and a save time; both survive the file', () => {
  const store = createCollection(memoryStore());
  const result = store.add({ ...housing, id: 3, x: 0, y: 0, z: 0, rot: 0 }, THUMB, 1700000000000);
  assert.equal(result.added, true);
  const [entry] = store.list();
  assert.equal(entry.rarity, 'common');
  assert.equal(entry.saved, 1700000000000);
  const parsed = parseCollection(store.toJson());
  assert.deepEqual(parsed.entries, store.list());
  // Unknown rarity reads as common; a known one is kept
  const text = JSON.stringify({ kind: 'arco-collection', version: 1, modules: [{ ...housing, rarity: 'mythic' }, { ...tank, rarity: 'rare' }] });
  assert.deepEqual(parseCollection(text).entries.map((item) => item.rarity), ['common', 'rare']);
  assert.equal(makeEntry(housing, THUMB).saved, 0);
});

// Placed copy of a saved record, alone on the plinth or by a small core
function placeAlone(variant) {
  for (const base of [[], [{ family: 'core', fp: '2x2', h: 2, seed: 1, mask: 15, roof: false, x: 0, y: 0, z: 0, rot: 0, id: 1 }]]) {
    const build = createBuild(base);
    for (const [cellX, cellY] of [[3, 3], [0, 0], [2, 0], [-1, 0], [0, 2], [0, -1], [1, 0], [0, 1]]) {
      for (let rot = 0; rot < 4; rot++) {
        const ghost = build.ghost(variant, (cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM, rot);
        if (!ghost.ok) continue;
        const result = build.place(ghost.instance);
        return build.modules.find((instance) => instance.id === result.id);
      }
    }
  }
  return null;
}

// Placed copy back in the spot it was saved from
function placeBack(variant, source, structure) {
  const build = createBuild(structure.modules.filter((instance) => instance.id !== source.id));
  build.setStream(streamFrom(structure.stream));
  const result = build.place({ ...variant, x: source.x, y: source.y, z: source.z, rot: source.rot });
  return result.ok ? build.modules.find((instance) => instance.id === result.id) : null;
}

const SAVE_SEEDS = ['habitat', 'arco', 'barbican', 'beton', 'tower0', 'quarry', 'x9', 'balfron']; // structures that hold most families
const THUMB_PX = 48; // test thumbnail size

function thumbOf(solids, variant) {
  const { render } = solids.buildVariant(variant, { connectors: true });
  return Buffer.from(rasterThumb(render.positions, render.index, render.colors, THUMB_PX)).toString('base64');
}

test('every family saved and placed again equals the saved module, thumbnail included', async () => {
  const solids = await getSolids();
  const sources = new Map();
  for (const seed of SAVE_SEEDS) {
    for (const scale of ['block', 'mega']) {
      const structure = generate({ seed, scale, services: 'high' });
      for (const instance of structure.modules) if (!sources.has(instance.family)) sources.set(instance.family, { instance, structure });
    }
  }
  for (const variant of sampleVariants()) if (!sources.has(variant.family)) sources.set(variant.family, { instance: variant, structure: null });
  assert.deepEqual([...sources.keys()].sort(), [...FAMILY_IDS].sort());
  const unplaced = [];
  for (const [family, { instance, structure }] of sources) {
    const store = memoryStore();
    const shown = thumbOf(solids, instance);
    const saved = createCollection(store).add(instance, THUMB, 1);
    assert.ok(saved.ok && saved.stored, family);
    const reloaded = createCollection(store);
    const [entry] = reloaded.load();
    assert.equal(entry.key, saved.key, family);
    assert.equal(thumbOf(solids, entry.variant), shown, `${family} saved thumbnail matches what was seen`);
    if (FAMILIES[family].disabled) {
      unplaced.push(family);
      continue;
    }
    const placed = placeAlone(entry.variant) || (structure && placeBack(entry.variant, instance, structure));
    assert.ok(placed, `${family} could not be placed`);
    assert.deepEqual(variantOf(placed), entry.variant, family);
    assert.equal(variantKey(placed), entry.key, family);
    assert.equal(thumbOf(solids, placed), shown, `${family} placed thumbnail`);
  }
  assert.deepEqual(unplaced, FAMILY_IDS.filter((id) => FAMILIES[id].disabled));
});

test('a placed platform keeps its saved sides until something is built beside it', () => {
  const build = createBuild();
  const terrace = { family: 'terrace', fp: '1x1', h: 1, seed: 1, mask: 3, roof: true };
  const placed = build.place({ ...terrace, x: 0, y: 0, z: 0, rot: 0 });
  const maskOf = () => build.modules.find((instance) => instance.id === placed.id).mask;
  assert.equal(maskOf(), 3);
  assert.equal(build.place({ family: 'core', fp: '1x1', h: 1, seed: 1, mask: 15, roof: false, x: 3, y: 3, z: 0, rot: 0 }).ok, true);
  assert.equal(maskOf(), 3, 'a far placement leaves it alone');
  assert.equal(build.place({ family: 'core', fp: '1x1', h: 1, seed: 2, mask: 15, roof: false, x: 1, y: 0, z: 0, rot: 0 }).ok, true);
  assert.equal(maskOf(), 15 & ~1, 'a neighbour opens the side it touches');
});
