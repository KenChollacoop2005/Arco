import { renderResidentCards, renderResidentDetail } from './residentview.js';
import { portraitOf, cardPortraitOf, accentCss } from './portrait.js';
import { occupantsOf, roomIn } from '../core/roster.js';
import { isHome } from '../core/residents.js';
import { traitFocus } from '../core/focus.js';
import { STATE_NORMAL, STATE_SELECTED, STATE_ROOM, STATE_FULL } from '../render/materials.js';
import { COPY } from './copy.js';

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead

// Residents box on the left, Resident drawer on the right
// hooks: select(module id), face(module id), idAt(event), setState(id, state), canvas, carry(record), drop(), save(record)
export function setupResidentPanel(app, residents, hooks) {
  const query = (selector) => document.querySelector(selector);
  const box = query('#residentsDrawer');
  const list = query('#residentCards');
  const count = query('#residentsCount');
  const drawer = query('#residentPanel');
  const detail = query('#residentDetail');
  const nav = query('#residentNav');
  const page = query('#residentPage');
  const moveButton = query('#residentMove');
  const backButton = query('#residentBack');
  const status = query('#residentStatus');
  const tools = query('#residentTools');
  const records = () => residents.list();
  const recordOf = (id) => records().find((entry) => entry.id === id) || null;
  const nameOf = (id) => {
    const record = recordOf(id);
    return record ? record.name : id;
  };
  const portrait = (record) => portraitOf(record.looks, residents.figureOf(record));
  const cardPortrait = (record) => cardPortraitOf(record.looks, residents.figureOf(record));
  const accentOf = (record) => accentCss(residents.figureOf(record).params.accent);
  const housemates = (record) => (record.home === null ? [record] : occupantsOf(records(), record.home));
  let pressed = null;
  let placing = null;
  const boxStatus = query('#residentsStatus');
  const peek = document.createElement('p');
  peek.className = 'score-peek';
  peek.hidden = true;
  document.body.append(peek);

  function renderBox() {
    // In the sandbox the box shows once someone exists
    box.hidden = records().length === 0;
    count.textContent = records().length > 0 ? String(records().length) : '';
    renderResidentCards(list, records(), { evaluationOf: residents.evaluation, portrait: cardPortrait, accentOf, nameOf, onPress: press, onDrag: drag, pressedId: pressed, shownId: residents.selected() });
  }

  function renderDrawer() {
    const record = recordOf(residents.selected());
    drawer.hidden = !record;
    if (!record) return;
    const mates = housemates(record);
    const index = mates.findIndex((mate) => mate.id === record.id);
    for (const button of nav.querySelectorAll('button')) button.disabled = mates.length < 2;
    page.textContent = `${index + 1} ${COPY.residentOf} ${mates.length}`;
    renderResidentDetail(detail, record, residents.evaluation(record.id), { portrait, nameOf, home: residents.homeOf(record.id), actions: tools });
    moveButton.disabled = record.home === null || !!placing;
    backButton.disabled = record.home === null || !!placing;
  }

  function render() {
    renderBox();
    renderDrawer();
  }

  // Same as clicking their home: select it, open the drawer, turn the camera
  function open(record) {
    status.textContent = '';
    residents.select(record.id);
    if (record.home === null) return;
    hooks.select(record.home);
    hooks.face(record.home);
  }

  const modulesNow = () => (app.structure ? app.structure.modules : []);
  const roomy = (instance, id) => isHome(instance) && roomIn(instance, records(), id) > 0;

  // Homes with room glow green, everything else greys out
  function glow(id) {
    for (const instance of modulesNow()) hooks.setState(instance.id, id === null ? (app.selection.includes(instance.id) ? STATE_SELECTED : STATE_NORMAL) : roomy(instance, id) ? STATE_ROOM : STATE_FULL);
  }

  // Starts placing (from a card) or moving (from the drawer) one resident
  function start(record, mode, quiet = false) {
    if (placing) stop();
    // A click carries the figure on the cursor; a drag shows the card instead
    placing = { id: record.id, mode, previews: null, raw: 0, structure: app.structure, carried: !quiet && !!hooks.carry };
    pressed = mode === 'place' ? record.id : null;
    boxStatus.textContent = mode === 'place' ? COPY.residentPlacing : '';
    status.textContent = mode === 'move' ? COPY.residentMoving : '';
    glow(record.id);
    if (placing.carried) hooks.carry(record);
    // A drag keeps its card in place; the list redraws after the drop
    if (quiet) for (const card of list.children) card.setAttribute('aria-pressed', String(card.dataset.id === record.id));
    else render();
    const homes = modulesNow().filter((instance) => roomy(instance, record.id)).map((instance) => instance.id);
    const current = placing;
    residents.preview(record.id, homes).then((report) => {
      if (placing !== current || !report) return;
      placing.previews = report.previews;
      placing.raw = report.raw;
    }, () => {});
  }

  function stop() {
    if (!placing) return;
    if (placing.carried && hooks.drop) hooks.drop();
    placing = null;
    pressed = null;
    peek.hidden = true;
    glow(null);
  }

  function cancel() {
    if (!placing) return;
    stop();
    boxStatus.textContent = '';
    status.textContent = '';
    render();
  }

  // A click on a module while placing; true when it was used
  function click(id) {
    if (!placing) return false;
    const instance = modulesNow().find((candidate) => candidate.id === id);
    if (!instance) {
      if (placing.mode === 'place') cancel();
      return true;
    }
    if (!roomy(instance, placing.id)) {
      (placing.mode === 'place' ? boxStatus : status).textContent = COPY.residentNoRoom;
      return true;
    }
    const record = recordOf(placing.id);
    stop();
    boxStatus.textContent = '';
    status.textContent = `${record.name} ${COPY.residentPlacedIn}`;
    residents.assign(record.id, id);
    residents.select(record.id);
    hooks.select(id);
    return true;
  }

  // Change in points if the resident moved in here
  function hover(event) {
    if (!placing) return;
    const id = hooks.idAt(event);
    const instance = modulesNow().find((candidate) => candidate.id === id);
    const value = placing.previews && instance && roomy(instance, placing.id) ? placing.previews[id] : undefined;
    peek.hidden = value === undefined;
    if (value === undefined) return;
    const change = value - placing.raw;
    peek.textContent = change > 0 ? `+${change}` : String(change);
    peek.className = `score-peek${change > 0 ? ' is-gain' : change < 0 ? ' is-loss' : ''}`;
    peek.style.left = `${event.clientX}px`;
    peek.style.top = `${event.clientY}px`;
  }

  function press(record) {
    if (placing && placing.mode === 'place' && placing.id === record.id) {
      cancel();
      return;
    }
    if (record.home === null) {
      residents.select(record.id);
      start(record, 'place');
      return;
    }
    cancel();
    open(record);
  }

  // Dragging an unplaced card starts placing without redrawing the list
  function drag(record) {
    if (record.home !== null) return;
    start(record, 'place', true);
  }

  // New resident from the Build drawer joins the box
  query('#newResident').addEventListener('click', () => {
    const record = residents.roll();
    box.open = true;
    boxStatus.textContent = `${record.name} ${COPY.newResidentAdded}`;
  });
  query('#residentSave').addEventListener('click', () => {
    const record = recordOf(residents.selected());
    if (record) status.textContent = hooks.save(record);
  });

  // Back to tray: unplaced again, in the Residents box
  backButton.addEventListener('click', () => {
    const record = recordOf(residents.selected());
    if (!record || record.home === null || placing) return;
    if (!residents.assign(record.id, null)) return;
    status.textContent = '';
    boxStatus.textContent = `${record.name} ${COPY.residentBackDone}`;
    residents.select(record.id);
  });
  moveButton.addEventListener('click', () => {
    const record = recordOf(residents.selected());
    if (record && record.home !== null) start(record, 'move');
  });
  hooks.canvas.addEventListener('pointermove', hover);
  hooks.canvas.addEventListener('pointerleave', () => {
    peek.hidden = true;
  });
  // Cards dragged onto a home place there
  hooks.canvas.addEventListener('dragover', (event) => {
    if (!placing) return;
    event.preventDefault();
    hover(event);
  });
  hooks.canvas.addEventListener('drop', (event) => {
    if (!placing) return;
    event.preventDefault();
    click(hooks.idAt(event));
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !placing || TYPING_TAGS.includes(event.target.tagName)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }, true);
  // Right-click puts a carried resident back where they came from
  window.addEventListener('contextmenu', (event) => {
    if (!placing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }, true);
  // A new structure or another mode ends placing
  app.structureListeners.push((result, phase) => {
    if (phase === 'start' && placing && placing.structure !== result) cancel();
  });
  app.modeListeners.push(cancel);

  function step(offset) {
    const record = recordOf(residents.selected());
    if (!record) return;
    const mates = housemates(record);
    const index = mates.findIndex((mate) => mate.id === record.id);
    residents.select(mates[(index + offset + mates.length) % mates.length].id);
  }
  query('#residentPrev').addEventListener('click', () => step(-1));
  query('#residentNext').addEventListener('click', () => step(1));

  // Clicking a home opens its first resident; anything else closes the drawer
  app.selectListeners.push((ids) => {
    const last = ids[ids.length - 1];
    const living = last === undefined ? [] : occupantsOf(records(), last);
    const current = recordOf(residents.selected());
    if (living.length > 0) {
      if (!current || current.home !== last) residents.select(living[0].id);
    } else if (!current || current.home !== null || last !== undefined) residents.select(null);
  });

  // Hovering or tapping a trait shows what it is about in the scene
  let focused = null;
  function focusOn(target) {
    const record = recordOf(residents.selected());
    const line = target && target.closest ? target.closest('.trait-line, [data-need]') : null;
    if (!record || !line || !hooks.focus || placing) return;
    if (line === focused) return;
    focused = line;
    const kind = line.dataset.need ? 'need' : line.dataset.kind;
    const trait = kind === 'need' ? { id: line.dataset.need } : kind === 'dream' ? record.dream : record[kind === 'want' ? 'wants' : 'hates'][Number(line.dataset.index)];
    const home = residents.homeOf(record.id);
    const homeOf = (id) => {
      const other = recordOf(id);
      return other ? other.home : null;
    };
    const focus = traitFocus(kind, trait, { modules: modulesNow(), home, homeOf, analysis: app.analysis || {}, start: record.start });
    hooks.focus(focus);
    for (const card of list.children) card.classList.toggle('is-focus', focus.residents.includes(card.dataset.id));
  }
  function unfocus() {
    if (!focused) return;
    focused = null;
    if (hooks.focus) hooks.focus(null);
    for (const card of list.children) card.classList.remove('is-focus');
  }
  detail.addEventListener('pointerover', (event) => focusOn(event.target));
  detail.addEventListener('focusin', (event) => focusOn(event.target));
  detail.addEventListener('click', (event) => focusOn(event.target));
  detail.addEventListener('pointerleave', unfocus);
  detail.addEventListener('focusout', unfocus);

  residents.onChange(() => {
    unfocus();
    render();
  });
  render();
  return {
    render,
    nameOf,
    portrait,
    open,
    click,
    cancel,
    placing: () => (placing ? placing.id : null),
    setPressed(id) {
      pressed = id;
      renderBox();
    },
  };
}
