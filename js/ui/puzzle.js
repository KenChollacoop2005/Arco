import { PIECE_ID_BASE, DAILY_TEST_MODE } from '../config.js';
import { COPY } from './copy.js';
import { makeThumb } from './collection.js';
import { confirmAt } from './confirm.js';
import { puzzleStart, trayLeft, dailyNumber, submitStatus, layoutOf } from '../core/puzzleplay.js';
import { PROGRESS_KEY, progressRecord, parseProgress, progressFor, restoreProgress } from '../core/puzzlestore.js';
import { assignmentsOf } from '../core/roster.js';
import { easternDate } from '../core/daily.js';
import { layoutModules, anchorIds } from '../core/puzzle.js';
import { streamFrom } from '../core/stream.js';
import { randomSeedText } from '../core/rng.js';

const KINDS = ['daily', 'infinite']; // puzzle worlds beside the sandbox
const KIND_SETTING = 'arco.puzzle.kind'; // remembered puzzle type
const SPARE_DELAY_MS = 4000; // wait after boot before making spare puzzles
const SANDBOX = 'sandbox'; // the Generate world
const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }; // intro card date

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Fresh build state for a puzzle: anchors locked, masks kept, pieces from 1000
const startBuild = (puzzle, modules) => ({
  modules,
  undoStack: [],
  redoStack: [],
  cap: Infinity,
  stream: streamFrom(puzzle.stream),
  rules: { locked: new Set(anchorIds(puzzle.site)), keepMasks: true, idBase: PIECE_ID_BASE },
});
const EMPTY_BUILD = { modules: [], undoStack: [], redoStack: [], cap: Infinity, stream: null, rules: { locked: new Set(), keepMasks: true, idBase: PIECE_ID_BASE } };

