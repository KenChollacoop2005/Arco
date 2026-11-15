import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_MM,
  STORY_MM,
  CONNECTOR_CLEARANCE_MM,
  RAIL_NECK_MM,
  RAIL_DEPTH_MM,
  RAIL_OFFSET_MM,
  PEG_SIZE_MM,
  PEG_LENGTH_MM,
  COUPON_HEIGHT_MM,
  COUPON_SOCKET_BACK_MM,
} from '../js/config.js';
import { instancePose, variantKey } from '../js/core/grid.js';
import { FAMILIES } from '../js/core/catalog.js';
import { meshStats, meshGap, moveMesh } from '../js/core/meshtools.js';
import { checkPrintability } from '../js/core/printability.js';
import { maleProfile, femaleProfile, railEdges, pegOps, couponOps, couponMate } from '../js/core/connectors.js';
import { getSolids, sampleVariants } from './helpers.js';

const TOL_MM = 0.01;
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= TOL_MM, `${label}: ${actual} should be ${expected}`);

const block = (extra) => ({ family: 'core', fp: '1x1', h: 1, seed: 4, mask: 0, roof: false, rot: 0, x: 0, y: 0, z: 0, ...extra });

async function placed(instance, clearance) {
  const solids = await getSolids();
  const built = solids.buildVariant(instance, { clearance, connectors: true, render: false, edges: false });
  const pose = instancePose(instance);
  return moveMesh(built.solid, pose.turns, pose.x, pose.y, pose.z);
}

test('dovetail profile matches the hand calculation', () => {
  // 4 mm neck, 2.5 mm deep, 30 degree flanks: tip is 4 + 2 * 2.5 * tan 30 = 6.887 mm
  const male = maleProfile(0);
  near(male[2][0] * 2, RAIL_NECK_MM, 'neck');
  near(male[3][0] * 2, 6.887, 'tip');
  near(male[3][1], RAIL_DEPTH_MM, 'depth');
  // Clearance 0.2: each flank moves 0.1 / cos 30 = 0.1155 mm, faces move 0.1 mm
  const tight = maleProfile(0.2);
  const loose = femaleProfile(0.2);
  near(tight[3][1], 2.4, 'male tip');
  near(-loose[2][1], 2.6, 'slot floor');
  near(tight[3][0], 3.4434 - 0.0577 - 0.1155, 'male tip half width');
  near(loose[2][0], 3.4434 + 0.0577 + 0.1155, 'slot floor half width');
  // Both halves fit inside one 25 mm edge
  assert.ok(RAIL_OFFSET_MM + loose[2][0] < CELL_MM / 2, 'slot stays inside the edge');
});

test('rails sit only on connector sides', async () => {
  assert.equal(railEdges({ family: 'housing', fp: '1x2', mask: 15 }).length, 0);
  assert.equal(railEdges({ family: 'housing', fp: '1x2', mask: 0 }).length, 6);
  assert.equal(railEdges({ family: 'housing', fp: '1x2', mask: 14 }).length, 1);
  assert.equal(railEdges({ family: 'tank', fp: '1x1', mask: 0 }).length, 0);
  const solids = await getSolids();
  const closed = meshStats(solids.buildVariant(block({ mask: 15 }), { connectors: true, render: false, edges: false }).solid);
  near(closed.max[0], CELL_MM - CONNECTOR_CLEARANCE_MM / 2, 'facade side');
  const open = meshStats(solids.buildVariant(block(), { connectors: true, render: false, edges: false }).solid);
  near(open.max[0], CELL_MM + RAIL_DEPTH_MM - CONNECTOR_CLEARANCE_MM / 2, 'rail tip');
  near(open.min[1], -RAIL_DEPTH_MM + CONNECTOR_CLEARANCE_MM / 2, 'rail tip on -y');
});

