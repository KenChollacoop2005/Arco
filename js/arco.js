import { CONNECTOR_CLEARANCE_MM, STORY_MM, TIMES, WINDOW_GLOW } from './config.js';
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
import { STATE_NORMAL, STATE_SELECTED, STATE_HIGHLIGHT, sharedUniforms } from './render/materials.js';
import * as THREE from '../vendor/three/three.module.min.js';
import { createInspector } from './ui/inspector.js';
import { setupExport } from './ui/exportpanel.js';
import { setupCollection } from './ui/collection.js';
import { confirmAt } from './ui/confirm.js';
import { setupBuild } from './ui/build.js';
import { setupPhysics } from './ui/physics.js';
import { setupToggles, bindToggle } from './ui/toggles.js';
import { createCollection } from './core/collection.js';
import { growOptions, grownIds } from './core/build.js';
import { structureHash, variantKey } from './core/grid.js';
import { SECTION_STEPS, sectionShare } from './core/section.js';
import { freezeDeep } from './core/analysis.js';
import { decorItems } from './core/decor.js';
import { createWorkerClient } from './workers/client.js';
import { drawnPorts } from './core/services.js';
import { streamFrom } from './core/stream.js';
import { createWaterworks } from './render/waterworks.js';
import { createNightLights } from './render/nightlights.js';
import { createParticles } from './render/particles.js';
import { warmUp } from './render/warmup.js';
import { growLimits, placeCap } from './core/budget.js';
import { setupDrawers } from './ui/drawers.js';
import { setupGrowTool } from './ui/growtool.js';
import { createZone } from './render/zone.js';
import { createShowroom } from './render/showroom.js';
import { setupArchive } from './ui/archive.js';
import { readSetting, writeSetting } from './ui/legend.js';
import { openingOptions } from './core/generator.js';
import { randomSeedText } from './core/rng.js';
import { setupSlideovers } from './ui/slideover.js';
import { createResidentMarks } from './render/residents.js';
import { createHighlight } from './render/highlight.js';
import { setupResidents } from './ui/residents.js';
import { setupResidentPanel } from './ui/residentpanel.js';
import { createRagdoll } from './ui/ragdoll.js';
import { createResidentStore } from './core/roster.js';
import { setupResidentArchive } from './ui/residentarchive.js';
import { setupPuzzle } from './ui/puzzle.js';
import { setupScoreTab } from './ui/scoretab.js';
import { setupResults } from './ui/results.js';
import { createPuzzleStore } from './core/puzzlestore.js';
import { easternDate } from './core/daily.js';
import { layoutOf } from './core/puzzleplay.js';

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

const MODES = ['generate', 'puzzle', 'collection', 'drawing']; // top bar tabs
const MODE_SETTING = 'arco.mode'; // tab open at the last visit
const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead
const PIN_HIT_PX = 12; // right-click reach around a resident pin
const RIGHT_CLICK_SLOP_PX = 5; // a right press that moves further is a pan

const generator = createWorkerClient(new URL('./workers/generate.worker.js', import.meta.url));
const solids = createWorkerClient(new URL('./workers/solids.worker.js', import.meta.url));
const modules = createModuleView(view, (variants, onPart) =>
  solids.call({ variants, clearance: CONNECTOR_CLEARANCE_MM }, onPart)
);

const checker = createWorkerClient(new URL('./workers/checks.worker.js', import.meta.url));
const analyst = createWorkerClient(new URL('./workers/analysis.worker.js', import.meta.url));
const inspector = createInspector(query('#inspectorBody'));
// Module shaders compile while the first structure is still in the workers
warmUp(view, rig.camera, modules.warm);
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
  selectListeners: [],
};

// Storage access can throw, so it stays lazy
const browserStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
const collection = createCollection(browserStore);
const collectionPanel = setupCollection(collection);
collectionPanel.useParts(modules);

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

