import * as THREE from '../../vendor/three/three.module.min.js';
import { GROW_ZONE_COLOR, GROW_ZONE_OPACITY } from '../config.js';

const SPHERE_SEGMENTS = 32; // zone sphere roundness
const ZONE_ORDER = 2; // drawn after the modules

// Translucent sphere marking the Grow here zone
export function createZone(view) {
  const material = new THREE.MeshBasicMaterial({ color: GROW_ZONE_COLOR, transparent: true, opacity: GROW_ZONE_OPACITY, depthWrite: false });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2), material);
  sphere.renderOrder = ZONE_ORDER;
  sphere.visible = false;
  view.scene.add(sphere);
  return {
    // Centre in mm and radius in mm, or null to hide
    set(center, radius) {
      sphere.visible = !!center;
      if (center) {
        sphere.position.set(center[0], center[1], center[2]);
        sphere.scale.setScalar(radius);
      }
      view.requestRender();
    },
  };
}
