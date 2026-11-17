import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MAX_MM, LAUNDRY_COLORS, TARP_COLORS, TARPS_MAX, CLOTHESLINES_MAX } from '../js/config.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { generate } from '../js/core/generator.js';
import { structureMounts } from '../js/core/mounts.js';
import { stringContext, pathBlocked } from '../js/core/strings.js';
import { planLines } from '../js/core/lines.js';

const MEGA = { scale: 'mega', density: 2, height: 2, daring: 2, theme: 2 };
const EPS_MM = 1e-6; // rounding slack
const part = (id, family, fp, h, x, y, z, mask, seed = 3) => ({ ...normalizeVariant({ family, fp, h, seed, mask, roof: false }), id, x, y, z, rot: 0 });
const linesOf = (modules, seed) => {
  const ports = structureMounts(modules);
  const context = stringContext(modules);
  return { ports, context, plan: planLines(modules, seed, { ports, context }) };
};

test('a clothesline hangs across the gap between two facing homes, with washing under it', () => {
  // Same seed, mirror facades: the hooks sit at the same height
  const modules = [part(1, 'housing', '1x1', 2, 0, 0, 0, 0b0001), part(2, 'housing', '1x1', 2, 2, 0, 0, 0b0100)];
  const { ports, context, plan } = linesOf(modules, 'wash');
  assert.equal(plan.lines.length, 1);
  const [line] = plan.lines;
  assert.equal(line.type, 'line');
  assert.deepEqual([line.from.module, line.to.module].sort(), [1, 2]);
  for (const end of [line.from, line.to]) assert.equal(ports.find((port) => port.module === end.module && port.index === end.index).type, 'line');
  assert.ok(line.length <= LINE_MAX_MM);
  assert.equal(pathBlocked(context, line.points, [1, 2]), null);
  const middle = line.points[Math.floor(line.points.length / 2)];
  assert.ok(middle[2] < Math.min(line.from.position[2], line.to.position[2]), 'sags');
  assert.ok(plan.laundry.length > 0);
  for (const piece of plan.laundry) {
    assert.ok(LAUNDRY_COLORS.includes(piece.color));
    assert.ok(piece.top[2] < Math.max(line.from.position[2], line.to.position[2]));
    assert.ok(piece.top[0] > 25 && piece.top[0] < 50, 'washing hangs in the gap');
  }
  assert.deepEqual(linesOf(modules, 'wash').plan, plan);
});

test('lines and tarps of generated structures use line hooks only, within capacity, clear of modules', () => {
  let lines = 0;
  let laundry = 0;
  let tarps = 0;
  for (const seed of ['barbican', 'habitat', 'arco', 'nakagin']) {
    for (const options of [{ seed, ...MEGA }, { seed, scale: 'block' }]) {
      const { modules } = generate(options);
      const { ports, context, plan } = linesOf(modules, seed);
      const portOf = (end) => ports.find((port) => port.module === end.module && port.index === end.index);
      const used = new Map();
      const use = (end) => {
        const port = portOf(end);
        assert.ok(port.active && port.type === 'line', `${seed} hangs from a ${port.type} port`);
        const key = end.module + ':' + end.index;
        used.set(key, (used.get(key) || 0) + 1);
        assert.ok(used.get(key) <= port.capacity, `${seed} hook ${key} over capacity`);
      };
      assert.ok(plan.lines.length <= CLOTHESLINES_MAX && plan.tarps.length <= TARPS_MAX);
      for (const line of plan.lines) {
        lines++;
        use(line.from);
        use(line.to);
        assert.ok(line.length <= LINE_MAX_MM + EPS_MM);
        assert.equal(pathBlocked(context, line.points, [line.from.module, line.to.module]), null, `${seed} line through a module`);
      }
      for (const piece of plan.laundry) {
        laundry++;
        assert.ok(piece.top[2] - piece.drop >= 0);
        assert.equal(pathBlocked(context, [piece.top, [piece.top[0], piece.top[1], piece.top[2] - piece.drop]], []), null);
      }
      for (const tarp of plan.tarps) {
        tarps++;
        assert.ok(tarp.anchors.length === 3 || tarp.anchors.length === 4);
        assert.ok(TARP_COLORS.includes(tarp.color));
        tarp.anchors.forEach(use);
      }
    }
  }
  assert.ok(lines >= 30 && laundry >= 100 && tarps >= 2, `lines ${lines}, laundry ${laundry}, tarps ${tarps}`);
});
