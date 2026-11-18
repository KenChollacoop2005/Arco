import { createBuild, nextRot } from '../core/build.js';
import { COPY } from './copy.js';
import { renderCards } from './collection.js';
import { FAMILIES } from '../core/catalog.js';

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead

// Hooks: show(modules, {only}), grow(modules), targetAt(event)
export function setupBuild(app, canvas, moduleView, collectionPanel, hooks) {
  const query = (selector) => document.querySelector(selector);
  const status = query('#buildStatus');
  const palette = query('#buildPalette');
  const build = createBuild();
  let picked = null;
  let turn = 0;
  let pointerEvent = null;
  let entries = [];
  let growing = false;

  const active = () => app.mode === 'build';

  function refreshButtons() {
    query('#buildUndo').disabled = !build.canUndo();
    query('#buildRedo').disabled = !build.canRedo();
    query('#buildClear').disabled = build.modules.length === 0;
    query('#buildGrow').disabled = growing;
  }

  function refreshPalette() {
    query('#buildEmpty').hidden = entries.length > 0;
    renderCards(palette, entries, { onPick: pick, pressedKey: picked ? picked.key : '' });
  }

  function ghostAt(event) {
    const target = event ? hooks.targetAt(event) : null;
    return target ? build.ghost(picked.variant, target.x, target.y, turn) : null;
  }

  function refreshGhost() {
    const ghost = active() && picked ? ghostAt(pointerEvent) : null;
    moduleView.setGhost(ghost ? ghost.instance : null, ghost ? !ghost.ok : false);
    if (picked && active()) status.textContent = ghost && !ghost.ok ? ghost.reason : COPY.buildPicked;
  }

  // Picking the pressed card again puts it down
  function pick(entry) {
    picked = entry && (!picked || picked.key !== entry.key) ? entry : null;
    turn = 0;
    status.textContent = picked ? COPY.buildPicked : '';
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

  async function grow() {
    if (growing) return;
    growing = true;
    refreshButtons();
    status.textContent = COPY.growWorking;
    try {
      const result = await hooks.grow(build.modules);
      if (result) status.textContent = result.added > 0 ? `${result.added} ${COPY.growAdded} ${result.seed}` : `${COPY.growNone} ${result.seed}`;
    } catch {
      status.textContent = COPY.loadFailed;
    } finally {
      growing = false;
      refreshButtons();
    }
  }

  query('#buildRotate').addEventListener('click', rotate);
  query('#buildDelete').addEventListener('click', remove);
  query('#buildUndo').addEventListener('click', () => step(build.undo()));
  query('#buildRedo').addEventListener('click', () => step(build.redo()));
  query('#buildClear').addEventListener('click', () => step(build.clear()));
  query('#buildGrow').addEventListener('click', grow);

  canvas.addEventListener('pointermove', (event) => {
    pointerEvent = event;
    if (active() && picked) refreshGhost();
  });
  // Leaving hides the ghost but keeps the last reason, which a tap would otherwise lose
  canvas.addEventListener('pointerleave', () => {
    pointerEvent = null;
    if (active() && picked) moduleView.setGhost(null, false);
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

  app.modeListeners.push(refreshGhost);
  collectionPanel.onChange((list) => {
    // Switched off families stay out of the palette
    entries = list.filter((entry) => !FAMILIES[entry.variant.family].disabled);
    if (picked && !entries.some((entry) => entry.key === picked.key)) picked = null;
    refreshPalette();
    refreshGhost();
  });
  refreshButtons();

  return {
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
    // True when the click placed or tried to place
    click(event) {
      if (!active() || !picked) return false;
      pointerEvent = event;
      const ghost = ghostAt(event);
      if (!ghost) return true;
      const result = ghost.ok ? build.place(ghost.instance) : ghost;
      if (result.ok) apply(new Set([result.id]));
      else status.textContent = result.reason;
      return true;
    },
  };
}
