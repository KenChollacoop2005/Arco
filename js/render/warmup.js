import * as THREE from '../../vendor/three/three.module.min.js';

const STAND_IN = [0, 0, 0, 1, 0, 0, 0, 1, 0]; // one small triangle, mm

// Stand-in object for a material, flags as the layer sets them
function standIn(geometry, { material, kind, shadows = false, colored = false }) {
  let object;
  if (kind === 'points') object = new THREE.Points(geometry, material);
  else if (kind === 'lines') object = new THREE.LineSegments(geometry, material);
  else if (kind === 'instanced') object = new THREE.InstancedMesh(geometry, material, 1);
  else object = new THREE.Mesh(geometry, material);
  if (colored) object.setColorAt(0, new THREE.Color());
  object.castShadow = shadows;
  object.receiveShadow = shadows;
  return object;
}

// Compiles layer shaders ahead, lit by the real scene; resolves when done
export function warmUp(view, camera, entries) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(STAND_IN, 3));
  const stage = new THREE.Scene();
  for (const entry of entries) stage.add(standIn(geometry, entry));
  const { renderer } = view;
  const done = renderer.compileAsync ? renderer.compileAsync(stage, camera, view.scene) : Promise.resolve(renderer.compile(stage, camera, view.scene));
  return done.catch(() => {}).then(() => geometry.dispose());
}
