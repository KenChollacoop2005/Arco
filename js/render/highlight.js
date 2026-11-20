import * as THREE from '../../vendor/three/three.module.min.js';
import { PLINTH_DIAMETER_CELLS, CELL_MM } from '../config.js';

const FOCUS_COLOR = 0x2a7ab0; // level line, rings and routes
const LEVEL_OPACITY = 0.45; // the level line stays faint
const RING_STEPS = 48; // points around a circle
const FOCUS_ORDER = 3; // drawn over the modules
const LEVEL_RADIUS_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2; // level line runs round the plinth edge

// Trait focus in the scene: a level line round the plinth, light rings and walking or cable routes
export function createHighlight(view) {
  const group = new THREE.Group();
  group.renderOrder = FOCUS_ORDER;
  view.scene.add(group);
  const strong = new THREE.LineBasicMaterial({ color: FOCUS_COLOR, depthTest: false, transparent: true });
  const faint = new THREE.LineBasicMaterial({ color: FOCUS_COLOR, depthTest: false, transparent: true, opacity: LEVEL_OPACITY });

  const circle = (centre, radius) => Array.from({ length: RING_STEPS }, (unused, index) => {
    const angle = (index / RING_STEPS) * Math.PI * 2;
    return new THREE.Vector3(centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius, centre[2]);
  });
  const add = (points, material, closed) => {
    const line = new (closed ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(points), material);
    line.renderOrder = FOCUS_ORDER;
    group.add(line);
  };

  function clear() {
    for (const child of [...group.children]) {
      child.geometry.dispose();
      group.remove(child);
    }
  }

  return {
    // focus from traitFocus, or null to clear
    set(focus) {
      clear();
      if (focus) {
        if (focus.level !== null) add(circle([0, 0, focus.level], LEVEL_RADIUS_MM), faint, true);
        for (const ring of focus.rings) add(circle([ring.point[0], ring.point[1], ring.point[2]], ring.radius), strong, true);
        for (const line of focus.lines) add(line.map((point) => new THREE.Vector3(...point)), strong, false);
      }
      view.requestRender();
    },
  };
}
