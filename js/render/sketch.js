import * as THREE from '../../vendor/three/three.module.min.js';
import { STORY_MM } from '../config.js';
import { footprintOutline, instancePose, poseApply } from '../core/grid.js';
import { makeRng } from '../core/rng.js';
import { sharedUniforms } from './materials.js';

const OVERSHOOT_MM = [1.5, 4.5]; // line run past corners
const WOBBLE_MM = 0.45; // sideways drift along a line
const PIECES = 3; // bends per line
const SECOND_STROKE = 0.35; // chance a line is drawn twice
const STROKE_SHIFT_MM = 0.5; // offset of a second stroke
const WEIGHT = [0.35, 0.9]; // line strength range
const DRAW_SHARE = 0.4; // build share spent drawing
const FADE = [0.6, 1.05]; // build share where lines fade
const LIFT_MM = 0.15; // lines sit off the surface
const GRAPHITE = 'vec3(0.2, 0.2, 0.22)'; // sketch line color

const VERTEX = `
attribute vec3 aLine;
uniform float uTime;
uniform float uDuration;
varying float vAlong;
varying float vPhase;
varying float vWeight;
void main() {
  vAlong = aLine.y;
  vWeight = aLine.z;
  vPhase = (uTime - aLine.x) / uDuration;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = `
varying float vAlong;
varying float vPhase;
varying float vWeight;
void main() {
  if (vPhase < 0.0 || vAlong > vPhase / ${DRAW_SHARE.toFixed(2)}) discard;
  float alpha = vWeight * (1.0 - smoothstep(${FADE[0].toFixed(2)}, ${FADE[1].toFixed(2)}, vPhase));
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(${GRAPHITE}, alpha);
}
`;

export function createSketch(view) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uDuration: sharedUniforms.uDuration },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  let lines = null;
  let endTime = 0;

  function clear() {
    if (!lines) return;
    view.scene.remove(lines);
    lines.geometry.dispose();
    lines = null;
  }

  // Entries: module instance and start time in seconds
  function set(entries) {
    clear();
    if (entries.length === 0) return;
    const positions = [];
    const meta = [];
    for (const { instance, start } of entries) {
      const rng = makeRng(instance.id * 7919 + 17);
      const pose = instancePose(instance);
      const outline = footprintOutline(instance.fp);
      const height = instance.h * STORY_MM;
      const edges = [];
      outline.forEach((corner, index) => {
        const next = outline[(index + 1) % outline.length];
        edges.push([[corner[0], corner[1], LIFT_MM], [next[0], next[1], LIFT_MM]]);
        edges.push([[corner[0], corner[1], 0], [corner[0], corner[1], height]]);
        edges.push([[corner[0], corner[1], height], [next[0], next[1], height]]);
      });
      edges.forEach(([from, to], edgeIndex) => {
        const strokes = rng.chance(SECOND_STROKE) ? 2 : 1;
        for (let stroke = 0; stroke < strokes; stroke++) {
          const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
          const direction = [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length];
          const before = rng.range(OVERSHOOT_MM[0], OVERSHOOT_MM[1]);
          const after = rng.range(OVERSHOOT_MM[0], OVERSHOOT_MM[1]);
          const weight = rng.range(WEIGHT[0], WEIGHT[1]);
          const shift = stroke * STROKE_SHIFT_MM;
          const points = [];
          for (let piece = 0; piece <= PIECES; piece++) {
            const along = -before + ((length + before + after) * piece) / PIECES;
            const drift = () => rng.range(-WOBBLE_MM, WOBBLE_MM) + shift;
            const local = [from[0] + direction[0] * along + drift(), from[1] + direction[1] * along + drift(), Math.max(LIFT_MM, from[2] + direction[2] * along + drift())];
            points.push(poseApply(pose, local[0], local[1], local[2]));
          }
          for (let piece = 0; piece < PIECES; piece++) {
            const slot = (edgeIndex + piece / PIECES) / edges.length;
            const nextSlot = (edgeIndex + (piece + 1) / PIECES) / edges.length;
            positions.push(...points[piece], ...points[piece + 1]);
            meta.push(start, slot, weight, start, nextSlot, weight);
          }
        }
      });
      endTime = Math.max(endTime, start + sharedUniforms.uDuration.value * (FADE[1] + 0.1));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aLine', new THREE.Float32BufferAttribute(meta, 3));
    lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    view.scene.add(lines);
  }

  view.onFrame(() => {
    if (lines && view.now() > endTime) clear();
    return false;
  });

  return { set, clear };
}
