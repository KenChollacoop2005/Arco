import { CELL_MM, STORY_MM } from '../config.js';
import { canSupport } from './catalog.js';
import { hashString, mixSeed, makeRng } from './rng.js';
import { voxelKey } from './grid.js';
import { FACE_TOP } from './analysis.js';

const EDGE_KEEP_MM = 6; // decor stays this far inside a cell

// Decor types: box size in mm, color, chance per open roof cell
export const DECOR_TYPES = {
  crate: { size: [5, 4, 3], color: 0x8c7b62, chance: 0.18 },
};

// Seeded render-only items from the analysis, never exported
export function decorItems(analysis, modules, seedText) {
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const base = hashString(String(seedText));
  const items = [];
  for (const face of analysis.faces) {
    if (face.dir !== FACE_TOP || !face.sky) continue;
    const instance = byId.get(face.module);
    if (!instance || !canSupport(instance)) continue;
    const rng = makeRng(mixSeed(mixSeed(base, face.module), voxelKey(face.x, face.y, face.level)));
    for (const [type, kind] of Object.entries(DECOR_TYPES)) {
      if (!rng.chance(kind.chance)) continue;
      items.push({
        type,
        module: face.module,
        position: [
          face.x * CELL_MM + rng.range(EDGE_KEEP_MM, CELL_MM - EDGE_KEEP_MM),
          face.y * CELL_MM + rng.range(EDGE_KEEP_MM, CELL_MM - EDGE_KEEP_MM),
          (face.level + 1) * STORY_MM,
        ],
        turn: rng.range(0, Math.PI / 2),
      });
    }
  }
  return items;
}
