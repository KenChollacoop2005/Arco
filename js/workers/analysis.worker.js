import { analyze } from '../core/analysis.js';
import { structureMounts } from '../core/mounts.js';
import { stringContext } from '../core/strings.js';
import { planServices } from '../core/services.js';
import { pourPaths } from '../core/falls.js';
import { walkingNetwork, walkingLines } from '../core/walking.js';

// Active string ports, only what the renderer and inspector need
const portView = (port) => ({ module: port.module, index: port.index, type: port.type, capacity: port.capacity, position: port.position, normal: port.normal, ...(port.relay ? { relay: true } : {}) });

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  try {
    // Flow networks ride along with the analysis
    const mounts = structureMounts(modules);
    const context = stringContext(modules);
    const ports = mounts.filter((port) => port.active).map(portView);
    // Water, power and lines as strings on the physical ports
    const services = planServices(modules, seed, { mounts, context });
    // Pours from runoff and disposal stubs
    const flows = { ports, services, pours: pourPaths(modules, context) };
    // Walking: per module reach and nearest amenities, and the drawing lines
    const network = walkingNetwork(modules);
    const walking = { modules: network.modules, lines: walkingLines(network, modules) };
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows, walking } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
