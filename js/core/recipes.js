import { CELL_MM, STORY_MM, DOCK_LIP_MM, DOCK_HEAD_MM } from '../config.js';
import { isDocked, hasPump, endCode, END_CAP, END_STEP, openSides } from './catalog.js';
import { box, prismX, prismY, prismZ, cyl, pyramid, octagon, createKit } from './kit.js';
import { makeStyle, applyFacade, applyFacades, recess, railRecess, glassPane, groove, roofTray } from './facade.js';
import { addBalconies } from './balcony.js';
import { addJetties } from './jetty.js';
import { PIECE_RECIPES, turbineForm, solarForm } from './pieces.js';
import { AMENITY_RECIPES } from './amenities.js';

const SINK_MM = 0.25; // parts sunk into what holds them
const CUT_OVER_MM = 1; // cut overshoot past a face
const SAW_REACH_MM = CELL_MM; // saw cut reaches past any bulge
const THIN_MM = 1.6; // parapets and thin walls
const DECK_MM = 3; // thin floor slabs
const CURB_MM = 4; // low bases under roof parts
const PAVE_MM = 2.5; // paving and soil tray floors
const SOIL_TOP_MM = 5.5; // soil level in planters
const PLANTER_TOP_MM = 7; // planter wall height
const BALCONY_TOP_MM = 8.5; // balcony parapet height
const TERRACE_TOP_MM = 6; // terrace parapet height
const HATCH_HALF_MM = 4; // roof hatch half width
const ROOF_DEPTH_MM = 2.5; // sunken roof depth
const PILOTIS_SLAB_MM = 6; // slab over pilotis columns
const COLUMN_HALF_MM = [6.2, 7]; // pilotis column half width range
const ROUND_COLUMN_EXTRA_MM = 2.5; // round column radius over the half width
const TRANSFER_LINE_MM = 6; // transfer slab pour line height
const TRANSFER_BAND_MM = 8; // transfer slab beam band start
const BUTTRESS_HALF_MM = 5.5; // buttress half thickness
const BUTTRESS_HEAD_MM = 6; // buttress width at the top
const BUTTRESS_TOE_MM = 5; // buttress height at the toe
const SAW_PITCH_MM = 12.4; // sawtooth roof spacing
const SAW_DROP_MM = 5; // sawtooth roof depth
const SHOP_SILL_MM = 3; // shopfront sill
const SHOP_HEAD_MM = 6.5; // shopfront sign band
const HAUNCH_MM = 4; // bridge underside chamfer
const STAIR_SLITS = 3; // stair windows per bay
const STAIR_STEP_MM = 5.5; // stair window spacing
const STAIR_RISE_MM = 5; // stair window rise
const STAIR_SLIT_MM = [3, 6.5, 2.4]; // stair window width, height, depth
const GALLERY_DEPTH_MM = 5.2; // deck access gallery depth
const GALLERY_FLOOR_MM = 2.5; // gallery floor above story line
const GALLERY_HEAD_MM = 4.5; // gallery beam depth
const GALLERY_RAIL_MM = 4; // gallery parapet height
const POST_HALF_MM = 1.2; // gallery post half width
const RAMP_TOP_MM = 13; // ramp high end
const RAMP_LIP_MM = 1.5; // ramp low end
const RAMP_CURB_MM = 2.5; // ramp curb above the slope
const STEP_RISE_MM = 3; // stair riser
const STEP_COUNT_PER_CELL = 5; // steps across one cell
const BENCH_MM = [10, 2.8, 2.5]; // bench length, depth, height
const BUSH_MM = [2, 3.6]; // bush radius range
const BUSH_NECK = 0.4; // bush base as share of radius
const BUSH_RISE = 0.8; // bush lower cone height share
const BUSH_TIP = 0.3; // bush top as share of radius
const BUSH_SIDES = 7; // bush facets
const TRUNK_MM = 1.1; // tree trunk radius
const TRUNK_SIDES = 6; // tree trunk facets
const TREE_MM = [5, 8]; // tree trunk height range
const PLANT_GROUPS = ['plant', 'plantDark', 'plantLight'];
const TARP_GROUPS = ['tarpTerracotta', 'tarpMustard', 'tarpTeal'];
const METAL_GROUPS = ['steel', 'rust', 'steel', 'hazard'];
const TANK_SIDES = 20; // tank and tower facets
const TANK_ROOF_MM = 5; // tank cone roof height
const TANK_TIP = 0.25; // cone roof top as share of radius
const LADDER_MM = 1.3; // ladder strip width
const PLANT_ROOF_MM = 7; // plant room roof gear zone
const UNIT_MM = [5, 4, 4.5]; // roof unit half x, half y, height
const FAN_MM = [3, 0.7]; // fan radius and height
const VENT_MM = [2.4, 4]; // vent pipe radius range
const COWL_MM = [2, 2, 2.6]; // cowl flare, flare height, cap height
const SKY_HALF_MM = [8, 3]; // skylight half width low and high
const SKY_RISE_MM = 6; // skylight height
const MAST_HALF_MM = [3.5, 1.2]; // antenna mast half width range
const DRUM_MM = [2.6, 4.5]; // antenna drum apothem and length
const LAMP_MM = [0.9, 1.5]; // mast lamp radius and height
const SPOUT_HALF_MM = 1.6; // spout channel half width
const SPOUT_DEPTH_MM = 2.4; // spout channel depth
const SPOUT_WATER_MM = 0.8; // water thickness in channel
const SPOUT_DROP_MM = [10, 0.7]; // channel length: least, most as share
const RIB_PITCH_MM = 3.1; // textured panel rib spacing
const RIB_MM = 0.9; // textured panel rib depth
const TILE_MM = [5.2, 1.4]; // checker panel size and depth
const BAND_PITCH_MM = 3.2; // hammered band spacing
const RUSTIC_MM = [6.25, 1]; // podium groove spacing and depth
const DOOR_MM = [11, 16, 4, 7]; // podium door width, height, depth, offset
const STACK_BASE_MM = 5; // smokestack base block height
const STACK_RADIUS_MM = [7.5, 5]; // smokestack radius low and high
const STACK_BANDS_MM = [16, 13, 10, 7, 3.5]; // stripe heights below the top
const FLUE_MM = [3, 1.6]; // flue depth and rim wall
const BRICK_HALF_MM = [7, 5.2, 6.2]; // chimney half width low, high, cap
const BRICK_CAP_MM = [5, 3]; // chimney cap start and collar below top
const COOL_SHAPE = [[0, 1], [0.3, 0.78], [0.62, 0.62], [1, 0.74]]; // height share, radius share
const COOL_SKIRT_MM = 2.5; // cooling tower dark base band
const COOL_BOWL_MM = 6; // cooling tower bowl depth
const PIPE_MM = [2.2, 3]; // pipe apothem range
const FLANGE_MM = [0.9, 1.4]; // flange extra radius and width
const FLANGE_PITCH_MM = 11; // flange spacing
const PIPE_GAP_MM = 1.8; // gap between pipes
const RISER_MM = [1.8, 15]; // riser radius and height
const FARM_TANK_MM = [7, 8.8]; // tank farm radius range
const GANTRY_MM = [12, 11, 2.2]; // gantry width, height, chord
const TRUSS_PITCH_MM = 11; // truss panel spacing
const TRUSS_BASE_MM = 8; // truss opening width
const TRUSS_SHIFT_MM = 5.5; // upside down opening offset
const BELT_MM = [7, 1, 1.4, 2]; // belt width, height, rail width, rail height
const SOLAR_MM = [7, 4.5, 0.7, 8.5]; // panel run, rise, skin, pitch
const TURBINE_MM = [2, 1.5, 6.5, 0.7, 1.3]; // mast low, mast high, blade radius, thin half, wide half
const ROTOR_MM = [16, 1.5, 14.5, 4, 1.4]; // blade start, blade end, low arm, high arm, arm height
const BED_HALF_MM = 8; // farm bed half width
const BED_WALL_MM = 1.4; // farm bed wall
const BED_MM = [5.5, 4.5, 5.2, 2.2]; // bed top, soil floor, soil top, crop height
const CROP_ROWS = 3; // crop rows per bed
const GLASS_WALL_MM = 7; // greenhouse wall height
const GLASS_PITCH = 0.5; // greenhouse roof rise per half span
const FRAME_MM = 1.4; // greenhouse frame width
const FRAME_PITCH_MM = 7.4; // greenhouse frame spacing
const STALL_MM = [2, 7, 12, 1.8, 19]; // floor, counter, eave, tarp thickness, post spacing
const TIER_MM = [7, 11]; // planted terrace tier half width and top
const IVY_MM = [0.8, 5]; // ivy thickness and drop
const SPAN_DECK_MM = 5.5; // bridge deck, deep enough for sockets
const SPAN_RAIL_MM = 10.5; // bridge walkway parapet height
const SEAT_MM = [16, 6.5, 1.5]; // gantry seat length, height, side margin
const END_STEPS = 3; // steps down at a walkway end
const END_TREAD_MM = 1.6; // walkway end step tread, clear of the end socket
const GANTRY_STOP_MM = [2.2, 3]; // gantry end stop length and height over the belt
const POOL_MM = [5, 0.9]; // penthouse pool half width and depth
const GLAZING_MM = [2.5, 3]; // penthouse window sill and head
const SHACK_DEPTH_MM = 5.5; // bay the shacks stand in
const SHACK_FOOT_MM = 2.5; // floor band under the shacks
const SHACK_HEAD_MM = 1.5; // roof band over the shacks
const SHACK_JITTER_MM = 1.5; // shack floor height shift
const SHACK_LAP_MM = 0.6; // shack top sunk into the next
const SHACK_FRONT_MM = [0.4, 3.1]; // shack front behind the face
const SHACK_STEP_MM = 0.7; // least front step between neighbours
const SHACK_EDGE_MM = 1.6; // shacks kept off the bay ends
const SHACK_WINDOW_MM = [2.6, 5, 3, 5.5, 1.4]; // width range, height range, depth
const SHACK_FRAME_MM = 1.6; // wall around a shack window
const SHACK_PANE_MM = [0.3, 0.25, 0.2]; // pane edge gap, front, buried
const SHACK_MIN_WINDOW_MM = [2, 2.4]; // smallest window width and height
const SHACK_GROUPS = ['concrete', 'paintTeal', 'paintRose', 'paintOchre', 'tinGrey', 'tinBlue', 'rust', 'wood', 'dark']; // faded paints, tin and rust; colour only
const SHACK_ROOF_GROUPS = ['tinGrey', 'tinBlue', 'rust']; // pitched shack roofs
const SHACK_COLUMNS_MAX = 3; // most shack columns across one side
const SHACK_COLUMN_MIN_MM = 6; // narrowest shack column
const SHACK_NARROW = 0.85; // narrowest shack as a share of that
const SHACK_COLUMN_MOST_MM = 18; // widest shack column
const SHACK_ROWS_LEAST = 3; // fewest shacks up a column where they fit
const SHACK_MOST_SIDE = 12; // most shacks on one side
const SHACK_ROW_MM = [6.5, 11]; // shack height range
const SHACK_ROOFS = [['flat', 1], ['lean', 2], ['pitched', 1.5]]; // roofs on a short column's top shack, weighted
const SHACK_SHORT_CHANCE = 0.45; // chance a column stops short with open bay above
const SHACK_ROOF_ROOM_MM = 3; // room kept under the bay's sloped head for a roof
const SHACK_LEAN_MM = 1.4; // lean-to drop at the front
const SHACK_PITCH_MM = 1.5; // pitched roof rise
const SHACK_TURN_CHANCE = 0.3; // chance an open-ended shack looks along the bay
const SHACK_SIDE_GAP_MM = 1.2; // gap that leaves a shack end open
const SHACK_SIDE_WINDOW_MM = [4, 1.2]; // least shack depth for a side window, its frame
const SHACK_PAIR_MM = 8; // least width for two front windows
const SHACK_PAIR_CHANCE = 0.3; // chance of two small front windows
const SHACK_BALCONY_MM = [1.8, 1.2, 1.2, 1.8]; // balcony reach, slab, rail thickness, rail height
const SHACK_BALCONY_CHANCE = 0.35; // chance a shack above the first row has a balcony
const SHACK_FACE_GAP_MM = 0.3; // balconies kept this far inside the face and shack ends
const FLARE_DEPTH_MM = [3.5, 5]; // flared base inset range
const FLARE_DEG = [35, 45]; // flare slope from vertical
const FLARE_BAND_MM = 14; // upright band above the flare
const FLARE_FOOT_MM = 3; // upright foot under a long taper
const TAPER_CHANCE = 0.5; // chance a tall flare runs full height
const STRUT_BASE_MM = 3; // strut base plate
const STRUT_HEAD_MM = 5; // strut head plate
const BUNDLE_MM = [2.6, 3, 2]; // pipe offset, pipe radius, core radius
const BUNDLE_SIDES = 10; // bundle pipe facets
const BUNDLE_CHANCE = 0.5; // chance a strut is a pipe bundle
const STRUT_CORE_SIDES = 8; // strut core and collar facets
const COLLAR_MM = [3.6, 6.6, 3, 1.2]; // collar radius low, high, cone, band
const COLLAR_ROOM_MM = [2, 1]; // collar kept off the base and capital
const BRACE_MM = [8, 1, 0.8, 1.6]; // brace width, end margin, shoe lip, shoe height
const PIER_MM = [3, 4, 2]; // pier base plate, head plate, plinth step
const PIER_HALF_MM = [5.5, 6.5]; // pier shaft half width range, wide enough for sockets
const PUMP_BAY_MM = [5, 2, 5, 20]; // pump room bay half width, floor, depth, top
const PUMP_DRUM_MM = [2, 9]; // pump drum radius and height
const SMALL_PUMP_MM = [4.5, 11, 1, 2]; // small pump body radius, height, cap, shift off center
const PUMP_MOTOR_MM = [2.6, 3, 6]; // pump motor half length, half width, height
const TANK_PUMP_MM = [1.9, 2, 7, 1]; // tank pump radius, corner offset, height, cap
const PLANT_PUMP_MM = [2.3, 2.8, 5.5, 1]; // plant room pump radius, corner offset, height, cap
const MAIN_MM = [7, 1.6, 1.2, 2.5]; // water main radius, collar flare, collar band, base plate
const MAIN_SIDES = 18; // water main facets
const TRANSFORMER_MM = [5.5, 4.5, 10, 1]; // transformer half length, half width, height, top band
const COOLING_FIN_MM = [1.3, 1.6, 3]; // fin thickness, reach, spacing
const BUSHING_MM = [1, 4, 3]; // insulator radius, height, spacing
const MAIN_GROUPS = ['steel', 'steel', 'water', 'rust']; // water main pipe colors

