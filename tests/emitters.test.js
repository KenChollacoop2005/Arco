import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { particleEmitters } from '../js/core/emitters.js';

const part = (id, family, h, x, y, z) => ({ ...normalizeVariant({ family, fp: '1x1', h, seed: 4, mask: 15, roof: false }), id, x, y, z, rot: 1 });

test('smoke rises from stack tops and steam from cooling blocks and vents, in world mm', () => {
  const { smoke, steam } = particleEmitters([part(1, 'smokestack', 3, 2, -1, 1), part(2, 'cooling', 1, -3, 0, 0), part(3, 'vent', 1, 0, 3, 0), part(4, 'housing', 2, 0, 0, 0)]);
  // The stack top sits over its own cell, at its full height
  assert.equal(smoke.length, 1);
  assert.ok(smoke[0][0] > 2 * CELL_MM && smoke[0][0] < 3 * CELL_MM && smoke[0][1] > -CELL_MM && smoke[0][1] < 0);
  assert.equal(smoke[0][2], (1 + 3) * STORY_MM);
  // Cooling makes steam, not smoke; vents steam from every pipe, inside their cell and story
  assert.ok(steam.length >= 2);
  for (const point of steam) assert.ok(point[2] > 0 && point[2] <= STORY_MM);
  assert.ok(steam.some((point) => point[0] > -3 * CELL_MM && point[0] < -2 * CELL_MM));
  assert.ok(steam.some((point) => point[1] > 3 * CELL_MM && point[1] < 4 * CELL_MM));
  assert.deepEqual(particleEmitters([part(4, 'housing', 2, 0, 0, 0)]), { smoke: [], steam: [] });
});
