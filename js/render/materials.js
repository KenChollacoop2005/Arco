import * as THREE from '../../vendor/three/three.module.min.js';
import {
  BUILD_MS_PER_MODULE, TURBINE_RPM, TARP_SWAY_MM, WINDOW_WARM, WINDOW_GLOW_STRENGTH, SIGN_GLOW_STRENGTH, LAMP_GLOW_STRENGTH,
  LAMP_DAY_GLOW, FLICKER_PERIOD_S, FLICKER_OFF_SHARE, BEACON_PERIOD_S, BEACON_ON_SHARE,
} from '../config.js';

const BOARD_MM = 3.2; // board mark spacing
const BOARD_LINE_DARKEN = 0.12; // board joint strength
const BOARD_TONE = 0.05; // tone change per board
const GRAIN = 0.035; // fine noise strength
const WET_DARKEN = 0.5; // wet concrete brightness
const SKETCH_END = 0.4; // sketch share of build
const POUR_MID = 0.55; // second pour step
const SET_START = 0.7; // curing start
const DETAIL_START = 0.85; // details appear
const JOINT_EDGE = 0.09; // board joint width share
const TOP_JOINT_SHARE = 0.45; // joint strength on flat faces
const GRAIN_PER_MM = 3; // grain cells per mm
const SHARPEN = 1.6; // texture fade with distance
const INSTANCE_TONE = 0.06; // tone change between modules
const DETAIL_FLASH = 0.3; // brightness when details pop
const RING_WIDTH_MM = 1.2; // plinth rim line width
const RING_DARKEN = 0.22; // plinth rim line strength
const RIM_INNER_MM = 2; // grid stops inside the rim
const GRID_STRENGTH = 0.35; // plinth grid line strength
const SELECT_MIX = 0.3; // selection tint amount
const INVALID_MIX = 0.75; // bad placement tint amount
const HIGHLIGHT_MIX = 0.6; // assembly step tint amount
const DRAWING_KEEP = 0.6; // tint kept in drawing mode
const BLUE = 'vec3(0.14, 0.27, 0.78)'; // drafting blue
const RED = 'vec3(0.8, 0.16, 0.16)'; // fail red
const ORANGE = 'vec3(0.91, 0.35, 0.05)'; // signal orange
const PAPER = 'vec3(0.965, 0.957, 0.937)'; // drawing paper
const SWAY_SPEED = 1.9; // tarp sway rate
const BLADE_SPIN_SHARE = 2.5; // blade rotors turn this much faster than drums and wheels
const SWAY_WAVE_X = 0.45; // tarp ripple along x
const SWAY_WAVE_Y = 0.3; // tarp ripple along y
const MODULE_ROUGHNESS = 0.92; // concrete roughness
const PLINTH_ROUGHNESS = 0.95; // plinth roughness
const PLINTH_COLOR = 0xb3b2ae; // plinth grey
const EDGE_OFFSET = 1; // faces pushed back behind drawn edges
const glsl = (value) => value.toFixed(3);

// Instance states
export const STATE_NORMAL = 0;
export const STATE_SELECTED = 1;
export const STATE_GHOST = 2;
export const STATE_INVALID = 3;
export const STATE_HIDDEN = 4;
export const STATE_HIGHLIGHT = 5;

export const sharedUniforms = {
  uTime: { value: 0 },
  uDuration: { value: BUILD_MS_PER_MODULE / 1000 },
  uEffects: { value: 0 },
  uDrawing: { value: 0 },
  uGrid: { value: 0 },
  uSpin: { value: (TURBINE_RPM * Math.PI * 2) / 60 },
  uSway: { value: TARP_SWAY_MM },
  uGlow: { value: 0 },
};
const vec3 = (rgb) => `vec3(${rgb.map(glsl).join(', ')})`;

const VERTEX_HEAD = `
attribute vec3 aMeta;
attribute float aWin;
#ifdef ARCO_INSTANCED
attribute vec4 aAnim;
attribute vec2 aLight;
#endif
varying float vWin;
varying vec2 vLight;
uniform float uTime;
uniform float uDuration;
uniform float uEffects;
uniform float uSpin;
uniform float uSway;
varying vec3 vLocal;
varying float vKind;
varying float vPhase;
varying float vState;
varying float vTall;
varying float vTone;
`;

