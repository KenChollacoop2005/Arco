import { homeSpot, keepHomes, assignmentsOf, occupantsOf, assignResident, rollSandboxResident } from '../core/roster.js';
import { FAMILIES } from '../core/catalog.js';
import { randomSeedText } from '../core/rng.js';
import { makeFigure } from '../core/figure.js';

// Resident state for the main view: records, homes, evaluations and scene marks
export function setupResidents(app, { marks, scorer }) {
  let records = [];
  let places = {};
  let evaluations = new Map();
  let points = 0;
  let report = null;
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

  // Pins for occupied homes; the selected resident's pin pulses
  function refreshMarks() {
    const pins = [];
    const homes = [...new Set(records.map((record) => record.home).filter((home) => home !== null))];
    for (const home of homes) {
      const instance = byId(home);
      if (!instance) continue;
      const living = occupantsOf(records, home).filter((record) => record.id !== hidden);
      living.forEach((record, slot) => {
        const spot = homeSpot(instance, app.analysis, slot, living.length);
        pins.push({ point: spot.pin, color: figureOf(record).params.accent, selected: record.id === selected });
      });
    }
    marks.setPins(pins);
    marks.setShown(shown());
  }

  // Scores every resident on the current structure in the worker
  async function evaluate() {
    const current = ++token;
    const structure = app.structure;
    if (!structure || records.length === 0) {
      evaluations = new Map();
      points = 0;
      report = null;
      notify();
      return;
    }
    try {
      const next = await scorer({ modules: structure.modules, seed: structure.seed, residents: records, assignments: assignmentsOf(records) });
      if (current !== token || app.structure !== structure) return;
      evaluations = new Map(next.evaluations.map((entry) => [entry.id, entry]));
      points = next.points;
      report = next;
    } catch {
      if (current !== token) return;
      evaluations = new Map();
      report = null;
    }
    notify();
  }

  // Modules given when the records belong to a structure about to be shown
  function setRecords(next, modules = null) {
    records = next;
    const find = modules ? (id) => modules.find((instance) => instance.id === id) || null : byId;
    places = Object.fromEntries(records.filter((record) => record.home !== null).map((record) => [record.id, find(record.home)]));
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
    report = null;
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
    // Last full score report from the scorer
    report: () => report,
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
    // A random resident with the puzzle rules; amenity wants name only amenities that stand here
    roll() {
      const amenities = [...new Set(modulesNow().map((instance) => FAMILIES[instance.family].amenity).filter(Boolean))];
      const record = rollSandboxResident(randomSeedText(), records, amenities);
      setRecords([...records, record]);
      return record;
    },
    // Hides one resident's pin while they are carried
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
