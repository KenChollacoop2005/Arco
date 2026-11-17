import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAVITY_HEAD, WATER_SOURCES, PIPE_RADIUS_MM, PIPE_GAP_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { instanceMounts } from '../js/core/mounts.js';
import { generate } from '../js/core/generator.js';
import { solveWater, splitWater, linkHead, linkCost, planWater, WATER_REASONS } from '../js/core/water.js';

const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };
const EPS = 1e-9; // rounding slack on unit sums

// Graph helpers: gravity nodes have head null
const source = (id, supply, level = 0, extra = {}) => ({ id, kind: 'source', supply, head: null, level, ...extra });
const pump = (id, row, level = 0, extra = {}) => ({ id, kind: 'pump', supply: WATER_SOURCES[row][0], head: WATER_SOURCES[row][1], throughput: WATER_SOURCES[row][2], level, ...extra });
const consumer = (id, demand, level = 0, extra = {}) => ({ id, kind: 'consumer', supply: 0, demand, head: null, level, ...extra });
const link = (id, from, to, flat, up, length = 10, port = 0) => ({ id, from, to, flat, up, length, port });
const balanced = (totals) => Math.abs(totals.supplied - (totals.delivered + totals.overflow + totals.unused)) < EPS;

test('head costs: 1 per level cell, 2 per story up, nothing down; gravity never climbs', () => {
  assert.equal(linkCost({ flat: 2, up: 0 }), 2);
  assert.equal(linkCost({ flat: 1, up: 3 }), 7);
  assert.equal(linkCost({ flat: 2, up: -4 }), 2);
  assert.deepEqual(linkHead(GRAVITY_HEAD, true, { flat: 2, up: 0 }), { left: 1, short: 0 });
  assert.deepEqual(linkHead(GRAVITY_HEAD, true, { flat: 0, up: -3 }), { left: 3, short: 0 });
  // Gravity water refuses one story up, even with head to spare
  const climb = linkHead(GRAVITY_HEAD, true, { flat: 0, up: 1 });
  assert.ok(climb.left < 0);
  assert.equal(climb.short, 2);
  assert.deepEqual(linkHead(9, false, { flat: 0, up: 4 }), { left: 1, short: 0 });
  assert.deepEqual(linkHead(9, false, { flat: 0, up: 5 }), { left: -1, short: 1 });
});

test('a split is even in half units, capped by want, with odd halves to the shortest branch', () => {
  // Quarters: 24 = 6 units into two big branches
  assert.deepEqual(splitWater(24, [{ want: 40, length: 5, port: 0 }, { want: 40, length: 9, port: 1 }]), [12, 12]);
  // 7.5 units: 3.5 each and the last half to the shorter run
  assert.deepEqual(splitWater(30, [{ want: 40, length: 30, port: 0 }, { want: 40, length: 12, port: 1 }]), [14, 16]);
  // Equal lengths: lowest port id wins the half
  assert.deepEqual(splitWater(6, [{ want: 40, length: 10, port: 3 }, { want: 40, length: 10, port: 1 }]), [2, 4]);
  // 4 units, wants 0.5, 3 and 3: the full branch's share goes to the others
  assert.deepEqual(splitWater(16, [{ want: 2, length: 10, port: 0 }, { want: 12, length: 20, port: 1 }, { want: 12, length: 30, port: 2 }]), [2, 8, 6]);
  // Never more than the total, never more than a want
  assert.deepEqual(splitWater(5, [{ want: 1, length: 1, port: 0 }, { want: 1, length: 2, port: 1 }]), [1, 1]);
});

test('a 6 unit pump room splits two ways into 3 and 3', () => {
  const solved = solveWater({
    nodes: [pump('room', 'pumproom'), consumer('a', 5), consumer('b', 5)],
    links: [link(0, 'room', 'a', 1, 0, 25, 0), link(1, 'room', 'b', 2, 0, 50, 1)],
  });
  assert.equal(solved.nodes.a.taken, 3);
  assert.equal(solved.nodes.b.taken, 3);
  // Pump head reset to 20, then spent on the level run
  assert.equal(solved.links[0].headLeft, 19);
  assert.equal(solved.links[1].headLeft, 18);
  assert.ok(balanced(solved.totals));
});

