import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVariant } from '../js/core/catalog.js';
import { analyze } from '../js/core/analysis.js';
import { walkingNetwork } from '../js/core/walking.js';
import { evaluateResidents, residentExtras, rollResident, conflicting, traitsOf } from '../js/core/residents.js';

// Hand-built structures through the real analysis and walking passes; solver and light reports by hand
const part = (id, family, fp, h, x, y, z, rot = 0) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false }), id, x, y, z, rot });
const NO_LIGHTS = { sources: [], cells: [] };

function judge(modules, traits, { home, assignments = {}, services = {}, lights = NO_LIGHTS, start = null, others = [] } = {}) {
  const resident = { id: 'a', name: 'Test', looks: 1, needs: ['water', 'power'], wants: traits.wants || [], hates: traits.hates || [], dream: traits.dream || null, start };
  const extra = others.map((id) => ({ id, name: id, looks: 1, needs: [], wants: [], hates: [], dream: null, start: null }));
  const results = { services, analysis: analyze(modules), walking: walkingNetwork(modules), lights };
  return evaluateResidents(modules, results, [resident, ...extra], { a: home, ...assignments })[0];
}
const want = (modules, trait, options) => judge(modules, { wants: [trait] }, options).wants[0];
const hate = (modules, trait, options) => judge(modules, { hates: [trait] }, options).hates[0];
const dream = (modules, trait, options) => judge(modules, { dream: trait }, options).dream;

// A three story house with a flat on top, a house beside it and a generator on the other side
const STACK = [part(1, 'housing', '1x1', 3, 0, 0, 0), part(2, 'housing', '1x1', 1, 0, 0, 3), part(3, 'housing', '1x1', 2, 1, 0, 0), part(4, 'generator', '1x1', 1, -1, 0, 0)];
// A house walled in on all four sides at its own story
const WALLED = [part(1, 'housing', '1x1', 1, 0, 0, 0), part(2, 'core', '1x1', 1, 1, 0, 0), part(3, 'core', '1x1', 1, -1, 0, 0), part(4, 'core', '1x1', 1, 0, 1, 0), part(5, 'core', '1x1', 1, 0, -1, 0)];
// A lone house, a clinic 3 cells away and a disposal farther off
const LONE = [part(1, 'housing', '1x1', 1, 0, 0, 0), part(2, 'clinic', '1x1', 1, 3, 0, 0), part(3, 'disposal', '1x1', 1, -4, -4, 0)];

test('wants high up, low down and outward wall, met and not', () => {
  assert.deepEqual([want(STACK, { id: 'high', story: 2 }, { home: 2 }).met, want(STACK, { id: 'high', story: 2 }, { home: 1 }).reason], [true, 'too-low']);
  assert.deepEqual([want(STACK, { id: 'low', story: 1 }, { home: 1 }).met, want(STACK, { id: 'low', story: 1 }, { home: 2 }).reason], [true, 'too-high']);
  assert.equal(want(LONE, { id: 'outward' }, { home: 1 }).met, true);
  assert.deepEqual(want(WALLED, { id: 'outward' }, { home: 1 }), { id: 'outward', met: false, reason: 'no-outward-wall' });
});

test('wants away from industry, near an amenity and step-free, met and not', () => {
  assert.equal(want(STACK, { id: 'calm', cells: 2 }, { home: 1 }).reason, 'industry-near');
  assert.equal(want(STACK, { id: 'calm', cells: 1 }, { home: 2 }).met, true, 'the top flat is 3 stories above the generator');
  const steps = walkingNetwork(LONE).modules[1].nearest.clinic.steps;
  assert.ok(steps > 0 && steps < Infinity);
  assert.equal(want(LONE, { id: 'amenity', type: 'clinic', steps }, { home: 1 }).met, true);
  assert.equal(want(LONE, { id: 'amenity', type: 'clinic', steps: steps - 1 }, { home: 1 }).reason, 'amenity-far');
  assert.equal(want(LONE, { id: 'amenity', type: 'gym', steps: 99 }, { home: 1 }).reason, 'amenity-unreachable');
  assert.equal(want(STACK, { id: 'stepfree' }, { home: 3 }).met, true);
  assert.equal(want(STACK, { id: 'stepfree' }, { home: 2 }).reason, 'stairs-only');
});

