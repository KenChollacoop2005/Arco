import { CONNECTOR_CLEARANCE_MM, STORY_MM } from './config.js';
import { COPY } from './ui/copy.js';
import { setupLegend } from './ui/legend.js';
import { setupGenerate } from './ui/generate.js';
import { createScene } from './render/scene.js';
import { createCameraRig } from './render/camera.js';
import { createModuleView } from './render/modules.js';
import { createDrawing } from './render/drawing.js';
import { createSection } from './render/section.js';
import { createDecor } from './render/decor.js';
import { createStrings } from './render/strings.js';
import { createPicker } from './render/picking.js';
import { STATE_NORMAL, STATE_SELECTED } from './render/materials.js';
import { createInspector } from './ui/inspector.js';
import { setupExport } from './ui/exportpanel.js';
import { setupCollection } from './ui/collection.js';
import { setupBuild } from './ui/build.js';
import { setupPhysics } from './ui/physics.js';
import { setupToggles, bindToggle } from './ui/toggles.js';
import { createCollection } from './core/collection.js';
import { growOptions } from './core/build.js';
import { structureHash, variantKey } from './core/grid.js';
import { SECTION_STEPS, sectionShare } from './core/section.js';
import { freezeDeep } from './core/analysis.js';
import { decorItems } from './core/decor.js';
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
const analyst = createWorkerClient(new URL('./workers/analysis.worker.js', import.meta.url));
const inspector = createInspector(query('#inspectorBody'));
const drawing = createDrawing(view, rig, modules, query('#overlay'), query('#titleBlock'));
const section = createSection(view, modules);
const decor = createDecor(view);
const strings = createStrings(view);

export const app = {
  view,
  rig,
  modules,
  mode: 'generate',
  reducedMotion,
  structure: null,
  checks: null,
  analysis: null,
  selection: [],
  fit: null,
  modeListeners: [],
  structureListeners: [],
  analysisListeners: [],
};

// Storage access can throw, so it stays lazy
const browserStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
const collection = createCollection(browserStore);
const collectionPanel = setupCollection(collection);

const printOf = (instance) => {
  const part = modules.partOf(variantKey(instance));
  return part ? part.print : null;
};
const socketsOf = (instance) => {
  const part = modules.partOf(variantKey(instance));
  return part ? part.sockets : null;
};

const saveModule = (instance) => collectionPanel.save(instance, modules.partOf(variantKey(instance)));

function showInspector() {
  const lastId = app.selection[app.selection.length - 1];
  const selected = app.structure && lastId ? app.structure.modules.find((instance) => instance.id === lastId) : null;
  inspector.render({ structure: app.structure, checks: app.checks, printOf, socketsOf, fit: app.fit, onExport: (id) => exporter.exportModules([id]), onSave: saveModule }, selected);
}

// Click selects, shift click adds or removes
function select(id, extend) {
  exporter.closeSteps();
  const keep = extend ? app.selection.filter((selectedId) => selectedId !== id) : [];
  const next = id && !(extend && app.selection.includes(id)) ? [...keep, id] : keep;
  for (const selectedId of app.selection) {
    if (!next.includes(selectedId)) modules.setState(selectedId, STATE_NORMAL);
  }
  for (const selectedId of next) modules.setState(selectedId, STATE_SELECTED);
  app.selection = next;
  showInspector();
}

