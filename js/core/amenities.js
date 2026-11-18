import { STORY_MM } from '../config.js';
import { box, prismX, prismY, cyl, pyramid, octagon } from './kit.js';
import { makeStyle, applyFacades } from './facade.js';

const SINK_MM = 0.25; // parts sunk into what holds them
const SHOP_SILL_MM = 3; // shopfront sill
const SHOP_HEAD_MM = 6.5; // shopfront sign band
const SIGN_MM = [6, 2.6, 0.5, 0.25, 5.5]; // sign width, height, out from the face, into it, top below the story line
const CAP_SIGN_MM = [5, 2.4, 0.8, 6]; // cap sign width, height, thickness, bottom
const GYM_LOUVRE_MM = [3, 1.2, 2.4]; // gym louvre grooves, depth, spacing
const CROSS_MM = [3.5, 1.2, 1.4]; // facade cross half length, half width, depth
const CLOCK_MM = [3, 1.6]; // school clock recess apothem and depth
const ARCH_DOOR_MM = [4, 9, 4.5, 2]; // bathhouse door half width, springing, crown rise, depth
const PORCH_MM = [5, 14, 2.4]; // library porch half width, height, depth
const HATCH_MM = [8, 3, 1.6]; // canteen serving hatch sill and head below the top, depth
const MARQUEE_MM = [14, 5, 0.6]; // arcade marquee width, height, out from the face
const LANTERN_SIGN_MM = [1.2, 3]; // noodle bar lantern radius and drop
const POLE_MM = [0.9, 7, 1.2]; // barber pole radius, height, band
const DOOR_MM = [8, 11, 2.2, 1.6]; // roller door half width, height, depth, rib height
const DOOR_RIB_MM = 1.3; // roller door rib depth
const TOP_BAND_MM = 9; // plain band under the top for a detail
const BAND_DROP_MM = 0.5; // details sit this far under the band middle, clear of the top edge
const DOOR_CLEAR_MM = 2; // plain wall over a roller door
const PAGODA_MM = [8, 3, 6, 2.6]; // shrine base half, base height, body half, roof rise per tier
const SLIDE_MM = [4, 8, 2.2]; // playground slide half width, top, tread
const BARS_MM = [0.9, 9, 6]; // climbing frame post half, height, spacing
const TEA_MM = [1.2, 9, 3]; // teahouse post half, eave height, roof flare
const TEA_EDGE_MM = 1.4; // teahouse roof edge thickness
const TEA_SPAN_MM = 13; // most room between teahouse posts
const LOOKOUT_MM = [4, 6.5, 1.6, 4]; // lookout post half, deck thickness, rail thickness, rail height

// Facade style per amenity, or the shopfront
const FRONTS = {
  gym: 'strip', clinic: 'grid', school: 'grid', bathhouse: 'slit', foodstall: 'shop', laundromat: 'oct', library: 'fins',
  arcade: 'blank', barber: 'shop', pharmacy: 'shop', workshop: 'blank', courier: 'blank', canteen: 'strip',
};

// Small sign on the first outward wall, render only
function wallSign(kit) {
  const run = kit.facades[0];
  if (!run) return;
  const [wide, tall, out, into, below] = SIGN_MM;
  const middle = run.length / 2;
  const top = STORY_MM - below;
  kit.add('signSocial', run.box(middle - wide / 2, middle + wide / 2, top - tall, top, -out, into));
}

// Sign plate on a cap, kept inside the cell, render only
function capSign(kit) {
  const [wide, tall, thick, bottom] = CAP_SIGN_MM;
  const middle = kit.W / 2;
  kit.add('signSocial', box(middle - wide / 2, kit.clear, bottom, middle + wide / 2, kit.clear + thick, bottom + tall));
}

// Plain wall each kind keeps for its detail: a band under the top, or up to a door head
const TOP_BAND = ['gym', 'clinic', 'pharmacy', 'school', 'canteen'];
const DOOR_HEADS = { workshop: () => Math.min(DOOR_MM[1], STORY_MM - 3), courier: () => Math.min(DOOR_MM[1], STORY_MM - 3), bathhouse: () => ARCH_DOOR_MM[1] + ARCH_DOOR_MM[2], library: () => PORCH_MM[1] };

// Shopfront on the ground story or a seeded style, kept off the detail's plain wall
function front(kit, kind) {
  const low = DOOR_HEADS[kind] ? DOOR_HEADS[kind]() + DOOR_CLEAR_MM : 0;
  const high = TOP_BAND.includes(kind) ? kit.H - TOP_BAND_MM : kit.H;
  if (FRONTS[kind] === 'shop') {
    const style = makeStyle(kit.styleRng, 'strip');
    style.sill = SHOP_SILL_MM;
    style.head = SHOP_HEAD_MM;
    style.blank = 0;
    style.grooves = false;
    applyFacades(kit, style, 0, Math.min(STORY_MM, high));
    if (high - STORY_MM >= STORY_MM / 2) applyFacades(kit, makeStyle(kit.styleRng), STORY_MM, high);
    return;
  }
  if (high - low >= STORY_MM / 2) applyFacades(kit, makeStyle(kit.styleRng, FRONTS[kind]), low, high);
}

