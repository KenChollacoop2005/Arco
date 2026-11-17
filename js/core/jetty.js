import { CELL_MM } from '../config.js';
import { zoneRun } from './kit.js';
import { recess, glassPane } from './facade.js';
import { JETTY_BRACE_RAKE } from './profiles.js';

const BACK_MM = 6; // wall made solid again behind a jetty
const SINK_MM = 0.2; // brace head sunk behind the jetty front
const BURY_MM = 0.2; // brace foot sunk into the wall
const JOIN_MM = 1; // brace head overlap into the jetty
const BRACE_WIDE_MM = 2.4; // raking brace thickness
const BRACE_END_MM = 1.2; // brace distance from the jetty end
const ARCH_PITCH_MM = 6.5; // target spacing of corbel arches
const BRACKET_MM = 2; // bracket thickness between arches
const ARCH_DROP_MM = 0.4; // arch crown below the jetty floor
const WEB_MM = 1.4; // corbel left between an arch and the wall
const CUT_OVER_MM = 1; // arch cut overshoot past the corbel
const SILL_MM = 2.5; // ribbon window above the jetty floor
const HEAD_MM = 3.5; // ribbon window below the jetty top
const WINDOW_END_MM = 2; // ribbon window distance from the jetty end
const WINDOW_MIN_MM = 4; // shortest ribbon window worth cutting
const RIBBON_DEEP_MM = 1.2; // ribbon window recess depth

// Upper wall pushed out on a 45 degree corbel
function body(kit, face, jetty) {
  const { out, start } = jetty;
  const inner = out + BACK_MM;
  kit.add('concrete', face.prismU([[0, start], [0, kit.H], [inner, kit.H], [inner, start - inner]], 0, face.length));
}

// Raking braces under the corbel, one more than the cells
function braces(kit, face, jetty) {
  const { out, start } = jetty;
  const foot = out + BURY_MM;
  const section = [[SINK_MM, start + JOIN_MM], [SINK_MM, start], [foot, start - JETTY_BRACE_RAKE * (foot - SINK_MM)], [foot, start + JOIN_MM]];
  const count = Math.round(face.length / CELL_MM) + 1;
  const step = (face.length - 2 * BRACE_END_MM - BRACE_WIDE_MM) / (count - 1);
  for (let index = 0; index < count; index++) {
    const from = BRACE_END_MM + index * step;
    kit.add('concrete', face.prismU(section, from, from + BRACE_WIDE_MM));
  }
}

// Pointed arches cut through the corbel, brackets between
function arches(kit, face, jetty) {
  const { out, start } = jetty;
  const count = Math.max(1, Math.round((face.length - BRACKET_MM) / ARCH_PITCH_MM));
  const pitch = (face.length - BRACKET_MM) / count;
  const half = (pitch - BRACKET_MM) / 2;
  const crown = start - ARCH_DROP_MM;
  const low = start - out - CUT_OVER_MM;
  for (let index = 0; index < count; index++) {
    const middle = BRACKET_MM + half + index * pitch;
    const outline = [[middle - half, low], [middle + half, low], [middle + half, crown - half], [middle, crown], [middle - half, crown - half]];
    kit.cut(face.prismW(outline, -CUT_OVER_MM, out - WEB_MM));
  }
}

// One ribbon window in the jetty front
function ribbon(kit, face, jetty) {
  const low = jetty.start + SILL_MM;
  const high = kit.H - HEAD_MM;
  const from = WINDOW_END_MM;
  const to = face.length - WINDOW_END_MM;
  if (high - low < WINDOW_MIN_MM || to - from < WINDOW_MIN_MM) return;
  kit.cut(recess(face, from, to, low, high, RIBBON_DEEP_MM));
  glassPane(kit, face, from, to, low, high, RIBBON_DEEP_MM);
}

// Jetties of every profiled side, added after the recipe
export function addJetties(kit) {
  if (!kit.profile) return;
  kit.profile.forEach((side, index) => {
    if (!side.jetty) return;
    const run = kit.walls.find((wall) => wall.side === index);
    if (!run) return;
    const face = zoneRun(run, { pier: side.pier, shift: side.jetty.out });
    body(kit, face, side.jetty);
    if (side.jetty.support === 'brace') braces(kit, face, side.jetty);
    if (side.jetty.support === 'arch') arches(kit, face, side.jetty);
    ribbon(kit, face, side.jetty);
  });
}
