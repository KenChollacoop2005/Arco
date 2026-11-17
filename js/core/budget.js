import { MAX_MODULES, BUDGET_HARD_CAP, BUDGET_CUSTOM_MIN, BUDGET_CUSTOM_DEFAULT, FANTASY_GROW } from '../config.js';
import { hashString, mixSeed, makeRng } from './rng.js';

export const BUDGET_MODES = ['fixed', 'custom', 'fantasy'];
const FANTASY_SEED = 0xfa47; // keeps Grow rolls apart from other rolls

// A budget as plain data: mode, and a cap for custom
export function makeBudget({ mode = 'fixed', cap } = {}) {
  if (mode === 'fantasy') return { mode, cap: null };
  if (mode !== 'custom') return { mode: 'fixed', cap: null };
  const typed = Math.round(Number(cap));
  const wanted = cap === '' || cap === null || cap === undefined || !Number.isFinite(typed) ? BUDGET_CUSTOM_DEFAULT : typed;
  return { mode, cap: Math.min(BUDGET_HARD_CAP, Math.max(BUDGET_CUSTOM_MIN, wanted)) };
}

// Most modules a structure may hold in this mode
export function budgetCap(budget) {
  if (budget.mode === 'custom') return budget.cap;
  if (budget.mode === 'fantasy') return BUDGET_HARD_CAP;
  return MAX_MODULES;
}

// Whether a module count is within budget, and by how much either way
export function withinBudget(budget, count) {
  const cap = budgetCap(budget);
  return { ok: count <= cap, cap, left: Math.max(0, cap - count), over: Math.max(0, count - cap) };
}

// Modules one fantasy Grow may add, from the seed text and the current count
export function growRoll(seedText, count) {
  return makeRng(mixSeed(hashString(String(seedText)), mixSeed(FANTASY_SEED, count))).int(FANTASY_GROW[0], FANTASY_GROW[1]);
}

// Generator limits for Generate; fixed adds none
export function generateLimits(budget) {
  return budget.mode === 'fixed' ? {} : { cap: budgetCap(budget) };
}

// Generator options for Grow on a structure of count modules; fantasy grows on its own seed per press, upward
export function growLimits(budget, seedText, count) {
  if (budget.mode !== 'fantasy') return generateLimits(budget);
  const roll = growRoll(seedText, count);
  return { seed: `${seedText} ${count}`, cap: Math.min(BUDGET_HARD_CAP, count + roll), budgetMin: Math.min(BUDGET_HARD_CAP, count + FANTASY_GROW[0]), rise: true };
}

// Most modules Build may place: today's cap in fixed, the hard cap otherwise
export const placeCap = (budget) => (budget.mode === 'fixed' ? MAX_MODULES : BUDGET_HARD_CAP);

// URL fields; fixed writes none, so a bare URL keeps today's behaviour
export function budgetParams(budget) {
  if (budget.mode === 'fixed') return {};
  return budget.mode === 'custom' ? { budget: 'custom', cap: String(budget.cap) } : { budget: 'fantasy' };
}

// Budget from URL fields, read with a getter like URLSearchParams.get
export const budgetFromParams = (get) => makeBudget({ mode: get('budget') || 'fixed', cap: get('cap') });
