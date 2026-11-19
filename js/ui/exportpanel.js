import { CLEARANCE_MIN_MM, CLEARANCE_MAX_MM, CLEARANCE_STEP_MM, CONNECTOR_CLEARANCE_MM } from '../config.js';
import { FAMILIES } from '../core/catalog.js';
import { STATE_NORMAL, STATE_SELECTED, STATE_GHOST, STATE_INVALID, STATE_HIDDEN, STATE_HIGHLIGHT } from '../render/materials.js';
import { COPY } from './copy.js';
import { readSetting, writeSetting } from './legend.js';

const CLEARANCE_KEY = 'arco.clearance'; // remembered clearance setting
const SEED_NAME_MAX = 24; // longest seed used in a file name

const query = (selector) => document.querySelector(selector);

export function download(file) {
  const link = document.createElement('a');
  const address = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
  link.href = address;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(address), 0);
}

function readClearance(input) {
  const typed = Number(input.value);
  const safe = Number.isFinite(typed) ? Math.min(CLEARANCE_MAX_MM, Math.max(CLEARANCE_MIN_MM, typed)) : CONNECTOR_CLEARANCE_MM;
  return Math.round(safe / CLEARANCE_STEP_MM) * CLEARANCE_STEP_MM;
}

// Print drawer: exports, fit coupon and assembly steps
export function setupExport(app, worker, onFit) {
  const status = query('#exportStatus');
  const input = query('#clearanceInput');
  const bar = query('#assemblyBar');
  const count = query('#assemblyCount');
  let steps = null;
  let step = 0;

  input.min = CLEARANCE_MIN_MM;
  input.max = CLEARANCE_MAX_MM;
  input.step = CLEARANCE_STEP_MM;
  input.value = readSetting(CLEARANCE_KEY, String(CONNECTOR_CLEARANCE_MM));
  const clearance = () => readClearance(input);

  async function measureFit() {
    onFit(null);
    onFit(await worker.call({ kind: 'fit', clearance: clearance() }));
  }
  input.addEventListener('change', () => {
    input.value = clearance().toFixed(2);
    writeSetting(CLEARANCE_KEY, input.value);
    measureFit();
  });
  input.value = clearance().toFixed(2);
  measureFit();

  // Resolves with the status text it showed
  async function run(payload) {
    status.textContent = COPY.exportWorking;
    try {
      const result = await worker.call(payload);
      if (result.file) download(result.file);
      const skipped = result.oversize ? `, ${result.oversize} ${COPY.exportOversize}` : '';
      const plates = `${result.plates} ${result.plates === 1 ? COPY.plate : COPY.plates}`;
      const pegs = `${result.pegs} ${result.pegs === 1 ? COPY.peg : COPY.pegs}`;
      status.textContent = `${plates}, ${pegs}${skipped}`;
    } catch {
      status.textContent = COPY.loadFailed;
    }
    return status.textContent;
  }

  // ids null exports everything; modules may be given instead of ids
  function exportModules(ids, given = null) {
    if (!app.structure && !given) return Promise.resolve('');
    const modules = given || (ids ? app.structure.modules.filter((instance) => ids.includes(instance.id)) : app.structure.modules);
    if (modules.length === 0) {
      status.textContent = COPY.exportNothing;
      return Promise.resolve(status.textContent);
    }
    const seed = String(given ? COPY.collectionTitle : app.structure.seed).replace(/[^a-z0-9]+/gi, '-').slice(0, SEED_NAME_MAX) || 'structure';
    const part = modules.length === 1 ? `-${modules[0].family}-${modules[0].id}` : ids ? '-selection' : '';
    return run({ kind: 'structure', modules, clearance: clearance(), name: `arco-${seed}${part}` });
  }

  query('#exportModule').addEventListener('click', () => exportModules(app.selection.slice(-1)));
  query('#exportSelected').addEventListener('click', () => exportModules(app.selection));
  query('#exportAll').addEventListener('click', () => exportModules(null));
  query('#exportCoupon').addEventListener('click', () => run({ kind: 'coupon', clearance: clearance() }));

  function showStep() {
    const current = steps[step];
    steps.forEach((entry, index) => {
      const state = index < step ? STATE_NORMAL : index === step ? STATE_HIGHLIGHT : index === step + 1 ? STATE_GHOST : STATE_HIDDEN;
      app.modules.setState(entry.id, state);
    });
    const instance = app.structure.modules.find((entry) => entry.id === current.id);
    count.textContent = `${COPY.assemblyStep} ${step + 1} ${COPY.assemblyOf} ${steps.length}: ${FAMILIES[instance.family].label}`;
    query('#assemblyPrev').disabled = step === 0;
    query('#assemblyNext').disabled = step === steps.length - 1;
  }

  function closeSteps() {
    if (!steps) return;
    for (const entry of steps) app.modules.setState(entry.id, app.selection.includes(entry.id) ? STATE_SELECTED : STATE_NORMAL);
    steps = null;
    bar.hidden = true;
  }

  query('#assemblyOpen').addEventListener('click', async () => {
    if (!app.structure || app.structure.modules.length === 0) return;
    const structure = app.structure;
    const result = await worker.call({ kind: 'steps', modules: structure.modules });
    if (structure !== app.structure) return;
    if (!result.ok) {
      const blocked = structure.modules.find((instance) => instance.id === result.blocked[0].id);
      for (const entry of result.blocked) app.modules.setState(entry.id, STATE_INVALID);
      status.textContent = `${COPY.assemblyBlocked} ${FAMILIES[blocked.family].label}`;
      return;
    }
    steps = result.steps;
    step = 0;
    bar.hidden = false;
    showStep();
  });
  query('#assemblyPrev').addEventListener('click', () => {
    if (steps && step > 0) step--;
    if (steps) showStep();
  });
  query('#assemblyNext').addEventListener('click', () => {
    if (steps && step < steps.length - 1) step++;
    if (steps) showStep();
  });
  query('#assemblyClose').addEventListener('click', closeSteps);
  app.structureListeners.push((result, phase) => {
    if (phase === 'start') {
      steps = null;
      bar.hidden = true;
      status.textContent = '';
    }
  });

  return { exportModules, closeSteps, clearance, status };
}
