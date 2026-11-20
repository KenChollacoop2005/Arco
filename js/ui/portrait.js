import { figurePortrait } from '../core/figuremesh.js';

const PIXEL_SCALE = 2; // canvas pixels per CSS pixel
const FULL_PX = [140, 186]; // full figure portrait, CSS pixels
const CARD_PX = 96; // square card portrait, CSS pixels
const fullCache = new Map();
const cardCache = new Map();

// RGBA pixels to a PNG data URL
function toUrl(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

function rendered(cache, looks, figure, width, height, frame) {
  if (!cache.has(looks)) cache.set(looks, toUrl(figurePortrait(figure, { width, height, frame }), width, height));
  return cache.get(looks);
}

export const accentCss = (color) => `#${color.toString(16).padStart(6, '0')}`;

// Full figure portrait PNG, cached per looks seed
export const portraitOf = (looks, figure) => rendered(fullCache, looks, figure, FULL_PX[0] * PIXEL_SCALE, FULL_PX[1] * PIXEL_SCALE, 'full');

// Square head-and-shoulders card portrait PNG, cached per looks seed
export const cardPortraitOf = (looks, figure) => rendered(cardCache, looks, figure, CARD_PX * PIXEL_SCALE, CARD_PX * PIXEL_SCALE, 'card');
