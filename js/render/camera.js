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
const INITIAL_SPAN_MM = 600; // view height before first fit
const DAMPING = 0.12; // orbit easing
const WIDE_LAYOUT_PX = 760; // panels sit beside the model
const SIDE_INSET_PX = 284; // space taken by each side panel
const TOP_INSET_PX = 60; // space taken by the top bar
const BOTTOM_INSET_PX = 78; // space taken by the bottom bar
const MIN_FREE_PX = 160; // smallest usable view area
const TALL_PAD_MM = 30; // extra height around the model
const ACROSS_PAD_MM = 12; // extra width around the plinth
const MAX_POLAR = 1.6; // lowest camera angle
const VIEW_TWEEN_S = 0.45; // view change time
const FRAME_FILL = 0.42; // module share of view when framed
const MIN_FRAME_SIZE_MM = 20; // smallest size used for framing
const FACE_MIN_OFFSET_MM = 8; // homes this near the middle need no turn
const FACE_KEEP_DOT = 0.5; // already facing within about 60 degrees
const TARGET_HEIGHT_SHARE = 0.5; // target height along the model
const TARGET_DROP_MM = 6; // target sits a little low
const PAN_SLACK_MM = 10; // pan range past the model
const MIN_FIT_HEIGHT_MM = 60; // fit never tighter than this
const RISE_DONE_MM = 0.25; // rise stops within this
const PLAN_DIRECTION = [0.0005, -0.001, 1]; // near vertical, avoids gimbal lock
const ELEVATION_TILT_DEG = 0.01; // near level side view

const radians = (degrees) => (degrees * Math.PI) / 180;
const clampZoom = (zoom) => Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));

