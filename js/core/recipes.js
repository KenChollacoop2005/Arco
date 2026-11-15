import { CELL_MM, STORY_MM } from '../config.js';
import { box, prismX, prismY, prismZ, cyl, pyramid, octagon, createKit } from './kit.js';
import { makeStyle, applyFacades, recess, glassPane, groove, roofTray } from './facade.js';

const SINK_MM = 0.25; // parts sunk into what holds them
const THIN_MM = 1.6; // parapets and thin walls
const DECK_MM = 3; // thin floor slabs
const CURB_MM = 4; // low bases under roof parts
const PAVE_MM = 2.5; // paving and soil tray floors
const SOIL_TOP_MM = 5.5; // soil level in planters
const PLANTER_TOP_MM = 7; // planter wall height
const BALCONY_TOP_MM = 8.5; // balcony parapet height
const TERRACE_TOP_MM = 6; // terrace parapet height
const WALK_TOP_MM = 8; // walkway parapet height
const HATCH_HALF_MM = 4; // roof hatch half width
const ROOF_DEPTH_MM = 2.5; // sunken roof depth
const PILOTIS_SLAB_MM = 6; // slab over pilotis columns
const COLUMN_HALF_MM = [5.5, 7]; // pilotis column half width range
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
const STALL_MM = [2, 7, 15, 19, 0.8]; // floor, counter, eave, ridge, tarp edge
const TIER_MM = [7, 11]; // planted terrace tier half width and top
const IVY_MM = [0.8, 5]; // ivy thickness and drop

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

function mass(kit, top = kit.H) {
  kit.slab('concrete', kit.inset, 0, top);
}

