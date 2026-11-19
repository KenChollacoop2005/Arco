import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { runChecks } from '../js/core/checks.js';
import { generate } from '../js/core/generator.js';
import { planServices } from '../js/core/services.js';
import { serviceLines } from '../js/core/drafting.js';
import { waterText, powerText } from '../js/ui/inspector.js';
import { walkingNetwork, walkingLines } from '../js/core/walking.js';
import { COPY } from '../js/ui/copy.js';
import { normalizeVariant } from '../js/core/catalog.js';
import { validateStructure } from '../js/core/placement.js';
import { worldFromModules } from '../js/core/grid.js';

// Pump room feeding 8 units of beds from 6, a garden, houses, a turbine and a generator
const SERVICES_FIXTURE = [
  [1, 'pumproom', '1x1', 1, 0, 0, 0], [2, 'generator', '1x1', 1, 0, 1, 0],
  [3, 'farm', '2x3', 1, 1, 0, 0], [4, 'farm', '2x3', 1, -3, 0, 0], [5, 'farm', '2x2', 1, 0, -2, 0],
  [7, 'garden', '1x1', 1, 3, -4, 0], [8, 'housing', '1x1', 2, 0, 3, 0], [9, 'turbine', '1x1', 2, 0, 3, 2],
  [10, 'housing', '1x1', 2, 1, 3, 0], [11, 'housing', '1x1', 1, -4, 3, 0], [12, 'housing', '1x1', 1, 3, 3, 0],
  [13, 'housing', '1x1', 1, -4, -3, 0], [14, 'housing', '1x1', 3, -1, -2, 0],
];

const LAYERS = ['edges', 'connectors', 'centers', 'loads', 'services', 'walking'];
const STATUS_HEX = { '--blue': '#2244aa', '--pass': '#22aa44', '--warn': '#ee7700', '--fail': '#cc2222', '--water': '#1188dd', '--power': '#ddaa00' };

// Smallest page stand-in the drawing layer needs
function fakePage() {
  const node = () => ({ style: {}, setAttribute() {}, append() {}, replaceChildren() {}, clientWidth: 1366, clientHeight: 768 });
  globalThis.document = { documentElement: {}, createElementNS: node, createElement: node };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => STATUS_HEX[name] || '#000000' });
  return node;
}

test('drawing mode builds every line layer, load paths included', async () => {
  const node = fakePage();
  const { createDrawing } = await import('../js/render/drawing.js');
  const scene = new THREE.Scene();
  const view = { scene, requestRender() {}, onResize() {} };
  const rig = { camera: new THREE.OrthographicCamera(-200, 200, 200, -200, 1, 2000), onChange() {} };
  const edges = new Float32Array([0, 0, 0, 10, 0, 0]);
  const moduleView = { partOf: () => ({ edges }) };
  const drawing = createDrawing(view, rig, moduleView, node(), node());
  const structure = generate({ seed: 'habitat', scale: 'block' });
  const checks = runChecks(structure.modules);
  drawing.update(structure, checks);
  drawing.setServices(planServices(structure.modules, 'habitat'));
  // The walking layer starts hidden; show it to check it too
  drawing.setWalking(walkingLines(walkingNetwork(structure.modules), structure.modules));
  drawing.setLayer('walking', true);
  assert.doesNotThrow(() => drawing.setActive(true));
  const group = scene.children[scene.children.length - 1];
  assert.equal(group.visible, true);
  assert.equal(group.children.length, LAYERS.length);
  for (const lines of group.children) {
    assert.ok(lines.visible);
    assert.ok(lines.geometry.getAttribute('position').count >= 2, 'layer has segments');
  }
  const loads = group.children[LAYERS.indexOf('loads')];
  assert.ok(loads.geometry.getAttribute('position').count >= checks.interfaces.length * 2);
  const tint = loads.geometry.getAttribute('color').array;
  const pass = new THREE.Color(STATUS_HEX['--pass']);
  assert.ok(Math.abs(tint[0] - pass.r) < 1e-6 && Math.abs(tint[1] - pass.g) < 1e-6, 'load paths carry the status color');
  const services = group.children[LAYERS.indexOf('services')].geometry.getAttribute('color').array;
  const water = new THREE.Color(STATUS_HEX['--water']);
  assert.ok(Math.abs(services[0] - water.r) < 1e-6 && Math.abs(services[2] - water.b) < 1e-6, 'water lines are water blue');
});

