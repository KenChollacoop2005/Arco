import * as THREE from '../../vendor/three/three.module.min.js';

const CLICK_SLOP_PX = 5; // pointer travel still counted as a click
const INSIDE_MM = 1; // step past a hit face into the module

// Handlers: onPick(id or null, shiftKey, event), onDouble(id or null)
export function createPicker(canvas, rig, moduleView, handlers) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressed = null;

  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    rig.camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, rig.camera);
  }

  function pickAt(event) {
    aim(event);
    return moduleView.pick(raycaster);
  }

  // Point in mm on a module or the plinth plane
  function targetAt(event) {
    aim(event);
    const { origin, direction } = raycaster.ray;
    const hit = moduleView.pickPoint(raycaster);
    if (hit) return { x: hit.point.x + direction.x * INSIDE_MM, y: hit.point.y + direction.y * INSIDE_MM };
    if (direction.z >= 0) return null;
    const reach = -origin.z / direction.z;
    return { x: origin.x + direction.x * reach, y: origin.y + direction.y * reach };
  }

  // Point in mm just outside the surface under the pointer, plinth top included
  function pointAt(event, back = 0) {
    aim(event);
    const { origin, direction } = raycaster.ray;
    const hit = moduleView.pickPoint(raycaster);
    if (hit) return [hit.point.x - direction.x * back, hit.point.y - direction.y * back, hit.point.z - direction.z * back];
    if (direction.z >= 0) return null;
    const reach = -origin.z / direction.z;
    return [origin.x + direction.x * reach, origin.y + direction.y * reach, 0];
  }

  canvas.addEventListener('pointerdown', (event) => {
    pressed = event.button === 0 ? [event.clientX, event.clientY] : null;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!pressed || event.button !== 0) return;
    const travel = Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]);
    pressed = null;
    if (travel <= CLICK_SLOP_PX) handlers.onPick(pickAt(event), event.shiftKey, event);
  });
  canvas.addEventListener('dblclick', (event) => handlers.onDouble(pickAt(event)));
  return { targetAt, pointAt };
}
