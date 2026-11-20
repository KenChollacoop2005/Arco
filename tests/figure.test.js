import test from 'node:test';
import assert from 'node:assert/strict';
import { figureParams, makeFigure, figureTop, partTop, PROFILES, FEATURES, ACCESSORIES, PATTERNS, BONES } from '../js/core/figure.js';
import { figureBatches, figurePortrait, patternAt, cardFrame } from '../js/core/figuremesh.js';
import { FIGURE_HEIGHT_M, FIGURE_STORY_M, STORY_MM, FIGURE_PATTERN_SHARE, FIGURE_FEATURE_NONE_SHARE, FIGURE_FEATURE_WEIGHTS, FIGURE_ACCESSORY_NONE_SHARE } from '../js/config.js';

const SEEDS = Array.from({ length: 300 }, (unused, index) => (index * 2654435761) >>> 0);
const ROLLS = 10000; // seeds for the frequency checks
const SHARE_SLACK = 0.015; // allowed gap from a constant over 10,000 seeds
const look = (params) => JSON.stringify(params);

test('same seed gives the same figure', () => {
  for (const seed of SEEDS.slice(0, 40)) assert.deepEqual(makeFigure(seed), makeFigure(seed));
});

test('different seeds give different figures', () => {
  const seen = new Set(SEEDS.map((seed) => look(figureParams(seed))));
  assert.equal(seen.size, SEEDS.length);
  // Neighbours differ in at least two visible traits
  for (let index = 1; index < SEEDS.length; index++) {
    const first = figureParams(SEEDS[index - 1]);
    const second = figureParams(SEEDS[index]);
    const differ = ['profile', 'feature', 'accessory', 'accent', 'bottom', 'build', 'headSize'].filter((field) => first[field] !== second[field]).length + (Math.abs(first.height - second.height) >= 0.05 ? 1 : 0);
    assert.ok(differ >= 2, `${SEEDS[index - 1]} and ${SEEDS[index]}`);
  }
});

test('feature, accessory and pattern frequencies over 10,000 seeds sit near their constants', () => {
  const counts = { feature: {}, accessory: {}, profile: {}, pattern: 0, patternKind: {} };
  for (let index = 0; index < ROLLS; index++) {
    const params = figureParams((index * 2654435761 + 12345) >>> 0);
    counts.feature[params.feature] = (counts.feature[params.feature] || 0) + 1;
    counts.accessory[params.accessory] = (counts.accessory[params.accessory] || 0) + 1;
    counts.profile[params.profile] = (counts.profile[params.profile] || 0) + 1;
    if (params.pattern) {
      counts.pattern++;
      counts.patternKind[params.pattern.kind] = (counts.patternKind[params.pattern.kind] || 0) + 1;
    }
  }
  const near = (count, share, label) => assert.ok(Math.abs(count / ROLLS - share) <= SHARE_SLACK, `${label}: ${count / ROLLS} against ${share}`);
  near(counts.feature.none, FIGURE_FEATURE_NONE_SHARE, 'no feature');
  const weightTotal = FEATURES.reduce((sum, feature) => sum + FIGURE_FEATURE_WEIGHTS[feature], 0);
  for (const feature of FEATURES) near(counts.feature[feature], ((1 - FIGURE_FEATURE_NONE_SHARE) * FIGURE_FEATURE_WEIGHTS[feature]) / weightTotal, feature);
  assert.ok(FIGURE_FEATURE_WEIGHTS.glasses < FIGURE_FEATURE_WEIGHTS.cap && FIGURE_FEATURE_WEIGHTS.sunglasses < FIGURE_FEATURE_WEIGHTS.cap);
  near(counts.accessory.none, FIGURE_ACCESSORY_NONE_SHARE, 'no accessory');
  for (const accessory of ACCESSORIES) near(counts.accessory[accessory], (1 - FIGURE_ACCESSORY_NONE_SHARE) / ACCESSORIES.length, accessory);
  near(counts.pattern, FIGURE_PATTERN_SHARE, 'patterned');
  for (const kind of PATTERNS) assert.ok(counts.patternKind[kind] > 0, kind);
  for (const profile of Object.keys(PROFILES)) near(counts.profile[profile], 1 / 3, profile);
});

