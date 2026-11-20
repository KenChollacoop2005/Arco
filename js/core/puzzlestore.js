export const PUZZLE_STORE_KEY = 'arco.puzzles'; // storage key for puzzle results
const STORE_VERSION = 1; // results format
const WIN_PERCENT = 100; // a day is a win at par or better
const DAY_MS = 86400000; // one day in milliseconds

const dayBefore = (date) => new Date(Date.parse(date + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
const empty = () => ({ v: STORE_VERSION, daily: {}, infinite: { played: 0, best: null, last: null } });
const better = (score, best) => !best || score.percent > best.percent || (score.percent === best.percent && score.points > best.points);

// Days in a row with a result, ending today, or yesterday when today is not played yet
export function streakOf(dates, today) {
  const played = new Set(dates);
  let day = played.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (played.has(day)) {
    streak++;
    day = dayBefore(day);
  }
  return streak;
}

// Results file read back, or null when it is not one this code wrote
export function parseResults(text) {
  try {
    const data = JSON.parse(text);
    const ok = data && data.v === STORE_VERSION && data.daily && typeof data.daily === 'object' && data.infinite && Number.isFinite(data.infinite.played);
    return ok ? data : null;
  } catch {
    return null;
  }
}

// Daily results, streak, wins and the Infinite best in browser storage
export function createPuzzleStore(storage) {
  let data = empty();
  const write = () => {
    try {
      storage.setItem(PUZZLE_STORE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  };
  return {
    load() {
      try {
        data = parseResults(storage.getItem(PUZZLE_STORE_KEY)) || empty();
      } catch {
        data = empty();
      }
      return data;
    },
    // The first submission of a day stays; the best is kept beside it
    recordDaily(date, score, ranked, at = Date.now()) {
      const entry = { points: score.points, percent: score.percent };
      const day = data.daily[date];
      if (!day) data.daily[date] = { first: entry, best: entry, ranked, at, submits: 1 };
      else data.daily[date] = { ...day, best: better(entry, day.best) ? entry : day.best, submits: day.submits + 1 };
      return { first: !day, stored: write() };
    },
    // Infinite keeps only how many were played and the best share of par
    recordInfinite(seed, score) {
      // A puzzle counts once however often it is submitted
      if (data.infinite.last !== seed) data.infinite.played++;
      data.infinite.last = seed;
      const best = better(score, data.infinite.best);
      if (best) data.infinite.best = { points: score.points, percent: score.percent, seed };
      return { best, stored: write() };
    },
    daily: (date) => data.daily[date] || null,
    dailyStats(today) {
      const dates = Object.keys(data.daily);
      return { played: dates.length, streak: streakOf(dates, today), wins: dates.filter((date) => data.daily[date].best.percent >= WIN_PERCENT).length };
    },
    infiniteStats: () => ({ played: data.infinite.played, best: data.infinite.best }),
  };
}

export const PROGRESS_KEY = 'arco.puzzle.progress'; // storage key for layouts in progress
const PROGRESS_VERSION = 1; // progress format
const PROGRESS_KINDS = ['daily', 'infinite']; // one layout kept per kind

// One game and its layout in progress, as stored
export function progressRecord(game, layout) {
  return { v: PROGRESS_VERSION, kind: game.kind, puzzle: game.puzzle, ranked: !!game.ranked, date: game.date || null, seed: game.seed || null, test: !!game.test, layout };
}

// Stored progress read back, kind by kind; anything unreadable is dropped
export function parseProgress(text) {
  const out = { daily: null, infinite: null };
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  for (const kind of PROGRESS_KINDS) {
    const record = data[kind];
    const ok = record && record.v === PROGRESS_VERSION && record.kind === kind && record.puzzle && Array.isArray(record.puzzle.site) && Array.isArray(record.puzzle.tray)
      && Array.isArray(record.puzzle.residents) && record.puzzle.par && record.layout && Array.isArray(record.layout.pieces) && record.layout.residents && typeof record.layout.residents === 'object';
    if (ok) out[kind] = record;
  }
  return out;
}

// The record to restore for a kind: a ranked Daily only on its own day
export function progressFor(progress, kind, today) {
  const record = progress[kind];
  if (!record) return null;
  if (kind === 'daily' && !record.test && record.date !== today) return null;
  return record;
}

// Game, modules and resident homes from a record; modules use the layout's ids
export function restoreProgress(record, layoutModules) {
  const { puzzle, layout } = record;
  return {
    game: { kind: record.kind, puzzle, ranked: record.ranked, date: record.date, seed: record.seed, test: record.test },
    modules: layoutModules(puzzle, layout),
    homes: Object.fromEntries(puzzle.residents.map((resident) => [resident.id, layout.residents[resident.id] === undefined ? null : layout.residents[resident.id]])),
  };
}
