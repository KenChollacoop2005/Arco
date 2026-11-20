import * as THREE from '../../vendor/three/three.module.min.js';
import { figureBatches, patternAt } from '../core/figuremesh.js';

const MATTE_ROUGHNESS = 0.85; // painted wood body
const GLOSS_ROUGHNESS = 0.28; // glossy head and hands
const PATTERN_PX = 128; // pattern texture edge

// Buffer geometry from one batch of triangles
function batchGeometry(batch) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  geometry.setIndex(batch.index);
  geometry.computeBoundingSphere();
  return geometry;
}

// Stripes or dots painted from the shared pattern rule
function patternTexture(pattern) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PATTERN_PX;
  const context = canvas.getContext('2d');
  const image = context.createImageData(PATTERN_PX, PATTERN_PX);
  for (let y = 0; y < PATTERN_PX; y++) {
    for (let x = 0; x < PATTERN_PX; x++) {
      const hex = patternAt(pattern, pattern.base, (x + 0.5) / PATTERN_PX, 1 - (y + 0.5) / PATTERN_PX);
      const spot = (y * PATTERN_PX + x) * 4;
      image.data[spot] = (hex >> 16) & 255;
      image.data[spot + 1] = (hex >> 8) & 255;
      image.data[spot + 2] = hex & 255;
      image.data[spot + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const figureMaterials = () => ({
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: MATTE_ROUGHNESS, metalness: 0 }),
  gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: GLOSS_ROUGHNESS, metalness: 0 }),
});

// One group per bone (head, torso, hips, handL, handR), each with its meshes, in model mm
export function figureBones(figure, materials = figureMaterials()) {
  const { bones, pattern } = figureBatches(figure);
  const patternMaterial = pattern ? new THREE.MeshStandardMaterial({ map: patternTexture(pattern), vertexColors: true, roughness: MATTE_ROUGHNESS, metalness: 0 }) : null;
  const groups = {};
  for (const [bone, batches] of Object.entries(bones)) {
    const group = new THREE.Group();
    for (const [key, batch] of Object.entries(batches)) {
      if (batch.index.length === 0) continue;
      const mesh = new THREE.Mesh(batchGeometry(batch), key === 'pattern' ? patternMaterial : materials[key]);
      mesh.castShadow = true;
      group.add(mesh);
    }
    groups[bone] = group;
  }
  return groups;
}

// A standing figure facing -y, feet at the origin
export function figureMesh(figure, materials) {
  const root = new THREE.Group();
  for (const group of Object.values(figureBones(figure, materials))) root.add(group);
  root.userData.dispose = () => root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    if (child.material.map) {
      child.material.map.dispose();
      child.material.dispose();
    }
  });
  return root;
}
