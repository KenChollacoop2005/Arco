import * as THREE from '../../vendor/three/three.module.min.js';
import {
  SMOKE_PARTICLES_MAX, SMOKE_PER_EMITTER, STEAM_PER_EMITTER, SMOKE_LIFE_S, STEAM_LIFE_S, SMOKE_RISE_MM, STEAM_RISE_MM, SMOKE_DRIFT_MM,
  SMOKE_SIZE_MM, STEAM_SIZE_MM, SMOKE_ALPHA, STEAM_ALPHA, DRIPS_PER_FALL, DRIPS_MAX, DRIP_CYCLE_S, DRIP_LIFE_S, DRIP_SPEED_MM,
  DRIP_GRAVITY_MM, DRIP_SIZE_MM, DRIP_ALPHA, PARTICLE_LIGHT_SHARE,
} from '../config.js';
import { sharedUniforms, sectionPlanes } from './materials.js';

const SMOKE_COLOR = 0xb9b6b0; // pale soot grey
const STEAM_COLOR = 0xf3f4f2; // near white
const DRIP_COLOR = 0xd8ecf2; // clear water
const WIND = [3.5, 1.5]; // shared drift of smoke and steam over a life, mm
const STEAM_DRIFT_SHARE = 0.4; // steam drifts less than smoke
const GOLDEN = 0.618034; // spreads particle seeds over 0 to 1
const glsl = (value) => value.toFixed(3);

const VERTEX_HEAD = `
uniform float uTime;
uniform float uScale;
attribute float aSeed;
attribute vec3 aFoot;
attribute vec3 aOut;
varying float vAlpha;
#include <clipping_planes_pars_vertex>
`;

// Puffs rise, drift with a shared wind and grow as they fade
const PUFF_BODY = (life, rise, drift, size, alpha) => `
float span = mix(${glsl(life[0])}, ${glsl(life[1])}, fract(aSeed * 7.13));
float age = fract(uTime / span + aSeed);
float sideA = fract(aSeed * 91.7) - 0.5;
float sideB = fract(aSeed * 53.3) - 0.5;
vec3 spot = position;
spot.z += mix(${glsl(rise[0])}, ${glsl(rise[1])}, fract(aSeed * 31.1)) * age;
spot.xy += (vec2(sideA, sideB) * ${glsl(drift * 2)} + vec2(${glsl(WIND[0])}, ${glsl(WIND[1])})) * age;
vAlpha = ${glsl(alpha)} * smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.5, 1.0, age));
float size = mix(${glsl(size[0])}, ${glsl(size[1])}, age);
`;

// Droplets spit off a falling sheet now and then, and drop
const DRIP_BODY = `
float cycle = mix(${glsl(DRIP_CYCLE_S[0])}, ${glsl(DRIP_CYCLE_S[1])}, fract(aSeed * 7.13));
float flight = mod(uTime + aSeed * cycle, cycle);
float age = flight / ${glsl(DRIP_LIFE_S)};
vec3 spot = mix(position, aFoot, fract(aSeed * 37.1));
vec2 away = normalize(vec2(fract(aSeed * 11.3) - 0.5, fract(aSeed * 17.9) - 0.5) + aOut.xy * 0.8 + 0.001);
spot += vec3(away * ${glsl(DRIP_SPEED_MM)} * flight, -0.5 * ${glsl(DRIP_GRAVITY_MM)} * flight * flight);
vAlpha = age < 1.0 ? ${glsl(DRIP_ALPHA)} * (1.0 - age) : 0.0;
float size = ${glsl(DRIP_SIZE_MM)};
`;

const VERTEX_TAIL = `
vec4 mvPosition = modelViewMatrix * vec4(spot, 1.0);
#include <clipping_planes_vertex>
gl_Position = projectionMatrix * mvPosition;
float depth = projectionMatrix[2][3] < -0.5 ? -mvPosition.z : 1.0;
gl_PointSize = size * projectionMatrix[1][1] * uScale / depth;
`;

