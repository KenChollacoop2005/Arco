import { PUZZLE_FORMAT_VERSION, DAILY_TEST_MODE } from '../config.js';
import { generatePuzzle } from './puzzle.js';
import { randomSeedText } from './rng.js';

export const DAILY_ZONE = 'America/New_York'; // days roll over at midnight here
export const DAILY_PREFIX = 'arco-'; // puzzle id before the date
export const INFINITE_PREFIX = 'infinite-'; // seed before a random Infinite seed
export const TEST_PREFIX = 'arco-test-'; // seed before a test mode Daily seed
export const PUZZLE_DIR = 'puzzles/'; // daily files, one per date
const DAY_MS = 86400000; // one day in milliseconds

// Calendar date in New York as YYYY-MM-DD
export function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export const dailyId = (date) => DAILY_PREFIX + date;
export const dailyPath = (date) => `${PUZZLE_DIR}${date}.json`;

// Dates from a YYYY-MM-DD start, count days long
export function datesFrom(start, count) {
  const base = Date.parse(start + 'T00:00:00Z');
  return Array.from({ length: count }, (unused, index) => new Date(base + index * DAY_MS).toISOString().slice(0, 10));
}

// Puzzle from file text, or null when it is not one this code reads
export function parsePuzzle(text) {
  let puzzle = null;
  try {
    puzzle = JSON.parse(text);
  } catch {
    return null;
  }
  const ok = puzzle && puzzle.format === PUZZLE_FORMAT_VERSION && typeof puzzle.id === 'string' && typeof puzzle.seed === 'string'
    && Array.isArray(puzzle.site) && Array.isArray(puzzle.tray) && Array.isArray(puzzle.residents) && puzzle.par && puzzle.par.layout && Number.isFinite(puzzle.par.points);
  return ok ? puzzle : null;
}

// Daily for a date, same for everyone
export const makeDaily = (date) => generatePuzzle(dailyId(date), { id: dailyId(date) });

// Today's puzzle; readText(path) resolves to file text or throws. Missing files generate live, unranked
export async function loadDaily(readText, now = new Date()) {
  const date = easternDate(now);
  let puzzle = null;
  try {
    puzzle = parsePuzzle(await readText(dailyPath(date)));
  } catch {
    puzzle = null;
  }
  if (puzzle && puzzle.id === dailyId(date)) return { date, puzzle, ranked: true };
  return { date, puzzle: makeDaily(date), ranked: false };
}

// Test mode Daily: a fresh puzzle from a random seed, never ranked; committed files untouched
export function testDaily(seed = randomSeedText(), now = new Date()) {
  return { date: easternDate(now), seed, puzzle: generatePuzzle(TEST_PREFIX + seed, { id: TEST_PREFIX + seed }), ranked: false, test: true };
}

// The Daily as this build plays it: today's file, or a test puzzle in test mode
export const dailyFor = (readText, seed, now = new Date()) => (DAILY_TEST_MODE ? Promise.resolve(testDaily(seed || undefined, now)) : loadDaily(readText, now));

// Infinite mode: a live puzzle from a random or given seed, never ranked
export function infinitePuzzle(seed = randomSeedText()) {
  return { seed, puzzle: generatePuzzle(INFINITE_PREFIX + seed), ranked: false };
}
