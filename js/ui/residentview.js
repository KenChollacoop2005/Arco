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

// Residents box cards: never consumed, a checklist of who is placed
export function renderResidentCards(list, records, { evaluationOf, portrait, nameOf, onPress, onDrag, pressedId = null, shownId = null }) {
  list.replaceChildren();
  for (const record of records) {
    const evaluation = evaluationOf(record.id);
    const card = node('li', `resident-card${record.home === null ? ' is-unplaced' : ''}${shownId === record.id ? ' is-shown' : ''}`);
    card.tabIndex = 0;
    card.dataset.id = record.id;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', String(pressedId === record.id));
    const image = node('img', 'resident-portrait');
    image.alt = '';
    image.src = portrait(record);
    const text = node('span', 'resident-text');
    text.append(node('strong', 'resident-name', record.name), iconRow(record, record.home === null ? null : evaluation, nameOf), meter(record.home === null ? null : evaluation));
    card.append(image, text);
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

function statusChip(met, yes, no, waiting) {
  return node('span', `chip ${waiting ? '' : met ? 'chip-full' : 'chip-dry'}`, waiting ? COPY.residentNotPlaced : met ? yes : no);
}

// One trait line: icon, label, met or not, and the plain reason
function traitLine(kind, trait, judged, nameOf, placed) {
  const solid = kind === 'hate' ? !placed || judged.triggered : !placed || judged.met;
  const line = node('li', 'trait-line');
  const label = traitText(kind, trait, nameOf);
  line.append(traitIcon(kind, solid, label), node('span', 'trait-label', label));
  if (placed) {
    const good = kind === 'hate' ? !judged.triggered : judged.met;
    line.append(node('span', `chip ${good ? 'chip-full' : kind === 'hate' ? 'chip-dry' : 'chip-partial'}`, kind === 'hate' ? (judged.triggered ? COPY.traitTriggered : COPY.traitClear) : judged.met ? COPY.traitMet : COPY.traitNotMet));
    line.append(node('p', 'need-reason', reasonText(judged.reason)));
  }
  return line;
}

function section(title, children) {
  const block = node('div', 'resident-section');
  block.append(node('h4', 'resident-heading', title), ...children);
  return block;
}

// Full detail of one resident; evaluation may be null when unplaced or still scoring
export function renderResidentDetail(body, record, evaluation, { portrait, nameOf, home = null }) {
  body.replaceChildren();
  const placed = record.home !== null && !!evaluation && evaluation.home !== null;
  const head = node('div', 'resident-head');
  const image = node('img', 'resident-portrait');
  image.alt = '';
  image.src = portrait(record);
  const title = node('div', 'resident-title');
  title.append(node('h3', 'resident-big-name', record.name));
  const where = home ? `${FAMILIES[home.family].label}, ${COPY.residentLevel} ${home.z}` : COPY.residentNotPlaced;
  title.append(node('p', 'resident-where', where));
  if (placed) title.append(node('p', 'resident-points', `${evaluation.points} ${COPY.residentPoints}`));
  title.append(meter(placed ? evaluation : null));
  head.append(image, title);
  body.append(head);
  const needs = record.needs.map((need, index) => {
    const judged = placed ? evaluation.needs[index] : null;
    const line = node('div', 'need');
    const value = node('span', 'need-value');
    value.append(statusChip(judged && judged.met, COPY.needMet, COPY.needNotMet, !placed));
    line.append(node('span', 'need-label', need === 'water' ? COPY.needWater : COPY.needPower), value);
    if (judged) line.append(node('p', 'need-reason', reasonText(judged.reason)));
    return line;
  });
  body.append(section(COPY.residentNeeds, needs));
  const list = (kind, traits, judgedList) => {
    const items = node('ul', 'trait-list');
    traits.forEach((trait, index) => items.append(traitLine(kind, trait, judgedList ? judgedList[index] : {}, nameOf, placed)));
    return items;
  };
  body.append(section(COPY.residentWants, [list('want', record.wants, placed ? evaluation.wants : null)]));
  body.append(section(COPY.residentHates, record.hates.length > 0 ? [list('hate', record.hates, placed ? evaluation.hates : null)] : [node('p', 'need-none', COPY.residentNoHates)]));
  if (record.dream) body.append(section(COPY.residentDream, [list('dream', [record.dream], placed ? [evaluation.dream] : null)]));
  if (placed && evaluation.happy) body.append(node('p', 'resident-happy', COPY.residentHappy));
}
