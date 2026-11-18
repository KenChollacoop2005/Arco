import { CELL_MM, STORY_MM, MAX_OVERHANG_DEG, MAX_BRIDGE_MM, MIN_WALL_MM, BED_MM } from '../config.js';
import { fitStatus } from '../core/checks.js';
import { footprintSize } from '../core/grid.js';
import { FAMILIES } from '../core/catalog.js';
import { placementOf } from '../core/placement.js';
import { COPY } from './copy.js';

const RULE_ORDER = ['size', 'base', 'overhang', 'bridge', 'wall', 'solid'];
const WATER_STATUS = { full: 'waterFull', partial: 'waterPartial', dry: 'waterDry' }; // consumer status to copy key
const WATER_REASON = { 'no route': 'waterNoRoute', 'no wall route': 'waterNoWall', 'source empty': 'waterEmpty', 'no free port': 'waterNoPort' }; // solver reason to copy key
const amount = (value) => String(Number(value.toFixed(2)));

// One plain water line for a consumer, null for other modules
export function waterText(flows, id) {
  const report = flows && flows.services && flows.services.water.consumers[id];
  if (!report) return null;
  const parts = [`${COPY.water}: ${amount(report.received)} ${COPY.waterOf} ${amount(report.demand)}`, COPY[WATER_STATUS[report.status]]];
  if (report.reason === 'out of head') parts.push(report.short === null ? COPY.waterNoHead : `${COPY.waterShortBy} ${amount(report.short)}`);
  else if (report.reason) parts.push(COPY[WATER_REASON[report.reason]]);
  return parts.join(', ');
}

const POWER_REASON = { 'no route': 'powerNoRoute', 'source empty': 'powerEmpty', 'relay at throughput': 'powerRelayFull', 'no free port': 'powerNoPort', 'blocked by module': 'powerBlocked' }; // solver reason to copy key

// Why power is short, as plain words
function powerReason(report) {
  if (report.reason === 'out of reach') return report.short ? `${COPY.powerShortBy} ${amount(report.short)}` : COPY.powerOutOfReach;
  return report.reason ? COPY[POWER_REASON[report.reason]] : '';
}

// Power lines: makes, takes, relays, pump state
export function powerText(flows, id) {
  const power = flows && flows.services && flows.services.power;
  if (!power || !power.consumers) return null;
  const lines = [];
  const source = (power.nodes || []).find((node) => node.module === id && node.kind === 'source');
  if (source) lines.push(`${COPY.powerMakes} ${amount(source.supply)} ${COPY.powerUnits}`);
  const report = power.consumers[id];
  if (report && !report.relay) {
    if (report.status === 'dry') lines.push(`${COPY.notPowered}: ${powerReason(report)}`);
    else {
      const parts = [`${COPY.power}: ${amount(report.received)} ${COPY.powerOf} ${amount(report.demand)}`];
      if (report.status === 'partial') parts.push(COPY.powerPartial, powerReason(report));
      lines.push(parts.filter(Boolean).join(', '));
    }
    const pump = flows.services.water && flows.services.water.pumps && flows.services.water.pumps[id];
    if (pump) lines.push(pump.runs ? COPY.pumpRuns : COPY.pumpOff);
  }
  for (const key of [String(id), `${id}:box`]) {
    const relay = power.consumers[key];
    if (!relay || !relay.relay) continue;
    const node = (power.nodes || []).find((entry) => entry.id === key);
    lines.push(relay.fed ? `${COPY.relayPasses} ${amount(relay.received)} ${COPY.powerOf} ${amount(node ? node.throughput : 0)}` : [COPY.relayIdle, relay.reason && COPY[POWER_REASON[relay.reason]]].filter(Boolean).join(', '));
  }
  return lines.length > 0 ? lines.join('. ') : null;
}

// One walking line: the nearest amenity and how the plinth reaches this module
export function walkingText(walking, id, label = (type) => type) {
  const entry = walking && walking.modules && walking.modules[id];
  if (!entry) return null;
  const reach = !entry.reached ? COPY.walkUnreached : entry.stepFree ? COPY.walkFromPlinthFree : COPY.walkFromPlinthSteps;
  const nearest = Object.entries(entry.nearest).filter(([, value]) => value.steps > 0).sort((first, second) => first[1].steps - second[1].steps || (first[0] < second[0] ? -1 : 1))[0];
  if (!nearest) return reach;
  const [type, { steps, stepFree }] = nearest;
  return `${COPY.walkNearest} ${label(type).toLowerCase()}: ${steps} ${COPY.walkSteps}, ${stepFree ? COPY.walkStepFree : COPY.walkWithSteps}. ${reach}`;
}

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

  function moduleView({ checks, flows, walking, printOf, socketsOf, fit, onExport, onSave }, instance) {
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
    const sockets = socketsOf(instance);
    const pegged = sockets && sockets.top.length + sockets.bottom.length > 0;
    if (!family.rails && !pegged) list.append(checkLine(COPY.connectorFit, '', COPY.none, COPY.fitLoose));
    else if (!fit) list.append(checkLine(COPY.connectorFit, '', COPY.checking));
    else list.append(checkLine(COPY.connectorFit, fitStatus(fit.gap, fit.clearance), `${fit.gap.toFixed(2)} mm`, `${COPY.fitMeasured} ${fit.clearance.toFixed(2)} mm`));
    body.append(list);
    for (const text of [waterText(flows, instance.id), powerText(flows, instance.id), walkingText(walking, instance.id, (type) => (FAMILIES[type] ? FAMILIES[type].label : type))]) {
      if (text) body.append(node('p', 'inspector-service', text));
    }
    const save = node('button', 'primary', COPY.save);
    save.addEventListener('click', () => onSave(instance));
    const button = node('button', 'plain', COPY.exportStl);
    button.addEventListener('click', () => onExport(instance.id));
    const actions = node('div', 'button-row');
    actions.append(save, button);
    body.append(actions);
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
