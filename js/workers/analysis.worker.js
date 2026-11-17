import { analyze } from '../core/analysis.js';
import { waterNetwork } from '../core/flows.js';

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  try {
    // Flow networks ride along with the analysis
    const flows = { water: waterNetwork(modules, seed) };
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
