import test from 'node:test';
import assert from 'node:assert/strict';
import { figureParams, makeFigure, figureTop, PRESENTATIONS, PROPS, HAIRS, POSTURES, BUILDS } from '../js/core/figure.js';
import { FIGURE_HEIGHT_M, FIGURE_STORY_M, STORY_MM } from '../js/config.js';

const SEEDS = Array.from({ length: 300 }, (unused, index) => (index * 2654435761) >>> 0);
const look = (params) => JSON.stringify(params);

test('same seed gives the same figure', () => {
  for (const seed of SEEDS.slice(0, 40)) assert.deepEqual(makeFigure(seed), makeFigure(seed));
});

test('different seeds give different parameter sets', () => {
  const seen = new Set(SEEDS.map((seed) => look(figureParams(seed))));
  assert.equal(seen.size, SEEDS.length);
  // Neighbours differ in at least two visible traits
  for (let index = 1; index < SEEDS.length; index++) {
    const first = figureParams(SEEDS[index - 1]);
    const second = figureParams(SEEDS[index]);
    const differ = ['presentation', 'build', 'posture', 'hair', 'prop', 'accent', 'skirt'].filter((field) => first[field] !== second[field]).length + (Math.abs(first.height - second.height) >= 0.05 ? 1 : 0);
    assert.ok(differ >= 2, `${SEEDS[index - 1]} and ${SEEDS[index]}`);
  }
  // Every option shows up
  const all = SEEDS.map(figureParams);
  for (const [field, options] of [['presentation', PRESENTATIONS], ['prop', PROPS], ['hair', HAIRS], ['posture', POSTURES], ['build', Object.keys(BUILDS)]]) {
    assert.deepEqual(new Set(all.map((params) => params[field])), new Set(options), field);
  }
});

test('figures stay at architectural scale', () => {
  const perMetre = STORY_MM / FIGURE_STORY_M;
  for (const seed of SEEDS) {
    const figure = makeFigure(seed);
    assert.ok(figure.params.height >= FIGURE_HEIGHT_M[0] && figure.params.height <= FIGURE_HEIGHT_M[1]);
    assert.ok(figure.heightMm <= FIGURE_HEIGHT_M[1] * perMetre && figure.heightMm < STORY_MM * 0.7);
    // Head top within 6 cm of the rolled height; only umbrellas reach higher
    const head = figure.joints.head[2] + figure.parts.find((part) => part.kind === 'sphere').r;
    assert.ok(Math.abs(head / perMetre - figure.params.height) < 0.06, `${seed}: head at ${head / perMetre}`);
    if (figure.params.prop !== 'umbrella') assert.ok(figureTop(figure) <= figure.heightMm + 0.35 * perMetre);
    for (const part of figure.parts) for (const value of Object.values(part).flat().filter((entry) => typeof entry === 'number')) assert.ok(Number.isFinite(value));
  }
});

test('the figure mesh builds from the parts', async () => {
  const { figureGeometry } = await import('../js/render/figure.js');
  for (const seed of SEEDS.slice(0, 30)) {
    const figure = makeFigure(seed);
    const geometry = figureGeometry(figure);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(geometry.getAttribute('position').count > 100);
    assert.equal(geometry.getAttribute('color').count, geometry.getAttribute('position').count);
    assert.ok(box.min.z > -0.5, `${seed}: below the feet ${box.min.z}`);
    assert.ok(Math.abs(box.max.z - figureTop(figure)) < 0.6, `${seed}: top ${box.max.z} against ${figureTop(figure)}`);
  }
});
