import { STORY_MM, MAX_OVERHANG_DEG, MAX_BRIDGE_MM, MIN_WALL_MM, BED_MM } from '../config.js';
import { fitStatus } from '../core/checks.js';
import { FAMILIES, defaultPlacement, residentCapacity, canSupport } from '../core/catalog.js';
import { placementOf } from '../core/placement.js';
import { portUse } from '../core/services.js';
import { variantMounts } from '../core/mounts.js';
import { COPY } from './copy.js';
import { bindDrawer } from './drawers.js';
import { footprintText, categoryLabel } from './cards.js';

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

const PORT_COPY = { power: 'portPower', 'water-in': 'portWaterIn', 'water-out': 'portWaterOut', line: 'portLine' }; // port type to copy key
const MASK_SIDES = 4; // facade mask bits, one per side
const millimetres = (value) => (value === null || value === undefined ? COPY.none : `${value.toFixed(1)} mm`);
const yesNo = (value) => (value ? COPY.yes : COPY.no);
const whole = (value) => (value === null || value === undefined ? COPY.none : value.toFixed(0));

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

const RULE_NAMES = { size: 'ruleNameSize', base: 'ruleNameBase', overhang: 'ruleOverhang', bridge: 'ruleBridge', wall: 'ruleWall', solid: 'ruleNameSolid' }; // print rule to copy key

// Measured value of one print rule against its limit
function ruleDetail(name, rule) {
  if (name === 'size') return `${COPY.bed} ${BED_MM} mm`;
  if (name === 'base') return `${whole(rule.value)} mm2`;
  if (name === 'overhang') return `${whole(rule.value)} ${COPY.degrees}, ${COPY.limit} ${MAX_OVERHANG_DEG}`;
  if (name === 'bridge') return `${millimetres(rule.value)}, ${COPY.limit} ${MAX_BRIDGE_MM}`;
  if (name === 'wall') return `${millimetres(rule.value)}, ${COPY.limit} ${MIN_WALL_MM}`;
  return '';
}

// One line per print rule, each with its own status
function printLines(list, print) {
  if (!print) {
    list.append(checkLine(COPY.printability, '', COPY.checking));
    return;
  }
  list.append(checkLine(COPY.printability, print.status, COPY[print.status], print.status === 'pass' ? COPY.printFits : ''));
  for (const name of RULE_ORDER) {
    const rule = print.rules[name];
    list.append(checkLine(COPY[RULE_NAMES[name]], rule.status, COPY[rule.status], ruleDetail(name, rule)));
  }
}

