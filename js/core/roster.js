import { RESIDENT_RECORD_VERSION, HAPPY_SEGMENTS, HAPPY_HATE_COST, HAPPY_DREAM_GAIN, CELL_MM, STORY_MM, PIN_RISE_MM, PIN_SPREAD_MM, FIGURE_STAND_OUT_MM } from '../config.js';
import { WANTS, HATES, DREAMS, rollResident } from './residents.js';
import { residentCapacity } from './catalog.js';
import { hashString, mixSeed } from './rng.js';
import { SIDES, instanceCells } from './grid.js';

export const RESIDENTS_KEY = 'arco.residents'; // storage key for saved residents
const FILE_KIND = 'arco-residents'; // marks a saved residents list
const SANDBOX_PREFIX = 's'; // id prefix of sandbox residents
const NEEDS = ['water', 'power']; // needs every resident has
const TRAIT_FIELDS = { story: 'number', cells: 'number', steps: 'number', homes: 'number', stories: 'number', type: 'string', resident: 'string' }; // trait parameters and their types

const isHomeId = (value) => value === null || Number.isInteger(value);

// Trait copy with only known parameters, or null
function cleanTrait(trait, table) {
  if (!trait || typeof trait !== 'object' || !Object.hasOwn(table, trait.id)) return null;
  const out = { id: trait.id };
  for (const [field, type] of Object.entries(TRAIT_FIELDS)) {
    if (trait[field] === undefined) continue;
    if (typeof trait[field] !== type || (type === 'number' && !Number.isFinite(trait[field]))) return null;
    out[field] = trait[field];
  }
  return out;
}

function cleanTraits(list, table) {
  if (!Array.isArray(list)) return null;
  const out = list.map((trait) => cleanTrait(trait, table));
  return out.every(Boolean) ? out : null;
}

// One record for layouts, the Collection and the server
export function residentRecord(resident, home = null) {
  return {
    v: RESIDENT_RECORD_VERSION,
    id: resident.id,
    name: resident.name,
    looks: resident.looks,
    needs: [...resident.needs],
    wants: resident.wants.map((trait) => ({ ...trait })),
    hates: resident.hates.map((trait) => ({ ...trait })),
    dream: resident.dream ? { ...resident.dream } : null,
    start: resident.start === undefined ? null : resident.start,
    home: home === undefined ? null : home,
  };
}

// Checked record from plain data, or null
export function parseResident(value) {
  if (!value || typeof value !== 'object' || value.v !== RESIDENT_RECORD_VERSION) return null;
  if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !Number.isInteger(value.looks)) return null;
  if (!Array.isArray(value.needs) || value.needs.some((need) => !NEEDS.includes(need))) return null;
  const wants = cleanTraits(value.wants, WANTS);
  const hates = cleanTraits(value.hates, HATES);
  const dream = value.dream === null ? null : cleanTrait(value.dream, DREAMS);
  if (!wants || !hates || dream === null && value.dream !== null) return null;
  if (!isHomeId(value.start) || !isHomeId(value.home)) return null;
  return { v: RESIDENT_RECORD_VERSION, id: value.id, name: value.name, looks: value.looks, needs: [...value.needs], wants, hates, dream, start: value.start, home: value.home };
}

export const serializeResidents = (records) => JSON.stringify({ kind: FILE_KIND, residents: records });

// Records from text; bad ones are dropped
export function parseResidents(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.kind !== FILE_KIND || !Array.isArray(data.residents)) return { ok: false, records: [] };
    return { ok: true, records: data.residents.map(parseResident).filter(Boolean) };
  } catch {
    return { ok: false, records: [] };
  }
}

// Resident id to home id
export const assignmentsOf = (records) => Object.fromEntries(records.map((record) => [record.id, record.home]));

export const occupantsOf = (records, home) => records.filter((record) => record.home === home);

// Free places in a home, the given resident not counted
export function roomIn(instance, records, except = null) {
  if (!instance) return 0;
  return residentCapacity(instance) - occupantsOf(records, instance.id).filter((record) => record.id !== except).length;
}

// Records with one resident moved, or null when the home has no room
export function assignResident(records, modules, id, home) {
  const instance = home === null ? null : modules.find((candidate) => candidate.id === home);
  if (home !== null && roomIn(instance, records, id) <= 0) return null;
  return records.map((record) => (record.id === id ? { ...record, home } : record));
}

