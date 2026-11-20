import { PIECE_ID_BASE } from '../config.js';
import { variantKey } from './grid.js';
import { residentRecord } from './roster.js';
import { scorePuzzleLayout, layoutModules } from './puzzle.js';
import { residentExtras, structureResults, evaluateResidents } from './residents.js';
import { scoreLayout } from './scoring.js';

export const DAILY_FIRST_DATE = '2026-11-19'; // daily number 1
const DAY_MS = 86400000; // one day in milliseconds
export const SHARE_MARKS = { met: '✅', missed: '❌', hate: '⚠️', dream: '⭐', dreamMissed: '▫️' }; // share grid symbols

// Daily number counted from the first daily
export const dailyNumber = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(DAILY_FIRST_DATE + 'T00:00:00Z')) / DAY_MS) + 1;

// Start of a puzzle: the locked site and residents in their start homes
export function puzzleStart(puzzle) {
  return {
    modules: puzzle.site.map((instance) => ({ ...instance })),
    records: puzzle.residents.map((resident) => residentRecord(resident, resident.start === undefined ? null : resident.start)),
  };
}

// Placed tray pieces of a build, in placement order
const piecesOf = (modules) => modules.filter((instance) => instance.id >= PIECE_ID_BASE).sort((first, second) => first.id - second.id);

// Tray entries with what is left after the pieces placed
export function trayLeft(puzzle, modules) {
  const used = new Map();
  for (const instance of piecesOf(modules)) used.set(variantKey(instance), (used.get(variantKey(instance)) || 0) + 1);
  return puzzle.tray.map((entry) => ({ key: entry.key, variant: entry.variant, total: entry.count, count: entry.count - (used.get(entry.key) || 0) }));
}

// Layout of a build: pieces renumbered 1000 up, homes mapped to match
export function layoutOf(modules, assignments) {
  const toLayout = new Map();
  const pieces = piecesOf(modules).map((instance, index) => {
    toLayout.set(instance.id, PIECE_ID_BASE + index);
    return { key: variantKey(instance), cell: [instance.x, instance.y, instance.z], rot: instance.rot & 3 };
  });
  const fromLayout = new Map([...toLayout].map(([buildId, layoutId]) => [layoutId, buildId]));
  // A home that is not a placed piece keeps its site id; a removed piece means no home
  const mapHome = (home) => (home === null || home === undefined ? null : home >= PIECE_ID_BASE ? toLayout.get(home) || null : home);
  const residents = Object.fromEntries(Object.entries(assignments).map(([id, home]) => [id, mapHome(home)]));
  return { layout: { pieces, residents }, toLayout, fromLayout };
}

// Contribution key, so the same item before and after lines up
const itemKey = (item) => `${item.resident}|${item.kind}|${item.id}`;

// Changes between two scores: total and the biggest single cause
export function scoreChange(before, after) {
  const total = (after ? after.points : 0) - (before ? before.points : 0);
  const old = new Map((before ? before.contributions : []).map((item) => [itemKey(item), item.points]));
  const fresh = new Map((after ? after.contributions : []).map((item) => [itemKey(item), item]));
  const changes = [];
  for (const [key, item] of fresh) if ((old.get(key) || 0) !== item.points) changes.push({ ...item, delta: item.points - (old.get(key) || 0) });
  for (const [key, points] of old) if (!fresh.has(key)) {
    const [resident, kind, id] = key.split('|');
    changes.push({ resident: resident === 'null' ? null : resident, kind, id, delta: -points });
  }
  changes.sort((first, second) => Math.abs(second.delta) - Math.abs(first.delta));
  return { total, cause: changes[0] || null, changes };
}

// Share grid: one row per resident, then score against par
export function shareText({ title, residents, evaluations, score, par }) {
  const byId = new Map(evaluations.map((result) => [result.id, result]));
  const rows = residents.map((resident) => {
    const result = byId.get(resident.id);
    if (!result || result.home === null) return SHARE_MARKS.missed.repeat(resident.wants.length);
    const marks = result.wants.map((want) => (want.met ? SHARE_MARKS.met : SHARE_MARKS.missed));
    for (const hate of result.hates) if (hate.triggered) marks.push(SHARE_MARKS.hate);
    if (result.dream) marks.push(result.dream.met ? SHARE_MARKS.dream : SHARE_MARKS.dreamMissed);
    return marks.join('');
  });
  return [title, ...rows, `${score.points} / ${par} (${score.percent}%)`].join('\n');
}

const trayTotal = (puzzle) => puzzle.tray.reduce((sum, entry) => sum + entry.count, 0);
const BLOCKING = ['bad-layout', 'unknown-piece']; // problems that leave nothing to score

// Score without the validity rules, so the counter moves while a layout is not valid yet
function looseScore(puzzle, layout, cache) {
  const modules = layoutModules(puzzle, layout);
  const assignments = Object.fromEntries(puzzle.residents.map((resident) => [resident.id, layout.residents[resident.id] === undefined ? null : layout.residents[resident.id]]));
  const extra = residentExtras(puzzle.residents, assignments);
  const key = JSON.stringify([layout.pieces, extra]);
  let results = cache.get(key);
  if (!results) {
    results = structureResults(modules, puzzle.seed, extra);
    cache.set(key, results);
  }
  const evaluations = evaluateResidents(modules, results, puzzle.residents, assignments);
  return { score: scoreLayout(evaluations, { unused: trayTotal(puzzle) - layout.pieces.length, par: puzzle.par.points }), evaluations };
}

// Live score for play: validity, score, evaluations, and raw points per candidate home
export function playScore(puzzle, layout, { preview = null, cache = new Map() } = {}) {
  const checked = scorePuzzleLayout(puzzle, layout, { cache });
  let { score, evaluations } = checked;
  if (!checked.valid && !checked.problems.some((problem) => BLOCKING.includes(problem))) ({ score, evaluations } = looseScore(puzzle, layout, cache));
  const previews = {};
  if (preview && score) {
    for (const home of preview.homes) {
      const moved = { ...layout, residents: { ...layout.residents, [preview.resident]: home } };
      previews[home] = looseScore(puzzle, moved, cache).score.raw;
    }
  }
  return { valid: checked.valid, problems: checked.problems, score, evaluations, previews };
}