// Shared inspector: header plus Needs, Connections, Walking and Advanced drawers
// prefix keeps each place's drawer states apart
export function createInspector(body, prefix = 'arco.inspector') {
  function drawer(name, title, fallback = 'closed') {
    const section = node('details', 'drawer');
    const inner = node('div', 'drawer-body');
    section.append(node('summary', '', title), inner);
    bindDrawer(section, `${prefix}.${name}`, fallback);
    body.append(section);
    return inner;
  }

  function header(variant, family, placement) {
    const top = node('div', 'inspector-head');
    top.append(node('p', 'inspector-name', family.label), node('p', 'inspector-sub', `${COPY.family}: ${family.id}`));
    top.append(rows([[COPY.category, categoryLabel(family)], [COPY.role, family.group], [COPY.placement, placement], [COPY.footprint, footprintText(variant)]]));
    body.append(top);
  }

  function structureView({ structure, checks, printOf }) {
    const top = node('div', 'inspector-head');
    const height = Math.max(0, ...structure.modules.map((instance) => instance.z + instance.h)) * STORY_MM;
    top.append(node('p', 'inspector-name', COPY.structure), node('p', 'inspector-sub', COPY.inspectorNone));
    top.append(rows([[COPY.modules, String(structure.modules.length)], [COPY.heightLabel, `${height} mm`], [COPY.seed, structure.seed]]));
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
    top.append(list);
    body.append(top);
  }

  function needsDrawer({ flows }, variant, placed) {
    const needs = drawer('needs', COPY.needs, 'open');
    const capacity = residentCapacity(variant);
    const lines = [];
    if (placed) {
      // The row label already says Water or Power
      const bare = (text, label) => (text ? text.replace(`${label}: `, '') : flows ? COPY.noNeed : COPY.checking);
      lines.push([COPY.water, bare(waterText(flows, variant.id), COPY.water)]);
      lines.push([COPY.power, bare(powerText(flows, variant.id), COPY.power)]);
    }
    lines.push([COPY.residents, capacity > 0 ? String(capacity) : COPY.none]);
    needs.append(rows(lines));
    if (!placed) needs.append(node('p', 'hint', COPY.needsPlaced));
  }

  function connectionsDrawer({ flows }, variant, placed) {
    const connections = drawer('connections', COPY.connections);
    const ports = placed ? flows && flows.ports : variantMounts(variant).map((port) => ({ ...port, module: 0 }));
    const use = ports ? portUse(ports, placed ? flows.services : null, placed ? variant.id : 0) : null;
    if (!use) connections.append(node('p', 'hint', COPY.checking));
    else if (use.length === 0) connections.append(node('p', 'hint', COPY.noPorts));
    else connections.append(rows(use.map((row) => [COPY[PORT_COPY[row.type]] || row.type, `${row.used} ${COPY.of} ${row.capacity}`])));
  }

  function walkingDrawer({ walking }, variant) {
    const walk = drawer('walking', COPY.walking);
    const entry = walking && walking.modules && walking.modules[variant.id];
    if (!entry) {
      walk.append(node('p', 'hint', walking ? COPY.walkUnreached : COPY.checking));
      return;
    }
    walk.append(node('p', 'hint', !entry.reached ? COPY.walkUnreached : entry.stepFree ? COPY.walkFromPlinthFree : COPY.walkFromPlinthSteps));
    const nearest = Object.entries(entry.nearest).filter(([, value]) => value.steps > 0).sort((first, second) => first[1].steps - second[1].steps || (first[0] < second[0] ? -1 : 1));
    if (nearest.length > 0) walk.append(rows(nearest.map(([type, value]) => [FAMILIES[type] ? FAMILIES[type].label : type, `${value.steps} ${value.steps === 1 ? COPY.walkStep : COPY.walkSteps}, ${value.stepFree ? COPY.walkStepFree : COPY.walkWithSteps}`])));
  }

  function advancedDrawer({ checks, printOf, socketsOf, fit }, variant, placed) {
    const family = FAMILIES[variant.family];
    const advanced = drawer('advanced', COPY.advanced);
    const list = node('ul', 'checks');
    const entry = placed && checks && checks.modules[variant.id];
    if (placed && !entry) list.append(checkLine(COPY.stability, '', COPY.checking));
    if (entry) {
      const margin = entry.stability.margin === null ? COPY.none : millimetres(entry.stability.margin);
      list.append(checkLine(COPY.stability, entry.stability.status, margin, entry.stability.reason || COPY.stabilityOk));
      list.append(checkLine(COPY.placementRules, entry.placement.status, COPY[entry.placement.status], entry.placement.reason));
    }
    printLines(list, printOf(variant));
    const sockets = socketsOf(variant);
    const pegged = sockets && sockets.top.length + sockets.bottom.length > 0;
    if (!family.rails && !pegged) list.append(checkLine(COPY.connectorFit, '', COPY.none, COPY.fitLoose));
    else if (!fit) list.append(checkLine(COPY.connectorFit, '', COPY.checking));
    else list.append(checkLine(COPY.connectorFit, fitStatus(fit.gap, fit.clearance), `${fit.gap.toFixed(2)} mm`, `${COPY.fitMeasured} ${fit.clearance.toFixed(2)} mm`));
    advanced.append(list, node('p', 'drawer-label', COPY.placementRules));
    advanced.append(rows([[COPY.ruleCarries, yesNo(canSupport(variant))], [COPY.ruleGround, yesNo(family.ground)], [COPY.ruleSpans, yesNo(family.spanning)], [COPY.ruleRails, yesNo(family.rails)]]));
    advanced.append(node('p', 'drawer-label', COPY.variantRecord));
    const mask = (variant.mask || 0).toString(2).padStart(MASK_SIDES, '0');
    advanced.append(rows([[COPY.seed, String(variant.seed)], [COPY.mask, mask], [COPY.profiles, variant.prof ? String(variant.prof) : COPY.none], [COPY.stories, String(variant.h)], [COPY.roof, yesNo(variant.roof)]]));
  }

  // A placed module (it has an id) or a saved variant (no id)
  function moduleView(state, variant) {
    const placed = variant.id !== undefined;
    header(variant, FAMILIES[variant.family], placed ? placementOf(variant) : defaultPlacement(variant));
    needsDrawer(state, variant, placed);
    connectionsDrawer(state, variant, placed);
    if (placed) walkingDrawer(state, variant);
    advancedDrawer(state, variant, placed);
  }

  return {
    // state: structure, checks, flows, walking, printOf, socketsOf, fit
    render(state, selected) {
      body.replaceChildren();
      if (selected) moduleView(state, selected);
      else if (state.structure) structureView(state);
    },
  };
}

