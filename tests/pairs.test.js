import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WIRES_PER_PAIR, MAX_PIPES_PER_PAIR, MAX_LINES_PER_PAIR } from '../js/config.js';
import { generate } from '../js/core/generator.js';
import { structureMounts } from '../js/core/mounts.js';
import { stringContext } from '../js/core/strings.js';
import { planPower } from '../js/core/power.js';
import { planServices, usedPorts, drawnPorts } from '../js/core/services.js';
import { serviceLines } from '../js/core/drafting.js';

const HIGH = { density: 2, height: 2, daring: 2, theme: 2 };
const CASES = [['barbican', 'mega'], ['habitat', 'mega'], ['arco', 'mega'], ['barbican', 'block'], ['beton', 'block']];
const key = (end) => end.module + ':' + end.index;
const pairOf = (string) => [key(string.from), key(string.to)].sort().join('|');

let built = null;
function plans() {
  if (built) return built;
  built = CASES.map(([seed, scale]) => {
    const { modules } = generate({ seed, scale, ...HIGH });
    const mounts = structureMounts(modules);
    const context = stringContext(modules);
    return { name: `${seed} ${scale}`, seed, modules, mounts, context, plan: planServices(modules, seed, { mounts, context }) };
  });
  return built;
}

test('no port pair carries more strings than its cap, counted both ways', () => {
  for (const { name, plan } of plans()) {
    for (const [list, cap] of [[plan.wires, MAX_WIRES_PER_PAIR], [plan.pipes, MAX_PIPES_PER_PAIR], [plan.lines, MAX_LINES_PER_PAIR]]) {
      const counts = new Map();
      for (const string of list) counts.set(pairOf(string), (counts.get(pairOf(string)) || 0) + 1);
      for (const [pair, count] of counts) assert.ok(count <= cap, `${name} ${list[0].type} ${pair} has ${count}`);
    }
  }
});

test('the wire cap keeps every port the uncapped wires reached, and it does bite', () => {
  let trimmed = 0;
  for (const { name, seed, modules, mounts, context, plan } of plans()) {
    const loose = planPower(modules, seed, { ports: mounts, context, pairCap: Infinity });
    const reached = (cables) => new Set(cables.flatMap((cable) => [key(cable.from), key(cable.to)]));
    const before = reached(loose.cables);
    const after = reached(plan.wires);
    assert.ok(after.size >= before.size, `${name} ${after.size} ports against ${before.size}`);
    for (const port of before) assert.ok(after.has(port), `${name} lost ${port}`);
    trimmed += loose.cables.length - plan.wires.length;
  }
  assert.ok(trimmed > 0, 'some pairs had more than the cap before');
});

test('the main view draws exactly the ports with strings, the Drawing overlay marks the rest hollow', () => {
  assert.deepEqual(drawnPorts([], null), []);
  for (const { name, modules, mounts, plan } of plans()) {
    const used = usedPorts(plan);
    const drawn = drawnPorts(mounts, plan);
    for (const port of drawn) assert.ok(port.active && used.has(key(port)), `${name} drawn port ${key(port)} has no string`);
    const drawnKeys = new Set(drawn.map(key));
    for (const port of mounts) if (port.active && used.has(key(port))) assert.ok(drawnKeys.has(key(port)), `${name} port ${key(port)} with a string is not drawn`);
    assert.ok(drawn.length > 0 && drawn.length < mounts.filter((port) => port.active).length, `${name} some ports idle`);
    // Hollow squares: four blue segments per unused active port, after the plan's own lines
    const unused = mounts.filter((port) => port.active && !drawnKeys.has(key(port)));
    const plain = serviceLines(plan, modules);
    const marked = serviceLines(plan, modules, unused);
    assert.equal(marked.statuses.length, plain.statuses.length + unused.length * 4);
    assert.ok(marked.statuses.slice(plain.statuses.length).every((status) => status === 'line'));
    const [x, y, z] = unused[0].position;
    const square = marked.positions.slice(plain.positions.length, plain.positions.length + 24);
    for (let corner = 0; corner < 24; corner += 3) assert.ok(Math.hypot(square[corner] - x, square[corner + 1] - y, square[corner + 2] - z) < 2, `${name} mark by its port`);
  }
});
