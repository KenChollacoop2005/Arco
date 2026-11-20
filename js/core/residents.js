import {
  RESIDENT_WANTS, RESIDENT_HATES, RESIDENT_DREAM_CHANCE, RESIDENT_ROLL_TRIES, HIGH_STORY, LOW_STORY, HEIGHTS_STORY, INDUSTRY_CELLS, DISPOSAL_CELLS,
  AMENITY_STEPS, LONG_WALK_STEPS, CROWDING_HOMES, TALL_STORIES, EXTRA_SUPPLY, OUTWARD_REACH_CELLS, NOISY_FAMILIES, BRIDGE_FAMILIES,
  DEMAND_PER_CELL, DEMAND_PER_MODULE, CELL_MM, STORY_MM,
} from '../config.js';
import { FAMILIES, residentCapacity } from './catalog.js';
import { instanceCells } from './grid.js';
import { EMITTER_FAMILIES } from './emitters.js';
import { powerRole } from './power.js';
import { makeRng, mixSeed, hashString } from './rng.js';
import { residentName } from './names.js';
import { residentPoints } from './scoring.js';
import { planServices } from './services.js';
import { analyze } from './analysis.js';
import { walkingNetwork } from './walking.js';
import { lightPlan } from './lights.js';

const LOOKS_SALT = 0x10c5; // keeps the looks seed apart from the trait rolls
const SIDE_DIRS = 4; // analysis face dirs below this are walls

// Families counted as industry
export const INDUSTRY_FAMILIES = Object.keys(FAMILIES).filter((id) => FAMILIES[id].categories.includes('industrial'));
export const isHome = (instance) => residentCapacity(instance) > 0;

// Module voxels as [x, y, level]
function voxels(instance) {
  const out = [];
  for (const [cellX, cellY] of instanceCells(instance)) for (let level = instance.z; level < instance.z + instance.h; level++) out.push([cellX, cellY, level]);
  return out;
}

// Fewest cells between two modules along any axis
function cellGap(first, second) {
  let best = Infinity;
  for (const [ax, ay, az] of voxels(first)) for (const [bx, by, bz] of voxels(second)) best = Math.min(best, Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz)));
  return best;
}

const within = (ctx, home, families, cells) => ctx.modules.some((other) => other.id !== home.id && families.includes(other.family) && cellGap(home, other) <= cells);
const walkOf = (ctx, home) => ctx.walking.modules[home.id] || { reached: false, stepFree: false, plinthSteps: Infinity, nearest: {} };
const amenitySteps = (ctx, home, type) => (walkOf(ctx, home).nearest[type] || { steps: Infinity }).steps;
const outward = (ctx, home) => ctx.analysis.faces.some((face) => face.module === home.id && face.dir < SIDE_DIRS && face.reach >= OUTWARD_REACH_CELLS);
const litHome = (ctx, home) => voxels(home).some(([x, y, level]) => ctx.litKeys.has(`${x},${y},${level}`));
const adjacentHomes = (ctx, home) => ctx.adjacent(home.id).map((id) => ctx.byId.get(id)).filter(isHome);
const sameOrNext = (ctx, home, otherHome) => otherHome !== null && otherHome !== undefined && (otherHome === home.id || ctx.adjacent(home.id).includes(otherHome));
const verdict = (met, yes, no) => ({ met: !!met, reason: met ? yes : no });

// Base water demand of a home, from the same tables the solver reads
function waterBase(home) {
  return (DEMAND_PER_CELL[home.family] || 0) * instanceCells(home).length + (DEMAND_PER_MODULE[home.family] || 0);
}

function floodlit(ctx, home) {
  return ctx.lights.sources.some((source) => source.kind === 'floodlight' && source.lit && voxels(home).some(([x, y, level]) => {
    const centre = [(x + 0.5) * CELL_MM, (y + 0.5) * CELL_MM, (level + 0.5) * STORY_MM];
    return Math.hypot(centre[0] - source.point[0], centre[1] - source.point[1], centre[2] - source.point[2]) <= source.radius * CELL_MM;
  }));
}

