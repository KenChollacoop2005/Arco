import * as THREE from '../../vendor/three/three.module.min.js';
import { FIGURE_BODY_COLOR, FIGURE_DARK_COLOR } from '../config.js';

const LEAF_COLOR = 0x6f8f5e; // plant leaves
const CAPSULE_SEGMENTS = [3, 8]; // cap and radial segments
const SPHERE_SEGMENTS = [10, 8]; // width and height segments
const CONE_SEGMENTS = 12; // cone and disc roundness
const RING_SEGMENTS = [6, 20]; // tube and ring segments
const ROUGHNESS = 1; // matte like a card model
const UP = new THREE.Vector3(0, 1, 0);

const vector = (point) => new THREE.Vector3(...point);

// Geometry of one part, already in place
function partGeometry(part) {
  if (part.kind === 'sphere') return new THREE.SphereGeometry(part.r, ...SPHERE_SEGMENTS).translate(...part.c);
  if (part.kind === 'box') return new THREE.BoxGeometry(...part.size).translate(...part.c);
  if (part.kind === 'ring') {
    const geometry = new THREE.TorusGeometry(part.r, part.tube, ...RING_SEGMENTS);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector(part.axis).normalize()));
    return geometry.translate(...part.c);
  }
  const from = vector(part.a);
  const to = vector(part.b);
  const length = Math.max(1e-3, from.distanceTo(to));
  const geometry = part.kind === 'capsule' ? new THREE.CapsuleGeometry(part.r, length, ...CAPSULE_SEGMENTS) : new THREE.CylinderGeometry(part.r2, part.r1, length, CONE_SEGMENTS);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize()));
  return geometry.translate(...from.add(to).multiplyScalar(0.5).toArray());
}

// One merged geometry with a vertex colour per part
export function figureGeometry(figure) {
  const colors = { body: new THREE.Color(FIGURE_BODY_COLOR), dark: new THREE.Color(FIGURE_DARK_COLOR), leaf: new THREE.Color(LEAF_COLOR), accent: new THREE.Color(figure.params.accent) };
  const positions = [];
  const normals = [];
  const shades = [];
  for (const part of figure.parts) {
    const geometry = partGeometry(part).toNonIndexed();
    const color = colors[part.color];
    positions.push(...geometry.getAttribute('position').array);
    normals.push(...geometry.getAttribute('normal').array);
    for (let index = 0; index < geometry.getAttribute('position').count; index++) shades.push(color.r, color.g, color.b);
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  merged.computeBoundingSphere();
  return merged;
}

export const figureMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS, metalness: 0 });

// A figure mesh facing -y, feet at the origin
export function figureMesh(figure, material = figureMaterial()) {
  const mesh = new THREE.Mesh(figureGeometry(figure), material);
  mesh.castShadow = true;
  return mesh;
}
