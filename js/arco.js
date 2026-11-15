import { COPY } from './ui/copy.js';
import { setupLegend } from './ui/legend.js';
import { createScene } from './render/scene.js';
import { createCameraRig } from './render/camera.js';

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

export const app = { view, rig, mode: 'generate', reducedMotion, modeListeners: [] };

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
