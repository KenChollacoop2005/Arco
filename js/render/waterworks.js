import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../config.js';
import { instancePose, poseApply, worldFromModules, columnTop, cellInPlinth } from '../core/grid.js';
import { buildRecipe } from '../core/recipes.js';
import { sharedUniforms, sectionPlanes } from './materials.js';

const RIM_MM = (PLINTH_DIAMETER_CELLS * CELL_MM) / 2; // plinth radius
const CHANNEL_MM = 14; // stream width
const STREAM_LIFT_MM = 0.35; // water sits this far over the plinth top
const BANK_MM = [1.4, 0.7]; // bank strip width and height
const RIM_FALL_MM = 70; // a fall off the rim drops this far as it fades
const POUR_PAST_MM = 60; // a pour past the plinth edge drops this far as it fades
const POUR_WIDE_MM = 2.2; // pour ribbon width
const POUR_OUT_MM = 1.5; // pour leaves the outlet this far out
const FLOW_SPEED = 0.9; // ripple speed, cycles per second
const RIPPLE_MM = 9; // ripple spacing along the flow
export const STREAM_COLOR = 0x6fa7bd; // stream water
export const STREAM_OPACITY = 0.85; // stream water opacity
const POUR_LOOK = { runoff: [0xcfe6ee, 0.75], disposal: [0x6b6840, 0.85] }; // pour color and opacity
const BANK_COLOR = 0x8a857b; // stream bank strips
const BOX_LOOK = [0x5d635b, 3, 3.8, 2.2]; // junction box color, width, height, depth
const POURING = ['runoff', 'disposal']; // families that pour

