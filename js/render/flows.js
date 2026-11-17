import * as THREE from '../../vendor/three/three.module.min.js';
import { sectionPlanes } from './materials.js';

const WATER_COLOR = 0x3f8fc4; // channel and waterfall blue
const WATER_OPACITY = 0.82; // water strips let concrete show through
const RUN_WIDE_MM = 2.2; // channel width
const RUN_THICK_MM = 0.5; // channel depth
const DROP_WIDE_MM = 1.8; // falling sheet width
const DROP_THICK_MM = 0.5; // falling sheet thickness
const FALL_WIDE_MM = 3; // waterfall width off the plinth

// Instanced flow lines, outside picking, checks and export
export function createFlows(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const water = new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.25, metalness: 0, transparent: true, opacity: WATER_OPACITY, clippingPlanes: sectionPlanes });
  let mesh = null;
  const shift = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const along = new THREE.Vector3();
  const side = new THREE.Vector3();
  const third = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const size = new THREE.Vector3();
  const turn = new THREE.Quaternion();

  function clear() {
    if (!mesh) return;
    group.remove(mesh);
    mesh.dispose();
    mesh = null;
  }

  return {
    group,
    // Water segments: from, to, kind, across
    set(segments) {
      clear();
      if (segments.length > 0) {
        mesh = new THREE.InstancedMesh(geometry, water, segments.length);
        segments.forEach((segment, order) => {
          along.set(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1], segment.to[2] - segment.from[2]);
          const length = along.length();
          along.normalize();
          side.set(segment.across[0], segment.across[1], 0);
          third.crossVectors(along, side).normalize();
          basis.makeBasis(along, side, third);
          turn.setFromRotationMatrix(basis);
          middle.set((segment.from[0] + segment.to[0]) / 2, (segment.from[1] + segment.to[1]) / 2, (segment.from[2] + segment.to[2]) / 2);
          const wide = segment.kind === 'run' ? RUN_WIDE_MM : segment.kind === 'fall' ? FALL_WIDE_MM : DROP_WIDE_MM;
          size.set(length + (segment.kind === 'run' ? RUN_WIDE_MM : 0), wide, segment.kind === 'run' ? RUN_THICK_MM : DROP_THICK_MM);
          mesh.setMatrixAt(order, shift.compose(middle, turn, size));
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
  };
}
