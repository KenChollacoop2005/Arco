import { CELL_MM, STORY_MM } from '../config.js';
import { octagon } from './kit.js';

const GLASS_FRONT_MM = 0.25; // pane in front of recess back
const GLASS_BACK_MM = 0.2; // pane buried behind recess back
const GLASS_EDGE_MM = 0.3; // pane kept off wall ends
const GLASS_MIN_MM = 1; // smallest pane worth adding
const CUT_PAST_MM = 1; // cuts start outside the face
const HEAD_MIN_MM = 0.4; // back wall left under a sloped head
const MIN_PANEL_MM = 4; // narrowest panel worth cutting
const MIN_WINDOW_MM = 2; // narrowest window worth cutting
const WINDOW_DROP_MM = 1; // window head below panel head
const WINDOW_SILL_SHARE = 0.8; // window sill as share of inset
const MULLION_MM = 1.6; // mullion and blade thickness
const MULLION_FRONT_MM = 0.5; // mullion set back from the face
const BURY_MM = 0.2; // added parts sunk into the wall
const GROOVE_MM = 0.8; // pour line groove depth
const GROOVE_PAST_MM = 0.5; // groove cut outside the face
const SLIT_EXTRA_MM = 1.5; // slit depth beyond panel depth
const SLIT_EDGE_MM = 4.5; // slits kept off bay edges
const SLIT_BLANK = 0.1; // extra chance a slit is skipped
const SLIT_PIER_MM = 1.6; // least wall between slits
const EGG_DEPTH_MM = 3.2; // egg crate cell depth
const EGG_MIN_HEIGHT_MM = 3; // shortest egg crate cell
const EGG_SILL_SHARE = 0.55; // egg crate sill share
const EGG_HEAD_SHARE = 0.8; // egg crate head share
const EGG_EDGE_MM = 0.6; // egg crate kept off wall ends
const FIN_EXTRA_MM = 1.5; // fin depth beyond panel depth
const FIN_SILL_SHARE = 0.7; // fin wall sill share
const LOGGIA_DEPTH_MM = 5.2; // loggia depth
const LOGGIA_FLOOR_MM = 2.5; // loggia floor above the story line
const LOGGIA_PARAPET_MM = 4; // loggia parapet height
const LOGGIA_GLASS_EDGE_MM = 1; // loggia glass side margin
const PARAPET_MM = 1.6; // loggia parapet thickness
const OCT_EDGE_MM = 1.5; // octagon windows kept off wall ends
const OCT_SHRINK_MM = 0.4; // octagon margin inside its zone
const OCT_MIN_MM = 2.5; // smallest octagon apothem
const PUNCH_CHANCE = 0.45; // chance of a small window per bay
const PUNCH_WIDTH_MM = 3.2; // small window width
const PUNCH_HEIGHT_MM = 5; // small window height
const PUNCH_DEPTH_MM = 2.6; // small window depth
const PUNCH_EDGE_MM = 5; // small windows kept off bay edges
const PUNCH_LOW_MM = 6; // small window lowest sill
const PUNCH_HIGH_MM = 11; // small window head clearance
const TRAY_DEPTH_MM = 2.5; // sunken roof depth
const TRAY_WALL_MM = 2.2; // roof parapet thickness

// Style ranges, low then high
const RANGE = {
  depth: [1.6, 3],
  pier: [3, 6],
  sill: [5, 8.5],
  head: [3.2, 5.5],
  window: [1.5, 2.5],
  inset: [1.3, 2.4],
  finGap: [3.6, 6.5],
  finWidth: [1.6, 2.4],
  slitWidth: [2.4, 3.6],
  mullion: [6, 9],
  blank: [0.08, 0.3],
};
const SPLIT_CHANCE = 0.35; // chance of half width bays
const GROUP_CHANCE = 0.3; // chance of two story panels
const BLANK_CHANCE = 0.4; // chance a style skips some bays
const GROOVE_CHANCE = 0.5; // chance of pour line grooves
const MAX_SLITS = 3; // most slits per bay
const EGG_MIN = 2; // fewest egg crate divisions
const EGG_MAX = 3; // most egg crate divisions
const STYLE_WEIGHTS = [
  ['grid', 4], ['strip', 2.5], ['slit', 1.4], ['egg', 1], ['fins', 1.2], ['loggia', 1.6], ['oct', 1], ['blank', 0.7],
];

