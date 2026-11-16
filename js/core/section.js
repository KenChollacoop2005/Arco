import { CELL_MM, STORY_MM, PLINTH_DIAMETER_CELLS } from '../config.js';

export const SECTION_STEPS = 1000; // slider steps across the model
export const SECTION_PAD_MM = 2; // plane travel past the model
const TOWARD_VIEWER = [0, -1, 0]; // side a vertical cut removes
const MIN_HEIGHT_MM = STORY_MM; // cut range on an empty plinth

export const SECTION_AXES = ['h', 'v'];

// Size the cut plane travels through, in mm
export function sectionExtent(modules) {
  const top = Math.max(0, ...modules.map((instance) => instance.z + instance.h)) * STORY_MM;
  return { height: Math.max(MIN_HEIGHT_MM, top), half: (PLINTH_DIAMETER_CELLS * CELL_MM) / 2 };
}

// Kept side is normal . point + constant >= 0
export function sectionPlane(axis, share, extent) {
  const along = Math.min(1, Math.max(0, share));
  if (axis === 'v') {
    const reach = extent.half + SECTION_PAD_MM;
    const offset = -reach + along * 2 * reach;
    const normal = TOWARD_VIEWER.map((part) => -part || 0);
    const point = TOWARD_VIEWER.map((part) => part * offset || 0);
    point[2] = extent.height / 2;
    return { axis: 'v', normal, constant: offset, point };
  }
  const level = along * (extent.height + SECTION_PAD_MM);
  return { axis: 'h', normal: [0, 0, -1], constant: level, point: [0, 0, level] };
}

export function planeDistance(plane, point) {
  return plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] + plane.constant;
}

// Slider step to a share of the travel
export const sectionShare = (step) => Math.min(1, Math.max(0, step / SECTION_STEPS));
