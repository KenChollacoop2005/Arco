import { analyze } from '../core/analysis.js';
import { waterNetwork, wireNetwork, tarpNetwork } from '../core/flows.js';
import { structureMounts } from '../core/mounts.js';

// Active string ports, only what the renderer needs
const portView = (port) => ({ module: port.module, index: port.index, type: port.type, position: port.position, normal: port.normal });

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  try {
    // Flow networks ride along with the analysis
    const ports = structureMounts(modules).filter((port) => port.active).map(portView);
    const flows = { water: waterNetwork(modules, seed), wires: wireNetwork(modules, seed).wires, tarps: tarpNetwork(modules, seed).tarps, ports };
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