export const STYLE_TYPES = STYLE_WEIGHTS.map((entry) => entry[0]);

// Recess with a 45 degree sloped head
export function recess(run, u0, u1, v0, v1, depth) {
  const safeDepth = Math.min(depth, v1 - v0 - HEAD_MIN_MM);
  return run.prismU(
    [[-CUT_PAST_MM, v0], [safeDepth, v0], [safeDepth, v1 - safeDepth], [-CUT_PAST_MM, v1 + CUT_PAST_MM]],
    u0,
    u1
  );
}

// Recess that leaves a parapet at the face
export function railRecess(kit, run, u0, u1, v0, v1, depth, rail, thick) {
  const safeDepth = Math.min(depth, v1 - v0 - rail - HEAD_MIN_MM);
  // Open corners: leave a corner post
  const low = run.lo < 0 ? Math.max(u0, thick) : u0;
  const high = run.hi > run.length ? Math.min(u1, run.length - thick) : u1;
  kit.cut(
    run.prismU(
      [[-CUT_PAST_MM, v0 + rail], [thick, v0 + rail], [thick, v0], [safeDepth, v0], [safeDepth, v1 - safeDepth], [-CUT_PAST_MM, v1 + CUT_PAST_MM]],
      low,
      high
    )
  );
}

export function glassPane(kit, run, u0, u1, v0, v1, depth) {
  // Open corners: stop at the side wall's recess
  const low = Math.max(u0, run.lo < 0 ? depth : GLASS_EDGE_MM);
  const high = Math.min(u1, run.length - (run.hi > run.length ? depth : GLASS_EDGE_MM));
  if (high - low < GLASS_MIN_MM || v1 - depth - v0 < GLASS_MIN_MM) return;
  kit.add('glass', run.box(low, high, v0, v1 - depth, depth - GLASS_FRONT_MM, depth + GLASS_BACK_MM));
}

// V groove along the wall at one height
export function groove(kit, run, height, size = GROOVE_MM) {
  kit.cut(
    run.prismU(
      [[-GROOVE_PAST_MM, height - size - GROOVE_PAST_MM], [size, height], [-GROOVE_PAST_MM, height + size + GROOVE_PAST_MM]],
      run.lo,
      run.hi
    )
  );
}

export function makeStyle(rng, forced) {
  const pick = (name) => rng.range(RANGE[name][0], RANGE[name][1]);
  const type = forced || rng.weighted(STYLE_WEIGHTS);
  return {
    type,
    depth: pick('depth'),
    pier: pick('pier'),
    sill: pick('sill'),
    head: pick('head'),
    window: pick('window'),
    split: rng.chance(SPLIT_CHANCE) ? 2 : 1,
    group: rng.chance(GROUP_CHANCE) ? 2 : 1,
    blank: rng.chance(BLANK_CHANCE) ? pick('blank') : 0,
    inset: pick('inset'),
    finGap: pick('finGap'),
    finWidth: pick('finWidth'),
    slits: rng.int(1, MAX_SLITS),
    slitWidth: pick('slitWidth'),
    eggCols: rng.int(EGG_MIN, EGG_MAX),
    eggRows: rng.int(EGG_MIN, EGG_MAX),
    mullion: pick('mullion'),
    grooves: rng.chance(GROOVE_CHANCE),
    punch: PUNCH_CHANCE,
  };
}

function storyGroups(low, high, group) {
  const groups = [];
  for (let base = low; base < high - 1; base += STORY_MM * group) {
    groups.push([base, Math.min(high, base + STORY_MM * group)]);
  }
  return groups;
}