// Trait table: roll(rng, setup) gives parameters, test(ctx, home, resident, trait) gives met and a reason code
export const WANTS = {
  high: { roll: (rng) => ({ story: rng.int(...HIGH_STORY) }), test: (ctx, home, resident, trait) => verdict(home.z >= trait.story, 'high-enough', 'too-low') },
  low: { roll: (rng) => ({ story: rng.int(...LOW_STORY) }), test: (ctx, home, resident, trait) => verdict(home.z <= trait.story, 'low-enough', 'too-high') },
  outward: { test: (ctx, home) => verdict(outward(ctx, home), 'has-outward-wall', 'no-outward-wall') },
  calm: { roll: (rng) => ({ cells: rng.int(...INDUSTRY_CELLS) }), test: (ctx, home, resident, trait) => verdict(!within(ctx, home, INDUSTRY_FAMILIES, trait.cells), 'no-industry-near', 'industry-near') },
  amenity: { needs: 'amenities', roll: (rng, setup) => ({ type: rng.pick(setup.amenities), steps: rng.int(...AMENITY_STEPS) }), test: (ctx, home, resident, trait) => verdict(amenitySteps(ctx, home, trait.type) <= trait.steps, 'amenity-near', amenitySteps(ctx, home, trait.type) === Infinity ? 'amenity-unreachable' : 'amenity-far') },
  stepfree: { test: (ctx, home) => verdict(walkOf(ctx, home).stepFree, 'step-free', walkOf(ctx, home).reached ? 'stairs-only' : 'unreachable') },
  alone: { test: (ctx, home) => verdict(ctx.occupants(home.id).length === 1, 'alone', 'shares-home') },
  roommate: { test: (ctx, home) => verdict(ctx.occupants(home.id).length >= 2, 'has-roommate', 'lives-alone') },
  neighbour: { test: (ctx, home) => verdict(adjacentHomes(ctx, home).some((other) => ctx.occupants(other.id).length > 0), 'has-neighbour', 'no-neighbour') },
  community: { test: (ctx, home) => verdict(adjacentHomes(ctx, home).filter((other) => ctx.occupants(other.id).length > 0).length >= 2, 'in-community', 'too-few-neighbours') },
  nextto: { needs: 'others', roll: (rng, setup) => ({ resident: rng.pick(setup.others) }), test: (ctx, home, resident, trait) => verdict(sameOrNext(ctx, home, ctx.homeOf(trait.resident)), 'next-to-friend', 'friend-away') },
  water: { test: (ctx, home) => verdict(ctx.waterIn(home) >= waterBase(home) + EXTRA_SUPPLY, 'extra-water', 'no-extra-water') },
  power: { test: (ctx, home) => verdict(ctx.powerIn(home) >= ctx.powerBase(home) + EXTRA_SUPPLY, 'extra-power', 'no-extra-power') },
  lit: { test: (ctx, home) => verdict(litHome(ctx, home), 'lit-outside', 'dark-outside') },
  stay: { needs: 'start', test: (ctx, home, resident) => verdict(home.id === resident.start, 'stayed', 'moved') },
  move: { needs: 'start', test: (ctx, home, resident) => verdict(home.id !== resident.start, 'moved', 'stayed') },
};

