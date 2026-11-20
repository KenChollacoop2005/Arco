import * as THREE from '../../vendor/three/three.module.min.js';

const PORT_MARK_MM = 1.7; // port marker radius in the wiring tool
const PORT_LIFT_MM = 0.9; // markers sit this far out of their wall
const MAX_MARKS = 600; // port markers drawn at once
const MARK_ORDER = 4; // drawn over modules and strings
const TYPE_COLORS = { power: 0xe0a800, 'water-out': 0x1f6fb2, 'water-in': 0x67b7e3, line: 0x8a7f72 }; // marker colour per port type
export const PORT_COLORS = TYPE_COLORS;
const PICKED_COLOR = 0xff5a1f; // the port being connected from
const BLOCKED_COLOR = 0xc0392b; // candidates with no clear route, and refused ghosts
const DIM_COLOR = 0xb8b4ac; // ports out of play while one is picked
const NO_ROUTE_COLOR = 0x8f8a82; // matching ports with no legal route
const GHOST_OK_COLOR = 0x2f9e5a; // ghost string with a legal route
const SELECTED_COLOR = 0xff5a1f; // the selected string
const SCALES = { normal: 1, dim: 0.6, candidate: 1.4, blocked: 0.8, picked: 1.7, hover: 1.7 }; // marker size per state
const DASH_MM = [2.2, 1.4]; // ghost dash and gap

// Wiring tool marks: every port as a coloured ball, the ghost string and the selected string
export function createWireMarks(view) {
  const group = new THREE.Group();
  group.renderOrder = MARK_ORDER;
  group.visible = false;
  view.scene.add(group);
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(PORT_MARK_MM, 14, 10), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), MAX_MARKS);
  balls.renderOrder = MARK_ORDER;
  balls.count = 0;
  balls.frustumCulled = false;
  group.add(balls);
  const lineOf = (material) => {
    const line = new THREE.Line(new THREE.BufferGeometry(), material);
    line.renderOrder = MARK_ORDER;
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);
    return line;
  };
  const ghost = lineOf(new THREE.LineDashedMaterial({ color: GHOST_OK_COLOR, dashSize: DASH_MM[0], gapSize: DASH_MM[1], depthTest: false, transparent: true }));
  const selected = lineOf(new THREE.LineBasicMaterial({ color: SELECTED_COLOR, depthTest: false, transparent: true }));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  function setLine(line, points) {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints((points || []).map((point) => new THREE.Vector3(...point)));
    if (line === ghost) line.computeLineDistances();
    line.visible = !!points && points.length > 1;
  }

  return {
    // ports: [{position, normal, type, state}], state one of normal, dim, candidate, blocked, picked, hover
    setPorts(ports) {
      const shown = ports.slice(0, MAX_MARKS);
      shown.forEach((port, index) => {
        const scale = SCALES[port.state] || 1;
        const at = port.position.map((value, axis) => value + (port.normal ? port.normal[axis] * PORT_LIFT_MM : 0));
        matrix.makeScale(scale, scale, scale).setPosition(...at);
        balls.setMatrixAt(index, matrix);
        const tone = port.state === 'picked' ? PICKED_COLOR : port.state === 'blocked' ? NO_ROUTE_COLOR : port.state === 'dim' ? DIM_COLOR : TYPE_COLORS[port.type] || DIM_COLOR;
        balls.setColorAt(index, color.setHex(tone));
      });
      balls.count = shown.length;
      balls.instanceMatrix.needsUpdate = true;
      if (balls.instanceColor) balls.instanceColor.needsUpdate = true;
      view.requestRender();
    },
    // Dashed preview of a route; ok picks the colour
    setGhost(points, ok = true) {
      ghost.material.color.setHex(ok ? GHOST_OK_COLOR : BLOCKED_COLOR);
      setLine(ghost, points);
      view.requestRender();
    },
    setSelected(points) {
      setLine(selected, points);
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    colors: TYPE_COLORS,
  };
}
