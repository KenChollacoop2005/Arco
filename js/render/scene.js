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

export const PLINTH_RADIUS_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2 + PLINTH_LIP_MM;

function contactShadowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(60, 54, 44, 1)');
  gradient.addColorStop(0.55, 'rgba(60, 54, 44, 0.55)');
  gradient.addColorStop(1, 'rgba(60, 54, 44, 0)');
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
  const geometry = new THREE.LatheGeometry(profile, 96);
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
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.6;
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
    const reach = PLINTH_RADIUS_MM + heightMm * 0.75 + 40;
    key.target.position.set(0, 0, heightMm * 0.45);
    key.position.copy(key.target.position).addScaledVector(direction, reach * 2.2);
    const camera = key.shadow.camera;
    camera.left = camera.bottom = -reach;
    camera.right = camera.top = reach;
    camera.near = 10;
    camera.far = reach * 4.6;
    camera.updateProjectionMatrix();
    key.shadow.needsUpdate = true;
  }
  fitLight(100);

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
    const delta = Math.min(0.1, (now - lastTime) / 1000);
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