const VERTEX_BODY = `
vLocal = position;
vKind = aMeta.x;
vWin = aWin;
#ifdef ARCO_INSTANCED
vLight = aLight;
vPhase = (uTime - aAnim.x) / uDuration;
vState = aAnim.y;
vTall = aAnim.z;
vTone = aAnim.w;
#else
vLight = vec2(0.0);
vPhase = 2.0;
vState = 0.0;
vTall = 1.0;
vTone = 0.0;
#endif
if (uEffects > 0.5 && aMeta.x > 5.5) {
  float angle = uTime * uSpin;
  vec2 arm = transformed.xz - aMeta.yz;
  transformed.xz = aMeta.yz + vec2(arm.x * cos(angle) - arm.y * sin(angle), arm.x * sin(angle) + arm.y * cos(angle));
} else if (uEffects > 0.5 && aMeta.x > 4.5) {
  float angle = uTime * uSpin * ${glsl(BLADE_SPIN_SHARE)};
  vec2 arm = transformed.yz - aMeta.yz;
  transformed.yz = aMeta.yz + vec2(arm.x * cos(angle) - arm.y * sin(angle), arm.x * sin(angle) + arm.y * cos(angle));
} else if (uEffects > 0.5 && aMeta.x > 3.5) {
  float angle = uTime * uSpin;
  vec2 arm = transformed.xy - aMeta.yz;
  transformed.xy = aMeta.yz + vec2(arm.x * cos(angle) - arm.y * sin(angle), arm.x * sin(angle) + arm.y * cos(angle));
} else if (uEffects > 0.5 && aMeta.x > 2.5) {
  transformed.z += sin(uTime * ${glsl(SWAY_SPEED)} + position.x * ${glsl(SWAY_WAVE_X)} + position.y * ${glsl(SWAY_WAVE_Y)}) * uSway * aMeta.y;
}
`;

const FRAGMENT_HEAD = `
uniform float uTime;
uniform float uEffects;
uniform float uGlow;
varying float vWin;
varying vec2 vLight;
uniform float uDrawing;
uniform float uGrid;
varying vec3 vLocal;
varying float vKind;
varying float vPhase;
varying float vState;
varying float vTall;
varying float vTone;
float arcoHash(vec3 point) {
  return fract(sin(dot(point, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
`;

const FRAGMENT_DISCARD = `
if (vState > 3.5 && vState < 4.5) discard;
if (vPhase < ${SKETCH_END.toFixed(2)}) discard;
if (vPhase < ${POUR_MID.toFixed(2)} && vLocal.z > vTall * 0.5) discard;
if (vKind > 0.5 && vPhase < ${DETAIL_START.toFixed(2)}) discard;
if (vState > 1.5 && vState < 3.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5) discard;
`;

const FRAGMENT_COLOR = `
vec3 arcoNormal = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
float arcoWet = 1.0 - smoothstep(${SET_START.toFixed(2)}, 1.0, vPhase);
if (vKind < 0.5) {
  float upright = 1.0 - step(0.5, abs(arcoNormal.z));
  float boardCoord = mix(vLocal.x, vLocal.z, upright) / ${BOARD_MM.toFixed(1)};
  float board = fract(boardCoord);
  float sharp = clamp(1.0 - fwidth(boardCoord) * ${glsl(SHARPEN)}, 0.0, 1.0);
  float joint = (1.0 - smoothstep(0.0, ${glsl(JOINT_EDGE)}, board) * (1.0 - smoothstep(${glsl(1 - JOINT_EDGE)}, 1.0, board))) * sharp;
  float tone = (arcoHash(vec3(floor(boardCoord), vTone * 91.0, upright)) - 0.5) * ${BOARD_TONE.toFixed(3)} * sharp;
  float grain = (arcoHash(floor(vLocal * ${glsl(GRAIN_PER_MM)})) - 0.5) * ${GRAIN.toFixed(3)} * sharp;
  diffuseColor.rgb *= 1.0 - joint * ${BOARD_LINE_DARKEN.toFixed(2)} * mix(${glsl(TOP_JOINT_SHARE)}, 1.0, upright) + tone + grain + (vTone - 0.5) * ${glsl(INSTANCE_TONE)};
  diffuseColor.rgb *= mix(1.0, ${WET_DARKEN.toFixed(2)}, arcoWet);
} else {
  diffuseColor.rgb += (1.0 - smoothstep(${DETAIL_START.toFixed(2)}, 1.0, vPhase)) * ${glsl(DETAIL_FLASH)};
}
#ifdef ARCO_PLINTH
float ringRadius = length(vLocal.xy);
float ring = (1.0 - smoothstep(0.0, ${glsl(RING_WIDTH_MM)}, abs(ringRadius - ARCO_RING))) * step(0.5, abs(arcoNormal.z));
diffuseColor.rgb *= 1.0 - ring * ${glsl(RING_DARKEN)};
vec2 cellCoord = vLocal.xy / ARCO_CELL;
vec2 cellLine = abs(fract(cellCoord - 0.5) - 0.5) / fwidth(cellCoord);
float gridLine = (1.0 - min(min(cellLine.x, cellLine.y), 1.0)) * step(ringRadius, ARCO_RING - ${glsl(RIM_INNER_MM)}) * step(0.5, arcoNormal.z);
#endif
if (vState > 0.5 && vState < 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, ${BLUE}, ${glsl(SELECT_MIX)});
if (vState > 2.5 && vState < 3.5) diffuseColor.rgb = mix(diffuseColor.rgb, ${RED}, ${glsl(INVALID_MIX)});
if (vState > 4.5) diffuseColor.rgb = mix(diffuseColor.rgb, ${ORANGE}, ${glsl(HIGHLIGHT_MIX)});
if (uDrawing > 0.5) {
  float keep = step(0.5, vState);
  diffuseColor.rgb = mix(${PAPER}, diffuseColor.rgb, keep * ${glsl(DRAWING_KEEP)});
}
#ifdef ARCO_PLINTH
diffuseColor.rgb = mix(diffuseColor.rgb, ${BLUE}, gridLine * ${glsl(GRID_STRENGTH)} * uGrid);
#endif
`;

