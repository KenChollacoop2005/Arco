import { homeSpot, keepHomes, assignmentsOf, occupantsOf, assignResident } from '../core/roster.js';
import { makeFigure } from '../core/figure.js';

// Resident state for the main view: records, homes, evaluations and scene marks
export function setupResidents(app, { marks, scorer }) {
  let records = [];
  let places = {};
  let evaluations = new Map();
  let points = 0;
  let selected = null;
  let hidden = null;
  let token = 0;
  const figures = new Map();
  const listeners = [];

  const modulesNow = () => (app.structure ? app.structure.modules : []);
  const byId = (id) => modulesNow().find((instance) => instance.id === id) || null;
  const figureOf = (record) => {
    if (!figures.has(record.looks)) figures.set(record.looks, makeFigure(record.looks));
    return figures.get(record.looks);
  };
  const physics = document.querySelector('#physicsToggle');
  const shown = () => app.mode !== 'drawing' && !physics.checked;

  function notify() {
    for (const listener of listeners) listener();
  }

  // Pins for occupied homes, the figure for the selected resident
  function refreshMarks() {
    const pins = [];
    let stand = null;
    const homes = [...new Set(records.map((record) => record.home).filter((home) => home !== null))];
    for (const home of homes) {
      const instance = byId(home);
      if (!instance) continue;
      const living = occupantsOf(records, home).filter((record) => record.id !== hidden);
      living.forEach((record, slot) => {
        const spot = homeSpot(instance, app.analysis, slot, living.length);
        pins.push({ point: spot.pin, color: figureOf(record).params.accent });
        if (record.id === selected) stand = spot;
      });
    }
    marks.setPins(pins);
    const record = records.find((entry) => entry.id === selected);
    marks.setFigure(record && stand && record.id !== hidden ? figureOf(record) : null, stand ? stand.stand : null, stand ? stand.facing : 0);
    marks.setShown(shown());
  }

  // Scores every resident on the current structure in the worker
  async function evaluate() {
    const current = ++token;
    const structure = app.structure;
    if (!structure || records.length === 0) {
      evaluations = new Map();
      points = 0;
      notify();
      return;
    }
    try {
      const report = await scorer({ modules: structure.modules, seed: structure.seed, residents: records, assignments: assignmentsOf(records) });
      if (current !== token) return;
      evaluations = new Map(report.evaluations.map((entry) => [entry.id, entry]));
      points = report.points;
    } catch {
      if (current !== token) return;
      evaluations = new Map();
    }
    notify();
  }

  function setRecords(next) {
    records = next;
    places = Object.fromEntries(records.filter((record) => record.home !== null).map((record) => [record.id, byId(record.home)]));
    refreshMarks();
    notify();
    evaluate();
  }

  // Homes keep residents only while they stand where they stood
  app.structureListeners.push((result, phase) => {
    if (phase !== 'start') return;
    const kept = keepHomes(records, result.modules, places);
    records = kept;
    places = Object.fromEntries(records.filter((record) => record.home !== null).map((record) => [record.id, byId(record.home)]));
    evaluations = new Map();
    refreshMarks();
    notify();
  });
  app.analysisListeners.push((analysis) => {
    if (!analysis) return;
    refreshMarks();
    evaluate();
  });
  app.modeListeners.push(refreshMarks);
  physics.addEventListener('change', refreshMarks);

  return {
    list: () => records,
    evaluation: (id) => evaluations.get(id) || null,
    points: () => points,
    figureOf,
    homeOf: (id) => {
      const record = records.find((entry) => entry.id === id);
      return record && record.home !== null ? byId(record.home) : null;
    },
    selected: () => selected,
    select(id) {
      selected = id;
      refreshMarks();
      notify();
    },
    setRecords,
    // Moves one resident into a home with room, or out with null
    assign(id, home) {
      const next = assignResident(records, modulesNow(), id, home);
      if (!next) return false;
      setRecords(next);
      return true;
    },
    // Raw points now and per candidate home for one resident
    preview(id, homes) {
      const structure = app.structure;
      if (!structure) return Promise.resolve(null);
      return scorer({ modules: structure.modules, seed: structure.seed, residents: records, assignments: assignmentsOf(records), preview: { resident: id, homes } });
    },
    // Hides one resident's pin and figure while they are carried
    hide(id) {
      hidden = id;
      refreshMarks();
    },
    refreshMarks,
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
