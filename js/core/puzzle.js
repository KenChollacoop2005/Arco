import {
  PUZZLE_FORMAT_VERSION, PUZZLE_GENERATOR_VERSION, PUZZLE_MAX_PIECES, PUZZLE_ANSWER, PUZZLE_RESIDENTS, PUZZLE_PRESET_RESIDENTS, PUZZLE_SITE_SHARE,
  PUZZLE_DECOYS, PUZZLE_TRAIT_SHARE, PUZZLE_TRAIT_TRIES, PUZZLE_REROLLS, PAR_STEPS, PAR_PIECE_SHARE, PAR_PLACE_TRIES, PAR_POINTS, PAR_START_SHARE,
  PIECE_ID_BASE, SOURCE_FAMILIES, PUMP_KINDS,
} from '../config.js';
import { FAMILIES, FAMILY_IDS, hasPump, normalizeVariant, residentCapacity, categoryOn, CATEGORIES } from './catalog.js';
import { variantKey, worldFromModules, toBody, plinthCells } from './grid.js';
import { checkPlacement } from './placement.js';
import { checkStability } from './stability.js';
import { streamFrom } from './stream.js';
import { generate } from './generator.js';
import { restLevel } from './build.js';
import { powerRole } from './power.js';
import { makeRng, mixSeed, hashString } from './rng.js';
import { rollResident, evaluateResidents, structureResults, residentExtras, traitsOf, isHome } from './residents.js';
import { scoreLayout } from './scoring.js';

const PUZZLE_SALT = 0x9a221e; // keeps puzzle rolls apart from the generator
const PAR_SALT = 0x9a2; // keeps par search rolls apart

const isWaterSource = (instance) => !!SOURCE_FAMILIES[instance.family] || (!!PUMP_KINDS[instance.family] && hasPump(instance) && instance.family !== 'smallpump');
const isPowerSource = (instance) => (powerRole(instance) || {}).kind === 'source';
const byOrder = (first, second) => first.z - second.z || first.y - second.y || first.x - second.x || first.id - second.id;

// Content rules of an answer: sources, a pump, an amenity, enough homes
export function answerProblems(modules, residents) {
  const problems = [];
  if (modules.length > PUZZLE_MAX_PIECES) problems.push('too-many-pieces');
  if (!modules.some(isWaterSource)) problems.push('no-water-source');
  if (!modules.some(isPowerSource)) problems.push('no-power-source');
  if (!modules.some(hasPump)) problems.push('no-pump');
  if (!modules.some((instance) => FAMILIES[instance.family].amenity)) problems.push('no-amenity');
  if (modules.reduce((sum, instance) => sum + residentCapacity(instance), 0) < residents) problems.push('too-few-homes');
  return problems;
}

// Modules of a layout: the locked site, then placed tray pieces
export function layoutModules(puzzle, layout) {
  const variants = new Map(puzzle.tray.map((entry) => [entry.key, entry.variant]));
  const pieces = layout.pieces.map((piece, index) => ({ ...variants.get(piece.key), id: PIECE_ID_BASE + index, x: piece.cell[0], y: piece.cell[1], z: piece.cell[2], rot: piece.rot & 3 }));
  return [...puzzle.site, ...pieces].sort(byOrder);
}

