import { STABILITY_MARGIN } from '../config.js';
import { convexHull, hullDistance, nearestInHull } from './hull.js';
import { solveFeasible } from './simplex.js';

const AREA_EPS = 1e-6; // smallest contact area
const INSIDE_EPS = 1e-7; // hull boundary tolerance
const LP_MAX_VARIABLES = 6000; // global solve size limit
const levelKey = (height) => Math.round(height * 1000);

function massOf(body) {
  let area = 0;
  let momentX = 0;
  let momentY = 0;
  for (const [minX, minY, maxX, maxY] of body.rects) {
    const rectArea = (maxX - minX) * (maxY - minY);
    area += rectArea;
    momentX += rectArea * (minX + maxX) * 0.5;
    momentY += rectArea * (minY + maxY) * 0.5;
  }
  const density = body.density === undefined ? 1 : body.density;
  return {
    weight: area * (body.z1 - body.z0) * density,
    x: momentX / area,
    y: momentY / area,
  };
}

// Contact patches under each body
function findContacts(bodies) {
  const tops = new Map();
  for (const body of bodies) {
    const key = levelKey(body.z1);
    if (!tops.has(key)) tops.set(key, []);
    tops.get(key).push(body);
  }
  const contacts = new Map();
  for (const body of bodies) {
    const patches = [];
    if (levelKey(body.z0) === 0) {
      for (const rect of body.rects) patches.push({ lower: 0, rect });
    } else {
      for (const lower of tops.get(levelKey(body.z0)) || []) {
        if (lower === body) continue;
        for (const upperRect of body.rects) {
          for (const lowerRect of lower.rects) {
            const minX = Math.max(upperRect[0], lowerRect[0]);
            const minY = Math.max(upperRect[1], lowerRect[1]);
            const maxX = Math.min(upperRect[2], lowerRect[2]);
            const maxY = Math.min(upperRect[3], lowerRect[3]);
            if (maxX - minX > 1e-6 && maxY - minY > 1e-6 && (maxX - minX) * (maxY - minY) > AREA_EPS) {
              patches.push({ lower: lower.id, rect: [minX, minY, maxX, maxY] });
            }
          }
        }
      }
    }
    contacts.set(body.id, patches);
  }
  return contacts;
}

function findGrounded(bodies, contacts) {
  const grounded = new Set([0]);
  const ordered = bodies.slice().sort((bodyA, bodyB) => bodyA.z0 - bodyB.z0);
  for (const body of ordered) {
    if (contacts.get(body.id).some((patch) => grounded.has(patch.lower))) grounded.add(body.id);
  }
  return grounded;
}

