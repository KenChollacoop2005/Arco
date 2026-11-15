import { CLEARANCE_MIN_MM, CLEARANCE_MAX_MM, CLEARANCE_STEP_MM, CONNECTOR_CLEARANCE_MM, STORY_MM } from './config.js';
import { COPY } from './ui/copy.js';
import { setupLegend } from './ui/legend.js';
import { setupGenerate } from './ui/generate.js';
import { createScene } from './render/scene.js';
import { createCameraRig } from './render/camera.js';
import { createModuleView } from './render/modules.js';
import { createDrawing } from './render/drawing.js';
import { createPicker } from './render/picking.js';
import { STATE_NORMAL, STATE_SELECTED } from './render/materials.js';
import { createInspector } from './ui/inspector.js';
import { variantKey } from './core/grid.js';
import { createWorkerClient } from './workers/client.js';

const query = (selector) => document.querySelector(selector);

for (const element of document.querySelectorAll('[data-copy]')) {
  element.textContent = COPY[element.dataset.copy];
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = query('#scene');
const view = createScene(canvas);
const rig = createCameraRig(canvas, reducedMotion);
view.setCamera(rig.camera);
view.onResize((width, height) => rig.resize(width, height));
view.onFrame((delta) => rig.update(delta));
rig.onChange(() => view.requestRender());

setupLegend(query('#legend'), query('#leftPanel'));

const PANE_TITLES = {
  generate: COPY.generateTitle,
  collection: COPY.collectionTitle,
  build: COPY.buildTitle,
  drawing: COPY.drawingTitle,
};

const generator = createWorkerClient(new URL('./workers/generate.worker.js', import.meta.url));
const solids = createWorkerClient(new URL('./workers/solids.worker.js', import.meta.url));
const modules = createModuleView(view, (variants, onPart) =>
  solids.call({ variants, clearance: CONNECTOR_CLEARANCE_MM }, onPart)
);

const checker = createWorkerClient(new URL('./workers/checks.worker.js', import.meta.url));
const inspector = createInspector(query('#inspectorBody'));
const drawing = createDrawing(view, rig, modules, query('#overlay'), query('#titleBlock'));

export const app = {
  view,
  rig,
  modules,
  mode: 'generate',
  reducedMotion,
  structure: null,
  checks: null,
  selection: [],
  modeListeners: [],
  structureListeners: [],
};

const printOf = (instance) => {
  const part = modules.partOf(variantKey(instance));
  return part ? part.print : null;
};

function showInspector() {
  const lastId = app.selection[app.selection.length - 1];
  const selected = app.structure && lastId ? app.structure.modules.find((instance) => instance.id === lastId) : null;
  inspector.render({ structure: app.structure, checks: app.checks, printOf }, selected);
}

// Click selects, shift click adds or removes
function select(id, extend) {
  const keep = extend ? app.selection.filter((selectedId) => selectedId !== id) : [];
  const next = id && !(extend && app.selection.includes(id)) ? [...keep, id] : keep;
  for (const selectedId of app.selection) {
    if (!next.includes(selectedId)) modules.setState(selectedId, STATE_NORMAL);
  }
  for (const selectedId of next) modules.setState(selectedId, STATE_SELECTED);
  app.selection = next;
  showInspector();
}

createPicker(canvas, rig, modules, {
  onPick: select,
  onDouble(id) {
    const box = id ? modules.boxOf(id) : null;
    if (box) rig.frame(box);
    else rig.home(false);
  },
});

app.structureListeners.push(async (result, phase) => {
  if (phase === 'ready') {
    showInspector();
    drawing.update(app.structure, app.checks);
    return;
  }
  app.checks = null;
  app.selection = [];
  showInspector();
  drawing.update(result, null);
  const checks = await checker.call({ modules: result.modules });
  if (app.structure !== result) return;
  app.checks = checks;
  showInspector();
  drawing.update(result, checks);
});

app.modeListeners.push((mode) => {
  drawing.setActive(mode === 'drawing');
  if (mode !== 'drawing' && !query('input[name="drawingView"][value="axon"]').checked) {
    query('input[name="drawingView"][value="axon"]').checked = true;
    rig.setView('axon');
  }
});

for (const input of document.querySelectorAll('input[name="drawingView"]')) {
  input.addEventListener('change', () => rig.setView(input.value));
}
for (const [id, layer] of [['#showLoads', 'loads'], ['#showCenters', 'centers'], ['#showConnectors', 'connectors']]) {
  query(id).addEventListener('change', (event) => drawing.setLayer(layer, event.target.checked));
}

let generateToken = 0;

// Runs the generator and shows the result
async function generateStructure(options) {
  const token = ++generateToken;
  const result = await generator.call({ options });
  if (token !== generateToken) return null;
  app.structure = result;
  const heightMm = Math.max(0, ...result.modules.map((instance) => instance.z + instance.h)) * STORY_MM;
  rig.follow();
  rig.setModelHeight(heightMm, false);
  view.fitLight(heightMm);
  for (const listener of app.structureListeners) listener(result, 'start');
  await modules.setStructure(result.modules, { animate: !reducedMotion && !query('#skipAnimation').checked });
  if (token !== generateToken) return null;
  for (const listener of app.structureListeners) listener(result, 'ready');
  return result;
}

export function setMode(mode) {
  app.mode = mode;
  document.body.dataset.mode = mode;
  query('#leftTitle').textContent = PANE_TITLES[mode];
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  for (const listener of app.modeListeners) listener(mode);
  view.requestRender();
}

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

for (const input of document.querySelectorAll('input[name="projection"]')) {
  input.addEventListener('change', () => {
    rig.setProjection(input.value);
    view.setCamera(rig.camera);
  });
}
query('#resetView').addEventListener('click', () => rig.home(false));

const clearanceInput = query('#clearanceInput');
clearanceInput.min = CLEARANCE_MIN_MM;
clearanceInput.max = CLEARANCE_MAX_MM;
clearanceInput.step = CLEARANCE_STEP_MM;
clearanceInput.value = CONNECTOR_CLEARANCE_MM;

setupGenerate(query('#generateForm'), query('#skipAnimation'), generateStructure);