// Duplicate reads Unselect while a copy is held
function refreshDuplicate() {
  const button = query('#duplicateModule');
  const holding = builder.duplicating();
  button.textContent = holding ? COPY.unselect : COPY.duplicate;
  button.disabled = !holding && !selectedModule();
}

function showInspector() {
  const selected = selectedModule();
  inspector.render({ anchored: !!selected && app.mode === 'puzzle' && builder.isLocked(selected.id), structure: app.structure, checks: app.checks, flows: app.analysis && app.analysis.flows, walking: app.analysis && app.analysis.walking, lights: app.analysis && app.analysis.lights, printOf, socketsOf, fit: app.fit }, selected);
  query('#saveModule').disabled = !selected;
  // Puzzle anchors can be looked at but not turned or returned
  const anchored = !!selected && app.mode === 'puzzle' && builder.isLocked(selected.id);
  for (const id of ['#buildRotate', '#buildDelete', '#buildReturn']) query(id).disabled = !selected || anchored;
  query('#actionNote').hidden = !anchored;
  query('#actionNote').textContent = anchored ? COPY.anchorNote : '';
  refreshDuplicate();
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
  if (next.length === 0) builder.endDuplicate();
  showInspector();
  for (const listener of app.selectListeners) listener(next);
}

const picker = createPicker(canvas, rig, modules, {
  onPick(id, extend, event) {
    if (growTool.click(event) || residentPanel.click(id) || builder.click(event)) return;
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

// The action box follows the mode, anchors only lock in puzzles
app.modeListeners.push(() => showInspector());
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
  // A puzzle's services follow its seed, as when it is scored
  const result = { modules: list, seed: app.puzzle ? app.puzzle.seed : COPY.buildSeed, options: null, capped: false, hash: structureHash(list), stream: app.stream || null };
  showStructure(result, { only: options.only || new Set() });
}

// Generator run that keeps every current module; a zone limits new ones
// A zone that only cleared clutter changes nothing and leaves no undo step
async function growStructure(base, zone = null, removed = []) {
  const token = ++generateToken;
  const choices = generatePanel.readOptions();
  const result = await generator.call({ options: { ...growOptions(choices, base, zone), ...growLimits(generatePanel.readBudget(), choices.seed, base.length) } });
  if (token !== generateToken) return null;
  const only = grownIds(base, result.modules, removed);
  if (!only) return { added: 0, seed: result.seed, skipped: true };
  app.stream = result.stream;
  builder.adopt(result.modules, streamFrom(result.stream));
  showStructure(result, { only });
  return { added: only.size, seed: result.seed };
}

const builder = setupBuild(app, canvas, modules, collectionPanel, {
  show: showBuild,
  grow: growStructure,
  targetAt: (event) => picker.targetAt(event),
  rayAt: (event) => picker.rayAt(event),
  idAt: (event) => picker.idAt(event),
  moved: (id, instance) => residents.follow(id, instance),
});
setupSlideovers(app);
const growTool = setupGrowTool(app, canvas, { pointAt: (event, back) => picker.pointAt(event, back), zone: createZone(view), builder });

export function setMode(next) {
  const mode = MODES.includes(next) ? next : 'generate';
  app.mode = mode;
  writeSetting(MODE_SETTING, mode);
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

// Perspective box in Show; orthographic when off
query('#perspectiveToggle').addEventListener('change', (event) => {
  rig.setProjection(event.target.checked ? 'persp' : 'ortho');
  view.setCamera(rig.camera);
});
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

// Time of day: light only, never power, water or checks
const nightLights = createNightLights(view, toggles.light);
let timeOfDay = TIMES[0];
let lightMotion = false;
function applyTime() {
  timeOfDay = TIMES[Number(query('#timeOfDay').value)] || TIMES[0];
  document.body.dataset.time = timeOfDay;
  view.setTime(timeOfDay);
  sharedUniforms.uGlow.value = WINDOW_GLOW[timeOfDay];
  nightLights.setTime(timeOfDay);
}
query('#timeOfDay').addEventListener('input', applyTime);
applyTime();

// Windows, lamps and beacons follow each module's power
function refreshLights() {
  const plan = app.analysis && app.analysis.lights;
  const still = plan && app.structure && builtResult === app.structure;
  modules.setLights(new Map(plan ? Object.entries(plan.modules).map(([id, entry]) => [Number(id), entry.window]) : []));
  nightLights.set(still ? plan : null);
  nightLights.setShown(app.mode !== 'drawing' && !query('#physicsToggle').checked);
  lightMotion = !!plan && (Object.values(plan.modules).some((entry) => entry.window[1] > 0) || plan.beacons.some((beacon) => beacon.lit));
}
app.analysisListeners.push(refreshLights);
app.modeListeners.push(refreshLights);
app.structureListeners.push(() => refreshLights());
query('#physicsToggle').addEventListener('change', refreshLights);
view.onFrame(() => lightMotion && sharedUniforms.uEffects.value > 0 && (sharedUniforms.uGlow.value > 0 || (!!app.analysis && app.analysis.lights.beacons.some((beacon) => beacon.lit))));

// Smoke, steam and droplets: Effects on, still structure, not Drawing
const particles = createParticles(view, toggles.light);
function refreshParticles() {
  const still = app.analysis && app.structure && builtResult === app.structure;
  particles.set(still ? app.analysis.emitters : null, still ? waterworks.falls() : []);
  particles.setShown(sharedUniforms.uEffects.value > 0 && app.mode !== 'drawing' && !query('#physicsToggle').checked);
}
app.analysisListeners.push(refreshParticles);
app.modeListeners.push(refreshParticles);
app.structureListeners.push(() => refreshParticles());

// Residents: pins and scores from their own worker
const residentMarks = createResidentMarks(view, reducedMotion);
const traitHighlight = createHighlight(view);
const scorer = createWorkerClient(new URL('./workers/analysis.worker.js', import.meta.url));
// In a puzzle the shared puzzle rules score the layout, ids mapped both ways
async function scoreResidents(payload) {
  const puzzle = app.puzzle;
  if (!puzzle) return scorer.call({ kind: 'residents', ...payload });
  const { layout, toLayout, fromLayout } = layoutOf(payload.modules, payload.assignments, puzzle.site);
  const preview = payload.preview ? { resident: payload.preview.resident, homes: payload.preview.homes.map((home) => toLayout.get(home) || home) } : null;
  const report = await scorer.call({ kind: 'puzzle', puzzle, layout, preview });
  const back = (home) => (home === null ? null : fromLayout.get(home) || home);
  const previews = Object.fromEntries(Object.entries(report.previews).map(([home, value]) => [back(Number(home)), value]));
  const evaluations = report.evaluations.map((entry) => ({ ...entry, home: back(entry.home) }));
  return { ...report, puzzle, layout, evaluations, previews, points: report.score ? report.score.points : 0, raw: report.score ? report.score.raw : 0 };
}
const residents = setupResidents(app, { marks: residentMarks, scorer: scoreResidents });
app.residents = residents;
const ragdoll = createRagdoll(reducedMotion);
const residentPanel = setupResidentPanel(app, residents, {
  select: (id) => select(id, false),
  face: (id) => {
    const box = modules.boxOf(id);
    if (box) rig.face(box);
  },
  idAt: (event) => picker.idAt(event),
  setState: (id, state) => modules.setState(id, state),
  canvas,
  // Trait focus: modules lit up, plus level lines, light rings and routes
  focus: (focus) => {
    traitHighlight.set(focus);
    const lit = new Set(focus ? focus.modules : []);
    for (const instance of app.structure ? app.structure.modules : []) modules.setState(instance.id, lit.has(instance.id) ? STATE_HIGHLIGHT : app.selection.includes(instance.id) ? STATE_SELECTED : STATE_NORMAL);
  },
  // Carrying a resident: the pin hides and the figure hangs from the cursor
  carry: (record) => {
    residents.hide(record.id);
    ragdoll.start(residents.figureOf(record), record.looks);
  },
  drop: () => {
    residents.hide(null);
    ragdoll.stop();
  },
  // Save resident: kept in the Collection's Residents section
  save: (record) => {
    const result = residentStore.add(record);
    residentArchive.refresh();
    if (!result.stored) return COPY.residentStoreFull;
    return result.added ? COPY.residentSaved : COPY.residentAlreadySaved;
  },
});

// Right-click picks up a resident by their pin, or a placed module; a right-drag pans instead
let rightDown = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 2) rightDown = [event.clientX, event.clientY];
});
// Housed resident whose pin is under the pointer
function pinAt(event) {
  const rect = canvas.getBoundingClientRect();
  let best = null;
  for (const spot of residents.pinSpots()) {
    const ndc = new THREE.Vector3(...spot.point).project(rig.camera);
    const gap = Math.hypot(rect.left + ((ndc.x + 1) / 2) * rect.width - event.clientX, rect.top + ((1 - ndc.y) / 2) * rect.height - event.clientY);
    if (gap <= PIN_HIT_PX && (!best || gap < best.gap)) best = { id: spot.id, gap };
  }
  return best ? best.id : null;
}
canvas.addEventListener('contextmenu', (event) => {
  const start = rightDown;
  rightDown = null;
  if (builder.holding() || residentPanel.placing() !== null || app.mode === 'drawing' || app.mode === 'collection') return;
  if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > RIGHT_CLICK_SLOP_PX) return;
  const pin = pinAt(event);
  if (pin !== null && residentPanel.move(pin)) {
    event.stopPropagation();
    return;
  }
  const id = picker.idAt(event);
  if (id && builder.lift(id)) event.stopPropagation();
});