function bays(run, split) {
  const width = CELL_MM / split;
  const list = [];
  for (let bay = 0; bay < run.cells * split; bay++) {
    const start = run.bayStart(0) + bay * width;
    list.push([start, start + width]);
  }
  return list;
}

function gridStyle(kit, run, style, low, high) {
  const total = style.depth + style.window;
  for (const [base, top] of storyGroups(low, high, style.group)) {
    for (const [bayStart, bayEnd] of bays(run, style.split)) {
      const panelStart = Math.max(bayStart + style.pier / 2, run.lo);
      const panelEnd = Math.min(bayEnd - style.pier / 2, run.hi);
      if (panelEnd - panelStart < MIN_PANEL_MM || kit.rng.chance(style.blank)) continue;
      const panelLow = base + style.sill;
      const panelHigh = top - style.head;
      kit.cut(recess(run, panelStart, panelEnd, panelLow, panelHigh, style.depth));
      const windowStart = Math.max(panelStart, GLASS_EDGE_MM) + style.inset;
      const windowEnd = Math.min(panelEnd, run.length - GLASS_EDGE_MM) - style.inset;
      const windowLow = panelLow + style.inset * WINDOW_SILL_SHARE;
      const windowHigh = panelHigh - WINDOW_DROP_MM;
      if (windowEnd - windowStart < MIN_WINDOW_MM || windowHigh - windowLow < total + GLASS_MIN_MM) continue;
      kit.cut(recess(run, windowStart, windowEnd, windowLow, windowHigh, total));
      glassPane(kit, run, windowStart, windowEnd, windowLow, windowHigh, total);
    }
  }
}

function stripStyle(kit, run, style, low, high) {
  const total = style.depth + style.window;
  for (const [base, top] of storyGroups(low, high, 1)) {
    if (kit.rng.chance(style.blank)) continue;
    const panelLow = base + style.sill;
    const panelHigh = top - style.head;
    kit.cut(recess(run, run.lo, run.hi, panelLow, panelHigh, style.depth));
    const windowLow = panelLow + WINDOW_DROP_MM;
    const windowHigh = panelHigh - WINDOW_DROP_MM;
    if (windowHigh - windowLow < total + GLASS_MIN_MM) continue;
    const windowStart = run.lo < 0 ? run.lo : run.lo + style.inset;
    const windowEnd = run.hi > run.length ? run.hi : run.hi - style.inset;
    kit.cut(recess(run, windowStart, windowEnd, windowLow, windowHigh, total));
    glassPane(kit, run, windowStart, windowEnd, windowLow, windowHigh, total);
    const firstMullion = Math.max(windowStart, 0) + style.mullion;
    const lastMullion = Math.min(windowEnd, run.length) - style.mullion / 2;
    for (let at = firstMullion; at < lastMullion; at += style.mullion) {
      kit.add(
        'concrete',
        run.box(at - MULLION_MM / 2, at + MULLION_MM / 2, windowLow - BURY_MM, windowHigh, MULLION_FRONT_MM, total + BURY_MM)
      );
    }
  }
}

function slitStyle(kit, run, style, low, high) {
  const depth = style.depth + SLIT_EXTRA_MM;
  for (const [bayStart, bayEnd] of bays(run, 1)) {
    const zoneStart = Math.max(bayStart + SLIT_EDGE_MM, run.lo);
    const zoneEnd = Math.min(bayEnd - SLIT_EDGE_MM, run.hi);
    if (zoneEnd - zoneStart < style.slitWidth) continue;
    const slits = Math.max(1, Math.min(style.slits, Math.floor((zoneEnd - zoneStart) / (style.slitWidth + SLIT_PIER_MM))));
    for (let slit = 0; slit < slits; slit++) {
      if (kit.rng.chance(style.blank + SLIT_BLANK)) continue;
      const center = zoneStart + ((slit + 0.5) / slits) * (zoneEnd - zoneStart);
      const slitStart = Math.max(zoneStart, center - style.slitWidth / 2);
      const slitEnd = Math.min(zoneEnd, center + style.slitWidth / 2);
      if (slitEnd - slitStart < MIN_WINDOW_MM) continue;
      kit.cut(recess(run, slitStart, slitEnd, low + style.sill, high - style.head, depth));
      glassPane(kit, run, slitStart, slitEnd, low + style.sill, high - style.head, depth);
    }
  }
}

