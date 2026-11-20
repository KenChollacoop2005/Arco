import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCarry, stepCarry, stretchScale, CARRY } from '../core/carry.js';
import { FIGURE_VIEW } from '../core/figuremesh.js';
import { viewBasis } from '../core/thumb.js';
import { figureBones, figureMaterials } from '../render/figure.js';

const SHOWN_HEIGHT_PX = 110; // carried figure height on screen
const STAGE_PX = [260, 320]; // overlay canvas size, CSS px
const HEAD_AT = [0.5, 0.36]; // head centre in the overlay, share of its size
const GRIP_PX = 4; // head top sits this far under the cursor
const MAX_PIXEL_RATIO = 2; // overlay sharpness cap
const LIGHT_SKY = 0xffffff; // hemisphere sky light
const LIGHT_GROUND = 0x9a958c; // hemisphere ground light
const LIGHT_SOFT = 1.6; // hemisphere strength
const LIGHT_KEY = 2.2; // key light strength
const KEY_FROM = [0.35, -0.5, 0.79]; // key light direction, as the thumbnails
const REDUCED_FORCE = 0.12; // reduced motion: the swing is barely felt
const UP = new THREE.Vector3(0, 0, 1);

// A carried 3D peg figure on top of everything, held by the head
export function createRagdoll(reducedMotion) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ragdoll';
  canvas.hidden = true;
  canvas.style.width = `${STAGE_PX[0]}px`;
  canvas.style.height = `${STAGE_PX[1]}px`;
  document.body.append(canvas);
  const tune = reducedMotion ? { ...CARRY, force: REDUCED_FORCE } : CARRY;
  let renderer = null;
  let scene = null;
  let camera = null;
  let materials = null;
  let carried = null;
  let cursor = [0, 0];
  let frame = 0;
  let lastTime = 0;

  const follow = (event) => {
    cursor = [event.clientX, event.clientY];
  };
  // Always tracked, so a carry starts where the pointer is
  window.addEventListener('pointermove', follow);
  window.addEventListener('pointerdown', follow);
  window.addEventListener('dragover', follow);

  // Renderer made on first use, with its own lights and an orthographic camera
  function stage() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(STAGE_PX[0], STAGE_PX[1], false);
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(LIGHT_SKY, LIGHT_GROUND, LIGHT_SOFT));
    const key = new THREE.DirectionalLight(0xffffff, LIGHT_KEY);
    key.position.set(...KEY_FROM);
    scene.add(key);
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    camera.up.copy(UP);
    materials = figureMaterials();
  }

  // Bone matrices from the swing: head held, torso and hips hang and bend, hands on pendulums
  function pose() {
    const { bones, joints, toward, carry } = carried;
    const turn = new THREE.Matrix4().makeRotationZ(carry.yaw.angle);
    const screen = (angle) => new THREE.Matrix4().makeRotationAxis(toward, angle);
    const squash = new THREE.Matrix4().makeScale(...stretchScale(carry.stretch.angle));
    const about = (pivotWorld, rotation, pivotRest, scale = null) => {
      const matrix = new THREE.Matrix4().makeTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z).multiply(rotation).multiply(turn);
      if (scale) matrix.multiply(scale);
      return matrix.multiply(new THREE.Matrix4().makeTranslation(-pivotRest.x, -pivotRest.y, -pivotRest.z));
    };
    const head = about(joints.head, new THREE.Matrix4(), joints.head);
    const neck = joints.neck.clone().applyMatrix4(head);
    const torso = about(neck, screen(carry.torso.angle), joints.neck, squash);
    const waist = joints.waist.clone().applyMatrix4(torso);
    const hips = about(waist, screen(carry.torso.angle + carry.waist.angle), joints.waist, squash);
    const matrices = { head, torso, hips };
    ['L', 'R'].forEach((side, index) => {
      const shoulder = joints['shoulder' + side].clone().applyMatrix4(torso);
      matrices['hand' + side] = about(shoulder, screen(carry.torso.angle + carry.hands[index].angle), joints['shoulder' + side]);
    });
    for (const [name, group] of Object.entries(bones)) group.matrix.copy(matrices[name] || head);
  }

  function draw(time) {
    if (!carried) return;
    const dt = lastTime ? (time - lastTime) / 1000 : 0;
    lastTime = time;
    stepCarry(carried.carry, cursor, dt, tune);
    canvas.style.transform = `translate(${cursor[0] - STAGE_PX[0] * HEAD_AT[0]}px, ${cursor[1] + GRIP_PX + carried.hang - STAGE_PX[1] * HEAD_AT[1]}px)`;
    pose();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  }

  function clear() {
    if (!carried) return;
    scene.remove(carried.root);
    carried.root.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      if (child.material.map) {
        child.material.map.dispose();
        child.material.dispose();
      }
    });
    carried = null;
  }

  return {
    // figure from makeFigure; the head centre sits at a fixed spot in the overlay
    start(figure) {
      stage();
      clear();
      const root = new THREE.Group();
      const bones = figureBones(figure, materials);
      for (const group of Object.values(bones)) {
        group.matrixAutoUpdate = false;
        root.add(group);
      }
      scene.add(root);
      const vector = (point) => new THREE.Vector3(...point);
      const joints = Object.fromEntries(Object.entries(figure.joints).map(([name, point]) => [name, vector(point)]));
      const basis = viewBasis(FIGURE_VIEW);
      const toward = vector(basis.toward).normalize();
      // Camera framed so the head centre lands on HEAD_AT
      const mmPerPx = figure.heightMm / SHOWN_HEIGHT_PX;
      const right = vector(basis.right);
      const up = vector(basis.up);
      const centre = joints.head.clone().add(right.clone().multiplyScalar((0.5 - HEAD_AT[0]) * STAGE_PX[0] * mmPerPx)).add(up.clone().multiplyScalar((HEAD_AT[1] - 0.5) * STAGE_PX[1] * mmPerPx));
      camera.left = (-STAGE_PX[0] / 2) * mmPerPx;
      camera.right = (STAGE_PX[0] / 2) * mmPerPx;
      camera.top = (STAGE_PX[1] / 2) * mmPerPx;
      camera.bottom = (-STAGE_PX[1] / 2) * mmPerPx;
      camera.position.copy(centre).add(toward.clone().multiplyScalar(200));
      camera.lookAt(centre);
      camera.updateProjectionMatrix();
      const headRadius = figure.parts.find((part) => part.name === 'head').r;
      carried = { root, bones, joints, toward, carry: makeCarry(cursor), hang: headRadius / mmPerPx };
      lastTime = 0;
      canvas.hidden = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    },
    stop() {
      clear();
      canvas.hidden = true;
      cancelAnimationFrame(frame);
    },
  };
}
