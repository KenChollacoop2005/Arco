import * as THREE from '../../vendor/three/three.module.min.js';
import { DECOR_TYPES } from '../core/decor.js';
import { sectionPlanes } from './materials.js';

const DECOR_ROUGHNESS = 0.9; // matte, like the concrete
const UP = new THREE.Vector3(0, 0, 1);

// Instanced decor, outside picking, checks and export
export function createDecor(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const parts = new Map();
  for (const [type, kind] of Object.entries(DECOR_TYPES)) {
    const geometry = new THREE.BoxGeometry(kind.size[0], kind.size[1], kind.size[2]);
    geometry.translate(0, 0, kind.size[2] / 2);
    const material = new THREE.MeshStandardMaterial({ color: kind.color, roughness: DECOR_ROUGHNESS, metalness: 0, clippingPlanes: sectionPlanes });
    parts.set(type, { geometry, material, mesh: null });
  }
  const shift = new THREE.Matrix4();
  const place = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3(1, 1, 1);

  function clear() {
    for (const part of parts.values()) {
      if (!part.mesh) continue;
      group.remove(part.mesh);
      part.mesh.dispose();
      part.mesh = null;
    }
  }

  return {
    group,
    set(items) {
      clear();
      for (const [type, part] of parts) {
        const own = items.filter((item) => item.type === type);
        if (own.length === 0) continue;
        part.mesh = new THREE.InstancedMesh(part.geometry, part.material, own.length);
        part.mesh.castShadow = true;
        part.mesh.receiveShadow = true;
        own.forEach((item, order) => {
          place.set(item.position[0], item.position[1], item.position[2]);
          turn.setFromAxisAngle(UP, item.turn);
          part.mesh.setMatrixAt(order, shift.compose(place, turn, size));
        });
        group.add(part.mesh);
      }
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
  };
}
