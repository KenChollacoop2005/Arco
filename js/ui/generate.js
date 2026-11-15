import { normalizeOptions, openingOptions } from '../core/generator.js';
import { randomSeedText } from '../core/rng.js';
import { COPY } from './copy.js';
import { readSetting, writeSetting } from './legend.js';

const SKIP_KEY = 'arco.skipAnimation'; // remembered animation setting
const URL_KEYS = { scale: 'scale', density: 'density', height: 'height', daring: 'cantilevers', theme: 'theme' };

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('seed')) return null;
  const options = { seed: params.get('seed'), unstable: params.get('unstable') === '1' };
  for (const [field, name] of Object.entries(URL_KEYS)) {
    if (params.has(name)) options[field] = params.get(name);
  }
  return normalizeOptions(options);
}

function writeUrl(options) {
  const params = new URLSearchParams();
  params.set('seed', options.seed);
  for (const [field, name] of Object.entries(URL_KEYS)) params.set(name, options[field]);
  if (options.unstable) params.set('unstable', '1');
  window.history.replaceState(null, '', '?' + params.toString());
}

// generate(options) returns a promise of the result
export function setupGenerate(form, skipInput, generate) {
  const status = form.querySelector('#generateStatus');
  const button = form.querySelector('#generateButton');
  const seedInput = form.querySelector('#seedInput');

  function readForm() {
    const data = new FormData(form);
    return normalizeOptions({
      seed: (data.get('seed') || '').trim() || randomSeedText(),
      scale: data.get('scale'),
      density: data.get('density'),
      height: data.get('height'),
      daring: data.get('daring'),
      theme: data.get('theme'),
      unstable: data.get('unstable') === 'on',
    });
  }

  function writeForm(options) {
    seedInput.value = options.seed;
    for (const name of ['scale', 'density', 'height', 'daring', 'theme']) {
      const input = form.querySelector(`input[name="${name}"][value="${options[name]}"]`);
      if (input) input.checked = true;
    }
    form.querySelector('#allowUnstable').checked = !!options.unstable;
  }

  async function run(options, keepUrl) {
    button.disabled = true;
    status.textContent = COPY.generating;
    try {
      const result = await generate(options);
      if (!result) return;
      if (keepUrl) writeUrl(result.options);
      const notes = [`${result.modules.length} ${COPY.modules.toLowerCase()}`];
      if (result.capped && !options.budget) notes.push(COPY.limitReached);
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
    run(options, true);
  });
  form.querySelector('#newSeed').addEventListener('click', () => {
    seedInput.value = randomSeedText();
    run(readForm(), true);
  });

  skipInput.checked = readSetting(SKIP_KEY, 'off') === 'on';
  skipInput.addEventListener('change', () => writeSetting(SKIP_KEY, skipInput.checked ? 'on' : 'off'));

  const shared = readUrl();
  if (shared) {
    writeForm(shared);
    run(shared, true);
  } else {
    const seed = randomSeedText();
    seedInput.value = seed;
    run(openingOptions(seed), false);
  }
}