const STATUSES = ['water', 'power', 'warn', 'fail'];
const pointsIn = (lines, from, to) => lines.positions.slice(from * 6, to * 6);

test('services overlay draws strings, dashed blocked attempts and dry or partial consumers', () => {
  assert.deepEqual(serviceLines(null), { positions: [], statuses: [] });
  // Hand built: a pump room short for three crop beds, a garden, houses and a turbine
  const structure = { modules: SERVICES_FIXTURE.map(([id, family, fp, h, x, y, z]) => ({ ...normalizeVariant({ family, fp, h, seed: 3, mask: 15, roof: false }), id, x, y, z, rot: 0 })) };
  assert.deepEqual(validateStructure(worldFromModules(structure.modules)), []);
  const services = planServices(structure.modules, 'drawing');
  const lines = serviceLines(services, structure.modules);
  assert.equal(lines.positions.length, lines.statuses.length * 6);
  assert.ok(lines.statuses.every((status) => STATUSES.includes(status)));
  // Solid strings first, one segment per point step, in order
  const steps = (list) => list.reduce((sum, string) => sum + string.points.length - 1, 0);
  const pipeSteps = steps(services.pipes);
  const sheetSteps = steps(services.sheets);
  const wireSteps = steps(services.wires);
  // Surplus water is not drawn, so no sheet steps
  assert.ok(pipeSteps > 0 && sheetSteps === 0 && wireSteps > 0 && services.blocked.length > 0);
  assert.deepEqual(pointsIn(lines, 0, 1), [...services.pipes[0].points[0], ...services.pipes[0].points[1]]);
  assert.ok(lines.statuses.slice(0, pipeSteps + sheetSteps).every((status) => status === 'water'));
  assert.ok(lines.statuses.slice(pipeSteps + sheetSteps, pipeSteps + sheetSteps + wireSteps).every((status) => status === 'power'));
  assert.deepEqual(pointsIn(lines, pipeSteps + sheetSteps, pipeSteps + sheetSteps + 1), [...services.wires[0].points[0], ...services.wires[0].points[1]]);
  // Blocked attempts come as dashes no longer than a dash, in their type color
  const consumers = Object.values(services.water.consumers);
  const dry = consumers.filter((report) => report.status === 'dry').length;
  const partial = consumers.filter((report) => report.status === 'partial').length;
  assert.ok(dry > 0 && partial > 0);
  // Power marks follow: short consumers like water ones, relays as a square
  const powerReports = Object.values(services.power.consumers);
  const powerDry = powerReports.filter((report) => !report.relay && report.status === 'dry').length;
  const powerPartial = powerReports.filter((report) => !report.relay && report.status === 'partial').length;
  const relaysFed = powerReports.filter((report) => report.relay && report.fed).length;
  const relaysIdle = powerReports.filter((report) => report.relay && !report.fed).length;
  const marks = dry * 6 + partial * 4 + powerDry * 6 + powerPartial * 4 + (relaysFed + relaysIdle) * 4;
  const dashStart = pipeSteps + sheetSteps + wireSteps;
  const dashes = lines.statuses.length - dashStart - marks;
  assert.ok(dashes > steps(services.blocked), 'blocked strings are cut into dashes');
  for (let index = dashStart; index < dashStart + dashes; index++) {
    const [ax, ay, az, bx, by, bz] = pointsIn(lines, index, index + 1);
    assert.ok(Math.hypot(bx - ax, by - ay, bz - az) <= 2 + 1e-9);
  }
  const blockedTypes = new Set(services.blocked.map((string) => (string.type === 'pipe' ? 'water' : 'power')));
  assert.deepEqual(new Set(lines.statuses.slice(dashStart, dashStart + dashes)), blockedTypes);
  // Marks: dry red with a cross, partial orange
  const markStatuses = lines.statuses.slice(dashStart + dashes);
  assert.equal(markStatuses.filter((status) => status === 'fail').length, (dry + powerDry) * 6);
  assert.equal(markStatuses.filter((status) => status === 'warn').length, (partial + powerPartial + relaysIdle) * 4);
  assert.equal(markStatuses.filter((status) => status === 'power').length, relaysFed * 4);
  const partialId = Number(Object.keys(services.water.consumers).find((id) => services.water.consumers[id].status === 'partial'));
  const instance = structure.modules.find((module) => module.id === partialId);
  const warnAt = lines.statuses.indexOf('warn', dashStart + dashes);
  assert.ok(Math.abs(lines.positions[warnAt * 6 + 2] - ((instance.z + instance.h) * 25 + 0.2)) < 1e-9, 'mark sits on the roof');
});

