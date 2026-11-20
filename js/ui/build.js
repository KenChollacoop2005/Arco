import { createBuild, nextRot, growBase } from '../core/build.js';
import { COPY } from './copy.js';
import { renderBuildCards, CATEGORY_COPY } from './cards.js';
import { confirmAt } from './confirm.js';
import { FAMILIES } from '../core/catalog.js';
import { variantKey } from '../core/grid.js';

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead
const ALL = 'all'; // category filter value for every category
const SANDBOX_COUNT = Infinity; // pieces of each saved module in the sandbox
const COPY_PREFIX = 'copy:'; // key of a duplicate, never a saved card

// Hooks: show(modules, {only}), grow(modules, zone), targetAt(event)
export function setupBuild(app, canvas, moduleView, collectionPanel, hooks) {
  const query = (selector) => document.querySelector(selector);
  const status = query('#buildStatus');
  const palette = query('#buildPalette');
  const search = query('#buildSearch');
  const category = query('#buildCategory');
  const build = createBuild();
  let picked = null;
  let turn = 0;
  let pointerEvent = null;
  let entries = [];
  let tray = null;
  let growing = false;
  const growListeners = [];
  const copyListeners = [];

  const active = () => app.mode === 'generate' || app.mode === 'puzzle';
  const cards = () => tray || entries;

  for (const value of [ALL, ...Object.keys(CATEGORY_COPY)]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === ALL ? COPY.catAll : COPY[CATEGORY_COPY[value]];
    category.append(option);
  }

  function refreshButtons() {
    for (const listener of growListeners) listener(growing);
  }

  // Saved modules that pass the search and the category filter
  function shown() {
    const text = search.value.trim().toLowerCase();
    return cards().filter((entry) => {
      const family = FAMILIES[entry.variant.family];
      if (category.value !== ALL && family.category !== category.value) return false;
      return !text || family.label.toLowerCase().includes(text) || family.id.includes(text) || family.group.toLowerCase().includes(text);
    });
  }

  function refreshPalette() {
    query('#buildEmpty').hidden = cards().length > 0;
    renderBuildCards(palette, shown(), { onPick: pick, onDrag: (entry) => pick(entry, true), pressedKey: picked ? picked.key : '' });
  }

  const isCopy = () => !!picked && picked.key.startsWith(COPY_PREFIX);
  const pickedText = () => (isCopy() ? COPY.duplicatePicked : COPY.buildPicked);

  function ghostAt(event) {
    const target = event ? hooks.targetAt(event) : null;
    return target ? build.ghost(picked.variant, target.x, target.y, turn) : null;
  }

  function refreshGhost() {
    const ghost = active() && picked ? ghostAt(pointerEvent) : null;
    moduleView.setGhost(ghost ? ghost.instance : null, ghost ? !ghost.ok : false);
    if (picked && active()) status.textContent = ghost && !ghost.ok ? ghost.reason : pickedText();
  }

  // Picking the pressed card again puts it down, unless keep is set
  function pick(entry, keep = false) {
    picked = entry && (keep || !picked || picked.key !== entry.key) ? entry : null;
    turn = 0;
    status.textContent = picked ? pickedText() : '';
    for (const listener of copyListeners) listener(isCopy());
    refreshPalette();
    refreshGhost();
    if (picked) moduleView.prepare([picked.variant]).then(refreshGhost, () => {});
  }

  function apply(only) {
    refreshButtons();
    hooks.show(build.modules, { only });
    refreshGhost();
  }

  function report(result) {
    if (!result.ok) status.textContent = result.reason;
    else apply();
    return result.ok;
  }

  function rotate() {
    if (picked) {
      turn = nextRot(turn);
      refreshGhost();
    } else if (app.selection.length === 0) {
      status.textContent = COPY.buildSelectFirst;
    } else {
      status.textContent = '';
      report(build.rotate(app.selection[app.selection.length - 1]));
    }
  }

  function remove() {
    if (app.selection.length === 0) {
      status.textContent = COPY.buildSelectFirst;
      return;
    }
    status.textContent = '';
    report(build.remove(app.selection));
  }

  function step(moved) {
    if (!moved) return;
    status.textContent = '';
    apply();
  }

  // Grow everything, or only inside a zone; replace clears roof clutter there first
  async function grow(line, zone = null, { replace = false } = {}) {
    if (growing) return;
    growing = true;
    refreshButtons();
    line.textContent = COPY.growWorking;
    try {
      const { base, removed } = growBase(build.modules, zone, replace);
      // One adopt of the result, so clearing and growing undo together
      const result = await hooks.grow(base, zone, removed);
      const cleared = removed.length > 0 ? `. ${removed.length} ${COPY.growCleared}` : '';
      if (result && result.skipped) line.textContent = COPY.growNothingHere;
      else if (result) line.textContent = (result.added > 0 ? `${result.added} ${COPY.growAdded} ${result.seed}` : `${zone ? COPY.growNoneHere : COPY.growNone} ${result.seed}`) + cleared;
    } catch {
      line.textContent = COPY.loadFailed;
    } finally {
      growing = false;
      refreshButtons();
    }
  }

  // Clear asks first; one undo step brings everything back
  const clearButton = query('#buildClear');
  clearButton.addEventListener('click', async () => {
    if (build.modules.length === 0 || !(await confirmAt(clearButton, COPY.confirmClear, COPY.clear))) return;
    if (build.clear()) step(true);
  });
  query('#buildRotate').addEventListener('click', rotate);
  query('#buildDelete').addEventListener('click', remove);
  search.addEventListener('input', refreshPalette);
  category.addEventListener('change', refreshPalette);

  canvas.addEventListener('pointermove', (event) => {
    pointerEvent = event;
    if (active() && picked) refreshGhost();
  });
  // Leaving hides the ghost but keeps the last reason, which a tap would otherwise lose
  canvas.addEventListener('pointerleave', () => {
    pointerEvent = null;
    if (active() && picked) moduleView.setGhost(null, false);
  });
  // A card dragged onto the plinth places where it is dropped
  canvas.addEventListener('dragover', (event) => {
    if (!active() || !picked) return;
    event.preventDefault();
    pointerEvent = event;
    refreshGhost();
  });
  canvas.addEventListener('dragleave', () => {
    pointerEvent = null;
    moduleView.setGhost(null, false);
  });
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    place(event);
  });

  window.addEventListener('keydown', (event) => {
    if (!active() || TYPING_TAGS.includes(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (command && key === 'z' && !event.shiftKey) step(build.undo());
    else if (command && (key === 'y' || key === 'z')) step(build.redo());
    else if (command) return;
    else if (key === 'r') rotate();
    else if (key === 'delete' || key === 'backspace') remove();
    else if (key === 'escape' && picked) pick(null);
    else return;
    event.preventDefault();
  });

  // Places the picked module at the pointer; true when it tried
  function place(event) {
    if (!active() || !picked) return false;
    pointerEvent = event;
    const ghost = ghostAt(event);
    if (!ghost) return true;
    if (picked.count <= 0) {
      pick(null);
      return true;
    }
    const result = ghost.ok ? build.place(ghost.instance) : ghost;
    if (result.ok) apply(new Set([result.id]));
    else status.textContent = result.reason;
    return true;
  }

  app.modeListeners.push(refreshGhost);
  collectionPanel.onChange((list) => {
    // Switched off families stay out of the palette
    entries = list.filter((entry) => !FAMILIES[entry.variant.family].disabled).map((entry) => ({ ...entry, count: SANDBOX_COUNT }));
    if (!tray && picked && !isCopy() && !entries.some((entry) => entry.key === picked.key)) picked = null;
    refreshPalette();
    refreshGhost();
  });

  // Puzzle tray in place of the saved modules, or null for the sandbox
  function setTray(next) {
    tray = next;
    if (picked && !isCopy()) {
      const same = cards().find((entry) => entry.key === picked.key);
      picked = same && same.count > 0 ? same : null;
      if (!picked) status.textContent = '';
    }
    refreshPalette();
    refreshGhost();
  }
  refreshButtons();

  return {
    grow,
    // Listener gets true while a grow runs
    onGrowing(listener) {
      growListeners.push(listener);
      listener(growing);
    },
    // Picks up a saved module by key, ready to place
    pickKey(key) {
      const entry = entries.find((candidate) => candidate.key === key);
      if (entry) pick(entry, true);
      return !!entry;
    },
    // Most modules Build may place, from the budget
    setCap(cap) {
      build.setCap(cap);
    },
    // A structure made elsewhere becomes the build
    adopt(modules, stream = null) {
      build.setStream(stream);
      build.replace(modules);
      refreshButtons();
    },
    // Picks up a copy of a placed module, not saved to the Collection
    duplicate(instance) {
      const { id, x, y, z, rot, ...variant } = instance;
      // In a puzzle a copy comes out of the tray, while any are left
      if (tray) {
        const entry = tray.find((candidate) => candidate.key === variantKey(variant));
        if (!entry || entry.count <= 0) {
          status.textContent = COPY.puzzleNoneLeft;
          return;
        }
        pick(entry, true);
        turn = rot & 3;
        refreshGhost();
        return;
      }
      pick({ key: COPY_PREFIX + variantKey(variant), variant, count: SANDBOX_COUNT }, true);
      turn = rot & 3;
      refreshGhost();
    },
    // True while a copy is held as the placement tool
    duplicating: () => isCopy(),
    // Listener gets true while a copy is held
    onDuplicate(listener) {
      copyListeners.push(listener);
    },
    // Ends a duplicate, kept for cards picked from the palette
    endDuplicate() {
      if (isCopy()) pick(null);
    },
    click: place,
    setTray,
    // Parks and brings back one whole build, history included
    snapshot: () => build.snapshot(),
    restore(state) {
      pick(null);
      build.restore(state);
      refreshButtons();
    },
    setRules: (rules) => build.setRules(rules),
    isLocked: (id) => build.isLocked(id),
  };
}