function eggStyle(kit, run, style, low, high) {
  for (const [base, top] of storyGroups(low, high, 1)) {
    for (const [bayStart, bayEnd] of bays(run, 1)) {
      const zoneStart = Math.max(bayStart + style.pier / 2, run.lo, EGG_EDGE_MM);
      const zoneEnd = Math.min(bayEnd - style.pier / 2, run.hi, run.length - EGG_EDGE_MM);
      const zoneLow = base + style.sill * EGG_SILL_SHARE;
      const zoneHigh = top - style.head * EGG_HEAD_SHARE;
      const cellWidth = (zoneEnd - zoneStart + MULLION_MM) / style.eggCols - MULLION_MM;
      const cellHeight = (zoneHigh - zoneLow + MULLION_MM) / style.eggRows - MULLION_MM;
      if (cellWidth < MIN_WINDOW_MM || cellHeight < EGG_MIN_HEIGHT_MM || kit.rng.chance(style.blank)) continue;
      const depth = Math.min(EGG_DEPTH_MM, cellHeight - 2 * HEAD_MIN_MM);
      for (let column = 0; column < style.eggCols; column++) {
        for (let row = 0; row < style.eggRows; row++) {
          const cellStart = zoneStart + column * (cellWidth + MULLION_MM);
          const cellLow = zoneLow + row * (cellHeight + MULLION_MM);
          kit.cut(recess(run, cellStart, cellStart + cellWidth, cellLow, cellLow + cellHeight, depth));
          glassPane(kit, run, cellStart, cellStart + cellWidth, cellLow, cellLow + cellHeight, depth);
        }
      }
    }
  }
}

function finsStyle(kit, run, style, low, high) {
  const depth = style.depth + FIN_EXTRA_MM;
  const panelLow = low + style.sill * FIN_SILL_SHARE;
  const panelHigh = high - style.head;
  glassPane(kit, run, run.lo, run.hi, panelLow, panelHigh, depth);
  const last = run.length - style.finWidth;
  const count = Math.max(1, Math.round(last / (style.finGap + style.finWidth)));
  // Fins are the wall left between cuts
  let gapStart = run.lo;
  for (let fin = 0; fin <= count; fin++) {
    const at = (last * fin) / count;
    if ((fin === 0 && run.lo > 0) || (fin === count && run.hi < run.length)) continue;
    if (at > Math.max(gapStart, 0)) kit.cut(recess(run, gapStart, at, panelLow, panelHigh, depth));
    gapStart = Math.max(gapStart, at + style.finWidth);
  }
  if (gapStart < Math.min(run.hi, run.length)) kit.cut(recess(run, gapStart, run.hi, panelLow, panelHigh, depth));
}

function loggiaStyle(kit, run, style, low, high) {
  for (const [base, top] of storyGroups(low, high, 1)) {
    for (const [bayStart, bayEnd] of bays(run, 1)) {
      const zoneStart = Math.max(bayStart + style.pier / 2, run.lo);
      const zoneEnd = Math.min(bayEnd - style.pier / 2, run.hi);
      if (zoneEnd - zoneStart < MIN_PANEL_MM || kit.rng.chance(style.blank)) continue;
      const floor = base + LOGGIA_FLOOR_MM;
      railRecess(kit, run, zoneStart, zoneEnd, floor, top - style.head, LOGGIA_DEPTH_MM, LOGGIA_PARAPET_MM, PARAPET_MM);
      glassPane(kit, run, zoneStart + LOGGIA_GLASS_EDGE_MM, zoneEnd - LOGGIA_GLASS_EDGE_MM, floor, top - style.head, LOGGIA_DEPTH_MM);
    }
  }
}