test('a peg person: round head, two-tone frustum body in two segments, floating hands, at architectural scale', () => {
  const perMetre = STORY_MM / FIGURE_STORY_M;
  for (const seed of SEEDS) {
    const figure = makeFigure(seed);
    assert.ok(figure.params.height >= FIGURE_HEIGHT_M[0] && figure.params.height <= FIGURE_HEIGHT_M[1]);
    assert.ok(figure.heightMm < STORY_MM * 0.7);
    const named = Object.fromEntries(figure.parts.filter((part) => part.name).map((part) => [part.name, part]));
    assert.deepEqual(Object.keys(named).sort(), ['handL', 'handR', 'head', 'hips', 'shoulders', 'torso']);
    // Head: always a sphere, never squashed, glossy, top at the rolled height
    assert.equal(named.head.kind, 'sphere');
    assert.equal(named.head.squash, undefined);
    assert.ok(named.head.gloss);
    assert.ok(Math.abs(partTop(named.head) / perMetre - figure.params.height) < 1e-6, `${seed}: head top`);
    // Torso over hips meet at the waist with one radius, so they read as one frustum
    assert.deepEqual(named.torso.a, named.hips.b);
    assert.ok(Math.abs(named.torso.r1 - named.hips.r2) < 1e-9);
    assert.equal(named.torso.color, 'top');
    assert.equal(named.hips.color, 'bottom');
    const [top, base] = PROFILES[figure.params.profile];
    assert.equal(Math.sign(named.torso.r2 - named.hips.r1), Math.sign(top - base) || 0, `${seed}: ${figure.params.profile}`);
    // Hands float clear of the body, no arms
    for (const hand of ['handL', 'handR']) assert.ok(Math.hypot(figure.joints[hand][0], figure.joints[hand][1]) > named.hips.r2, `${seed}: ${hand} floats`);
    assert.ok(!figure.parts.some((part) => /arm|leg/.test(part.name || '')));
    // Every part belongs to a bone and is finite
    for (const part of figure.parts) {
      assert.ok(BONES.includes(part.bone), `${seed}: bone ${part.bone}`);
      for (const value of Object.values(part).flat().filter((entry) => typeof entry === 'number')) assert.ok(Number.isFinite(value));
    }
    if (!['umbrella', 'balloon'].includes(figure.params.accessory)) assert.ok(figureTop(figure) <= figure.heightMm + 0.35 * perMetre, `${seed}: top`);
    // The feature and accessory show up as parts when rolled
    assert.equal(figure.parts.some((part) => part.role === 'feature'), figure.params.feature !== 'none', `${seed}: feature`);
    assert.equal(figure.parts.some((part) => part.role === 'accessory'), figure.params.accessory !== 'none', `${seed}: accessory`);
    assert.equal(figure.parts.some((part) => part.pattern), !!figure.params.pattern, `${seed}: pattern`);
  }
});

