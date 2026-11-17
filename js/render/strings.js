import * as THREE from '../../vendor/three/three.module.min.js';
import { STORY_MM, CELL_MM, CURVE_LIGHT_STEPS } from '../config.js';
import { sectionPlanes } from './materials.js';

// Port fittings: color, size across, size up, depth off the wall
const PORT_LOOK = {
  power: [0x34332f, 1.6, 2, 1.3],
  'water-in': [0x5f7f8c, 2.4, 2.4, 0.9],
  'water-out': [0x5f7f8c, 2.4, 2.4, 0.9],
  line: [0x222222, 0.9, 0.9, 1.1],
};
// String looks: color, radius, radius on weak devices
const STRING_LOOK = {
  pipe: [0x737d82, 0.85, 0.6],
  wire: [0x1f1f1f, 0.42, 0.3],
  line: [0x101010, 0.25, 0.2],
};
const TUBE_SIDES = 7; // facets around a tube
const BRACKET_EVERY_MM = 1.5 * CELL_MM; // pipe bracket spacing along a run
const BRACKET_MM = [1.2, 2.4]; // bracket length along the pipe, width
const COLLAR_EVERY_MM = STORY_MM / 2; // collar spacing on a pipe down a facade
const COLLAR_MM = [1.6, 0.8]; // collar radius and height
const SHEET_COLOR = 0x6fd3e3; // overflow water cyan
const SHEET_OPACITY = 0.45; // overflow sheets are see-through
const SHEET_WIDE_MM = [2, 0.6, 5]; // sheet width: base, per unit, most
const SHEET_THICK_MM = 0.25; // sheet thickness
const LIGHT_SHARE = 0.5; // share of strings drawn on weak devices
const VERTICAL_TOL = 0.98; // a segment this upright counts as down a facade

