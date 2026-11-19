import { FAMILIES, normalizeVariant } from './catalog.js';
import { variantKey } from './grid.js';

export const COLLECTION_KEY = 'arco.collection'; // storage key
const FILE_KIND = 'arco-collection'; // marks a collection file
const FILE_VERSION = 1; // file format version
const THUMB_PREFIX = 'data:image/png;base64,'; // only PNG data URLs are kept
const THUMB_MAX_CHARS = 60000; // longest thumbnail kept
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary']; // card edge tiers, no logic yet
export const DEFAULT_RARITY = 'common'; // rarity of every saved module for now

// Checked variant record, or null
export function variantOf(record) {
  if (!record || typeof record !== 'object') return null;
  const family = FAMILIES[record.family];
  const docked = !!record.dock && !!family && family.dockFootprints.includes(record.fp);
  if (!family || !(family.footprints.includes(record.fp) || docked)) return null;
  if (!Number.isInteger(record.h) || record.h < family.minStories || record.h > family.maxStories) return null;
  if (!Number.isFinite(record.seed) || !Number.isFinite(record.mask === undefined ? 0 : record.mask)) return null;
  return normalizeVariant({ family: record.family, fp: record.fp, h: record.h, seed: record.seed, mask: record.mask || 0, roof: !!record.roof, prof: record.prof, dock: record.dock, jb: record.jb, ends: record.ends });
}

function cleanThumb(thumb) {
  return typeof thumb === 'string' && thumb.startsWith(THUMB_PREFIX) && thumb.length <= THUMB_MAX_CHARS ? thumb : '';
}

// Entry: variant, thumbnail, rarity and the time it was saved (ms, or 0 when unknown)
export function makeEntry(record, thumb, saved = record && record.saved) {
  const variant = variantOf(record);
  if (!variant) return null;
  const rarity = RARITIES.includes(record.rarity) ? record.rarity : DEFAULT_RARITY;
  return { key: variantKey(variant), variant, thumb: cleanThumb(thumb), rarity, saved: Number.isFinite(saved) ? saved : 0 };
}

export function serializeCollection(entries) {
  return JSON.stringify({
    kind: FILE_KIND,
    version: FILE_VERSION,
    modules: entries.map((entry) => ({ ...entry.variant, thumb: entry.thumb, rarity: entry.rarity, saved: entry.saved })),
  });
}

// Bad records are skipped, a bad file is refused
export function parseCollection(text) {
  let file = null;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, entries: [] };
  }
  if (!file || file.kind !== FILE_KIND || !Array.isArray(file.modules)) return { ok: false, entries: [] };
  const entries = [];
  const seen = new Set();
  for (const record of file.modules) {
    const entry = makeEntry(record, record && record.thumb);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
  }
  return { ok: entries.length > 0 || file.modules.length === 0, entries };
}

// storage needs getItem and setItem, both may throw
export function createCollection(storage) {
  let entries = [];

  function persist() {
    try {
      storage.setItem(COLLECTION_KEY, serializeCollection(entries));
      return true;
    } catch {
      return false;
    }
  }

  function addAll(incoming) {
    const known = new Set(entries.map((entry) => entry.key));
    const fresh = incoming.filter((entry) => !known.has(entry.key));
    entries = [...entries, ...fresh];
    return fresh.length;
  }

  return {
    list: () => entries,
    load() {
      try {
        const parsed = parseCollection(storage.getItem(COLLECTION_KEY) || '');
        entries = parsed.ok ? parsed.entries : [];
      } catch {
        entries = [];
      }
      return entries;
    },
    add(record, thumb, saved = 0) {
      const entry = makeEntry({ ...record, rarity: DEFAULT_RARITY }, thumb, saved);
      if (!entry) return { ok: false, added: false, stored: true };
      const added = addAll([entry]) === 1;
      return { ok: true, added, stored: added ? persist() : true, key: entry.key };
    },
    remove(key) {
      entries = entries.filter((entry) => entry.key !== key);
      return { stored: persist() };
    },
    merge(text) {
      const parsed = parseCollection(text);
      if (!parsed.ok) return { ok: false, added: 0, stored: true };
      const added = addAll(parsed.entries);
      return { ok: true, added, stored: added > 0 ? persist() : true };
    },
    toJson: () => serializeCollection(entries),
  };
}