const lerp = (low, high, share) => low + (high - low) * share;
// Profile across the long axis, swept along it
const sweep = (alongX, poly, from, to) => (alongX ? prismX(poly, from, to) : prismY(poly, from, to));
// Profile along the long axis, swept across it
const cross = (alongX, poly, from, to) => (alongX ? prismY(poly, from, to) : prismX(poly, from, to));
const span = (alongX, a0, a1, b0, b1, z0, z1) => (alongX ? box(a0, b0, z0, a1, b1, z1) : box(b0, a0, z0, b1, a1, z1));

function axes(kit) {
  const alongX = kit.W >= kit.D;
  return { alongX, length: alongX ? kit.W : kit.D, width: alongX ? kit.D : kit.W };
}

// End blocks of a docked bridge, where its rails root
function dockHeads(kit, alongX, length, width) {
  const [headLength, headTop] = DOCK_HEAD_MM;
  for (const from of [kit.inset, length - kit.inset - headLength]) {
    kit.add('concrete', span(alongX, from, from + headLength, kit.clear, width - kit.clear, 0, headTop));
  }
}

// Raises every shape, for parts that hang on dock lips
function lift(ops, rise) {
  for (const { shape } of ops) {
    if (shape.kind === 'box') {
      shape.min[2] += rise;
      shape.max[2] += rise;
    } else if (shape.kind === 'cyl') {
      shape.from += rise;
      shape.to += rise;
    } else {
      shape.origin = [shape.origin[0], shape.origin[1], shape.origin[2] + rise];
    }
  }
}

function mass(kit, top = kit.H) {
  kit.slab('concrete', kit.inset, 0, top);
}

function tray(kit, top, floor = DECK_MM, wall = THIN_MM) {
  kit.slab('concrete', kit.clear, 0, top);
  kit.carve(kit.clear + wall, floor, top + 1);
  return kit.clear + wall;
}

// Tray wall cut away on open sides; a corner goes only when both sides open
function openTray(kit, floor, top, wall = THIN_MM) {
  const open = openSides(kit.variant);
  const rects = kit.rects(kit.clear);
  if (!open || rects.length !== 1) return;
  const [minX, minY, maxX, maxY] = rects[0];
  const isOpen = (side) => ((open >> side) & 1) === 1;
  const lowY = isOpen(3) ? minY - CUT_OVER_MM : minY + wall;
  const highY = isOpen(1) ? maxY + CUT_OVER_MM : maxY - wall;
  const lowX = isOpen(2) ? minX - CUT_OVER_MM : minX + wall;
  const highX = isOpen(0) ? maxX + CUT_OVER_MM : maxX - wall;
  const cuts = [
    box(maxX - wall - SINK_MM, lowY, floor, maxX + CUT_OVER_MM, highY, top + 1),
    box(lowX, maxY - wall - SINK_MM, floor, highX, maxY + CUT_OVER_MM, top + 1),
    box(minX - CUT_OVER_MM, lowY, floor, minX + wall + SINK_MM, highY, top + 1),
    box(lowX, minY - CUT_OVER_MM, floor, highX, minY + wall + SINK_MM, top + 1),
  ];
  cuts.forEach((shape, side) => {
    if (isOpen(side)) kit.cut(shape, 'concrete');
  });
}

function bush(kit, centerX, centerY, base, radius, group) {
  const middle = base + radius * BUSH_RISE;
  kit.add(group, cyl(centerX, centerY, base - SINK_MM, middle, radius * BUSH_NECK, radius, BUSH_SIDES));
  kit.add(group, cyl(centerX, centerY, middle, middle + radius, radius, radius * BUSH_TIP, BUSH_SIDES));
}

function tree(kit, centerX, centerY, base) {
  const trunk = kit.rng.range(TREE_MM[0], TREE_MM[1]);
  kit.add('wood', cyl(centerX, centerY, base - SINK_MM, base + trunk, TRUNK_MM, TRUNK_MM, TRUNK_SIDES));
  bush(kit, centerX, centerY, base + trunk, BUSH_MM[1], kit.rng.pick(PLANT_GROUPS));
}