function octStyle(kit, run, style, low, high) {
  const total = style.depth + style.window;
  for (const [base, top] of storyGroups(low, high, style.group)) {
    for (const [bayStart, bayEnd] of bays(run, 1)) {
      const zoneStart = Math.max(bayStart + style.pier / 2, run.lo, OCT_EDGE_MM, total);
      const zoneEnd = Math.min(bayEnd - style.pier / 2, run.hi, run.length - Math.max(OCT_EDGE_MM, total));
      const apothem = Math.min(zoneEnd - zoneStart, top - base - style.sill - style.head) / 2 - OCT_SHRINK_MM;
      if (apothem < OCT_MIN_MM || kit.rng.chance(style.blank)) continue;
      const shape = octagon((zoneStart + zoneEnd) / 2, (base + style.sill + top - style.head) / 2, apothem);
      kit.cut(run.prismW(shape, -CUT_PAST_MM, total));
      kit.add('glass', run.prismW(shape, total - GLASS_FRONT_MM, total + GLASS_BACK_MM));
    }
  }
}

function blankStyle(kit, run, style, low, high) {
  for (let line = low + STORY_MM; line < high - 1; line += STORY_MM) groove(kit, run, line);
  for (const [base, top] of storyGroups(low, high, 1)) {
    for (const [bayStart, bayEnd] of bays(run, 1)) {
      if (!kit.rng.chance(style.punch)) continue;
      const zoneStart = Math.max(bayStart + PUNCH_EDGE_MM, run.lo, OCT_EDGE_MM);
      const zoneEnd = Math.min(bayEnd - PUNCH_EDGE_MM, run.hi, run.length - OCT_EDGE_MM) - PUNCH_WIDTH_MM;
      if (zoneEnd <= zoneStart) continue;
      const at = kit.rng.range(zoneStart, zoneEnd);
      const height = kit.rng.range(base + PUNCH_LOW_MM, top - PUNCH_HIGH_MM);
      kit.cut(recess(run, at, at + PUNCH_WIDTH_MM, height, height + PUNCH_HEIGHT_MM, PUNCH_DEPTH_MM));
      glassPane(kit, run, at, at + PUNCH_WIDTH_MM, height, height + PUNCH_HEIGHT_MM, PUNCH_DEPTH_MM);
    }
  }
}

const STYLES = {
  grid: gridStyle,
  strip: stripStyle,
  slit: slitStyle,
  egg: eggStyle,
  fins: finsStyle,
  loggia: loggiaStyle,
  oct: octStyle,
  blank: blankStyle,
};

const WRAP_STYLES = ['fins', 'loggia']; // styles that may wrap open corners

// Wall run with openings kept off both corners
function inner(run) {
  const kept = Object.create(run);
  kept.lo = run.inLo;
  kept.hi = run.inHi;
  return kept;
}

export function applyFacade(kit, run, style, low = 0, high = kit.H) {
  STYLES[style.type](kit, WRAP_STYLES.includes(style.type) ? run : inner(run), style, low, high);
  if (style.grooves && style.type !== 'blank' && style.type !== 'fins') {
    for (let line = low + STORY_MM; line < high - 1; line += STORY_MM * style.group) groove(kit, run, line);
  }
}

export function applyFacades(kit, style, low = 0, high = kit.H) {
  for (const run of kit.facades) applyFacade(kit, run, style, low, high);
}

// Sunken roof with a parapet
export function roofTray(kit, depth = TRAY_DEPTH_MM, wall = TRAY_WALL_MM) {
  kit.carve(kit.inset + wall, kit.H - depth, kit.H + CUT_PAST_MM);
}
