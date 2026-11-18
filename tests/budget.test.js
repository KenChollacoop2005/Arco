import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MODULES, BUDGET_HARD_CAP, BUDGET_CUSTOM_MIN, BUDGET_CUSTOM_DEFAULT, FANTASY_GROW } from '../js/config.js';
import { generate, openingOptions, normalizeOptions } from '../js/core/generator.js';
import { growOptions, createBuild } from '../js/core/build.js';
import { worldFromModules } from '../js/core/grid.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { checkPlacement } from '../js/core/placement.js';
import { runChecks } from '../js/core/checks.js';
import { assemblySteps } from '../js/core/assembly.js';
import { makeBudget, budgetCap, withinBudget, growRoll, generateLimits, growLimits, placeCap, budgetParams, budgetFromParams } from '../js/core/budget.js';

// Generate and Grow results, re-recorded after the raised wheel and platform sides changes
const BEFORE = {
  'barbican mega 2': [203, 'a86ff90a88736667', 197, '398fd3bc83dc4b15'],
  'habitat block 1': [31, 'b79dff1c375043fc', 32, 'ddbb4f42292825df'],
  'arco unit 1': [1, '6b6828ffe3949732', 50, '65413d18e0ff9ce3'],
  'beton block 0': [30, 'ff52a9a5cf7e987e', 41, '925712f2bd6819a9'],
  'golden mega 1': [210, '8441bb5815b4bdab', 161, '2d5076a2d1bf04f6'],
};
const OPENING_BEFORE = [17, '17ed3cdabbe96458'];

const choicesOf = (name) => {
  const [seed, scale, level] = name.split(' ');
  return { seed, scale, density: +level, height: +level, daring: +level, theme: +level };
};
const grownFrom = (first) => first.modules.slice(0, Math.ceil(first.modules.length / 3));

test('today\'s Generate, Grow and opening structure are unchanged', () => {
  for (const [name, [count, hash, grownCount, grownHash]] of Object.entries(BEFORE)) {
    const choices = choicesOf(name);
    const first = generate(choices);
    assert.deepEqual([first.modules.length, first.hash], [count, hash], name);
    const grown = generate(growOptions(choices, grownFrom(first)));
    assert.deepEqual([grown.modules.length, grown.hash], [grownCount, grownHash], `${name} grown`);
  }
  const opening = generate(openingOptions('opening'));
  assert.deepEqual([opening.modules.length, opening.hash], OPENING_BEFORE);
});

const FIXED = makeBudget();
const FANTASY = makeBudget({ mode: 'fantasy' });
const MEGA = choicesOf('barbican mega 2');
const BLOCK = choicesOf('habitat block 1');
const ROOMY = choicesOf('golden block 1'); // a block that fantasy Grow can still extend
// Grow under a budget, as the Build panel runs it
const growUnder = (budget, choices, modules) => generate({ ...growOptions(choices, modules), ...growLimits(budget, choices.seed, modules.length) });
// Stands, follows the rules and has an assembly order
function sound(modules, name) {
  const checks = runChecks(modules);
  assert.equal(checks.stability, 'pass', `${name} stability`);
  assert.equal(checks.placement, 'pass', `${name} placement`);
  assert.ok(assemblySteps(modules).ok, `${name} assembly`);
}

test('a budget is plain data: modes, clamps, the check and the URL fields', () => {
  assert.deepEqual(makeBudget(), { mode: 'fixed', cap: null });
  assert.deepEqual(makeBudget({ mode: 'nonsense', cap: 50 }), FIXED);
  assert.deepEqual(makeBudget({ mode: 'custom', cap: 3 }), { mode: 'custom', cap: BUDGET_CUSTOM_MIN });
  assert.deepEqual(makeBudget({ mode: 'custom', cap: 5000 }), { mode: 'custom', cap: BUDGET_HARD_CAP });
  assert.deepEqual(makeBudget({ mode: 'custom', cap: 'abc' }), { mode: 'custom', cap: BUDGET_CUSTOM_DEFAULT });
  assert.deepEqual(makeBudget({ mode: 'custom', cap: '75.4' }), { mode: 'custom', cap: 75 });
  assert.deepEqual([budgetCap(FIXED), budgetCap(FANTASY), budgetCap(makeBudget({ mode: 'custom', cap: 90 }))], [MAX_MODULES, BUDGET_HARD_CAP, 90]);
  assert.deepEqual(withinBudget(makeBudget({ mode: 'custom', cap: 90 }), 95), { ok: false, cap: 90, left: 0, over: 5 });
  assert.deepEqual(withinBudget(FIXED, 200), { ok: true, cap: MAX_MODULES, left: MAX_MODULES - 200, over: 0 });
  // A bare URL is fixed; custom and fantasy round trip
  assert.deepEqual(budgetParams(FIXED), {});
  assert.deepEqual(budgetFromParams(() => null), FIXED);
  for (const budget of [makeBudget({ mode: 'custom', cap: 140 }), FANTASY]) {
    const params = budgetParams(budget);
    assert.deepEqual(budgetFromParams((name) => params[name] || null), budget);
  }
  assert.equal(normalizeOptions({ cap: 5000 }).cap, BUDGET_HARD_CAP);
  assert.deepEqual([placeCap(FIXED), placeCap(FANTASY), placeCap(makeBudget({ mode: 'custom', cap: 50 }))], [MAX_MODULES, BUDGET_HARD_CAP, BUDGET_HARD_CAP]);
});