// Validity of a submitted layout: tray counts, placement, stability, homes with room
export function validateLayout(puzzle, layout) {
  const problems = [];
  if (!layout || !Array.isArray(layout.pieces) || !layout.residents || typeof layout.residents !== 'object') return { ok: false, problems: ['bad-layout'] };
  const left = new Map(puzzle.tray.map((entry) => [entry.key, entry.count]));
  for (const piece of layout.pieces) {
    const cellOk = Array.isArray(piece.cell) && piece.cell.length === 3 && piece.cell.every(Number.isInteger) && Number.isInteger(piece.rot);
    if (!cellOk || !left.has(piece.key)) return { ok: false, problems: ['unknown-piece'] };
    left.set(piece.key, left.get(piece.key) - 1);
    if (left.get(piece.key) < 0) problems.push('over-count');
  }
  const modules = layoutModules(puzzle, layout);
  const world = worldFromModules(modules);
  if (world.modules.size !== modules.length) problems.push('overlap');
  const stream = streamFrom(puzzle.stream);
  for (const instance of modules) {
    const result = checkPlacement(world, instance, { stream, ignoreCap: true });
    if (!result.ok) {
      problems.push(instance.id >= PIECE_ID_BASE ? 'placement' : 'site-broken');
      break;
    }
  }
  if (problems.length === 0 && checkStability(modules.map(toBody)).status !== 'pass') problems.push('unstable');
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const known = new Set(puzzle.residents.map((resident) => resident.id));
  const count = new Map();
  for (const [resident, home] of Object.entries(layout.residents)) {
    if (!known.has(resident)) problems.push('unknown-resident');
    if (home === null) continue;
    const instance = byId.get(home);
    if (!instance || !isHome(instance)) {
      problems.push('not-a-home');
      continue;
    }
    count.set(home, (count.get(home) || 0) + 1);
    if (count.get(home) > residentCapacity(instance)) problems.push('home-full');
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// Assignments with every resident listed, unplaced as null
const assignmentsOf = (puzzle, layout) => Object.fromEntries(puzzle.residents.map((resident) => [resident.id, layout.residents[resident.id] === undefined ? null : layout.residents[resident.id]]));
const trayTotal = (puzzle) => puzzle.tray.reduce((sum, entry) => sum + entry.count, 0);

// Scores a layout; cache maps a structure and extras key to its results
export function scorePuzzleLayout(puzzle, layout, { cache = null, par = puzzle.par ? puzzle.par.points : 0 } = {}) {
  const validity = validateLayout(puzzle, layout);
  if (!validity.ok) return { valid: false, problems: validity.problems, score: null, evaluations: [] };
  const modules = layoutModules(puzzle, layout);
  const assignments = assignmentsOf(puzzle, layout);
  const extra = residentExtras(puzzle.residents, assignments);
  const key = JSON.stringify([layout.pieces, extra]);
  let results = cache && cache.get(key);
  if (!results) {
    results = structureResults(modules, puzzle.seed, extra);
    if (cache) cache.set(key, results);
  }
  const evaluations = evaluateResidents(modules, results, puzzle.residents, assignments);
  const score = scoreLayout(evaluations, { unused: trayTotal(puzzle) - layout.pieces.length, par });
  return { valid: true, problems: [], score, evaluations };
}

// Lowest modules first, while what is taken still stands alone
function splitSite(modules) {
  const ordered = [...modules].sort(byOrder);
  for (let count = Math.round(ordered.length * PUZZLE_SITE_SHARE); count > 0; count--) {
    const site = ordered.slice(0, count);
    if (checkStability(site.map(toBody)).status === 'pass') return { site, rest: ordered.slice(count) };
  }
  return null;
}

// Homes with room left, in id order
function roomyHomes(modules, assignments, only = null) {
  const used = new Map();
  for (const home of Object.values(assignments)) if (home !== null) used.set(home, (used.get(home) || 0) + 1);
  return modules.filter((instance) => isHome(instance) && (!only || only.has(instance.id)) && (used.get(instance.id) || 0) < residentCapacity(instance)).map((instance) => instance.id);
}

// A plausible stand-in: another seed, size or family of the same group
function decoyOf(rng, base) {
  const family = FAMILIES[base.family];
  const siblings = FAMILY_IDS.filter((id) => FAMILIES[id].group === family.group && !FAMILIES[id].disabled && categoryOn(id, CATEGORIES) && !FAMILIES[id].spanning);
  const pickFamily = FAMILIES[rng.chance(0.5) ? base.family : rng.pick(siblings.length > 0 ? siblings : [base.family])];
  const fp = rng.pick(pickFamily.footprints);
  const h = rng.int(pickFamily.minStories, Math.min(pickFamily.maxStories, pickFamily.minStories + 2));
  return normalizeVariant({ family: pickFamily.id, fp, h, seed: rng.int(1, 0x7fffffff), mask: base.mask, roof: !!base.roof });
}

function addToTray(tray, variant, count = 1) {
  const key = variantKey(variant);
  const entry = tray.find((item) => item.key === key);
  if (entry) entry.count += count;
  else tray.push({ key, variant, count });
}

// Share of traits the answer satisfies: wants met, hates clear, dreams met
function traitShare(evaluations) {
  let good = 0;
  let total = 0;
  for (const result of evaluations) {
    for (const want of result.wants) good += want.met ? 1 : 0;
    for (const hate of result.hates) good += hate.met ? 0 : 1;
    if (result.dream) good += result.dream.met ? 1 : 0;
    total += result.wants.length + result.hates.length + (result.dream ? 1 : 0);
  }
  return total > 0 ? good / total : 0;
}

// One step of the par search: a resident moves, or a tray piece is added, moved or taken away
function mutate(rng, puzzle, layout) {
  const next = { pieces: layout.pieces.map((piece) => ({ ...piece, cell: [...piece.cell] })), residents: { ...layout.residents } };
  if (!rng.chance(PAR_PIECE_SHARE)) {
    const modules = layoutModules(puzzle, next);
    const resident = rng.pick(puzzle.residents).id;
    const homes = roomyHomes(modules, { ...next.residents, [resident]: null });
    if (homes.length === 0) return null;
    next.residents[resident] = rng.pick(homes);
    return next;
  }
  const used = new Map();
  for (const piece of next.pieces) used.set(piece.key, (used.get(piece.key) || 0) + 1);
  const spare = puzzle.tray.filter((entry) => (used.get(entry.key) || 0) < entry.count);
  const choice = rng.int(0, 2);
  // Taking a piece away moves later pieces down one id, so homes follow
  const dropPiece = (index) => {
    const goneId = PIECE_ID_BASE + index;
    next.pieces.splice(index, 1);
    for (const [resident, home] of Object.entries(next.residents)) {
      if (home === goneId) next.residents[resident] = null;
      else if (home !== null && home > goneId) next.residents[resident] = home - 1;
    }
  };
  if (choice === 0 && next.pieces.length > 0) {
    dropPiece(rng.int(0, next.pieces.length - 1));
    return next;
  }
  let key = null;
  if (choice === 1 && next.pieces.length > 0) {
    const index = rng.int(0, next.pieces.length - 1);
    key = next.pieces[index].key;
    dropPiece(index);
  } else if (spare.length > 0) {
    key = rng.pick(spare).key;
  }
  if (!key) return null;
  const variant = puzzle.tray.find((entry) => entry.key === key).variant;
  const world = worldFromModules(layoutModules(puzzle, next));
  const stream = streamFrom(puzzle.stream);
  const cells = plinthCells();
  for (let attempt = 0; attempt < PAR_PLACE_TRIES; attempt++) {
    const [x, y] = rng.pick(cells);
    const rot = rng.int(0, 3);
    const z = restLevel(world, variant.fp, rot, x, y);
    const instance = { ...variant, id: PIECE_ID_BASE + next.pieces.length, x, y, z, rot };
    if (!checkPlacement(world, instance, { stream, ignoreCap: true }).ok) continue;
    next.pieces.push({ key, cell: [x, y, z], rot });
    return next;
  }
  return null;
}

// Par: the answer improved by a short seeded hill-climb
export function findPar(puzzle, start, cache = new Map()) {
  const rng = makeRng(mixSeed(hashString(puzzle.seed), PAR_SALT));
  let best = { layout: start, points: scorePuzzleLayout(puzzle, start, { cache, par: 0 }).score.points };
  for (let step = 0; step < PAR_STEPS; step++) {
    const candidate = mutate(rng, puzzle, best.layout);
    if (!candidate) continue;
    const scored = scorePuzzleLayout(puzzle, candidate, { cache, par: 0 });
    if (scored.valid && scored.score.points > best.points) best = { layout: candidate, points: scored.score.points };
  }
  return best;
}

// One try at a puzzle from a seed: {puzzle} or {problems}
function tryPuzzle(seed) {
  const rng = makeRng(mixSeed(hashString(seed), PUZZLE_SALT));
  const count = rng.int(...PUZZLE_RESIDENTS);
  const answer = generate({ seed, scale: 'block', ...PUZZLE_ANSWER, cap: PUZZLE_MAX_PIECES });
  const problems = answerProblems(answer.modules, count);
  if (problems.length > 0) return { problems };
  if (answer.modules.some((instance) => instance.id >= PIECE_ID_BASE)) return { problems: ['ids'] };
  const split = splitSite(answer.modules);
  if (!split) return { problems: ['no-site'] };
  const siteIds = new Set(split.site.map((instance) => instance.id));
  const ids = Array.from({ length: count }, (unused, index) => `r${index + 1}`);
  // Answer homes: preset residents in locked homes, the rest anywhere with room
  const assignments = {};
  const siteRoom = roomyHomes(split.site, {});
  const presets = Math.min(rng.int(...PUZZLE_PRESET_RESIDENTS), siteRoom.length);
  for (const [index, id] of ids.entries()) {
    const homes = index < presets ? roomyHomes(answer.modules, assignments, siteIds) : roomyHomes(answer.modules, assignments);
    if (homes.length === 0) return { problems: ['too-few-homes'] };
    assignments[id] = rng.pick(homes);
  }
  // Tray: the rest of the answer and a few decoys
  const tray = [];
  for (const instance of split.rest) addToTray(tray, instance);
  for (let decoy = rng.int(...PUZZLE_DECOYS); decoy > 0; decoy--) addToTray(tray, decoyOf(rng, rng.pick(split.rest.length > 0 ? split.rest : split.site)));
  const pieceIds = new Map(split.rest.map((instance, index) => [instance.id, PIECE_ID_BASE + index]));
  const answerLayout = {
    pieces: split.rest.map((instance) => ({ key: variantKey(instance), cell: [instance.x, instance.y, instance.z], rot: instance.rot & 3 })),
    residents: Object.fromEntries(ids.map((id) => [id, siteIds.has(assignments[id]) ? assignments[id] : pieceIds.get(assignments[id])])),
  };
  const base = { format: PUZZLE_FORMAT_VERSION, generator: PUZZLE_GENERATOR_VERSION, seed, site: split.site, stream: answer.stream, tray, residents: [] };
  // Residents rolled until the answer meets a good share of their traits, not all
  const amenities = [...new Set(answer.modules.map((instance) => FAMILIES[instance.family].amenity).filter(Boolean))];
  const cache = new Map();
  let chosen = null;
  for (let attempt = 0; attempt < PUZZLE_TRAIT_TRIES && !chosen; attempt++) {
    const residents = ids.map((id, index) => rollResident(mixSeed(hashString(seed), attempt), id, { amenities, others: ids.filter((other) => other !== id), start: index < presets ? answerLayout.residents[id] : null }));
    const trial = { ...base, residents };
    const scored = scorePuzzleLayout(trial, answerLayout, { cache, par: 0 });
    if (!scored.valid) return { problems: ['answer-invalid', ...scored.problems] };
    const share = traitShare(scored.evaluations);
    if (share >= PUZZLE_TRAIT_SHARE[0] && share <= PUZZLE_TRAIT_SHARE[1] && residents.every((resident) => traitsOf(resident).length > 0)) chosen = residents;
  }
  if (!chosen) return { problems: ['trait-share'] };
  const puzzle = { ...base, residents: chosen };
  const par = findPar(puzzle, answerLayout, cache);
  const startLayout = { pieces: [], residents: Object.fromEntries(chosen.filter((resident) => resident.start !== null).map((resident) => [resident.id, resident.start])) };
  const startPoints = scorePuzzleLayout(puzzle, startLayout, { cache, par: 0 }).score.points;
  if (par.points < PAR_POINTS[0] || par.points > PAR_POINTS[1]) return { problems: ['par-range'] };
  if (startPoints > par.points * PAR_START_SHARE) return { problems: ['start-too-close'] };
  return { puzzle: { ...puzzle, par: { layout: par.layout, points: par.points }, start: { points: startPoints } } };
}

// Puzzle from a seed; the next seeds are tried until one passes every rule
export function generatePuzzle(seedText, { id = null } = {}) {
  const tried = [];
  for (let reroll = 0; reroll < PUZZLE_REROLLS; reroll++) {
    const seed = reroll === 0 ? String(seedText) : `${seedText}#${reroll}`;
    const result = tryPuzzle(seed);
    if (result.puzzle) return { ...result.puzzle, id: id || seed, rerolls: reroll };
    tried.push({ seed, problems: result.problems });
  }
  throw new Error(`no puzzle from ${seedText}: ${JSON.stringify(tried)}`);
}
