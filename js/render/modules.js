import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, STORY_MM, BUILD_MS_PER_MODULE, BUILD_TOTAL_MS, BUILD_STAGGER_MAX_MS } from '../config.js';
import { instanceCells, instancePose, variantKey } from '../core/grid.js';
import { hashString } from '../core/rng.js';
import { createModuleMaterials, STATE_NORMAL, STATE_GHOST, STATE_INVALID } from './materials.js';
import { createSketch } from './sketch.js';

const BUILD_LEAD_S = 0.08; // pause before the first module
const SETTLE_MS = 600; // redraw time after the last module
const DONE_START = -1000; // start time of a finished module
const ANIM_SIZE = 4; // floats per instance: start, state, height, tone
const GHOST_TONE = 0.5; // concrete tone of the placement ghost

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
  let ghost = null;

  function clear() {
    for (const batch of batches.values()) {
      group.remove(batch.mesh);
      batch.mesh.dispose();
    }
    batches = new Map();
    records = new Map();
    sketch.clear();
  }

  function addBatch(key, entries) {
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
      record.start = record.animate ? Math.max(record.start, now) : DONE_START;
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
    const last = Math.max(...entries.map((record) => record.start));
    if (last > DONE_START) view.keepBusy((last - now) * 1000 + BUILD_MS_PER_MODULE + SETTLE_MS);
    view.requestRender();
  }

  function storePart(part) {
    if (!cache.has(part.key)) cache.set(part.key, { geometry: toGeometry(part.render), edges: part.edges, anchors: part.anchors, print: part.print, sockets: part.sockets });
  }

  async function setStructure(modules, options = {}) {
    const token = ++generation;
    clear();
    const moving = new Set();
    for (const instance of modules) {
      if (options.animate && (!options.only || options.only.has(instance.id))) moving.add(instance.id);
    }
    const stagger = Math.min(BUILD_STAGGER_MAX_MS, BUILD_TOTAL_MS / Math.max(1, moving.size)) / 1000;
    const begin = view.now() + BUILD_LEAD_S;
    const byKey = new Map();
    let order = 0;
    for (const instance of modules) {
      const animate = moving.has(instance.id);
      const record = { instance, start: begin + order * stagger, state: STATE_NORMAL, key: '', index: 0, animate };
      if (animate) order++;
      records.set(instance.id, record);
      const key = variantKey(instance);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(record);
    }
    if (moving.size > 0) {
      sketch.set(modules.filter((instance) => moving.has(instance.id)).map((instance) => ({ instance, start: records.get(instance.id).start })));
      view.keepBusy(moving.size * stagger * 1000 + BUILD_MS_PER_MODULE + SETTLE_MS);
    }
    const missing = [];
    for (const [key, entries] of byKey) {
      if (cache.has(key)) addBatch(key, entries);
      else missing.push(entries[0].instance);
    }
    if (missing.length === 0) return;
    await requestGeometry(missing, (part) => {
      storePart(part);
      if (token === generation && byKey.has(part.key) && !batches.has(part.key)) addBatch(part.key, byKey.get(part.key));
    });
  }

  // Builds geometry ahead of a placement
  async function prepare(variants) {
    const missing = variants.filter((variant) => !cache.has(variantKey(variant)));
    if (missing.length > 0) await requestGeometry(missing, storePart);
  }

  function dropGhost() {
    if (!ghost) return;
    view.scene.remove(ghost.mesh);
    ghost.mesh.geometry.dispose();
    ghost.mesh.dispose();
    ghost = null;
  }

  // Stippled preview of a part, red when invalid
  function setGhost(instance, invalid) {
    const key = instance ? variantKey(instance) : '';
    const part = cache.get(key);
    if (!part) {
      if (ghost) ghost.mesh.visible = false;
      view.requestRender();
      return;
    }
    if (!ghost || ghost.key !== key) {
      dropGhost();
      const geometry = new THREE.BufferGeometry();
      for (const name of ['position', 'color', 'aMeta']) geometry.setAttribute(name, part.geometry.getAttribute(name));
      geometry.setIndex(part.geometry.getIndex());
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(ANIM_SIZE), ANIM_SIZE);
      geometry.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geometry, materials.lit, 1);
      mesh.frustumCulled = false;
      view.scene.add(mesh);
      ghost = { key, mesh, anim };
    }
    const pose = instancePose(instance);
    turn.makeRotationZ((pose.turns * Math.PI) / 2);
    shift.makeTranslation(pose.x, pose.y, pose.z);
    ghost.mesh.setMatrixAt(0, shift.multiply(turn));
    ghost.mesh.instanceMatrix.needsUpdate = true;
    ghost.anim.setXYZW(0, DONE_START, invalid ? STATE_INVALID : STATE_GHOST, instance.h * STORY_MM, GHOST_TONE);
    ghost.anim.needsUpdate = true;
    ghost.mesh.visible = true;
    view.requestRender();
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

  // Module id and hit point under a ray
  function pickPoint(raycaster) {
    const hit = raycaster.intersectObjects(group.children, false)[0];
    return hit ? { id: hit.object.userData.ids[hit.instanceId], point: hit.point } : null;
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
    setGhost,
    prepare,
    pick,
    pickPoint,
    boxOf,
    partOf: (key) => cache.get(key),
    get group() {
      return group;
    },
  };
}
