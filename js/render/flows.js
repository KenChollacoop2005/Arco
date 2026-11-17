import * as THREE from '../../vendor/three/three.module.min.js';
import { sectionPlanes } from './materials.js';
import { wirePoints } from '../core/flows.js';

const WATER_COLOR = 0x3f8fc4; // channel and waterfall blue
const WATER_OPACITY = 0.82; // water strips let concrete show through
const RUN_WIDE_MM = 2.2; // channel width
const RUN_THICK_MM = 0.5; // channel depth
const DROP_WIDE_MM = 1.8; // falling sheet width
const DROP_THICK_MM = 0.5; // falling sheet thickness
const FALL_WIDE_MM = 3; // waterfall width off the plinth
const WIRE_COLOR = 0x2b2b2b; // dark cable
const WIRE_THICK_MM = 0.6; // cable thickness
const WIRE_STEPS = 8; // straight pieces per hanging wire
const WIRE_LIGHT_STEPS = 3; // pieces per wire on weak devices
const TARP_SAG_MM = 3; // tarp middle hangs this far below its corners
const TARP_OPACITY = 0.9; // tarps let a little light through

// Instanced flow lines, outside picking, checks and export
export function createFlows(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const water = new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.25, metalness: 0, transparent: true, opacity: WATER_OPACITY, clippingPlanes: sectionPlanes });
  const cable = new THREE.MeshStandardMaterial({ color: WIRE_COLOR, roughness: 0.7, metalness: 0, clippingPlanes: sectionPlanes });
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: TARP_OPACITY, clippingPlanes: sectionPlanes });
  let mesh = null;
  let cables = null;
  let tarpMesh = null;
  const shift = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const along = new THREE.Vector3();
  const side = new THREE.Vector3();
  const third = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const size = new THREE.Vector3();
  const turn = new THREE.Quaternion();

  function clear() {
    if (mesh) {
      group.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    if (cables) {
      group.remove(cables);
      cables.dispose();
      cables = null;
    }
    if (tarpMesh) {
      group.remove(tarpMesh);
      tarpMesh.geometry.dispose();
      tarpMesh = null;
    }
  }

  // One box between two points, flat side up
  function place(target, order, from, to, wide, thick, extra) {
    along.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = along.length();
    along.normalize();
    side.set(-along.y, along.x, 0);
    if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
    side.normalize();
    third.crossVectors(along, side).normalize();
    basis.makeBasis(along, side, third);
    turn.setFromRotationMatrix(basis);
    middle.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    size.set(length + extra, wide, thick);
    target.setMatrixAt(order, shift.compose(middle, turn, size));
  }

  // Hanging wires as short straight pieces
  function setWires(wires, light) {
    const steps = light ? WIRE_LIGHT_STEPS : WIRE_STEPS;
    if (wires.length === 0) return;
    cables = new THREE.InstancedMesh(geometry, cable, wires.length * steps);
    let order = 0;
    for (const wire of wires) {
      const points = wirePoints(wire, steps);
      for (let index = 1; index < points.length; index++) place(cables, order++, points[index - 1], points[index], WIRE_THICK_MM, WIRE_THICK_MM, WIRE_THICK_MM);
    }
    cables.instanceMatrix.needsUpdate = true;
    group.add(cables);
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
    // Water segments, wires and tarps; fewer pieces when light
    set(segments, wires = [], tarps = [], light = false) {
      clear();
      setWires(wires, light);
      setTarps(tarps);
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
