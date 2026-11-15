import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import {
  CAMERA_AZIMUTH_DEG,
  CAMERA_ELEVATION_DEG,
  CAMERA_FIT_PADDING,
  CAMERA_RISE_RATE,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
} from '../config.js';
import { PLINTH_RADIUS_MM } from './scene.js';

const PERSPECTIVE_FOV = 30; // perspective field of view
const ORTHO_DISTANCE = 2400; // orthographic camera standoff
const WIDE_LAYOUT_PX = 760; // panels sit beside the model
const SIDE_INSET_PX = 284; // space taken by each side panel
const TOP_INSET_PX = 60; // space taken by the top bar
const BOTTOM_INSET_PX = 78; // space taken by the bottom bar
const MAX_POLAR = 1.6; // lowest camera angle
const VIEW_TWEEN_S = 0.45; // view change time
const FRAME_FILL = 0.42; // module share of view when framed
const TARGET_HEIGHT_SHARE = 0.5; // target height along the model
const MIN_FIT_HEIGHT_MM = 60; // fit never tighter than this

const radians = (degrees) => (degrees * Math.PI) / 180;

export function createCameraRig(canvas, reducedMotion) {
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 12000);
  const persp = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, 20, 20000);
  ortho.up.set(0, 0, 1);
  persp.up.set(0, 0, 1);
  let active = ortho;
  let width = 1;
  let height = 1;
  let fitHeight = MIN_FIT_HEIGHT_MM;
  let goalHeight = MIN_FIT_HEIGHT_MM;
  let following = true;
  let span = 600;
  let tween = null;
  const axis = new THREE.Vector2(0, 0);
  const changeCallbacks = [];

  const controls = new OrbitControls(active, canvas);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = MAX_POLAR;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.zoomToCursor = false;

  function viewDirection(azimuthDeg, elevationDeg) {
    const azimuth = radians(azimuthDeg);
    const elevation = radians(elevationDeg);
    return new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      -Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation)
    );
  }

  function computeSpan(modelHeight) {
    const elevation = radians(CAMERA_ELEVATION_DEG);
    const wide = width > WIDE_LAYOUT_PX;
    const freeWidth = Math.max(160, width - (wide ? SIDE_INSET_PX * 2 : 0));
    const freeHeight = Math.max(160, height - TOP_INSET_PX - BOTTOM_INSET_PX * (wide ? 1 : 2));
    const tall = modelHeight * Math.cos(elevation) + 2 * PLINTH_RADIUS_MM * Math.sin(elevation) + 30;
    const across = 2 * PLINTH_RADIUS_MM + 12;
    return Math.max((tall * height) / freeHeight, (across * height) / freeWidth) * CAMERA_FIT_PADDING;
  }

  function applyProjection() {
    const aspect = width / height;
    ortho.left = (-span * aspect) / 2;
    ortho.right = (span * aspect) / 2;
    ortho.top = span / 2;
    ortho.bottom = -span / 2;
    ortho.updateProjectionMatrix();
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    const baseDistance = span / 2 / Math.tan(radians(PERSPECTIVE_FOV) / 2);
    controls.minZoom = CAMERA_ZOOM_MIN;
    controls.maxZoom = CAMERA_ZOOM_MAX;
    controls.minDistance = active === persp ? baseDistance / CAMERA_ZOOM_MAX : 0;
    controls.maxDistance = active === persp ? baseDistance / CAMERA_ZOOM_MIN : Infinity;
    return baseDistance;
  }

  function place(direction, distance) {
    active.position.copy(controls.target).addScaledVector(direction, distance);
    active.lookAt(controls.target);
  }

  function currentDirection() {
    return active.position.clone().sub(controls.target).normalize();
  }

  function setHeightNow(modelHeight) {
    const previousSpan = span;
    fitHeight = modelHeight;
    span = computeSpan(Math.max(MIN_FIT_HEIGHT_MM, modelHeight));
    const baseDistance = applyProjection();
    const direction = currentDirection();
    const targetZ = Math.max(MIN_FIT_HEIGHT_MM, modelHeight) * TARGET_HEIGHT_SHARE - 6;
    controls.target.set(axis.x, axis.y, targetZ);
    if (active === persp) {
      const distance = active.position.distanceTo(controls.target) || baseDistance;
      place(direction, previousSpan > 0 ? (distance * span) / previousSpan : baseDistance);
    } else {
      place(direction, ORTHO_DISTANCE);
    }
  }

  function home(immediate) {
    axis.set(0, 0);
    following = true;
    const direction = viewDirection(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG);
    if (immediate || reducedMotion) {
      controls.target.set(0, 0, 0);
      active.position.copy(direction.multiplyScalar(ORTHO_DISTANCE));
      ortho.zoom = 1;
      setHeightNow(goalHeight);
      if (active === persp) place(currentDirection(), applyProjection());
    } else {
      startTween(direction, 1, new THREE.Vector3(0, 0, Math.max(MIN_FIT_HEIGHT_MM, goalHeight) * TARGET_HEIGHT_SHARE - 6));
    }
    controls.update();
    notify();
  }

  function startTween(direction, zoom, target) {
    tween = {
      time: 0,
      fromDirection: currentDirection(),
      toDirection: direction.clone().normalize(),
      fromZoom: currentZoom(),
      toZoom: zoom,
      fromTarget: controls.target.clone(),
      toTarget: target,
    };
  }

  function currentZoom() {
    if (active === ortho) return ortho.zoom;
    const baseDistance = span / 2 / Math.tan(radians(PERSPECTIVE_FOV) / 2);
    return baseDistance / active.position.distanceTo(controls.target);
  }

  function setZoom(zoom) {
    const clamped = Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
    if (active === ortho) {
      ortho.zoom = clamped;
      ortho.updateProjectionMatrix();
    } else {
      const baseDistance = span / 2 / Math.tan(radians(PERSPECTIVE_FOV) / 2);
      place(currentDirection(), baseDistance / clamped);
    }
  }

  function notify() {
    for (const callback of changeCallbacks) callback();
  }

  controls.addEventListener('change', () => {
    const driftX = controls.target.x - axis.x;
    const driftY = controls.target.y - axis.y;
    if (!tween && (Math.abs(driftX) > 1e-6 || Math.abs(driftY) > 1e-6)) {
      controls.target.x = axis.x;
      controls.target.y = axis.y;
      active.position.x -= driftX;
      active.position.y -= driftY;
    }
    const low = -10;
    const high = Math.max(MIN_FIT_HEIGHT_MM, fitHeight) + 10;
    const clampedZ = Math.min(high, Math.max(low, controls.target.z));
    if (clampedZ !== controls.target.z) {
      active.position.z += clampedZ - controls.target.z;
      controls.target.z = clampedZ;
    }
    notify();
  });

  const stopFollowing = () => {
    following = false;
  };
  canvas.addEventListener('wheel', stopFollowing, { passive: true });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2) stopFollowing();
  });
  canvas.addEventListener('touchstart', (event) => {
    if (event.touches.length > 1) stopFollowing();
  }, { passive: true });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  home(true);

  return {
    controls,
    get camera() {
      return active;
    },
    onChange(callback) {
      changeCallbacks.push(callback);
    },
    resize(newWidth, newHeight) {
      width = newWidth;
      height = newHeight;
      setHeightNow(fitHeight);
      controls.update();
    },
    setModelHeight(modelHeight, immediate) {
      goalHeight = modelHeight;
      if (immediate || reducedMotion) {
        if (following) setHeightNow(modelHeight);
        else fitHeight = modelHeight;
      }
    },
    follow() {
      following = true;
    },
    home,
    setProjection(kind) {
      const next = kind === 'persp' ? persp : ortho;
      if (next === active) return;
      const direction = currentDirection();
      const zoom = currentZoom();
      active = next;
      controls.object = active;
      applyProjection();
      if (active === ortho) {
        place(direction, ORTHO_DISTANCE);
        ortho.zoom = Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
        ortho.updateProjectionMatrix();
      } else {
        place(direction, span / 2 / Math.tan(radians(PERSPECTIVE_FOV) / 2) / zoom);
      }
      controls.update();
      notify();
    },
    setView(name) {
      following = name === 'axon';
      const direction =
        name === 'plan'
          ? new THREE.Vector3(0.0005, -0.001, 1)
          : name === 'elevation'
            ? viewDirection(0, 0.01)
            : viewDirection(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG);
      axis.set(0, 0);
      const target = new THREE.Vector3(0, 0, Math.max(MIN_FIT_HEIGHT_MM, fitHeight) * TARGET_HEIGHT_SHARE - 6);
      if (reducedMotion) {
        controls.target.copy(target);
        place(direction.normalize(), active === ortho ? ORTHO_DISTANCE : applyProjection());
        setZoom(1);
        controls.update();
        notify();
      } else {
        startTween(direction, 1, target);
      }
    },
    frame(box) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      following = false;
      axis.set(center.x, center.y);
      const zoom = (span * FRAME_FILL) / Math.max(20, size);
      if (reducedMotion) {
        const direction = currentDirection();
        controls.target.copy(center);
        place(direction, active.position.length());
        setZoom(zoom);
        controls.update();
        notify();
      } else {
        startTween(currentDirection(), Math.min(CAMERA_ZOOM_MAX, Math.max(1, zoom)), center);
      }
    },
    update(delta) {
      let moving = false;
      if (tween) {
        tween.time = Math.min(1, tween.time + delta / VIEW_TWEEN_S);
        const eased = tween.time * tween.time * (3 - 2 * tween.time);
        const direction = tween.fromDirection.clone().lerp(tween.toDirection, eased).normalize();
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        const distance = active === ortho ? ORTHO_DISTANCE : active.position.distanceTo(controls.target);
        place(direction, distance);
        setZoom(tween.fromZoom + (tween.toZoom - tween.fromZoom) * eased);
        if (tween.time >= 1) {
          axis.set(tween.toTarget.x, tween.toTarget.y);
          tween = null;
        }
        moving = true;
      } else if (following && Math.abs(goalHeight - fitHeight) > 0.25) {
        const step = 1 - Math.exp(-CAMERA_RISE_RATE * delta);
        setHeightNow(fitHeight + (goalHeight - fitHeight) * step);
        moving = true;
      }
      const changed = controls.update();
      if (moving) notify();
      return moving || changed;
    },
  };
}