test('an uneven split sends the odd half to the shortest branch', () => {
  // 1.5 in plus the room's own 6 is 7.5 units
  const solved = solveWater({
    nodes: [source('s', 1.5), pump('room', 'pumproom'), consumer('long', 5), consumer('short', 5)],
    links: [link(0, 's', 'room', 1, 0), link(1, 'room', 'long', 3, 0, 75, 0), link(2, 'room', 'short', 1, 0, 25, 1)],
  });
  assert.equal(solved.nodes.room.received, 1.5);
  assert.equal(solved.nodes.short.taken, 4);
  assert.equal(solved.nodes.long.taken, 3.5);
  assert.ok(balanced(solved.totals));
});

test('a demand capped split hands the full branch\'s share to the others', () => {
  const solved = solveWater({
    nodes: [source('tank', 4), consumer('a', 0.5), consumer('b', 3), consumer('c', 3)],
    links: [link(0, 'tank', 'a', 1, 0, 10, 0), link(1, 'tank', 'b', 1, 0, 20, 1), link(2, 'tank', 'c', 2, 0, 30, 2)],
  });
  assert.deepEqual(['a', 'b', 'c'].map((id) => solved.nodes[id].taken), [0.5, 2, 1.5]);
  assert.equal(solved.totals.overflow, 0);
  assert.ok(balanced(solved.totals));
});

test('a 9 head pump lifts water 4 stories with 1 left, and the farm above stays dry out of head', () => {
  const nodes = [source('tank', 4, 1), pump('pump', 'smallpump', 1), consumer('low', 0.5, 5), consumer('high', 0.5, 6)];
  const links = [link(0, 'tank', 'pump', 1, 0), link(1, 'pump', 'low', 0, 4), link(2, 'low', 'high', 0, 1)];
  const solved = solveWater({ nodes, links });
  assert.equal(solved.links[1].headLeft, 1, '8 of 9 used');
  assert.equal(solved.nodes.low.taken, 0.5);
  assert.equal(solved.nodes.high.taken, 0);
  assert.equal(solved.links[2].runs, false);
  assert.equal(solved.links[2].short, 1);
  const reports = { low: null, high: null };
  for (const id of Object.keys(reports)) {
    const into = links.filter((entry) => entry.to === id);
    const node = nodes.find((entry) => entry.id === id);
    const stuck = into.filter((entry) => !solved.links[entry.id].runs);
    reports[id] = { status: solved.nodes[id].taken >= node.demand ? 'full' : 'dry', short: stuck.length ? solved.links[stuck[0].id].short : 0 };
  }
  assert.deepEqual(reports.high, { status: 'dry', short: 1 });
  assert.ok(balanced(solved.totals));
});

test('flows merge at a small pump: 3 and 4 in, 6 out at full pump head', () => {
  const solved = solveWater({
    nodes: [pump('pumped', 'pumptank'), source('tank', 4), pump('small', 'smallpump'), consumer('farm', 10, 3)],
    links: [link(0, 'pumped', 'small', 1, 0, 10, 0), link(1, 'tank', 'small', 1, 0, 10, 1), link(2, 'small', 'farm', 1, 2, 30, 0)],
  });
  assert.equal(solved.links[0].units + solved.links[1].units, 6);
  assert.equal(solved.links[0].units, 3);
  assert.equal(solved.nodes.small.received, 6);
  assert.equal(solved.nodes.farm.taken, 6);
  // Repeater: water leaves the pump at 9 whatever arrived (8 - 1 and 3 - 1)
  assert.equal(solved.nodes.small.head, 9);
  assert.equal(solved.links[2].headLeft, 4);
  assert.equal(solved.totals.overflow, 1);
  assert.ok(balanced(solved.totals));
});

