import * as THREE from '../../vendor/three/three.module.min.js';

const CLICK_SLOP_PX = 5; // pointer travel still counted as a click

// Handlers: onPick(id or null, shiftKey), onDouble(id or null)
export function createPicker(canvas, rig, moduleView, handlers) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressed = null;

  function pickAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    rig.camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, rig.camera);
    return moduleView.pick(raycaster);
  }

  canvas.addEventListener('pointerdown', (event) => {
    pressed = event.button === 0 ? [event.clientX, event.clientY] : null;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!pressed || event.button !== 0) return;
    const travel = Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]);
    pressed = null;
    if (travel <= CLICK_SLOP_PX) handlers.onPick(pickAt(event), event.shiftKey);
  });
  canvas.addEventListener('dblclick', (event) => handlers.onDouble(pickAt(event)));
}
