import { analyze } from '../core/analysis.js';
import { waterNetwork, wireNetwork, tarpNetwork } from '../core/flows.js';

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  try {
    // Flow networks ride along with the analysis
    const flows = { water: waterNetwork(modules, seed), wires: wireNetwork(modules, seed).wires, tarps: tarpNetwork(modules, seed).tarps };
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