// Layer shaders compile while the first build animation plays
let layersWarm = false;
app.structureListeners.push((result, phase) => {
  if (layersWarm || phase !== 'start') return;
  layersWarm = true;
  warmUp(view, rig.camera, [...strings.warm, ...waterworks.warm, ...particles.warm, ...nightLights.warm, ...decor.warm, ...residentMarks.warm]);
});
query('#physicsToggle').addEventListener('change', refreshParticles);
toggles.watch('effects', refreshParticles);
view.onFrame(() => particles.moving());

// Home resets the view, like a double click on empty space
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Home' || app.mode === 'collection' || TYPING_TAGS.includes(event.target.tagName)) return;
  event.preventDefault();
  rig.home(false);
});

const exportWorker = createWorkerClient(new URL('./workers/export.worker.js', import.meta.url));
const exporter = setupExport(app, exportWorker, (fit) => {
  app.fit = fit;
  showInspector();
});
// Action box: Save to the Collection, or Duplicate as the placement tool
query('#saveModule').addEventListener('click', () => {
  const selected = selectedModule();
  if (selected) saveModule(selected);
});
query('#duplicateModule').addEventListener('click', () => {
  // Unselect drops the copy and the selection
  if (builder.duplicating()) {
    select(null, false);
    return;
  }
  const selected = selectedModule();
  if (!selected) return;
  if (app.mode !== 'generate' && app.mode !== 'puzzle') setMode(app.world === 'sandbox' ? 'generate' : 'puzzle');
  builder.duplicate(selected);
});
builder.onDuplicate(refreshDuplicate);

