import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, STORY_MM, BUILD_MS_PER_MODULE, BUILD_TOTAL_MS, BUILD_STAGGER_MAX_MS } from '../config.js';
import { instanceCells, instancePose, variantKey } from '../core/grid.js';
import { hashString } from '../core/rng.js';
import { planeDistance } from '../core/section.js';
import { POSE_SIZE } from '../core/physics.js';
import { GROUPS, KIND_GLASS } from '../core/palette.js';
import { createModuleMaterials, sectionPlanes, STATE_NORMAL, STATE_GHOST, STATE_INVALID } from './materials.js';
import { createSketch } from './sketch.js';

const BUILD_LEAD_S = 0.08; // pause before the first module
const SETTLE_MS = 600; // redraw time after the last module
const DONE_START = -1000; // start time of a finished module
const ANIM_SIZE = 4; // floats per instance: start, state, height, tone
const GHOST_TONE = 0.5; // concrete tone of the placement ghost
const CUT_ORDER = 1; // stencil pass draws before the fill
const MM_PER_CELL = CELL_MM; // physics poses arrive in cells
const LIGHT_SIZE = 2; // floats per instance: lit share, flicker
const GOLDEN = 0.618034; // spreads window ids over 0 to 1
// Glow marks per vertex: sign, lamp, beacon; windows get 0 to 1
const GLOW_MARKS = new Map([[GROUPS.signSocial[0], -1], [GROUPS.lamp[0], -2], [GROUPS.beacon[0], -3]]);

