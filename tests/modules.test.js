import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, CONNECTOR_CLEARANCE_MM, SIDE_CLEAR_MM } from '../js/config.js';
import { FAMILIES, FAMILY_IDS } from '../js/core/catalog.js';
import { footprintSize, variantKey } from '../js/core/grid.js';
import { GROUPS } from '../js/core/palette.js';
import { RECIPE_IDS, buildRecipe } from '../js/core/recipes.js';
import { meshStats } from '../js/core/meshtools.js';
import { getSolids, sampleVariants } from './helpers.js';

const TOL_MM = 0.01;
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= TOL_MM, `${label}: ${actual} should be ${expected}`);

test('every family has a recipe', () => {
  assert.deepEqual([...RECIPE_IDS].sort(), [...FAMILY_IDS].sort());
});

test('recipes only use known material groups', () => {
  for (const variant of sampleVariants()) {
    for (const op of buildRecipe(variant, CONNECTOR_CLEARANCE_MM).ops) {
      assert.ok(GROUPS[op.group], `${variantKey(variant)} uses ${op.group}`);
    }
  }
});

test('module solids are watertight, one piece, positive volume', async () => {
  const solids = await getSolids();
  for (const variant of sampleVariants()) {
    const built = solids.buildVariant(variant, { edges: false });
    const stats = meshStats(built.solid);
    const key = variantKey(variant);
    assert.ok(stats.watertight, `${key} watertight`);
    assert.ok(stats.volume > 0, `${key} volume`);
    assert.equal(built.parts, 1, `${key} pieces`);
  }
});

test('railed bodies equal the grid minus clearance within 0.01 mm', async () => {
  const solids = await getSolids();
  for (const variant of sampleVariants()) {
    if (!FAMILIES[variant.family].rails) continue;
    const stats = meshStats(solids.buildVariant(variant, { render: false, edges: false }).solid);
    const [cellsX, cellsY] = footprintSize(variant.fp);
    const key = variantKey(variant);
    const inset = CONNECTOR_CLEARANCE_MM / 2;
    near(stats.min[0], inset, key + ' min x');
    near(stats.min[1], inset, key + ' min y');
    near(stats.max[0], cellsX * CELL_MM - inset, key + ' max x');
    near(stats.max[1], cellsY * CELL_MM - inset, key + ' max y');
    near(stats.max[0] - stats.min[0] + CONNECTOR_CLEARANCE_MM, cellsX * CELL_MM, key + ' pitch x');
    near(stats.max[1] - stats.min[1] + CONNECTOR_CLEARANCE_MM, cellsY * CELL_MM, key + ' pitch y');
    near(stats.min[2], 0, key + ' base');
    near(stats.max[2], variant.h * STORY_MM, key + ' height');
  }
});

test('parts without rails stay 3 mm inside their cells', async () => {
  const solids = await getSolids();
  for (const variant of sampleVariants()) {
    if (FAMILIES[variant.family].rails) continue;
    const stats = meshStats(solids.buildVariant(variant, { render: false, edges: false }).solid);
    const [cellsX, cellsY] = footprintSize(variant.fp);
    const key = variantKey(variant);
    near(stats.min[2], 0, key + ' base');
    assert.ok(stats.min[0] >= SIDE_CLEAR_MM - TOL_MM && stats.min[1] >= SIDE_CLEAR_MM - TOL_MM, key + ' low side');
    assert.ok(stats.max[0] <= cellsX * CELL_MM - SIDE_CLEAR_MM + TOL_MM, key + ' high x');
    assert.ok(stats.max[1] <= cellsY * CELL_MM - SIDE_CLEAR_MM + TOL_MM, key + ' high y');
    assert.ok(stats.max[2] <= variant.h * STORY_MM + TOL_MM, key + ' height');
  }
});

test('a custom clearance moves the body faces by half of it', async () => {
  const solids = await getSolids();
  const variant = { family: 'housing', fp: '2x3', h: 2, seed: 5, mask: 15, roof: false };
  const stats = meshStats(solids.buildVariant(variant, { clearance: 0.4, render: false, edges: false }).solid);
  near(stats.min[0], 0.2, 'min x');
  near(stats.max[0], 3 * CELL_MM - 0.2, 'max x');
});

test('the same variant builds the same mesh, a new seed changes it', async () => {
  const solids = await getSolids();
  const variant = { family: 'housing', fp: '2x2', h: 3, seed: 77, mask: 15, roof: false };
  const first = solids.buildVariant(variant);
  const second = solids.buildVariant(variant);
  assert.deepEqual(first.render.positions, second.render.positions);
  assert.deepEqual(first.render.index, second.render.index);
  const other = solids.buildVariant({ ...variant, seed: 78 });
  assert.notDeepEqual(first.render.positions, other.render.positions);
});

test('render meshes carry colors and kinds for every vertex', async () => {
  const solids = await getSolids();
  const built = solids.buildVariant({ family: 'turbine', fp: '1x1', h: 3, seed: 3, mask: 15, roof: true });
  const count = built.render.positions.length / 3;
  assert.ok(count > 0);
  assert.equal(built.render.colors.length, count * 3);
  assert.equal(built.render.meta.length, count * 3);
  assert.ok(Math.max(...built.render.index) < count);
  assert.ok(built.anchors.spin);
});