function patchCorners(rect, margin) {
  let [minX, minY, maxX, maxY] = rect;
  if (maxX - minX > 2 * margin) {
    minX += margin;
    maxX -= margin;
  } else {
    minX = maxX = (minX + maxX) * 0.5;
  }
  if (maxY - minY > 2 * margin) {
    minY += margin;
    maxY -= margin;
  } else {
    minY = maxY = (minY + maxY) * 0.5;
  }
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

function supportPoints(patches, grounded, margin) {
  const points = [];
  for (const patch of patches) {
    if (!grounded.has(patch.lower)) continue;
    for (const corner of patchCorners(patch.rect, margin)) {
      points.push({ x: corner[0], y: corner[1], lower: patch.lower });
    }
  }
  return points;
}

// Linear pressure, dropping points that would pull
function spreadLoad(points, total, loadX, loadY) {
  let active = points.map((point, index) => index);
  while (active.length >= 3) {
    let count = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, sumYY = 0;
    for (const index of active) {
      const offsetX = points[index].x - loadX;
      const offsetY = points[index].y - loadY;
      count++;
      sumX += offsetX;
      sumY += offsetY;
      sumXX += offsetX * offsetX;
      sumXY += offsetX * offsetY;
      sumYY += offsetY * offsetY;
    }
    const determinant =
      count * (sumXX * sumYY - sumXY * sumXY) -
      sumX * (sumX * sumYY - sumXY * sumY) +
      sumY * (sumX * sumXY - sumXX * sumY);
    if (Math.abs(determinant) < 1e-9) break;
    const base = (total * (sumXX * sumYY - sumXY * sumXY)) / determinant;
    const slopeX = (-total * (sumX * sumYY - sumXY * sumY)) / determinant;
    const slopeY = (total * (sumX * sumXY - sumXX * sumY)) / determinant;
    const forces = new Float64Array(points.length);
    let worst = -1;
    let worstForce = -1e-9 * total;
    for (const index of active) {
      const force = base + slopeX * (points[index].x - loadX) + slopeY * (points[index].y - loadY);
      forces[index] = force;
      if (force < worstForce) {
        worstForce = force;
        worst = index;
      }
    }
    if (worst < 0) {
      for (let index = 0; index < forces.length; index++) forces[index] = Math.max(0, forces[index]);
      return forces;
    }
    active = active.filter((index) => index !== worst);
  }
  return null;
}

// Three hull corners that carry the load
function cornerLoad(points, total, loadX, loadY) {
  const hull = convexHull(points.map((point) => [point.x, point.y]));
  const forces = new Float64Array(points.length);
  const indexOf = (corner) =>
    points.findIndex((point) => Math.abs(point.x - corner[0]) < 1e-9 && Math.abs(point.y - corner[1]) < 1e-9);
  if (hull.length === 1) {
    forces[indexOf(hull[0])] = total;
    return forces;
  }
  if (hull.length === 2) {
    const span = Math.hypot(hull[1][0] - hull[0][0], hull[1][1] - hull[0][1]);
    const along = Math.hypot(loadX - hull[0][0], loadY - hull[0][1]) / span;
    forces[indexOf(hull[0])] += total * (1 - along);
    forces[indexOf(hull[1])] += total * along;
    return forces;
  }
  let bestTriangle = null;
  let bestWorst = -Infinity;
  for (let index = 1; index < hull.length - 1; index++) {
    const [cornerA, cornerB, cornerC] = [hull[0], hull[index], hull[index + 1]];
    const area =
      (cornerB[0] - cornerA[0]) * (cornerC[1] - cornerA[1]) -
      (cornerB[1] - cornerA[1]) * (cornerC[0] - cornerA[0]);
    const weightB =
      ((loadX - cornerA[0]) * (cornerC[1] - cornerA[1]) - (loadY - cornerA[1]) * (cornerC[0] - cornerA[0])) / area;
    const weightC =
      ((cornerB[0] - cornerA[0]) * (loadY - cornerA[1]) - (cornerB[1] - cornerA[1]) * (loadX - cornerA[0])) / area;
    const weights = [1 - weightB - weightC, weightB, weightC];
    const worst = Math.min(...weights);
    if (worst > bestWorst) {
      bestWorst = worst;
      bestTriangle = { corners: [cornerA, cornerB, cornerC], weights };
    }
  }
  bestTriangle.corners.forEach((corner, index) => {
    forces[indexOf(corner)] += total * Math.max(0, bestTriangle.weights[index]);
  });
  return forces;
}

function greedyPass(bodies, contacts, grounded, masses, margin) {
  const incoming = new Map();
  const failed = new Map();
  const interfaces = [];
  const resultants = new Map();
  const ordered = bodies
    .filter((body) => grounded.has(body.id))
    .sort((bodyA, bodyB) => bodyB.z0 - bodyA.z0);
  for (const body of ordered) {
    const mass = masses.get(body.id);
    let total = mass.weight;
    let momentX = mass.weight * mass.x;
    let momentY = mass.weight * mass.y;
    for (const load of incoming.get(body.id) || []) {
      total += load.force;
      momentX += load.force * load.x;
      momentY += load.force * load.y;
    }
    let loadX = momentX / total;
    let loadY = momentY / total;
    const points = supportPoints(contacts.get(body.id), grounded, margin);
    const hull = convexHull(points.map((point) => [point.x, point.y]));
    const inside = hullDistance(hull, loadX, loadY);
    resultants.set(body.id, { x: loadX, y: loadY, total });
    if (inside < -INSIDE_EPS) {
      failed.set(body.id, inside);
      [loadX, loadY] = nearestInHull(hull, loadX, loadY);
    }
    const forces = spreadLoad(points, total, loadX, loadY) || cornerLoad(points, total, loadX, loadY);
    const perLower = new Map();
    points.forEach((point, index) => {
      if (forces[index] <= 0) return;
      let entry = perLower.get(point.lower);
      if (!entry) perLower.set(point.lower, (entry = { force: 0, x: 0, y: 0 }));
      entry.force += forces[index];
      entry.x += forces[index] * point.x;
      entry.y += forces[index] * point.y;
    });
    for (const [lower, entry] of perLower) {
      const load = { force: entry.force, x: entry.x / entry.force, y: entry.y / entry.force };
      interfaces.push({ upper: body.id, lower, force: load.force, x: load.x, y: load.y, z: body.z0 });
      if (lower !== 0) {
        if (!incoming.has(lower)) incoming.set(lower, []);
        incoming.get(lower).push(load);
      }
    }
  }
  return { failed, interfaces, resultants };
}

// Whole structure force balance as one linear program
function globalSolve(bodies, contacts, grounded, masses, margin) {
  const live = bodies.filter((body) => grounded.has(body.id));
  const rowOf = new Map();
  live.forEach((body, index) => rowOf.set(body.id, index * 3));
  const rows = Array.from({ length: live.length * 3 }, () => []);
  const rhs = new Float64Array(live.length * 3);
  const variables = [];
  let scale = 1;
  for (const body of live) {
    for (const rect of body.rects) scale = Math.max(scale, Math.abs(rect[0]), Math.abs(rect[1]), Math.abs(rect[2]), Math.abs(rect[3]));
  }
  let weightScale = 0;
  for (const body of live) weightScale = Math.max(weightScale, masses.get(body.id).weight);
  for (const body of live) {
    const mass = masses.get(body.id);
    const row = rowOf.get(body.id);
    rhs[row] = mass.weight / weightScale;
    rhs[row + 1] = (mass.weight / weightScale) * (mass.x / scale);
    rhs[row + 2] = (mass.weight / weightScale) * (mass.y / scale);
    for (const point of supportPoints(contacts.get(body.id), grounded, margin)) {
      const column = variables.length;
      variables.push({ upper: body.id, lower: point.lower, x: point.x, y: point.y, z: body.z0 });
      rows[row].push([column, 1]);
      rows[row + 1].push([column, point.x / scale]);
      rows[row + 2].push([column, point.y / scale]);
      if (point.lower !== 0) {
        const lowerRow = rowOf.get(point.lower);
        rows[lowerRow].push([column, -1]);
        rows[lowerRow + 1].push([column, -point.x / scale]);
        rows[lowerRow + 2].push([column, -point.y / scale]);
      }
    }
  }
  if (variables.length > LP_MAX_VARIABLES) return null;
  const solution = solveFeasible(rows, rhs, variables.length);
  if (!solution) return null;
  const merged = new Map();
  variables.forEach((variable, index) => {
    const force = solution[index] * weightScale;
    if (force <= 1e-12) return;
    const key = variable.upper + ':' + variable.lower;
    let entry = merged.get(key);
    if (!entry) merged.set(key, (entry = { upper: variable.upper, lower: variable.lower, force: 0, x: 0, y: 0, z: variable.z }));
    entry.force += force;
    entry.x += force * variable.x;
    entry.y += force * variable.y;
  });
  return [...merged.values()].map((entry) => ({ ...entry, x: entry.x / entry.force, y: entry.y / entry.force }));
}

function interfaceMargins(interfaces, contacts) {
  for (const contact of interfaces) {
    const corners = [];
    for (const patch of contacts.get(contact.upper)) {
      if (patch.lower === contact.lower) corners.push(...patchCorners(patch.rect, 0));
    }
    contact.margin = hullDistance(convexHull(corners), contact.x, contact.y);
  }
}

export function quickStable(bodies, margin = STABILITY_MARGIN) {
  const contacts = findContacts(bodies);
  const grounded = findGrounded(bodies, contacts);
  if (grounded.size - 1 !== bodies.length) return false;
  const masses = new Map(bodies.map((body) => [body.id, massOf(body)]));
  return greedyPass(bodies, contacts, grounded, masses, margin).failed.size === 0;
}

export function checkStability(bodies, options = {}) {
  const margin = options.margin === undefined ? STABILITY_MARGIN : options.margin;
  const contacts = findContacts(bodies);
  const grounded = findGrounded(bodies, contacts);
  const masses = new Map(bodies.map((body) => [body.id, massOf(body)]));
  const modules = new Map();
  for (const body of bodies) {
    modules.set(body.id, {
      status: grounded.has(body.id) ? 'pass' : 'fail',
      reason: grounded.has(body.id) ? '' : 'No load path to the plinth',
      margin: grounded.has(body.id) ? Infinity : -Infinity,
      supports: [...new Set(contacts.get(body.id).map((patch) => patch.lower))],
      com: masses.get(body.id),
    });
  }
  const strict = greedyPass(bodies, contacts, grounded, masses, margin);
  let interfaces = strict.interfaces;
  let method = 'direct';
  if (strict.failed.size > 0) {
    const loose = margin > 0 ? greedyPass(bodies, contacts, grounded, masses, 0) : strict;
    const strictGlobal = options.skipGlobal ? null : globalSolve(bodies, contacts, grounded, masses, margin);
    if (strictGlobal) {
      interfaces = strictGlobal;
      method = 'global';
    } else if (loose.failed.size === 0) {
      interfaces = loose.interfaces;
      for (const bodyId of strict.failed.keys()) {
        modules.get(bodyId).status = 'warn';
        modules.get(bodyId).reason = 'Inside the safety margin';
      }
    } else {
      const looseGlobal = options.skipGlobal || margin === 0 ? null : globalSolve(bodies, contacts, grounded, masses, 0);
      if (looseGlobal) {
        interfaces = looseGlobal;
        method = 'global';
        for (const bodyId of strict.failed.keys()) {
          modules.get(bodyId).status = 'warn';
          modules.get(bodyId).reason = 'Inside the safety margin';
        }
      } else {
        interfaces = loose.interfaces;
        for (const bodyId of strict.failed.keys()) {
          modules.get(bodyId).status = 'warn';
          modules.get(bodyId).reason = 'Inside the safety margin';
        }
        for (const bodyId of loose.failed.keys()) {
          modules.get(bodyId).status = 'fail';
          modules.get(bodyId).reason = 'Load falls outside its support';
        }
      }
    }
  }
  interfaceMargins(interfaces, contacts);
  let critical = null;
  for (const contact of interfaces) {
    const upper = modules.get(contact.upper);
    upper.margin = Math.min(upper.margin, contact.margin);
    if (!critical || contact.margin < critical.margin) critical = contact;
  }
  for (const [bodyId, overshoot] of strict.failed) {
    const entry = modules.get(bodyId);
    if (entry.status === 'fail') entry.margin = Math.min(entry.margin, overshoot);
  }
  let status = 'pass';
  for (const entry of modules.values()) {
    if (entry.status === 'fail') status = 'fail';
    else if (entry.status === 'warn' && status !== 'fail') status = 'warn';
  }
  return { status, modules, interfaces, critical, method };
}
