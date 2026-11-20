import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PIECE_ID_BASE, POINTS } from '../js/config.js';
import { parsePuzzle } from '../js/core/daily.js';
import { createBuild } from '../js/core/build.js';
import { streamFrom } from '../js/core/stream.js';
import { assignmentsOf } from '../js/core/roster.js';
import { anchorIds, unusedTrayPieces } from '../js/core/puzzle.js';
import { variantKey } from '../js/core/grid.js';
import { dailyNumber, puzzleStart, trayLeft, layoutOf, scoreChange, shareText, playScore, SHARE_MARKS } from '../js/core/puzzleplay.js';

const FAST_DAY = '2026-12-18'; // a daily that needed no reroll
const puzzle = parsePuzzle(readFileSync(new URL(`../puzzles/${FAST_DAY}.json`, import.meta.url), 'utf8'));
const variants = new Map(puzzle.tray.map((entry) => [entry.key, entry.variant]));

// The par layout placed piece by piece, the way Build does it in puzzle mode
function buildPar() {
  const start = puzzleStart(puzzle);
  const build = createBuild(start.modules, { stream: streamFrom(puzzle.stream) });
  build.setRules({ locked: start.modules.map((instance) => instance.id), keepMasks: true, idBase: PIECE_ID_BASE });
  build.setCap(Infinity);
  const ids = [];
  for (const piece of puzzle.par.layout.pieces) {
    const placed = build.place({ ...variants.get(piece.key), x: piece.cell[0], y: piece.cell[1], z: piece.cell[2], rot: piece.rot });
    assert.equal(placed.ok, true, placed.reason);
    ids.push(placed.id);
  }
  return { build, ids, start };
}

test('daily numbers count from the first daily', () => {
  assert.equal(dailyNumber('2026-11-19'), 1);
  assert.equal(dailyNumber('2026-11-20'), 2);
  assert.equal(dailyNumber('2026-12-18'), 30);
});

test('the start holds the site and residents in their start homes', () => {
  const start = puzzleStart(puzzle);
  assert.deepEqual(start.modules, puzzle.site);
  assert.deepEqual(start.records.map((record) => record.home), puzzle.residents.map((resident) => resident.start));
  assert.deepEqual(trayLeft(puzzle, start.modules).map((entry) => entry.count), puzzle.tray.map((entry) => entry.count));
});

test('the par layout built in puzzle mode converts back to the same layout and scores par', () => {
  const { build, ids } = buildPar();
  assert.deepEqual(ids, puzzle.par.layout.pieces.map((piece, index) => PIECE_ID_BASE + index));
  // Site masks and ids stay exactly as given
  for (const site of puzzle.site) assert.deepEqual(build.modules.find((instance) => instance.id === site.id), site);
  const homes = { ...puzzle.par.layout.residents };
  const { layout } = layoutOf(build.modules, homes);
  assert.deepEqual(layout, puzzle.par.layout);
  const report = playScore(puzzle, layout);
  assert.equal(report.valid, true);
  assert.equal(report.score.points, puzzle.par.points);
  const left = trayLeft(puzzle, build.modules);
  assert.equal(left.reduce((sum, entry) => sum + entry.count, 0), puzzle.tray.reduce((sum, entry) => sum + entry.count, 0) - layout.pieces.length);
});

test('after a piece is removed, ids close up in the layout and homes follow', () => {
  const { build, ids } = buildPar();
  // A later piece is placed, then an earlier one taken away
  const extra = puzzle.tray.find((entry) => trayLeft(puzzle, build.modules).find((left) => left.key === entry.key).count > 0);
  const placed = build.place({ ...extra.variant, x: 0, y: 0, z: 0, rot: 0 });
  const later = placed.ok ? placed.id : ids[ids.length - 1];
  const gone = ids[0];
  const modules = build.modules.filter((instance) => instance.id !== gone);
  const assignments = { r1: later, r2: gone, r3: puzzle.site[0].id };
  const { layout, toLayout, fromLayout } = layoutOf(modules, assignments);
  const count = modules.filter((instance) => instance.id >= PIECE_ID_BASE).length;
  assert.equal(layout.pieces.length, count);
  assert.equal(toLayout.get(later), PIECE_ID_BASE + count - 1);
  assert.equal(fromLayout.get(PIECE_ID_BASE + count - 1), later);
  assert.equal(toLayout.has(gone), false);
  assert.equal(layout.residents.r1, PIECE_ID_BASE + count - 1);
  assert.equal(layout.residents.r2, null);
  assert.equal(layout.residents.r3, puzzle.site[0].id);
});

test('locked site modules cannot be removed or turned, and Clear keeps them', () => {
  const { build, start } = buildPar();
  const siteId = start.modules[start.modules.length - 1].id;
  assert.equal(build.remove([siteId]).ok, false);
  assert.equal(build.rotate(siteId).ok, false);
  assert.equal(build.isLocked(siteId), true);
  assert.equal(build.clear(), true);
  assert.deepEqual(build.modules, puzzle.site);
  assert.equal(build.clear(), false);
  // Undo brings the pieces back; snapshot and restore keep the history
  const parked = build.snapshot();
  build.restore({ modules: [], undoStack: [], redoStack: [], cap: Infinity, stream: null, rules: { locked: new Set(), keepMasks: false, idBase: 0 } });
  assert.equal(build.modules.length, 0);
  build.restore(parked);
  assert.equal(build.undo(), true);
  assert.equal(build.modules.length, puzzle.site.length + puzzle.par.layout.pieces.length);
});

