import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MM, STORY_MM, PIPE_RADIUS_MM, PIPE_GAP_MM, PIPE_CROSS_MAX_MM } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { stringContext, insideSolid } from '../js/core/strings.js';
import { planServices } from '../js/core/services.js';
import { linkCost } from '../js/core/water.js';
import { PIPE_OFF_MM, worldBodies, boxIndex, surfaceDistance, massesOf, pipeGraph, pipeSearch, pipePath, pathHead } from '../js/core/pipes.js';

const EPS = 1e-6; // rounding slack
const TOL_MM = 0.01; // distance slack on sampled points
const SAMPLE_MM = 0.25; // sample spacing along a pipe
const MEGA = { density: 2, height: 2, daring: 2, theme: 2 };
const CASES = [['barbican', 'mega'], ['habitat', 'mega'], ['arco', 'mega'], ['barbican', 'block'], ['habitat', 'block']];
const DIRECTIONS = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) DIRECTIONS.push([x, y, z].map((value) => value / Math.hypot(x, y, z)));
const part = (id, family, h, x, y, z = 0) => ({ ...normalizeVariant({ family, fp: '1x1', h, seed: 3, mask: 15, roof: false }), id, x, y, z, rot: 0 });
const port = (module, index, position, normal) => ({ module, index, position, normal, type: 'water' });
const samples = (from, to) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(...[0, 1, 2].map((axis) => to[axis] - from[axis])) / SAMPLE_MM));
  return Array.from({ length: steps + 1 }, (unused, index) => [0, 1, 2].map((axis) => from[axis] + ((to[axis] - from[axis]) * index) / steps));
};

// Generated structures with their plans, built once
let built = null;
function plans() {
  if (built) return built;
  built = CASES.map(([seed, scale]) => {
    const { modules } = generate({ seed, scale, ...MEGA });
    const context = stringContext(modules);
    const bodies = worldBodies(modules, context);
    return { name: `${seed} ${scale}`, seed, modules, context, bodies, near: boxIndex(bodies), massAt: massesOf(modules), plan: planServices(modules, seed, { context }) };
  });
  return built;
}

test('a pipe from one wall to another of the same tower wraps the corner tightly and keeps to the walls', () => {
  const tower = part(1, 'core', 3, 0, 0);
  const modules = [tower];
  const context = stringContext(modules);
  assert.deepEqual(worldBodies(modules, context).map((box) => [box.min, box.max]), [[[0.1, 0.1, 0], [24.9, 24.9, 75]]]);
  const ports = [port(1, 0, [24.9, 15, 60], [1, 0, 0]), port(1, 1, [8, 0.1, 10], [0, -1, 0])];
  const graph = pipeGraph(modules, ports, context);
  const path = pipePath(graph, pipeSearch(graph, [graph.portNodes[1]], false), graph.portNodes[0]);
  assert.equal(path.end, 1);
  assert.deepEqual(path.spans, []);
  assert.deepEqual(path.points[0], ports[0].position);
  assert.deepEqual(path.points[path.points.length - 1], ports[1].position);
  // By hand: two stubs, along the east wall, a 45 degree wrap in two chords, along the south wall
  const chord = PIPE_OFF_MM * Math.sqrt(2 - Math.SQRT2);
  const flatMm = PIPE_OFF_MM + (15 - 0.1) + 2 * chord + (24.9 - 8) + PIPE_OFF_MM;
  const head = pathHead(path.points);
  assert.ok(Math.abs(head.flat - flatMm / CELL_MM) < EPS, `${head.flat} against ${flatMm / CELL_MM}`);
  assert.equal(head.up, 0);
  // Every point past the stubs sits radius plus gap off a wall
  const bodies = worldBodies(modules, context);
  const near = boxIndex(bodies);
  for (const point of path.points.slice(1, -1)) assert.ok(surfaceDistance(bodies, near, point) <= PIPE_OFF_MM + TOL_MM);
});

test('a pipe crosses the gap between two towers as one straight span, bracket to bracket', () => {
  const modules = [part(1, 'core', 2, 0, 0), part(2, 'core', 2, 2, 0)];
  const ports = [port(1, 0, [24.9, 12.5, 40], [1, 0, 0]), port(2, 0, [50.1, 12.5, 30], [-1, 0, 0])];
  const graph = pipeGraph(modules, ports, stringContext(modules));
  const path = pipePath(graph, pipeSearch(graph, [graph.portNodes[1]], false), graph.portNodes[0]);
  assert.deepEqual(path.points, [ports[0].position, [24.9 + PIPE_OFF_MM, 12.5, 40], [50.1 - PIPE_OFF_MM, 12.5, 30], ports[1].position]);
  assert.deepEqual(path.spans, [1]);
  // Level travel 25.2 mm wall to wall, falling is free
  assert.deepEqual(pathHead(path.points), { flat: 25.2 / CELL_MM, up: 0 });
  // Gravity water takes the same span, it never climbs
  const fall = pipePath(graph, pipeSearch(graph, [graph.portNodes[1]], true), graph.portNodes[0]);
  assert.deepEqual(fall.points, path.points);
  // A head limit equal to the span's head still reaches it; the length tie does not count
  const exact = pipeSearch(graph, [graph.portNodes[1]], true, 25.2 / CELL_MM);
  assert.ok(exact.reached(graph.portNodes[0]));
  assert.ok(Math.abs(exact.flat(graph.portNodes[0]) - 25.2 / CELL_MM) < EPS);
  // Water cannot climb back up the same span by gravity
  assert.equal(pipeSearch(graph, [graph.portNodes[0]], true).reached(graph.portNodes[1]), false);
});