test('a merge at a basin keeps the lowest head, and water passes through it', () => {
  const solved = solveWater({
    // Rain goes first, so both flows reach the basin
    nodes: [source('rain', 1), pump('room', 'pumproom'), consumer('basin', 0.5, 1), consumer('next', 1.5, 1)],
    links: [link(0, 'room', 'basin', 2, 0), link(1, 'rain', 'basin', 1, 0), link(2, 'basin', 'next', 1, 0)],
  });
  assert.equal(solved.links[1].units, 1);
  assert.equal(solved.links[0].units, 1);
  // Arrivals 18 and 2: the merged water has head 2, then 1 at the next basin
  assert.equal(solved.nodes.basin.head, 2);
  assert.equal(solved.links[2].headLeft, 1);
  assert.equal(solved.nodes.next.taken, 1.5);
  assert.ok(balanced(solved.totals));
});

test('a full upper farm trickles its surplus to a lower one, then to the plinth', () => {
  const solved = solveWater({
    nodes: [
      source('roof', 2, 3, { spill: [] }),
      consumer('upper', 0.5, 3, { spill: [{ node: 'lower', points: [[0, 0, 75], [0, 0, 50]] }] }),
      consumer('stuck', 1, 4),
      consumer('lower', 0.5, 2, { spill: [{ node: null, points: [[0, 0, 50], [0, 0, 0]] }] }),
    ],
    links: [link(0, 'roof', 'upper', 1, 0), link(1, 'upper', 'stuck', 0, 1)],
  });
  // Gravity cannot reach the farm a story up, so the upper farm holds 1 extra
  assert.equal(solved.nodes.upper.taken, 0.5);
  assert.equal(solved.nodes.stuck.taken, 0);
  assert.equal(solved.nodes.lower.taken, 0.5);
  assert.equal(solved.nodes.lower.trickled, 0.5);
  const sheets = solved.sheets.map((sheet) => [sheet.from, sheet.to, sheet.units]).sort((first, second) => first[0].localeCompare(second[0]));
  assert.deepEqual(sheets, [['lower', null, 0.5], ['roof', null, 0.5], ['upper', 'lower', 1]]);
  assert.deepEqual(solved.totals, { supplied: 2, delivered: 1, overflow: 1, unused: 0 });
});

const part = (id, family, fp, h, x, y, z, seed = 3) => ({ ...normalizeVariant({ family, fp, h, seed, mask: 15, roof: false }), id, x, y, z, rot: 0 });
// First seed whose port of a type faces the given way
const seedFacing = (family, type, normal) => {
  for (let seed = 1; seed < 200; seed++) {
    const port = instanceMounts(part(0, family, '1x1', 1, 0, 0, 0, seed)).find((entry) => entry.type === type);
    if (port && port.normal.join() === normal.join()) return seed;
  }
  throw new Error('no seed');
};

