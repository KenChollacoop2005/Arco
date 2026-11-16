import Module from '../vendor/manifold/manifold.js';
import { loadManifold, createSolids } from '../js/core/solids.js';
import { FAMILIES, FAMILY_IDS, normalizeVariant } from '../js/core/catalog.js';

let solids = null;

export async function getSolids() {
  if (!solids) solids = createSolids(await loadManifold(Module));
  return solids;
}

let rapier = null;

// Rapier loaded once for the physics tests
export async function getRapier() {
  if (!rapier) {
    rapier = (await import('../vendor/rapier/rapier.mjs')).default;
    await rapier.init();
  }
  return rapier;
}

// One variant per family, footprint and height limit
export function sampleVariants() {
  const variants = [];
  let seed = 11;
  for (const id of FAMILY_IDS) {
    const family = FAMILIES[id];
    const heights = [...new Set([family.minStories, family.maxStories])];
    for (const fp of family.footprints) {
      for (const h of heights) {
        variants.push(normalizeVariant({ family: id, fp, h, seed: seed++, mask: 15, roof: false }));
      }
    }
    const fp = family.footprints[0];
    if (family.roofable) {
      for (const roofed of family.footprints) {
        for (const h of heights) variants.push(normalizeVariant({ family: id, fp: roofed, h, seed: seed++, mask: 15, roof: true }));
      }
    }
    if (family.rails) {
      variants.push(normalizeVariant({ family: id, fp, h: family.minStories, seed: seed++, mask: 0, roof: false }));
      variants.push(normalizeVariant({ family: id, fp: family.footprints[family.footprints.length - 1], h: family.maxStories, seed: seed++, mask: 5, roof: false }));
    }
  }
  return variants;
}
