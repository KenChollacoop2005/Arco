import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { runChecks } from '../js/core/checks.js';
import { generate } from '../js/core/generator.js';
import { waterNetwork, wireNetwork } from '../js/core/flows.js';

const LAYERS = ['edges', 'connectors', 'centers', 'loads', 'services'];
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
  drawing.setServices({ water: waterNetwork(structure.modules, 'habitat'), wires: wireNetwork(structure.modules, 'habitat').wires });
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
