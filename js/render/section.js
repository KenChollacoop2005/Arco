import * as THREE from '../../vendor/three/three.module.min.js';
import { sectionExtent, sectionPlane } from '../core/section.js';

const POCHE_COLOR = 0x2b2a28; // solid fill on cut faces
const FILL_SIZE_MM = 4000; // fill quad edge, larger than any model
const FILL_ORDER = 2; // fill draws after the stencil pass

// Cut plane with a solid fill where it meets a module
export function createSection(view, moduleView) {
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(FILL_SIZE_MM, FILL_SIZE_MM),
    new THREE.MeshBasicMaterial({
      color: POCHE_COLOR,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    })
  );
  fill.renderOrder = FILL_ORDER;
  fill.visible = false;
  fill.onAfterRender = (renderer) => renderer.clearStencil();
  view.scene.add(fill);
  const facing = new THREE.Vector3();
  const state = { on: false, axis: 'h', share: 0.5 };
  let extent = sectionExtent([]);

  function apply() {
    fill.visible = state.on;
    if (!state.on) {
      moduleView.setClip(null);
      return;
    }
    const plane = sectionPlane(state.axis, state.share, extent);
    fill.position.set(...plane.point);
    fill.lookAt(facing.set(...plane.point).add(new THREE.Vector3(...plane.normal)));
    moduleView.setClip(plane);
  }

  return {
    set(change) {
      Object.assign(state, change);
      apply();
    },
    setStructure(modules) {
      extent = sectionExtent(modules);
      apply();
    },
  };
}
