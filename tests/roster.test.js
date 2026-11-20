import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { rollResident } from '../js/core/residents.js';
import { analyze } from '../js/core/analysis.js';
import { STORY_MM, CELL_MM, PIN_RISE_MM } from '../js/config.js';
import { homeSpot, residentRecord, parseResident, serializeResidents, parseResidents, assignResident, roomIn, keepHomes, rollSandboxResident, happiness, createResidentStore, assignmentsOf } from '../js/core/roster.js';

const memoryStore = () => {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, value) };
};

test('a resident record survives save and load unchanged', () => {
  const files = readdirSync('puzzles').filter((name) => name.endsWith('.json'));
  const residents = files.flatMap((name) => JSON.parse(readFileSync(`puzzles/${name}`, 'utf8')).residents);
  for (let index = 0; index < 40; index++) residents.push(rollResident(9000 + index, `r${index}`, { amenities: ['gym', 'clinic'], others: ['r90', 'r91'], start: index % 3 === 0 ? 7 : null }));
  assert.ok(residents.length > 60);
  for (const [index, resident] of residents.entries()) {
    const record = residentRecord(resident, index % 2 === 0 ? 12 : null);
    const back = parseResident(JSON.parse(JSON.stringify(record)));
    assert.deepEqual(back, record);
    assert.equal(back.name, resident.name);
    assert.deepEqual(back.wants, resident.wants);
    assert.deepEqual(back.hates, resident.hates);
    assert.deepEqual(back.dream, resident.dream);
  }
  const records = residents.slice(0, 10).map((resident) => residentRecord(resident, 3));
  assert.deepEqual(parseResidents(serializeResidents(records)).records, records);
});

test('bad records are refused', () => {
  const good = residentRecord(rollResident(5, 'r1', {}), null);
  assert.ok(parseResident(good));
  assert.equal(parseResident({ ...good, v: 99 }), null);
  assert.equal(parseResident({ ...good, wants: [{ id: 'flying' }] }), null);
  assert.equal(parseResident({ ...good, wants: [{ id: 'high', story: 'tall' }] }), null);
  assert.equal(parseResident({ ...good, dream: { id: 'castle' } }), null);
  assert.equal(parseResident({ ...good, home: 'up' }), null);
  assert.equal(parseResident({ ...good, needs: ['coffee'] }), null);
  assert.equal(parseResidents('not json').ok, false);
});

test('homes take residents up to capacity and keep them while they stand', () => {
  const studio = { id: 1, family: 'studio', fp: '1x1', h: 1, x: 0, y: 0, z: 0, rot: 0, seed: 1, mask: 0 };
  const housing = { id: 2, family: 'housing', fp: '2x2', h: 2, x: 2, y: 0, z: 0, rot: 0, seed: 1, mask: 0 };
  const farm = { id: 3, family: 'farm', fp: '1x1', h: 1, x: 5, y: 0, z: 0, rot: 0, seed: 1, mask: 0 };
  const modules = [studio, housing, farm];
  let records = ['a', 'b', 'c'].map((id) => residentRecord(rollResident(1, id, {}), null));
  records = assignResident(records, modules, 'a', 1);
  assert.equal(roomIn(studio, records), 0);
  assert.equal(assignResident(records, modules, 'b', 1), null);
  assert.equal(assignResident(records, modules, 'b', 3), null);
  records = assignResident(records, modules, 'b', 2);
  records = assignResident(records, modules, 'c', 2);
  assert.equal(roomIn(housing, records), 0);
  assert.equal(roomIn(housing, records, 'c'), 1);
  assert.deepEqual(assignmentsOf(records), { a: 1, b: 2, c: 2 });
  const places = Object.fromEntries(records.map((record) => [record.id, modules.find((instance) => instance.id === record.home)]));
  const moved = keepHomes(records, [studio, { ...housing, x: 3 }], places);
  assert.deepEqual(assignmentsOf(moved), { a: 1, b: null, c: null });
});

