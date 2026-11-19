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
import { STATE_NORMAL, STATE_SELECTED, sharedUniforms } from './render/materials.js';
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
import { drawnPorts } from './core/services.js';
import { streamFrom } from './core/stream.js';
import { createWaterworks } from './render/waterworks.js';
import { growLimits, placeCap } from './core/budget.js';
import { setupDrawers } from './ui/drawers.js';
import { setupGrowTool } from './ui/growtool.js';
import { createZone } from './render/zone.js';

const query = (selector) => document.querySelector(selector);

for (const element of document.querySelectorAll('[data-copy]')) {
  element.textContent = COPY[element.dataset.copy];
}
for (const element of document.querySelectorAll('[data-copy-title]')) {
  element.title = COPY[element.dataset.copyTitle];
}
for (const element of document.querySelectorAll('[data-copy-placeholder]')) {
  element.placeholder = COPY[element.dataset.copyPlaceholder];
}
setupDrawers();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = query('#scene');
const view = createScene(canvas);
const rig = createCameraRig(canvas, reducedMotion);
view.setCamera(rig.camera);
view.onResize((width, height) => rig.resize(width, height));
view.onFrame((delta) => rig.update(delta));
rig.onChange(() => view.requestRender());

setupLegend(query('#legend'));

const MODES = ['generate', 'collection', 'drawing']; // top bar tabs

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
const waterworks = createWaterworks(view);
const SPINNING = ['turbine', 'wheel', 'wheelup']; // families that turn with Effects on

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

const selectedModule = () => {
  const lastId = app.selection[app.selection.length - 1];
  return app.structure && lastId ? app.structure.modules.find((instance) => instance.id === lastId) || null : null;
};

function showInspector() {
  const selected = selectedModule();
  inspector.render({ structure: app.structure, checks: app.checks, flows: app.analysis && app.analysis.flows, walking: app.analysis && app.analysis.walking, printOf, socketsOf, fit: app.fit }, selected);
  query('#printSave').disabled = !selected;
  query('#exportModule').disabled = !selected;
  query('#exportSelected').disabled = app.selection.length === 0;
  query('#exportAll').disabled = !app.structure || app.structure.modules.length === 0;
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
    if (growTool.click(event) || builder.click(event)) return;
    select(id, extend);
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
  const flows = app.analysis.flows;
  if (flows) {
    const shown = new Set(drawnPorts(flows.ports, flows.services));
    drawing.setServices(flows.services, flows.ports.filter((port) => port.active !== false && !shown.has(port)));
  } else drawing.setServices(null);
  showInspector();
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
app.analysisListeners.push(() => drawing.setWalking(app.analysis && app.analysis.walking ? app.analysis.walking.lines : null));
for (const [id, layer] of [['#showLoads', 'loads'], ['#showCenters', 'centers'], ['#showConnectors', 'connectors'], ['#showServices', 'services'], ['#showWalking', 'walking']]) {
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
  app.stream = result.stream;
  builder.adopt(result.modules, streamFrom(result.stream));
  return (await showStructure(result, { follow: true })) ? result : null;
}

// Shows the hand edited build as the structure
function showBuild(list, options = {}) {
  generateToken++;
  const result = { modules: list, seed: COPY.buildSeed, options: null, capped: false, hash: structureHash(list), stream: app.stream || null };
  showStructure(result, { only: options.only || new Set() });
}

// Generator run that keeps every current module; a zone limits new ones
async function growStructure(base, zone = null) {
  const token = ++generateToken;
  const choices = generatePanel.readOptions();
  const result = await generator.call({ options: { ...growOptions(choices, base, zone), ...growLimits(generatePanel.readBudget(), choices.seed, base.length) } });
  if (token !== generateToken) return null;
  const known = new Set(base.map((instance) => instance.id));
  const only = new Set(result.modules.filter((instance) => !known.has(instance.id)).map((instance) => instance.id));
  app.stream = result.stream;
  builder.adopt(result.modules, streamFrom(result.stream));
  showStructure(result, { only });
  return { added: only.size, seed: result.seed };
}

const builder = setupBuild(app, canvas, modules, collectionPanel, {
  show: showBuild,
  grow: growStructure,
  targetAt: (event) => picker.targetAt(event),
});
const growTool = setupGrowTool(app, canvas, { pointAt: (event, back) => picker.pointAt(event, back), zone: createZone(view), builder });

export function setMode(next) {
  const mode = MODES.includes(next) ? next : 'generate';
  app.mode = mode;
  document.body.dataset.mode = mode;
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

// Effects turn and flow; reduced motion stays still
function applyEffects() {
  sharedUniforms.uEffects.value = toggles.get('effects') && !reducedMotion ? 1 : 0;
  view.requestRender();
}
toggles.watch('effects', applyEffects);
applyEffects();
view.onFrame(() => sharedUniforms.uEffects.value > 0 && (waterworks.flowing() || strings.flowing() || (!!app.structure && app.structure.modules.some((instance) => SPINNING.includes(instance.family)))));

// Stream, pours and junction boxes follow the structure and its analysis
app.structureListeners.push((result, phase) => {
  if (phase !== 'start') return;
  waterworks.setStream(result.stream || null);
  waterworks.setPours([]);
});
app.analysisListeners.push(() => waterworks.setBoxes(app.analysis && app.analysis.flows ? app.analysis.flows.ports : []));
app.analysisListeners.push(() => waterworks.setPours(app.analysis && app.analysis.flows ? app.analysis.flows.pours || [] : []));
app.modeListeners.push(() => waterworks.setShown(app.mode !== 'drawing'));

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
  strings.set(services ? { ports: drawnPorts(app.analysis.flows.ports, services), pipes, wires, lines, sheets, laundry, tarps } : {}, toggles.light);
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
query('#printSave').addEventListener('click', () => {
  const selected = selectedModule();
  if (selected) saveModule(selected);
});

const generatePanel = setupGenerate(query('#generateForm'), query('#skipAnimation'), generateStructure);
// Budget: Build's cap and the module count follow the control
const syncBudget = (budget) => {
  builder.setCap(placeCap(budget));
  generatePanel.showCount(app.structure ? app.structure.modules.length : 0);
};
generatePanel.onBudget(syncBudget);
syncBudget(generatePanel.readBudget());
app.structureListeners.push((result, phase) => {
  if (phase === 'ready') generatePanel.showCount(result.modules.length);
});