// Lit windows, signs, lamps and beacons, from the module's power
const FRAGMENT_GLOW = `
#ifdef ARCO_INSTANCED
if (vLight.x > 0.0 && uDrawing < 0.5) {
  if (vKind > 1.5 && vKind < 2.5 && uGlow > 0.0 && arcoHash(vec3(vWin * 17.0, vTone * 53.0, 3.1)) < vLight.x) {
    float arcoOn = 1.0;
    if (uEffects > 0.5 && vLight.y > 0.5) {
      float period = mix(${glsl(FLICKER_PERIOD_S[0])}, ${glsl(FLICKER_PERIOD_S[1])}, arcoHash(vec3(vWin, vTone, 7.7)));
      arcoOn = step(${glsl(FLICKER_OFF_SHARE)}, fract(uTime / period + arcoHash(vec3(vWin, vTone, 9.1))));
    }
    vec3 warm = mix(${vec3(WINDOW_WARM[0])}, ${vec3(WINDOW_WARM[1])}, arcoHash(vec3(vWin, vTone, 5.3)));
    totalEmissiveRadiance += warm * arcoOn * uGlow * ${glsl(WINDOW_GLOW_STRENGTH)};
  }
  if (vWin < -0.5 && vWin > -1.5) totalEmissiveRadiance += diffuseColor.rgb * uGlow * ${glsl(SIGN_GLOW_STRENGTH)};
  if (vWin < -1.5) {
    float blink = vWin < -2.5 && uEffects > 0.5 ? step(fract(uTime / ${glsl(BEACON_PERIOD_S)}), ${glsl(BEACON_ON_SHARE)}) : 1.0;
    totalEmissiveRadiance += diffuseColor.rgb * blink * max(uGlow, ${glsl(LAMP_DAY_GLOW)}) * ${glsl(LAMP_GLOW_STRENGTH)};
  }
}
#endif
`;

function patch(material, defines) {
  material.defines = { ...(material.defines || {}), ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERTEX_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAGMENT_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAGMENT_DISCARD);
    if (shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAGMENT_GLOW);
    }
    if (shader.fragmentShader.includes('#include <color_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' + FRAGMENT_COLOR
      );
    }
  };
  material.customProgramCacheKey = () => 'arco:' + Object.keys(defines).sort().join(',');
  return material;
}

// Section cut planes, empty when the cut is off
export const sectionPlanes = [];

// Counts cut solids in the stencil buffer
function stencilCounter(side, operation) {
  return patch(
    new THREE.MeshBasicMaterial({
      side,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      clippingPlanes: sectionPlanes,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: operation,
      stencilZFail: operation,
      stencilZPass: operation,
    }),
    { ARCO_INSTANCED: '' }
  );
}

export function createModuleMaterials() {
  const lit = patch(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: MODULE_ROUGHNESS,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: EDGE_OFFSET,
      polygonOffsetUnits: EDGE_OFFSET,
      clippingPlanes: sectionPlanes,
      clipShadows: true,
    }),
    { ARCO_INSTANCED: '' }
  );
  const depth = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { ARCO_INSTANCED: '' });
  const cutBack = stencilCounter(THREE.BackSide, THREE.IncrementWrapStencilOp);
  const cutFront = stencilCounter(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  return { lit, depth, cutBack, cutFront };
}

export function createPlinthMaterial(ringRadius, cellSize) {
  return patch(
    new THREE.MeshStandardMaterial({ color: PLINTH_COLOR, flatShading: true, roughness: PLINTH_ROUGHNESS, metalness: 0 }),
    { ARCO_PLINTH: '', ARCO_RING: ringRadius.toFixed(1), ARCO_CELL: cellSize.toFixed(1) }
  );
}
