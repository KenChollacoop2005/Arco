import * as THREE from '../../vendor/three/three.module.min.js';

const PIN_HEAD_MM = 2.4; // pin ball radius
const PIN_STEM_MM = 0.45; // pin stem radius
const PIN_STEM_LENGTH_MM = 6; // stem below the ball
const PIN_SEGMENTS = 16; // pin roundness
const PIN_ROUGHNESS = 0.28; // glossy like a peg head
const MAX_PINS = 256; // pins drawn at once
const PULSE_GROW = 0.45; // selected pin swells by this share
const PULSE_MS = 900; // one pulse

// Pins above occupied homes; each head a small sphere in the resident's accent
export function createResidentMarks(view, reducedMotion = false) {
  const group = new THREE.Group();
  view.scene.add(group);
  const head = new THREE.SphereGeometry(PIN_HEAD_MM, PIN_SEGMENTS, PIN_SEGMENTS / 2);
  const stem = new THREE.CylinderGeometry(PIN_STEM_MM, PIN_STEM_MM * 0.4, PIN_STEM_LENGTH_MM, PIN_SEGMENTS / 2).rotateX(Math.PI / 2).translate(0, 0, -PIN_STEM_LENGTH_MM / 2);
  const material = new THREE.MeshStandardMaterial({ roughness: PIN_ROUGHNESS, metalness: 0 });
  const heads = new THREE.InstancedMesh(head, material, MAX_PINS);
  const stems = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.8 }), MAX_PINS);
  for (const mesh of [heads, stems]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let pins = [];
  let pulsing = -1;
  let frame = 0;

  // Selected pin swells and settles in a loop
  function pulse(time) {
    if (pulsing < 0 || !pins[pulsing]) return;
    const phase = (time % PULSE_MS) / PULSE_MS;
    const grow = 1 + PULSE_GROW * Math.sin(phase * Math.PI);
    matrix.makeScale(grow, grow, grow).setPosition(...pins[pulsing].point);
    heads.setMatrixAt(pulsing, matrix);
    heads.instanceMatrix.needsUpdate = true;
    view.requestRender();
    frame = requestAnimationFrame(pulse);
  }

  return {
    group,
    // pins: [{point: [x, y, z], color, selected}], the ball at the point
    setPins(next) {
      pins = next.slice(0, MAX_PINS);
      pins.forEach((pin, index) => {
        matrix.makeTranslation(...pin.point);
        if (pin.selected && reducedMotion) matrix.makeScale(1 + PULSE_GROW, 1 + PULSE_GROW, 1 + PULSE_GROW).setPosition(...pin.point);
        heads.setMatrixAt(index, matrix);
        matrix.makeTranslation(...pin.point);
        stems.setMatrixAt(index, matrix);
        heads.setColorAt(index, color.set(pin.color));
      });
      heads.count = stems.count = pins.length;
      heads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      cancelAnimationFrame(frame);
      pulsing = reducedMotion ? -1 : pins.findIndex((pin) => pin.selected);
      if (pulsing >= 0) frame = requestAnimationFrame(pulse);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    warm: [{ material, kind: 'instanced', colored: true }],
  };
}