export function createCameraRig(canvas, reducedMotion) {
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_DISTANCE * 5);
  const persp = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, 20, ORTHO_DISTANCE * 8);
  ortho.up.set(0, 0, 1);
  persp.up.set(0, 0, 1);
  let active = ortho;
  let width = 1;
  let height = 1;
  let fitHeight = MIN_FIT_HEIGHT_MM;
  let goalHeight = MIN_FIT_HEIGHT_MM;
  let following = true;
  let span = INITIAL_SPAN_MM;
  let tween = null;
  const axis = new THREE.Vector2(0, 0);
  const changeCallbacks = [];

  const controls = new OrbitControls(active, canvas);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = DAMPING;
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

  const baseDistance = () => span / 2 / Math.tan(radians(PERSPECTIVE_FOV) / 2);
  const targetHeight = () => Math.max(MIN_FIT_HEIGHT_MM, fitHeight) * TARGET_HEIGHT_SHARE - TARGET_DROP_MM;
  const currentDirection = () => active.position.clone().sub(controls.target).normalize();
  const currentDistance = () => active.position.distanceTo(controls.target);

  function computeSpan(modelHeight) {
    const elevation = radians(CAMERA_ELEVATION_DEG);
    const wide = width > WIDE_LAYOUT_PX;
    const freeWidth = Math.max(MIN_FREE_PX, width - (wide ? SIDE_INSET_PX * 2 : 0));
    const freeHeight = Math.max(MIN_FREE_PX, height - TOP_INSET_PX - BOTTOM_INSET_PX * (wide ? 1 : 2));
    const tall = modelHeight * Math.cos(elevation) + 2 * PLINTH_RADIUS_MM * Math.sin(elevation) + TALL_PAD_MM;
    const across = 2 * PLINTH_RADIUS_MM + ACROSS_PAD_MM;
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
    controls.minZoom = CAMERA_ZOOM_MIN;
    controls.maxZoom = CAMERA_ZOOM_MAX;
    controls.minDistance = active === persp ? baseDistance() / CAMERA_ZOOM_MAX : 0;
    controls.maxDistance = active === persp ? baseDistance() / CAMERA_ZOOM_MIN : Infinity;
  }

  function place(direction, distance) {
    active.position.copy(controls.target).addScaledVector(direction, distance);
    active.lookAt(controls.target);
  }

  // New view size, camera angle and zoom kept
  function refit(modelHeight) {
    const direction = currentDirection();
    const zoom = currentZoom();
    fitHeight = modelHeight;
    span = computeSpan(Math.max(MIN_FIT_HEIGHT_MM, modelHeight));
    applyProjection();
    place(direction, active === ortho ? ORTHO_DISTANCE : baseDistance() / zoom);
  }

  function retarget() {
    const direction = currentDirection();
    const distance = currentDistance();
    controls.target.set(axis.x, axis.y, targetHeight());
    place(direction, distance);
  }

  function currentZoom() {
    if (active === ortho) return ortho.zoom;
    return baseDistance() / (currentDistance() || baseDistance());
  }

  function setZoom(zoom) {
    if (active === ortho) {
      ortho.zoom = clampZoom(zoom);
      ortho.updateProjectionMatrix();
    } else {
      place(currentDirection(), baseDistance() / clampZoom(zoom));
    }
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

  // Jump or glide to a direction, zoom and target
  function moveTo(direction, zoom, target, immediate) {
    if (immediate || reducedMotion) {
      controls.target.copy(target);
      axis.set(target.x, target.y);
      place(direction.clone().normalize(), active === ortho ? ORTHO_DISTANCE : baseDistance());
      setZoom(zoom);
      controls.update();
      notify();
    } else {
      startTween(direction, zoom, target);
    }
  }

  function notify() {
    for (const callback of changeCallbacks) callback();
  }

  function home(immediate) {
    following = true;
    fitHeight = goalHeight;
    span = computeSpan(Math.max(MIN_FIT_HEIGHT_MM, fitHeight));
    applyProjection();
    moveTo(
      viewDirection(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG),
      1,
      new THREE.Vector3(0, 0, targetHeight()),
      immediate
    );
  }

  controls.addEventListener('change', () => {
    const driftX = controls.target.x - axis.x;
    const driftY = controls.target.y - axis.y;
    if (!tween && (driftX !== 0 || driftY !== 0)) {
      controls.target.x = axis.x;
      controls.target.y = axis.y;
      active.position.x -= driftX;
      active.position.y -= driftY;
    }
    const low = -PAN_SLACK_MM;
    const high = Math.max(MIN_FIT_HEIGHT_MM, fitHeight) + PAN_SLACK_MM;
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
  canvas.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) stopFollowing();
    },
    { passive: true }
  );
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  active.position.copy(viewDirection(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG).multiplyScalar(ORTHO_DISTANCE));
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
      refit(fitHeight);
      controls.update();
      notify();
    },
    setModelHeight(modelHeight, immediate) {
      goalHeight = modelHeight;
      if (!following) {
        fitHeight = modelHeight;
      } else if (immediate || reducedMotion) {
        refit(modelHeight);
        retarget();
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
      place(direction, active === ortho ? ORTHO_DISTANCE : baseDistance());
      setZoom(zoom);
      controls.update();
      notify();
    },
    setView(name) {
      following = name === 'axon';
      const direction =
        name === 'plan'
          ? new THREE.Vector3(...PLAN_DIRECTION)
          : name === 'elevation'
            ? viewDirection(0, ELEVATION_TILT_DEG)
            : viewDirection(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG);
      moveTo(direction, 1, new THREE.Vector3(0, 0, targetHeight()), false);
    },
    // Turns around the plinth until the box's side faces the camera, zoom kept
    face(box) {
      const center = box.getCenter(new THREE.Vector3());
      const plan = new THREE.Vector2(center.x - controls.target.x, center.y - controls.target.y);
      const direction = currentDirection();
      const across = Math.hypot(direction.x, direction.y);
      if (plan.length() < FACE_MIN_OFFSET_MM || across < 1e-3) return;
      plan.normalize();
      if (plan.dot(new THREE.Vector2(direction.x / across, direction.y / across)) > FACE_KEEP_DOT) return;
      following = false;
      moveTo(new THREE.Vector3(plan.x * across, plan.y * across, direction.z), currentZoom(), controls.target.clone(), false);
    },
    frame(box) {
      const center = box.getCenter(new THREE.Vector3());
      const size = Math.max(MIN_FRAME_SIZE_MM, box.getSize(new THREE.Vector3()).length());
      following = false;
      moveTo(currentDirection(), clampZoom(Math.max(1, (span * FRAME_FILL) / size)), center, false);
    },
    update(delta) {
      let moving = false;
      if (tween) {
        tween.time = Math.min(1, tween.time + delta / VIEW_TWEEN_S);
        const eased = tween.time * tween.time * (3 - 2 * tween.time);
        const direction = tween.fromDirection.clone().lerp(tween.toDirection, eased).normalize();
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        place(direction, active === ortho ? ORTHO_DISTANCE : baseDistance());
        setZoom(tween.fromZoom + (tween.toZoom - tween.fromZoom) * eased);
        if (tween.time >= 1) {
          axis.set(tween.toTarget.x, tween.toTarget.y);
          tween = null;
        }
        moving = true;
      } else if (following && Math.abs(goalHeight - fitHeight) > RISE_DONE_MM) {
        const step = 1 - Math.exp(-CAMERA_RISE_RATE * delta);
        refit(fitHeight + (goalHeight - fitHeight) * step);
        retarget();
        moving = true;
      }
      const changed = controls.update();
      if (moving) notify();
      return moving || changed;
    },
  };
}
