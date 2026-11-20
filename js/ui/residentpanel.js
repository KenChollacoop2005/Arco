import { renderResidentCards, renderResidentDetail } from './residentview.js';
import { portraitOf } from './portrait.js';
import { occupantsOf } from '../core/roster.js';
import { COPY } from './copy.js';

// Residents box on the left, Resident drawer on the right
// hooks: select(module id), face(module id)
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
  const status = query('#residentStatus');
  const records = () => residents.list();
  const recordOf = (id) => records().find((entry) => entry.id === id) || null;
  const nameOf = (id) => {
    const record = recordOf(id);
    return record ? record.name : id;
  };
  const portrait = (record) => portraitOf(record.looks, residents.figureOf(record));
  const housemates = (record) => (record.home === null ? [record] : occupantsOf(records(), record.home));
  let pressed = null;

  function renderBox() {
    // In the sandbox the box shows once someone exists
    box.hidden = records().length === 0;
    count.textContent = records().length > 0 ? String(records().length) : '';
    renderResidentCards(list, records(), { evaluationOf: residents.evaluation, portrait, nameOf, onPress: press, onDrag: null, pressedId: pressed, shownId: residents.selected() });
  }

  function renderDrawer() {
    const record = recordOf(residents.selected());
    drawer.hidden = !record;
    if (!record) return;
    const mates = housemates(record);
    const index = mates.findIndex((mate) => mate.id === record.id);
    nav.hidden = mates.length < 2;
    page.textContent = `${index + 1} ${COPY.residentOf} ${mates.length}`;
    renderResidentDetail(detail, record, residents.evaluation(record.id), { portrait, nameOf, home: residents.homeOf(record.id) });
    moveButton.disabled = record.home === null;
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

  function press(record) {
    open(record);
  }

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

  residents.onChange(render);
  render();
  return {
    render,
    nameOf,
    portrait,
    open,
    setPressed(id) {
      pressed = id;
      renderBox();
    },
  };
}
