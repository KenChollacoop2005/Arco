import { COPY } from './copy.js';
import { HAPPY_SEGMENTS } from '../config.js';
import { happiness } from '../core/roster.js';
import { FAMILIES } from '../core/catalog.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Icon outlines on a 16 unit box
const ICON_PATHS = {
  want: { shape: 'M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z', mark: 'M4.8 8.2l2.2 2.2l4.2-4.6' },
  hate: { shape: 'M8 1.8l6.8 12.2H1.2z', mark: 'M8 6.2v3.6M8 11.6v0.2' },
  dream: { shape: 'M8 1.2l2 4.3l4.7 0.6l-3.4 3.3l0.8 4.7L8 11.9l-4.1 2.2l0.8-4.7L1.3 6.1L6 5.5z', mark: '' },
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Trait label with its parameters filled in
export function traitText(kind, trait, nameOf = (id) => id) {
  const template = COPY.traits[`${kind}:${trait.id}`] || trait.id;
  return template.replace(/\{(\w+)\}/g, (match, field) => {
    if (field === 'resident') return nameOf(trait.resident);
    if (field === 'type') return String(trait.type).replace(/_/g, ' ');
    return String(trait[field]);
  });
}

export const reasonText = (code) => COPY.reasons[code] || code;

// One icon: solid as a preview or when met, outline otherwise
export function traitIcon(kind, solid, label) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `trait-icon trait-${kind}${solid ? ' is-solid' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', ICON_PATHS[kind].shape);
  shape.setAttribute('class', 'icon-shape');
  svg.append(title, shape);
  if (ICON_PATHS[kind].mark) {
    const mark = document.createElementNS(SVG_NS, 'path');
    mark.setAttribute('d', ICON_PATHS[kind].mark);
    mark.setAttribute('class', 'icon-mark');
    svg.append(mark);
  }
  return svg;
}

// Wants, hates, then the dream, packed tight
function iconRow(record, evaluation, nameOf) {
  const row = node('span', 'trait-icons');
  const placed = !!evaluation && evaluation.home !== null;
  record.wants.forEach((trait, index) => {
    const met = placed && evaluation.wants[index] && evaluation.wants[index].met;
    row.append(traitIcon('want', !placed || met, traitText('want', trait, nameOf)));
  });
  record.hates.forEach((trait, index) => {
    const triggered = placed && evaluation.hates[index] && evaluation.hates[index].triggered;
    row.append(traitIcon('hate', !placed || triggered, traitText('hate', trait, nameOf)));
  });
  if (record.dream) row.append(traitIcon('dream', !placed || (evaluation.dream && evaluation.dream.met), traitText('dream', record.dream, nameOf)));
  return row;
}

// Segmented happiness meter
export function meter(evaluation) {
  const state = happiness(evaluation);
  const bar = node('span', `meter${state.placed ? '' : ' is-idle'}${state.happy ? ' is-happy' : ''}`);
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(HAPPY_SEGMENTS));
  bar.setAttribute('aria-valuenow', String(state.segments));
  for (let index = 0; index < HAPPY_SEGMENTS; index++) bar.append(node('span', index < state.segments ? 'is-on' : ''));
  return bar;
}

// Residents box cards, shaped like module cards: never consumed, a checklist of who is placed
export function renderResidentCards(list, records, { evaluationOf, portrait, nameOf, onPress, onDrag, pressedId = null, shownId = null, accentOf = null }) {
  list.replaceChildren();
  for (const record of records) {
    const evaluation = evaluationOf(record.id);
    const placed = record.home !== null && !!evaluation && evaluation.home !== null;
    const card = node('li', `card resident-card${record.home === null ? ' is-unplaced' : ' is-placed'}${placed && evaluation.happy ? ' is-happy' : ''}${shownId === record.id ? ' is-shown' : ''}`);
    if (accentOf) card.style.setProperty('--resident-accent', accentOf(record));
    card.tabIndex = 0;
    card.dataset.id = record.id;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', String(pressedId === record.id));
    const image = node('img', 'resident-portrait');
    image.alt = '';
    image.src = portrait(record);
    card.append(image, node('strong', 'card-name resident-name', record.name), iconRow(record, record.home === null ? null : evaluation, nameOf), meter(record.home === null ? null : evaluation));
    card.addEventListener('click', () => onPress(record));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onPress(record);
    });
    if (onDrag) {
      card.draggable = true;
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', record.id);
        event.dataTransfer.effectAllowed = 'move';
        onDrag(record);
      });
    }
    list.append(card);
  }
}

// Reason under a line, shown on hover as a tooltip or on tap
export function withReason(line, text) {
  if (!text) return line;
  line.title = text;
  line.classList.add('has-reason');
  line.append(node('p', 'need-reason line-reason', text));
  line.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    line.classList.toggle('is-open');
  });
  return line;
}

// Needs as chips on one line, each with its reason
function needChips(record, evaluation, placed) {
  const line = node('div', 'need-chips');
  const reasons = [];
  record.needs.forEach((need, index) => {
    const judged = placed ? evaluation.needs[index] : null;
    const label = need === 'water' ? COPY.needWater : COPY.needPower;
    const chip = node('span', `chip ${!placed ? '' : judged.met ? 'chip-full' : 'chip-dry'}`, `${label} ${!placed ? COPY.residentNotPlacedShort : judged.met ? COPY.needMet : COPY.needNotMet}`);
    if (judged) {
      chip.title = reasonText(judged.reason);
      reasons.push(`${label}: ${reasonText(judged.reason)}`);
    }
    line.append(chip);
  });
  return withReason(line, reasons.join(' '));
}

// One trait line: icon, short label, status chip; the reason on hover or tap
function traitLine(kind, trait, judged, nameOf, placed, index) {
  const solid = kind === 'hate' ? !placed || judged.triggered : !placed || judged.met;
  const line = node('li', 'trait-line');
  line.dataset.kind = kind;
  line.dataset.index = String(index);
  line.tabIndex = 0;
  const label = traitText(kind, trait, nameOf);
  line.append(traitIcon(kind, solid, label), node('span', 'trait-label', label));
  if (!placed) return line;
  const good = kind === 'hate' ? !judged.triggered : judged.met;
  line.append(node('span', `chip ${good ? 'chip-full' : kind === 'hate' ? 'chip-dry' : 'chip-partial'}`, kind === 'hate' ? (judged.triggered ? COPY.traitTriggered : COPY.traitClear) : judged.met ? COPY.traitMet : COPY.traitNotMet));
  return withReason(line, reasonText(judged.reason));
}

// Full detail of one resident, compact; evaluation may be null when unplaced or still scoring
// stored: a saved resident away from any structure, so no needs or home; top: elements beside the name
export function renderResidentDetail(body, record, evaluation, { portrait, nameOf, home = null, stored = false, top = [] }) {
  body.replaceChildren();
  const placed = record.home !== null && !!evaluation && evaluation.home !== null;
  const head = node('div', 'resident-head');
  const image = node('img', 'resident-portrait');
  image.alt = '';
  image.src = portrait(record);
  const title = node('div', 'resident-title');
  const nameRow = node('div', 'resident-name-row');
  nameRow.append(node('h3', 'resident-big-name', record.name), ...top);
  title.append(nameRow);
  const where = home ? `${FAMILIES[home.family].label}, ${COPY.residentLevel} ${home.z}` : COPY.residentNotPlaced;
  if (!stored) title.append(node('p', 'resident-where', placed ? `${where} · ${evaluation.points} ${COPY.residentPoints}` : where));
  if (!stored) title.append(meter(placed ? evaluation : null));
  head.append(image, title);
  body.append(head);
  if (!stored) body.append(needChips(record, evaluation, placed));
  const items = node('ul', 'trait-list');
  record.wants.forEach((trait, index) => items.append(traitLine('want', trait, placed ? evaluation.wants[index] : {}, nameOf, placed, index)));
  record.hates.forEach((trait, index) => items.append(traitLine('hate', trait, placed ? evaluation.hates[index] : {}, nameOf, placed, index)));
  if (record.dream) items.append(traitLine('dream', record.dream, placed ? evaluation.dream : {}, nameOf, placed, 0));
  body.append(items);
  if (placed && evaluation.happy) body.append(node('p', 'resident-happy', COPY.residentHappy));
}