const FRAGMENT = `
uniform vec3 uColor;
varying float vAlpha;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float edge = length(gl_PointCoord - 0.5) * 2.0;
  float alpha = vAlpha * (1.0 - smoothstep(0.3, 1.0, edge));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

function particleMaterial(body, color, blending, scale) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uScale: scale, uColor: { value: new THREE.Color(color) } },
    vertexShader: VERTEX_HEAD + 'void main() {\n' + body + VERTEX_TAIL + '}',
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending,
    clipping: true,
    clippingPlanes: sectionPlanes,
  });
}

// Seeded particle points: origin, foot and outward per particle
function pointsGeometry(entries) {
  const geometry = new THREE.BufferGeometry();
  const origin = [];
  const foot = [];
  const out = [];
  const seeds = [];
  entries.forEach((entry, index) => {
    origin.push(...entry.at);
    foot.push(...(entry.foot || entry.at));
    out.push(...(entry.out || [0, 0, 0]));
    seeds.push(((index + 1) * GOLDEN) % 1);
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(origin, 3));
  geometry.setAttribute('aFoot', new THREE.Float32BufferAttribute(foot, 3));
  geometry.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  return geometry;
}

// Spread a capped count evenly over sources
function spread(sources, each, cap, light) {
  const total = Math.min(cap, sources.length * each);
  const count = Math.floor((light ? PARTICLE_LIGHT_SHARE : 1) * total);
  const entries = [];
  for (let index = 0; index < count; index++) entries.push(sources[index % sources.length]);
  return entries;
}

// Smoke, steam and droplets: soft, capped, behind Effects
export function createParticles(view, light) {
  const group = new THREE.Group();
  view.scene.add(group);
  const scale = { value: 1 };
  view.onResize((width, height) => {
    scale.value = (height * view.renderer.getPixelRatio()) / 2;
  });
  const materials = {
    smoke: particleMaterial(PUFF_BODY(SMOKE_LIFE_S, SMOKE_RISE_MM, SMOKE_DRIFT_MM, SMOKE_SIZE_MM, SMOKE_ALPHA), SMOKE_COLOR, THREE.NormalBlending, scale),
    steam: particleMaterial(PUFF_BODY(STEAM_LIFE_S, STEAM_RISE_MM, SMOKE_DRIFT_MM * STEAM_DRIFT_SHARE, STEAM_SIZE_MM, STEAM_ALPHA), STEAM_COLOR, THREE.AdditiveBlending, scale),
    drips: particleMaterial(DRIP_BODY, DRIP_COLOR, THREE.AdditiveBlending, scale),
  };
  let parts = [];
  let any = false;

  function clear() {
    for (const part of parts) {
      group.remove(part);
      part.geometry.dispose();
    }
    parts = [];
  }

  return {
    group,
    // emitters from core/emitters.js, falls from the waterworks
    set(emitters, falls) {
      clear();
      const sets = {
        smoke: spread((emitters ? emitters.smoke : []).map((at) => ({ at })), SMOKE_PER_EMITTER, SMOKE_PARTICLES_MAX, light),
        steam: spread((emitters ? emitters.steam : []).map((at) => ({ at })), STEAM_PER_EMITTER, SMOKE_PARTICLES_MAX, light),
        drips: spread(falls.map((fall) => ({ at: fall.top, foot: fall.foot, out: fall.out })), DRIPS_PER_FALL, DRIPS_MAX, light),
      };
      for (const [kind, entries] of Object.entries(sets)) {
        if (entries.length === 0) continue;
        const points = new THREE.Points(pointsGeometry(entries), materials[kind]);
        points.frustumCulled = false;
        points.renderOrder = 2;
        group.add(points);
        parts.push(points);
      }
      any = parts.length > 0;
      view.requestRender();
    },
    setShown(on) {
      group.visible = on;
      view.requestRender();
    },
    // True while particles need frames
    moving: () => any && group.visible,
  };
}
