import * as THREE from '../../vendor/three/three.module.min.js';
import {
  POOL_RADIUS_MM, POOL_STRENGTH, WINDOW_GLOW, NIGHT_POINT_LIGHTS, POINT_LIGHT_STRENGTH, POINT_LIGHT_REACH_MM, POINT_CLUSTER_MM,
  STRING_BULB_GAP_MM, STRING_BULB_MM, LAMP_GLOW_STRENGTH, LAMP_DAY_GLOW,
} from '../config.js';
import { sectionPlanes } from './materials.js';

const POOL_TEXTURE_PX = 128; // light pool texture size
const POOL_LIFT_MM = 0.4; // pool sits this far above the surface
const POOL_COLOR = 0xffc27a; // warm pool tint
const BULB_COLOR = 0xffd9a0; // lit bulb colour
const BULB_OFF_COLOR = 0x6f6a62; // unlit bulb colour
const CORD_COLOR = 0x2d2b2a; // string light cord colour
const POINT_COLOR = 0xffb86b; // point light colour
const POINT_DUSK_SHARE = 0.35; // point light strength at dusk, share of night
const POINT_LIFT_MM = 4; // point light sits above its lamps
const POINT_DECAY = 2; // physical falloff

function poolTexture() {
  const size = POOL_TEXTURE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Lamps clustered greedily, brightest first
function clusters(points, cap) {
  const left = points.slice();
  const found = [];
  while (left.length > 0 && found.length < cap) {
    let best = null;
    for (const point of left) {
      const near = left.filter((other) => point.distanceTo(other) <= POINT_CLUSTER_MM);
      if (!best || near.length > best.length) best = near;
    }
    const centre = new THREE.Vector3();
    for (const point of best) centre.add(point);
    centre.divideScalar(best.length);
    found.push(centre);
    for (const point of best) left.splice(left.indexOf(point), 1);
  }
  return found;
}

// Light pools, string lights and a few real point lights, render only
export function createNightLights(view, light) {
  const group = new THREE.Group();
  view.scene.add(group);
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: poolTexture(), color: POOL_COLOR, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, clippingPlanes: sectionPlanes,
  });
  const poolGeometry = new THREE.PlaneGeometry(POOL_RADIUS_MM * 2, POOL_RADIUS_MM * 2);
  const bulbGeometry = new THREE.IcosahedronGeometry(STRING_BULB_MM, 0);
  const bulbOn = new THREE.MeshStandardMaterial({ color: BULB_COLOR, emissive: BULB_COLOR, emissiveIntensity: 0, roughness: 0.6, clippingPlanes: sectionPlanes });
  const bulbOff = new THREE.MeshStandardMaterial({ color: BULB_OFF_COLOR, roughness: 0.6, clippingPlanes: sectionPlanes });
  const cordMaterial = new THREE.LineBasicMaterial({ color: CORD_COLOR, clippingPlanes: sectionPlanes });
  const points = [];
  let parts = [];
  let time = 'day';
  let lampSpots = [];

  function clear() {
    for (const part of parts) {
      group.remove(part);
      if (part.geometry !== poolGeometry && part.geometry !== bulbGeometry) part.geometry.dispose();
      if (part.dispose) part.dispose();
    }
    parts = [];
  }

  function add(part) {
    group.add(part);
    parts.push(part);
  }

  // Real lights only off the light preset, made on first need
  function placePoints() {
    const strength = time === 'night' ? 1 : time === 'dusk' ? POINT_DUSK_SHARE : 0;
    if (light || (strength === 0 && points.length === 0)) return;
    while (points.length < NIGHT_POINT_LIGHTS) {
      const point = new THREE.PointLight(POINT_COLOR, 0, POINT_LIGHT_REACH_MM, POINT_DECAY);
      view.scene.add(point);
      points.push(point);
    }
    const centres = clusters(lampSpots, NIGHT_POINT_LIGHTS);
    points.forEach((point, index) => {
      const centre = centres[index];
      point.intensity = centre && group.visible ? POINT_LIGHT_STRENGTH * strength : 0;
      if (centre) point.position.set(centre.x, centre.y, centre.z + POINT_LIFT_MM);
    });
  }

  function applyTime() {
    poolMaterial.opacity = POOL_STRENGTH[time];
    bulbOn.emissiveIntensity = Math.max(WINDOW_GLOW[time], LAMP_DAY_GLOW) * LAMP_GLOW_STRENGTH;
    placePoints();
    view.requestRender();
  }

  return {
    group,
    warm: [{ material: poolMaterial, kind: 'mesh' }, { material: bulbOn, kind: 'instanced' }, { material: bulbOff, kind: 'instanced' }, { material: cordMaterial, kind: 'lines' }],
    // plan from lightPlan in core/lights.js
    set(plan) {
      clear();
      lampSpots = [];
      if (plan) {
        for (const source of plan.sources) {
          if (!source.lit || source.base === null) continue;
          lampSpots.push(new THREE.Vector3(...source.point));
          const pool = new THREE.Mesh(poolGeometry, poolMaterial);
          pool.position.set(source.point[0], source.point[1], source.base + POOL_LIFT_MM);
          pool.renderOrder = 1;
          add(pool);
        }
        const lit = [];
        const dark = [];
        const cord = [];
        for (const run of plan.strings) {
          const along = run.points;
          for (let index = 1; index < along.length; index++) cord.push(...along[index - 1], ...along[index]);
          let walked = 0;
          let next = STRING_BULB_GAP_MM / 2;
          for (let index = 2; index < along.length - 1; index++) {
            const from = new THREE.Vector3(...along[index - 1]);
            const to = new THREE.Vector3(...along[index]);
            const piece = from.distanceTo(to);
            while (next <= walked + piece) {
              (run.lit ? lit : dark).push(from.clone().lerp(to, (next - walked) / piece));
              next += STRING_BULB_GAP_MM;
            }
            walked += piece;
          }
        }
        if (cord.length > 0) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(cord, 3));
          add(new THREE.LineSegments(geometry, cordMaterial));
        }
        for (const [spots, material] of [[lit, bulbOn], [dark, bulbOff]]) {
          if (spots.length === 0) continue;
          const mesh = new THREE.InstancedMesh(bulbGeometry, material, spots.length);
          const matrix = new THREE.Matrix4();
          spots.forEach((spot, index) => mesh.setMatrixAt(index, matrix.makeTranslation(spot.x, spot.y, spot.z)));
          add(mesh);
        }
      }
      applyTime();
    },
    setTime(next) {
      time = next;
      applyTime();
    },
    setShown(on) {
      group.visible = on;
      placePoints();
      view.requestRender();
    },
  };
}
