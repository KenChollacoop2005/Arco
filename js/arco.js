import { CLEARANCE_MIN_MM, CLEARANCE_MAX_MM, CLEARANCE_STEP_MM, CONNECTOR_CLEARANCE_MM, STORY_MM } from './config.js';
import { COPY } from './ui/copy.js';
import { setupLegend } from './ui/legend.js';
import { setupGenerate } from './ui/generate.js';
import { createScene } from './render/scene.js';
import { createCameraRig } from './render/camera.js';
import { createModuleView } from './render/modules.js';
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

export const app = {
  view,
  rig,
  modules,
  mode: 'generate',
  reducedMotion,
  structure: null,
  modeListeners: [],
  structureListeners: [],
};

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
canvas.addEventListener('dblclick', () => rig.home(false));

const clearanceInput = query('#clearanceInput');
clearanceInput.min = CLEARANCE_MIN_MM;
clearanceInput.max = CLEARANCE_MAX_MM;
clearanceInput.step = CLEARANCE_STEP_MM;
clearanceInput.value = CONNECTOR_CLEARANCE_MM;

setupGenerate(query('#generateForm'), query('#skipAnimation'), generateStructure);