test('with anchors locked, a movable site piece returns to the tray and the layout notes it', () => {
  const start = puzzleStart(puzzle);
  const anchors = anchorIds(puzzle.site);
  const build = createBuild(start.modules, { stream: streamFrom(puzzle.stream) });
  build.setRules({ locked: [...anchors], keepMasks: true, idBase: PIECE_ID_BASE });
  build.setCap(Infinity);
  const anchor = puzzle.site.find((instance) => anchors.has(instance.id));
  assert.equal(build.remove([anchor.id]).ok, false);
  const carrying = new Set(puzzle.site.flatMap((instance) => puzzle.site.filter((other) => other.z === instance.z + instance.h && other.x === instance.x && other.y === instance.y).map(() => instance.id)));
  const free = puzzle.site.find((instance) => !anchors.has(instance.id) && !carrying.has(instance.id) && build.remove([instance.id]).ok);
  assert.ok(free, 'a movable site piece with nothing on it');
  const { layout } = layoutOf(build.modules, {}, puzzle.site);
  assert.deepEqual(layout.site, { [free.id]: null });
  const left = trayLeft(puzzle, build.modules);
  assert.equal(left.reduce((sum, entry) => sum + entry.count, 0), puzzle.tray.reduce((sum, entry) => sum + entry.count, 0) + 1);
  assert.ok(left.some((entry) => entry.key === variantKey(free) && entry.count >= 1));
  // Placed back where it was, it counts as a piece from the tray pool
  const placed = build.place({ ...free, rot: free.rot });
  assert.equal(placed.ok, true, placed.reason);
  const back = layoutOf(build.modules, {}, puzzle.site).layout;
  assert.deepEqual([back.site, back.pieces.length], [{ [free.id]: null }, 1]);
  assert.equal(playScore(puzzle, back).valid, true);
  assert.equal(unusedTrayPieces(puzzle, back), puzzle.tray.reduce((sum, entry) => sum + entry.count, 0));
});

test('a layout that does not stand still scores live but is not valid', () => {
  const start = puzzleStart(puzzle);
  const layout = { pieces: [], residents: assignmentsOf(start.records) };
  const empty = playScore(puzzle, layout);
  assert.equal(empty.valid, true);
  assert.equal(empty.score.points, puzzle.start.points);
  // A tray piece floating one story up over empty ground cannot pass
  const entry = puzzle.tray[0];
  const floating = { pieces: [{ key: entry.key, cell: [0, 0, 6], rot: 0 }], residents: layout.residents };
  const report = playScore(puzzle, floating);
  assert.equal(report.valid, false);
  assert.ok(report.problems.length > 0);
});

test('previews give raw points per home for one resident', () => {
  const layout = { ...puzzle.par.layout, residents: { ...puzzle.par.layout.residents } };
  const mover = puzzle.residents[0].id;
  const home = layout.residents[mover];
  layout.residents[mover] = null;
  const report = playScore(puzzle, layout, { preview: { resident: mover, homes: [home] } });
  const back = playScore(puzzle, puzzle.par.layout);
  assert.equal(report.previews[home], back.score.raw);
});

test('score changes name the biggest cause', () => {
  const before = { points: 20, contributions: [{ resident: 'r1', kind: 'need', id: 'water', points: POINTS.needMet }, { resident: 'r1', kind: 'want', id: 'high', points: POINTS.wantMissed }] };
  const after = { points: 32, contributions: [{ resident: 'r1', kind: 'need', id: 'water', points: POINTS.needMet }, { resident: 'r1', kind: 'want', id: 'high', points: POINTS.wantMet }] };
  const change = scoreChange(before, after);
  assert.equal(change.total, 12);
  assert.deepEqual([change.cause.kind, change.cause.id, change.cause.delta], ['want', 'high', POINTS.wantMet - POINTS.wantMissed]);
  const gone = scoreChange(after, { points: 0, contributions: [] });
  assert.equal(gone.cause.delta, -POINTS.needMet);
});

test('the share grid has one row per resident and the score against par', () => {
  const report = playScore(puzzle, puzzle.par.layout);
  const text = shareText({ title: 'Arco 30', residents: puzzle.residents, evaluations: report.evaluations, score: report.score, par: puzzle.par.points });
  const lines = text.split('\n');
  assert.equal(lines.length, puzzle.residents.length + 2);
  assert.equal(lines[lines.length - 1], `${puzzle.par.points} / ${puzzle.par.points} (100%)`);
  const first = report.evaluations[0];
  const marks = [...lines[1].matchAll(new RegExp(`${SHARE_MARKS.met}|${SHARE_MARKS.missed}`, 'gu'))];
  assert.equal(marks.length, first.wants.length);
});
