import * as THREE from '../../vendor/three/three.module.min.js';
import { figureMesh, figureMaterial } from './figure.js';

const PIN_HEAD_MM = 2.4; // pin ball radius
const PIN_STEM_MM = 0.45; // pin stem radius
const PIN_STEM_LENGTH_MM = 6; // stem below the ball
const PIN_SEGMENTS = 12; // pin roundness
const MAX_PINS = 256; // pins drawn at once

// Pins above occupied homes, and one figure for the selected resident
export function createResidentMarks(view) {
  const group = new THREE.Group();
  view.scene.add(group);
  const head = new THREE.SphereGeometry(PIN_HEAD_MM, PIN_SEGMENTS, PIN_SEGMENTS / 2);
  const stem = new THREE.CylinderGeometry(PIN_STEM_MM, PIN_STEM_MM * 0.4, PIN_STEM_LENGTH_MM, PIN_SEGMENTS / 2).rotateX(Math.PI / 2).translate(0, 0, -PIN_STEM_LENGTH_MM / 2);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
  const heads = new THREE.InstancedMesh(head, material, MAX_PINS);
  const stems = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.8 }), MAX_PINS);
  for (const mesh of [heads, stems]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const bodyMaterial = figureMaterial();
  const figures = new Map();
  let figure = null;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  return {
    group,
    // pins: [{point: [x, y, z], color}], the ball at the point
    setPins(pins) {
      const shown = pins.slice(0, MAX_PINS);
      shown.forEach((pin, index) => {
        matrix.makeTranslation(...pin.point);
        heads.setMatrixAt(index, matrix);
        stems.setMatrixAt(index, matrix);
        heads.setColorAt(index, color.set(pin.color));
      });
      heads.count = stems.count = shown.length;
      heads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      view.requestRender();
    },
    // One standing figure, or none; facing turns it about z
    setFigure(made, point, facing = 0) {
      if (figure) group.remove(figure);
      figure = null;
      if (made && point) {
        const key = JSON.stringify(made.params);
        if (!figures.has(key)) figures.set(key, figureMesh(made, bodyMaterial));
        figure = figures.get(key);
        figure.position.set(...point);
        figure.rotation.set(0, 0, facing);
        group.add(figure);
      }
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    warm: [{ material, kind: 'instanced', colored: true }, { material: bodyMaterial, kind: 'mesh', shadows: true }],
  };
}
