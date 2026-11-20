import * as THREE from '../../vendor/three/three.module.min.js';

const PORT_MARK_MM = 1.7; // port marker radius in the wiring tool
const PORT_LIFT_MM = 0.9; // markers sit this far out of their wall
const MAX_MARKS = 600; // port markers drawn at once
const MARK_ORDER = 4; // drawn over modules and strings
const TYPE_COLORS = { power: 0xe0a800, 'water-out': 0x1f6fb2, 'water-in': 0x67b7e3, line: 0x8a7f72 }; // marker colour per port type
export const PORT_COLORS = TYPE_COLORS;
const PICKED_COLOR = 0xff5a1f; // the port being connected from
const BLOCKED_COLOR = 0xc0392b; // candidates with no clear route, and refused ghosts
const DIM_COLOR = 0x6f6b65; // ports out of play while one is picked
const NO_ROUTE_COLOR = 0x9a948b; // matching ports with no legal route
const GHOST_OK_COLOR = 0x2f9e5a; // ghost string with a legal route
const SELECTED_COLOR = 0xff5a1f; // the selected string
const SCALES = { normal: 1, dim: 0.5, candidate: 1.6, blocked: 0.75, picked: 1.8, hover: 1.9 }; // marker size per state
const TUBE_MM = 0.55; // ghost and selected string radius
const TUBE_SIDES = 6; // tube sides
const GHOST_OPACITY = 0.8; // ghost string see-through

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
  const tubeOf = (material) => {
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), material);
    tube.renderOrder = MARK_ORDER;
    tube.frustumCulled = false;
    tube.visible = false;
    group.add(tube);
    return tube;
  };
  const ghost = tubeOf(new THREE.MeshBasicMaterial({ color: GHOST_OK_COLOR, depthTest: false, transparent: true, opacity: GHOST_OPACITY }));
  const selected = tubeOf(new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, depthTest: false, transparent: true }));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  // A thin tube along a polyline, one straight piece per segment
  function setLine(tube, points) {
    tube.geometry.dispose();
    const corners = (points || []).map((point) => new THREE.Vector3(...point)).filter((point, index, list) => index === 0 || point.distanceTo(list[index - 1]) > 1e-6);
    tube.visible = corners.length > 1;
    if (!tube.visible) {
      tube.geometry = new THREE.BufferGeometry();
      return;
    }
    const path = new THREE.CurvePath();
    for (let index = 1; index < corners.length; index++) path.add(new THREE.LineCurve3(corners[index - 1], corners[index]));
    tube.geometry = new THREE.TubeGeometry(path, Math.max(1, corners.length - 1) * 2, TUBE_MM, TUBE_SIDES, false);
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
