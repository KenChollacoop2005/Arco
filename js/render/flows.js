import * as THREE from '../../vendor/three/three.module.min.js';
import { sectionPlanes } from './materials.js';

const TARP_SAG_MM = 3; // tarp middle hangs this far below its corners
const TARP_OPACITY = 0.9; // tarps let a little light through

// Tarp mesh, outside picking, checks and export
export function createFlows(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: TARP_OPACITY, clippingPlanes: sectionPlanes });
  let tarpMesh = null;

  function clear() {
    if (tarpMesh) {
      group.remove(tarpMesh);
      tarpMesh.geometry.dispose();
      tarpMesh = null;
    }
  }

  // Tarps as fans from a sagging middle, one mesh
  function setTarps(tarps) {
    if (tarps.length === 0) return;
    const positions = [];
    const colors = [];
    const tint = new THREE.Color();
    for (const tarp of tarps) {
      tint.setHex(tarp.color);
      const low = [tarp.middle[0], tarp.middle[1], tarp.middle[2] - TARP_SAG_MM];
      tarp.points.forEach((corner, index) => {
        const next = tarp.points[(index + 1) % tarp.points.length];
        for (const point of [low, corner, next]) {
          positions.push(point[0], point[1], point[2]);
          colors.push(tint.r, tint.g, tint.b);
        }
      });
    }
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    shape.computeVertexNormals();
    tarpMesh = new THREE.Mesh(shape, cloth);
    group.add(tarpMesh);
  }

  return {
    group,
    set(tarps = []) {
      clear();
      setTarps(tarps);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
  };
}
