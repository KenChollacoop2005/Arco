import { STORY_MM } from '../config.js';
import { pyramid } from './kit.js';
import { INSET_BALCONY, BULGE_BALCONY, WRAP, PARAPET_MM, BALCONY_LIP_MM, balconyShape } from './profiles.js';

const BURY_MM = 0.2; // balcony root sunk into the wall
const JOIN_MM = 1; // overlap between a corner piece and its arms
const TIP_MM = 0.02; // half width of the corner corbel tip
const SEAT_MM = 0.02; // corner post sunk into what holds it
const BACK_MM = 6; // wall made solid again behind a balcony
const FRONT_MM = 0.1; // ground level infill starts inside the tray root
const TOE_MM = 0.4; // flat foot of a ground level corbel

// Flat foot of a ground level corbel, on the print bed
const toeAt = (base) => (base === 0 ? TOE_MM : 0);

// Tray section in (depth, height): 45 degree corbel, floor, parapet
function traySection(base, reach) {
  const { floor, top } = balconyShape(reach);
  const toe = toeAt(base);
  return [
    [BURY_MM, base],
    [-toe, base],
    [-reach, base + reach - toe],
    [-reach, base + top],
    [PARAPET_MM - reach, base + top],
    [PARAPET_MM - reach, base + floor],
    [BURY_MM, base + floor],
  ];
}

// Solid end wall, corbel cut at a depth
function endSection(base, reach, depth = reach) {
  const { top } = balconyShape(reach);
  const toe = toeAt(base);
  return [[BURY_MM, base], [-toe, base], [-depth, base + depth - toe], [-depth, base + top], [BURY_MM, base + top]];
}

// Parapet alone, its foot on the corner corbel
function parapetSection(base, reach) {
  const { top } = balconyShape(reach);
  return [[-reach, base + reach], [-reach, base + top], [PARAPET_MM - reach, base + top], [PARAPET_MM - reach, base + reach - PARAPET_MM]];
}

// Refills openings behind a balcony, 45 degree underside
function backing(kit, run, from, to, base, reach) {
  const high = base + balconyShape(reach).floor;
  // Box on the bed, sloped front higher up
  const section = base === 0
    ? [[FRONT_MM, 0], [BACK_MM, 0], [BACK_MM, high], [FRONT_MM, high]]
    : [[-BURY_MM, base + BURY_MM], [BACK_MM, base - BACK_MM], [BACK_MM, high], [-BURY_MM, high]];
  kit.add('concrete', run.prismU(section, from, to));
}

function straight(kit, run, side, base) {
  const reach = side.reach;
  const lip = side.kind === BULGE_BALCONY ? BALCONY_LIP_MM : 0;
  const from = lip;
  const to = run.length - lip;
  const sink = side.shift < 0 ? BURY_MM : 0;
  backing(kit, run, from - sink, to + sink, base, reach);
  if (side.kind === INSET_BALCONY) {
    // Piers close the ends
    kit.add('concrete', run.prismU(traySection(base, reach), from - BURY_MM, to + BURY_MM));
    return;
  }
  kit.add('concrete', run.prismU(traySection(base, reach), from, to));
  kit.add('concrete', run.prismU(endSection(base, reach), from, from + PARAPET_MM));
  kit.add('concrete', run.prismU(endSection(base, reach), to - PARAPET_MM, to));
  if (side.shift >= 0) return;
  // Roots sunk into the piers, inside the inset only
  const root = endSection(base, reach, -side.shift);
  kit.add('concrete', run.prismU(root, from - BURY_MM, from + PARAPET_MM));
  kit.add('concrete', run.prismU(root, to - PARAPET_MM, to + BURY_MM));
}

// Balcony along one side, round the corner, along the next
function wrapped(kit, first, second, side, base) {
  const reach = side.reach;
  const { floor, top } = balconyShape(reach);
  const start = side.pier - first.shift;
  const stop = second.length - start;
  backing(kit, first, start, first.length, base, reach);
  backing(kit, second, 0, stop, base, reach);
  kit.add('concrete', first.prismU(traySection(base, reach), start, first.length));
  kit.add('concrete', first.prismU(endSection(base, reach), start, start + PARAPET_MM));
  kit.add('concrete', second.prismU(traySection(base, reach), 0, stop));
  kit.add('concrete', second.prismU(endSection(base, reach), stop - PARAPET_MM, stop));
  // Corner corbel: a pyramid on its tip at the body corner
  const [cornerX, cornerY] = first.point(first.length, 0, 0);
  kit.add('concrete', pyramid(cornerX, cornerY, base, base + floor, TIP_MM, reach));
  const inner = reach - PARAPET_MM;
  // Arms overlap past the inner corner
  kit.add('concrete', first.prismU(parapetSection(base, reach), first.length - JOIN_MM, first.length + inner + JOIN_MM));
  kit.add('concrete', second.prismU(parapetSection(base, reach), -inner - JOIN_MM, JOIN_MM));
  kit.add('concrete', first.box(first.length + inner - SEAT_MM, first.length + reach, base + floor - SEAT_MM, base + top, -inner + SEAT_MM, -reach));
}

// Balconies of every profiled side, added after the recipe
export function addBalconies(kit) {
  if (!kit.profile) return;
  const wallOf = (index) => kit.walls.find((run) => run.side === index);
  kit.profile.forEach((side, index) => {
    if (side.reach <= 0 || side.wrapped) return;
    const run = wallOf(index);
    if (!run) return;
    for (const story of side.levels) {
      const base = story * STORY_MM;
      if (side.kind === WRAP) wrapped(kit, run, wallOf((index + 1) & 3), side, base);
      else straight(kit, run, side, base);
    }
  });
}