test('no generated pipe runs farther than the gap from a surface, except on gap spans', () => {
  let checked = 0;
  for (const { name, plan, bodies, near, context } of plans()) {
    for (const pipe of plan.pipes) {
      const spans = new Set(pipe.spans);
      for (let index = 1; index < pipe.points.length; index++) {
        if (spans.has(index - 1)) continue;
        for (const point of samples(pipe.points[index - 1], pipe.points[index])) {
          const onBody = surfaceDistance(bodies, near, point) - PIPE_RADIUS_MM <= PIPE_GAP_MM + TOL_MM;
          const onSolid = onBody || DIRECTIONS.some((direction) => insideSolid(context, point.map((value, axis) => value + direction[axis] * (PIPE_OFF_MM + TOL_MM))));
          assert.ok(onSolid, `${name} pipe ${pipe.link} segment ${index - 1} in open air at ${point.map((value) => value.toFixed(2))}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `${checked} points`);
});

test('every gap span is one straight piece between walls of different masses, within the length limit', () => {
  let spans = 0;
  for (const { name, plan, bodies, near, massAt } of plans()) {
    // Point one mm into the wall nearest a pipe end
    const wallOf = (point) => {
      let best = null;
      for (const index of near([point[0] - CELL_MM, point[1] - CELL_MM], [point[0] + CELL_MM, point[1] + CELL_MM])) {
        const box = bodies[index];
        const closest = point.map((value, axis) => Math.min(Math.max(value, box.min[axis]), box.max[axis]));
        const distance = Math.hypot(...closest.map((value, axis) => value - point[axis]));
        if (!best || distance < best.distance) best = { distance, closest };
      }
      const step = best.closest.map((value, axis) => (value - point[axis]) / best.distance);
      return { distance: best.distance, inside: best.closest.map((value, axis) => value + step[axis]) };
    };
    for (const pipe of plan.pipes) {
      for (const index of pipe.spans) {
        const [from, to] = [pipe.points[index], pipe.points[index + 1]];
        assert.ok(!pipe.spans.includes(index + 1), `${name} pipe ${pipe.link} spans in a row`);
        assert.ok(Math.hypot(...[0, 1, 2].map((axis) => to[axis] - from[axis])) <= PIPE_CROSS_MAX_MM + EPS, `${name} pipe ${pipe.link} span too long`);
        const [wallA, wallB] = [wallOf(from), wallOf(to)];
        assert.ok(wallA.distance <= PIPE_OFF_MM + TOL_MM && wallB.distance <= PIPE_OFF_MM + TOL_MM, `${name} pipe ${pipe.link} span ends off a wall`);
        for (const level of [Math.floor(from[2] / STORY_MM), Math.floor(to[2] / STORY_MM)]) {
          const own = massAt(wallA.inside, level);
          assert.ok(own === null || own !== massAt(wallB.inside, level), `${name} pipe ${pipe.link} span inside one mass`);
        }
        spans++;
      }
    }
  }
  assert.ok(spans >= 3, `${spans} spans`);
});

test('no generated pipe passes through a module body', () => {
  for (const { name, plan, bodies, near } of plans()) {
    for (const pipe of plan.pipes) {
      // The two stubs start on their port's own surface
      for (let index = 2; index < pipe.points.length - 1; index++) {
        for (const point of samples(pipe.points[index - 1], pipe.points[index])) {
          assert.ok(surfaceDistance(bodies, near, point) >= PIPE_RADIUS_MM - TOL_MM, `${name} pipe ${pipe.link} segment ${index - 1} inside a body`);
        }
      }
    }
  }
});

test('head along every delivered pipe matches its drawn path, and gravity pipes never climb', () => {
  let delivered = 0;
  for (const { name, plan } of plans()) {
    const kinds = new Map(plan.water.nodes.map((node) => [node.id, node]));
    for (const link of plan.water.links) {
      const flow = plan.water.solved.links[link.id];
      if (flow.units <= 0) continue;
      const head = pathHead(link.points);
      const from = kinds.get(link.from);
      assert.equal(link.flat, head.flat, `${name} link ${link.id} level travel`);
      if (from.kind === 'main') assert.ok(link.up >= head.up - EPS, `${name} link ${link.id} rise`);
      else assert.equal(link.up, head.up, `${name} link ${link.id} rise`);
      if (from.kind === 'pump') assert.ok(Math.abs(flow.headLeft - (from.head - linkCost(link))) < EPS, `${name} link ${link.id} head left`);
      if (plan.water.solved.nodes[link.from].gravity) assert.equal(head.up, 0, `${name} link ${link.id} gravity climbs`);
      assert.ok(flow.headLeft >= 0);
      delivered++;
    }
  }
  assert.ok(delivered >= 10, `${delivered} delivered pipes`);
});

test('the same seed gives the same pipes', () => {
  for (const { name, seed, modules, plan } of plans().slice(0, 2)) assert.deepEqual(planServices(modules, seed), plan, name);
});