// Bushes and trees inside each cell
function plantCells(kit, base, reach, treeChance) {
  for (const [centerX, centerY] of kit.cellCenters()) {
    if (kit.rng.chance(treeChance)) {
      tree(kit, centerX, centerY, base);
      continue;
    }
    const count = kit.rng.int(1, 3);
    for (let plant = 0; plant < count; plant++) {
      const radius = kit.rng.range(BUSH_MM[0], BUSH_MM[1]);
      const room = Math.max(0, reach - radius);
      bush(kit, centerX + kit.rng.range(-room, room), centerY + kit.rng.range(-room, room), base, radius, kit.rng.pick(PLANT_GROUPS));
    }
  }
}

function soilBed(kit, margin, floor, top) {
  kit.slab('soil', margin, floor, top);
}

// Round stack from bands of group, z and radius
function stack(kit, centerX, centerY, sides, bands) {
  for (const [group, fromZ, toZ, radiusLow, radiusHigh] of bands) {
    kit.add(group, cyl(centerX, centerY, fromZ, toZ, radiusLow, radiusHigh, sides));
  }
}

function roofGear(kit) {
  roofTray(kit, ROOF_DEPTH_MM);
  const [centerX, centerY] = kit.rng.pick(kit.cellCenters());
  const floor = kit.H - ROOF_DEPTH_MM - SINK_MM;
  kit.add('concrete', box(centerX - HATCH_HALF_MM, centerY - HATCH_HALF_MM, floor, centerX + HATCH_HALF_MM, centerY + HATCH_HALF_MM, kit.H));
}

// Facades stop under a sunken roof
const facadeTop = (kit) => (kit.roof ? kit.H - ROOF_DEPTH_MM : kit.H);

function styled(kit, types, low = 0, high = kit.H) {
  const style = makeStyle(kit.styleRng, types ? kit.styleRng.pick(types) : undefined);
  applyFacades(kit, style, low, high);
  return style;
}

// Crowded shacks in a bay: columns of small boxes
function shackSide(kit, run) {
  const { rng } = kit;
  const depth = SHACK_DEPTH_MM;
  const low = SHACK_FOOT_MM;
  const high = kit.H - SHACK_HEAD_MM;
  kit.cut(recess(run, run.lo, run.hi, low, high, depth));
  const from = depth + SHACK_EDGE_MM;
  const room = run.length - 2 * from;
  // Columns across the bay, each at least the narrowest shack
  const fewest = Math.ceil(room / SHACK_COLUMN_MOST_MM);
  const columns = Math.max(1, Math.min(SHACK_COLUMNS_MAX, Math.floor(room / SHACK_COLUMN_MIN_MM), rng.int(fewest, SHACK_COLUMNS_MAX)));
  const cuts = [from];
  for (let column = 1; column < columns; column++) cuts.push(from + (room * column) / columns + rng.range(-SHACK_JITTER_MM, SHACK_JITTER_MM));
  cuts.push(from + room);
  const rowsCap = Math.max(2, Math.floor(SHACK_MOST_SIDE / columns));
  const [windowLow, windowHigh, headLow, headHigh, windowDepth] = SHACK_WINDOW_MM;
  const [paneEdge, paneFront, paneBack] = SHACK_PANE_MM;
  const frame = SHACK_FRAME_MM;
  for (let column = 0; column < columns; column++) {
    const [left, right] = [cuts[column], cuts[column + 1]];
    // Short columns stop under the sloped head for a roof
    const short = rng.chance(SHACK_SHORT_CHANCE) && high - depth - SHACK_ROOF_ROOM_MM - low >= SHACK_ROW_MM[0];
    const ceiling = short ? high - depth - SHACK_ROOF_ROOM_MM : high;
    // Floors up the column, each shack its own height
    const floors = [low];
    const rowsMost = rng.int(Math.min(SHACK_ROWS_LEAST, rowsCap), rowsCap);
    while (floors.length < rowsMost && floors[floors.length - 1] + SHACK_ROW_MM[0] * 2 <= ceiling) floors.push(floors[floors.length - 1] + rng.range(SHACK_ROW_MM[0], SHACK_ROW_MM[1]));
    if (floors.length > 1 && floors[floors.length - 1] > ceiling - SHACK_ROW_MM[0]) floors.pop();
    if (!short && floors.length < 2 && high - low >= SHACK_ROW_MM[0] * 2) floors.push(low + (high - low) / 2);
    let lastFront = -SHACK_STEP_MM;
    floors.forEach((base, row) => {
      const last = row === floors.length - 1;
      const roof = last && short ? rng.weighted(SHACK_ROOFS) : 'flat';
      const top = !last ? floors[row + 1] + SHACK_LAP_MM : short ? Math.min(ceiling, base + rng.range(SHACK_ROW_MM[0], SHACK_ROW_MM[1])) : high;
      let front = rng.range(SHACK_FRONT_MM[0], SHACK_FRONT_MM[1]);
      if (Math.abs(front - lastFront) < SHACK_STEP_MM) front = lastFront + SHACK_STEP_MM > SHACK_FRONT_MM[1] ? lastFront - SHACK_STEP_MM : lastFront + SHACK_STEP_MM;
      lastFront = front;
      const reach = depth - front;
      const span = right - left;
      const width = rng.range(Math.min(span, SHACK_COLUMN_MIN_MM) * SHACK_NARROW, span);
      const start = left + rng.range(0, span - width);
      const end = start + width;
      const group = rng.pick(SHACK_GROUPS);
      const lean = roof === 'lean' ? SHACK_LEAN_MM : 0;
      // 45 degree underside, flat on the bay floor for the first row
      const section = row === 0
        ? [[depth + SINK_MM, base - SINK_MM], [front, base - SINK_MM], [front, top - lean], [depth + SINK_MM, top]]
        : [[depth + SINK_MM, base], [depth, base], [front, base + reach], [front, top - lean], [depth + SINK_MM, top]];
      kit.ops.push({ group, cut: false, shape: run.prismU(section, start, end), part: 'shack' });
      if (roof === 'pitched') kit.add(rng.pick(SHACK_ROOF_GROUPS), run.prismU([[front, top - SINK_MM], [(front + depth) / 2, top + SHACK_PITCH_MM], [depth + SINK_MM, top - SINK_MM]], start, end));
      const floor = row === 0 ? base : base + reach;
      const sill = floor + frame;
      const head = Math.min(sill + rng.range(headLow, headHigh), top - lean - frame);
      // Turned shacks look along the bay from an open end
      const openStart = start - left > SHACK_SIDE_GAP_MM;
      const openEnd = right - end > SHACK_SIDE_GAP_MM;
      if ((openStart || openEnd) && reach >= SHACK_SIDE_WINDOW_MM[0] && rng.chance(SHACK_TURN_CHANCE) && head - sill >= SHACK_MIN_WINDOW_MM[1]) {
        const [deepest, sideFrame] = SHACK_SIDE_WINDOW_MM;
        const face = openEnd ? end : start;
        const inward = openEnd ? -1 : 1;
        const [from, to] = [Math.min(face + inward * windowDepth, face - inward), Math.max(face + inward * windowDepth, face - inward)];
        kit.ops.push({ group, cut: true, shape: run.prismU([[front + sideFrame, sill], [Math.min(depth - sideFrame, front + deepest), sill], [Math.min(depth - sideFrame, front + deepest), head], [front + sideFrame, head]], from, to), part: 'side window' });
        return;
      }
      // Front windows: one of a seeded size, or two small ones side by side
      const pairs = width - 2 * frame >= SHACK_PAIR_MM && rng.chance(SHACK_PAIR_CHANCE) ? 2 : 1;
      const slot = (width - (pairs + 1) * frame) / pairs;
      const opening = Math.min(rng.range(windowLow, windowHigh), slot);
      if (opening < SHACK_MIN_WINDOW_MM[0] || head - sill < SHACK_MIN_WINDOW_MM[1]) return;
      const back = front + windowDepth;
      for (let pane = 0; pane < pairs; pane++) {
        const at = start + frame + pane * (slot + frame) + rng.range(0, slot - opening);
        kit.ops.push({ group, cut: true, shape: run.prismU([[front - CUT_OVER_MM, sill], [back, sill], [back, head - windowDepth], [front - CUT_OVER_MM, head + CUT_OVER_MM]], at, at + opening), part: 'window' });
        // Glass only where the pane sits in concrete
        if (group === 'concrete') kit.add('glass', run.box(at + paneEdge, at + opening - paneEdge, sill, head - windowDepth, back - paneFront, back + paneBack));
      }
      // A tiny balcony under the window, inside the face
      const [ledge, slab, rail, railTall] = SHACK_BALCONY_MM;
      const out = Math.min(ledge, front - SHACK_FACE_GAP_MM);
      if (out >= rail + SHACK_FACE_GAP_MM && row > 0 && rng.chance(SHACK_BALCONY_CHANCE)) {
        const level = sill - SINK_MM;
        kit.add('steel', run.prismU([[front + SINK_MM, level - out - SINK_MM], [front - out, level], [front - out, level + slab], [front + SINK_MM, level + slab]], start + SHACK_FACE_GAP_MM, end - SHACK_FACE_GAP_MM));
        kit.add('steel', run.prismU([[front - out, level + slab - SINK_MM], [front - out + rail, level + slab - SINK_MM], [front - out + rail, level + slab + railTall], [front - out, level + slab + railTall]], start + SHACK_FACE_GAP_MM, end - SHACK_FACE_GAP_MM));
      }
    });
  }
}

