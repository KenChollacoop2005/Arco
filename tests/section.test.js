import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../js/config.js';
import { SECTION_PAD_MM, SECTION_STEPS, planeDistance, sectionExtent, sectionPlane, sectionShare } from '../js/core/section.js';
import { generate } from '../js/core/generator.js';
import { instanceCells } from '../js/core/grid.js';

const HALF = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2;
const tower = [
  { id: 1, family: 'core', fp: '1x1', h: 4, x: 0, y: 0, z: 0, rot: 0 },
  { id: 2, family: 'housing', fp: '2x2', h: 2, x: -1, y: -1, z: 4, rot: 0 },
];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('the extent is the model height and the plinth half width', () => {
  assert.deepEqual(sectionExtent(tower), { height: 6 * STORY_MM, half: HALF });
  assert.deepEqual(sectionExtent([]), { height: STORY_MM, half: HALF });
});

test('a horizontal cut keeps what is below it', () => {
  const extent = sectionExtent(tower);
  const plane = sectionPlane('h', 0.5, extent);
  const level = 0.5 * (150 + SECTION_PAD_MM);
  assert.deepEqual(plane.normal, [0, 0, -1]);
  near(plane.constant, level);
  near(planeDistance(plane, [40, -30, level]), 0);
  near(planeDistance(plane, [0, 0, 0]), level);
  near(planeDistance(plane, [0, 0, 150]), level - 150);
  near(planeDistance(plane, plane.point), 0);
});

test('a vertical cut removes the side toward the default view', () => {
  const extent = sectionExtent(tower);
  const plane = sectionPlane('v', 0.5, extent);
  assert.deepEqual(plane.normal, [0, 1, 0]);
  near(plane.constant, 0);
  assert.ok(planeDistance(plane, [0, 60, 10]) > 0);
  assert.ok(planeDistance(plane, [0, -60, 10]) < 0);
  const quarter = sectionPlane('v', 0.25, extent);
  near(planeDistance(quarter, [0, 0, 0]), -(HALF + SECTION_PAD_MM) / 2);
  near(planeDistance(quarter, quarter.point), 0);
  near(quarter.point[2], 75);
});

test('the ends of the travel show everything or nothing', () => {
  for (const { modules } of [generate({ seed: 'habitat', scale: 'mega' }), generate({ seed: 'arco', scale: 'block' }), { modules: tower }]) {
    const extent = sectionExtent(modules);
    const corners = [];
    for (const instance of modules) {
      for (const [cellX, cellY] of instanceCells(instance)) {
        for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
          corners.push([(cellX + (corner & 1)) * CELL_MM, (cellY + ((corner >> 1) & 1)) * CELL_MM, (instance.z + (corner >> 2) * instance.h) * STORY_MM]);
        }
      }
    }
    for (const axis of ['h', 'v']) {
      const open = sectionPlane(axis, 1, extent);
      const shut = sectionPlane(axis, 0, extent);
      assert.ok(corners.every((corner) => planeDistance(open, corner) > 0), axis + ' open');
      assert.ok(corners.every((corner) => planeDistance(shut, corner) <= 0), axis + ' shut');
    }
  }
});

test('the plane moves evenly with the slider and clamps past its ends', () => {
  const extent = sectionExtent(tower);
  assert.equal(sectionShare(0), 0);
  assert.equal(sectionShare(SECTION_STEPS), 1);
  assert.equal(sectionShare(SECTION_STEPS / 4), 0.25);
  assert.equal(sectionShare(-5), 0);
  assert.equal(sectionShare(SECTION_STEPS + 5), 1);
  for (const axis of ['h', 'v']) {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((share) => sectionPlane(axis, share, extent).constant);
    for (let index = 1; index < steps.length; index++) near(steps[index] - steps[index - 1], steps[1] - steps[0]);
    assert.deepEqual(sectionPlane(axis, 1.4, extent), sectionPlane(axis, 1, extent));
    assert.deepEqual(sectionPlane(axis, -0.4, extent), sectionPlane(axis, 0, extent));
  }
});

test('the cut does not depend on the module family', () => {
  const swapped = tower.map((instance) => ({ ...instance, family: 'tank' }));
  assert.deepEqual(sectionExtent(swapped), sectionExtent(tower));
});
