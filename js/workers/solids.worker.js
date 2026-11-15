import Module from '../../vendor/manifold/manifold.js';
import { loadManifold, createSolids } from '../core/solids.js';
import { variantKey } from '../core/grid.js';
import { checkPrintability } from '../core/printability.js';

const ready = loadManifold(Module, {
  locateFile: (name) => new URL('../../vendor/manifold/' + name, import.meta.url).href,
}).then(createSolids);

self.onmessage = async (event) => {
  const { id, variants, clearance } = event.data;
  try {
    const solids = await ready;
    for (const variant of variants) {
      const built = solids.buildVariant(variant, { clearance });
      const print = checkPrintability(built.solid, { pieces: built.parts });
      const part = { id, key: variantKey(variant), render: built.render, edges: built.edges, anchors: built.anchors, print };
      self.postMessage(part, [
        built.render.positions.buffer,
        built.render.colors.buffer,
        built.render.meta.buffer,
        built.render.index.buffer,
        built.edges.buffer,
      ]);
    }
    self.postMessage({ id, done: true });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