test('fixed through the budget path is today\'s Generate and Grow, module for module', () => {
  assert.deepEqual(generateLimits(FIXED), {});
  for (const choices of [MEGA, BLOCK]) {
    const first = generate(choices);
    assert.deepEqual(generate({ ...choices, ...generateLimits(FIXED) }), first);
    assert.deepEqual(growUnder(FIXED, choices, grownFrom(first)), generate(growOptions(choices, grownFrom(first))));
  }
});

test('a custom cap holds for Generate and Grow, and a roomy cap changes nothing', () => {
  const cap = 60;
  const budget = makeBudget({ mode: 'custom', cap });
  const first = generate({ ...MEGA, ...generateLimits(budget) });
  assert.equal(first.modules.length, cap);
  assert.ok(first.capped);
  sound(first.modules, 'custom generate at the cap');
  const grown = growUnder(budget, MEGA, first.modules.slice(0, 40));
  assert.ok(grown.modules.length <= cap && grown.modules.length > 40, `${grown.modules.length}`);
  const full = growUnder(budget, MEGA, first.modules);
  assert.equal(full.modules.length, cap, 'nothing grows past the cap');
  // A cap above the natural size gives the fixed structure
  assert.deepEqual(generate({ ...BLOCK, ...generateLimits(makeBudget({ mode: 'custom', cap: 300 })) }).modules, generate(BLOCK).modules);
});

test('fantasy Grow adds a seeded count in range, repeats for a seed, and never passes the hard cap', () => {
  for (let count = 0; count < 500; count += 7) {
    const roll = growRoll('barbican', count);
    assert.ok(roll >= FANTASY_GROW[0] && roll <= FANTASY_GROW[1]);
    const limits = growLimits(FANTASY, 'barbican', count);
    assert.equal(limits.cap, Math.min(BUDGET_HARD_CAP, count + roll));
    assert.ok(limits.cap <= BUDGET_HARD_CAP);
  }
  let modules = generate({ ...ROOMY, ...generateLimits(FANTASY) }).modules;
  for (let press = 0; press < 3; press++) {
    const roll = growRoll(ROOMY.seed, modules.length);
    const grown = growUnder(FANTASY, ROOMY, modules);
    assert.deepEqual(growUnder(FANTASY, ROOMY, modules), grown, 'same seed, same Grow');
    const added = grown.modules.length - modules.length;
    assert.ok(added <= roll, `press ${press} added ${added} of ${roll}`);
    // The low end holds while there is room; a capped block runs out after a few presses
    if (press === 0) assert.ok(added >= FANTASY_GROW[0], `first press added ${added}`);
    sound(grown.modules, `fantasy press ${press}`);
    modules = grown.modules;
  }
  // The generator never holds more than the hard cap
  assert.ok(generate({ ...MEGA, cap: BUDGET_HARD_CAP * 3 }).modules.length <= BUDGET_HARD_CAP);
});

test('Build places past today\'s cap only under custom or fantasy, refuses at the hard cap, and Grow undo still works', () => {
  // Stacks of plain cores, enough to reach a cap
  const core = normalizeVariant({ family: 'core', fp: '1x1', h: 1, seed: 1 });
  const cores = (count) => Array.from({ length: count }, (unused, index) => ({ ...core, id: index + 1, x: (index % 8) - 4, y: (Math.floor(index / 8) % 8) - 4, z: Math.floor(index / 64), rot: 0 }));
  const spot = (list) => ({ ...core, id: 0, x: -4, y: -4, z: Math.ceil(list.length / 64), rot: 0 });
  const today = cores(MAX_MODULES);
  assert.equal(checkPlacement(worldFromModules(today), spot(today)).reason, 'Module limit reached');
  assert.notEqual(checkPlacement(worldFromModules(today), spot(today), { cap: placeCap(FANTASY) }).reason, 'Module limit reached');
  const full = cores(BUDGET_HARD_CAP);
  assert.equal(checkPlacement(worldFromModules(full), spot(full), { cap: placeCap(FANTASY) }).reason, 'Module limit reached');
  const build = createBuild(today, { cap: placeCap(FIXED) });
  assert.equal(build.place(spot(today)).reason, 'Module limit reached');
  build.setCap(placeCap(FANTASY));
  assert.ok(build.place(spot(today)).ok);
  // Back in fixed past 220, turning a part is still allowed
  build.setCap(placeCap(FIXED));
  assert.notEqual(build.rotate(1).reason, 'Module limit reached');
  // Grow under fantasy goes on the undo stack like any Grow
  const start = createBuild();
  const first = generate({ ...BLOCK, ...generateLimits(FANTASY) }).modules;
  start.replace(first);
  start.replace(growUnder(FANTASY, BLOCK, first).modules);
  assert.ok(start.modules.length > first.length);
  start.undo();
  assert.deepEqual(start.modules, first);
});