test('wants about who lives where: alone, roommate, neighbour, community, next to a friend', () => {
  assert.equal(want(STACK, { id: 'alone' }, { home: 1 }).met, true);
  assert.equal(want(STACK, { id: 'alone' }, { home: 1, assignments: { b: 1 }, others: ['b'] }).reason, 'shares-home');
  assert.equal(want(STACK, { id: 'roommate' }, { home: 1, assignments: { b: 1 }, others: ['b'] }).met, true);
  assert.equal(want(STACK, { id: 'roommate' }, { home: 1 }).reason, 'lives-alone');
  assert.equal(want(STACK, { id: 'neighbour' }, { home: 1, assignments: { b: 3 }, others: ['b'] }).met, true);
  assert.equal(want(STACK, { id: 'neighbour' }, { home: 1 }).reason, 'no-neighbour');
  assert.equal(want(STACK, { id: 'community' }, { home: 1, assignments: { b: 3, c: 2 }, others: ['b', 'c'] }).met, true);
  assert.equal(want(STACK, { id: 'community' }, { home: 1, assignments: { b: 3 }, others: ['b'] }).reason, 'too-few-neighbours');
  assert.equal(want(STACK, { id: 'nextto', resident: 'b' }, { home: 1, assignments: { b: 2 }, others: ['b'] }).met, true);
  assert.equal(want(LONE, { id: 'nextto', resident: 'b' }, { home: 1, assignments: { b: null }, others: ['b'] }).reason, 'friend-away');
});

test('wants extra water, extra power and a lit outdoor area, met and not', () => {
  const served = (water, power) => ({ water: { consumers: { 1: { received: water, demand: water, status: 'full' } } }, power: { consumers: { 1: { received: power, demand: power, status: 'full' } } } });
  // By hand: a house drinks 0.25 water and draws 0.5 power
  assert.equal(want(LONE, { id: 'water' }, { home: 1, services: served(0.75, 0.5) }).met, true);
  assert.equal(want(LONE, { id: 'water' }, { home: 1, services: served(0.5, 0.5) }).reason, 'no-extra-water');
  assert.equal(want(LONE, { id: 'power' }, { home: 1, services: served(0.25, 1) }).met, true);
  assert.equal(want(LONE, { id: 'power' }, { home: 1, services: served(0.25, 0.75) }).reason, 'no-extra-power');
  assert.deepEqual(residentExtras([{ id: 'a', wants: [{ id: 'water' }, { id: 'power' }] }, { id: 'b', wants: [{ id: 'water' }] }], { a: 1, b: null }), { water: { 1: 0.5 }, power: { 1: 0.5 } });
  assert.equal(want(LONE, { id: 'lit' }, { home: 1, lights: { sources: [], cells: [[0, 0, 0]] } }).met, true);
  assert.equal(want(LONE, { id: 'lit' }, { home: 1 }).reason, 'dark-outside');
});

test('preset residents want to stay or to move', () => {
  assert.equal(want(STACK, { id: 'stay' }, { home: 1, start: 1 }).met, true);
  assert.equal(want(STACK, { id: 'stay' }, { home: 3, start: 1 }).reason, 'moved');
  assert.equal(want(STACK, { id: 'move' }, { home: 3, start: 1 }).met, true);
  assert.equal(want(STACK, { id: 'move' }, { home: 1, start: 1 }).reason, 'stayed');
});