// Hates: met means triggered
export const HATES = {
  industry: { roll: (rng) => ({ cells: rng.int(...INDUSTRY_CELLS) }), test: (ctx, home, resident, trait) => verdict(within(ctx, home, [...new Set([...INDUSTRY_FAMILIES, ...EMITTER_FAMILIES])], trait.cells), 'industry-or-smoke-near', 'clear-air') },
  noise: { test: (ctx, home) => verdict(ctx.adjacent(home.id).some((id) => NOISY_FAMILIES.includes(ctx.byId.get(id).family)), 'noisy-room-adjacent', 'quiet') },
  disposal: { roll: (rng) => ({ cells: rng.int(...DISPOSAL_CELLS) }), test: (ctx, home, resident, trait) => verdict(within(ctx, home, ['disposal'], trait.cells), 'disposal-near', 'no-disposal-near') },
  heights: { roll: (rng) => ({ story: rng.int(...HEIGHTS_STORY) }), test: (ctx, home, resident, trait) => verdict(home.z > trait.story, 'too-high', 'low-enough') },
  ground: { test: (ctx, home) => verdict(home.z === 0, 'ground-floor', 'off-the-ground') },
  stairs: { test: (ctx, home) => verdict(!walkOf(ctx, home).stepFree, 'stairs-only', 'step-free') },
  walk: { roll: (rng) => ({ steps: rng.int(...LONG_WALK_STEPS) }), test: (ctx, home, resident, trait) => verdict(walkOf(ctx, home).plinthSteps > trait.steps, 'long-walk', 'short-walk') },
  dark: { test: (ctx, home) => verdict(!litHome(ctx, home), 'dark-outside', 'lit-outside') },
  glare: { test: (ctx, home) => verdict(floodlit(ctx, home), 'floodlit', 'no-floodlight') },
  cables: { test: (ctx, home) => verdict(ctx.wired.has(home.id), 'cables-on-home', 'no-cables') },
  crowding: { roll: (rng) => ({ homes: rng.int(...CROWDING_HOMES) }), test: (ctx, home, resident, trait) => verdict(adjacentHomes(ctx, home).length > trait.homes, 'crowded', 'room-to-breathe') },
  view: { test: (ctx, home) => verdict(!outward(ctx, home), 'no-view', 'has-view') },
  amenity: { needs: 'amenities', roll: (rng, setup) => ({ type: rng.pick(setup.amenities), steps: rng.int(...AMENITY_STEPS) }), test: (ctx, home, resident, trait) => verdict(amenitySteps(ctx, home, trait.type) <= trait.steps, 'amenity-near', 'amenity-far') },
  feud: { needs: 'others', roll: (rng, setup) => ({ resident: rng.pick(setup.others) }), test: (ctx, home, resident, trait) => verdict(sameOrNext(ctx, home, ctx.homeOf(trait.resident)), 'rival-near', 'rival-away') },
};

// Dreams about the building, the mass that holds the home
export const DREAMS = {
  tall: { roll: (rng) => ({ stories: rng.int(...TALL_STORIES) }), test: (ctx, home, resident, trait) => verdict(ctx.mass(home.id).stories >= trait.stories, 'tall-enough', 'too-short') },
  bridge: { test: (ctx, home) => verdict(ctx.mass(home.id).bridged, 'bridged', 'no-bridge') },
  garden: { test: (ctx, home) => verdict(ctx.mass(home.id).members.some((other) => other.family === 'garden' && other.z > 0), 'roof-garden', 'no-roof-garden') },
  market: { test: (ctx, home) => verdict(ctx.mass(home.id).members.some((other) => other.family === 'market'), 'has-market', 'no-market') },
};

const TABLES = { want: WANTS, hate: HATES, dream: DREAMS };

// Pairs that may not both appear on one resident; same marks a shared parameter
export const CONFLICTS = [
  ['want:alone', 'want:roommate'],
  ['want:high', 'want:low'],
  ['want:high', 'hate:heights'],
  ['want:low', 'hate:ground'],
  ['want:stepfree', 'hate:stairs'],
  ['want:outward', 'hate:view'],
  ['want:lit', 'hate:dark'],
  ['want:calm', 'hate:industry'],
  ['want:community', 'hate:crowding'],
  ['want:stay', 'want:move'],
  ['want:amenity', 'hate:amenity', 'type'],
  ['want:nextto', 'hate:feud', 'resident'],
  ['want:amenity', 'want:amenity'],
  ['want:nextto', 'want:nextto'],
  ['hate:feud', 'hate:feud'],
  ['hate:amenity', 'hate:amenity'],
];

const tag = (trait) => `${trait.kind}:${trait.id}`;

// True when two traits may not sit on one resident
export function conflicting(first, second) {
  if (tag(first) === tag(second)) return true;
  return CONFLICTS.some(([one, two, same]) => {
    const pair = (tag(first) === one && tag(second) === two) || (tag(first) === two && tag(second) === one);
    return pair && (!same || first[same] === second[same]);
  });
}

