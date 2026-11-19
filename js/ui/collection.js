import { rasterThumb } from '../core/thumb.js';
import { renderCollectionCards } from './cards.js';
import { COPY } from './copy.js';
import { showToast } from './toast.js';
import { download } from './exportpanel.js';

const THUMB_PX = 96; // thumbnail edge in pixels
const FILE_NAME = 'arco-collection.json'; // export file name

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
    renderCollectionCards(list, entries, {
      onSelect() {},
      onRemove(entry) {
        const result = collection.remove(entry.key);
        if (!result.stored) showToast(COPY.collectionFull);
        render();
      },
    });
    for (const listener of listeners) listener(entries);
  }

  function save(instance, part) {
    const result = collection.add(instance, part ? makeThumb(part) : '', Date.now());
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