test('sandbox residents roll with fresh ids and the happiness meter', () => {
  const first = rollSandboxResident('beton', [], ['gym']);
  const second = rollSandboxResident('beton', [first], ['gym']);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(rollSandboxResident('beton', [], ['gym']), first);
  assert.deepEqual(happiness({ home: null, wants: [], hates: [] }), { segments: 0, happy: false, placed: false });
  const half = { home: 1, happy: false, wants: [{ met: true }, { met: false }], hates: [], dream: null };
  assert.equal(happiness(half).segments, 3);
  assert.equal(happiness({ ...half, hates: [{ triggered: true }] }).segments, 1);
  assert.equal(happiness({ home: 1, happy: true, wants: [{ met: true }], hates: [], dream: null }).segments, 5);
});

test('saved residents stay after a reload, once each', () => {
  const storage = memoryStore();
  const store = createResidentStore(storage);
  store.load();
  const record = residentRecord(rollResident(3, 'r1', {}), 4);
  assert.equal(store.add(record).added, true);
  assert.equal(store.add(record).added, false);
  const again = createResidentStore(storage);
  assert.deepEqual(again.load(), [{ ...record, home: null, start: null }]);
  again.remove(record.looks);
  assert.deepEqual(createResidentStore(storage).load(), []);
  const broken = createResidentStore({ getItem: () => null, setItem: () => { throw new Error('full'); } });
  broken.load();
  assert.equal(broken.add(record).stored, false);
});

test('pins float above a home, or beside it when something sits on top', () => {
  const lower = { id: 1, family: 'housing', fp: '1x1', h: 2, x: 0, y: 0, z: 0, rot: 0, seed: 1, mask: 0 };
  const upper = { id: 2, family: 'housing', fp: '1x1', h: 1, x: 0, y: 0, z: 2, rot: 0, seed: 1, mask: 0 };
  const neighbour = { id: 3, family: 'housing', fp: '1x1', h: 3, x: 1, y: 0, z: 0, rot: 0, seed: 1, mask: 0 };
  const modules = [lower, upper, neighbour];
  const analysis = analyze(modules);
  const top = homeSpot(upper, analysis);
  assert.deepEqual(top.pin, [CELL_MM / 2, CELL_MM / 2, 3 * STORY_MM + PIN_RISE_MM]);
  const covered = homeSpot(lower, analysis);
  assert.ok(covered.pin[2] <= 2 * STORY_MM + PIN_RISE_MM);
  // Stands outside an open wall, never toward the neighbour on +x
  assert.ok(covered.stand[0] <= CELL_MM, String(covered.stand));
  const outside = covered.stand[0] < 0 || covered.stand[1] < 0 || covered.stand[1] > CELL_MM;
  assert.ok(outside, String(covered.stand));
  assert.equal(covered.stand[2], 0);
  const pair = [0, 1].map((slot) => homeSpot(upper, analysis, slot, 2).pin);
  assert.notDeepEqual(pair[0], pair[1]);
});

test('every trait and reason a resident can show has copy', async () => {
  const { COPY } = await import('../js/ui/copy.js');
  const { WANTS, HATES, DREAMS } = await import('../js/core/residents.js');
  const { scorePuzzleLayout } = await import('../js/core/puzzle.js');
  for (const [kind, table] of [['want', WANTS], ['hate', HATES], ['dream', DREAMS]]) for (const id of Object.keys(table)) assert.ok(COPY.traits[`${kind}:${id}`], `${kind}:${id}`);
  const seen = new Set();
  for (const name of readdirSync('puzzles').filter((file) => file.endsWith('.json')).slice(0, 4)) {
    const puzzle = JSON.parse(readFileSync(`puzzles/${name}`, 'utf8'));
    for (const layout of [puzzle.par.layout, { pieces: [], residents: {} }]) {
      for (const result of scorePuzzleLayout(puzzle, layout).evaluations) for (const item of [...result.needs, ...result.wants, ...result.hates, ...(result.dream ? [result.dream] : [])]) seen.add(item.reason);
    }
  }
  assert.ok(seen.size > 10);
  for (const code of seen) assert.ok(COPY.reasons[code], code);
});