// Homes keep residents only while the same home stands in the same place
export function keepHomes(records, modules, places) {
  return records.map((record) => {
    if (record.home === null) return record;
    const instance = modules.find((candidate) => candidate.id === record.home);
    const place = places[record.id];
    const same = instance && residentCapacity(instance) > 0 && place && instance.family === place.family && instance.x === place.x && instance.y === place.y && instance.z === place.z;
    return same ? record : { ...record, home: null };
  });
}

// A new sandbox resident beside the others, same rules as puzzles
export function rollSandboxResident(seedText, records, amenities) {
  const taken = new Set(records.map((record) => record.id));
  let count = records.length + 1;
  while (taken.has(SANDBOX_PREFIX + count)) count++;
  const id = SANDBOX_PREFIX + count;
  const seed = mixSeed(hashString(String(seedText)), hashString(id));
  return residentRecord(rollResident(seed, id, { amenities, others: records.map((record) => record.id), names: records.map((record) => record.name), start: null }), null);
}

// Happiness meter: share of wants met, less triggered hates, plus the dream
export function happiness(evaluation) {
  if (!evaluation || evaluation.home === null) return { segments: 0, happy: false, placed: false };
  const wants = evaluation.wants.length;
  const met = evaluation.wants.filter((trait) => trait.met).length;
  const triggered = evaluation.hates.filter((trait) => trait.triggered).length;
  const share = (wants > 0 ? met / wants : 1) - triggered * HAPPY_HATE_COST + (evaluation.dream && evaluation.dream.met ? HAPPY_DREAM_GAIN : 0);
  const segments = evaluation.happy ? HAPPY_SEGMENTS : Math.max(0, Math.min(HAPPY_SEGMENTS - 1, Math.round(share * HAPPY_SEGMENTS)));
  return { segments, happy: evaluation.happy, placed: true };
}

// Saved residents in storage; writes report stored false when storage throws
export function createResidentStore(storage) {
  let records = [];
  const write = () => {
    try {
      storage.setItem(RESIDENTS_KEY, serializeResidents(records));
      return true;
    } catch {
      return false;
    }
  };
  return {
    list: () => records,
    load() {
      try {
        const text = storage.getItem(RESIDENTS_KEY);
        records = text ? parseResidents(text).records : [];
      } catch {
        records = [];
      }
      return records;
    },
    // Saved by name and looks, so one person is kept once
    add(record) {
      const clean = parseResident({ ...record, home: null, start: null });
      if (!clean) return { added: false, stored: true };
      if (records.some((other) => other.looks === clean.looks && other.name === clean.name)) return { added: false, stored: true };
      records = [...records, clean];
      return { added: true, stored: write() };
    },
    remove(looks) {
      records = records.filter((record) => record.looks !== looks);
      return { stored: write() };
    },
  };
}

// Pin above a home (or beside it when covered) and where its figure stands, in mm
export function homeSpot(instance, analysis, slot = 0, slots = 1) {
  const cells = instanceCells(instance);
  const centre = [0, 1].map((axis) => (cells.reduce((sum, cell) => sum + cell[axis], 0) / cells.length + 0.5) * CELL_MM);
  const top = (instance.z + instance.h) * STORY_MM;
  const entry = analysis && analysis.modules[instance.id];
  const covered = !!entry && entry.above.length > 0;
  const faces = analysis ? analysis.faces.filter((face) => face.module === instance.id && face.dir < SIDES.length) : [];
  // Most open wall, lowest story first
  const best = faces.reduce((pick, face) => (!pick || face.reach > pick.reach || (face.reach === pick.reach && face.level < pick.level) ? face : pick), null);
  const spread = (slot - (slots - 1) / 2) * PIN_SPREAD_MM;
  if (!best) return { pin: [centre[0] + spread, centre[1], top + PIN_RISE_MM], stand: [centre[0], centre[1], top], facing: 0 };
  const [stepX, stepY] = SIDES[best.dir];
  const out = CELL_MM / 2 + FIGURE_STAND_OUT_MM;
  const stand = [(best.x + 0.5) * CELL_MM + stepX * out, (best.y + 0.5) * CELL_MM + stepY * out, best.level * STORY_MM];
  const along = [-stepY * spread, stepX * spread];
  const pin = covered ? [stand[0] + along[0], stand[1] + along[1], (best.level + 1) * STORY_MM + PIN_RISE_MM] : [centre[0] + along[0], centre[1] + along[1], top + PIN_RISE_MM];
  return { pin, stand, facing: Math.atan2(stepX, -stepY) };
}