// Collection page; Place in Build picks the module up on the main screen
const showroom = createShowroom(query('#showroom'), reducedMotion);
const residentStore = createResidentStore(browserStore);
residentStore.load();
const archive = setupArchive(app, {
  collectionPanel,
  moduleView: modules,
  showroom,
  residentCount: () => residentStore.list().length,
  onModule: () => residentArchive.leave(),
  exporter,
  readSetting,
  writeSetting,
  onPlace(entry) {
    setMode('generate');
    query('#buildDrawer').open = true;
    return builder.pickKey(entry.key);
  },
});
const residentArchive = setupResidentArchive(app, { store: residentStore, showroom, archive });
archive.render();

// Puzzle tab: daily files and live puzzles come from their own worker
const puzzleWorker = createWorkerClient(new URL('./workers/puzzle.worker.js', import.meta.url));
const puzzle = setupPuzzle(app, {
  builder,
  residents,
  moduleView: modules,
  showBuild,
  loader: (payload) => puzzleWorker.call(payload),
  readSetting,
  writeSetting,
  storage: browserStore,
  onEmptySandbox: () => generateStructure(openingOptions(randomSeedText())),
});
app.puzzleUi = puzzle;

// Screen point above a resident's home, for floating score changes
function screenOfResident(id) {
  const home = residents.homeOf(id);
  const box = home ? modules.boxOf(home.id) : null;
  if (!box) return null;
  const point = box.getCenter(box.min.clone());
  point.z = box.max.z;
  point.project(rig.camera);
  if (point.z > 1) return null;
  const rect = canvas.getBoundingClientRect();
  return [rect.left + ((point.x + 1) / 2) * rect.width, rect.top + ((1 - point.y) / 2) * rect.height];
}
const recordOf = (id) => residents.list().find((record) => record.id === id) || null;
setupScoreTab(app, residents, { recordOf, nameOf: residentPanel.nameOf, screenOf: screenOfResident });

