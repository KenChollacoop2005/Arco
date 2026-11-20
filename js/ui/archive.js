import { FAMILIES } from '../core/catalog.js';
import { footprintSize } from '../core/grid.js';
import { COPY } from './copy.js';
import { renderCollectionCards, categoryLabel } from './cards.js';
import { confirmAt } from './confirm.js';
import { createInspector } from './inspector.js';
import { showToast } from './toast.js';

const SORT_KEY = 'arco.collectionSort'; // remembered sort order
const EXPORT_SPACING_CELLS = 8; // gap between exported parts, so no pegs join them

const area = (variant) => footprintSize(variant.fp, 0).reduce((product, side) => product * side, 1);
const byText = (first, second) => (first < second ? -1 : first > second ? 1 : 0);

// Sort orders: category, family, footprint, newest saved first
const SORTS = {
  category: (first, second) => byText(categoryLabel(FAMILIES[first.variant.family]), categoryLabel(FAMILIES[second.variant.family])) || byText(FAMILIES[first.variant.family].label, FAMILIES[second.variant.family].label),
  family: (first, second) => byText(FAMILIES[first.variant.family].label, FAMILIES[second.variant.family].label) || area(first.variant) - area(second.variant) || first.variant.h - second.variant.h,
  footprint: (first, second) => area(first.variant) - area(second.variant) || first.variant.h - second.variant.h || byText(FAMILIES[first.variant.family].label, FAMILIES[second.variant.family].label),
  saved: (first, second) => second.saved - first.saved,
};

// Saved variants as modules side by side, for an export
const asModules = (entries) => entries.map((entry, index) => ({ ...entry.variant, id: index + 1, x: index * EXPORT_SPACING_CELLS, y: 0, z: 0, rot: 0 }));

// Collection page: inventory grid, showroom and the shared inspector
export function setupArchive(app, { collectionPanel, moduleView, showroom, exporter, onPlace, readSetting, writeSetting, residentCount = () => 0, onModule = () => {} }) {
  const query = (selector) => document.querySelector(selector);
  const list = query('#collectionList');
  const search = query('#archiveSearch');
  const sort = query('#archiveSort');
  const status = query('#archiveStatus');
  const inspector = createInspector(query('#archiveInspector'), 'arco.archive');
  let entries = [];
  let shownKey = '';
  let selected = new Set();

  sort.value = SORTS[readSetting(SORT_KEY, 'category')] ? readSetting(SORT_KEY, 'category') : 'category';
  const shownEntry = () => entries.find((entry) => entry.key === shownKey) || null;

  function visible() {
    const text = search.value.trim().toLowerCase();
    return entries
      .filter((entry) => {
        const family = FAMILIES[entry.variant.family];
        return !text || family.label.toLowerCase().includes(text) || family.id.includes(text) || categoryLabel(family).toLowerCase().includes(text);
      })
      .sort((first, second) => SORTS[sort.value](first, second) || byText(first.key, second.key));
  }

  function refreshInspector() {
    const entry = shownEntry();
    const part = entry ? moduleView.partOf(entry.key) : null;
    inspector.render({ printOf: () => (part ? part.print : null), socketsOf: () => (part ? part.sockets : null), fit: app.fit }, entry ? entry.variant : null);
  }

  // Shows one saved module on the showroom plinth
  function show(entry) {
    shownKey = entry ? entry.key : '';
    for (const id of ['#archivePlace', '#archiveStl', '#archiveDelete']) query(id).disabled = !entry;
    refreshInspector();
    if (!entry) {
      showroom.show(null, null);
      return;
    }
    // Geometry waits until the page is open
    if (app.mode !== 'collection') return;
    const key = entry.key;
    moduleView.prepare([entry.variant]).then(() => {
      if (shownKey !== key) return;
      showroom.show(moduleView.partOf(key), entry.variant);
      refreshInspector();
    }, () => {});
  }

  function render() {
    const shown = visible();
    query('#archiveEmpty').hidden = entries.length > 0 || residentCount() > 0;
    query('.archive-showroom').hidden = entries.length === 0 && residentCount() === 0;
    query('#archiveCount').textContent = entries.length > 0 ? String(entries.length) : '';
    query('#archiveExport').disabled = selected.size === 0;
    query('#archiveExport').textContent = selected.size > 0 ? `${COPY.exportSelectedStl} (${selected.size})` : COPY.exportSelectedStl;
    renderCollectionCards(list, shown, { onSelect: choose, onRemove: (entry) => collectionPanel.remove(entry.key), selectedKeys: selected, shownKey });
  }

  // Click shows one; Ctrl or Shift click adds or drops it from the export pick
  function choose(entry, event) {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (selected.has(entry.key)) selected.delete(entry.key);
      else selected.add(entry.key);
    } else selected = new Set([entry.key]);
    onModule();
    show(entry);
    render();
  }

  async function exportEntries(chosen) {
    if (chosen.length === 0) return;
    status.textContent = COPY.exportWorking;
    status.textContent = await exporter.exportModules(null, asModules(chosen));
  }

  search.addEventListener('input', render);
  sort.addEventListener('change', () => {
    writeSetting(SORT_KEY, sort.value);
    render();
  });
  query('#archiveExport').addEventListener('click', () => exportEntries(entries.filter((entry) => selected.has(entry.key))));
  query('#archiveStl').addEventListener('click', () => exportEntries([shownEntry()].filter(Boolean)));
  query('#archivePlace').addEventListener('click', () => {
    const entry = shownEntry();
    if (entry && !onPlace(entry)) showToast(COPY.placeRefused);
  });
  query('#archiveDelete').addEventListener('click', async (event) => {
    const entry = shownEntry();
    if (entry && (await confirmAt(event.currentTarget, COPY.confirmDeleteModule))) collectionPanel.remove(entry.key);
  });

  collectionPanel.onChange((list) => {
    entries = list;
    const keys = new Set(entries.map((entry) => entry.key));
    selected = new Set([...selected].filter((key) => keys.has(key)));
    if (!keys.has(shownKey)) {
      const first = visible()[0] || null;
      if (first) selected = new Set([...selected, first.key]);
      show(first);
    }
    render();
  });
  app.modeListeners.push((mode) => {
    showroom.setActive(mode === 'collection');
    if (mode === 'collection' && query('#archive').dataset.shown !== 'resident') show(shownEntry());
  });
  return {
    render,
    // Back to the shown module, after a resident was shown
    reshow: () => show(shownEntry()),
  };
}
