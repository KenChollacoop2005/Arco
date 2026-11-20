import {
  PUZZLE_FORMAT_VERSION, PUZZLE_GENERATOR_VERSION, PUZZLE_MAX_PIECES, PUZZLE_ANSWER, PUZZLE_RESIDENTS, PUZZLE_PRESET_RESIDENTS, PUZZLE_REMOVED,
  PUZZLE_SPLIT_TRIES, PUZZLE_TRAY_CARDS, PUZZLE_DECOYS, PUZZLE_TRAIT_SHARE, PUZZLE_TRAIT_TRIES, PUZZLE_REROLLS, PAR_STEPS, PAR_MAX_BUILDS, PAR_PIECE_SHARE, PAR_PLACE_TRIES,
  PAR_POINTS, PAR_START_SHARE, PIECE_ID_BASE, SOURCE_FAMILIES, PUMP_KINDS, BRIDGE_FAMILIES,
} from '../config.js';
import { FAMILIES, FAMILY_IDS, hasPump, normalizeVariant, residentCapacity, categoryOn, CATEGORIES } from './catalog.js';
import { variantKey, worldFromModules, toBody, plinthCells } from './grid.js';
import { checkPlacement, supportsUnder } from './placement.js';
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
const ADDED_SALT = 0xadd; // keeps added piece seeds apart

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

const variantOf = (instance) => {
  const { id, x, y, z, rot, ...variant } = instance;
  return variant;
};

// Anchors: cores, ground-floor modules, and whatever holds one up; never moved
const anchorCache = new WeakMap();
export function anchorIds(site) {
  if (anchorCache.has(site)) return anchorCache.get(site);
  const world = worldFromModules(site);
  const byId = new Map(site.map((instance) => [instance.id, instance]));
  const anchors = new Set(site.filter((instance) => instance.z === 0 || instance.family === 'core').map((instance) => instance.id));
  const queue = [...anchors];
  while (queue.length > 0) {
    for (const below of supportsUnder(world, byId.get(queue.pop()))) {
      if (!below || below === 'plinth' || anchors.has(below.id)) continue;
      anchors.add(below.id);
      queue.push(below.id);
    }
  }
  anchorCache.set(site, anchors);
  return anchors;
}

// Site pieces the layout returned to the tray, by key
function returnedKeys(puzzle, layout) {
  const counts = new Map();
  for (const instance of puzzle.site) if (layout.site && layout.site[instance.id] === null) counts.set(variantKey(instance), (counts.get(variantKey(instance)) || 0) + 1);
  return counts;
}

// Tray pieces left unused; placed pieces count first against returned site pieces of their key
export function unusedTrayPieces(puzzle, layout) {
  const returned = returnedKeys(puzzle, layout);
  const placed = new Map();
  for (const piece of layout.pieces) placed.set(piece.key, (placed.get(piece.key) || 0) + 1);
  let fromTray = 0;
  for (const [key, count] of placed) fromTray += Math.max(0, count - (returned.get(key) || 0));
  return trayTotal(puzzle) - fromTray;
}

// Modules of a layout: the site with its moves and returns, then placed pieces
export function layoutModules(puzzle, layout) {
  const variants = new Map(puzzle.tray.map((entry) => [entry.key, entry.variant]));
  for (const instance of puzzle.site) if (!variants.has(variantKey(instance))) variants.set(variantKey(instance), variantOf(instance));
  const moves = layout.site || {};
  const site = [];
  for (const instance of puzzle.site) {
    const move = moves[instance.id];
    if (move === null) continue;
    site.push(move ? { ...instance, x: move.cell[0], y: move.cell[1], z: move.cell[2], rot: move.rot & 3 } : instance);
  }
  const pieces = layout.pieces.map((piece, index) => ({ ...variants.get(piece.key), id: PIECE_ID_BASE + index, x: piece.cell[0], y: piece.cell[1], z: piece.cell[2], rot: piece.rot & 3 }));
  return [...site, ...pieces].sort(byOrder);
}