test('side by side modules mate with the set clearance in every rotation', async () => {
  for (const clearance of [CONNECTOR_CLEARANCE_MM, 0.35]) {
    const first = await placed(block(), clearance);
    for (let rot = 0; rot < 4; rot++) {
      const second = await placed(block({ x: 1, rot, seed: 9 }), clearance);
      near(meshGap(first, second), clearance, `clearance ${clearance} rotation ${rot}`);
    }
    const wide = await placed({ ...block({ y: 1, rot: 1 }), fp: '1x2', h: 2 }, clearance);
    near(meshGap(first, wide), clearance, `clearance ${clearance} 1x2 neighbour`);
  }
});

test('a peg fits both sockets of a stacked pair with the set clearance', async () => {
  const solids = await getSolids();
  for (const clearance of [CONNECTOR_CLEARANCE_MM, 0.35]) {
    const lower = await placed(block(), clearance);
    const upper = await placed(block({ z: 1, rot: 1, seed: 9 }), clearance);
    const peg = solids.buildOps(pegOps(clearance));
    const pegStats = meshStats(peg);
    assert.ok(pegStats.watertight, 'peg watertight');
    near(pegStats.max[0] - pegStats.min[0], PEG_SIZE_MM - clearance, 'peg width');
    near(pegStats.max[2] - pegStats.min[2], PEG_LENGTH_MM - clearance, 'peg length');
    const seatedPeg = moveMesh(peg, 0, CELL_MM / 2, CELL_MM / 2, STORY_MM - (PEG_LENGTH_MM - clearance) / 2);
    near(meshGap(seatedPeg, lower), clearance, `peg in lower socket at ${clearance}`);
    near(meshGap(seatedPeg, upper), clearance, `peg in upper socket at ${clearance}`);
  }
});

test('the fit coupon mates with itself and takes a peg', async () => {
  const solids = await getSolids();
  for (const clearance of [CONNECTOR_CLEARANCE_MM, 0.1]) {
    const coupon = solids.buildOps(couponOps(clearance));
    const stats = meshStats(coupon);
    assert.ok(stats.watertight && stats.volume > 0, 'coupon watertight');
    assert.equal(checkPrintability(coupon, { pieces: 1 }).status, 'pass', 'coupon prints');
    near(meshGap(coupon, couponMate(coupon)), clearance, `coupon dovetail at ${clearance}`);
    const peg = moveMesh(solids.buildOps(pegOps(clearance)), 0, CELL_MM / 2, COUPON_SOCKET_BACK_MM, COUPON_HEIGHT_MM - (PEG_LENGTH_MM - clearance) / 2);
    near(meshGap(peg, coupon), clearance, `coupon peg at ${clearance}`);
  }
});

test('every catalog variant with connectors is one printable watertight solid', async () => {
  const solids = await getSolids();
  let topSockets = 0;
  let bottomSockets = 0;
  for (const variant of sampleVariants()) {
    const built = solids.buildVariant(variant, { connectors: true, render: false, edges: false });
    const stats = meshStats(built.solid);
    const key = variantKey(variant);
    assert.ok(stats.watertight && stats.volume > 0, `${key} watertight`);
    assert.equal(built.parts, 1, `${key} pieces`);
    const print = checkPrintability(built.solid, { pieces: built.parts });
    assert.equal(print.status, 'pass', `${key} printability ${JSON.stringify(print.rules)}`);
    const family = FAMILIES[variant.family];
    if (family.rails && !variant.roof) assert.ok(built.sockets.top.length > 0, `${key} top sockets`);
    if (!family.stack || variant.roof) assert.equal(built.sockets.top.length, 0, `${key} no sockets on a cap top`);
    if (family.ground) assert.equal(built.sockets.bottom.length, 0, `${key} no sockets on a base bottom`);
    topSockets += built.sockets.top.length;
    bottomSockets += built.sockets.bottom.length;
  }
  assert.ok(topSockets > 0 && bottomSockets > 0);
});
