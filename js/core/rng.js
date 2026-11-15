export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mixSeed(seedA, seedB) {
  let mixed = (seedA ^ Math.imul(seedB + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x2c1b3c6d);
  mixed = Math.imul(mixed ^ (mixed >>> 12), 0x297a2d39);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low, high) => low + Math.floor(next() * (high - low + 1));
  const range = (low, high) => low + next() * (high - low);
  const chance = (probability) => next() < probability;
  const pick = (list) => list[Math.floor(next() * list.length)];
  const weighted = (entries) => {
    let total = 0;
    for (const entry of entries) total += entry[1];
    let roll = next() * total;
    for (const entry of entries) {
      roll -= entry[1];
      if (roll <= 0) return entry[0];
    }
    return entries[entries.length - 1][0];
  };
  const shuffle = (list) => {
    const copy = list.slice();
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  };
  return { next, int, range, chance, pick, weighted, shuffle };
}

export function randomSeedText() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let text = '';
  for (let index = 0; index < 6; index++) {
    text += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return text;
}
