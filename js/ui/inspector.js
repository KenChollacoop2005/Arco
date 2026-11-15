import { CELL_MM, STORY_MM, MAX_OVERHANG_DEG, MAX_BRIDGE_MM, MIN_WALL_MM, BED_MM } from '../config.js';
import { footprintSize } from '../core/grid.js';
import { FAMILIES } from '../core/catalog.js';
import { placementOf } from '../core/placement.js';
import { COPY } from './copy.js';

const RULE_ORDER = ['size', 'base', 'overhang', 'bridge', 'wall', 'solid'];

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function rows(pairs) {
  const list = node('dl', 'rows');
  for (const [label, value] of pairs) list.append(node('dt', '', label), node('dd', '', value));
  return list;
}

function checkLine(label, status, value, detail) {
  const line = node('li', status || '');
  line.append(node('span', '', label), node('em', '', value));
  if (detail) line.append(node('small', '', detail));
  return line;
}

const millimetres = (value) => `${value.toFixed(1)} mm`;

function ruleText(name, rule) {
  if (name === 'size') return `${COPY.ruleSize} (${BED_MM} mm)`;
  if (name === 'base') return `${COPY.ruleBase} (${rule.value.toFixed(0)} mm2)`;
  if (name === 'overhang') return `${COPY.ruleOverhang} ${rule.value.toFixed(0)} ${COPY.degrees}, ${COPY.limit} ${MAX_OVERHANG_DEG}`;
  if (name === 'bridge') return `${COPY.ruleBridge} ${millimetres(rule.value)}, ${COPY.limit} ${MAX_BRIDGE_MM}`;
  if (name === 'wall') return `${COPY.ruleWall} ${millimetres(rule.value)}, ${COPY.limit} ${MIN_WALL_MM}`;
  return COPY.ruleSolid;
}

function printLine(print) {
  if (!print) return checkLine(COPY.printability, '', COPY.checking);
  const broken = RULE_ORDER.filter((name) => print.rules[name].status !== 'pass');
  const detail =
    broken.length > 0
      ? broken.map((name) => ruleText(name, print.rules[name])).join('. ')
      : `${COPY.printFits}. ${COPY.ruleOverhang} ${print.rules.overhang.value.toFixed(0)} ${COPY.degrees}, ${COPY.ruleBridge.toLowerCase()} ${millimetres(print.rules.bridge.value)}`;
  return checkLine(COPY.printability, print.status, COPY[print.status], detail);
}

export function createInspector(body) {
  function structureView({ structure, checks, printOf }) {
    const height = Math.max(0, ...structure.modules.map((instance) => instance.z + instance.h)) * STORY_MM;
    body.append(node('p', 'inspector-name', COPY.structure), node('p', 'inspector-sub', COPY.inspectorNone));
    body.append(rows([[COPY.modules, String(structure.modules.length)], [COPY.heightLabel, `${height} mm`], [COPY.seed, structure.seed]]));
    const list = node('ul', 'checks');
    if (!checks) {
      list.append(checkLine(COPY.stability, '', COPY.checking));
    } else {
      const critical = checks.critical;
      const owner = critical && structure.modules.find((instance) => instance.id === critical.upper);
      const detail = critical && owner ? `${COPY.critical}: ${FAMILIES[owner.family].label}, ${COPY.tippingMargin.toLowerCase()} ${millimetres(critical.margin)}` : '';
      list.append(checkLine(COPY.stability, checks.stability, COPY[checks.stability], detail));
      list.append(checkLine(COPY.placementRules, checks.placement, COPY[checks.placement]));
    }
    const prints = structure.modules.map(printOf);
    const failing = prints.filter((print) => print && print.status !== 'pass').length;
    if (prints.some((print) => !print)) list.append(checkLine(COPY.printability, '', COPY.checking));
    else list.append(checkLine(COPY.printability, failing ? 'fail' : 'pass', failing ? COPY.fail : COPY.pass, failing ? `${failing} ${COPY.modulesFail}` : COPY.printFits));
    body.append(list);
  }

  function moduleView({ checks, printOf }, instance) {
    const family = FAMILIES[instance.family];
    const [sizeX, sizeY] = footprintSize(instance.fp, instance.rot);
    body.append(node('p', 'inspector-name', family.label), node('p', 'inspector-sub', family.group));
    body.append(
      rows([
        [COPY.role, family.group],
        [COPY.placement, placementOf(instance)],
        [COPY.theme, family.theme],
        [COPY.footprint, instance.fp],
        [COPY.stories, String(instance.h)],
        [COPY.size, `${sizeX * CELL_MM} x ${sizeY * CELL_MM} x ${instance.h * STORY_MM} mm`],
      ])
    );
    const list = node('ul', 'checks');
    const entry = checks && checks.modules[instance.id];
    if (!entry) {
      list.append(checkLine(COPY.stability, '', COPY.checking));
    } else {
      const margin = entry.stability.margin === null ? COPY.none : millimetres(entry.stability.margin);
      list.append(checkLine(COPY.stability, entry.stability.status, margin, entry.stability.reason || COPY.stabilityOk));
      list.append(checkLine(COPY.placementRules, entry.placement.status, COPY[entry.placement.status], entry.placement.reason));
    }
    list.append(printLine(printOf(instance)));
    body.append(list);
  }

  return {
    render(state, selected) {
      body.replaceChildren();
      if (!state.structure) return;
      if (selected) moduleView(state, selected);
      else structureView(state);
    },
  };
}
