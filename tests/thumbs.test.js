import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterThumb } from '../js/core/thumb.js';
import { variantKey } from '../js/core/grid.js';
import { FAMILY_IDS } from '../js/core/catalog.js';
import { generatePuzzle, layoutModules, anchorIds } from '../js/core/puzzle.js';
import { trayLeft } from '../js/core/puzzleplay.js';
import { createCollection } from '../js/core/collection.js';
import { getSolids, sampleVariants } from './helpers.js';

const THUMB_PX = 48; // test thumbnail size
const MIN_COVER = 0.03; // a thumbnail fills at least this share of its square
const PUZZLE_SEEDS = ['sweep-1', 'sweep-2', 'thumb-3']; // generated puzzles whose site pieces are returned

// Share of the square a variant's thumbnail covers
function coverage(solids, variant) {
  const { render } = solids.buildVariant(variant, { connectors: true });
  const pixels = rasterThumb(render.positions, render.index, render.colors, THUMB_PX);
  let covered = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) covered++;
  return covered / (THUMB_PX * THUMB_PX);
}

test('every family renders a thumbnail', async () => {
  const solids = await getSolids();
  const seen = new Set();
  for (const variant of sampleVariants()) {
    seen.add(variant.family);
    assert.ok(coverage(solids, variant) >= MIN_COVER, `${variantKey(variant)} is blank`);
  }
  assert.deepEqual([...seen].sort(), [...FAMILY_IDS].sort());
});

test('every site piece returned to the tray gets a card that renders a thumbnail by its own key', async () => {
  const solids = await getSolids();
  for (const seed of PUZZLE_SEEDS) {
    const puzzle = generatePuzzle(seed);
    const anchors = new Set(anchorIds(puzzle.site));
    const returnable = puzzle.site.filter((instance) => !anchors.has(instance.id));
    assert.ok(returnable.length > 0, `${seed} has movable site pieces`);
    for (const piece of returnable) {
      const modules = layoutModules(puzzle, { pieces: [], residents: {}, site: { [piece.id]: null } });
      const entry = trayLeft(puzzle, modules).find((candidate) => candidate.key === variantKey(piece));
      assert.ok(entry, `${seed} ${piece.family} back in the tray`);
      assert.equal(entry.key, variantKey(entry.variant), `${seed} ${piece.family} card key matches its variant`);
      assert.ok(coverage(solids, entry.variant) >= MIN_COVER, `${seed} ${piece.family} thumbnail`);
    }
    for (const entry of puzzle.tray) assert.equal(entry.key, variantKey(entry.variant), `${seed} tray ${entry.variant.family}`);
  }
});

test('a saved module without a picture gets one filled in and kept', () => {
  const items = new Map();
  const storage = { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, value) };
  const collection = createCollection(storage);
  const added = collection.add({ family: 'bridge', fp: '2x3', h: 1, seed: 4, mask: 0, roof: false }, '', 1);
  assert.equal(collection.list()[0].thumb, '');
  collection.setThumb(added.key, 'data:image/png;base64,AAAA');
  const again = createCollection(storage);
  again.load();
  assert.equal(again.list()[0].thumb, 'data:image/png;base64,AAAA');
});
