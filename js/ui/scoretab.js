import { COPY } from './copy.js';
import { POINTS } from '../config.js';
import { traitText } from './residentview.js';
import { scoreChange } from '../core/puzzleplay.js';

const ROLL_MS = 650; // time for the number to roll to its new value
const FLOAT_MS = 1600; // how long a floating delta stays
const FLOAT_LIMIT = 3; // most floating deltas per change
const FLOAT_STAGGER_PX = 22; // vertical gap between deltas at one spot
const FLOAT_STAGGER_MS = 120; // delay between deltas of one change

// Label of one score contribution, for example "Level 3 or higher"
export function causeText(cause, recordOf, nameOf) {
  if (cause.kind === 'unused') return COPY.scoreUnused;
  if (cause.kind === 'happy') return COPY.residentHappy;
  if (cause.kind === 'need') return cause.id === 'water' ? COPY.needWater : COPY.needPower;
  const record = recordOf(cause.resident);
  const list = !record ? [] : cause.kind === 'want' ? record.wants : cause.kind === 'hate' ? record.hates : record.dream ? [record.dream] : [];
  const trait = list.find((entry) => entry.id === cause.id) || { id: cause.id };
  return traitText(cause.kind, trait, nameOf);
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

// Score counter over the top bar: share of par large, points and par small, rules behind ?
// hooks: recordOf(id), nameOf(id), screenOf(resident id) as [x, y] or null
export function setupScoreTab(app, residents, hooks) {
  const tab = document.querySelector('#scoreTab');
  const pointsText = document.querySelector('#scorePoints');
  const percentText = document.querySelector('#scorePercent');
  const help = document.querySelector('#scoreHelp');
  const rules = document.querySelector('#scoreRules');
  // Every way to gain and lose points, from the fixed table
  document.querySelector('#scoreRuleList').replaceChildren(...Object.entries(COPY.scoreRules).map(([key, text]) => {
    const item = document.createElement('li');
    const value = document.createElement('span');
    value.className = `score-rule-value ${POINTS[key] > 0 ? 'is-gain' : 'is-loss'}`;
    value.textContent = signed(POINTS[key]);
    item.append(value, ` ${text}`);
    return item;
  }));
  const setHelp = (open) => {
    rules.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
  };
  help.addEventListener('click', () => setHelp(rules.hidden));
  document.addEventListener('pointerdown', (event) => {
    if (!rules.hidden && !tab.contains(event.target)) setHelp(false);
  });
  let shownPuzzle = null;
  let last = null;
  let value = 0;
  let frame = 0;

  // The big number is the share of par
  function setNumber(percent) {
    value = percent;
    pointsText.textContent = `${Math.round(percent)}%`;
  }

  // Number rolls from where it is to the target
  function roll(target) {
    cancelAnimationFrame(frame);
    if (app.reducedMotion) {
      setNumber(target);
      return;
    }
    const from = value;
    const start = performance.now();
    const step = (now) => {
      const share = Math.min(1, (now - start) / ROLL_MS);
      const eased = 1 - (1 - share) ** 3;
      setNumber(from + (target - from) * eased);
      if (share < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  // Swell and green, or shake and red; colour only under reduced motion
  function flash(gain) {
    tab.classList.remove('is-gain', 'is-loss');
    void tab.offsetWidth;
    tab.classList.add(gain ? 'is-gain' : 'is-loss');
  }

  function floatAt(change, index, point) {
    const label = document.createElement('p');
    label.className = `score-float ${change.delta > 0 ? 'is-gain' : 'is-loss'}`;
    label.textContent = `${signed(change.delta)} ${causeText(change, hooks.recordOf, hooks.nameOf)}`;
    label.style.left = `${point[0]}px`;
    label.style.top = `${point[1] - index * FLOAT_STAGGER_PX}px`;
    label.style.animationDelay = `${index * FLOAT_STAGGER_MS}ms`;
    label.style.animationDuration = `${FLOAT_MS}ms`;
    document.body.append(label);
    label.addEventListener('animationend', () => label.remove());
  }

  // Deltas float up from each cause's home, or under the tab
  function floatChanges(changes) {
    const box = tab.getBoundingClientRect();
    const fallback = [box.left + box.width / 2, box.bottom + FLOAT_STAGGER_PX];
    const counts = new Map();
    for (const change of changes.slice(0, FLOAT_LIMIT)) {
      const point = (change.resident && hooks.screenOf(change.resident)) || fallback;
      const key = point.join(',');
      counts.set(key, (counts.get(key) || 0) + 1);
      floatAt(change, counts.get(key) - 1, point);
    }
  }

  function render() {
    const report = residents.report();
    const puzzle = app.puzzle;
    // Only on the Puzzle tab; the par layout on show never moves the player's counter
    tab.hidden = !puzzle || app.mode !== 'puzzle';
    if (tab.hidden) setHelp(false);
    if (app.showingPar || (puzzle && app.mode !== 'puzzle')) return;
    if (!puzzle) {
      shownPuzzle = null;
      last = null;
      return;
    }
    if (!report || report.puzzle !== puzzle || !report.score) {
      if (shownPuzzle !== puzzle) {
        setNumber(0);
        percentText.textContent = '';
        setHelp(false);
      }
      return;
    }
    const score = report.score;
    percentText.textContent = `${score.points} ${COPY.scorePts} · ${COPY.scorePar} ${puzzle.par.points}`;
    tab.classList.toggle('is-invalid', !report.valid);
    // A new puzzle shows its score without fanfare
    if (shownPuzzle !== puzzle || !last) {
      shownPuzzle = puzzle;
      last = score;
      cancelAnimationFrame(frame);
      setNumber(score.percent);
      return;
    }
    const change = scoreChange(last, score);
    last = score;
    if (change.total === 0 && change.changes.length === 0) return;
    if (change.total !== 0) {
      flash(change.total > 0);
      roll(score.percent);
    }
    floatChanges(change.changes.filter((item) => item.delta !== 0));
  }

  residents.onChange(render);
  app.modeListeners.push(render);
  render();
  return { render };
}
