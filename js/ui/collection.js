import { FAMILIES, defaultPlacement } from '../core/catalog.js';
import { FOOTPRINTS, footprintSize } from '../core/grid.js';
import { rasterThumb } from '../core/thumb.js';
import { COPY } from './copy.js';
import { showToast } from './toast.js';
import { download } from './exportpanel.js';

const THUMB_PX = 96; // thumbnail edge in pixels
const GLYPH_CELL_PX = 5; // footprint glyph cell size
const GLYPH_GAP_PX = 1; // footprint glyph cell spacing
const FILE_NAME = 'arco-collection.json'; // export file name
const SVG_NS = 'http://www.w3.org/2000/svg';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function footprintGlyph(footprintId) {
  const [sizeX, sizeY] = footprintSize(footprintId, 0);
  const pitch = GLYPH_CELL_PX + GLYPH_GAP_PX;
  const glyph = document.createElementNS(SVG_NS, 'svg');
  glyph.setAttribute('class', 'card-footprint');
  glyph.setAttribute('width', sizeX * pitch);
  glyph.setAttribute('height', sizeY * pitch);
  glyph.setAttribute('aria-hidden', 'true');
  for (const [cellX, cellY] of FOOTPRINTS[footprintId]) {
    const cell = document.createElementNS(SVG_NS, 'rect');
    cell.setAttribute('x', cellX * pitch);
    cell.setAttribute('y', (sizeY - 1 - cellY) * pitch);
    cell.setAttribute('width', GLYPH_CELL_PX);
    cell.setAttribute('height', GLYPH_CELL_PX);
    glyph.append(cell);
  }
  return glyph;
}

// Picture of a cached part as a PNG data URL
export function makeThumb(part) {
  try {
    const { position, color } = part.geometry.attributes;
    const pixels = rasterThumb(position.array, part.geometry.index.array, color.array, THUMB_PX);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_PX;
    canvas.height = THUMB_PX;
    canvas.getContext('2d').putImageData(new ImageData(pixels, THUMB_PX, THUMB_PX), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

// Options: onPick(entry), onRemove(entry), pressedKey
export function renderCards(list, entries, options = {}) {
  list.replaceChildren();
  for (const entry of entries) {
    const family = FAMILIES[entry.variant.family];
    const card = node('li', 'card');
    if (entry.thumb) {
      const image = node('img');
      image.src = entry.thumb;
      image.alt = '';
      card.append(image);
    }
    card.append(node('strong', '', family.label), node('small', '', `${family.group}, ${defaultPlacement(entry.variant)}`));
    const shape = node('small', 'card-shape', `${entry.variant.fp}, ${entry.variant.h} ${COPY.stories.toLowerCase()}`);
    shape.prepend(footprintGlyph(entry.variant.fp));
    card.append(shape);
    if (options.onPick) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', String(options.pressedKey === entry.key));
      card.addEventListener('click', () => options.onPick(entry));
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        options.onPick(entry);
      });
    }
    if (options.onRemove) {
      const remove = node('button', 'card-remove', 'x');
      remove.title = COPY.collectionRemove;
      remove.setAttribute('aria-label', `${COPY.collectionRemove} ${family.label}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onRemove(entry);
      });
      card.append(remove);
    }
    list.append(card);
  }
}

export function setupCollection(collection) {
  const query = (selector) => document.querySelector(selector);
  const list = query('#collectionList');
  const empty = query('#collectionEmpty');
  const fileInput = query('#collectionFile');
  const listeners = [];

  function render() {
    const entries = collection.list();
    empty.hidden = entries.length > 0;
    query('#collectionExport').disabled = entries.length === 0;
    renderCards(list, entries, {
      onRemove(entry) {
        const result = collection.remove(entry.key);
        if (!result.stored) showToast(COPY.collectionFull);
        render();
      },
    });
    for (const listener of listeners) listener(entries);
  }

  function save(instance, part) {
    const result = collection.add(instance, part ? makeThumb(part) : '');
    if (!result.ok) return;
    showToast(!result.added ? COPY.savedAlready : result.stored ? COPY.saved : COPY.collectionFull);
    render();
  }

  query('#collectionExport').addEventListener('click', () => {
    download({ name: FILE_NAME, bytes: collection.toJson() });
  });
  query('#collectionImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let result = { ok: false };
    try {
      result = collection.merge(await file.text());
    } catch {
      result = { ok: false };
    }
    if (!result.ok) showToast(COPY.collectionBadFile);
    else showToast(result.stored ? `${result.added} ${COPY.collectionImported}` : COPY.collectionFull);
    render();
  });

  collection.load();
  render();
  return {
    save,
    render,
    onChange(listener) {
      listeners.push(listener);
      listener(collection.list());
    },
  };
}
