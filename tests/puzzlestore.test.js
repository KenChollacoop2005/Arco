import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzleStore, streakOf, parseResults, PUZZLE_STORE_KEY } from '../js/core/puzzlestore.js';

const memory = () => {
  const items = new Map();
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)) };
};
const score = (points, percent) => ({ points, percent });

test('streaks count days in a row ending today, or yesterday before today is played', () => {
  assert.equal(streakOf([], '2026-11-20'), 0);
  assert.equal(streakOf(['2026-11-18', '2026-11-19', '2026-11-20'], '2026-11-20'), 3);
  assert.equal(streakOf(['2026-11-18', '2026-11-19'], '2026-11-20'), 2);
  assert.equal(streakOf(['2026-11-17', '2026-11-19'], '2026-11-20'), 1);
  assert.equal(streakOf(['2026-11-17'], '2026-11-20'), 0);
  // Across a month end
  assert.equal(streakOf(['2026-11-30', '2026-12-01'], '2026-12-01'), 2);
});

test('daily results keep the first submission and the best, and survive a reload', () => {
  const storage = memory();
  const store = createPuzzleStore(storage);
  store.load();
  assert.deepEqual(store.recordDaily('2026-11-19', score(60, 70), true, 1), { first: true, stored: true });
  assert.deepEqual(store.recordDaily('2026-11-19', score(95, 108), true, 2), { first: false, stored: true });
  store.recordDaily('2026-11-19', score(80, 91), true, 3);
  store.recordDaily('2026-11-20', score(40, 45), false, 4);
  const again = createPuzzleStore(storage);
  again.load();
  const day = again.daily('2026-11-19');
  assert.deepEqual([day.first, day.best, day.submits, day.ranked], [{ points: 60, percent: 70 }, { points: 95, percent: 108 }, 3, true]);
  // Wins are days whose best reached par
  assert.deepEqual(again.dailyStats('2026-11-20'), { played: 2, streak: 2, wins: 1 });
  assert.deepEqual(again.dailyStats('2026-11-22'), { played: 2, streak: 0, wins: 1 });
});

test('Infinite keeps the best share of par and counts each puzzle once', () => {
  const store = createPuzzleStore(memory());
  store.load();
  assert.equal(store.recordInfinite('abc', score(50, 80)).best, true);
  assert.equal(store.recordInfinite('abc', score(40, 60)).best, false);
  assert.equal(store.recordInfinite('xyz', score(70, 80)).best, true);
  assert.deepEqual(store.infiniteStats(), { played: 2, best: { points: 70, percent: 80, seed: 'xyz' } });
});

test('bad or blocked storage leaves a working empty store', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const store = createPuzzleStore(broken);
  store.load();
  assert.deepEqual(store.recordDaily('2026-11-19', score(10, 10), true), { first: true, stored: false });
  assert.equal(store.dailyStats('2026-11-19').played, 1);
  const junk = memory();
  junk.setItem(PUZZLE_STORE_KEY, '{"v":99}');
  const fresh = createPuzzleStore(junk);
  fresh.load();
  assert.equal(fresh.dailyStats('2026-11-19').played, 0);
  assert.equal(parseResults('not json'), null);
});

test('a layout in progress survives a reload: saved, read back and restored to the same modules and homes', async () => {
  const { readFileSync } = await import('node:fs');
  const { parsePuzzle } = await import('../js/core/daily.js');
  const { layoutModules } = await import('../js/core/puzzle.js');
  const { layoutOf } = await import('../js/core/puzzleplay.js');
  const { PROGRESS_KEY, progressRecord, parseProgress, progressFor, restoreProgress } = await import('../js/core/puzzlestore.js');
  const puzzle = parsePuzzle(readFileSync(new URL('../puzzles/2026-12-18.json', import.meta.url), 'utf8'));
  const game = { kind: 'daily', puzzle, ranked: true, date: '2026-12-18', seed: null, test: false };
  const layout = puzzle.par.layout;
  const storage = new Map();
  storage.set(PROGRESS_KEY, JSON.stringify({ daily: progressRecord(game, layout), infinite: progressRecord({ kind: 'infinite', puzzle, ranked: false, seed: 'abc' }, { pieces: [], residents: {} }) }));
  const progress = parseProgress(storage.get(PROGRESS_KEY));
  // Ranked Dailies come back only on their own day; test and Infinite games always
  assert.equal(progressFor(progress, 'daily', '2026-12-19'), null);
  const record = progressFor(progress, 'daily', '2026-12-18');
  const restored = restoreProgress(record, layoutModules);
  assert.deepEqual(restored.game, game);
  assert.deepEqual(restored.modules, layoutModules(puzzle, layout));
  assert.deepEqual(restored.homes, Object.fromEntries(puzzle.residents.map((resident) => [resident.id, layout.residents[resident.id] ?? null])));
  // Saving the restored build again gives the same layout
  assert.deepEqual(layoutOf(restored.modules, restored.homes, puzzle.site).layout, layout);
  assert.equal(progressFor(progress, 'infinite', '2030-01-01').seed, 'abc');
  assert.ok(progressFor(parseProgress(JSON.stringify({ daily: { ...record, test: true, date: '2026-01-01' } })), 'daily', '2026-12-18'));
  // Junk, other versions and broken layouts are dropped
  assert.deepEqual(parseProgress('not json'), { daily: null, infinite: null });
  assert.deepEqual(parseProgress(JSON.stringify({ daily: { ...record, v: 9 } })), { daily: null, infinite: null });
  assert.deepEqual(parseProgress(JSON.stringify({ daily: { ...record, layout: { pieces: 'x', residents: {} } } })), { daily: null, infinite: null });
});