// Ports, pipes, cables, lines and overflow; render only, never picked or exported
export function createStrings(view) {
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const tube = new THREE.CylinderGeometry(1, 1, 1, TUBE_SIDES, 1, false);
  const metal = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, clippingPlanes: sectionPlanes });
  const looks = {};
  for (const [type, [color]] of Object.entries(STRING_LOOK)) looks[type] = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, clippingPlanes: sectionPlanes });
  const water = new THREE.MeshStandardMaterial({ color: SHEET_COLOR, roughness: 0.15, metalness: 0, transparent: true, opacity: SHEET_OPACITY, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: sectionPlanes });
  const meshes = [];
  const matrix = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const middle = new THREE.Vector3();
  const size = new THREE.Vector3();
  const out = new THREE.Vector3();
  const across = new THREE.Vector3();
  const up = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  function clear() {
    for (const mesh of meshes.splice(0)) {
      group.remove(mesh);
      mesh.dispose();
    }
  }

  function addMesh(geometry, material, count, fill) {
    if (count === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    fill(mesh);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    meshes.push(mesh);
  }

  // Cylinder from one point to another
  function tubeMatrix(from, to, radius) {
    out.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = out.length();
    turn.setFromUnitVectors(axisY, out.normalize());
    middle.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    size.set(radius, length, radius);
    return matrix.compose(middle, turn, size);
  }

  // Fewer pieces per hanging string on weak devices
  function thin(points, light) {
    if (!light || points.length <= CURVE_LIGHT_STEPS + 3) return points;
    const inner = points.slice(1, -1);
    const kept = [];
    for (let step = 0; step <= CURVE_LIGHT_STEPS; step++) kept.push(inner[Math.round((step * (inner.length - 1)) / CURVE_LIGHT_STEPS)]);
    return [points[0], ...kept, points[points.length - 1]];
  }

  function setPorts(ports) {
    addMesh(cube, metal, ports.length, (mesh) => {
      ports.forEach((port, order) => {
        const [color, wide, tall, deep] = PORT_LOOK[port.type];
        out.set(port.normal[0], port.normal[1], port.normal[2]).normalize();
        up.set(0, 0, 1);
        across.crossVectors(up, out).normalize();
        basis.makeBasis(across, out, up);
        turn.setFromRotationMatrix(basis);
        middle.set(port.position[0] + (out.x * deep) / 2, port.position[1] + (out.y * deep) / 2, port.position[2]);
        size.set(wide, deep, tall);
        mesh.setMatrixAt(order, matrix.compose(middle, turn, size));
        mesh.setColorAt(order, tint.setHex(color));
      });
    });
  }

  // Strings of one type as tubes, with brackets and collars on pipes
  function setStrings(type, strings, light) {
    const radius = STRING_LOOK[type][light ? 2 : 1];
    const pieces = [];
    const fixings = [];
    for (const string of strings) {
      const points = thin(string.points, light);
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 1e-6) continue;
        pieces.push([from, to]);
        if (type !== 'pipe' || light) continue;
        // Brackets along runs, collars on drops down a facade
        const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const upright = Math.abs(to[2] - from[2]) / length > VERTICAL_TOL;
        const every = upright ? COLLAR_EVERY_MM : BRACKET_EVERY_MM;
        for (let at = every / 2; at < length; at += every) {
          const share = at / length;
          fixings.push({ at: [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * share), from, to, upright });
        }
      }
    }
    addMesh(tube, looks[type], pieces.length, (mesh) => pieces.forEach(([from, to], order) => mesh.setMatrixAt(order, tubeMatrix(from, to, radius))));
    addMesh(tube, metal, fixings.length, (mesh) => {
      fixings.forEach((fixing, order) => {
        const [collar, height] = fixing.upright ? COLLAR_MM : [BRACKET_MM[1] / 2, BRACKET_MM[0]];
        out.set(fixing.to[0] - fixing.from[0], fixing.to[1] - fixing.from[1], fixing.to[2] - fixing.from[2]).normalize();
        const from = fixing.at.map((value, axis) => value - (out.getComponent(axis) * height) / 2);
        const to = fixing.at.map((value, axis) => value + (out.getComponent(axis) * height) / 2);
        mesh.setMatrixAt(order, tubeMatrix(from, to, collar));
        mesh.setColorAt(order, tint.setHex(0x55595c));
      });
    });
  }

  // Thin falling sheets of overflow water
  function setSheets(sheets) {
    addMesh(cube, water, sheets.length, (mesh) => {
      sheets.forEach((sheet, order) => {
        const [lip, foot] = sheet.points;
        const wide = Math.min(SHEET_WIDE_MM[2], SHEET_WIDE_MM[0] + SHEET_WIDE_MM[1] * sheet.units);
        out.set(foot[0] - lip[0], foot[1] - lip[1], foot[2] - lip[2]);
        const length = Math.max(out.length(), 0.01);
        out.normalize();
        across.set(-lip[1], lip[0], 0);
        if (across.lengthSq() < 1e-9) across.set(1, 0, 0);
        across.normalize();
        up.crossVectors(out, across).normalize();
        basis.makeBasis(across, out, up);
        turn.setFromRotationMatrix(basis);
        middle.set((lip[0] + foot[0]) / 2, (lip[1] + foot[1]) / 2, (lip[2] + foot[2]) / 2);
        size.set(wide, length, SHEET_THICK_MM);
        mesh.setMatrixAt(order, matrix.compose(middle, turn, size));
      });
    });
  }

  return {
    group,
    // Ports and strings from the services plan; light draws fewer and thinner
    set({ ports = [], pipes = [], wires = [], lines = [], sheets = [] } = {}, light = false) {
      clear();
      const keep = (list) => (light ? list.slice(0, Math.ceil(list.length * LIGHT_SHARE)) : list);
      setPorts(ports);
      setStrings('pipe', keep(pipes), light);
      setStrings('wire', keep(wires), light);
      setStrings('line', keep(lines), light);
      setSheets(sheets);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
  };
}