// One id per glass pane, signs, lamps and beacons marked below zero
function glowMarks(render) {
  const count = render.positions.length / 3;
  const marks = new Float32Array(count);
  const parent = Int32Array.from({ length: count }, (unused, vertex) => vertex);
  const root = (vertex) => {
    while (parent[vertex] !== vertex) vertex = parent[vertex] = parent[parent[vertex]];
    return vertex;
  };
  const glass = (vertex) => render.meta[vertex * 3] === KIND_GLASS;
  for (let corner = 0; corner < render.index.length; corner += 3) {
    const [first, second, third] = [render.index[corner], render.index[corner + 1], render.index[corner + 2]];
    if (!glass(first)) continue;
    parent[root(second)] = root(first);
    parent[root(third)] = root(first);
  }
  for (let vertex = 0; vertex < count; vertex++) {
    const color = (render.colors[vertex * 3] << 16) | (render.colors[vertex * 3 + 1] << 8) | render.colors[vertex * 3 + 2];
    if (glass(vertex)) marks[vertex] = ((root(vertex) + 1) * GOLDEN) % 1;
    else if (GLOW_MARKS.has(color)) marks[vertex] = GLOW_MARKS.get(color);
  }
  return marks;
}

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
  geometry.setAttribute('aWin', new THREE.BufferAttribute(glowMarks(render), 1));
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
  const clipPlane = new THREE.Plane();
  const posePosition = new THREE.Vector3();
  const poseTurn = new THREE.Quaternion();
  const poseScale = new THREE.Vector3(1, 1, 1);
  const poseGone = new THREE.Matrix4().makeScale(0, 0, 0);
  let clip = null;
  let batches = new Map();
  let records = new Map();
  let generation = 0;
  let ghost = null;
  let lights = new Map();

  function clear() {
    for (const batch of batches.values()) {
      dropCutters(batch);
      group.remove(batch.mesh);
      batch.mesh.dispose();
    }
    batches = new Map();
    records = new Map();
    sketch.clear();
  }

  // Module rest pose as a matrix
  function restMatrix(instance) {
    const pose = instancePose(instance);
    turn.makeRotationZ((pose.turns * Math.PI) / 2);
    shift.makeTranslation(pose.x, pose.y, pose.z);
    return shift.multiply(turn);
  }

  function dropCutters(batch) {
    for (const cutter of batch.cutters) {
      view.scene.remove(cutter);
      cutter.dispose();
    }
    batch.cutters = [];
  }

  // Stencil copies that share the batch's instances
  function addCutters(batch) {
    for (const material of [materials.cutBack, materials.cutFront]) {
      const cutter = new THREE.InstancedMesh(batch.mesh.geometry, material, batch.mesh.count);
      cutter.instanceMatrix = batch.mesh.instanceMatrix;
      cutter.frustumCulled = false;
      cutter.renderOrder = CUT_ORDER;
      view.scene.add(cutter);
      batch.cutters.push(cutter);
    }
  }

  // Plane from core/section.js, or null for no cut
  function setClip(plane) {
    clip = plane;
    if (plane) {
      clipPlane.normal.set(...plane.normal);
      clipPlane.constant = plane.constant;
      sectionPlanes[0] = clipPlane;
    } else {
      sectionPlanes.length = 0;
    }
    for (const batch of batches.values()) {
      if (plane && batch.cutters.length === 0) addCutters(batch);
      if (!plane) dropCutters(batch);
    }
    view.requestRender();
  }

  const visibleHit = (raycaster) =>
    raycaster.intersectObjects(group.children, false).find((hit) => !clip || planeDistance(clip, [hit.point.x, hit.point.y, hit.point.z]) >= 0);

  function addBatch(key, entries) {
    const part = cache.get(key);
    const geometry = part.geometry;
    const mesh = new THREE.InstancedMesh(geometry, materials.lit, entries.length);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(entries.length * ANIM_SIZE), ANIM_SIZE);
    const now = view.now();
    entries.forEach((record, index) => {
      mesh.setMatrixAt(index, restMatrix(record.instance));
      record.start = record.animate ? Math.max(record.start, now) : DONE_START;
      anim.setXYZW(index, record.start, record.state, record.instance.h * STORY_MM, (hashString('tone' + record.instance.id) % 1000) / 1000);
      record.key = key;
      record.index = index;
    });
    geometry.setAttribute('aAnim', anim);
    const light = new THREE.InstancedBufferAttribute(new Float32Array(entries.length * LIGHT_SIZE), LIGHT_SIZE);
    entries.forEach((record, index) => light.setXY(index, ...(lights.get(record.instance.id) || [0, 0])));
    geometry.setAttribute('aLight', light);
    mesh.customDepthMaterial = materials.depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.ids = entries.map((record) => record.instance.id);
    group.add(mesh);
    const batch = { mesh, anim, light, cutters: [] };
    batches.set(key, batch);
    if (clip) addCutters(batch);
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
    ghost.mesh.setMatrixAt(0, restMatrix(instance));
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

  // Lit window share and flicker per module id
  function setLights(map) {
    lights = map;
    for (const record of records.values()) {
      const batch = batches.get(record.key);
      if (!batch) continue;
      batch.light.setXY(record.index, ...(lights.get(record.instance.id) || [0, 0]));
      batch.light.needsUpdate = true;
    }
    view.requestRender();
  }

  function pick(raycaster) {
    const hit = visibleHit(raycaster);
    return hit ? hit.object.userData.ids[hit.instanceId] : null;
  }

  // Module id and hit point under a ray
  function pickPoint(raycaster) {
    const hit = visibleHit(raycaster);
    return hit ? { id: hit.object.userData.ids[hit.instanceId], point: hit.point } : null;
  }

  function touchBatches(settled) {
    for (const batch of batches.values()) {
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (settled) batch.mesh.computeBoundingSphere();
    }
    view.requestRender();
  }

  // Physics poses in cells, zero turn hides a module
  function setPoses(ids, poses, settled) {
    ids.forEach((id, order) => {
      const record = records.get(id);
      const batch = record && batches.get(record.key);
      if (!batch) return;
      const at = order * POSE_SIZE;
      posePosition.set(poses[at] * MM_PER_CELL, poses[at + 1] * MM_PER_CELL, poses[at + 2] * MM_PER_CELL);
      poseTurn.set(poses[at + 3], poses[at + 4], poses[at + 5], poses[at + 6]);
      const gone = poseTurn.lengthSq() === 0;
      batch.mesh.setMatrixAt(record.index, gone ? poseGone : shift.compose(posePosition, poseTurn, poseScale));
    });
    touchBatches(settled);
  }

  // Every module back on its grid pose
  function restPoses() {
    for (const record of records.values()) {
      const batch = batches.get(record.key);
      if (batch) batch.mesh.setMatrixAt(record.index, restMatrix(record.instance));
    }
    touchBatches(true);
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
    setLights,
    setGhost,
    setClip,
    setPoses,
    restPoses,
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