// Trait ids open to a resident with this setup
function openIds(kind, setup) {
  return Object.entries(TABLES[kind]).filter(([, rule]) => !rule.needs || (rule.needs === 'start' ? setup.start !== null && setup.start !== undefined : (setup[rule.needs] || []).length > 0)).map(([id]) => id);
}

// One trait of a kind that fits the chosen ones, or null
function rollTrait(rng, kind, setup, chosen) {
  const ids = openIds(kind, setup);
  const weights = (setup.weights && setup.weights[kind]) || {};
  for (let attempt = 0; attempt < RESIDENT_ROLL_TRIES && ids.length > 0; attempt++) {
    const id = rng.weighted(ids.map((entry) => [entry, weights[entry] === undefined ? 1 : weights[entry]]));
    const rule = TABLES[kind][id];
    const trait = { kind, id, ...(rule.roll ? rule.roll(rng, setup) : {}) };
    if (!chosen.some((other) => conflicting(other, trait))) return trait;
  }
  return null;
}

// setup: {amenities, others (resident ids), start (home id or null), weights: {want: {id: weight}}}
export function rollResident(seed, id, setup = {}) {
  const rng = makeRng(mixSeed(seed >>> 0, hashString(String(id))));
  const chosen = [];
  const take = (kind, count) => {
    const out = [];
    for (let slot = 0; slot < count; slot++) {
      const trait = rollTrait(rng, kind, setup, chosen);
      if (!trait) break;
      chosen.push(trait);
      out.push(trait);
    }
    return out;
  };
  const wants = take('want', rng.int(...RESIDENT_WANTS));
  const hates = take('hate', rng.int(...RESIDENT_HATES));
  const dream = rng.chance(RESIDENT_DREAM_CHANCE) ? take('dream', 1)[0] || null : null;
  const strip = ({ kind, ...rest }) => rest;
  return {
    id,
    name: residentName(mixSeed(seed >>> 0, hashString('name:' + id))),
    looks: mixSeed(seed >>> 0, LOOKS_SALT + hashString(String(id))),
    needs: ['water', 'power'],
    wants: wants.map(strip),
    hates: hates.map(strip),
    dream: dream ? strip(dream) : null,
    start: setup.start === undefined ? null : setup.start,
  };
}

// Every trait of a resident, tagged by kind
export function traitsOf(resident) {
  return [...resident.wants.map((trait) => ({ kind: 'want', ...trait })), ...resident.hates.map((trait) => ({ kind: 'hate', ...trait })), ...(resident.dream ? [{ kind: 'dream', ...resident.dream }] : [])];
}

// Added demand per home for wants of extra water or power
export function residentExtras(residents, assignments) {
  const extra = { water: {}, power: {} };
  for (const resident of residents) {
    const home = assignments[resident.id];
    if (home === null || home === undefined) continue;
    for (const trait of resident.wants) if (trait.id === 'water' || trait.id === 'power') extra[trait.id][home] = EXTRA_SUPPLY;
  }
  return extra;
}

// Masses: modules joined by contact, bridges left out and noted
function massesOf(modules, analysis, byId) {
  const massOf = new Map();
  const masses = [];
  const near = (id) => {
    const entry = analysis.modules[id];
    return entry ? [...entry.side, ...entry.above, ...entry.below] : [];
  };
  for (const start of modules) {
    if (massOf.has(start.id) || BRIDGE_FAMILIES.includes(start.family)) continue;
    const members = [];
    const queue = [start.id];
    massOf.set(start.id, masses.length);
    while (queue.length > 0) {
      const id = queue.pop();
      members.push(byId.get(id));
      for (const other of near(id)) {
        if (massOf.has(other) || BRIDGE_FAMILIES.includes(byId.get(other).family)) continue;
        massOf.set(other, masses.length);
        queue.push(other);
      }
    }
    masses.push({ members, stories: Math.max(...members.map((member) => member.z + member.h)) - Math.min(...members.map((member) => member.z)), bridged: false });
  }
  for (const bridge of modules.filter((instance) => BRIDGE_FAMILIES.includes(instance.family))) {
    const joined = [...new Set(near(bridge.id).filter((id) => massOf.has(id)).map((id) => massOf.get(id)))];
    if (joined.length >= 2) for (const index of joined) masses[index].bridged = true;
  }
  return { massOf, masses };
}

