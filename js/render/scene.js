import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { createPlinthMaterial, sharedUniforms } from './materials.js';

const PLINTH_LIP_MM = 7; // plinth edge beyond the grid
const PLINTH_THICK_MM = 18; // plinth depth
const PLINTH_BEVEL_MM = 3; // lower edge bevel
const RIM_INSET_MM = 3.5; // rim line from the edge
const SHADOW_SPREAD = 1.75; // contact shadow size factor
const SHADOW_OPACITY = 0.3; // contact shadow strength
const SHADOW_DROP_MM = 26; // contact shadow below plinth
const KEY_INTENSITY = 2.6; // key light strength
const FILL_INTENSITY = 1.35; // sky fill strength
const KEY_DIRECTION = [-0.45, -0.62, 0.92]; // key light direction
const SHADOW_MAP_SIZE = 2048; // shadow resolution
const MAX_PIXEL_RATIO = 2; // render scale cap
const SHADOW_TEXTURE_PX = 256; // contact shadow texture size
const SHADOW_CORE = 0.2; // solid share of contact shadow
const SHADOW_MID_STOP = 0.55; // contact shadow falloff point
const SHADOW_TINT = '60, 54, 44'; // contact shadow colour
const PLINTH_SEGMENTS = 96; // plinth roundness
const SHADOW_BIAS = -0.0006; // shadow acne offset
const SHADOW_NORMAL_BIAS = 0.6; // shadow offset along normals
const LIGHT_REACH_PER_HEIGHT = 0.75; // shadow box growth with height
const LIGHT_REACH_PAD_MM = 40; // shadow box margin
const LIGHT_TARGET_SHARE = 0.45; // light aim height share
const LIGHT_STANDOFF = 2.2; // light distance in reaches
const LIGHT_NEAR_MM = 10; // shadow camera near plane
const LIGHT_FAR = 4.6; // shadow camera depth in reaches
const START_HEIGHT_MM = 100; // light fit before first model
const MAX_FRAME_S = 0.1; // longest frame step

export const PLINTH_RADIUS_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2 + PLINTH_LIP_MM;

function contactShadowTexture() {
  const size = SHADOW_TEXTURE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, size * SHADOW_CORE, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${SHADOW_TINT}, 1)`);
  gradient.addColorStop(SHADOW_MID_STOP, `rgba(${SHADOW_TINT}, ${SHADOW_MID_STOP})`);
  gradient.addColorStop(1, `rgba(${SHADOW_TINT}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function buildPlinth() {
  const radius = PLINTH_RADIUS_MM;
  const profile = [
    new THREE.Vector2(0, -PLINTH_THICK_MM),
    new THREE.Vector2(radius - PLINTH_BEVEL_MM, -PLINTH_THICK_MM),
    new THREE.Vector2(radius, -PLINTH_THICK_MM + PLINTH_BEVEL_MM),
    new THREE.Vector2(radius, -1),
    new THREE.Vector2(radius - 1, 0),
    new THREE.Vector2(0, 0),
  ];
  const geometry = new THREE.LatheGeometry(profile, PLINTH_SEGMENTS);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, createPlinthMaterial(radius - RIM_INSET_MM, CELL_MM));
  mesh.receiveShadow = true;
  return mesh;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    stencil: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const fill = new THREE.HemisphereLight(0xffffff, 0xcdccc8, FILL_INTENSITY);
  fill.position.set(0, 0, 1);
  scene.add(fill);

  const key = new THREE.DirectionalLight(0xfffaf2, KEY_INTENSITY);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  key.shadow.bias = SHADOW_BIAS;
  key.shadow.normalBias = SHADOW_NORMAL_BIAS;
  scene.add(key);
  scene.add(key.target);

  const plinth = buildPlinth();
  scene.add(plinth);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(PLINTH_RADIUS_MM * 2 * SHADOW_SPREAD, PLINTH_RADIUS_MM * 2 * SHADOW_SPREAD),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    })
  );
  contact.position.z = -PLINTH_THICK_MM - SHADOW_DROP_MM;
  contact.renderOrder = -1;
  scene.add(contact);

  // Shadow box follows the model height
  function fitLight(heightMm) {
    const direction = new THREE.Vector3(...KEY_DIRECTION).normalize();
    const reach = PLINTH_RADIUS_MM + heightMm * LIGHT_REACH_PER_HEIGHT + LIGHT_REACH_PAD_MM;
    key.target.position.set(0, 0, heightMm * LIGHT_TARGET_SHARE);
    key.position.copy(key.target.position).addScaledVector(direction, reach * LIGHT_STANDOFF);
    const camera = key.shadow.camera;
    camera.left = camera.bottom = -reach;
    camera.right = camera.top = reach;
    camera.near = LIGHT_NEAR_MM;
    camera.far = reach * LIGHT_FAR;
    camera.updateProjectionMatrix();
    key.shadow.needsUpdate = true;
  }
  fitLight(START_HEIGHT_MM);

  const frameCallbacks = [];
  let dirty = true;
  let busyUntil = 0;
  let activeCamera = null;
  let lastTime = performance.now();
  const clock = { start: performance.now() };

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    dirty = true;
    for (const callback of resizeCallbacks) callback(width, height);
  }
  const resizeCallbacks = [];
  new ResizeObserver(resize).observe(canvas);

  function loop(now) {
    requestAnimationFrame(loop);
    const delta = Math.min(MAX_FRAME_S, (now - lastTime) / 1000);
    lastTime = now;
    sharedUniforms.uTime.value = (now - clock.start) / 1000;
    let active = now < busyUntil;
    for (const callback of frameCallbacks) active = callback(delta, now) || active;
    if ((dirty || active) && activeCamera) {
      renderer.render(scene, activeCamera);
      dirty = false;
    }
  }
  requestAnimationFrame(loop);

  return {
    renderer,
    scene,
    plinth,
    fitLight,
    now: () => sharedUniforms.uTime.value,
    setCamera(camera) {
      activeCamera = camera;
      dirty = true;
    },
    requestRender() {
      dirty = true;
    },
    keepBusy(milliseconds) {
      busyUntil = Math.max(busyUntil, performance.now() + milliseconds);
    },
    onFrame(callback) {
      frameCallbacks.push(callback);
    },
    onResize(callback) {
      resizeCallbacks.push(callback);
      resize();
    },
  };
}