// Tilted panel rack, the first solar form
function solarRack(kit) {
  const { alongX, length, width } = axes(kit);
  const clear = kit.clear;
  const [run, rise, skin, pitch] = SOLAR_MM;
  kit.slab('concrete', clear, 0, PAVE_MM);
  for (let at = clear + 1; at + run < length - clear; at += pitch) {
    kit.add('concrete', cross(alongX, [[at, PAVE_MM - SINK_MM], [at + run, PAVE_MM - SINK_MM], [at + run, PAVE_MM + rise], [at, PAVE_MM]], clear + 1, width - clear - 1));
    kit.add('solar', cross(alongX, [[at, PAVE_MM], [at + run, PAVE_MM + rise], [at + run, PAVE_MM + rise + skin], [at, PAVE_MM + skin]], clear + 1, width - clear - 1));
  }
}

// Vertical axis rotor, the first turbine form
function verticalRotor(kit) {
  const centerX = kit.W / 2;
  const centerY = kit.D / 2;
  const [mastLow, mastHigh, bladeRadius, bladeHalf, armHalf] = TURBINE_MM;
  const [bladeStart, bladeEnd, lowArm, highArm, armHeight] = ROTOR_MM;
  kit.slab('concrete', kit.clear, 0, CURB_MM);
  kit.add('steel', cyl(centerX, centerY, CURB_MM, kit.H - 1, mastLow, mastHigh, 10));
  kit.add('hazard', cyl(centerX, centerY, kit.H - 1, kit.H, mastHigh, mastHigh, 10));
  const turn = kit.rng.range(0, Math.PI * 2);
  for (let blade = 0; blade < 3; blade++) {
    const angle = turn + (blade * Math.PI * 2) / 3;
    const radial = [Math.cos(angle), Math.sin(angle)];
    const side = [-radial[1], radial[0]];
    const quad = (from, to, half) => [
      [centerX + radial[0] * from - side[0] * half, centerY + radial[1] * from - side[1] * half],
      [centerX + radial[0] * to - side[0] * half, centerY + radial[1] * to - side[1] * half],
      [centerX + radial[0] * to + side[0] * half, centerY + radial[1] * to + side[1] * half],
      [centerX + radial[0] * from + side[0] * half, centerY + radial[1] * from + side[1] * half],
    ];
    kit.add('rotor', prismZ(quad(bladeRadius - bladeHalf, bladeRadius + bladeHalf, armHalf), kit.H - bladeStart, kit.H - bladeEnd));
    kit.add('rotor', prismZ(quad(0, bladeRadius, bladeHalf), kit.H - lowArm, kit.H - lowArm + armHeight));
    kit.add('rotor', prismZ(quad(0, bladeRadius, bladeHalf), kit.H - highArm, kit.H - highArm + armHeight));
  }
  kit.anchors.spin = [centerX, centerY];
}