function tray(kit, top, floor = DECK_MM, wall = THIN_MM) {
  kit.slab('concrete', kit.clear, 0, top);
  kit.carve(kit.clear + wall, floor, top + 1);
  return kit.clear + wall;
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

function styled(kit, types, low = 0, high = kit.H) {
  const style = makeStyle(kit.styleRng, types ? kit.styleRng.pick(types) : undefined);
  applyFacades(kit, style, low, high);
  return style;
}

const RECIPES = {
  core(kit) {
    mass(kit);
    styled(kit, ['slit', 'blank', 'oct']);
    if (kit.roof) roofGear(kit);
  },

  pilotis(kit) {
    const slabBase = kit.H - PILOTIS_SLAB_MM;
    kit.slab('concrete', kit.inset, slabBase, kit.H);
    const round = kit.rng.chance(0.5);
    const half = CELL_MM / 2 - kit.inset;
    const column = kit.rng.range(COLUMN_HALF_MM[0], COLUMN_HALF_MM[1]);
    const capBase = slabBase - (half - column);
    for (const [centerX, centerY] of kit.cellCenters()) {
      if (round) {
        kit.add('concrete', cyl(centerX, centerY, 0, capBase + SINK_MM, column));
        kit.add('concrete', cyl(centerX, centerY, capBase, slabBase, column, half));
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

  buttress(kit) {
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    kit.slab('concrete', clear, 0, DECK_MM);
    const profile = [
      [clear, 0],
      [length - clear, 0],
      [length - clear, BUTTRESS_TOE_MM],
      [clear + BUTTRESS_HEAD_MM, kit.H],
      [clear, kit.H],
    ];
    kit.add('concrete', cross(alongX, profile, width / 2 - BUTTRESS_HALF_MM, width / 2 + BUTTRESS_HALF_MM));
  },

  housing(kit) {
    mass(kit);
    styled(kit);
    if (kit.roof) roofGear(kit);
  },

  studio(kit) {
    mass(kit);
    const style = makeStyle(kit.styleRng, kit.styleRng.pick(['strip', 'loggia', 'grid', 'oct']));
    if (kit.stories === 2) style.group = 2;
    applyFacades(kit, style);
    if (!kit.roof) return;
    for (let start = -SINK_MM; start < kit.W; start += SAW_PITCH_MM) {
      kit.cut(prismY([[start, kit.H + 1], [start + SAW_PITCH_MM, kit.H + 1], [start + SAW_PITCH_MM, kit.H - SAW_DROP_MM], [start, kit.H]], -1, kit.D + 1));
    }
  },

  hall(kit) {
    mass(kit);
    styled(kit, ['fins', 'strip', 'egg']);
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
    kit.slab('concrete', clear, 0, DECK_MM);
    kit.add('concrete', span(alongX, clear, length - clear, clear, clear + THIN_MM, 0, WALK_TOP_MM));
    kit.add('concrete', span(alongX, clear, length - clear, width - clear - THIN_MM, width - clear, 0, WALK_TOP_MM));
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
    const slope = (lift) => [[clear, 0], [length - clear, 0], [length - clear, RAMP_TOP_MM + lift], [clear, RAMP_LIP_MM + lift]];
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
        kit.cut(recess(run, run.lo, run.hi, floor, head, GALLERY_DEPTH_MM));
        glassPane(kit, run, run.lo, run.hi, floor, head, GALLERY_DEPTH_MM);
        kit.add(
          'concrete',
          run.box(Math.max(run.lo, 0), Math.min(run.hi, run.length), floor - SINK_MM, floor + GALLERY_RAIL_MM, 0, THIN_MM)
        );
        for (let post = 1; post < run.cells * 2; post++) {
          const at = run.bayStart(0) + (post * CELL_MM) / 2;
          kit.add('concrete', run.box(at - POST_HALF_MM, at + POST_HALF_MM, floor - SINK_MM, head, 0, GALLERY_DEPTH_MM + SINK_MM));
        }
      }
    }
  },

  balcony(kit) {
    const inner = tray(kit, BALCONY_TOP_MM);
    if (kit.rng.chance(0.5)) {
      kit.add('soil', box(inner, inner, DECK_MM, inner + CURB_MM, kit.D - inner, SOIL_TOP_MM));
      bush(kit, inner + CURB_MM / 2, kit.D / 2, SOIL_TOP_MM, BUSH_MM[0], kit.rng.pick(PLANT_GROUPS));
    }
  },

  terrace(kit) {
    const inner = tray(kit, TERRACE_TOP_MM);
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
    kit.add('concrete', box(minX, minY, 0, maxX, minY + THIN_MM, PLANTER_TOP_MM));
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
    styled(kit, ['blank']);
    const run = kit.facades.find((wall) => wall.length > SPOUT_HALF_MM * 6);
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
        for (let at = run.lo + RIB_PITCH_MM; at < run.hi - RIB_PITCH_MM / 2; at += RIB_PITCH_MM) {
          kit.cut(run.prismV([[at - RIB_MM, -SINK_MM], [at + RIB_MM, -SINK_MM], [at, RIB_MM]], -1, kit.H + 1));
        }
      } else if (pattern === 'tiles') {
        const [size, depth] = TILE_MM;
        for (let low = 3, row = 0; low + size < kit.H - 2; low += size + 2, row++) {
          for (let at = Math.max(run.lo, 0) + 3 + (row % 2) * (size / 2); at + size < run.hi - 1; at += size + 2) {
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
    for (let step = 0; step < count; step++) {
      kit.add('concrete', box(clear + step * tread, clear, 0, kit.W - clear, kit.D - clear, (step + 1) * rise));
    }
    kit.add('concrete', box(clear, clear, 0, kit.W - clear, clear + THIN_MM, count * rise + RAMP_CURB_MM));
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
    kit.add('steel', span(alongX, clear, length - clear, near, far, 0, beamHeight));
    for (let at = clear + chord; at + TRUSS_BASE_MM < length - clear - chord; at += TRUSS_PITCH_MM) {
      kit.cut(cross(alongX, [[at, chord], [at + TRUSS_BASE_MM, chord], [at + TRUSS_BASE_MM / 2, beamHeight - chord]], near - 1, far + 1), 'steel');
      const flipped = at + TRUSS_SHIFT_MM;
      if (flipped + TRUSS_BASE_MM > length - clear - chord) continue;
      kit.cut(cross(alongX, [[flipped, beamHeight - chord], [flipped + TRUSS_BASE_MM / 2, chord], [flipped + TRUSS_BASE_MM, beamHeight - chord]], near - 1, far + 1), 'steel');
    }
    const [beltWidth, beltHeight, railWidth, railHeight] = BELT_MM;
    kit.add('soot', span(alongX, clear, length - clear, width / 2 - beltWidth / 2, width / 2 + beltWidth / 2, beamHeight, beamHeight + beltHeight));
    kit.add('hazard', span(alongX, clear, length - clear, near, near + railWidth, beamHeight, beamHeight + railHeight));
    kit.add('hazard', span(alongX, clear, length - clear, far - railWidth, far, beamHeight, beamHeight + railHeight));
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
    const { alongX, length, width } = axes(kit);
    const clear = kit.clear;
    const [run, rise, skin, pitch] = SOLAR_MM;
    kit.slab('concrete', clear, 0, PAVE_MM);
    for (let at = clear + 1; at + run < length - clear; at += pitch) {
      kit.add('concrete', cross(alongX, [[at, PAVE_MM - SINK_MM], [at + run, PAVE_MM - SINK_MM], [at + run, PAVE_MM + rise], [at, PAVE_MM]], clear + 1, width - clear - 1));
      kit.add('solar', cross(alongX, [[at, PAVE_MM], [at + run, PAVE_MM + rise], [at + run, PAVE_MM + rise + skin], [at, PAVE_MM + skin]], clear + 1, width - clear - 1));
    }
  },

  turbine(kit) {
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
    const [floor, counter, eave, ridge, edge] = STALL_MM;
    kit.slab('concrete', clear, 0, floor);
    const near = clear + 0.5;
    const far = width - clear - 0.5;
    const start = clear + 0.5;
    const end = length - clear - 0.5;
    kit.add('wood', span(alongX, start + THIN_MM, end - THIN_MM, near + 2, near + 8, floor, counter));
    for (let at = start + 3; at + 3 < end - 2; at += 4.5) {
      kit.add(kit.rng.pick([...PLANT_GROUPS, ...TARP_GROUPS]), span(alongX, at, at + 3, near + 3, near + 6.5, counter, counter + kit.rng.range(1, 2.4)));
    }
    for (const along of [start, end - THIN_MM]) {
      for (const across of [near, far - THIN_MM]) {
        kit.add('steel', span(alongX, along, along + THIN_MM, across, across + THIN_MM, floor, eave));
      }
    }
    const middle = width / 2;
    kit.add(kit.rng.pick(TARP_GROUPS), sweep(alongX, [[near, eave], [far, eave], [far, eave + edge], [middle, ridge], [near, eave + edge]], start, end));
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
      kit.add('plantDark', box(centerX - half + 2, centerY - half - ivyThick, top - ivyDrop, centerX + half - 2, centerY - half + SINK_MM, top + 0.4));
    });
  },
};

export const RECIPE_IDS = Object.keys(RECIPES);

export function buildRecipe(variant, clearance) {
  const kit = createKit(variant, clearance);
  RECIPES[variant.family](kit);
  return { ops: kit.ops, anchors: kit.anchors, kit };
}