// Shared lookups for one evaluation
function evaluationContext(modules, { services, analysis, walking, lights }, assignments) {
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  const byHome = new Map();
  for (const [resident, home] of Object.entries(assignments)) {
    if (home === null || home === undefined) continue;
    if (!byHome.has(home)) byHome.set(home, []);
    byHome.get(home).push(resident);
  }
  const { massOf, masses } = massesOf(modules, analysis, byId);
  const wired = new Set();
  for (const wire of (services && services.wires) || []) for (const end of [wire.from, wire.to]) if (end) wired.add(end.module);
  const waterReports = (services && services.water && services.water.consumers) || {};
  const powerReports = (services && services.power && services.power.consumers) || {};
  return {
    modules,
    byId,
    analysis,
    walking,
    lights,
    wired,
    litKeys: new Set(((lights && lights.cells) || []).map(([x, y, level]) => `${x},${y},${level}`)),
    adjacent: (id) => {
      const entry = analysis.modules[id];
      return entry ? [...new Set([...entry.side, ...entry.above, ...entry.below])] : [];
    },
    occupants: (home) => byHome.get(home) || [],
    homeOf: (resident) => (assignments[resident] === undefined ? null : assignments[resident]),
    mass: (id) => masses[massOf.get(id)] || { members: [byId.get(id)], stories: byId.get(id).h, bridged: false },
    waterIn: (home) => (waterReports[home.id] || { received: 0 }).received,
    powerIn: (home) => (powerReports[home.id] || { received: 0 }).received,
    powerBase: (home) => (powerRole(home) || { demand: 0 }).demand,
    waterReport: (home) => waterReports[home.id] || null,
    powerReport: (home) => powerReports[home.id] || null,
  };
}

// Need met when the home is fully served
function needOf(ctx, home, need) {
  if (!home) return { id: need, met: false, reason: 'no-home' };
  const report = need === 'water' ? ctx.waterReport(home) : ctx.powerReport(home);
  if (!report) return { id: need, met: false, reason: need === 'water' ? 'no-water' : 'no-power' };
  return { id: need, met: report.status === 'full', reason: report.status === 'full' ? 'full' : report.status === 'partial' ? 'partial' : 'none' };
}

// results: {services, analysis, walking, lights} for the structure; assignments: {residentId: homeId or null}
export function evaluateResidents(modules, results, residents, assignments) {
  const ctx = evaluationContext(modules, results, assignments);
  return residents.map((resident) => {
    const homeId = ctx.homeOf(resident.id);
    const home = homeId === null ? null : ctx.byId.get(homeId) || null;
    const judge = (kind, trait) => {
      if (!home) return { ...trait, met: false, reason: 'no-home' };
      return { ...trait, ...TABLES[kind][trait.id].test(ctx, home, resident, trait) };
    };
    const result = {
      id: resident.id,
      home: home ? home.id : null,
      needs: resident.needs.map((need) => needOf(ctx, home, need)),
      wants: resident.wants.map((trait) => judge('want', trait)),
      hates: resident.hates.map((trait) => {
        const judged = judge('hate', trait);
        return { ...judged, triggered: judged.met };
      }),
      dream: resident.dream ? judge('dream', resident.dream) : null,
    };
    result.happy = !!home && result.wants.every((trait) => trait.met) && result.hates.every((trait) => !trait.met) && (!result.dream || result.dream.met);
    result.points = residentPoints(result);
    return result;
  });
}

// The existing passes a resident evaluation reads, services with the residents' extra demand
export function structureResults(modules, seedText, extra = {}) {
  const services = planServices(modules, seedText, { extra });
  return { services, analysis: analyze(modules), walking: walkingNetwork(modules), lights: lightPlan(modules, services) };
}
