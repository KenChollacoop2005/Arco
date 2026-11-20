import { POINTS } from '../config.js';

// Contributions of one evaluated resident: {kind, id, points, reason}
export function residentContributions(result) {
  const items = [];
  for (const need of result.needs) items.push({ kind: 'need', id: need.id, points: need.met ? POINTS.needMet : POINTS.needMissed, reason: need.reason });
  for (const want of result.wants) items.push({ kind: 'want', id: want.id, points: want.met ? POINTS.wantMet : POINTS.wantMissed, reason: want.reason });
  for (const hate of result.hates) if (hate.met) items.push({ kind: 'hate', id: hate.id, points: POINTS.hateTriggered, reason: hate.reason });
  if (result.dream) items.push({ kind: 'dream', id: result.dream.id, points: result.dream.met ? POINTS.dreamMet : POINTS.dreamMissed, reason: result.dream.reason });
  if (result.happy) items.push({ kind: 'happy', id: 'happy', points: POINTS.happy, reason: 'perfectly-happy' });
  return items;
}

// Points of one evaluated resident, before the floor on the total
export function residentPoints(result) {
  return residentContributions(result).reduce((sum, item) => sum + item.points, 0);
}

// Points for unused tray pieces, capped
export function unusedPoints(unused) {
  return Math.min(POINTS.unusedCap, Math.max(0, unused) * POINTS.unusedPiece);
}

// Share of par as a whole percentage, may pass 100
export function percentOf(points, par) {
  return par > 0 ? Math.round((points / par) * 100) : 0;
}

// Score of a layout: every contribution with its reason, points floored at 0
export function scoreLayout(evaluations, { unused = 0, par = 0 } = {}) {
  const contributions = [];
  for (const result of evaluations) for (const item of residentContributions(result)) contributions.push({ resident: result.id, ...item });
  if (unused > 0) contributions.push({ resident: null, kind: 'unused', id: 'unused', count: unused, points: unusedPoints(unused), reason: 'unused-pieces' });
  const raw = contributions.reduce((sum, item) => sum + item.points, 0);
  const points = Math.max(0, raw);
  return { points, raw, percent: percentOf(points, par), happy: evaluations.filter((result) => result.happy).length, contributions };
}
