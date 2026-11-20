import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { POINTS, PUZZLE_RESIDENTS, PAR_START_SHARE, PIECE_ID_BASE, PUZZLE_ANSWER, PUZZLE_MAX_PIECES, BRIDGE_FAMILIES, PAR_MAX_BUILDS } from '../js/config.js';
import { normalizeVariant, FAMILIES } from '../js/core/catalog.js';
import { variantKey } from '../js/core/grid.js';
import { generate } from '../js/core/generator.js';
import { traitsOf } from '../js/core/residents.js';
import { scoreLayout, residentPoints, unusedPoints, percentOf } from '../js/core/scoring.js';
import { validateLayout, scorePuzzleLayout, generatePuzzle, missingPieces, anchorIds, unusedTrayPieces, findPar } from '../js/core/puzzle.js';
import { parsePuzzle, loadDaily, makeDaily, dailyId, easternDate, datesFrom, dailyFor, TEST_PREFIX } from '../js/core/daily.js';
import { DAILY_TEST_MODE } from '../js/config.js';

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

// A small site: a stack with a core on top, and a lone stack beside it
const unit = (id, family, x, y, z, h = 1) => ({ ...normalizeVariant({ family, fp: '1x1', h, seed: 5, mask: 15, roof: false }), id, x, y, z, rot: 0 });
const SMALL_SITE = [unit(1, 'housing', 0, 0, 0), unit(2, 'housing', 0, 0, 1), unit(3, 'core', 0, 0, 2), unit(4, 'housing', 3, 0, 0), unit(5, 'housing', 3, 0, 1), unit(6, 'housing', -3, 0, 0, 2)];
const SPARE = normalizeVariant({ family: 'housing', fp: '1x1', h: 1, seed: 9, mask: 15, roof: false });
const SMALL_PUZZLE = { seed: 'small', site: SMALL_SITE, stream: null, residents: [], tray: [{ key: variantKey(SPARE), variant: SPARE, count: 2 }], par: { points: 0 } };

test('anchors: cores, ground-floor modules and what holds an anchor up', () => {
  assert.deepEqual([...anchorIds(SMALL_SITE)].sort(), [1, 2, 3, 4, 6]);
});

test('movable site: pieces move, turn or return to the tray; anchors stay; returned pieces join the tray', () => {
  const base = { pieces: [], residents: {} };
  assert.ok(validateLayout(SMALL_PUZZLE, { ...base, site: { 5: { cell: [3, 3, 0], rot: 1 } } }).ok);
  assert.deepEqual(validateLayout(SMALL_PUZZLE, { ...base, site: { 6: { cell: [2, 2, 0], rot: 0 } } }).problems, ['anchor-moved']);
  assert.deepEqual(validateLayout(SMALL_PUZZLE, { ...base, site: { 3: null } }).problems, ['anchor-moved']);
  assert.deepEqual(validateLayout(SMALL_PUZZLE, { ...base, site: { 99: null } }).problems, ['unknown-piece']);
  // Returned, then placed again from the tray as a piece of its own key
  const key5 = variantKey(SMALL_SITE[4]);
  const again = { pieces: [{ key: key5, cell: [0, 3, 0], rot: 0 }], residents: {}, site: { 5: null } };
  assert.ok(validateLayout(SMALL_PUZZLE, again).ok);
  assert.ok(validateLayout(SMALL_PUZZLE, { ...again, pieces: [...again.pieces, { key: key5, cell: [0, -3, 0], rot: 0 }] }).problems.includes('over-count'));
  assert.deepEqual(validateLayout(SMALL_PUZZLE, { pieces: [{ key: key5, cell: [0, 3, 0], rot: 0 }], residents: {} }).problems, ['unknown-piece']);
  // A moved piece that lands on another breaks placement
  assert.deepEqual(validateLayout(SMALL_PUZZLE, { ...base, site: { 5: { cell: [-3, 0, 0], rot: 0 } } }).problems, ['placement']);
  // Unused bonus: only pieces that started in the tray
  assert.equal(unusedTrayPieces(SMALL_PUZZLE, base), 2);
  assert.equal(unusedTrayPieces(SMALL_PUZZLE, { ...base, site: { 5: null } }), 2);
  assert.equal(unusedTrayPieces(SMALL_PUZZLE, again), 2);
  assert.equal(unusedTrayPieces(SMALL_PUZZLE, { pieces: [{ key: variantKey(SPARE), cell: [0, 3, 0], rot: 0 }], residents: {} }), 1);
  assert.equal(scorePuzzleLayout(SMALL_PUZZLE, { ...base, site: { 5: null } }).score.points, unusedPoints(2));
});

