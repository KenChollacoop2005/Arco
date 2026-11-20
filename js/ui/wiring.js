import { COPY } from './copy.js';
import { CELL_MM } from '../config.js';
import { FAMILIES } from '../core/catalog.js';
import { stringTypeOf, withConnection, withCut, pairKey, endKey } from '../core/wiring.js';
import { STATE_HIGHLIGHT } from '../render/materials.js';

const PORT_HIT_PX = 12; // click and hover reach around a port
const STRING_HIT_PX = 7; // click reach around a string
const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead
const STRING_TYPES = { pipes: 'water', wires: 'power', lines: 'line', lights: 'line' }; // service lists a player can cut, by string type
const PEEK_OFFSET_PX = [16, 18]; // label offset from the cursor

// Wiring tool: pick a port, see what it can reach, connect; pick a string and cut it
// hooks: canvas, camera(), marks, flows(), modules(), wiring(), setWiring(next) -> Promise, revert(), candidates(from, wiring) -> Promise,
// setStates(map of id to state or null), onToggle(on)
export function setupWiring(app, hooks) {
  const query = (selector) => document.querySelector(selector);
  const button = query('#wireTool');
  const bar = query('#wireBar');
  const text = query('#wireText');
  const cutButton = query('#wireCut');
  const peek = query('#wirePeek');
  let active = false;
  let picked = null;
  let candidates = null;
  let hovered = null;
  let selected = null;
  let refused = null;
  let pickToken = 0;

  const portsNow = () => {
    const flows = hooks.flows();
    return flows ? flows.ports.filter((port) => stringTypeOf(port.type)) : [];
  };

  // Screen spot of a point in mm
  function screen(point) {
    const rect = hooks.canvas.getBoundingClientRect();
    const projected = hooks.project(point);
    return [rect.left + ((projected[0] + 1) / 2) * rect.width, rect.top + ((1 - projected[1]) / 2) * rect.height];
  }

  function nearestPort(event, list) {
    let best = null;
    for (const port of list) {
      const [x, y] = screen(port.position);
      const gap = Math.hypot(x - event.clientX, y - event.clientY);
      if (gap <= PORT_HIT_PX && (!best || gap < best.gap)) best = { port, gap };
    }
    return best ? best.port : null;
  }

  // Strings a player can cut, with their type and whether they are manual
  function stringsNow() {
    const flows = hooks.flows();
    if (!flows) return [];
    const out = [];
    for (const [list, type] of Object.entries(STRING_TYPES)) for (const string of flows.services[list] || []) out.push({ type, string });
    return out;
  }

  function nearestString(event) {
    let best = null;
    for (const entry of stringsNow()) {
      const spots = entry.string.points.map(screen);
      for (let index = 1; index < spots.length; index++) {
        const gap = segmentGap([event.clientX, event.clientY], spots[index - 1], spots[index]);
        if (gap <= STRING_HIT_PX && (!best || gap < best.gap)) best = { entry, gap };
      }
    }
    return best ? best.entry : null;
  }

  function render() {
    const states = (port) => {
      if (!picked) return 'normal';
      if (endKey(port) === endKey(picked)) return 'picked';
      const candidate = candidates && candidates.get(endKey(port));
      if (!candidate) return 'dim';
      if (hovered && endKey(hovered) === endKey(port)) return 'hover';
      return candidate.ok ? 'candidate' : 'blocked';
    };
    hooks.marks.setPorts(portsNow().map((port) => ({ position: port.position, normal: port.normal, type: port.type, state: states(port) })));
  }

  function say(message) {
    text.textContent = message;
  }

  function hint() {
    cutButton.hidden = !selected;
    if (selected) say(selected.string.manual ? COPY.wireHintManual : COPY.wireHintString);
    else if (picked && candidates && ![...candidates.values()].some((candidate) => candidate.ok)) say(COPY.wireNoCandidates);
    else say(picked ? COPY.wireHintPicked : COPY.wireHintStart);
  }

  function clearRefused() {
    if (!refused) return;
    hooks.setStates(null);
    refused = null;
  }

  function clearPick() {
    pickToken++;
    picked = null;
    candidates = null;
    hovered = null;
    peek.hidden = true;
    hooks.marks.setGhost(null);
    clearRefused();
  }

  function clearSelection() {
    selected = null;
    hooks.marks.setSelected(null);
  }

  // Picks a port and asks which ports it can reach
  async function pick(port) {
    clearPick();
    clearSelection();
    picked = port;
    render();
    hint();
    const token = ++pickToken;
    const found = await hooks.candidates(port, hooks.wiring()).catch(() => null);
    if (token !== pickToken || !found) return;
    candidates = new Map(found.candidates.map((candidate) => [endKey(candidate.port), candidate]));
    render();
    hint();
  }

  function costText(candidate) {
    const cells = Math.round((candidate.length / CELL_MM) * 10) / 10;
    const parts = [COPY.wireTypes[candidate.connection.type], `${cells} ${cells === 1 ? COPY.cellUnit : COPY.cellsUnit}`];
    if (candidate.cost.reach !== undefined) parts.push(`${candidate.cost.reach} ${COPY.wireReach}`);
    if (candidate.cost.head !== undefined) parts.push(`${candidate.cost.head} ${COPY.wireHead}${candidate.cost.climbs ? `, ${COPY.wireClimbs}` : ''}`);
    return parts.join(' · ');
  }

  function reasonText(result) {
    const reason = COPY.wireReasons[result.reason] || result.reason;
    const blocker = result.blocker !== null && result.blocker !== undefined ? (hooks.modules() || []).find((instance) => instance.id === result.blocker) : null;
    return blocker ? `${reason}: ${FAMILIES[blocker.family].label}` : reason;
  }

  function showPeek(event, message) {
    peek.textContent = message;
    peek.hidden = false;
    peek.style.transform = `translate(${event.clientX + PEEK_OFFSET_PX[0]}px, ${event.clientY + PEEK_OFFSET_PX[1]}px)`;
  }

  // Hover over a candidate: ghost string, length and cost or why it is blocked
  function hover(event) {
    if (!active || !picked || !candidates) return;
    const port = nearestPort(event, portsNow().filter((entry) => candidates.has(endKey(entry))));
    const key = port ? endKey(port) : null;
    if ((hovered ? endKey(hovered) : null) !== key) {
      hovered = port;
      render();
    }
    if (!port) {
      peek.hidden = true;
      if (!refused) hooks.marks.setGhost(null);
      return;
    }
    const candidate = candidates.get(key);
    hooks.marks.setGhost(candidate.points, candidate.ok);
    showPeek(event, candidate.ok ? costText(candidate) : `${COPY.wireBlocked}: ${reasonText(candidate)}`);
  }

  // Refused: the attempted route stays red and the blocker lights up
  function refuse(result) {
    hooks.marks.setGhost(result.points, false);
    say(`${COPY.wireRefused} ${reasonText(result)}.`);
    if (result.blocker !== null && result.blocker !== undefined) {
      refused = result;
      hooks.setStates(new Map([[result.blocker, STATE_HIGHLIGHT]]));
    }
  }

  async function connect(candidate) {
    if (!candidate.ok) {
      refuse(candidate);
      return;
    }
    const wiring = withConnection(hooks.wiring(), candidate.connection);
    clearPick();
    render();
    say(COPY.wireWorking);
    await hooks.setWiring(wiring);
    // A planner can still refuse it (a loop, or a part that takes no water or power here)
    const manual = (hooks.flows() && hooks.flows().services.manual) || [];
    const status = manual[manual.length - 1];
    if (status && !status.ok && pairKey(status.a, status.b) === pairKey(candidate.connection.a, candidate.connection.b)) {
      hooks.revert();
      refuse(status);
      return;
    }
    say(COPY.wireConnected);
  }

  async function cut() {
    if (!selected) return;
    const { from, to, manual } = selected.string;
    const wiring = withCut(hooks.wiring(), from, to, selected.type, !!manual);
    clearSelection();
    hint();
    say(COPY.wireWorking);
    await hooks.setWiring(wiring);
    say(manual ? COPY.wireRemoved : COPY.wireCutDone);
  }

  // A click on the scene while the tool is on
  function click(event) {
    if (!active) return false;
    if (picked) {
      const port = nearestPort(event, portsNow());
      const candidate = port && candidates && candidates.get(endKey(port));
      if (candidate) connect(candidate);
      else if (port && endKey(port) !== endKey(picked)) pick(port);
      else {
        clearPick();
        render();
        hint();
      }
      return true;
    }
    const port = nearestPort(event, portsNow());
    if (port) {
      pick(port);
      return true;
    }
    const string = nearestString(event);
    if (string) {
      selected = string;
      hooks.marks.setSelected(string.string.points);
    } else clearSelection();
    hint();
    return true;
  }

  function setActive(on, from = null) {
    if (on && !(app.structure && (app.mode === 'generate' || app.mode === 'puzzle'))) return;
    if (on === active && !from) return;
    active = on;
    clearPick();
    clearSelection();
    button.setAttribute('aria-pressed', String(on));
    bar.hidden = !on;
    hooks.marks.setShown(on);
    hooks.onToggle(on);
    if (on) {
      render();
      hint();
      if (from) pick(from);
    }
  }

  button.addEventListener('click', () => setActive(!active));
  cutButton.addEventListener('click', cut);
  hooks.canvas.addEventListener('pointermove', hover);
  hooks.canvas.addEventListener('pointerleave', () => {
    peek.hidden = true;
  });
  window.addEventListener('keydown', (event) => {
    if (TYPING_TAGS.includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'w' && (active || app.mode === 'generate' || app.mode === 'puzzle')) setActive(!active);
    else if (!active) return;
    else if (key === 'escape') {
      if (picked) clearPick();
      else if (selected) clearSelection();
      else setActive(false);
      render();
      hint();
    } else if ((key === 'delete' || key === 'backspace') && selected) cut();
    else if (key !== 'w') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  // A new structure or another mode ends a half-made connection or the tool
  app.modeListeners.push((mode) => {
    if (active && mode !== 'generate' && mode !== 'puzzle') setActive(false);
  });
  app.analysisListeners.push(() => {
    if (!active) return;
    if (!app.structure) {
      setActive(false);
      return;
    }
    if (selected && !stringsNow().some((entry) => pairKey(entry.string.from, entry.string.to) === pairKey(selected.string.from, selected.string.to))) clearSelection();
    render();
    hint();
  });
  app.structureListeners.push((result, phase) => {
    if (phase === 'start' && active) {
      clearPick();
      clearSelection();
    }
  });

  return {
    active: () => active,
    click,
    // Right-click while the tool is on drops a half-made connection
    cancel() {
      if (!active) return false;
      clearPick();
      render();
      hint();
      return true;
    },
    // Opens the tool with a port already picked (inspector's Connect from here)
    startFrom(end) {
      const port = portsNow().find((entry) => endKey(entry) === endKey(end));
      if (port) setActive(true, port);
    },
    setActive,
  };
}

// Pixel distance from a point to a segment
function segmentGap(point, from, to) {
  const along = [to[0] - from[0], to[1] - from[1]];
  const length = along[0] * along[0] + along[1] * along[1];
  const share = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * along[0] + (point[1] - from[1]) * along[1]) / length));
  return Math.hypot(point[0] - (from[0] + along[0] * share), point[1] - (from[1] + along[1] * share));
}
