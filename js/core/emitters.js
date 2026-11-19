import { instancePose, poseApply } from './grid.js';
import { buildRecipe } from './recipes.js';

// Families whose recipes mark smoke or steam
export const EMITTER_FAMILIES = ['smokestack', 'chimney', 'generator', 'cooling', 'vent'];

// Smoke and steam points in world mm, render only
export function particleEmitters(modules) {
  const smoke = [];
  const steam = [];
  for (const instance of modules) {
    if (!EMITTER_FAMILIES.includes(instance.family)) continue;
    const { anchors } = buildRecipe(instance);
    const pose = instancePose(instance);
    for (const point of anchors.smoke) smoke.push(poseApply(pose, ...point));
    for (const point of anchors.steam) steam.push(poseApply(pose, ...point));
  }
  return { smoke, steam };
}