test('the par climb scores at most PAR_MAX_BUILDS new structures', () => {
  const puzzle = readPuzzle(FAST_DAY + '.json');
  const start = { pieces: [], residents: {} };
  const cache = new Map();
  scorePuzzleLayout(puzzle, start, { cache, par: 0 });
  const before = cache.size;
  const best = findPar(puzzle, start, cache);
  assert.ok(cache.size - before <= PAR_MAX_BUILDS, `${cache.size - before} new structures`);
  assert.ok(best.points >= scorePuzzleLayout(puzzle, start, { cache, par: 0 }).score.points);
  assert.equal(scorePuzzleLayout(puzzle, best.layout, { par: 0 }).valid, true);
});

test('the same seed gives the same puzzle and par, equal to its daily file', () => {
  const first = copy(makeDaily(FAST_DAY));
  const second = copy(makeDaily(FAST_DAY));
  assert.deepEqual(first, second);
  assert.deepEqual(first, readPuzzle(FAST_DAY + '.json'));
  assert.notDeepEqual(copy(generatePuzzle('another-seed')).residents, first.residents);
});

test('generated puzzles: 3 to 4 residents, the site is the answer less 4 to 6 pieces, 5 to 9 tray cards, every named thing present, par meets every need', () => {
  for (const seedText of ['size-a', 'size-b', 'size-c']) {
    const puzzle = generatePuzzle(seedText);
    const answer = generate({ seed: puzzle.seed, scale: 'block', ...PUZZLE_ANSWER, cap: PUZZLE_MAX_PIECES });
    assert.ok(puzzle.residents.length >= 3 && puzzle.residents.length <= 4, `${seedText} residents`);
    const removed = answer.modules.length - puzzle.site.length;
    assert.ok(removed >= 4 && removed <= 6, `${seedText} removed ${removed}`);
    assert.ok(puzzle.tray.length >= 5 && puzzle.tray.length <= 9, `${seedText} cards ${puzzle.tray.length}`);
    // Whatever a trait names is on the site or in the tray
    const families = new Set([...puzzle.site.map((instance) => instance.family), ...puzzle.tray.map((entry) => entry.variant.family)]);
    for (const resident of puzzle.residents) {
      for (const trait of traitsOf(resident)) {
        const tagText = `${trait.kind}:${trait.id}`;
        if (tagText === 'want:amenity') assert.ok([...families].some((id) => FAMILIES[id].amenity === trait.type), `${seedText} ${trait.type}`);
        if (tagText === 'want:lit' || tagText === 'hate:dark') assert.ok(families.has('lamppost') || families.has('floodlight'), `${seedText} light`);
        if (tagText === 'dream:market' || tagText === 'dream:garden') assert.ok(families.has(trait.id), `${seedText} ${trait.id}`);
        if (tagText === 'dream:bridge') assert.ok(BRIDGE_FAMILIES.some((id) => families.has(id)), `${seedText} bridge`);
      }
    }
    const par = scorePuzzleLayout(puzzle, puzzle.par.layout);
    assert.equal(par.score.points, puzzle.par.points);
    for (const result of par.evaluations) assert.ok(result.home !== null && result.needs.every((need) => need.met), `${seedText} ${result.id} needs`);
  }
});

test('missing pieces: a named amenity, a market, a light and a bridge join the tray only when absent', () => {
  const rng = { int: () => 7 };
  const resident = { wants: [{ id: 'amenity', type: 'clinic', steps: 8 }, { id: 'lit' }], hates: [], dream: { id: 'bridge' } };
  const added = missingPieces(rng, [resident], []).map((variant) => variant.family);
  assert.deepEqual(added.slice(0, 2), ['clinic', 'lamppost']);
  assert.ok(BRIDGE_FAMILIES.includes(added[2]));
  const site = [{ family: 'clinic' }, { family: 'floodlight' }, { family: 'walkway' }];
  assert.deepEqual(missingPieces(rng, [resident], site), []);
  assert.deepEqual(missingPieces(rng, [{ wants: [], hates: [{ id: 'dark' }], dream: { id: 'market' } }], []).map((variant) => variant.family), ['lamppost', 'market']);
});

test('test mode Daily: a fresh unranked puzzle from the given seed, never reading the daily files', async () => {
  assert.equal(DAILY_TEST_MODE, true);
  let reads = 0;
  const readText = async () => {
    reads += 1;
    throw new Error('not read in test mode');
  };
  const now = new Date('2026-12-19T03:00:00Z');
  const first = await dailyFor(readText, 'tm-1', now);
  assert.deepEqual([first.test, first.ranked, first.date, first.seed, first.puzzle.id, reads], [true, false, FAST_DAY, 'tm-1', TEST_PREFIX + 'tm-1', 0]);
  const other = await dailyFor(readText, 'tm-2', now);
  assert.notDeepEqual(other.puzzle.residents, first.puzzle.residents);
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
