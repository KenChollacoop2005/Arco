import { analyze } from '../core/analysis.js';
import { planServices } from '../core/services.js';
import { pourPaths } from '../core/falls.js';
import { walkingNetwork, walkingLines, plinthRoutes } from '../core/walking.js';
import { lightPlan } from '../core/lights.js';
import { particleEmitters } from '../core/emitters.js';
import { residentExtras, structureResults, evaluateResidents } from '../core/residents.js';
import { scoreLayout } from '../core/scoring.js';
import { playScore } from '../core/puzzleplay.js';
import { serviceBase, manualRoute, orient, stringTypeOf, endKey, pairKey, PAIR_CAPS } from '../core/wiring.js';
import { structureHash } from '../core/grid.js';

// Ports, string context and route graphs of the last structure, reused while only the wiring changes
let lastBase = { hash: null, base: null };
function baseOf(modules) {
  const hash = structureHash(modules);
  if (lastBase.hash !== hash) lastBase = { hash, base: serviceBase(modules) };
  return lastBase.base;
}

const PLAY_CACHE_MAX = 400; // structure results kept for one puzzle
let playCache = { id: null, entries: new Map() };

// Puzzle play scores share one cache per puzzle
function puzzleReport({ puzzle, layout, preview }) {
  if (playCache.id !== puzzle.id || playCache.entries.size > PLAY_CACHE_MAX) playCache = { id: puzzle.id, entries: new Map() };
  return playScore(puzzle, layout, { preview, cache: playCache.entries });
}

// Active string ports, only what the renderer and inspector need
const portView = (port) => ({ module: port.module, index: port.index, type: port.type, capacity: port.capacity, position: port.position, normal: port.normal, ...(port.relay ? { relay: true } : {}) });

// Residents scored on a structure; previews give raw points per candidate home for one resident
function residentReport({ modules, seed, residents, assignments, preview, wiring = null }) {
  const structure = baseOf(modules);
  const score = (given, cached) => {
    const results = cached || structureResults(modules, seed, residentExtras(residents, given), { wiring, base: structure });
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

// Water, power and lines again after a wiring change, with the lights they feed
function flowsReport({ modules, seed, wiring }) {
  const started = performance.now();
  const reused = lastBase.hash === structureHash(modules);
  const base = baseOf(modules);
  const services = planServices(modules, seed, { base, wiring });
  return { services, lights: lightPlan(modules, services), solveMs: Math.round(performance.now() - started), reused };
}

// Every port one port could connect to, with its route or why not
function candidatesReport({ modules, from, wiring }) {
  const base = baseOf(modules);
  const start = base.mounts.find((port) => port.module === from.module && port.index === from.index && port.active);
  if (!start || !stringTypeOf(start.type)) return { candidates: [] };
  // Manual strings already on each port and pair; automatic ones give way
  const held = new Map();
  const pairs = new Map();
  for (const connection of wiring ? wiring.connections : []) {
    for (const end of [connection.a, connection.b]) held.set(endKey(end), (held.get(endKey(end)) || 0) + 1);
    pairs.set(pairKey(connection.a, connection.b), (pairs.get(pairKey(connection.a, connection.b)) || 0) + 1);
  }
  const full = (port) => (held.get(endKey(port)) || 0) >= port.capacity;
  const candidates = [];
  for (const port of base.mounts) {
    if (!port.active || port === start) continue;
    const oriented = orient(start, port);
    if (!oriented.ok) continue;
    const refused = full(start) || full(port) ? 'port-full' : (pairs.get(pairKey(start, port)) || 0) >= PAIR_CAPS[oriented.connection.type] ? 'pair-cap' : null;
    const route = refused ? { ok: false, reason: refused, points: [start.position, port.position], blocker: null } : manualRoute(base, oriented.connection);
    const { route: unused, size, line, ...shown } = route;
    candidates.push({ port: { module: port.module, index: port.index }, connection: oriented.connection, ...shown });
  }
  return { candidates };
}

self.onmessage = (event) => {
  const { id, modules, seed } = event.data;
  if (event.data.kind === 'flows' || event.data.kind === 'candidates') {
    try {
      self.postMessage({ id, done: true, result: event.data.kind === 'flows' ? flowsReport(event.data) : candidatesReport(event.data) });
    } catch (error) {
      self.postMessage({ id, error: String(error && error.message ? error.message : error) });
    }
    return;
  }
  if (event.data.kind === 'residents' || event.data.kind === 'puzzle') {
    try {
      self.postMessage({ id, done: true, result: event.data.kind === 'puzzle' ? puzzleReport(event.data) : residentReport(event.data) });
    } catch (error) {
      self.postMessage({ id, error: String(error && error.message ? error.message : error) });
    }
    return;
  }
  try {
    // Flow networks ride along with the analysis
    const base = baseOf(modules);
    const { mounts, context } = base;
    const ports = mounts.filter((port) => port.active).map(portView);
    // Water, power and lines as strings on the physical ports, manual ones pinned
    const services = planServices(modules, seed, { base, wiring: event.data.wiring || null });
    // Pours from runoff and disposal stubs
    const flows = { ports, services, pours: pourPaths(modules, context) };
    // Walking: per module reach and nearest amenities, and the drawing lines
    const network = walkingNetwork(modules);
    const walking = { modules: network.modules, lines: walkingLines(network, modules), routes: plinthRoutes(network) };
    // Lit windows, outdoor lights and the cells they light
    const lights = lightPlan(modules, services);
    self.postMessage({ id, done: true, result: { ...analyze(modules), flows, walking, lights, emitters: particleEmitters(modules) } });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
