import { renderResidentCards } from './residentview.js';
import { portraitOf } from './portrait.js';

// Residents box: one card per resident, never consumed
export function setupResidentPanel(app, residents, hooks = {}) {
  const query = (selector) => document.querySelector(selector);
  const box = query('#residentsDrawer');
  const list = query('#residentCards');
  const count = query('#residentsCount');
  const nameOf = (id) => {
    const record = residents.list().find((entry) => entry.id === id);
    return record ? record.name : id;
  };
  const portrait = (record) => portraitOf(record.looks, residents.figureOf(record));
  let pressed = null;

  function render() {
    const records = residents.list();
    // In the sandbox the box shows once someone exists
    box.hidden = records.length === 0;
    count.textContent = records.length > 0 ? String(records.length) : '';
    renderResidentCards(list, records, {
      evaluationOf: residents.evaluation,
      portrait,
      nameOf,
      onPress: (record) => (hooks.press ? hooks.press(record) : null),
      onDrag: hooks.drag || null,
      pressedId: pressed,
      shownId: residents.selected(),
    });
  }

  residents.onChange(render);
  render();
  return {
    render,
    nameOf,
    portrait,
    setPressed(id) {
      pressed = id;
      render();
    },
  };
}
