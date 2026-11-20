import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { POINTS, PUZZLE_RESIDENTS, PAR_START_SHARE, PIECE_ID_BASE } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { variantKey } from '../js/core/grid.js';
import { scoreLayout, residentPoints, unusedPoints, percentOf } from '../js/core/scoring.js';
import { validateLayout, scorePuzzleLayout, generatePuzzle } from '../js/core/puzzle.js';
import { parsePuzzle, loadDaily, makeDaily, dailyId, easternDate, datesFrom } from '../js/core/daily.js';

const PUZZLES = new URL('../puzzles/', import.meta.url);
const files = readdirSync(PUZZLES).filter((name) => name.endsWith('.json')).sort();
const readPuzzle = (name) => parsePuzzle(readFileSync(new URL(name, PUZZLES), 'utf8'));
const FAST_DAY = '2026-12-18'; // a daily that needed no reroll
const copy = (value) => JSON.parse(JSON.stringify(value));

// Evaluated resident by hand
const evaluated = ({ needs = [true, true], wants = [], hates = [], dream = null, home = 1 }) => {
  const result = {
    id: 'r1',
    home,
    needs: needs.map((met, index) => ({ id: index === 0 ? 'water' : 'power', met, reason: met ? 'full' : 'none' })),
    wants: wants.map((met, index) => ({ id: 'want' + index, met, reason: met ? 'ok' : 'no' })),
    hates: hates.map((met, index) => ({ id: 'hate' + index, met, triggered: met, reason: met ? 'yes' : 'no' })),
    dream: dream === null ? null : { id: 'tall', met: dream, reason: dream ? 'ok' : 'no' },
  };
  result.happy = !!home && result.wants.every((want) => want.met) && result.hates.every((hate) => !hate.met) && (!result.dream || result.dream.met);
  return result;
};

test('scoring by hand: needs, wants, hates, dreams and the perfectly happy bonus', () => {
  // 2 needs met 20, 2 wants met 16, 1 missed -4, a hate -8, dream met 6: 30, not happy
  assert.equal(residentPoints(evaluated({ wants: [true, true, false], hates: [true], dream: true })), 30);
  // 2 needs 20, a want 8, no hate, dream met 6, happy 20: 54
  const happy = evaluated({ wants: [true], hates: [false], dream: true });
  assert.equal(happy.happy, true);
  assert.equal(residentPoints(happy), 54);
  // A missed dream scores 0 and spoils happy; needs missed are -15 each
  assert.equal(residentPoints(evaluated({ wants: [true], dream: false })), 28);
  assert.equal(residentPoints(evaluated({ needs: [false, false], wants: [false] })), -34);
  assert.deepEqual([POINTS.needMet, POINTS.needMissed, POINTS.wantMet, POINTS.wantMissed, POINTS.hateTriggered, POINTS.dreamMet, POINTS.dreamMissed, POINTS.happy], [10, -15, 8, -4, -8, 6, 0, 20]);
});

test('unused pieces add 2 each up to 10, the total never drops below 0, and percent may pass 100', () => {
  assert.deepEqual([0, 1, 3, 5, 6, 12].map(unusedPoints), [0, 2, 6, 10, 10, 10]);
  const score = scoreLayout([evaluated({ wants: [true], dream: true })], { unused: 7, par: 50 });
  assert.equal(score.points, 64);
  assert.equal(score.percent, 128);
  assert.deepEqual(score.contributions.map((item) => [item.kind, item.points]), [['need', 10], ['need', 10], ['want', 8], ['dream', 6], ['happy', 20], ['unused', 10]]);
  assert.ok(score.contributions.every((item) => typeof item.reason === 'string'));
  const low = scoreLayout([evaluated({ needs: [false, false], wants: [false, false] })], { unused: 1, par: 80 });
  assert.deepEqual([low.raw, low.points, low.percent], [-36, 0, 0]);
  assert.deepEqual([percentOf(100, 80), percentOf(1, 3), percentOf(5, 0)], [125, 33, 0]);
});

test('every daily file loads, its par layout is valid and scores its stated par', () => {
  assert.ok(files.length >= 30, `${files.length} daily files`);
  for (const name of files) {
    const puzzle = readPuzzle(name);
    assert.ok(puzzle, `${name} parses`);
    assert.equal(puzzle.id, dailyId(name.replace('.json', '')), name);
    assert.ok(puzzle.residents.length >= PUZZLE_RESIDENTS[0] && puzzle.residents.length <= PUZZLE_RESIDENTS[1], name);
    const scored = scorePuzzleLayout(puzzle, puzzle.par.layout);
    assert.deepEqual(scored.problems, [], name);
    assert.equal(scored.score.points, puzzle.par.points, `${name} par points`);
    assert.equal(scored.score.percent, 100, name);
    assert.ok(puzzle.start.points <= puzzle.par.points * PAR_START_SHARE, `${name} start ${puzzle.start.points} par ${puzzle.par.points}`);
  }
});

