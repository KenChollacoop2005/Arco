import { analyze } from '../core/analysis.js';
import { structureMounts } from '../core/mounts.js';
import { stringContext } from '../core/strings.js';
import { planServices } from '../core/services.js';
import { pourPaths } from '../core/falls.js';
import { walkingNetwork, walkingLines } from '../core/walking.js';
import { lightPlan } from '../core/lights.js';
import { particleEmitters } from '../core/emitters.js';
import { residentExtras, structureResults, evaluateResidents } from '../core/residents.js';
import { scoreLayout } from '../core/scoring.js';

// Active string ports, only what the renderer and inspector need
const portView = (port) => ({ module: port.module, index: port.index, type: port.type, capacity: port.capacity, position: port.position, normal: port.normal, ...(port.relay ? { relay: true } : {}) });

// Residents scored on a structure; previews give raw points per candidate home for one resident
function residentReport({ modules, seed, residents, assignments, preview }) {
  const score = (given, cached) => {
    const results = cached || structureResults(modules, seed, residentExtras(residents, given));
    const evaluations = evaluateResidents(modules, results, residents, given);
    const layout = scoreLayout(evaluations, { unused: 0 });
    return { evaluations, points: layout.points, raw: layout.raw, results };
  };
  const base = score(assignments);
  const previews = {};
  if (preview) {
    const mover = residents.find((resident) => resident.id === preview.resident);
    // Extra water or power changes the services, so those rerun
    const extraWant = !!mover && mover.wants.some((trait) => trait.id === 'water' || trait.id === 'power');
    for (const home of preview.homes) previews[home] = score({ ...assignments, [preview.resident]: home }, extraWant ? null : base.results).raw;
  }
  return { evaluations: base.evaluations, points: base.points, raw: base.raw, previews };
}

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  if (event.data.kind === 'residents') {
    try {
      self.postMessage({ id, done: true, result: residentReport(event.data) });
    } catch (error) {
      self.postMessage({ id, error: String(error && error.message ? error.message : error) });
    }
    return;
  }
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
    // Lit windows, outdoor lights and the cells they light
    const lights = lightPlan(modules, services);
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows, walking, lights, emitters: particleEmitters(modules) } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