// Results, streak, wins and the Infinite best stay in this browser
const puzzleStore = createPuzzleStore(browserStore);
puzzleStore.load();
function puzzleStats(game) {
  if (game.test) return [];
  if (game.kind === 'infinite') {
    const { played, best } = puzzleStore.infiniteStats();
    return [[COPY.resultsPlayed, played], [COPY.resultsBest, best ? `${best.percent}%` : '0%']];
  }
  const { played, streak, wins } = puzzleStore.dailyStats(easternDate());
  const day = puzzleStore.daily(game.date);
  return [[COPY.resultsPlayed, played], [COPY.resultsStreak, streak], [COPY.resultsWins, wins], [COPY.resultsBest, day ? `${day.best.percent}%` : '0%']];
}

// Submit records the result and opens the results sheet for a valid layout
const results = setupResults(app, {
  recordOf,
  nameOf: residentPanel.nameOf,
  portrait: residentPanel.portrait,
  showPar: puzzle.showPar,
  // Par's own breakdown, scored by the same rules
  parReport: (shownPuzzle) => scorer.call({ kind: 'puzzle', puzzle: shownPuzzle, layout: shownPuzzle.par.layout, preview: null }),
  hidePar: puzzle.hidePar,
  stats: puzzleStats,
});
puzzle.submit.addEventListener('click', () => {
  const report = residents.report();
  if (!app.game || !report || !report.valid || report.puzzle !== app.puzzle) return;
  residentPanel.cancel();
  const game = app.game;
  // Test mode results are never kept, so streaks stay real
  const saved = game.test ? { stored: true } : game.kind === 'daily' ? puzzleStore.recordDaily(game.date, report.score, game.ranked) : puzzleStore.recordInfinite(game.seed, report.score);
  results.open(report, game, saved.stored ? '' : COPY.resultsSaveFailed);
});
puzzle.onGame(() => results.close());
// Reset puzzle: the starting site, tray and residents, after a confirm
const resetButton = query('#buildReset');
resetButton.addEventListener('click', async () => {
  if (!app.game || !(await confirmAt(resetButton, COPY.confirmReset, COPY.resetPuzzle))) return;
  residentPanel.cancel();
  puzzle.restart();
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

// Back to the tab of the last visit, unless a shared link names a structure
const lastMode = readSetting(MODE_SETTING, 'generate');
if (!location.search && lastMode !== 'generate' && MODES.includes(lastMode)) setMode(lastMode);