test('validity: tray keys and counts, placement, homes with room, known residents', () => {
  const puzzle = readPuzzle(FAST_DAY + '.json');
  const par = puzzle.par.layout;
  assert.deepEqual(validateLayout(puzzle, par), { ok: true, problems: [] });
  assert.deepEqual(validateLayout(puzzle, { ...par, pieces: [...par.pieces, { key: 'housing:9x9:1:1:15:0', cell: [0, 0, 0], rot: 0 }] }).problems, ['unknown-piece']);
  const entry = puzzle.tray.find((item) => par.pieces.some((piece) => piece.key === item.key));
  const extra = Array.from({ length: entry.count }, (unused, index) => ({ key: entry.key, cell: [-5 + index, 5, 0], rot: 0 }));
  assert.ok(validateLayout(puzzle, { ...par, pieces: [...par.pieces, ...extra] }).problems.includes('over-count'));
  // A piece dropped onto a site module's cell
  const site = puzzle.site[0];
  const spare = puzzle.tray.find((item) => item.count > par.pieces.filter((piece) => piece.key === item.key).length);
  assert.ok(spare, 'a spare tray piece');
  assert.deepEqual(validateLayout(puzzle, { ...par, pieces: [...par.pieces, { key: spare.key, cell: [site.x, site.y, site.z], rot: 0 }] }).problems, ['placement']);
  // Homes: a non-home, a home over capacity, an unknown resident
  const nonHome = puzzle.site.find((instance) => !['housing', 'studio', 'penthouse', 'shacks', 'flared'].includes(instance.family));
  assert.deepEqual(validateLayout(puzzle, { ...par, residents: { ...par.residents, r1: nonHome.id } }).problems, ['not-a-home']);
  const everyone = Object.fromEntries(puzzle.residents.map((resident) => [resident.id, par.residents.r1]));
  const crowded = validateLayout(puzzle, { ...par, residents: everyone });
  assert.ok(crowded.problems.includes('home-full') || puzzle.residents.length <= 2, crowded.problems.join());
  assert.deepEqual(validateLayout(puzzle, { ...par, residents: { ...par.residents, r9: null } }).problems, ['unknown-resident']);
  // Unplaced residents are allowed
  assert.ok(validateLayout(puzzle, { pieces: [], residents: {} }).ok);
});

test('validity: a layout that does not pass the static check is refused', () => {
  const base = { ...normalizeVariant({ family: 'housing', fp: '1x1', h: 1, seed: 3, mask: 15, roof: false }), id: 1, x: 0, y: 0, z: 0, rot: 0 };
  const slab = normalizeVariant({ family: 'housing', fp: '1x2', h: 3, seed: 3, mask: 15, roof: false });
  const rider = normalizeVariant({ family: 'housing', fp: '1x1', h: 3, seed: 4, mask: 15, roof: false });
  const puzzle = { site: [base], stream: null, residents: [], tray: [{ key: variantKey(slab), variant: slab, count: 1 }, { key: variantKey(rider), variant: rider, count: 1 }], par: { points: 0 } };
  // Half the slab hangs past the house, and a tall rider stands on the hanging end
  const layout = { pieces: [{ key: variantKey(slab), cell: [0, 0, 1], rot: 0 }, { key: variantKey(rider), cell: [1, 0, 4], rot: 0 }], residents: {} };
  assert.deepEqual(validateLayout(puzzle, layout).problems, ['unstable']);
  assert.ok(validateLayout(puzzle, { pieces: [{ key: variantKey(rider), cell: [0, 0, 1], rot: 0 }], residents: {} }).ok);
  assert.equal(PIECE_ID_BASE, 1000);
});

test('the same seed gives the same puzzle and par, equal to its daily file', () => {
  const first = copy(makeDaily(FAST_DAY));
  const second = copy(makeDaily(FAST_DAY));
  assert.deepEqual(first, second);
  assert.deepEqual(first, readPuzzle(FAST_DAY + '.json'));
  assert.notDeepEqual(copy(generatePuzzle('another-seed')).residents, first.residents);
});

test('the loader reads today\'s file by the New York date, and generates live and unranked when it is missing', async () => {
  // 03:00 UTC on Dec 19 is still Dec 18 in New York
  const now = new Date('2026-12-19T03:00:00Z');
  assert.equal(easternDate(now), FAST_DAY);
  assert.deepEqual(datesFrom('2026-12-31', 2), ['2026-12-31', '2027-01-01']);
  const fromFile = await loadDaily(async (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8'), now);
  assert.deepEqual([fromFile.date, fromFile.ranked, fromFile.puzzle.id], [FAST_DAY, true, dailyId(FAST_DAY)]);
  const live = await loadDaily(async () => {
    throw new Error('missing');
  }, now);
  assert.equal(live.ranked, false);
  assert.deepEqual(copy(live.puzzle), fromFile.puzzle);
  assert.equal(parsePuzzle('{"format": 99}'), null);
  assert.equal(parsePuzzle('not json'), null);
});