test('a tank feeds a farm two cells away over one gap span, with the head its drawn pipe leaves', () => {
  const modules = [
    part(1, 'core', '1x1', 3, 0, 0, 0),
    part(2, 'tank', '1x1', 1, 0, 0, 3, seedFacing('tank', 'water-out', [1, 0, 0])),
    part(3, 'core', '1x1', 3, 2, 0, 0),
    part(4, 'farm', '1x1', 1, 2, 0, 3, seedFacing('farm', 'water-in', [-1, 0, 0])),
  ];
  const plan = planWater(modules, 'seed');
  assert.equal(plan.links.length, 1);
  const [pipe] = plan.links;
  // By hand: stub to the tank body plane (20.7 mm), span to the farm bed plane (54.5 mm), stub in
  const [from, to] = [pipe.points[0], pipe.points[pipe.points.length - 1]];
  const off = PIPE_RADIUS_MM + PIPE_GAP_MM;
  assert.deepEqual(pipe.points, [from, [20.7 + off, from[1], from[2]], [54.5 - off, to[1], to[2]], to]);
  assert.deepEqual(pipe.spans, [1]);
  const flat = (20.7 + off - from[0] + Math.hypot(54.5 - 20.7 - 2 * off, to[1] - from[1]) + off) / 25;
  assert.ok(to[2] < from[2] && Math.abs(pipe.flat - flat) < 1e-6 && pipe.up === 0, `${pipe.flat} against ${flat}`);
  assert.deepEqual([pipe.from, pipe.to], ['2', '4']);
  const farm = plan.consumers[4];
  assert.deepEqual([farm.received, farm.status, farm.reason], [0.5, 'full', null]);
  assert.ok(Math.abs(farm.headLeft - (GRAVITY_HEAD - pipe.flat)) < 1e-9);
  // The tank pushes the rest over its edge
  assert.deepEqual(plan.solved.totals, { supplied: 4, delivered: 0.5, overflow: 3.5, unused: 0 });
  assert.ok(pipe.points.every((point) => point[2] >= 3 * 25));
});

test('a gravity tank never pushes water up to a higher farm', () => {
  const modules = [
    part(1, 'core', '1x1', 1, 0, 0, 0),
    part(2, 'tank', '1x1', 1, 0, 0, 1, seedFacing('tank', 'water-out', [1, 0, 0])),
    part(3, 'core', '1x1', 3, 1, 0, 0),
    part(4, 'farm', '1x1', 1, 1, 0, 3, seedFacing('farm', 'water-in', [-1, 0, 0])),
  ];
  const plan = planWater(modules, 'seed');
  assert.equal(plan.links.length, 0);
  const farm = plan.consumers[4];
  assert.equal(farm.status, 'dry');
  assert.equal(farm.reason, 'out of head');
  assert.ok(farm.short >= 2);
  assert.ok(WATER_REASONS.includes(farm.reason));
  assert.equal(plan.solved.totals.unused, 4);
});

test('generated networks balance, keep head and throughput, and repeat for a seed', () => {
  for (const seed of ['barbican', 'habitat', 'arco']) {
    const { modules } = generate({ seed, ...MEGA });
    const plan = planWater(modules, seed);
    assert.ok(balanced(plan.solved.totals), `${seed} ${JSON.stringify(plan.solved.totals)}`);
    for (const pipe of plan.links) {
      const flow = plan.solved.links[pipe.id];
      if (flow.units > 0) assert.ok(flow.headLeft >= 0, `${seed} link ${pipe.id} ran out of head`);
    }
    for (const node of plan.nodes) {
      if (node.kind !== 'pump') continue;
      const out = plan.links.filter((pipe) => pipe.from === node.id).reduce((sum, pipe) => sum + plan.solved.links[pipe.id].units, 0);
      assert.ok(out <= node.throughput + EPS, `${seed} pump ${node.id} over throughput`);
    }
    for (const report of Object.values(plan.consumers)) {
      assert.ok(['full', 'partial', 'dry'].includes(report.status));
      if (report.status !== 'full') assert.ok(WATER_REASONS.includes(report.reason), report.reason);
      assert.ok(report.received <= report.demand + EPS);
    }
    assert.deepEqual(planWater(modules, seed), plan);
  }
});

test('a pump with more water of its own than it can push spills the rest and the balance holds', () => {
  const solved = solveWater({
    nodes: [{ id: 'pump', kind: 'pump', supply: 4, head: 9, throughput: 3, level: 0 }, consumer('farm', 10)],
    links: [link(0, 'pump', 'farm', 1, 0)],
  });
  assert.equal(solved.nodes.farm.taken, 3);
  assert.equal(solved.nodes.pump.overflow, 1);
  assert.equal(solved.totals.supplied, 4);
  assert.ok(balanced(solved.totals), JSON.stringify(solved.totals));
});
