import * as THREE from '../../vendor/three/three.module.min.js';
import { STORY_MM, CELL_MM, CURVE_LIGHT_STEPS, PIPE_RADIUS_MM } from '../config.js';
import { sectionPlanes } from './materials.js';
import { flowMaterial, quadGeometry, STREAM_COLOR, STREAM_OPACITY } from './waterworks.js';
import { sheetQuads } from '../core/falls.js';

// Port fittings: color, size across, size up, depth off the wall
const PORT_LOOK = {
  power: [0x34332f, 1.6, 2, 1.3],
  'water-in': [0x5f7f8c, 2.4, 2.4, 0.9],
  'water-out': [0x5f7f8c, 2.4, 2.4, 0.9],
  line: [0x222222, 0.9, 0.9, 1.1],
};
// String looks: color, radius, radius on weak devices
const STRING_LOOK = {
  pipe: [0x737d82, PIPE_RADIUS_MM, 0.6],
  wire: [0x1f1f1f, 0.42, 0.3],
  line: [0x101010, 0.25, 0.2],
};
const TUBE_SIDES = 7; // facets around a tube
const BRACKET_EVERY_MM = 1.5 * CELL_MM; // pipe bracket spacing along a run
const BRACKET_MM = [1.2, 2.4]; // bracket length along the pipe, width
const COLLAR_EVERY_MM = STORY_MM / 2; // collar spacing on a pipe down a facade
const COLLAR_MM = [1.6, 0.8]; // collar radius and height
const LIGHT_SHARE = 0.5; // share of strings drawn on weak devices
const TAG_COLOR = 0xe2b31c; // yellow cable tag
const TAG_MM = [1.4, 0.75]; // tag length along the cable, radius
const VERTICAL_TOL = 0.98; // a segment this upright counts as down a facade
const LAUNDRY_THICK_MM = 0.15; // washing thickness
const TARP_SAG_MM = 3; // tarp middle hangs this far below its corners
const TARP_OPACITY = 0.9; // tarps let a little light through
const TARP_LIGHT = 2; // most tarps on weak devices

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
  const water = flowMaterial(STREAM_COLOR, STREAM_OPACITY, true);
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, clippingPlanes: sectionPlanes });
  const canvas = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: TARP_OPACITY, clippingPlanes: sectionPlanes });
  const meshes = [];
  const plain = [];
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
  let falling = false;

  function clear() {
    for (const mesh of meshes.splice(0)) {
      group.remove(mesh);
      mesh.dispose();
    }
    for (const mesh of plain.splice(0)) {
      group.remove(mesh);
      mesh.geometry.dispose();
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
        // Right-handed basis, so the fitting turns to face its wall
        across.crossVectors(out, up).normalize();
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
      const points = type === 'pipe' ? string.points : thin(string.points, light);
      const spans = new Set(string.spans || []);
      if (type === 'pipe' && !light) {
        for (const collar of string.collars || []) fixings.push({ at: collar.at, from: collar.at, to: collar.at.map((value, axis) => value + collar.direction[axis]), upright: true });
      }
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 1e-6) continue;
        pieces.push([from, to]);
        if (type !== 'pipe' || light) continue;
        // A gap span hangs from a bracket on each wall, nothing between
        if (spans.has(index - 1)) {
          for (const at of [from, to]) fixings.push({ at, from, to, upright: false });
          continue;
        }
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
    // A yellow tag near each end of a power cable
    if (type === 'wire') {
      const tags = strings.flatMap((string) => [[string.points[1], string.points[2]], [string.points[string.points.length - 2], string.points[string.points.length - 3]]]);
      addMesh(tube, metal, tags.length, (mesh) => {
        tags.forEach(([end, next], order) => {
          out.set(next[0] - end[0], next[1] - end[1], next[2] - end[2]).normalize();
          const from = end.map((value, axis) => value + out.getComponent(axis) * 0.4);
          const to = from.map((value, axis) => value + out.getComponent(axis) * TAG_MM[0]);
          mesh.setMatrixAt(order, tubeMatrix(from, to, TAG_MM[1]));
          mesh.setColorAt(order, tint.setHex(TAG_COLOR));
        });
      });
    }
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

  // Overflow spouts and straight falls, fading like the stream's fall
  function setSheets(sheets) {
    if (sheets.length === 0) return;
    const mesh = new THREE.Mesh(quadGeometry(sheets.flatMap(sheetQuads)), water);
    group.add(mesh);
    plain.push(mesh);
  }

  // Washing on the lines, flat pieces facing across the line
  function setLaundry(pieces) {
    addMesh(cube, cloth, pieces.length, (mesh) => {
      pieces.forEach((piece, order) => {
        across.set(piece.along[0], piece.along[1], 0);
        if (across.lengthSq() < 1e-9) across.set(1, 0, 0);
        across.normalize();
        up.set(0, 0, 1);
        out.crossVectors(across, up).normalize();
        basis.makeBasis(across, up, out);
        turn.setFromRotationMatrix(basis);
        middle.set(piece.top[0], piece.top[1], piece.top[2] - piece.drop / 2);
        size.set(piece.width, piece.drop, LAUNDRY_THICK_MM);
        mesh.setMatrixAt(order, matrix.compose(middle, turn, size));
        mesh.setColorAt(order, tint.setHex(piece.color));
      });
    });
  }

  // Tarps as fans from a sagging middle, one mesh
  function setTarps(tarps) {
    if (tarps.length === 0) return;
    const positions = [];
    const colors = [];
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
    const mesh = new THREE.Mesh(shape, canvas);
    group.add(mesh);
    plain.push(mesh);
  }

  const instanced = [metal, ...Object.values(looks), cloth].flatMap((material) => [{ material, kind: 'instanced' }, { material, kind: 'instanced', colored: true }]);
  return {
    group,
    warm: [...instanced, { material: water, kind: 'mesh' }, { material: canvas, kind: 'mesh' }],
    // Ports and strings from the services plan; light draws fewer and thinner
    set({ ports = [], pipes = [], wires = [], lines = [], sheets = [], laundry = [], tarps = [] } = {}, light = false) {
      clear();
      const keep = (list) => (light ? list.slice(0, Math.ceil(list.length * LIGHT_SHARE)) : list);
      setPorts(ports);
      setStrings('pipe', keep(pipes), light);
      setStrings('wire', keep(wires), light);
      setStrings('line', keep(lines), light);
      setSheets(sheets);
      falling = sheets.length > 0;
      setLaundry(keep(laundry));
      setTarps(light ? tarps.slice(0, TARP_LIGHT) : tarps);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    // True when overflow water is on screen
    flowing: () => falling && group.visible,
  };
}
