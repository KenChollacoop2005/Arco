import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { CELL_MM, STORY_MM, MAX_MODULE_STORIES, SHOWROOM_IDLE_MS, SHOWROOM_EASE_MS, SHOWROOM_SPIN } from '../config.js';
import { FOOTPRINTS, footprintSize } from '../core/grid.js';
import { createModuleMaterials, createPlinthMaterial, STATE_NORMAL } from './materials.js';

const LIP_MM = 6; // showroom plinth past the largest footprint
const PLINTH_DEPTH_MM = 10; // showroom plinth thickness
const PLINTH_SEGMENTS = 64; // showroom plinth roundness
const RIM_INSET_MM = 2.5; // rim line inside the edge
const VIEW_AZIMUTH = -Math.PI / 4; // default camera turn around the model
const VIEW_ELEVATION = Math.PI / 6; // default camera height angle
const VIEW_DISTANCE_MM = 900; // camera standoff, ortho so only clipping
const FRAME_PAD = 1.15; // margin around the plinth and model
const MIN_ZOOM = 0.6; // farthest zoom out
const MAX_ZOOM = 4; // closest zoom in
const DONE_START = -1000; // build animation already finished
const KEY_INTENSITY = 2.4; // key light strength
const FILL_INTENSITY = 1.4; // sky fill strength
const KEY_DIRECTION = [-0.45, -0.62, 0.92]; // key light direction, same as the main view
const ANIM_SIZE = 4; // floats per instance: start, state, height, tone
const NEUTRAL_TONE = 0.5; // concrete tone of the showroom piece
const MAX_PIXEL_RATIO = 2; // render scale cap
const FIGURE_FILL = 0.55; // resident figure share of the view height

// Radius that fits any footprint turned any way, in mm
const largest = Math.max(...Object.keys(FOOTPRINTS).map((id) => Math.hypot(...footprintSize(id, 0)))) * CELL_MM;
export const SHOWROOM_RADIUS_MM = largest / 2 + LIP_MM;

const smooth = (share) => share * share * (3 - 2 * share);

// Small orthographic stage for one saved module, slowly turning
export function createShowroom(canvas, reducedMotion) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  // The main view's section cut never reaches here
  renderer.localClippingEnabled = false;
  const scene = new THREE.Scene();
  const fill = new THREE.HemisphereLight(0xffffff, 0xbdbab3, FILL_INTENSITY);
  fill.position.set(0, 0, 1);
  scene.add(fill);
  const key = new THREE.DirectionalLight(0xfffaf2, KEY_INTENSITY);
  key.position.set(...KEY_DIRECTION);
  scene.add(key);

  const plinthShape = new THREE.CylinderGeometry(SHOWROOM_RADIUS_MM, SHOWROOM_RADIUS_MM, PLINTH_DEPTH_MM, PLINTH_SEGMENTS);
  plinthShape.rotateX(Math.PI / 2);
  plinthShape.translate(0, 0, -PLINTH_DEPTH_MM / 2);
  scene.add(new THREE.Mesh(plinthShape, createPlinthMaterial(SHOWROOM_RADIUS_MM - RIM_INSET_MM, CELL_MM)));

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, VIEW_DISTANCE_MM * 3);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = !reducedMotion;
  controls.minZoom = MIN_ZOOM;
  controls.maxZoom = MAX_ZOOM;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = SHOWROOM_SPIN;
  const materials = createModuleMaterials();
  let piece = null;
  let active = false;
  let idleTimer = 0;
  let ease = null;
  let height = 0;
  let homeZoom = 1;
  const reach = Math.max(SHOWROOM_RADIUS_MM, MAX_MODULE_STORIES * STORY_MM * 0.6) * FRAME_PAD;

  // Default angle around the model's middle
  function home() {
    const target = new THREE.Vector3(0, 0, height / 2);
    const offset = new THREE.Vector3(Math.cos(VIEW_ELEVATION) * Math.cos(VIEW_AZIMUTH), Math.cos(VIEW_ELEVATION) * Math.sin(VIEW_AZIMUTH), Math.sin(VIEW_ELEVATION)).multiplyScalar(VIEW_DISTANCE_MM);
    return { target, position: target.clone().add(offset), zoom: homeZoom };
  }

  function fit() {
    const width = canvas.clientWidth;
    const tall = canvas.clientHeight;
    if (!width || !tall) return;
    renderer.setSize(width, tall, false);
    const aspect = width / tall;
    camera.left = -reach * Math.max(1, aspect);
    camera.right = reach * Math.max(1, aspect);
    camera.top = reach / Math.min(1, aspect);
    camera.bottom = -reach / Math.min(1, aspect);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(fit).observe(canvas);

  function settle() {
    const view = home();
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    controls.update();
  }

  // After a pause the view eases home, then turns again
  controls.addEventListener('start', () => {
    clearTimeout(idleTimer);
    ease = null;
    controls.autoRotate = false;
  });
  controls.addEventListener('end', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const view = home();
      ease = { start: performance.now(), from: { position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom }, to: view };
    }, SHOWROOM_IDLE_MS);
  });

  function frame(now) {
    if (!active) return;
    requestAnimationFrame(frame);
    if (ease) {
      const share = Math.min(1, (now - ease.start) / SHOWROOM_EASE_MS);
      const step = smooth(share);
      camera.position.lerpVectors(ease.from.position, ease.to.position, step);
      controls.target.lerpVectors(ease.from.target, ease.to.target, step);
      camera.zoom = ease.from.zoom + (ease.to.zoom - ease.from.zoom) * step;
      camera.updateProjectionMatrix();
      if (share >= 1) {
        ease = null;
        controls.autoRotate = !reducedMotion;
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }

  function dropPiece() {
    if (!piece) return;
    scene.remove(piece);
    piece.geometry.dispose();
    if (piece.dispose) piece.dispose();
    piece = null;
  }

  return {
    // part from the module view cache, null to clear
    show(part, variant) {
      dropPiece();
      homeZoom = 1;
      controls.maxZoom = MAX_ZOOM;
      height = variant ? variant.h * STORY_MM : 0;
      if (part && variant) {
        const geometry = new THREE.BufferGeometry();
        for (const name of ['position', 'color', 'aMeta']) geometry.setAttribute(name, part.geometry.getAttribute(name));
        geometry.setIndex(part.geometry.getIndex());
        const anim = new THREE.InstancedBufferAttribute(new Float32Array(ANIM_SIZE), ANIM_SIZE);
        anim.setXYZW(0, DONE_START, STATE_NORMAL, height, NEUTRAL_TONE);
        geometry.setAttribute('aAnim', anim);
        piece = new THREE.InstancedMesh(geometry, materials.lit, 1);
        // Centre the footprint on the plinth
        const box = part.geometry.boundingBox;
        piece.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0));
        piece.frustumCulled = false;
        scene.add(piece);
      }
      clearTimeout(idleTimer);
      ease = null;
      controls.autoRotate = !reducedMotion;
      settle();
    },
    // A resident figure mesh, zoomed in to fill the stage
    showFigure(mesh, figureHeight) {
      dropPiece();
      fit();
      height = figureHeight;
      homeZoom = (2 * reach * FIGURE_FILL) / figureHeight;
      controls.maxZoom = Math.max(MAX_ZOOM, homeZoom * 2);
      piece = mesh;
      scene.add(piece);
      clearTimeout(idleTimer);
      ease = null;
      controls.autoRotate = !reducedMotion;
      settle();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        fit();
        requestAnimationFrame(frame);
      }
    },
  };
}
