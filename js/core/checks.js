import { STABILITY_MARGIN } from '../config.js';
import { toBody, worldFromModules } from './grid.js';
import { validateStructure } from './placement.js';
import { checkStability } from './stability.js';

const MARGIN_EPS_MM = 1e-6; // rounding slack on margins
const FIT_TOL_MM = 0.01; // allowed error in measured clearance
const finite = (value) => (Number.isFinite(value) ? value : null);

export function marginStatus(margin) {
  if (margin < -MARGIN_EPS_MM) return 'fail';
  return margin < STABILITY_MARGIN - MARGIN_EPS_MM ? 'warn' : 'pass';
}

// Measured connector gap against the setting
export function fitStatus(gap, clearance) {
  return Math.abs(gap - clearance) <= FIT_TOL_MM ? 'pass' : 'fail';
}

// Stability and placement for a module list, plain data out
export function runChecks(modules) {
  const world = worldFromModules(modules);
  const bodies = modules.map(toBody);
  const stability = checkStability(bodies);
  const problems = new Map(validateStructure(world).map((problem) => [problem.id, problem.reason]));
  const perModule = {};
  for (const body of bodies) {
    const entry = stability.modules.get(body.id);
    perModule[body.id] = {
      stability: { status: entry.status, reason: entry.reason, margin: finite(entry.margin), supports: entry.supports },
      placement: { status: problems.has(body.id) ? 'fail' : 'pass', reason: problems.get(body.id) || '' },
      com: [entry.com.x, entry.com.y, (body.z0 + body.z1) / 2],
    };
  }
  const plain = (contact) => ({
    upper: contact.upper,
    lower: contact.lower,
    force: contact.force,
    at: [contact.x, contact.y, contact.z],
    margin: contact.margin,
    status: stability.modules.get(contact.upper).status === 'fail' ? 'fail' : marginStatus(contact.margin),
  });
  return {
    stability: stability.status,
    placement: problems.size > 0 ? 'fail' : 'pass',
    method: stability.method,
    modules: perModule,
    interfaces: stability.interfaces.map(plain),
    critical: stability.critical ? plain(stability.critical) : null,
  };
}
