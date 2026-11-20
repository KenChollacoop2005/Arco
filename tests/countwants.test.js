import test from 'node:test';
import assert from 'node:assert/strict';
import { missingPieces, homeNeeds, generatePuzzle, WANT_HOMES, WANT_OTHERS, WANT_SHARED } from '../js/core/puzzle.js';
import { residentCapacity } from '../js/core/catalog.js';
import { isHome } from '../js/core/residents.js';

const PUZZLE_SEEDS = ['count-1', 'count-2', 'count-3', 'sweep-1']; // generated puzzles checked
const rng = { int: () => 7 };
const resident = (...wants) => ({ wants: wants.map((id) => ({ id })), hates: [], dream: null });
const studio = { family: 'studio', fp: '1x1' };
const housing = { family: 'housing', fp: '1x1' };

test('count wants add homes only when the puzzle has too few', () => {
  const families = (list) => list.map((variant) => variant.family);
  assert.deepEqual(families(missingPieces(rng, [resident('community')], [])), ['housing', 'housing', 'housing']);
  assert.deepEqual(families(missingPieces(rng, [resident('neighbour')], [studio])), ['housing']);
  assert.deepEqual(families(missingPieces(rng, [resident('nextto')], [studio, studio])), []);
  // A roommate needs a home for two; studios hold one
  assert.deepEqual(families(missingPieces(rng, [resident('roommate')], [studio, studio, studio])), ['housing']);
  assert.deepEqual(families(missingPieces(rng, [resident('roommate'), resident('community')], [housing, studio, studio])), []);
  assert.deepEqual(homeNeeds([resident('high'), resident('community'), resident('roommate')]), { homes: 3, shared: true });
});

test('in generated puzzles the site plus tray can meet each count want on its own', () => {
  let checked = 0;
  for (const seed of PUZZLE_SEEDS) {
    const puzzle = generatePuzzle(seed);
    const pieces = [...puzzle.site, ...puzzle.tray.flatMap((entry) => Array.from({ length: entry.count }, () => entry.variant))];
    const homes = pieces.filter(isHome);
    for (const person of puzzle.residents) {
      for (const want of person.wants) {
        if (!(want.id in WANT_HOMES)) continue;
        checked++;
        assert.ok(homes.length >= WANT_HOMES[want.id], `${seed} ${person.name} ${want.id}: ${homes.length} homes`);
        assert.ok(puzzle.residents.length - 1 >= WANT_OTHERS[want.id], `${seed} ${want.id}: others`);
        if (WANT_SHARED.includes(want.id)) assert.ok(homes.some((home) => residentCapacity(home) >= 2), `${seed} ${want.id}: a home for two`);
      }
    }
  }
  assert.ok(checked > 0, 'some count wants were rolled');
});