test('inspector water and power lines read the solver and the wires', () => {
  const consumers = { 1: { received: 0.5, demand: 1, headLeft: null, status: 'partial', reason: 'out of head', short: 2 }, 2: { received: 0.25, demand: 0.25, headLeft: 1, status: 'full', reason: null, short: 0 }, 3: { received: 0, demand: 0.5, headLeft: null, status: 'dry', reason: 'no free port', short: 0 } };
  const power = {
    nodes: [{ id: '6', module: 6, kind: 'source', supply: 2 }, { id: '7', module: 7, kind: 'relay', throughput: 8 }, { id: '4:box', module: 4, kind: 'relay', throughput: 3 }],
    consumers: {
      1: { received: 0.5, demand: 0.5, reachLeft: 2, status: 'full', reason: null, short: 0 },
      4: { received: 0, demand: 0.5, reachLeft: null, status: 'dry', reason: 'out of reach', short: 2 },
      8: { received: 0.25, demand: 1, reachLeft: 1, status: 'partial', reason: 'relay at throughput', short: 0 },
      7: { relay: true, fed: true, received: 1.5, capped: false, reason: null },
      '4:box': { relay: true, fed: false, received: 0, capped: false, reason: 'no route' },
    },
  };
  const flows = { ports: [{ module: 4, type: 'power' }, { module: 5, type: 'water-in' }], services: { water: { consumers, pumps: { 8: { runs: false } } }, power } };
  assert.equal(waterText(flows, 1), `${COPY.water}: 0.5 ${COPY.waterOf} 1, ${COPY.waterPartial}, ${COPY.waterShortBy} 2`);
  assert.equal(waterText(flows, 2), `${COPY.water}: 0.25 ${COPY.waterOf} 0.25, ${COPY.waterFull}`);
  assert.equal(waterText(flows, 3), `${COPY.water}: 0 ${COPY.waterOf} 0.5, ${COPY.waterDry}, ${COPY.waterNoPort}`);
  assert.equal(waterText(flows, 4), null);
  assert.equal(waterText(null, 1), null);
  assert.equal(powerText(flows, 1), `${COPY.power}: 0.5 ${COPY.powerOf} 0.5`);
  assert.equal(powerText(flows, 4), `${COPY.notPowered}: ${COPY.powerShortBy} 2. ${COPY.relayIdle}, ${COPY.powerNoRoute}`);
  assert.equal(powerText(flows, 8), `${COPY.power}: 0.25 ${COPY.powerOf} 1, ${COPY.powerPartial}, ${COPY.powerRelayFull}. ${COPY.pumpOff}`);
  assert.equal(powerText(flows, 6), `${COPY.powerMakes} 2 ${COPY.powerUnits}`);
  assert.equal(powerText(flows, 7), `${COPY.relayPasses} 1.5 ${COPY.powerOf} 8`);
  assert.equal(powerText(flows, 5), null);
  // Every solver reason has a line
  const structure = generate({ seed: 'barbican', scale: 'mega', density: 'high' });
  const services = planServices(structure.modules, 'barbican');
  for (const [id, report] of Object.entries(services.water.consumers)) {
    const text = waterText({ services, ports: [] }, Number(id));
    assert.ok(!text.includes('undefined'), text);
    assert.equal(text.split(', ').length, report.status === 'full' ? 2 : 3);
  }
});