const cellOk = (entry) => Array.isArray(entry.cell) && entry.cell.length === 3 && entry.cell.every(Number.isInteger) && Number.isInteger(entry.rot);

// Validity of a submitted layout: anchors kept, tray counts, placement, stability, homes with room
export function validateLayout(puzzle, layout) {
  const problems = [];
  if (!layout || !Array.isArray(layout.pieces) || !layout.residents || typeof layout.residents !== 'object') return { ok: false, problems: ['bad-layout'] };
  if (layout.site !== undefined && (!layout.site || typeof layout.site !== 'object')) return { ok: false, problems: ['bad-layout'] };
  const siteById = new Map(puzzle.site.map((instance) => [instance.id, instance]));
  const anchors = anchorIds(puzzle.site);
  for (const [id, move] of Object.entries(layout.site || {})) {
    if (!siteById.has(Number(id)) || (move !== null && !cellOk(move))) return { ok: false, problems: ['unknown-piece'] };
    if (anchors.has(Number(id))) problems.push('anchor-moved');
  }
  // Pieces returned from the site join the tray
  const left = new Map(puzzle.tray.map((entry) => [entry.key, entry.count]));
  for (const [key, count] of returnedKeys(puzzle, layout)) left.set(key, (left.get(key) || 0) + count);
  for (const piece of layout.pieces) {
    if (!cellOk(piece) || !left.has(piece.key)) return { ok: false, problems: ['unknown-piece'] };
    left.set(piece.key, left.get(piece.key) - 1);
    if (left.get(piece.key) < 0) problems.push('over-count');
  }
  const modules = layoutModules(puzzle, layout);
  const world = worldFromModules(modules);
  const stream = streamFrom(puzzle.stream);
  // Pieces and moved site pieces first, so an overlap is theirs; then the rest of the site
  const moved = (instance) => instance.id >= PIECE_ID_BASE || !!(layout.site && layout.site[instance.id]);
  const ordered = [...modules.filter(moved), ...modules.filter((instance) => !moved(instance))];
  const broken = ordered.find((instance) => !checkPlacement(world, instance, { stream, ignoreCap: true }).ok);
  if (broken) problems.push(moved(broken) ? 'placement' : 'site-broken');
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

// Cache key of a structure with its residents' extra demand
export const layoutKey = (layout, extra) => JSON.stringify([layout.pieces, layout.site || null, extra]);
const keyOf = (puzzle, layout) => layoutKey(layout, residentExtras(puzzle.residents, assignmentsOf(puzzle, layout)));

// Scores a layout; cache maps a structure and extras key to its results
export function scorePuzzleLayout(puzzle, layout, { cache = null, par = puzzle.par ? puzzle.par.points : 0 } = {}) {
  const validity = validateLayout(puzzle, layout);
  if (!validity.ok) return { valid: false, problems: validity.problems, score: null, evaluations: [] };
  const modules = layoutModules(puzzle, layout);
  const assignments = assignmentsOf(puzzle, layout);
  const extra = residentExtras(puzzle.residents, assignments);
  const key = layoutKey(layout, extra);
  let results = cache && cache.get(key);
  if (!results) {
    results = structureResults(modules, puzzle.seed, extra);
    if (cache) cache.set(key, results);
  }
  const evaluations = evaluateResidents(modules, results, puzzle.residents, assignments);
  const score = scoreLayout(evaluations, { unused: unusedTrayPieces(puzzle, layout), par });
  return { valid: true, problems: [], score, evaluations };
}

// Modules nothing else rests on
function freeTops(modules) {
  const world = worldFromModules(modules);
  const carrying = new Set();
  for (const instance of modules) for (const below of supportsUnder(world, instance)) if (below && below !== 'plinth') carrying.add(below.id);
  return modules.filter((instance) => !carrying.has(instance.id));
}

// Site: the answer less a few pieces taken off the top, while the rest still stands
function splitSite(rng, modules) {
  for (let attempt = 0; attempt < PUZZLE_SPLIT_TRIES; attempt++) {
    let site = [...modules];
    const rest = [];
    for (let count = rng.int(...PUZZLE_REMOVED); count > 0 && site.length > 1; count--) {
      const taken = rng.pick(freeTops(site));
      site = site.filter((instance) => instance !== taken);
      rest.push(taken);
    }
    if (checkStability(site.map(toBody)).status === 'pass') return { site: site.sort(byOrder), rest: rest.sort(byOrder) };
  }
  return null;
}

// Amenity types and the family that brings each
const AMENITY_FAMILY = Object.fromEntries(FAMILY_IDS.filter((id) => FAMILIES[id].amenity && !FAMILIES[id].disabled).reverse().map((id) => [FAMILIES[id].amenity, id]));
export const AMENITY_TYPES = Object.keys(AMENITY_FAMILY).sort();
const LIGHT_FAMILIES = ['floodlight', 'lamppost']; // the last is added for the dark or a lit area
const OPEN_BRIDGES = BRIDGE_FAMILIES.filter((id) => FAMILIES[id] && !FAMILIES[id].disabled); // the last is added for a bridge dream

// Families a trait names, any one of which will do
function neededFamilies(residents) {
  const needs = [];
  for (const resident of residents) {
    for (const trait of traitsOf(resident)) {
      const tagText = `${trait.kind}:${trait.id}`;
      if (tagText === 'want:amenity') needs.push([AMENITY_FAMILY[trait.type]]);
      if (tagText === 'want:lit' || tagText === 'hate:dark') needs.push(LIGHT_FAMILIES);
      if (tagText === 'dream:market') needs.push(['market']);
      if (tagText === 'dream:garden') needs.push(['garden']);
      if (tagText === 'dream:bridge') needs.push(OPEN_BRIDGES);
    }
  }
  return needs;
}

export const WANT_HOMES = { neighbour: 2, nextto: 2, community: 3, roommate: 1 }; // homes a want needs in the puzzle
export const WANT_OTHERS = { neighbour: 1, nextto: 1, community: 2, roommate: 1 }; // other residents a want needs
export const WANT_SHARED = ['roommate']; // wants that need a home for two or more
const ADDED_HOME = 'housing'; // home added for count wants, room for two

// Homes and a shared home the count wants need, from the residents' wants
export function homeNeeds(residents) {
  const wants = residents.flatMap((resident) => resident.wants.map((trait) => trait.id));
  return { homes: Math.max(0, ...wants.map((id) => WANT_HOMES[id] || 0)), shared: wants.some((id) => WANT_SHARED.includes(id)) };
}

// Pieces to add so every trait finds what it names in the puzzle, homes included
export function missingPieces(rng, residents, modules) {
  const present = new Set(modules.map((instance) => instance.family));
  const added = [];
  const variantOfFamily = (family) => normalizeVariant({ family: family.id, fp: family.footprints[0], h: family.minStories, seed: rng.int(1, 0x7fffffff), mask: 15, roof: false });
  for (const need of neededFamilies(residents)) {
    if (need.some((id) => present.has(id))) continue;
    const family = FAMILIES[need[need.length - 1]];
    present.add(family.id);
    added.push(variantOfFamily(family));
  }
  // Count wants: enough homes, and one with room for two for a roommate
  const homes = [...modules, ...added].filter(isHome);
  const need = homeNeeds(residents);
  let count = homes.length;
  let shared = homes.some((instance) => residentCapacity(instance) >= 2);
  while (count < need.homes || (need.shared && !shared)) {
    added.push(variantOfFamily(FAMILIES[ADDED_HOME]));
    count += 1;
    shared = true;
  }
  return added;
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

// One step of the par search: a resident moves, a piece is added, moved or taken away, or a site piece goes back to the tray
function mutate(rng, puzzle, layout) {
  const next = { pieces: layout.pieces.map((piece) => ({ ...piece, cell: [...piece.cell] })), residents: { ...layout.residents } };
  if (layout.site) next.site = { ...layout.site };
  if (!rng.chance(PAR_PIECE_SHARE)) {
    const modules = layoutModules(puzzle, next);
    const resident = rng.pick(puzzle.residents).id;
    const homes = roomyHomes(modules, { ...next.residents, [resident]: null });
    if (homes.length === 0) return null;
    next.residents[resident] = rng.pick(homes);
    return next;
  }
  const choice = rng.int(0, 3);
  // A movable site piece returns; anything resting on it makes the step fail its checks
  if (choice === 3) {
    const anchors = anchorIds(puzzle.site);
    const movable = puzzle.site.filter((instance) => !anchors.has(instance.id) && !(next.site && next.site[instance.id] === null));
    if (movable.length === 0) return null;
    const gone = rng.pick(movable).id;
    next.site = { ...(next.site || {}), [gone]: null };
    for (const [resident, home] of Object.entries(next.residents)) if (home === gone) next.residents[resident] = null;
    return next;
  }
  const pool = new Map(puzzle.tray.map((entry) => [entry.key, entry.count]));
  for (const [key, count] of returnedKeys(puzzle, next)) pool.set(key, (pool.get(key) || 0) + count);
  const used = new Map();
  for (const piece of next.pieces) used.set(piece.key, (used.get(piece.key) || 0) + 1);
  const spare = [...pool].filter(([key, count]) => (used.get(key) || 0) < count).map(([key]) => ({ key }));
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
  const trayEntry = puzzle.tray.find((entry) => entry.key === key);
  const variant = trayEntry ? trayEntry.variant : variantOf(puzzle.site.find((instance) => variantKey(instance) === key));
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

// Par: the answer improved by a short seeded hill-climb; only so many new structures are scored
export function findPar(puzzle, start, cache = new Map()) {
  const rng = makeRng(mixSeed(hashString(puzzle.seed), PAR_SALT));
  let best = { layout: start, points: scorePuzzleLayout(puzzle, start, { cache, par: 0 }).score.points };
  let builds = 0;
  for (let step = 0; step < PAR_STEPS; step++) {
    const candidate = mutate(rng, puzzle, best.layout);
    if (!candidate) continue;
    if (!cache.has(keyOf(puzzle, candidate))) {
      if (builds >= PAR_MAX_BUILDS || !validateLayout(puzzle, candidate).ok) continue;
      builds += 1;
    }
    const scored = scorePuzzleLayout(puzzle, candidate, { cache, par: 0 });
    if (scored.valid && scored.score.points > best.points) best = { layout: candidate, points: scored.score.points };
  }
  return best;
}

// Every resident housed with full water and power
const needsMet = (evaluations) => evaluations.every((result) => result.home !== null && result.needs.every((need) => need.met));

// One try at a puzzle from a seed: {puzzle} or {problems}
function tryPuzzle(seed) {
  const rng = makeRng(mixSeed(hashString(seed), PUZZLE_SALT));
  const count = rng.int(...PUZZLE_RESIDENTS);
  const answer = generate({ seed, scale: 'block', ...PUZZLE_ANSWER, cap: PUZZLE_MAX_PIECES });
  const problems = answerProblems(answer.modules, PUZZLE_RESIDENTS[0]);
  if (problems.length > 0) return { problems };
  if (answer.modules.some((instance) => instance.id >= PIECE_ID_BASE)) return { problems: ['ids'] };
  const split = splitSite(rng, answer.modules);
  if (!split) return { problems: ['no-site'] };
  const siteIds = new Set(split.site.map((instance) => instance.id));
  const removed = [];
  for (const instance of split.rest) addToTray(removed, instance);
  const pieceIds = new Map(split.rest.map((instance, index) => [instance.id, PIECE_ID_BASE + index]));
  const layoutId = (id) => (siteIds.has(id) ? id : pieceIds.get(id));
  const pieces = split.rest.map((instance) => ({ key: variantKey(instance), cell: [instance.x, instance.y, instance.z], rot: instance.rot & 3 }));
  // The answer's own services, scored once and kept for every later score of it
  const cache = new Map();
  const plain = { pieces, residents: {} };
  const served = structureResults(layoutModules({ site: split.site, tray: removed }, plain), seed, {});
  cache.set(layoutKey(plain, residentExtras([], {})), served);
  const fullyServed = (id) => ['water', 'power'].every((need) => ((served.services[need] && served.services[need].consumers) || {})[layoutId(id)]?.status === 'full');
  const servedIds = new Set(answer.modules.filter((instance) => fullyServed(instance.id)).map((instance) => instance.id));
  // As many residents as the served homes hold, never under the minimum
  const servedRoom = answer.modules.filter((instance) => servedIds.has(instance.id)).reduce((sum, instance) => sum + residentCapacity(instance), 0);
  if (servedRoom < PUZZLE_RESIDENTS[0]) return { problems: ['too-few-homes'] };
  const ids = Array.from({ length: Math.min(count, servedRoom) }, (unused, index) => `r${index + 1}`);
  // Answer homes, all with full water and power: preset residents in site homes, the rest anywhere with room
  const assignments = {};
  const siteRoom = roomyHomes(split.site, {}, servedIds);
  const presets = Math.min(rng.int(...PUZZLE_PRESET_RESIDENTS), siteRoom.length);
  for (const [index, id] of ids.entries()) {
    const homes = roomyHomes(answer.modules, assignments, index < presets ? new Set([...siteIds].filter((siteId) => servedIds.has(siteId))) : servedIds);
    if (homes.length === 0) return { problems: ['too-few-homes'] };
    assignments[id] = rng.pick(homes);
  }
  const answerLayout = { pieces, residents: Object.fromEntries(ids.map((id) => [id, layoutId(assignments[id])])) };
  const base = { format: PUZZLE_FORMAT_VERSION, generator: PUZZLE_GENERATOR_VERSION, seed, site: split.site, stream: answer.stream };
  // Traits roll first from every amenity type; what they name joins the tray after
  let chosen = null;
  for (let attempt = 0; attempt < PUZZLE_TRAIT_TRIES && !chosen; attempt++) {
    const residents = [];
    for (const [index, id] of ids.entries()) residents.push(rollResident(mixSeed(hashString(seed), attempt), id, { amenities: AMENITY_TYPES, others: ids.filter((other) => other !== id), names: residents.map((resident) => resident.name), start: index < presets ? answerLayout.residents[id] : null }));
    if (!residents.every((resident) => traitsOf(resident).length > 0)) continue;
    const added = missingPieces(makeRng(mixSeed(hashString(seed), attempt + ADDED_SALT)), residents, answer.modules);
    if (removed.length + added.length > PUZZLE_TRAY_CARDS[1]) continue;
    const scored = scorePuzzleLayout({ ...base, tray: removed, residents }, answerLayout, { cache, par: 0 });
    if (!scored.valid) return { problems: ['answer-invalid', ...scored.problems] };
    const share = traitShare(scored.evaluations);
    if (share >= PUZZLE_TRAIT_SHARE[0] && share <= PUZZLE_TRAIT_SHARE[1]) chosen = { residents, added };
  }
  if (!chosen) return { problems: ['trait-share'] };
  // Tray: the removed pieces, what the traits name, then decoys inside the card limit
  const tray = removed.map((entry) => ({ ...entry }));
  for (const variant of chosen.added) addToTray(tray, variant);
  const room = PUZZLE_TRAY_CARDS[1] - tray.length;
  for (let decoy = Math.min(rng.int(...PUZZLE_DECOYS), room); decoy > 0; decoy--) addToTray(tray, decoyOf(rng, rng.pick(split.rest)));
  if (tray.length < PUZZLE_TRAY_CARDS[0]) return { problems: ['tray-small'] };
  const puzzle = { ...base, tray, residents: chosen.residents };
  const par = findPar(puzzle, answerLayout, cache);
  if (!needsMet(scorePuzzleLayout(puzzle, par.layout, { cache, par: 0 }).evaluations)) return { problems: ['par-needs'] };
  const startLayout = { pieces: [], residents: Object.fromEntries(chosen.residents.filter((resident) => resident.start !== null).map((resident) => [resident.id, resident.start])) };
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
