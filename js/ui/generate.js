import { normalizeOptions, openingOptions, categoryList } from '../core/generator.js';
import { CATEGORIES, UTILITIES } from '../core/catalog.js';
import { randomSeedText } from '../core/rng.js';
import { COPY } from './copy.js';
import { readSetting, writeSetting } from './legend.js';
import { BUDGET_HARD_CAP, BUDGET_CUSTOM_MIN, BUDGET_CUSTOM_DEFAULT, FANTASY_GROW } from '../config.js';
import { makeBudget, budgetCap, generateLimits, budgetParams, budgetFromParams } from '../core/budget.js';

const SKIP_KEY = 'arco.skipAnimation'; // remembered animation setting
const URL_KEYS = { scale: 'scale', density: 'density', height: 'height', daring: 'cantilevers', theme: 'theme', services: 'services' };

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('seed')) return null;
  const options = { seed: params.get('seed'), unstable: params.get('unstable') === '1' };
  // Old links have no categories: all on; utilities has its own field, on unless 0
  const themes = CATEGORIES.filter((name) => name !== UTILITIES);
  const named = params.has('cats') ? params.get('cats').split(',').filter((name) => themes.includes(name)) : themes;
  options.categories = params.get(UTILITIES) === '0' ? named : [...named, UTILITIES];
  for (const [field, name] of Object.entries(URL_KEYS)) {
    if (params.has(name)) options[field] = params.get(name);
  }
  return { options: normalizeOptions(options), budget: budgetFromParams((name) => params.get(name)) };
}

function writeUrl(options, budget) {
  const params = new URLSearchParams();
  params.set('seed', options.seed);
  for (const [field, name] of Object.entries(URL_KEYS)) params.set(name, options[field]);
  if (options.unstable) params.set('unstable', '1');
  const themesOn = options.categories.filter((name) => name !== UTILITIES);
  if (themesOn.length < CATEGORIES.length - 1) params.set('cats', themesOn.join(','));
  if (!options.categories.includes(UTILITIES)) params.set(UTILITIES, '0');
  for (const [name, value] of Object.entries(budgetParams(budget))) params.set(name, value);
  window.history.replaceState(null, '', '?' + params.toString());
}

// generate(options) returns a promise of the result
export function setupGenerate(form, skipInput, generate) {
  const status = form.querySelector('#generateStatus');
  const button = form.querySelector('#generateButton');
  const seedInput = form.querySelector('#seedInput');
  const capInput = form.querySelector('#budgetCap');
  const countLine = form.querySelector('#budgetCount');
  const budgetListeners = [];
  let shownCount = 0;
  capInput.min = BUDGET_CUSTOM_MIN;
  capInput.max = BUDGET_HARD_CAP;
  capInput.value = BUDGET_CUSTOM_DEFAULT;

  function readBudget() {
    return makeBudget({ mode: new FormData(form).get('budgetMode'), cap: capInput.value });
  }

  function writeBudget(budget) {
    form.querySelector(`input[name="budgetMode"][value="${budget.mode}"]`).checked = true;
    if (budget.mode === 'custom') capInput.value = budget.cap;
  }

  // Modules against the cap, draft copy
  function showCount(count) {
    shownCount = count;
    const budget = readBudget();
    const parts = [`${count} ${COPY.budgetOf} ${budgetCap(budget)} ${COPY.modules.toLowerCase()}`];
    if (budget.mode === 'fantasy') parts.push(`${COPY.budgetGrows} ${FANTASY_GROW[0]} ${COPY.budgetTo} ${FANTASY_GROW[1]}`);
    countLine.textContent = parts.join(', ');
  }

  function budgetChanged() {
    writeBudget(readBudget());
    showCount(shownCount);
    for (const listener of budgetListeners) listener(readBudget());
  }
  for (const input of form.querySelectorAll('input[name="budgetMode"]')) input.addEventListener('change', budgetChanged);
  capInput.addEventListener('change', budgetChanged);

  function readForm() {
    const data = new FormData(form);
    return normalizeOptions({
      seed: (data.get('seed') || '').trim() || randomSeedText(),
      scale: data.get('scale'),
      density: data.get('density'),
      height: data.get('height'),
      daring: data.get('daring'),
      theme: data.get('theme'),
      services: data.get('services'),
      categories: categoryList(data.getAll('cat')),
      unstable: data.get('unstable') === 'on',
    });
  }

  function writeForm(options) {
    seedInput.value = options.seed;
    for (const name of ['scale', 'density', 'height', 'daring', 'services']) {
      const input = form.querySelector(`input[name="${name}"][value="${options[name]}"]`);
      if (input) input.checked = true;
    }
    form.querySelector('#allowUnstable').checked = !!options.unstable;
    form.querySelector('input[name="theme"]').value = options.theme;
    for (const input of form.querySelectorAll('input[name="cat"]')) input.checked = options.categories.includes(input.value);
  }

  async function run(options, keepUrl, budget = makeBudget()) {
    button.disabled = true;
    status.textContent = COPY.generating;
    try {
      const result = await generate({ ...options, ...generateLimits(budget) });
      if (!result) return;
      if (keepUrl) writeUrl(result.options, budget);
      const notes = [`${result.modules.length} ${COPY.modules.toLowerCase()}`];
      if (result.capped && !options.budget) notes.push(budget.mode === 'fixed' ? COPY.limitReached : COPY.budgetReached);
      if (options.unstable) notes.push(COPY.unstableNote);
      status.textContent = notes.join('. ');
    } catch {
      status.textContent = COPY.loadFailed;
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const options = readForm();
    seedInput.value = options.seed;
    run(options, true, readBudget());
  });
  form.querySelector('#newSeed').addEventListener('click', () => {
    seedInput.value = randomSeedText();
    run(readForm(), true, readBudget());
  });

  skipInput.checked = readSetting(SKIP_KEY, 'off') === 'on';
  skipInput.addEventListener('change', () => writeSetting(SKIP_KEY, skipInput.checked ? 'on' : 'off'));

  const shared = readUrl();
  if (shared) {
    writeForm(shared.options);
    writeBudget(shared.budget);
    run(shared.options, true, shared.budget);
  } else {
    const seed = randomSeedText();
    seedInput.value = seed;
    run(openingOptions(seed), false);
  }
  return { readOptions: readForm, readBudget, showCount, onBudget: (listener) => budgetListeners.push(listener) };
}
