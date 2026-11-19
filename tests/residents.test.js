import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, FAMILY_IDS, HOUSING_FAMILIES, RESIDENT_CAPACITY, residentCapacity } from '../js/core/catalog.js';

test('every housing family has a resident capacity for every footprint and stories', () => {
  assert.deepEqual([...HOUSING_FAMILIES].sort(), ['flared', 'housing', 'penthouse', 'shacks', 'studio']);
  for (const id of HOUSING_FAMILIES) {
    const family = FAMILIES[id];
    for (const fp of family.footprints) {
      for (let h = family.minStories; h <= family.maxStories; h++) {
        const capacity = residentCapacity({ family: id, fp, h });
        assert.ok(Number.isInteger(capacity) && capacity > 0, `${id} ${fp} ${h}: ${capacity}`);
      }
    }
  }
  // Values Ken set: housing 2, studio 1, penthouse 2, shacks 4 to 6 by size
  assert.equal(residentCapacity({ family: 'housing', fp: '2x2', h: 3 }), 2);
  assert.equal(residentCapacity({ family: 'studio', fp: '1x1', h: 1 }), 1);
  assert.equal(residentCapacity({ family: 'penthouse', fp: '1x2', h: 1 }), 2);
  assert.deepEqual(['1x1', '1x2', '2x2'].map((fp) => residentCapacity({ family: 'shacks', fp, h: 1 })), [4, 5, 6]);
  // Larger flared housing holds more
  const flared = FAMILIES.flared.footprints.map((fp) => RESIDENT_CAPACITY.flared[fp]);
  assert.deepEqual(flared, [...flared].sort((first, second) => first - second));
});

test('nothing but housing has residents', () => {
  for (const id of FAMILY_IDS) {
    if (HOUSING_FAMILIES.includes(id)) continue;
    for (const fp of FAMILIES[id].footprints) assert.equal(residentCapacity({ family: id, fp, h: FAMILIES[id].minStories }), 0, `${id} ${fp}`);
  }
});
