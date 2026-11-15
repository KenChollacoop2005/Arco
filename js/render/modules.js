import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, STORY_MM, BUILD_MS_PER_MODULE, BUILD_TOTAL_MS, BUILD_STAGGER_MAX_MS } from '../config.js';
import { instanceCells, instancePose, variantKey } from '../core/grid.js';
import { hashString } from '../core/rng.js';
import { createModuleMaterials, STATE_NORMAL } from './materials.js';
import { createSketch } from './sketch.js';

const BUILD_LEAD_S = 0.08; // pause before the first module
const SETTLE_MS = 600; // redraw time after the last module
const DONE_START = -1000; // start time of a finished module
const ANIM_SIZE = 4; // floats per instance: start, state, height, tone

const srgbToLinear = (value) => {
  const share = value / 255;
  return share <= 0.04045 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
};
const LINEAR = Float32Array.from({ length: 256 }, (unused, value) => srgbToLinear(value));

function toGeometry(render) {
  const geometry = new THREE.BufferGeometry();
  const colors = new Float32Array(render.colors.length);
  for (let index = 0; index < colors.length; index++) colors[index] = LINEAR[render.colors[index]];
  geometry.setAttribute('position', new THREE.BufferAttribute(render.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aMeta', new THREE.BufferAttribute(render.meta, 3));
  geometry.setIndex(new THREE.BufferAttribute(render.index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// requestGeometry(variants, onPart) resolves when all parts are in
export function createModuleView(view, requestGeometry) {
  const materials = createModuleMaterials();
  const group = new THREE.Group();
  view.scene.add(group);
  const sketch = createSketch(view);
  const cache = new Map();
  const turn = new THREE.Matrix4();
  const shift = new THREE.Matrix4();
  let batches = new Map();
  let records = new Map();
  let generation = 0;

  function clear() {
    for (const batch of batches.values()) {
      group.remove(batch.mesh);
      batch.mesh.dispose();
    }
    batches = new Map();
    records = new Map();
    sketch.clear();
  }

  function addBatch(key, entries, animate) {
    const part = cache.get(key);
    const geometry = part.geometry;
    const mesh = new THREE.InstancedMesh(geometry, materials.lit, entries.length);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(entries.length * ANIM_SIZE), ANIM_SIZE);
    const now = view.now();
    entries.forEach((record, index) => {
      const pose = instancePose(record.instance);
      turn.makeRotationZ((pose.turns * Math.PI) / 2);
      shift.makeTranslation(pose.x, pose.y, pose.z);
      mesh.setMatrixAt(index, shift.multiply(turn));
      record.start = animate ? Math.max(record.start, now) : DONE_START;
      anim.setXYZW(index, record.start, record.state, record.instance.h * STORY_MM, (hashString('tone' + record.instance.id) % 1000) / 1000);
      record.key = key;
      record.index = index;
    });
    geometry.setAttribute('aAnim', anim);
    mesh.customDepthMaterial = materials.depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.ids = entries.map((record) => record.instance.id);
    group.add(mesh);
    batches.set(key, { mesh, anim });
    if (animate) view.keepBusy((entries[entries.length - 1].start - now) * 1000 + BUILD_MS_PER_MODULE + SETTLE_MS);
    view.requestRender();
  }

  async function setStructure(modules, options = {}) {
    const animate = !!options.animate;
    const token = ++generation;
    clear();
    const stagger = Math.min(BUILD_STAGGER_MAX_MS, BUILD_TOTAL_MS / Math.max(1, modules.length)) / 1000;
    const begin = view.now() + BUILD_LEAD_S;
    const byKey = new Map();
    modules.forEach((instance, order) => {
      const record = { instance, start: begin + order * stagger, state: STATE_NORMAL, key: '', index: 0 };
      records.set(instance.id, record);
      const key = variantKey(instance);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(record);
    });
    if (animate) {
      sketch.set(modules.map((instance) => ({ instance, start: records.get(instance.id).start })));
      view.keepBusy(modules.length * stagger * 1000 + BUILD_MS_PER_MODULE + SETTLE_MS);
    }
    const missing = [];
    for (const [key, entries] of byKey) {
      if (cache.has(key)) addBatch(key, entries, animate);
      else missing.push(entries[0].instance);
    }
    if (missing.length === 0) return;
    await requestGeometry(missing, (part) => {
      if (!cache.has(part.key)) cache.set(part.key, { geometry: toGeometry(part.render), edges: part.edges, anchors: part.anchors, print: part.print, sockets: part.sockets });
      if (token === generation && byKey.has(part.key) && !batches.has(part.key)) addBatch(part.key, byKey.get(part.key), animate);
    });
  }

  function setState(id, state) {
    const record = records.get(id);
    if (!record || record.state === state) return;
    record.state = state;
    const batch = batches.get(record.key);
    if (!batch) return;
    batch.anim.setY(record.index, state);
    batch.anim.needsUpdate = true;
    view.requestRender();
  }

  function pick(raycaster) {
    const hit = raycaster.intersectObjects(group.children, false)[0];
    return hit ? hit.object.userData.ids[hit.instanceId] : null;
  }

  function boxOf(id) {
    const record = records.get(id);
    if (!record) return null;
    const box = new THREE.Box3();
    const { instance } = record;
    for (const [cellX, cellY] of instanceCells(instance)) {
      box.expandByPoint(new THREE.Vector3(cellX * CELL_MM, cellY * CELL_MM, instance.z * STORY_MM));
      box.expandByPoint(new THREE.Vector3((cellX + 1) * CELL_MM, (cellY + 1) * CELL_MM, (instance.z + instance.h) * STORY_MM));
    }
    return box;
  }

  return {
    setStructure,
    setState,
    pick,
    boxOf,
    partOf: (key) => cache.get(key),
    get group() {
      return group;
    },
  };
}
