import { renderResidentCards, renderResidentDetail } from './residentview.js';
import { portraitOf, cardPortraitOf } from './portrait.js';
import { confirmAt } from './confirm.js';
import { makeFigure } from '../core/figure.js';
import { figureMesh } from '../render/figure.js';
import { COPY } from './copy.js';

// Residents section of the Collection page: cards, the turning figure and their traits
export function setupResidentArchive(app, { store, showroom, archive }) {
  const query = (selector) => document.querySelector(selector);
  const page = query('#archive');
  const section = query('#archiveResidents');
  const list = query('#residentList');
  const detail = query('#archiveResident');
  let shown = null;
  const figures = new Map();
  const figureOf = (record) => {
    if (!figures.has(record.looks)) figures.set(record.looks, makeFigure(record.looks));
    return figures.get(record.looks);
  };
  const portrait = (record) => portraitOf(record.looks, figureOf(record));
  const cardPortrait = (record) => cardPortraitOf(record.looks, figureOf(record));
  const nameOf = (id) => {
    const record = store.list().find((entry) => entry.id === id);
    return record ? record.name : COPY.residentTitle;
  };

  function showFigure() {
    const record = store.list().find((entry) => entry.looks === shown);
    if (!record || app.mode !== 'collection') return;
    const figure = figureOf(record);
    showroom.showFigure(figureMesh(figure), figure.heightMm);
  }

  function render() {
    const records = store.list();
    section.hidden = records.length === 0;
    query('#archiveResidentCount').textContent = records.length > 0 ? String(records.length) : '';
    const record = records.find((entry) => entry.looks === shown) || null;
    page.dataset.shown = record ? 'resident' : 'module';
    detail.hidden = !record;
    if (record) renderResidentDetail(detail, record, null, { portrait, nameOf, stored: true });
    const selectedId = record ? record.id : null;
    renderResidentCards(list, records, { evaluationOf: () => null, portrait: cardPortrait, nameOf, onPress: choose, pressedId: selectedId, shownId: selectedId });
    // Each card gets a remove button, like module cards
    [...list.children].forEach((card, index) => {
      const entry = records[index];
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'card-remove';
      remove.textContent = '×';
      remove.title = COPY.residentRemove;
      remove.setAttribute('aria-label', `${COPY.residentRemove} ${entry.name}`);
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!(await confirmAt(remove, COPY.confirmDeleteResident))) return;
        store.remove(entry.looks);
        if (shown === entry.looks) leave();
        refresh();
      });
      remove.addEventListener('keydown', (event) => event.stopPropagation());
      card.append(remove);
    });
  }

  function refresh() {
    render();
    archive.render();
  }

  function choose(record) {
    shown = record.looks;
    render();
    showFigure();
  }

  // Back to modules: the module showroom and inspector return
  function leave() {
    if (shown === null) return;
    shown = null;
    render();
    archive.reshow();
  }

  app.modeListeners.push((mode) => {
    if (mode === 'collection') showFigure();
  });
  render();
  return { refresh, leave, count: () => store.list().length };
}