// Flowing water: ripples move with Effects on; clip follows the section cut
export function flowMaterial(color, opacity, clip = false) {
  return new THREE.ShaderMaterial({
    clipping: clip,
    clippingPlanes: clip ? sectionPlanes : null,
    uniforms: { uTime: sharedUniforms.uTime, uEffects: sharedUniforms.uEffects, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: `attribute float aAlong;
attribute float aFade;
varying float vAlong;
varying float vFade;
#include <clipping_planes_pars_vertex>
void main() {
  vAlong = aAlong;
  vFade = aFade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`,
    fragmentShader: `uniform float uTime;
uniform float uEffects;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlong;
varying float vFade;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float ripple = 0.5 + 0.5 * sin((vAlong / ${RIPPLE_MM.toFixed(1)} - uTime * ${FLOW_SPEED.toFixed(2)} * uEffects) * 6.2831853);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.2 * ripple), uOpacity * vFade);
}`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Quads with along and fade per corner
export function quadGeometry(quads) {
  const positions = [];
  const along = [];
  const fade = [];
  const index = [];
  for (const quad of quads) {
    const base = positions.length / 3;
    for (const corner of quad) {
      positions.push(...corner.point);
      along.push(corner.along);
      fade.push(corner.fade);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geometry.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  geometry.setIndex(index);
  return geometry;
}

// Vertical ribbon falling from a point, its width across a side direction
function fallQuads(top, side, drop, startAlong, fadeOut) {
  const half = side.map((value) => (value * POUR_WIDE_MM) / 2);
  const corner = (point, along, fade) => ({ point, along, fade });
  const low = [top[0], top[1], top[2] - drop];
  const quads = [];
  // Two crossed ribbons read from every side
  for (const across of [half, [-half[1], half[0], 0]]) {
    quads.push([
      corner([top[0] - across[0], top[1] - across[1], top[2]], startAlong, 1),
      corner([top[0] + across[0], top[1] + across[1], top[2]], startAlong, 1),
      corner([low[0] + across[0], low[1] + across[1], low[2]], startAlong + drop, fadeOut ? 0 : 1),
      corner([low[0] - across[0], low[1] - across[1], low[2]], startAlong + drop, fadeOut ? 0 : 1),
    ]);
  }
  return quads;
}

// Stream, pours and junction boxes; render only, never picked or exported
export function createWaterworks(view) {
  const group = new THREE.Group();
  view.scene.add(group);
  const streamMaterial = flowMaterial(STREAM_COLOR, STREAM_OPACITY);
  const pourMaterials = Object.fromEntries(Object.entries(POUR_LOOK).map(([family, [color, opacity]]) => [family, flowMaterial(color, opacity)]));
  const bankMaterial = new THREE.MeshStandardMaterial({ color: BANK_COLOR, roughness: 0.9 });
  const boxMaterial = new THREE.MeshStandardMaterial({ color: BOX_LOOK[0], roughness: 0.6, metalness: 0.2 });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const parts = { stream: [], pours: [], boxes: [] };
  let flowing = false;

  function drop(kind) {
    for (const mesh of parts[kind].splice(0)) {
      group.remove(mesh);
      if (mesh.geometry !== cube) mesh.geometry.dispose();
      if (mesh.isInstancedMesh) mesh.dispose();
    }
  }
  const keep = (kind, mesh) => {
    parts[kind].push(mesh);
    group.add(mesh);
  };
  const refreshFlowing = () => {
    flowing = parts.stream.length > 0 || parts.pours.length > 0;
    view.requestRender();
  };

  // Channel strip along the stream cells, with banks, falling off the rim at its end
  function setStream(record) {
    drop('stream');
    if (record && record.cells.length > 0) {
      const axis = record.alongX ? 0 : 1;
      const cross = 1 - axis;
      const lineAt = (record.line + 0.5) * CELL_MM;
      const values = record.cells.map((cell) => cell[axis]);
      const upstream = record.flow > 0 ? Math.min(...values) * CELL_MM : (Math.max(...values) + 1) * CELL_MM;
      const rimAt = record.flow * Math.sqrt(Math.max(0, RIM_MM * RIM_MM - lineAt * lineAt));
      const point = (along, across, z) => {
        const out = [0, 0, z];
        out[axis] = along;
        out[cross] = lineAt + across;
        return out;
      };
      const length = Math.abs(rimAt - upstream);
      const half = CHANNEL_MM / 2;
      const corner = (along, across, z, fade, distance) => ({ point: point(along, across, z), along: distance, fade });
      const quads = [[corner(upstream, -half, STREAM_LIFT_MM, 1, 0), corner(rimAt, -half, STREAM_LIFT_MM, 1, length), corner(rimAt, half, STREAM_LIFT_MM, 1, length), corner(upstream, half, STREAM_LIFT_MM, 1, 0)]];
      // Off the rim: a sheet that falls and fades into nothing
      quads.push([corner(rimAt, -half, STREAM_LIFT_MM, 1, length), corner(rimAt, half, STREAM_LIFT_MM, 1, length), corner(rimAt, half, -RIM_FALL_MM, 0, length + RIM_FALL_MM), corner(rimAt, -half, -RIM_FALL_MM, 0, length + RIM_FALL_MM)]);
      keep('stream', new THREE.Mesh(quadGeometry(quads), streamMaterial));
      const banks = new THREE.InstancedMesh(cube, bankMaterial, 2);
      const matrix = new THREE.Matrix4();
      [-1, 1].forEach((sign, order) => {
        const middle = point((upstream + rimAt) / 2, sign * (half + BANK_MM[0] / 2), BANK_MM[1] / 2);
        const size = [0, 0, BANK_MM[1]];
        size[axis] = length;
        size[cross] = BANK_MM[0];
        matrix.makeScale(...size).setPosition(...middle);
        banks.setMatrixAt(order, matrix);
      });
      banks.instanceMatrix.needsUpdate = true;
      keep('stream', banks);
    }
    refreshFlowing();
  }

  // Pours from runoff and disposal outlets, down to what is below or past the rim
  function setPours(modules) {
    drop('pours');
    const world = worldFromModules(modules);
    const byFamily = {};
    for (const instance of modules) {
      if (!POURING.includes(instance.family)) continue;
      const pose = instancePose(instance);
      for (const outlet of buildRecipe(instance).anchors.outlet) {
        const at = poseApply(pose, ...outlet.at);
        const dir = poseApply({ turns: pose.turns, x: 0, y: 0, z: 0 }, ...outlet.dir).map(Math.round);
        const top = at.map((value, axis) => value + dir[axis] * POUR_OUT_MM);
        const cellX = Math.floor(top[0] / CELL_MM);
        const cellY = Math.floor(top[1] / CELL_MM);
        const inside = cellInPlinth(cellX, cellY);
        const landing = inside ? columnTop(world, cellX, cellY, Math.floor(top[2] / STORY_MM)) * STORY_MM : -POUR_PAST_MM;
        const quads = fallQuads(top, [-dir[1], dir[0], 0], top[2] - landing, 0, !inside);
        (byFamily[instance.family] = byFamily[instance.family] || []).push(...quads);
      }
    }
    for (const [family, quads] of Object.entries(byFamily)) keep('pours', new THREE.Mesh(quadGeometry(quads), pourMaterials[family]));
    refreshFlowing();
  }

  // Junction boxes at relay brackets
  function setBoxes(ports) {
    drop('boxes');
    const relays = ports.filter((port) => port.relay);
    if (relays.length > 0) {
      const mesh = new THREE.InstancedMesh(cube, boxMaterial, relays.length);
      const [, wide, tall, deep] = BOX_LOOK;
      const matrix = new THREE.Matrix4();
      relays.forEach((port, order) => {
        const size = port.normal[0] !== 0 ? [deep, wide, tall] : [wide, deep, tall];
        const middle = port.position.map((value, axis) => value + (port.normal[axis] * deep) / 2);
        matrix.makeScale(...size).setPosition(...middle);
        mesh.setMatrixAt(order, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      keep('boxes', mesh);
    }
    view.requestRender();
  }

  return {
    group,
    setStream,
    setPours,
    setBoxes,
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    // True when something flows on the plinth
    flowing: () => flowing && group.visible,
  };
}
