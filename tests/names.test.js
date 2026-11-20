import test from 'node:test';
import assert from 'node:assert/strict';
import { residentName, surnameOf, COMMON_FIRST, COMMON_LAST, WORLD_POOLS, NAME_EGGS, NAME_COMMON_SHARE, NAME_EGG_CHANCE } from '../js/core/names.js';
import { rollResident } from '../js/core/residents.js';

const ROLLS = 10000; // names rolled for the mix check
const GROUP = 4; // residents in one puzzle at most
const seedOf = (index) => (index * 2654435761 + 977) >>> 0;

test('pools hold at least 200 first and 200 last names', () => {
  const first = new Set([...COMMON_FIRST, ...WORLD_POOLS.flatMap((pool) => pool.given)]);
  const last = new Set([...COMMON_LAST, ...WORLD_POOLS.flatMap((pool) => pool.family)]);
  assert.ok(first.size >= 200, `${first.size} first names`);
  assert.ok(last.size >= 200, `${last.size} last names`);
  assert.ok(WORLD_POOLS.length >= 12, 'a wide mix of cultures');
});

test('over 10,000 rolls: about two thirds common names, rare easter eggs', () => {
  let common = 0;
  let eggs = 0;
  for (let index = 0; index < ROLLS; index++) {
    const name = residentName(seedOf(index));
    if (NAME_EGGS.includes(name)) eggs++;
    else if (COMMON_FIRST.includes(name.split(' ')[0])) common++;
  }
  const commonShare = common / ROLLS;
  assert.ok(commonShare >= 0.65 && commonShare <= 0.7, `common ${commonShare}`);
  assert.ok(Math.abs(commonShare - NAME_COMMON_SHARE * (1 - NAME_EGG_CHANCE)) < 0.015, `common ${commonShare}`);
  assert.ok(Math.abs(eggs / ROLLS - NAME_EGG_CHANCE) < 0.005, `eggs ${eggs / ROLLS}`);
});

test('easter eggs have no surname; others have one from the pools', () => {
  for (const egg of NAME_EGGS) assert.equal(surnameOf(egg), null);
  for (let index = 0; index < 500; index++) {
    const name = residentName(seedOf(index));
    if (NAME_EGGS.includes(name)) continue;
    assert.equal(name.split(' ').length, 2, name);
    assert.ok(surnameOf(name), name);
  }
});

test('within one puzzle no surname repeats and there is at most one easter egg', () => {
  for (let group = 0; group < ROLLS / GROUP; group++) {
    const names = [];
    for (let slot = 0; slot < GROUP; slot++) names.push(residentName(seedOf(group * GROUP + slot) ^ 0x5bd1e995, names));
    const surnames = names.map(surnameOf).filter(Boolean);
    assert.equal(new Set(surnames).size, surnames.length, names.join(', '));
    assert.ok(names.filter((name) => NAME_EGGS.includes(name)).length <= 1, names.join(', '));
  }
  // Rolled residents pass their names on the same way
  for (let group = 0; group < 300; group++) {
    const residents = [];
    for (const id of ['r1', 'r2', 'r3', 'r4']) residents.push(rollResident(seedOf(group), id, { names: residents.map((resident) => resident.name) }));
    const surnames = residents.map((resident) => surnameOf(resident.name)).filter(Boolean);
    assert.equal(new Set(surnames).size, surnames.length);
  }
});