const RECIPES = {
  core(kit) {
    mass(kit);
    styled(kit, ['slit', 'blank', 'oct'], 0, facadeTop(kit));
    if (kit.roof) roofGear(kit);
  },

  pilotis(kit) {
    const slabBase = kit.H - PILOTIS_SLAB_MM;
    kit.slab('concrete', kit.inset, slabBase, kit.H);
    const round = kit.rng.chance(0.5);
    const half = CELL_MM / 2 - kit.inset;
    const column = kit.rng.range(COLUMN_HALF_MM[0], COLUMN_HALF_MM[1]);
    const capBase = slabBase - (half - column);
    const radius = column + ROUND_COLUMN_EXTRA_MM;
    kit.railBase = slabBase;
    for (const [centerX, centerY] of kit.cellCenters()) {
      if (round) {
        kit.add('concrete', cyl(centerX, centerY, 0, capBase + SINK_MM, radius));
        kit.add('concrete', cyl(centerX, centerY, capBase, slabBase, radius, half));
      } else {
        kit.add('concrete', box(centerX - column, centerY - column, 0, centerX + column, centerY + column, capBase + SINK_MM));
        kit.add('concrete', pyramid(centerX, centerY, capBase, slabBase, column, half));
      }
    }
  },

  transfer(kit) {
    mass(kit);
    for (const run of kit.facades) groove(kit, run, TRANSFER_LINE_MM);
    styled(kit, ['fins'], TRANSFER_BAND_MM, kit.H);
  },

  strut(kit) {
    const clear = kit.clear;
    const middle = CELL_MM / 2;
    const half = middle - clear;
    const slabBase = kit.H - STRUT_HEAD_MM;
    kit.slab('concrete', clear, 0, STRUT_BASE_MM);
    // The head reaches the cell face under the bulge it props
    kit.add('concrete', box(kit.inset, clear, slabBase, kit.W - clear, kit.D - clear, kit.H));
    const foot = STRUT_BASE_MM - SINK_MM;
    if (kit.rng.chance(BUNDLE_CHANCE)) {
      const [offset, radius, core] = BUNDLE_MM;
      const reach = offset + radius;
      const capBase = slabBase - (half - reach);
      kit.add('concrete', pyramid(middle, middle, capBase, slabBase, reach, half));
      kit.add('concrete', cyl(middle, middle, foot, capBase + SINK_MM, core, core, STRUT_CORE_SIDES));
      for (const [signX, signY] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        kit.add(kit.rng.pick(METAL_GROUPS), cyl(middle + signX * offset, middle + signY * offset, foot, capBase + SINK_MM, radius, radius, BUNDLE_SIDES));
      }
      const [collarLow, collarHigh, cone, band] = COLLAR_MM;
      const collar = lerp(STRUT_BASE_MM + COLLAR_ROOM_MM[0], capBase - cone - band - COLLAR_ROOM_MM[1], kit.rng.next());
      stack(kit, middle, middle, STRUT_CORE_SIDES, [
        ['steel', collar, collar + cone, collarLow, collarHigh],
        ['steel', collar + cone, collar + cone + band, collarHigh, collarHigh],
      ]);
      return;
    }
    // Raking brace, its head toward the building
    const [width, margin, lip, shoe] = BRACE_MM;
    const capBase = slabBase - (half - width / 2);
    const near = clear + margin;
    const far = CELL_MM - clear - margin - width;
    kit.add('concrete', pyramid(middle, middle, capBase, slabBase, width / 2, half));
    kit.add('concrete', prismY([[far, foot], [far + width, foot], [near + width, slabBase + SINK_MM], [near, slabBase + SINK_MM]], middle - width / 2, middle + width / 2));
    kit.add('steel', box(far - lip, middle - width / 2 - lip, foot, far + width + lip, middle + width / 2 + lip, STRUT_BASE_MM + shoe));
  },

  pier(kit) {
    const [basePlate, headPlate, step] = PIER_MM;
    const middle = CELL_MM / 2;
    const half = middle - kit.clear;
    const shaft = kit.rng.range(PIER_HALF_MM[0], PIER_HALF_MM[1]);
    const slabBase = kit.H - headPlate;
    // 45 degree capital under the head plate
    const capBase = slabBase - (half - shaft);
    kit.slab('concrete', kit.clear, 0, basePlate);
    kit.add('concrete', pyramid(middle, middle, basePlate - SINK_MM, basePlate + step, shaft + step, shaft));
    kit.add('concrete', box(middle - shaft, middle - shaft, basePlate, middle + shaft, middle + shaft, capBase + SINK_MM));
    kit.add('concrete', pyramid(middle, middle, capBase, slabBase, shaft, half));
    kit.slab('concrete', kit.clear, slabBase, kit.H);
  },

  buttress(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, DECK_MM);
    // The tall end reaches its cell face, against the wall it leans on
    const back = kit.inset;
    const profile = [
      [back, 0],
      [length - clear, 0],
      [length - clear, BUTTRESS_TOE_MM],
      [back + BUTTRESS_HEAD_MM, kit.H],
      [back, kit.H],
    ];
    kit.add('concrete', cross(alongX, profile, width / 2 - BUTTRESS_HALF_MM, width / 2 + BUTTRESS_HALF_MM));
  },

  housing(kit) {
    mass(kit);
    styled(kit, null, 0, facadeTop(kit));
    if (kit.roof) roofGear(kit);
  },

  studio(kit) {
    mass(kit);
    const style = makeStyle(kit.styleRng, kit.styleRng.pick(['strip', 'loggia', 'grid', 'oct']));
    if (kit.stories === 2) style.group = 2;
    applyFacades(kit, style, 0, kit.roof ? kit.H - SAW_DROP_MM - THIN_MM : kit.H);
    if (!kit.roof) return;
    const teeth = Math.round((kit.W - kit.inset * 2) / SAW_PITCH_MM);
    const pitch = (kit.W - kit.inset * 2) / teeth;
    for (let tooth = 0; tooth < teeth; tooth++) {
      const start = kit.inset + tooth * pitch;
      const end = start + pitch;
      const past = tooth === teeth - 1 ? end + SAW_REACH_MM : end;
      kit.cut(prismY([[start, kit.H + 1], [past, kit.H + 1], [past, kit.H - SAW_DROP_MM], [end, kit.H - SAW_DROP_MM], [start, kit.H]], -SAW_REACH_MM, kit.D + SAW_REACH_MM));
    }
  },

  hall(kit) {
    mass(kit);
    styled(kit, ['fins', 'strip', 'egg'], 0, facadeTop(kit));
    if (kit.roof) roofGear(kit);
  },

  penthouse(kit) {
    mass(kit);
    const front = makeStyle(kit.styleRng, 'strip');
    front.sill = GLAZING_MM[0];
    front.head = GLAZING_MM[1];
    front.blank = 0;
    front.grooves = false;
    applyFacades(kit, front, 0, facadeTop(kit));
    if (!kit.roof) return;
    roofTray(kit, ROOF_DEPTH_MM);
    const floor = kit.H - ROOF_DEPTH_MM - SINK_MM;
    const centers = kit.cellCenters();
    const [hatchX, hatchY] = centers[0];
    const [poolX, poolY] = centers[centers.length - 1];
    const [poolHalf, poolDepth] = POOL_MM;
    kit.add('concrete', box(hatchX - HATCH_HALF_MM, hatchY - HATCH_HALF_MM, floor, hatchX + HATCH_HALF_MM, hatchY + HATCH_HALF_MM, kit.H));
    kit.add('water', box(poolX - poolHalf, poolY - poolHalf, floor, poolX + poolHalf, poolY + poolHalf, floor + SINK_MM + poolDepth));
  },

  shacks(kit) {
    mass(kit);
    for (const run of kit.facades) shackSide(kit, run);
  },

  flared(kit) {
    mass(kit);
    const depth = kit.rng.range(FLARE_DEPTH_MM[0], FLARE_DEPTH_MM[1]);
    const top = kit.H - FLARE_BAND_MM;
    const steep = depth / Math.tan((kit.rng.range(FLARE_DEG[0], FLARE_DEG[1]) * Math.PI) / 180);
    const rise = kit.stories > 1 && kit.rng.chance(TAPER_CHANCE) ? top - FLARE_FOOT_MM : steep;
    const start = top - rise;
    for (const run of kit.facades) {
      kit.cut(run.prismU([[-CUT_OVER_MM, -CUT_OVER_MM], [depth, -CUT_OVER_MM], [depth, start], [-CUT_OVER_MM, start + (rise * (depth + CUT_OVER_MM)) / depth]], run.lo, run.hi));
    }
    styled(kit, ['strip', 'grid', 'slit'], top, facadeTop(kit));
    if (kit.roof) roofGear(kit);
  },

  shop(kit) {
    mass(kit);
    const front = makeStyle(kit.styleRng, 'strip');
    front.sill = SHOP_SILL_MM;
    front.head = SHOP_HEAD_MM;
    front.blank = 0;
    front.grooves = false;
    applyFacades(kit, front, 0, STORY_MM);
    if (kit.stories > 1) styled(kit, null, STORY_MM, kit.H);
  },

  walkway(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    const docked = isDocked(kit.variant);
    // Docked ends reach the cell face
    const end = docked ? kit.inset : clear;
    if (docked) kit.add('concrete', span(alongX, end, length - end, clear, width - clear, 0, SPAN_DECK_MM));
    else kit.slab('concrete', clear, 0, SPAN_DECK_MM);
    kit.add('concrete', span(alongX, end, length - end, clear, clear + THIN_MM, 0, SPAN_RAIL_MM));
    kit.add('concrete', span(alongX, end, length - end, width - clear - THIN_MM, width - clear, 0, SPAN_RAIL_MM));
    if (docked) dockHeads(kit, alongX, length, width);
    // Ends: wall in open air, steps down to a roof
    for (const [index, face] of [[0, end], [1, length - end]]) {
      const inward = index === 0 ? 1 : -1;
      const reach = (far) => [Math.min(face - inward, face + inward * far), Math.max(face - inward, face + inward * far)];
      if (endCode(kit.variant, index) === END_CAP) {
        const [from, to] = [Math.min(face, face + inward * THIN_MM), Math.max(face, face + inward * THIN_MM)];
        kit.add('concrete', span(alongX, from, to, clear, width - clear, 0, SPAN_RAIL_MM));
      }
      if (endCode(kit.variant, index) !== END_STEP) continue;
      for (let step = 1; step <= END_STEPS; step++) {
        const [from, to] = reach((END_STEPS + 1 - step) * END_TREAD_MM);
        kit.cut(span(alongX, from, to, clear + THIN_MM, width - clear - THIN_MM, SPAN_DECK_MM - (step * SPAN_DECK_MM) / (END_STEPS + 1), SPAN_DECK_MM + 1));
      }
    }
  },

  bridge(kit) {
    mass(kit);
    styled(kit, ['strip', 'grid', 'slit']);
    for (const run of kit.facades) {
      kit.cut(run.prismU([[-1, -1], [HAUNCH_MM, -1], [-1, HAUNCH_MM]], run.lo, run.hi));
    }
  },

  stair(kit) {
    mass(kit);
    const [slitWidth, slitHeight, slitDepth] = STAIR_SLIT_MM;
    for (const run of kit.facades) {
      for (let story = 0; story < kit.stories; story++) {
        for (let bay = 0; bay < run.cells; bay++) {
          for (let slit = 0; slit < STAIR_SLITS; slit++) {
            const start = run.bayStart(bay) + STAIR_RISE_MM + slit * STAIR_STEP_MM;
            if (start < run.inLo || start + slitWidth > run.inHi) continue;
            const low = story * STORY_MM + STAIR_RISE_MM + slit * STAIR_RISE_MM;
            kit.cut(recess(run, start, start + slitWidth, low, low + slitHeight, slitDepth));
            glassPane(kit, run, start, start + slitWidth, low, low + slitHeight, slitDepth);
          }
        }
      }
    }
    if (kit.roof) roofGear(kit);
  },

  ramp(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    // The high end reaches its cell face, against the building it climbs to
    const top = length - kit.inset;
    const slope = (lift) => [[clear, 0], [top, 0], [top, RAMP_TOP_MM + lift], [clear, RAMP_LIP_MM + lift]];
    kit.add('concrete', cross(alongX, slope(0), clear, width - clear));
    kit.add('concrete', cross(alongX, slope(RAMP_CURB_MM), clear, clear + THIN_MM));
    kit.add('concrete', cross(alongX, slope(RAMP_CURB_MM), width - clear - THIN_MM, width - clear));
  },

  deck(kit) {
    mass(kit);
    for (const run of kit.facades) {
      for (let story = 0; story < kit.stories; story++) {
        const floor = story * STORY_MM + GALLERY_FLOOR_MM;
        const head = (story + 1) * STORY_MM - GALLERY_HEAD_MM;
        glassPane(kit, run, run.lo, run.hi, floor, head, GALLERY_DEPTH_MM);
        // Posts are the wall left between bays
        const stops = [run.lo - POST_HALF_MM];
        for (let post = 1; post < run.cells * 2; post++) stops.push(run.bayStart(0) + (post * CELL_MM) / 2);
        stops.push(run.hi + POST_HALF_MM);
        for (let bay = 0; bay + 1 < stops.length; bay++) {
          railRecess(kit, run, stops[bay] + POST_HALF_MM, stops[bay + 1] - POST_HALF_MM, floor, head, GALLERY_DEPTH_MM, GALLERY_RAIL_MM, THIN_MM);
        }
      }
    }
  },

  balcony(kit) {
    const inner = tray(kit, BALCONY_TOP_MM);
    openTray(kit, DECK_MM, BALCONY_TOP_MM);
    if (kit.rng.chance(0.5)) {
      kit.add('soil', box(inner, inner, DECK_MM, inner + CURB_MM, kit.D - inner, SOIL_TOP_MM));
      bush(kit, inner + CURB_MM / 2, kit.D / 2, SOIL_TOP_MM, BUSH_MM[0], kit.rng.pick(PLANT_GROUPS));
    }
  },

  terrace(kit) {
    const inner = tray(kit, TERRACE_TOP_MM);
    openTray(kit, DECK_MM, TERRACE_TOP_MM);
    const [benchLength, benchDepth, benchHeight] = BENCH_MM;
    kit.add('wood', box(inner + 1, inner, DECK_MM, inner + 1 + benchLength, inner + benchDepth, DECK_MM + benchHeight));
    if (kit.cells.length > 1 && kit.rng.chance(0.6)) {
      const [centerX, centerY] = kit.cellCenters()[kit.cells.length - 1];
      kit.add('soil', cyl(centerX, centerY, DECK_MM, DECK_MM + 1, CURB_MM, CURB_MM, BUSH_SIDES));
      tree(kit, centerX, centerY, DECK_MM + 1);
    }
  },

  patio(kit) {
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, PAVE_MM);
    const [minX, minY, maxX] = kit.rects(clear)[0];
    const [benchLength, benchDepth, benchHeight] = BENCH_MM;
    // Low wall only when that side faces out
    if (!((openSides(kit.variant) >> 3) & 1)) kit.add('concrete', box(minX, minY, 0, maxX, minY + THIN_MM, PLANTER_TOP_MM));
    kit.add('wood', box(minX + 2, minY + THIN_MM, PAVE_MM, minX + 2 + benchLength, minY + THIN_MM + benchDepth, PAVE_MM + benchHeight));
    const [centerX, centerY] = kit.cellCenters()[kit.cells.length - 1];
    kit.add('soil', cyl(centerX, centerY + 2, PAVE_MM, PAVE_MM + 1, CURB_MM, CURB_MM, BUSH_SIDES));
    tree(kit, centerX, centerY + 2, PAVE_MM + 1);
  },

  garden(kit) {
    const inner = tray(kit, PLANTER_TOP_MM, PAVE_MM);
    soilBed(kit, inner, PAVE_MM, SOIL_TOP_MM);
    plantCells(kit, SOIL_TOP_MM, CELL_MM / 2 - inner, 0.3);
  },

  tank(kit) {
    kit.slab('concrete', kit.clear, 0, DECK_MM);
    const radius = Math.min(kit.W, kit.D) / 2 - kit.clear - LADDER_MM;
    const group = kit.rng.pick(['steel', 'steel', 'rust']);
    const shoulder = kit.H - TANK_ROOF_MM - 1;
    stack(kit, kit.W / 2, kit.D / 2, TANK_SIDES, [
      [group, DECK_MM, shoulder, radius, radius],
      [group, shoulder, kit.H - 1, radius, radius * TANK_TIP],
      ['soot', kit.H - 1, kit.H, radius * TANK_TIP, radius * TANK_TIP],
    ]);
    kit.add('rust', box(kit.W / 2 - LADDER_MM / 2, kit.D / 2 - radius - LADDER_MM / 2, DECK_MM, kit.W / 2 + LADDER_MM / 2, kit.D / 2, shoulder));
  },

  plant(kit) {
    const top = kit.H - PLANT_ROOF_MM;
    kit.slab('concrete', kit.clear, 0, top);
    styled(kit, ['fins', 'slit', 'blank'], 0, top);
    const [halfX, halfY, height] = UNIT_MM;
    for (const [centerX, centerY] of kit.cellCenters()) {
      if (kit.rng.chance(0.7)) {
        kit.add('steel', box(centerX - halfX, centerY - halfY, top, centerX + halfX, centerY + halfY, top + height));
        kit.add('soot', cyl(centerX, centerY, top + height, top + height + FAN_MM[1], FAN_MM[0]));
      } else {
        kit.add('steel', cyl(centerX, centerY, top, top + height + 1, VENT_MM[0]));
      }
    }
    if (!hasPump(kit.variant)) return;
    // Pump in the free corner of the first cell
    const [radius, offset, pumpHeight, cap] = PLANT_PUMP_MM;
    const at = kit.clear + offset;
    kit.add('steel', cyl(at, at, top - SINK_MM, top + pumpHeight, radius, radius, 10));
    kit.add('hazard', cyl(at, at, top + pumpHeight, top + pumpHeight + cap, radius, radius, 10));
  },

  vent(kit) {
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    const [flare, flareHeight, capHeight] = COWL_MM;
    for (const [centerX, centerY] of kit.cellCenters()) {
      const count = kit.rng.int(1, 2);
      for (let pipe = 0; pipe < count; pipe++) {
        const radius = count === 1 ? kit.rng.range(VENT_MM[0], VENT_MM[1]) : VENT_MM[0];
        const shift = count === 1 ? 0 : (pipe * 2 - 1) * (VENT_MM[0] + 1);
        const neck = kit.rng.range(kit.H * 0.45, kit.H - flareHeight - capHeight);
        stack(kit, centerX + shift, centerY - shift * 0.4, 12, [
          ['steel', CURB_MM, neck, radius, radius],
          ['steel', neck, neck + flareHeight, radius, radius + flare],
          ['soot', neck + flareHeight, neck + flareHeight + capHeight, radius + flare, 0.8],
        ]);
      }
    }
  },

  skylight(kit) {
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    const domed = kit.rng.chance(0.4);
    for (const [centerX, centerY] of kit.cellCenters()) {
      if (domed) {
        stack(kit, centerX, centerY, 12, [
          ['pane', CURB_MM, CURB_MM + SKY_RISE_MM * 0.6, SKY_HALF_MM[0], SKY_HALF_MM[0] * 0.8],
          ['pane', CURB_MM + SKY_RISE_MM * 0.6, CURB_MM + SKY_RISE_MM, SKY_HALF_MM[0] * 0.8, SKY_HALF_MM[1]],
        ]);
      } else {
        kit.add('pane', pyramid(centerX, centerY, CURB_MM, CURB_MM + SKY_RISE_MM, SKY_HALF_MM[0], SKY_HALF_MM[1]));
      }
    }
  },

  antenna(kit) {
    const centerX = kit.W / 2;
    const centerY = kit.D / 2;
    const [drum, drumLength] = DRUM_MM;
    const mastTop = kit.H - LAMP_MM[1];
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    kit.add('steel', pyramid(centerX, centerY, CURB_MM, mastTop, MAST_HALF_MM[0], MAST_HALF_MM[1]));
    const drums = kit.rng.int(1, 2);
    for (let index = 0; index < drums; index++) {
      const height = lerp(CURB_MM + drum + 3, mastTop - drum - 6, kit.rng.next());
      const side = index === 0 ? 1 : -1;
      kit.add('concrete', prismX(octagon(centerY, height, drum), centerX, centerX + side * drumLength));
    }
    kit.add('hazard', cyl(centerX, centerY, mastTop, kit.H, LAMP_MM[0], LAMP_MM[0], 8));
  },

  brise(kit) {
    mass(kit);
    styled(kit, ['egg']);
  },

  fins(kit) {
    mass(kit);
    styled(kit, ['fins']);
  },

  spout(kit) {
    mass(kit);
    const style = makeStyle(kit.styleRng, kit.styleRng.pick(['blank']));
    const run = kit.facades.find((wall) => wall.length > SPOUT_HALF_MM * 6);
    // No small windows beside the channel
    for (const wall of kit.facades) applyFacade(kit, wall, wall === run ? { ...style, punch: 0 } : style);
    if (!run) return;
    const middle = run.length / 2;
    const mouth = kit.H - kit.rng.range(SPOUT_DROP_MM[0], kit.H * SPOUT_DROP_MM[1]);
    kit.cut(run.box(middle - SPOUT_HALF_MM, middle + SPOUT_HALF_MM, mouth, kit.H + 1, -1, SPOUT_DEPTH_MM));
    kit.add(
      'water',
      run.box(middle - SPOUT_HALF_MM, middle + SPOUT_HALF_MM, mouth, kit.H - SPOUT_WATER_MM, SPOUT_DEPTH_MM - SPOUT_WATER_MM, SPOUT_DEPTH_MM + SINK_MM)
    );
    kit.anchors.outlet.push([...run.point(middle, mouth, 0), run.normal[0], run.normal[1]]);
  },

  panel(kit) {
    mass(kit);
    const pattern = kit.styleRng.pick(['ribs', 'tiles', 'bands']);
    for (const run of kit.facades) {
      if (pattern === 'ribs') {
        for (let at = run.inLo; at <= run.inHi; at += RIB_PITCH_MM) {
          kit.cut(run.prismV([[at - RIB_MM, -SINK_MM], [at + RIB_MM, -SINK_MM], [at, RIB_MM]], -1, kit.H + 1));
        }
      } else if (pattern === 'tiles') {
        const [size, depth] = TILE_MM;
        for (let low = 3, row = 0; low + size < kit.H - 2; low += size + 2, row++) {
          for (let at = run.inLo + (row % 2) * (size / 2); at + size < run.inHi; at += size + 2) {
            if (kit.rng.chance(0.75)) kit.cut(recess(run, at, at + size, low, low + size, depth));
          }
        }
      } else {
        for (let line = BAND_PITCH_MM; line < kit.H - 1; line += BAND_PITCH_MM) groove(kit, run, line);
      }
    }
  },

  steps(kit) {
    const clear = kit.clear;
    const count = Math.round((kit.W / CELL_MM) * STEP_COUNT_PER_CELL);
    const tread = (kit.W - clear * 2) / count;
    const rise = Math.min(STEP_RISE_MM, (kit.H - RAMP_CURB_MM - 1) / count);
    // The top step reaches its cell face, against the building it climbs to
    const top = kit.W - kit.inset;
    for (let step = 0; step < count; step++) {
      kit.add('concrete', box(clear + step * tread, clear, 0, top, kit.D - clear, (step + 1) * rise));
    }
    kit.add('concrete', box(clear, clear, 0, top, clear + THIN_MM, count * rise + RAMP_CURB_MM));
  },

  planter(kit) {
    const inner = tray(kit, PLANTER_TOP_MM, PAVE_MM, THIN_MM + 0.4);
    soilBed(kit, inner, PAVE_MM, SOIL_TOP_MM);
    plantCells(kit, SOIL_TOP_MM, CELL_MM / 2 - inner, 0.5);
  },

  podium(kit) {
    mass(kit);
    const [pitch, depth] = RUSTIC_MM;
    const [doorWidth, doorHeight, doorDepth, doorOffset] = DOOR_MM;
    kit.facades.forEach((run, index) => {
      for (let line = pitch; line < kit.H - 1; line += pitch) groove(kit, run, line, depth);
      if (index !== 0) return;
      const start = run.bayStart(0) + doorOffset;
      kit.cut(recess(run, start, start + doorWidth, DECK_MM - 1, doorHeight, doorDepth));
      glassPane(kit, run, start, start + doorWidth, DECK_MM - 1, doorHeight, doorDepth);
    });
  },

  smokestack(kit) {
    const centerX = kit.W / 2;
    const centerY = kit.D / 2;
    const [radiusLow, radiusHigh] = STACK_RADIUS_MM;
    kit.slab('concrete', kit.clear, 0, STACK_BASE_MM);
    const heights = [STACK_BASE_MM, ...STACK_BANDS_MM.map((drop) => kit.H - drop), kit.H];
    const groups = ['concrete', 'hazard', 'concrete', 'hazard', 'concrete', 'soot'];
    const radiusAt = (height) => lerp(radiusLow, radiusHigh, (height - STACK_BASE_MM) / (kit.H - STACK_BASE_MM));
    stack(kit, centerX, centerY, TANK_SIDES, groups.map((group, band) => [group, heights[band], heights[band + 1], radiusAt(heights[band]), radiusAt(heights[band + 1])]));
    kit.cut(cyl(centerX, centerY, kit.H - FLUE_MM[0], kit.H + 1, radiusHigh - FLUE_MM[1], radiusHigh - FLUE_MM[1], TANK_SIDES), 'soot');
    kit.anchors.smoke.push([centerX, centerY, kit.H]);
  },

  pipes(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, PAVE_MM);
    let across = clear + 1;
    let last = null;
    while (true) {
      const apothem = kit.rng.range(PIPE_MM[0], PIPE_MM[1]);
      const outer = apothem + FLANGE_MM[0];
      if (across + outer * 2 > width - clear - 1) break;
      const center = across + outer;
      const axis = PAVE_MM + apothem - SINK_MM;
      kit.add(kit.rng.pick(METAL_GROUPS), sweep(alongX, octagon(center, axis, apothem), clear + 0.5, length - clear - 0.5));
      for (let at = clear + 3 + kit.rng.range(0, 4); at < length - clear - 3; at += FLANGE_PITCH_MM) {
        kit.add('steel', sweep(alongX, octagon(center, axis, outer), at, at + FLANGE_MM[1]));
      }
      last = [center, axis];
      across += outer * 2 + PIPE_GAP_MM;
    }
    if (last) {
      const end = length - clear - 0.5;
      const point = alongX ? [end, last[0], last[1], 1, 0] : [last[0], end, last[1], 0, 1];
      kit.anchors.outlet.push(point);
      const riser = alongX ? [clear + 4, last[0]] : [last[0], clear + 4];
      kit.add('hazard', cyl(riser[0], riser[1], PAVE_MM, RISER_MM[1], RISER_MM[0], RISER_MM[0], 8));
    }
  },

  tankfarm(kit) {
    const { alongX, length } = axes(kit);
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, PAVE_MM);
    for (const [centerX, centerY] of kit.cellCenters()) {
      const radius = kit.rng.range(FARM_TANK_MM[0], FARM_TANK_MM[1]);
      const shoulder = kit.rng.range(kit.H * 0.45, kit.H - TANK_ROOF_MM);
      const group = kit.rng.pick(['steel', 'rust', 'dark']);
      stack(kit, centerX, centerY, 14, [
        [group, PAVE_MM, shoulder, radius, radius],
        [group, shoulder, shoulder + TANK_ROOF_MM * 0.6, radius, radius * TANK_TIP],
      ]);
    }
    const axis = PAVE_MM + PIPE_MM[0] - SINK_MM;
    kit.add('hazard', sweep(alongX, octagon(clear + PIPE_MM[0] + 0.4, axis, PIPE_MM[0]), clear + 1, length - clear - 1));
  },

  gantry(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    const [beamWidth, beamHeight, chord] = GANTRY_MM;
    const near = width / 2 - beamWidth / 2;
    const far = width / 2 + beamWidth / 2;
    const docked = isDocked(kit.variant);
    const end = docked ? kit.inset : clear;
    kit.add('steel', span(alongX, end, length - end, near, far, 0, beamHeight));
    // Solid seats at both ends take the sockets
    const [seatLength, seatHeight, seatEdge] = SEAT_MM;
    for (const from of [clear, length - clear - seatLength]) {
      kit.add('concrete', span(alongX, from, from + seatLength, clear + seatEdge, width - clear - seatEdge, 0, seatHeight));
    }
    if (docked) dockHeads(kit, alongX, length, width);
    const trussEnd = length - clear - seatLength - chord;
    for (let at = clear + seatLength + chord; at + TRUSS_BASE_MM < trussEnd; at += TRUSS_PITCH_MM) {
      kit.cut(cross(alongX, [[at, chord], [at + TRUSS_BASE_MM, chord], [at + TRUSS_BASE_MM / 2, beamHeight - chord]], near - 1, far + 1), 'steel');
      const flipped = at + TRUSS_SHIFT_MM;
      if (flipped + TRUSS_BASE_MM > trussEnd) continue;
      kit.cut(cross(alongX, [[flipped, beamHeight - chord], [flipped + TRUSS_BASE_MM / 2, chord], [flipped + TRUSS_BASE_MM, beamHeight - chord]], near - 1, far + 1), 'steel');
    }
    const [beltWidth, beltHeight, railWidth, railHeight] = BELT_MM;
    kit.add('soot', span(alongX, end, length - end, width / 2 - beltWidth / 2, width / 2 + beltWidth / 2, beamHeight, beamHeight + beltHeight));
    kit.add('hazard', span(alongX, end, length - end, near, near + railWidth, beamHeight, beamHeight + railHeight));
    kit.add('hazard', span(alongX, end, length - end, far - railWidth, far, beamHeight, beamHeight + railHeight));
    // Ends: stop in open air, ramp down to a roof
    for (const [index, face] of [[0, clear], [1, length - clear]]) {
      const inward = index === 0 ? 1 : -1;
      const code = endCode(kit.variant, index);
      if (code === END_CAP) {
        const [from, to] = [Math.min(face, face + inward * GANTRY_STOP_MM[0]), Math.max(face, face + inward * GANTRY_STOP_MM[0])];
        kit.add('hazard', span(alongX, from, to, near, far, beamHeight - SINK_MM, beamHeight + beltHeight + GANTRY_STOP_MM[1]));
      }
      if (code === END_STEP) {
        const inner = face + inward * seatLength;
        kit.add('concrete', cross(alongX, [[face, seatHeight - SINK_MM], [inner, seatHeight - SINK_MM], [inner, beamHeight + beltHeight]].map(([along, z]) => [along, z]).sort((first, second) => first[0] - second[0] || first[1] - second[1]), near, far));
      }
    }
  },

  chimney(kit) {
    const centerX = kit.W / 2;
    const centerY = kit.D / 2;
    const [halfLow, halfHigh, halfCap] = BRICK_HALF_MM;
    const capBase = kit.H - BRICK_CAP_MM[0];
    const collar = kit.H - BRICK_CAP_MM[1];
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    kit.add('rust', pyramid(centerX, centerY, CURB_MM, capBase, halfLow, halfHigh));
    kit.add('concrete', pyramid(centerX, centerY, capBase, collar, halfHigh, halfCap));
    kit.add('concrete', box(centerX - halfCap, centerY - halfCap, collar, centerX + halfCap, centerY + halfCap, kit.H));
    const flue = halfCap - FLUE_MM[1] - 1;
    kit.cut(box(centerX - flue, centerY - flue, kit.H - FLUE_MM[0] + 0.5, centerX + flue, centerY + flue, kit.H + 1));
    kit.anchors.smoke.push([centerX, centerY, kit.H]);
  },

  cooling(kit) {
    const centerX = kit.W / 2;
    const centerY = kit.D / 2;
    const radius = Math.min(kit.W, kit.D) / 2 - kit.clear;
    const bands = [];
    for (let band = 0; band < COOL_SHAPE.length - 1; band++) {
      const [lowShare, lowRadius] = COOL_SHAPE[band];
      const [highShare, highRadius] = COOL_SHAPE[band + 1];
      bands.push(['concrete', lowShare * kit.H, highShare * kit.H, lowRadius * radius, highRadius * radius]);
    }
    const skirtRadius = lerp(bands[0][3], bands[0][4], COOL_SKIRT_MM / bands[0][2]);
    bands[0] = ['concrete', COOL_SKIRT_MM, bands[0][2], skirtRadius, bands[0][4]];
    bands.unshift(['dark', 0, COOL_SKIRT_MM, radius, skirtRadius]);
    stack(kit, centerX, centerY, TANK_SIDES, bands);
    const throat = COOL_SHAPE[2][1] * radius;
    const rim = COOL_SHAPE[3][1] * radius;
    const bowlBase = kit.H - COOL_BOWL_MM;
    const bowlLow = lerp(throat, rim, 1 - COOL_BOWL_MM / (kit.H * (1 - COOL_SHAPE[2][0]))) - THIN_MM - 0.4;
    kit.cut(cyl(centerX, centerY, bowlBase, kit.H + 1, bowlLow, rim - THIN_MM + (rim - THIN_MM - bowlLow) / COOL_BOWL_MM, TANK_SIDES));
    kit.anchors.smoke.push([centerX, centerY, kit.H]);
  },

  solar(kit) {
    solarForm(kit, solarRack);
  },

  turbine(kit) {
    turbineForm(kit, verticalRotor);
  },

  farm(kit) {
    kit.slab('concrete', kit.clear, 0, PAVE_MM);
    const [bedTop, soilFloor, soilTop, crop] = BED_MM;
    const inner = BED_HALF_MM - BED_WALL_MM;
    for (const [centerX, centerY] of kit.cellCenters()) {
      kit.add('wood', box(centerX - BED_HALF_MM, centerY - BED_HALF_MM, PAVE_MM, centerX + BED_HALF_MM, centerY + BED_HALF_MM, bedTop));
      kit.cut(box(centerX - inner, centerY - inner, soilFloor, centerX + inner, centerY + inner, bedTop + 1), 'wood');
      kit.add('soil', box(centerX - inner, centerY - inner, soilFloor, centerX + inner, centerY + inner, soilTop));
      const group = kit.rng.pick(PLANT_GROUPS);
      for (let row = 0; row < CROP_ROWS; row++) {
        const at = centerX - inner + ((row + 0.5) * inner * 2) / CROP_ROWS;
        kit.add(group, prismY([[at - 1.3, soilTop - SINK_MM], [at + 1.3, soilTop - SINK_MM], [at, soilTop + crop]], centerY - inner + 0.6, centerY + inner - 0.6));
      }
    }
  },

  greenhouse(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, DECK_MM);
    const middle = width / 2;
    const half = middle - clear - 1;
    const eave = DECK_MM + GLASS_WALL_MM;
    const profile = [[middle - half, DECK_MM], [middle + half, DECK_MM], [middle + half, eave], [middle, eave + half * GLASS_PITCH], [middle - half, eave]];
    const start = clear + 1;
    const end = length - clear - 1;
    const bays = Math.max(1, Math.round((end - start - FRAME_MM) / FRAME_PITCH_MM));
    const bay = (end - start - FRAME_MM) / bays;
    for (let index = 0; index <= bays; index++) {
      const at = start + index * bay;
      kit.add('steel', sweep(alongX, profile, at, at + FRAME_MM));
      if (index < bays) kit.add('pane', sweep(alongX, profile, at + FRAME_MM, at + bay));
    }
  },

  market(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    const [floor, counter, eave, thick, postGap] = STALL_MM;
    kit.slab('concrete', clear, 0, floor);
    const near = clear + 0.5;
    const far = width - clear - 0.5;
    const start = clear + 0.5;
    const end = length - clear - 0.5;
    kit.add('wood', span(alongX, start + THIN_MM, end - THIN_MM, near + 2, near + 8, floor, counter));
    for (let at = start + 3; at + 3 < end - 2; at += 4.5) {
      kit.add(kit.rng.pick([...PLANT_GROUPS, ...TARP_GROUPS]), span(alongX, at, at + 3, near + 3, near + 6.5, counter, counter + kit.rng.range(1, 2.4)));
    }
    const posts = Math.ceil((end - start - THIN_MM) / postGap) + 1;
    for (let post = 0; post < posts; post++) {
      const along = start + (post * (end - start - THIN_MM)) / (posts - 1);
      for (const across of [near, far - THIN_MM]) {
        kit.add('steel', span(alongX, along, along + THIN_MM, across, across + THIN_MM, floor, eave + SINK_MM));
      }
    }
    const middle = width / 2;
    const half = (far - near) / 2;
    const tent = [[near, eave], [near + thick, eave], [middle, eave + half - thick], [far - thick, eave], [far, eave], [middle, eave + half]];
    kit.add(kit.rng.pick(TARP_GROUPS), sweep(alongX, tent, start, end));
  },

  pumproom(kit) {
    kit.slab('concrete', kit.clear, 0, kit.H);
    // Pump drum standing in a bay on the longest wall, slits elsewhere
    const [half, floor, depth, top] = PUMP_BAY_MM;
    const run = kit.facades.reduce((best, wall) => (wall.length > best.length ? wall : best), kit.facades[0]);
    const style = makeStyle(kit.styleRng, kit.styleRng.pick(['slit', 'blank']));
    for (const wall of kit.facades) if (wall !== run) applyFacade(kit, wall, style);
    const middle = run.length / 2;
    const head = Math.min(kit.H - floor - depth, top);
    kit.cut(recess(run, middle - half, middle + half, floor, head, depth));
    const [centerX, centerY] = run.point(middle, 0, depth / 2);
    const [radius, height] = PUMP_DRUM_MM;
    kit.add('steel', cyl(centerX, centerY, floor - SINK_MM, Math.min(floor + height, head - depth), radius, radius, 12));
    kit.add('hazard', cyl(centerX, centerY, Math.min(floor + height, head - depth) - 1, Math.min(floor + height, head - depth), radius, radius, 12));
  },

  smallpump(kit) {
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    const [radius, height, cap, shift] = SMALL_PUMP_MM;
    const [halfLength, halfWidth, motor] = PUMP_MOTOR_MM;
    const centerX = kit.W / 2 - shift;
    const centerY = kit.D / 2;
    const top = CURB_MM + height;
    kit.add('steel', cyl(centerX, centerY, CURB_MM - SINK_MM, top, radius, radius, 14));
    kit.add('hazard', cyl(centerX, centerY, top, top + cap, radius, radius * 0.7, 14));
    // Motor block against the pump body
    const motorX = centerX + radius + halfLength - 1;
    kit.add('soot', box(motorX - halfLength, centerY - halfWidth, CURB_MM - SINK_MM, motorX + halfLength, centerY + halfWidth, CURB_MM + motor));
  },

  pumptank(kit) {
    RECIPES.tank(kit);
    // Pump on the deck corner, clear of the tank
    const [radius, offset, height, cap] = TANK_PUMP_MM;
    const at = kit.clear + offset;
    kit.add('steel', cyl(at, at, DECK_MM - SINK_MM, DECK_MM + height, radius, radius, 10));
    kit.add('hazard', cyl(at, at, DECK_MM + height, DECK_MM + height + cap, radius, radius, 10));
  },

  watermain(kit) {
    const [radius, flare, band, plate] = MAIN_MM;
    const centerX = kit.W / 2;
    const centerY = kit.D / 2;
    kit.slab('concrete', kit.clear, 0, plate);
    kit.add(kit.rng.pick(MAIN_GROUPS), cyl(centerX, centerY, plate - SINK_MM, kit.H, radius, radius, MAIN_SIDES));
    // A 45 degree collar at the middle of every story
    for (let story = 0; story < kit.stories; story++) {
      const low = story * STORY_MM + STORY_MM / 2 - flare - band / 2;
      stack(kit, centerX, centerY, MAIN_SIDES, [
        ['steel', low, low + flare, radius, radius + flare],
        ['steel', low + flare, low + flare + band, radius + flare, radius + flare],
        ['steel', low + flare + band, low + 2 * flare + band, radius + flare, radius],
      ]);
    }
  },

  powerroom(kit) {
    kit.slab('concrete', kit.clear, 0, CURB_MM);
    const [halfLength, halfWidth, height, band] = TRANSFORMER_MM;
    const [finThick, finReach, finGap] = COOLING_FIN_MM;
    const [bushing, bushingHeight, bushingGap] = BUSHING_MM;
    const top = CURB_MM + height;
    for (const [centerX, centerY] of kit.cellCenters()) {
      kit.add('steel', box(centerX - halfLength, centerY - halfWidth, CURB_MM - SINK_MM, centerX + halfLength, centerY + halfWidth, top - band));
      kit.add('hazard', box(centerX - halfLength, centerY - halfWidth, top - band, centerX + halfLength, centerY + halfWidth, top));
      // Cooling fins on the long sides, standing on the curb
      for (let at = -halfLength + finGap / 2; at + finThick <= halfLength; at += finGap) {
        for (const sign of [-1, 1]) {
          const inner = centerY + sign * (halfWidth - SINK_MM);
          kit.add('dark', box(centerX + at, inner, CURB_MM - SINK_MM, centerX + at + finThick, centerY + sign * (halfWidth + finReach), top - band - 1));
        }
      }
      for (const shift of [-bushingGap, 0, bushingGap]) {
        kit.add('concrete', cyl(centerX + shift, centerY, top - SINK_MM, top + bushingHeight, bushing, bushing * 0.8, 8));
      }
    }
  },

  planted(kit) {
    const inner = tray(kit, PLANTER_TOP_MM, PAVE_MM);
    soilBed(kit, inner, PAVE_MM, SOIL_TOP_MM);
    const [half, top] = TIER_MM;
    const [ivyThick, ivyDrop] = IVY_MM;
    const centers = kit.cellCenters();
    centers.forEach(([centerX, centerY], index) => {
      if (index % 2 === 1 || (centers.length === 1 && kit.rng.chance(0.5))) {
        bush(kit, centerX, centerY, SOIL_TOP_MM, BUSH_MM[1], kit.rng.pick(PLANT_GROUPS));
        return;
      }
      kit.add('concrete', box(centerX - half, centerY - half, PAVE_MM, centerX + half, centerY + half, top));
      kit.cut(box(centerX - half + THIN_MM, centerY - half + THIN_MM, top - 2, centerX + half - THIN_MM, centerY + half - THIN_MM, top + 1));
      kit.add('soil', box(centerX - half + THIN_MM, centerY - half + THIN_MM, top - 2, centerX + half - THIN_MM, centerY + half - THIN_MM, top - 0.8));
      bush(kit, centerX, centerY, top - 0.8, BUSH_MM[1], kit.rng.pick(PLANT_GROUPS));
      kit.add('plantDark', box(centerX - half + 2, centerY - half - ivyThick, top - ivyDrop, centerX + half - 2, centerY - half + SINK_MM, top));
    });
  },
};

Object.assign(RECIPES, PIECE_RECIPES, AMENITY_RECIPES);

export const RECIPE_IDS = Object.keys(RECIPES);

export function buildRecipe(variant, clearance) {
  const kit = createKit(variant, clearance);
  RECIPES[variant.family](kit);
  addBalconies(kit);
  addJetties(kit);
  if (isDocked(variant)) lift(kit.ops, DOCK_LIP_MM);
  return { ops: kit.ops, anchors: kit.anchors, kit };
}
