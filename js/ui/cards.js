import { FAMILIES } from '../core/catalog.js';
import { footprintSize } from '../core/grid.js';
import { COPY } from './copy.js';
import { confirmAt } from './confirm.js';

// Category to copy key, base for families outside every category
export const CATEGORY_COPY = { base: 'catBase', social: 'catSocial', nature: 'catNature', industrial: 'catIndustrial', walled: 'catWalled', utilities: 'catUtilities' };

export const categoryLabel = (family) => COPY[CATEGORY_COPY[family.category]] || family.category;

// Footprint as width by depth by stories, for example 2×1×1
export function footprintText(variant) {
  const [width, depth] = footprintSize(variant.fp, 0);
  return `${width}×${depth}×${variant.h}`;
}

// Count as shown on a card: infinite in the sandbox
export const countText = (count) => `×${count === Infinity ? '∞' : count}`;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function cardShell(entry) {
  const family = FAMILIES[entry.variant.family];
  const card = node('li', 'card');
  card.dataset.rarity = entry.rarity || 'common';
  const image = node('img');
  image.alt = '';
  if (entry.thumb) image.src = entry.thumb;
  card.append(image, node('strong', 'card-name', family.label), node('small', 'card-size', footprintText(entry.variant)));
  return { card, family };
}

function pressable(card, onPress) {
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('click', (event) => onPress(event));
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onPress(event);
  });
}

// Build drawer cards: entries carry count (Infinity in the sandbox)
export function renderBuildCards(list, entries, { onPick, onDrag, pressedKey = '' }) {
  list.replaceChildren();
  for (const entry of entries) {
    const { card, family } = cardShell(entry);
    const count = entry.count === undefined ? Infinity : entry.count;
    card.title = `${categoryLabel(family)}, ${family.group}`;
    card.append(node('span', 'card-count', countText(count)));
    if (count <= 0) {
      card.classList.add('is-out');
      card.setAttribute('aria-disabled', 'true');
    } else {
      pressable(card, () => onPick(entry));
      card.setAttribute('aria-pressed', String(pressedKey === entry.key));
      if (onDrag) {
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/plain', entry.key);
          event.dataTransfer.effectAllowed = 'copy';
          onDrag(entry);
        });
      }
    }
    list.append(card);
  }
}

// Collection cards: onSelect(entry, event); the X asks before onRemove(entry)
export function renderCollectionCards(list, entries, { onSelect, onRemove, selectedKeys = new Set(), shownKey = '' }) {
  list.replaceChildren();
  for (const entry of entries) {
    const { card, family } = cardShell(entry);
    pressable(card, (event) => onSelect(entry, event));
    card.setAttribute('aria-pressed', String(selectedKeys.has(entry.key)));
    if (shownKey === entry.key) card.classList.add('is-shown');
    const remove = node('button', 'card-remove', '×');
    remove.type = 'button';
    remove.title = COPY.collectionRemove;
    remove.setAttribute('aria-label', `${COPY.collectionRemove} ${family.label}`);
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (await confirmAt(remove, COPY.confirmDeleteModule)) onRemove(entry);
    });
    remove.addEventListener('keydown', (event) => event.stopPropagation());
    card.append(remove);
    list.append(card);
  }
}