test('the mesh builds per bone with outward faces', async () => {
  const { figureBones } = await import('../js/render/figure.js');
  for (const seed of SEEDS.slice(0, 40)) {
    const figure = makeFigure(seed);
    const { bones } = figureBatches(figure);
    for (const bone of BONES) assert.ok(bones[bone], `${seed}: ${bone}`);
    for (const batches of Object.values(bones)) {
      for (const batch of Object.values(batches)) {
        assert.equal(batch.colors.length, batch.positions.length);
        assert.equal(batch.uvs.length, (batch.positions.length / 3) * 2);
        assert.ok(batch.index.every((corner) => corner < batch.positions.length / 3));
      }
    }
    // Head triangles face away from the head centre
    const head = bones.head.gloss;
    const centre = figure.joints.head;
    let outward = 0;
    let total = 0;
    for (let face = 0; face < head.index.length; face += 3) {
      const [a, b, c] = [0, 1, 2].map((corner) => head.positions.slice(head.index[face + corner] * 3, head.index[face + corner] * 3 + 3));
      const u = a.map((value, axis) => b[axis] - value);
      const v = a.map((value, axis) => c[axis] - value);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const radius = figure.parts.find((part) => part.name === 'head').r;
      const onHead = [a, b, c].every((point) => Math.abs(Math.hypot(...point.map((value, axis) => value - centre[axis])) - radius) < 1e-3);
      if (Math.hypot(...normal) < 1e-9 || !onHead) continue;
      total++;
      if (normal.reduce((sum, value, axis) => sum + value * (a[axis] - centre[axis]), 0) > 0) outward++;
    }
    assert.ok(outward / total > 0.95, `${seed}: ${outward} of ${total} outward`);
    if (!figure.params.pattern) assert.equal(Object.keys(figureBones(figure)).length, BONES.length);
  }
});

test('portraits render from the 3D figure: full figure and a head-and-shoulders card', () => {
  const coverage = (pixels, width, rows) => rows.map((row) => {
    let solid = 0;
    for (let x = 0; x < width; x++) if (pixels[(row * width + x) * 4 + 3] > 0) solid++;
    return solid;
  });
  for (const seed of SEEDS.slice(0, 6)) {
    const figure = makeFigure(seed);
    const full = figurePortrait(figure, { width: 60, height: 80, frame: 'full' });
    const card = figurePortrait(figure, { width: 64, height: 64, frame: 'card' });
    assert.equal(full.length, 60 * 80 * 4);
    assert.equal(card.length, 64 * 64 * 4);
    // Full: a margin all round; card: the body runs off the bottom edge
    const [fullTop, fullBottom] = coverage(full, 60, [0, 79]);
    assert.equal(fullTop + fullBottom, 0, `${seed}: full margin`);
    assert.ok(coverage(card, 64, [63])[0] > 0, `${seed}: card cropped at the shoulders`);
    assert.ok(cardFrame(figure).bottom > 0);
    // Smooth shading: the head shows more than a few flat tones
    const tones = new Set();
    for (let index = 0; index < card.length; index += 4) if (card[index + 3] === 255) tones.add(card[index]);
    assert.ok(tones.size > 30, `${seed}: ${tones.size} tones`);
  }
});

test('patterns are stripes or dots on the shared rule', () => {
  const stripes = { kind: 'stripes', color: 1 };
  const bands = Array.from({ length: 12 }, (unused, index) => patternAt(stripes, 0, 0.5, (index + 0.5) / 12));
  assert.ok(bands.includes(1) && bands.includes(0));
  const dots = { kind: 'dots', color: 1 };
  let hits = 0;
  for (let index = 0; index < 400; index++) if (patternAt(dots, 0, (index % 20) / 20, Math.floor(index / 20) / 20) === 1) hits++;
  assert.ok(hits > 20 && hits < 200, `dots cover ${hits} of 400`);
  assert.equal(patternAt(null, 7, 0.5, 0.5), 7);
});

test('no head feature reaches inside the head on 1,000 seeds', () => {
  const tolerance = 0.005; // share of the head radius
  for (let index = 0; index < 1000; index++) {
    const figure = makeFigure((index * 2654435761 + 777) >>> 0);
    const head = figure.parts.find((part) => part.name === 'head');
    for (const part of figure.parts.filter((item) => item.role === 'feature')) {
      for (const batches of Object.values(figureBatches({ ...figure, parts: [part] }).bones)) {
        for (const batch of Object.values(batches)) {
          for (let at = 0; at < batch.positions.length; at += 3) {
            const reach = Math.hypot(batch.positions[at] - head.c[0], batch.positions[at + 1] - head.c[1], batch.positions[at + 2] - head.c[2]);
            assert.ok(reach >= head.r * (1 - tolerance), `${figure.params.feature} ${part.kind} at ${(reach / head.r).toFixed(3)} of the head radius`);
          }
        }
      }
    }
  }
});