test('hates of the surroundings: industry or smoke, noise, disposal, the dark, floodlights, cables', () => {
  assert.equal(hate(STACK, { id: 'industry', cells: 2 }, { home: 1 }).triggered, true);
  assert.equal(hate(LONE, { id: 'industry', cells: 3 }, { home: 1 }).triggered, false);
  assert.equal(hate(STACK, { id: 'noise' }, { home: 1 }).reason, 'noisy-room-adjacent');
  assert.equal(hate(STACK, { id: 'noise' }, { home: 2 }).triggered, false);
  assert.equal(hate(LONE, { id: 'disposal', cells: 4 }, { home: 1 }).triggered, true);
  assert.equal(hate(LONE, { id: 'disposal', cells: 3 }, { home: 1 }).triggered, false);
  assert.equal(hate(LONE, { id: 'dark' }, { home: 1 }).triggered, true);
  assert.equal(hate(LONE, { id: 'dark' }, { home: 1, lights: { sources: [], cells: [[0, 0, 0]] } }).triggered, false);
  // Home voxel centre is at 12.5, 12.5, 12.5 mm; radius 3.5 cells is 87.5 mm
  const flood = (lit, x) => ({ sources: [{ module: 9, kind: 'floodlight', point: [x, 12.5, 12.5], radius: 3.5, lit }], cells: [] });
  assert.equal(hate(LONE, { id: 'glare' }, { home: 1, lights: flood(true, 99) }).triggered, true);
  assert.equal(hate(LONE, { id: 'glare' }, { home: 1, lights: flood(false, 99) }).triggered, false, 'an unlit floodlight');
  assert.equal(hate(LONE, { id: 'glare' }, { home: 1, lights: flood(true, 101) }).triggered, false, 'just past its radius');
  const wires = (module) => ({ wires: [{ from: { module }, to: { module: 9 } }] });
  assert.equal(hate(LONE, { id: 'cables' }, { home: 1, services: wires(1) }).triggered, true);
  assert.equal(hate(LONE, { id: 'cables' }, { home: 1, services: wires(2) }).triggered, false);
});

test('hates of the home: heights, ground floor, stairs only, long walk, crowding, no view, an amenity, a rival', () => {
  assert.equal(hate(STACK, { id: 'heights', story: 2 }, { home: 2 }).triggered, true);
  assert.equal(hate(STACK, { id: 'heights', story: 3 }, { home: 2 }).triggered, false);
  assert.equal(hate(STACK, { id: 'ground' }, { home: 1 }).triggered, true);
  assert.equal(hate(STACK, { id: 'ground' }, { home: 2 }).triggered, false);
  assert.equal(hate(STACK, { id: 'stairs' }, { home: 2 }).triggered, true);
  assert.equal(hate(STACK, { id: 'stairs' }, { home: 3 }).triggered, false);
  const steps = walkingNetwork(STACK).modules[2].plinthSteps;
  assert.ok(steps > 0 && steps < Infinity);
  assert.equal(hate(STACK, { id: 'walk', steps: steps - 1 }, { home: 2 }).triggered, true);
  assert.equal(hate(STACK, { id: 'walk', steps }, { home: 2 }).triggered, false);
  assert.equal(hate(STACK, { id: 'crowding', homes: 1 }, { home: 1 }).triggered, true, 'two homes touch it');
  assert.equal(hate(STACK, { id: 'crowding', homes: 2 }, { home: 1 }).triggered, false);
  assert.equal(hate(WALLED, { id: 'view' }, { home: 1 }).triggered, true);
  assert.equal(hate(LONE, { id: 'view' }, { home: 1 }).triggered, false);
  assert.equal(hate(LONE, { id: 'amenity', type: 'clinic', steps: 99 }, { home: 1 }).triggered, true);
  assert.equal(hate(LONE, { id: 'amenity', type: 'clinic', steps: 0 }, { home: 1 }).triggered, false);
  assert.equal(hate(STACK, { id: 'feud', resident: 'b' }, { home: 1, assignments: { b: 3 }, others: ['b'] }).triggered, true);
  assert.equal(hate(LONE, { id: 'feud', resident: 'b' }, { home: 1, assignments: { b: null }, others: ['b'] }).triggered, false);
});

