import { COPY } from './copy.js';
import { causeText } from './scoretab.js';
import { shareText, dailyNumber } from '../core/puzzleplay.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

// Title line of the share grid
export function shareTitle(game) {
  return game.kind === 'daily' ? `${COPY.resultsShareTitle} ${COPY.puzzleDaily} #${dailyNumber(game.date)}` : `${COPY.resultsShareTitle} ${COPY.puzzleInfinite} ${game.seed}`;
}

// Results sheet after Submit: score, breakdown, share grid, Show par
// hooks: recordOf(id), nameOf(id), portrait(record), showPar(), hidePar(), stats(game) as [label, value] pairs
export function setupResults(app, hooks) {
  const query = (selector) => document.querySelector(selector);
  const sheet = query('#results');
  const status = query('#resultsStatus');
  const share = query('#resultsShare');
  const parBar = query('#parBar');
  let shown = null;

  function residentBlock(resident, evaluation, contributions) {
    const record = hooks.recordOf(resident.id) || resident;
    const item = node('li', 'results-resident');
    const head = node('div', 'results-resident-head');
    const image = node('img', 'resident-portrait');
    image.alt = '';
    image.src = hooks.portrait(record);
    const total = contributions.reduce((sum, entry) => sum + entry.points, 0);
    head.append(image, node('strong', 'results-name', resident.name), node('span', 'results-total', signed(total)));
    item.append(head);
    if (!evaluation || evaluation.home === null) item.append(node('p', 'need-reason', COPY.resultsUnplaced));
    const lines = node('ul', 'results-lines');
    for (const entry of contributions) {
      const line = node('li', `results-line ${entry.points > 0 ? 'is-gain' : entry.points < 0 ? 'is-loss' : ''}`);
      line.append(node('span', '', causeText(entry, hooks.recordOf, hooks.nameOf)), node('span', 'results-value', signed(entry.points)));
      lines.append(line);
    }
    item.append(lines);
    return item;
  }

  function render() {
    const { report, game } = shown;
    const score = report.score;
    query('#resultsPoints').textContent = String(score.points);
    query('#resultsPercent').textContent = `${score.percent}% ${COPY.scoreOfPar} (${COPY.resultsPar} ${game.puzzle.par.points})`;
    const stats = query('#resultsStats');
    stats.replaceChildren();
    for (const [label, value] of hooks.stats(game)) stats.append(node('dt', '', label), node('dd', '', String(value)));
    stats.hidden = stats.children.length === 0;
    const list = query('#resultsResidents');
    list.replaceChildren();
    const byId = new Map(report.evaluations.map((entry) => [entry.id, entry]));
    for (const resident of game.puzzle.residents) {
      list.append(residentBlock(resident, byId.get(resident.id), score.contributions.filter((entry) => entry.resident === resident.id)));
    }
    const unused = score.contributions.find((entry) => entry.kind === 'unused');
    if (unused) {
      const line = node('li', 'results-resident results-unused');
      line.append(node('span', '', `${COPY.resultsUnusedLine} (${unused.count})`), node('span', 'results-value', signed(unused.points)));
      list.append(line);
    }
    share.textContent = shareText({ title: shareTitle(game), residents: game.puzzle.residents, evaluations: report.evaluations, score, par: game.puzzle.par.points });
  }

  function open(report, game, note = '') {
    shown = { report, game };
    status.textContent = note;
    render();
    parBar.hidden = true;
    sheet.hidden = false;
    query('#resultsClose').focus();
  }

  function close() {
    sheet.hidden = true;
    if (!parBar.hidden) {
      parBar.hidden = true;
      hooks.hidePar();
    }
  }

  query('#resultsClose').addEventListener('click', close);
  query('#resultsCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(share.textContent);
      status.textContent = COPY.resultsCopied;
    } catch {
      // The grid stays selectable when the clipboard is blocked
      window.getSelection().selectAllChildren(share);
      status.textContent = COPY.resultsCopyFailed;
    }
  });
  // Show par: the sheet steps aside while the par layout builds in
  query('#resultsPar').addEventListener('click', () => {
    sheet.hidden = true;
    query('#parText').textContent = `${COPY.resultsPar} ${shown.game.puzzle.par.points} ${COPY.resultsPoints}`;
    parBar.hidden = false;
    hooks.showPar();
  });
  query('#parBack').addEventListener('click', () => {
    parBar.hidden = true;
    hooks.hidePar();
  });
  query('#parResults').addEventListener('click', () => {
    parBar.hidden = true;
    hooks.hidePar();
    sheet.hidden = false;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden) close();
  });
  // Another world or tab closes the sheet and any par on show
  app.modeListeners.push((mode) => {
    if (mode !== 'puzzle' && mode !== 'drawing') close();
  });

  return {
    open,
    close,
    isOpen: () => !sheet.hidden || !parBar.hidden,
  };
}
