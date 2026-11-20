import { createBuild, nextRot, growBase } from '../core/build.js';
import { COPY } from './copy.js';
import { renderBuildCards, CATEGORY_COPY } from './cards.js';
import { confirmAt } from './confirm.js';
import { FAMILIES } from '../core/catalog.js';
import { variantKey, cellInPlinth } from '../core/grid.js';
import { CELL_MM } from '../config.js';
import { STATE_HIDDEN, STATE_NORMAL, STATE_SELECTED } from '../render/materials.js';

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead
const ALL = 'all'; // category filter value for every category
const SANDBOX_COUNT = Infinity; // pieces of each saved module in the sandbox
const COPY_PREFIX = 'copy:'; // key of a duplicate, never a saved card
const MOVE_PREFIX = 'move:'; // key of a placed module being moved
const TRAY_SKIP = '.button-grid, .field-row, summary'; // controls in the drawer, not the tray

// Hooks: show(modules, {only}), grow(modules, zone), targetAt(event), rayAt(event), moved(id, instance)
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
  const moving = () => (picked && picked.moving !== undefined ? picked.moving : null);
  const pickedText = () => (isCopy() ? COPY.duplicatePicked : moving() !== null ? (tray ? COPY.buildMovingPuzzle : COPY.buildMoving) : COPY.buildPicked);
  // The lifted module shows again where it stood
  function unlift() {
    const id = moving();
    if (id === null) return;
    build.drop();
    moduleView.setState(id, app.selection.includes(id) ? STATE_SELECTED : STATE_NORMAL);
  }

  // Searches along the pointer ray, so raised spans over gaps can be reached
  function ghostAt(event) {
    if (!event) return null;
    if (hooks.rayAt) {
      const ray = hooks.rayAt(event);
      const found = build.ghostOnRay(picked.variant, ray, turn, ray.floor);
      if (found) return found;
    }
    const target = hooks.targetAt(event);
    return target ? build.ghost(picked.variant, target.x, target.y, turn) : null;
  }

  function refreshGhost() {
    const ghost = active() && picked ? ghostAt(pointerEvent) : null;
    moduleView.setGhost(ghost ? ghost.instance : null, ghost ? !ghost.ok : false);
    if (picked && active()) status.textContent = ghost && !ghost.ok ? ghost.reason : pickedText();
  }

  // Picking the pressed card again puts it down, unless keep is set
  function pick(entry, keep = false) {
    unlift();
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
  // Back to the last generated or grown structure, as one undo step
  let generated = null;
  const generatedButton = query('#buildGenerated');
  generatedButton.addEventListener('click', () => {
    if (!generated || tray) return;
    build.setStream(generated.stream);
    build.replace(generated.modules);
    step(true);
  });
  query('#buildRotate').addEventListener('click', rotate);
  query('#buildDelete').addEventListener('click', remove);
  query('#buildReturn').addEventListener('click', remove);
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
    // Undo while moving only puts the module back
    if (command && moving() !== null && (key === 'z' || key === 'y')) pick(null);
    else if (command && key === 'z' && !event.shiftKey) step(build.undo());
    else if (command && (key === 'y' || key === 'z')) step(build.redo());
    else if (command) return;
    else if (key === 'r') rotate();
    else if (key === 'delete' || key === 'backspace') remove();
    else if (key === 'escape' && picked) pick(null);
    else return;
    event.preventDefault();
  });

  // Right-click puts a picked module back in its tray
  window.addEventListener('contextmenu', (event) => {
    if (!active() || !picked) return;
    event.preventDefault();
    pick(null);
  });

  // A moved module goes to its new spot, keeping its id and residents
  function placeMoved(ghost) {
    const id = moving();
    const result = ghost.ok ? build.move(id, ghost.instance) : ghost;
    if (!result.ok) {
      status.textContent = result.reason;
      return;
    }
    const instance = build.modules.find((candidate) => candidate.id === id);
    picked = null;
    status.textContent = '';
    refreshPalette();
    if (hooks.moved) hooks.moved(id, instance);
    apply(new Set([id]));
  }

  // Pointer over no module and past the plinth edge
  function offScene(event) {
    if (hooks.idAt && hooks.idAt(event)) return false;
    const target = hooks.targetAt(event);
    return !target || !cellInPlinth(Math.floor(target.x / CELL_MM), Math.floor(target.y / CELL_MM));
  }

  // Places the picked module at the pointer; true when it tried
  function place(event) {
    if (!active() || !picked) return false;
    pointerEvent = event;
    const ghost = ghostAt(event);
    // Dropping a moved module on empty space puts it back
    if (moving() !== null && (!ghost || offScene(event))) {
      pick(null);
      return true;
    }
    if (!ghost) return true;
    if (moving() !== null) {
      placeMoved(ghost);
      return true;
    }
    if (picked.count <= 0) {
      pick(null);
      return true;
    }
    const result = ghost.ok ? build.place(ghost.instance) : ghost;
    if (result.ok) apply(new Set([result.id]));
    else status.textContent = result.reason;
    return true;
  }

  // Dropping a moved module on the tray returns it in a puzzle, else puts it back
  query('#buildDrawer').addEventListener('click', (event) => {
    const id = moving();
    if (id === null || event.target.closest(TRAY_SKIP)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tray) {
      pick(null);
      return;
    }
    unlift();
    picked = null;
    status.textContent = '';
    if (report(build.remove([id]))) refreshPalette();
  }, true);

  app.modeListeners.push(() => {
    if (!active() && moving() !== null) pick(null);
    refreshGhost();
  });
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
      generated = { modules: modules.map((instance) => ({ ...instance })), stream };
      generatedButton.disabled = false;
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
    // Right-click on a placed module picks it up to move; false when refused
    lift(id) {
      if (!active() || picked) return false;
      const result = build.lift(id);
      if (!result.ok) {
        status.textContent = build.isLocked(id) && tray ? COPY.anchorNote : result.reason;
        return false;
      }
      const { id: unused, x, y, z, rot, ...variant } = result.instance;
      picked = { key: MOVE_PREFIX + id, variant, count: 1, moving: id };
      turn = rot & 3;
      moduleView.setState(id, STATE_HIDDEN);
      status.textContent = pickedText();
      refreshPalette();
      refreshGhost();
      return true;
    },
    // True while a module or card is held
    holding: () => !!picked,
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
