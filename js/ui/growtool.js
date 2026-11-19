import { CELL_MM, GROW_ZONE_CELLS, GROW_ZONE_DEFAULT } from '../config.js';
import { growZone, zoneCenter } from '../core/build.js';
import { readSetting, writeSetting } from './legend.js';

const SIZE_KEY = 'arco.growSize'; // remembered zone size stop
const STOPS = Object.keys(GROW_ZONE_CELLS); // S, M, L in slider order
const BACK_MM = CELL_MM / 2; // step off a face toward the viewer
const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']; // keys go to these instead

// Grow drawer: three-stop size, Grow here tool, Grow everything
export function setupGrowTool(app, canvas, { pointAt, zone, builder }) {
  const query = (selector) => document.querySelector(selector);
  const slider = query('#growSize');
  const here = query('#growHere');
  const all = query('#growAll');
  const hint = query('#growHint');
  const status = query('#growStatus');
  let on = false;
  let center = null;

  slider.max = String(STOPS.length - 1);
  const stored = STOPS.indexOf(readSetting(SIZE_KEY, GROW_ZONE_DEFAULT));
  slider.value = String(stored >= 0 ? stored : STOPS.indexOf(GROW_ZONE_DEFAULT));
  const cells = () => GROW_ZONE_CELLS[STOPS[Number(slider.value)]];
  const showZone = () => zone.set(on ? center : null, cells() * CELL_MM);
  slider.addEventListener('input', () => {
    writeSetting(SIZE_KEY, STOPS[Number(slider.value)]);
    slider.setAttribute('aria-valuetext', STOPS[Number(slider.value)]);
    showZone();
  });
  slider.setAttribute('aria-valuetext', STOPS[Number(slider.value)]);

  function setOn(next) {
    on = next && app.mode === 'generate';
    here.setAttribute('aria-pressed', String(on));
    hint.hidden = !on;
    document.body.classList.toggle('grow-here', on);
    if (!on) center = null;
    showZone();
  }

  function growAt() {
    if (!on || !center) return;
    builder.grow(status, growZone(center, cells()));
  }

  here.addEventListener('click', () => setOn(!on));
  all.addEventListener('click', () => builder.grow(status));
  builder.onGrowing((busy) => {
    all.disabled = busy;
    here.disabled = busy;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!on) return;
    const point = pointAt(event, BACK_MM);
    center = point ? zoneCenter(point) : null;
    showZone();
  });
  window.addEventListener('keydown', (event) => {
    if (!on || TYPING_TAGS.includes(event.target.tagName)) return;
    if (event.key === 'Escape') setOn(false);
    else if (event.key === 'Enter') growAt();
    else return;
    event.preventDefault();
  });
  app.modeListeners.push(() => setOn(on));

  return {
    // True when the tool took the click
    click(event) {
      if (!on) return false;
      const point = pointAt(event, BACK_MM);
      if (point) center = zoneCenter(point);
      showZone();
      growAt();
      return true;
    },
  };
}