const picker = createPicker(canvas, rig, modules, {
  onPick(id, extend, event) {
    if (!builder.click(event)) select(id, extend);
  },
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
  section.setStructure(result.modules);
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

// One analysis per structure, read-only for every layer
app.structureListeners.push(async (result, phase) => {
  if (phase !== 'start') return;
  app.analysis = null;
  drawing.setServices(null);
  for (const listener of app.analysisListeners) listener(null, result);
  const analysis = await analyst.call({ modules: result.modules, seed: result.seed }).catch(() => null);
  if (app.structure !== result || !analysis) return;
  app.analysis = freezeDeep(analysis);
  drawing.setServices(app.analysis.flows || null);
  for (const listener of app.analysisListeners) listener(app.analysis, result);
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
for (const [id, layer] of [['#showLoads', 'loads'], ['#showCenters', 'centers'], ['#showConnectors', 'connectors'], ['#showServices', 'services']]) {
  query(id).addEventListener('change', (event) => drawing.setLayer(layer, event.target.checked));
}

let generateToken = 0;
let showToken = 0;

// Puts a structure on the plinth, options.only animates those ids
async function showStructure(result, options = {}) {
  const token = ++showToken;
  app.structure = result;
  const heightMm = Math.max(0, ...result.modules.map((instance) => instance.z + instance.h)) * STORY_MM;
  if (options.follow) rig.follow();
  rig.setModelHeight(heightMm, false);
  view.fitLight(heightMm);
  for (const listener of app.structureListeners) listener(result, 'start');
  await modules.setStructure(result.modules, { animate: !reducedMotion && !query('#skipAnimation').checked, only: options.only });
  if (token !== showToken) return false;
  for (const listener of app.structureListeners) listener(result, 'ready');
  return true;
}

// Runs the generator and shows the result
async function generateStructure(options) {
  const token = ++generateToken;
  const result = await generator.call({ options });
  if (token !== generateToken) return null;
  builder.adopt(result.modules);
  return (await showStructure(result, { follow: true })) ? result : null;
}

// Shows the hand edited build as the structure
function showBuild(list, options = {}) {
  generateToken++;
  const result = { modules: list, seed: COPY.buildSeed, options: null, capped: false, hash: structureHash(list) };
  showStructure(result, { only: options.only || new Set() });
}

// Generator run that keeps every current module
async function growStructure(base) {
  const token = ++generateToken;
  const result = await generator.call({ options: growOptions(generatePanel.readOptions(), base) });
  if (token !== generateToken) return null;
  const known = new Set(base.map((instance) => instance.id));
  const only = new Set(result.modules.filter((instance) => !known.has(instance.id)).map((instance) => instance.id));
  builder.adopt(result.modules);
  showStructure(result, { only });
  return { added: only.size, seed: result.seed };
}

const builder = setupBuild(app, canvas, modules, collectionPanel, {
  show: showBuild,
  grow: growStructure,
  targetAt: (event) => picker.targetAt(event),
});

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
const sectionPosition = query('#sectionPosition');
sectionPosition.max = String(SECTION_STEPS);
const readSection = () => ({
  on: query('#sectionToggle').checked,
  axis: query('input[name="sectionAxis"]:checked').value,
  share: sectionShare(Number(sectionPosition.value)),
});
for (const input of [query('#sectionToggle'), sectionPosition, ...document.querySelectorAll('input[name="sectionAxis"]')]) {
  input.addEventListener('input', () => section.set(readSection()));
}
section.set(readSection());
setupPhysics(app, modules, query('#physicsToggle'));

const toggles = setupToggles();
app.toggles = toggles;
bindToggle(toggles, query('#effectsToggle'), { id: 'effects', on: true, lightOn: false });

// Decor shows on a finished, still structure only
let builtResult = null;
function refreshDecor() {
  const still = app.structure && builtResult === app.structure && app.analysis;
  decor.set(still ? decorItems(app.analysis, app.structure.modules, app.structure.seed) : []);
  decor.setShown(toggles.get('decor') && app.mode !== 'drawing' && !query('#physicsToggle').checked);
}
bindToggle(toggles, query('#decorToggle'), { id: 'decor', on: false });
toggles.watch('decor', refreshDecor);
app.analysisListeners.push(refreshDecor);
app.modeListeners.push(refreshDecor);
app.structureListeners.push((result, phase) => {
  builtResult = phase === 'ready' ? result : null;
  refreshDecor();
});
query('#physicsToggle').addEventListener('change', refreshDecor);

// Strings show on a finished, still structure only
function refreshFlows() {
  const still = app.structure && builtResult === app.structure && app.analysis && app.analysis.flows;
  const services = still ? app.analysis.flows.services : null;
  const { pipes, wires, lines, sheets, laundry, tarps } = services || {};
  strings.set(services ? { ports: app.analysis.flows.ports, pipes, wires, lines, sheets, laundry, tarps } : {}, toggles.light);
  strings.setShown(toggles.get('flows') && app.mode !== 'drawing' && !query('#physicsToggle').checked);
}
bindToggle(toggles, query('#flowsToggle'), { id: 'flows', on: false });
toggles.watch('flows', refreshFlows);
app.analysisListeners.push(refreshFlows);
app.modeListeners.push(refreshFlows);
app.structureListeners.push(() => refreshFlows());
query('#physicsToggle').addEventListener('change', refreshFlows);

query('#resetView').addEventListener('click', () => rig.home(false));

const exportWorker = createWorkerClient(new URL('./workers/export.worker.js', import.meta.url));
const exporter = setupExport(app, exportWorker, (fit) => {
  app.fit = fit;
  showInspector();
});

const generatePanel = setupGenerate(query('#generateForm'), query('#skipAnimation'), generateStructure);
