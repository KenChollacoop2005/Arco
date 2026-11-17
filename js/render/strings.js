import * as THREE from '../../vendor/three/three.module.min.js';
import { sectionPlanes } from './materials.js';

// Port fittings: color, size across, size up, depth off the wall
const PORT_LOOK = {
  power: [0x34332f, 1.6, 2, 1.3],
  'water-in': [0x5f7f8c, 2.4, 2.4, 0.9],
  'water-out': [0x5f7f8c, 2.4, 2.4, 0.9],
  line: [0x222222, 0.9, 0.9, 1.1],
};

// Ports, pipes, cables and lines; render only, never picked or exported
export function createStrings(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const metal = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, clippingPlanes: sectionPlanes });
  let fittings = null;
  const matrix = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const middle = new THREE.Vector3();
  const size = new THREE.Vector3();
  const out = new THREE.Vector3();
  const across = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tint = new THREE.Color();

  function drop(mesh) {
    if (!mesh) return null;
    group.remove(mesh);
    mesh.dispose();
    return null;
  }

  // One small fitting per active port, set on its wall
  function setPorts(ports) {
    fittings = drop(fittings);
    if (ports.length === 0) return;
    fittings = new THREE.InstancedMesh(cube, metal, ports.length);
    ports.forEach((port, order) => {
      const [color, wide, tall, deep] = PORT_LOOK[port.type];
      out.set(port.normal[0], port.normal[1], port.normal[2]).normalize();
      up.set(0, 0, 1);
      across.crossVectors(up, out).normalize();
      basis.makeBasis(across, out, up);
      turn.setFromRotationMatrix(basis);
      middle.set(port.position[0] + out.x * deep / 2, port.position[1] + out.y * deep / 2, port.position[2]);
      size.set(wide, deep, tall);
      fittings.setMatrixAt(order, matrix.compose(middle, turn, size));
      fittings.setColorAt(order, tint.setHex(color));
    });
    fittings.instanceMatrix.needsUpdate = true;
    fittings.instanceColor.needsUpdate = true;
    group.add(fittings);
  }

  return {
    group,
    set({ ports = [] } = {}) {
      setPorts(ports);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
  };
}