// A recess cut into the first outward wall from an outline in (along, height)
const recessIn = (kit, run, outline, depth, group = 'concrete') => kit.cut(run.prismW(outline, -1, depth), group);
const rect = (from, to, low, high) => [[from, low], [to, low], [to, high], [from, high]];

// One detail per kind on the outward wall: recesses cut in, fittings outside are render only
const FACE_DETAILS = {
  gym(kit, run, top) {
    const [grooves, depth, pitch] = GYM_LOUVRE_MM;
    for (let at = 0; at < grooves; at++) kit.cut(run.box(2, run.length - 2, top - 3 - at * pitch, top - 3 - at * pitch + 0.9, -1, depth));
  },
  clinic(kit, run, top) {
    const [long, half, depth] = CROSS_MM;
    const middle = run.length / 2;
    const level = top - TOP_BAND_MM / 2 - BAND_DROP_MM;
    recessIn(kit, run, rect(middle - long, middle + long, level - half, level + half), depth);
    recessIn(kit, run, rect(middle - half, middle + half, level - long, level + long), depth);
  },
  pharmacy(kit, run, top) {
    const [long, half, depth] = CROSS_MM;
    const middle = run.length - long * 0.6 - 3;
    const level = top - TOP_BAND_MM / 2 - BAND_DROP_MM;
    recessIn(kit, run, rect(middle - long * 0.6, middle + long * 0.6, level - half, level + half), depth);
    recessIn(kit, run, rect(middle - half, middle + half, level - long * 0.6, level + long * 0.6), depth);
  },
  school(kit, run, top) {
    const [apothem, depth] = CLOCK_MM;
    recessIn(kit, run, octagon(run.length / 2, top - TOP_BAND_MM / 2 - BAND_DROP_MM, apothem), depth);
  },
  bathhouse(kit, run) {
    const [half, spring, rise, depth] = ARCH_DOOR_MM;
    const middle = run.length / 2;
    recessIn(kit, run, [[middle - half, -1], [middle + half, -1], [middle + half, spring], [middle, spring + rise], [middle - half, spring]], depth);
  },
  library(kit, run) {
    const [half, tall, depth] = PORCH_MM;
    const middle = run.length / 2;
    recessIn(kit, run, rect(middle - half, middle + half, -1, tall), depth);
  },
  canteen(kit, run, top) {
    const [low, high, depth] = HATCH_MM;
    recessIn(kit, run, rect(3, run.length - 3, top - low, top - high), depth);
  },
  arcade(kit, run) {
    const [wide, tall, out] = MARQUEE_MM;
    const middle = run.length / 2;
    kit.add('signSocial', run.box(middle - wide / 2, middle + wide / 2, 4, 4 + tall, -out, SINK_MM));
  },
  barber(kit, run) {
    const [radius, tall, band] = POLE_MM;
    const at = run.point(run.length - 3, 0, -radius - 0.4);
    for (let level = 3; level + band <= 3 + tall; level += band * 2) {
      kit.add('signSocial', cyl(at[0], at[1], level, level + band, radius, radius, 8));
      kit.add('glass', cyl(at[0], at[1], level + band, level + band * 2, radius, radius, 8));
    }
  },
  foodstall(kit, run) {
    const [half, drop] = LANTERN_SIGN_MM;
    for (const along of [3, run.length - 3]) {
      const at = run.point(along, 0, -half - 0.4);
      kit.add('signSocial', cyl(at[0], at[1], STORY_MM - 6 - drop, STORY_MM - 6, half, half, 8));
    }
  },
  laundromat() {},
  workshop(kit, run) {
    rollerDoor(kit, run);
  },
  courier(kit, run) {
    rollerDoor(kit, run);
  },
};

// A roller door with ribs, cut into the ground story
function rollerDoor(kit, run) {
  const [half, tall, deep, rib] = DOOR_MM;
  const middle = run.length / 2;
  const top = Math.min(tall, STORY_MM - 3);
  kit.cut(run.box(middle - half, middle + half, -1, top, -1, deep));
  for (let at = rib; at + rib < top - 0.5; at += rib * 2) kit.add('dark', run.box(middle - half, middle + half, at, at + rib, deep - DOOR_RIB_MM, deep + SINK_MM));
}

// A building amenity: shopfront or styled body, its own detail on the outward wall, and a sign
function building(kind) {
  return (kit) => {
    kit.slab('concrete', kit.inset, 0, kit.H);
    front(kit, kind);
    const run = kit.facades[0];
    if (run) FACE_DETAILS[kind](kit, run, kit.H);
    wallSign(kit);
  };
}

