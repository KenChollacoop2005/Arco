import { CELL_MM, STORY_MM, LIGHT_DEMAND, LIGHT_RADIUS_CELLS, WINDOW_LIT_SHARE, FLICKER_SHARE } from '../config.js';
import { instancePose, poseApply, cellInPlinth } from './grid.js';
import { buildRecipe } from './recipes.js';

// Families that are outdoor lights in their own right
export const LIGHT_FAMILIES = ['lamppost', 'floodlight'];

// Power a module's own lights draw, always on
export const lightDemand = (instance) => (LIGHT_DEMAND[instance.family] || 0) + (instance.bc ? LIGHT_DEMAND.beacon : 0);

// Share of demand met, 0 when not a consumer
export function powerShare(report) {
  if (!report || !(report.demand > 0)) return 0;
  return Math.min(1, report.received / report.demand);
}

// Lit window share and flicker flag from a power share
export function windowLight(share) {
  if (share <= 0) return [0, 0];
  return [share >= 1 ? WINDOW_LIT_SHARE : WINDOW_LIT_SHARE * share, share < FLICKER_SHARE ? 1 : 0];
}

// Lamp and beacon points of one module in world mm
export function lampPoints(instance) {
  const { anchors } = buildRecipe(instance);
  const pose = instancePose(instance);
  return {
    lamps: anchors.lamps.map((point) => poseApply(pose, ...point)),
    beacons: (anchors.beacons || []).map((point) => poseApply(pose, ...point)),
  };
}

// Voxels whose centre is within a light's radius, inside the plinth
export function litCells(sources, topLevel) {
  const keys = new Set();
  const cells = [];
  for (const source of sources) {
    if (!source.lit || !(source.radius > 0)) continue;
    const reach = source.radius * CELL_MM;
    const [lowX, highX] = [Math.floor((source.point[0] - reach) / CELL_MM), Math.floor((source.point[0] + reach) / CELL_MM)];
    const [lowY, highY] = [Math.floor((source.point[1] - reach) / CELL_MM), Math.floor((source.point[1] + reach) / CELL_MM)];
    const [lowZ, highZ] = [Math.max(0, Math.floor((source.point[2] - reach) / STORY_MM)), Math.min(topLevel, Math.floor((source.point[2] + reach) / STORY_MM))];
    for (let cellX = lowX; cellX <= highX; cellX++) {
      for (let cellY = lowY; cellY <= highY; cellY++) {
        if (!cellInPlinth(cellX, cellY)) continue;
        for (let level = lowZ; level <= highZ; level++) {
          const centre = [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM, (level + 0.5) * STORY_MM];
          if (Math.hypot(centre[0] - source.point[0], centre[1] - source.point[1], centre[2] - source.point[2]) > reach) continue;
          const key = cellX + ',' + cellY + ',' + level;
          if (keys.has(key)) continue;
          keys.add(key);
          cells.push([cellX, cellY, level]);
        }
      }
    }
  }
  return cells.sort((first, second) => first[2] - second[2] || first[1] - second[1] || first[0] - second[0]);
}

// Window shares, outdoor lights, string lights and lit cells from a services plan
export function lightPlan(modules, services) {
  const consumers = (services && services.power && services.power.consumers) || {};
  const shares = new Map(modules.map((instance) => [instance.id, powerShare(consumers[instance.id])]));
  const perModule = {};
  const sources = [];
  const beacons = [];
  for (const instance of modules) {
    const share = shares.get(instance.id);
    const radius = LIGHT_RADIUS_CELLS[instance.family] || 0;
    perModule[instance.id] = { share, window: windowLight(share), radius: LIGHT_FAMILIES.includes(instance.family) ? radius : 0 };
    if (!LIGHT_FAMILIES.includes(instance.family) && !instance.bc) continue;
    const points = lampPoints(instance);
    for (const point of points.lamps) sources.push({ module: instance.id, kind: instance.family, point, base: instance.z * STORY_MM, radius, lit: share > 0 });
    for (const point of points.beacons) beacons.push({ module: instance.id, point, lit: share > 0 });
  }
  const strings = ((services && services.lights) || []).map((run) => ({ ...run, lit: shares.get(run.owner) > 0 }));
  for (const run of strings) {
    const owner = perModule[run.owner];
    if (owner) owner.radius = Math.max(owner.radius, LIGHT_RADIUS_CELLS.stringlights);
    const middle = run.points[Math.floor(run.points.length / 2)];
    sources.push({ module: run.owner, kind: 'stringlights', point: middle, base: null, radius: LIGHT_RADIUS_CELLS.stringlights, lit: run.lit });
  }
  const topLevel = Math.max(0, ...modules.map((instance) => instance.z + instance.h)) + 1;
  return { modules: perModule, sources, beacons, strings, cells: litCells(sources, topLevel) };
}