// Puzzle tab: Daily and Infinite worlds parked beside the sandbox
// hooks: builder, residents, moduleView, showBuild(list), loader({kind, seed}), readSetting, writeSetting, storage, onEmptySandbox()
export function setupPuzzle(app, hooks) {
  const query = (selector) => document.querySelector(selector);
  const intro = query('#puzzleIntro');
  const newButton = query('#puzzleNew');
  const submit = query('#puzzleSubmit');
  const check = query('#puzzleCheck');
  const parked = new Map();
  const games = new Map();
  const thumbs = new Map();
  const loading = new Map();
  const gameListeners = [];
  app.world = SANDBOX;
  app.puzzle = null;
  app.game = null;
  app.showingPar = false;

  const kindNow = () => query('input[name="puzzleKind"]:checked').value;
  // Layouts in progress, one per kind, kept across reloads
  let progress = { daily: null, infinite: null };
  try {
    progress = parseProgress(hooks.storage.getItem(PROGRESS_KEY));
  } catch {
    progress = { daily: null, infinite: null };
  }
  function saveProgress() {
    const game = app.game;
    if (!game || app.showingPar || app.world !== game.kind) return;
    const { layout } = layoutOf(hooks.builder.snapshot().modules, assignmentsOf(hooks.residents.list()), game.puzzle.site);
    progress = { ...progress, [game.kind]: progressRecord(game, layout) };
    try {
      hooks.storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Storage full or blocked: the layout lasts until the page closes
    }
  }
  const saved = hooks.readSetting(KIND_SETTING, 'daily');
  if (KINDS.includes(saved)) query(`input[name="puzzleKind"][value="${saved}"]`).checked = true;

  // Tray cards with counts left and thumbnails once built
  function refreshTray(modules) {
    if (!app.puzzle || app.showingPar) {
      hooks.builder.setTray(app.world === SANDBOX ? null : []);
      return;
    }
    hooks.builder.setTray(trayLeft(app.puzzle, modules).map((entry) => ({ ...entry, thumb: thumbs.get(entry.key) || '' })));
  }

  function renderIntro() {
    const kind = kindNow();
    const game = games.get(kind);
    intro.replaceChildren();
    newButton.hidden = !(kind === 'infinite' || (kind === 'daily' && DAILY_TEST_MODE)) || loading.has(kind);
    if (loading.has(kind)) {
      intro.append(node('p', 'puzzle-intro-note', kind === 'daily' ? COPY.puzzleLoadingDaily : COPY.puzzleLoadingInfinite));
      return;
    }
    if (!game) return;
    const count = `${game.puzzle.residents.length} ${COPY.puzzleResidents}`;
    if (kind === 'daily' && game.test) {
      intro.append(node('strong', 'puzzle-intro-title', COPY.puzzleTest), node('span', 'puzzle-intro-line', `${COPY.puzzleSeed} ${game.seed}`), node('span', 'puzzle-intro-line', count), node('p', 'puzzle-intro-note', COPY.puzzleTestNote));
    } else if (kind === 'daily') {
      const date = new Date(game.date + 'T00:00:00Z').toLocaleDateString('en-US', DATE_FORMAT);
      intro.append(node('strong', 'puzzle-intro-title', `${COPY.puzzleNumber} #${dailyNumber(game.date)}`), node('span', 'puzzle-intro-line', date), node('span', 'puzzle-intro-line', count));
      if (!game.ranked) intro.append(node('p', 'puzzle-intro-note', COPY.puzzleUnranked));
    } else {
      intro.append(node('strong', 'puzzle-intro-title', COPY.puzzleInfinite), node('span', 'puzzle-intro-line', `${COPY.puzzleSeed} ${game.seed}`), node('span', 'puzzle-intro-line', count), node('p', 'puzzle-intro-note', COPY.puzzleInfiniteNote));
    }
  }

  // Submit only for a valid layout of the puzzle on show
  function renderSubmit() {
    const report = hooks.residents.report();
    const current = !!app.puzzle && !!report && report.puzzle === app.puzzle;
    submit.disabled = !current || !report.valid || app.showingPar;
    if (!app.puzzle || app.showingPar) check.textContent = '';
    else if (!current) check.textContent = loading.has(app.world) ? '' : COPY.puzzleScoring;
    else {
      const state = submitStatus(report);
      check.textContent = state.ready ? COPY.puzzleReady : COPY.puzzleProblems[state.problem] || state.problem || '';
    }
  }

  function park() {
    parked.set(app.world, { build: hooks.builder.snapshot(), records: hooks.residents.list(), stream: app.stream || null });
  }

  // Shows one world: its build, history, residents and tray
  function apply(world) {
    const state = parked.get(world) || { build: EMPTY_BUILD, records: [], stream: null };
    app.world = world;
    app.game = games.get(world) || null;
    app.puzzle = app.game ? app.game.puzzle : null;
    hooks.builder.restore(state.build);
    app.stream = state.stream;
    refreshTray(state.build.modules);
    hooks.residents.setRecords(state.records, state.build.modules);
    hooks.showBuild(state.build.modules);
    renderIntro();
    renderSubmit();
    for (const listener of gameListeners) listener(app.game);
    // A sandbox emptied by a reload straight into Puzzle gets a fresh opening
    if (world === SANDBOX && state.build.modules.length === 0 && hooks.onEmptySandbox) hooks.onEmptySandbox();
  }

  // A par on show is dropped, never parked; the player's build is already parked
  function show(world) {
    if (app.showingPar) app.showingPar = false;
    else if (world === app.world) return;
    else park();
    apply(world);
  }

  // Par layout builds in on top of the site, every piece locked
  function showPar() {
    const game = app.game;
    if (!game || app.showingPar) return;
    park();
    app.showingPar = true;
    const puzzle = game.puzzle;
    const modules = layoutModules(puzzle, puzzle.par.layout);
    const records = puzzleStart(puzzle).records.map((record) => ({ ...record, home: puzzle.par.layout.residents[record.id] === undefined ? null : puzzle.par.layout.residents[record.id] }));
    hooks.builder.restore({ ...startBuild(puzzle, modules), rules: { locked: new Set(modules.map((instance) => instance.id)), keepMasks: true, idBase: PIECE_ID_BASE } });
    app.stream = puzzle.stream;
    refreshTray(modules);
    hooks.residents.setRecords(records, modules);
    hooks.showBuild(modules, { only: new Set(modules.filter((instance) => instance.id >= PIECE_ID_BASE).map((instance) => instance.id)) });
    renderSubmit();
  }

  // Tray thumbnails come from the built parts
  function prepareThumbs(puzzle) {
    hooks.moduleView.prepare(puzzle.tray.map((entry) => entry.variant)).then(() => {
      for (const entry of puzzle.tray) if (!thumbs.has(entry.key) && hooks.moduleView.partOf(entry.key)) thumbs.set(entry.key, makeThumb(hooks.moduleView.partOf(entry.key)));
      if (app.puzzle === puzzle && app.structure) refreshTray(app.structure.modules);
    }, () => {});
  }

  // A stored game and its layout, back as that world's build
  function install(record) {
    const { game, modules, homes } = restoreProgress(record, layoutModules);
    games.set(game.kind, game);
    const records = puzzleStart(game.puzzle).records.map((entry) => ({ ...entry, home: homes[entry.id] === undefined ? null : homes[entry.id] }));
    parked.set(game.kind, { build: startBuild(game.puzzle, modules), records, stream: game.puzzle.stream });
    if (app.world === game.kind) apply(game.kind);
    prepareThumbs(game.puzzle);
  }

  // Loads a puzzle in the worker; the start replaces that world's build
  // A spare puzzle made in the background, so the next one is ready at once
  const spares = new Map();
  const randomKind = (kind) => kind === 'infinite' || DAILY_TEST_MODE;
  function makeSpare(kind) {
    if (!randomKind(kind) || spares.has(kind)) return;
    spares.set(kind, hooks.loader({ kind, seed: randomSeedText() }).catch(() => null));
  }
  async function takeSpare(kind, seed) {
    const spare = spares.get(kind);
    spares.delete(kind);
    const result = spare ? await spare : null;
    return result || hooks.loader({ kind, seed });
  }

  async function load(kind, seed = null) {
    const token = (loading.get(kind) || 0) + 1;
    loading.set(kind, token);
    renderIntro();
    renderSubmit();
    try {
      const result = randomKind(kind) ? await takeSpare(kind, seed) : await hooks.loader({ kind, seed });
      if (loading.get(kind) !== token) return;
      const puzzle = result.puzzle;
      games.set(kind, { kind, puzzle, ranked: result.ranked, date: result.date || null, seed: result.seed || null, test: !!result.test });
      const start = puzzleStart(puzzle);
      parked.set(kind, { build: startBuild(puzzle, start.modules), records: start.records, stream: puzzle.stream });
      loading.delete(kind);
      if (app.world === kind) {
        apply(kind);
        saveProgress();
      }
      prepareThumbs(puzzle);
      makeSpare(kind);
    } catch {
      if (loading.get(kind) !== token) return;
      loading.delete(kind);
      if (kindNow() === kind) intro.replaceChildren(node('p', 'puzzle-intro-note', COPY.puzzleLoadFailed));
    } finally {
      renderIntro();
      renderSubmit();
    }
  }

  // Puzzle tab: the chosen kind, loaded on first visit
  let entered = false;
  function enter() {
    // The tray is the main tool here, so Build opens on the first visit
    if (!entered) query('#buildDrawer').open = true;
    entered = true;
    const kind = kindNow();
    show(kind);
    const stored = !games.has(kind) && !loading.has(kind) ? progressFor(progress, kind, easternDate()) : null;
    if (stored) {
      install(stored);
      makeSpare(kind);
    }
    else if (!games.has(kind) && !loading.has(kind)) load(kind, kind === 'infinite' || DAILY_TEST_MODE ? randomSeedText() : null);
  }

  app.modeListeners.push((mode) => {
    if (mode === 'puzzle') enter();
    else if (mode === 'generate' && app.world !== SANDBOX) show(SANDBOX);
  });
  for (const input of document.querySelectorAll('input[name="puzzleKind"]')) {
    input.addEventListener('change', () => {
      hooks.writeSetting(KIND_SETTING, input.value);
      if (app.mode === 'puzzle') enter();
      else renderIntro();
    });
  }
  newButton.addEventListener('click', async () => {
    const kind = kindNow();
    const game = games.get(kind);
    const started = game && app.structure && app.structure.modules.length > game.puzzle.site.length;
    if (started && !(await confirmAt(newButton, COPY.puzzleConfirmNew, COPY.puzzleNew))) return;
    load(kind, randomSeedText());
  });
  app.structureListeners.push((result, phase) => {
    if (phase === 'start') refreshTray(result.modules);
    if (phase === 'start') saveProgress();
  });
  hooks.residents.onChange(renderSubmit);
  hooks.residents.onChange(saveProgress);
  // Spares start once the opening structure has had the machine to itself
  setTimeout(() => {
    makeSpare('infinite');
    makeSpare('daily');
  }, SPARE_DELAY_MS);
  renderIntro();

  return {
    submit,
    renderSubmit,
    showPar,
    // Back to the player's own layout
    hidePar() {
      if (app.showingPar) show(app.world);
    },
    // Listener gets the game on show, or null in the sandbox
    onGame(listener) {
      gameListeners.push(listener);
    },
    // Puts the start of the game on show back in place
    restart() {
      const game = app.game;
      if (!game) return;
      const start = puzzleStart(game.puzzle);
      parked.set(game.kind, { build: startBuild(game.puzzle, start.modules), records: start.records, stream: game.puzzle.stream });
      apply(game.kind);
      saveProgress();
    },
  };
}
