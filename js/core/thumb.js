import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG } from '../config.js';

const SAMPLES = 2; // supersampling per axis
const PADDING = 0.06; // empty border share
const LIGHT = [0.35, -0.5, 0.79]; // light direction, toward the light
const SHADE_BASE = 0.55; // brightness of unlit faces
const SHADE_LIT = 0.5; // extra brightness facing the light
const GAMMA = 1 / 2.2; // linear to display
const GLOSS_STRENGTH = 0.45; // highlight strength on glossy parts
const GLOSS_POWER = 28; // highlight tightness
const LIGHT_UNIT = (() => {
  const length = Math.hypot(...LIGHT);
  return LIGHT.map((value) => value / length);
})();

// Camera vectors for a view: toward the viewer, screen right and up
export function viewBasis({ azimuth = CAMERA_AZIMUTH_DEG, elevation = CAMERA_ELEVATION_DEG } = {}) {
  const yaw = (azimuth * Math.PI) / 180;
  const pitch = (elevation * Math.PI) / 180;
  return {
    toward: [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)],
    right: [-Math.sin(yaw), Math.cos(yaw), 0],
    up: [-Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Small shaded picture of a mesh, RGBA bytes
// options: height (px), view {azimuth, elevation}, bounds {minX, maxX, minY, maxY} in view units,
// normals (smooth shading), gloss (per vertex 0 or 1), pattern {uvs, mask, sample(u, v) linear rgb}
export function rasterThumb(positions, index, colors, size, options = {}) {
  const { toward, right, up } = viewBasis(options.view);
  const width = size;
  const height = options.height || size;
  const half = [toward[0] + LIGHT_UNIT[0], toward[1] + LIGHT_UNIT[1], toward[2] + LIGHT_UNIT[2]];
  const halfLength = Math.hypot(...half);
  const halfway = half.map((value) => value / halfLength);
  const { normals, gloss, pattern } = options;
  const count = positions.length / 3;
  const screen = new Float32Array(count * 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let vertex = 0; vertex < count; vertex++) {
    const pointX = positions[vertex * 3];
    const pointY = positions[vertex * 3 + 1];
    const pointZ = positions[vertex * 3 + 2];
    const flatX = pointX * right[0] + pointY * right[1];
    const flatY = pointX * up[0] + pointY * up[1] + pointZ * up[2];
    screen[vertex * 3] = flatX;
    screen[vertex * 3 + 1] = flatY;
    screen[vertex * 3 + 2] = pointX * toward[0] + pointY * toward[1] + pointZ * toward[2];
    minX = Math.min(minX, flatX);
    maxX = Math.max(maxX, flatX);
    minY = Math.min(minY, flatY);
    maxY = Math.max(maxY, flatY);
  }
  if (options.bounds) ({ minX, maxX, minY, maxY } = options.bounds);
  const fineX = width * SAMPLES;
  const fineY = height * SAMPLES;
  const scale = Math.min((fineX * (1 - 2 * PADDING)) / Math.max(maxX - minX, 1e-6), (fineY * (1 - 2 * PADDING)) / Math.max(maxY - minY, 1e-6));
  const shiftX = (fineX - (maxX - minX) * scale) / 2;
  const shiftY = (fineY - (maxY - minY) * scale) / 2;
  for (let vertex = 0; vertex < count; vertex++) {
    screen[vertex * 3] = (screen[vertex * 3] - minX) * scale + shiftX;
    screen[vertex * 3 + 1] = fineY - ((screen[vertex * 3 + 1] - minY) * scale + shiftY);
  }
  const depth = new Float32Array(fineX * fineY).fill(-Infinity);
  const paint = new Float32Array(fineX * fineY * 3);
  const blend = (field, stride, corners, weights, channel) => field[corners[0] * stride + channel] * weights[0] + field[corners[1] * stride + channel] * weights[1] + field[corners[2] * stride + channel] * weights[2];
  for (let face = 0; face < index.length; face += 3) {
    const cornerA = index[face];
    const cornerB = index[face + 1];
    const cornerC = index[face + 2];
    const edgeU = [0, 1, 2].map((axis) => positions[cornerB * 3 + axis] - positions[cornerA * 3 + axis]);
    const edgeV = [0, 1, 2].map((axis) => positions[cornerC * 3 + axis] - positions[cornerA * 3 + axis]);
    const normal = [edgeU[1] * edgeV[2] - edgeU[2] * edgeV[1], edgeU[2] * edgeV[0] - edgeU[0] * edgeV[2], edgeU[0] * edgeV[1] - edgeU[1] * edgeV[0]];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length === 0 || normal[0] * toward[0] + normal[1] * toward[1] + normal[2] * toward[2] <= 0) continue;
    const lit = Math.max(0, (normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]) / length);
    const shade = SHADE_BASE + SHADE_LIT * lit;
    const tone = [0, 1, 2].map((channel) => ((colors[cornerA * 3 + channel] + colors[cornerB * 3 + channel] + colors[cornerC * 3 + channel]) / 3) * shade);
    const corners = [cornerA, cornerB, cornerC];
    const shiny = gloss && gloss[cornerA] > 0;
    const patterned = pattern && pattern.mask[cornerA] > 0;
    const ax = screen[cornerA * 3];
    const ay = screen[cornerA * 3 + 1];
    const bx = screen[cornerB * 3];
    const by = screen[cornerB * 3 + 1];
    const cx = screen[cornerC * 3];
    const cy = screen[cornerC * 3 + 1];
    const doubled = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (doubled === 0) continue;
    const fromX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const toX = Math.min(fineX - 1, Math.ceil(Math.max(ax, bx, cx)));
    const fromY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const toY = Math.min(fineY - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let pixelY = fromY; pixelY <= toY; pixelY++) {
      for (let pixelX = fromX; pixelX <= toX; pixelX++) {
        const sampleX = pixelX + 0.5;
        const sampleY = pixelY + 0.5;
        const weightA = ((bx - sampleX) * (cy - sampleY) - (by - sampleY) * (cx - sampleX)) / doubled;
        const weightB = ((cx - sampleX) * (ay - sampleY) - (cy - sampleY) * (ax - sampleX)) / doubled;
        const weightC = 1 - weightA - weightB;
        if (weightA < 0 || weightB < 0 || weightC < 0) continue;
        const near = weightA * screen[cornerA * 3 + 2] + weightB * screen[cornerB * 3 + 2] + weightC * screen[cornerC * 3 + 2];
        const spot = pixelY * fineX + pixelX;
        if (near <= depth[spot]) continue;
        depth[spot] = near;
        if (!normals) {
          paint[spot * 3] = tone[0];
          paint[spot * 3 + 1] = tone[1];
          paint[spot * 3 + 2] = tone[2];
          continue;
        }
        // Smooth shading from blended normals, a highlight on glossy parts
        const weights = [weightA, weightB, weightC];
        const smooth = [0, 1, 2].map((axis) => blend(normals, 3, corners, weights, axis));
        const smoothLength = Math.hypot(...smooth) || 1;
        const facing = smooth.map((value) => value / smoothLength);
        const light = SHADE_BASE + SHADE_LIT * Math.max(0, dot(facing, LIGHT_UNIT));
        const base = patterned ? pattern.sample(blend(pattern.uvs, 2, corners, weights, 0), blend(pattern.uvs, 2, corners, weights, 1)) : [0, 1, 2].map((channel) => blend(colors, 3, corners, weights, channel));
        const highlight = shiny ? GLOSS_STRENGTH * Math.pow(Math.max(0, dot(facing, halfway)), GLOSS_POWER) : 0;
        for (let channel = 0; channel < 3; channel++) paint[spot * 3 + channel] = base[channel] * light + highlight;
      }
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const sum = [0, 0, 0];
      let covered = 0;
      for (let stepY = 0; stepY < SAMPLES; stepY++) {
        for (let stepX = 0; stepX < SAMPLES; stepX++) {
          const spot = (pixelY * SAMPLES + stepY) * fineX + pixelX * SAMPLES + stepX;
          if (depth[spot] === -Infinity) continue;
          covered++;
          for (let channel = 0; channel < 3; channel++) sum[channel] += paint[spot * 3 + channel];
        }
      }
      if (covered === 0) continue;
      const out = (pixelY * width + pixelX) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[out + channel] = 255 * Math.pow(Math.min(1, sum[channel] / covered), GAMMA);
      }
      pixels[out + 3] = (255 * covered) / (SAMPLES * SAMPLES);
    }
  }
  return pixels;
}