test('dreams about the building: tall, bridged, a roof garden, a market', () => {
  assert.equal(dream(STACK, { id: 'tall', stories: 4 }, { home: 3 }).met, true, 'the stack is 4 stories');
  assert.equal(dream(LONE, { id: 'tall', stories: 4 }, { home: 1 }).reason, 'too-short');
  const towers = [part(1, 'housing', '1x1', 3, 0, 0, 0), part(2, 'housing', '1x1', 3, 4, 0, 0), part(3, 'walkway', '1x3', 1, 1, 0, 2)];
  assert.equal(dream(towers, { id: 'bridge' }, { home: 1 }).met, true);
  assert.equal(dream(towers.slice(0, 2), { id: 'bridge' }, { home: 1 }).reason, 'no-bridge');
  const garden = [part(1, 'housing', '1x1', 2, 0, 0, 0), part(2, 'garden', '1x1', 1, 0, 0, 2)];
  assert.equal(dream(garden, { id: 'garden' }, { home: 1 }).met, true);
  assert.equal(dream(LONE, { id: 'garden' }, { home: 1 }).reason, 'no-roof-garden');
  const market = [part(1, 'housing', '1x1', 2, 0, 0, 0), part(2, 'market', '1x1', 1, 1, 0, 0)];
  assert.equal(dream(market, { id: 'market' }, { home: 1 }).met, true);
  assert.equal(dream(LONE, { id: 'market' }, { home: 1 }).reason, 'no-market');
});

test('needs are full water and full power at home; no home meets nothing and triggers nothing', () => {
  const services = { water: { consumers: { 1: { received: 0.25, demand: 0.25, status: 'full' } } }, power: { consumers: { 1: { received: 0.25, demand: 0.5, status: 'partial' } } } };
  const result = judge(LONE, { wants: [{ id: 'outward' }], hates: [{ id: 'dark' }] }, { home: 1, services });
  assert.deepEqual(result.needs, [{ id: 'water', met: true, reason: 'full' }, { id: 'power', met: false, reason: 'partial' }]);
  const homeless = judge(LONE, { wants: [{ id: 'outward' }], hates: [{ id: 'dark' }], dream: { id: 'market' } }, { home: null });
  assert.deepEqual([homeless.needs.map((need) => need.reason), homeless.wants[0].met, homeless.hates[0].triggered, homeless.dream.met, homeless.happy], [['no-home', 'no-home'], false, false, false, false]);
});

test('the conflict table keeps contradictions off one resident', () => {
  const traitOf = (tagText, extra = {}) => ({ kind: tagText.split(':')[0], id: tagText.split(':')[1], ...extra });
  for (const [first, second] of [['want:alone', 'want:roommate'], ['want:high', 'hate:heights'], ['want:stepfree', 'hate:stairs'], ['want:stay', 'want:move'], ['want:lit', 'hate:dark']]) {
    assert.ok(conflicting(traitOf(first), traitOf(second)) && conflicting(traitOf(second), traitOf(first)), `${first} ${second}`);
  }
  assert.ok(conflicting(traitOf('want:amenity', { type: 'gym' }), traitOf('hate:amenity', { type: 'gym' })));
  assert.ok(!conflicting(traitOf('want:amenity', { type: 'gym' }), traitOf('hate:amenity', { type: 'clinic' })));
  assert.ok(conflicting(traitOf('want:nextto', { resident: 'r2' }), traitOf('hate:feud', { resident: 'r2' })));
  assert.ok(!conflicting(traitOf('want:high'), traitOf('hate:dark')));
  // Many rolls: counts in range, no conflicting pair, stay and move only for preset residents
  for (let seed = 1; seed <= 300; seed++) {
    const preset = seed % 3 === 0;
    const resident = rollResident(seed, 'r1', { amenities: ['gym', 'clinic'], others: ['r2', 'r3'], start: preset ? 4 : null });
    const traits = traitsOf(resident);
    assert.ok(resident.wants.length >= 1 && resident.wants.length <= 4 && resident.hates.length <= 2, `${seed} counts`);
    for (const [index, first] of traits.entries()) for (const second of traits.slice(index + 1)) assert.ok(!conflicting(first, second), `${seed} ${first.id} ${second.id}`);
    if (!preset) assert.ok(!resident.wants.some((trait) => trait.id === 'stay' || trait.id === 'move'), `${seed} stay or move without a start`);
    assert.ok(typeof resident.name === 'string' && resident.name.includes(' '));
  }
  assert.deepEqual(rollResident(5, 'r1', { amenities: ['gym'] }), rollResident(5, 'r1', { amenities: ['gym'] }));
});