// Caps: shrine, rooftop playground, teahouse and lookout
const CAPS = {
  shrine(kit) {
    const [x, y] = kit.cellCenters()[0];
    const [base, baseTall, body, rise] = PAGODA_MM;
    kit.add('concrete', box(x - base, y - base, 0, x + base, y + base, baseTall));
    let level = baseTall;
    for (let tier = 0; tier < 2 && level + 3 + rise <= kit.H; tier++) {
      const half = body - tier * 1.6;
      kit.add('wood', box(x - half + 1.5, y - half + 1.5, level - SINK_MM, x + half - 1.5, y + half - 1.5, level + 3));
      kit.add('dark', pyramid(x, y, level + 3 - SINK_MM, level + 3 + rise, half - 1.5 + rise, half - 1.5));
      level += 3 + rise;
    }
    capSign(kit);
  },
  playground(kit) {
    kit.slab('paintTeal', kit.clear, 0, 1.4);
    const [x, y] = kit.cellCenters()[0];
    const [half, top, tread] = SLIDE_MM;
    // Platform on a block, slide down at 45 degrees on its side
    kit.add('steel', box(x - 6, y - half, 1.4 - SINK_MM, x - 6 + tread * 2, y + half, top));
    kit.add('paintRose', prismY([[x - 6 + tread * 2 - SINK_MM, top], [x - 6 + tread * 2 - SINK_MM, 1.4 - SINK_MM], [x - 6 + tread * 2 + top - 1.4, 1.4 - SINK_MM]], y - half + 1, y + half - 1));
    const [post, tall, gap] = BARS_MM;
    for (const side of [-gap / 2, gap / 2]) kit.add('steel', box(x + 6 - post, y + side - post, 1.4 - SINK_MM, x + 6 + post, y + side + post, tall));
    for (let level = 3; level < tall; level += 3) kit.add('steel', box(x + 6 - post, y - gap / 2, level - 0.6, x + 6 + post, y + gap / 2, level + 0.6));
    capSign(kit);
  },
  teahouse(kit) {
    kit.slab('wood', kit.clear, 0, 1.6);
    const [post, eave, flare] = TEA_MM;
    const low = kit.clear + flare;
    const highX = kit.W - kit.clear - flare;
    const highY = kit.D - kit.clear - flare;
    // Posts along the long side keep every roof bridge short
    const count = Math.max(1, Math.ceil((highX - low - post * 2) / TEA_SPAN_MM));
    for (let step = 0; step <= count; step++) {
      const cornerX = low + ((highX - low - post * 2) * step) / count;
      for (const cornerY of [low, highY - post * 2]) kit.add('wood', box(cornerX, cornerY, 1.6 - SINK_MM, cornerX + post * 2, cornerY + post * 2, eave));
    }
    // Roof widens at 45 degrees to its eaves along the long sides, a thick edge at the tips
    const edge = TEA_EDGE_MM;
    kit.add('dark', prismX([[low, eave - SINK_MM], [highY, eave - SINK_MM], [highY + flare, eave + flare], [highY + flare, eave + flare + edge], [low - flare, eave + flare + edge], [low - flare, eave + flare]], low, highX));
    capSign(kit);
  },
  lookout(kit) {
    const [x, y] = kit.cellCenters()[0];
    const [post, deck, rail, railTall] = LOOKOUT_MM;
    const top = kit.H - railTall;
    const half = Math.min(kit.W, kit.D) / 2 - kit.clear;
    kit.add('concrete', box(x - post, y - post, 0, x + post, y + post, top - deck));
    // A 45 degree corbel carries a deck that reaches the cell edges
    kit.add('concrete', pyramid(x, y, top - deck - (half - post), top - deck + SINK_MM, post, half));
    kit.add('concrete', box(kit.clear, kit.clear, top - deck, kit.W - kit.clear, kit.D - kit.clear, top));
    kit.add('steel', box(kit.clear, kit.clear, top - SINK_MM, kit.W - kit.clear, kit.clear + rail, kit.H));
    kit.add('steel', box(kit.clear, kit.D - kit.clear - rail, top - SINK_MM, kit.W - kit.clear, kit.D - kit.clear, kit.H));
    kit.add('steel', box(kit.clear, kit.clear, top - SINK_MM, kit.clear + rail, kit.D - kit.clear, kit.H));
    capSign(kit);
  },
};

export const AMENITY_KINDS = ['gym', 'clinic', 'school', 'shrine', 'bathhouse', 'foodstall', 'laundromat', 'library', 'arcade', 'playground', 'teahouse', 'barber', 'pharmacy', 'workshop', 'courier', 'canteen', 'lookout'];
export const AMENITY_CAPS = Object.keys(CAPS);
export const AMENITY_RECIPES = Object.fromEntries(AMENITY_KINDS.map((kind) => [kind, CAPS[kind] || building(kind)]));
