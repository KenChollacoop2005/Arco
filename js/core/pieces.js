import { box, prismX, prismY, prismZ, cyl, octagon } from './kit.js';
import { makeRng, mixSeed, hashString } from './rng.js';

const SINK_MM = 0.25; // parts sunk into what holds them
const CUT_OVER_MM = 1; // cuts run this far past the face they open
const ROUND_SIDES = 10; // facets on stacks and drums
const FRAME_ROWS_MAX = 3; // most rotor rows on a frame turbine
const FRAME_ROOM_MM = [6, 2]; // frame turbine room kept above the rows, cap over the top row
const FRAME_BAR_MM = 0.7; // hub bar half height
const FRAME_HUB_MM = [0.8, 1]; // rotor hub out from the post, gap past the rotor
const DUCT_COUNT = [2, 3]; // ducts in a row, by seed
const DUCT_GAP_MM = 1; // space between ducts
const DUCT_FAN_GAP_MM = 0.3; // fan blade tip clear of the duct wall
const SOLAR_BASE_MM = 2.5; // base slab under solar forms
const POLE_TOP_MM = [10, 15, 1]; // tracker panel height range, room left under the top
const POLE_SIDES = [8, 4, 45]; // tracker pole facets, cone facets, cone turn in degrees
const PANEL_TILT = [0.25, 0.5]; // tracker panel rise per mm across, by seed
const SOLAR_EDGE_MM = 1; // wall panels stop this far inside the top and ends
const AWNING_END_MM = 4; // no extra awning post this close to the end post
const AWNING_SKIN_IN_MM = 0.6; // awning panel skin inset from the roof edge
const CURB_MM = 4; // low bases under roof parts
const GEN_STACK_MM = [9, 3.4, 2.8, 2]; // generator stack zone height, radius low, high, soot cap
const GEN_BAND_MM = 2.2; // generator hazard band
const GEN_LOUVRE_MM = [1, 1.1, 3, 0.2]; // louvre slot height, depth, pitch, end margin share
const GEN_VENT_MM = [2, 2.5, 4]; // roof vent half width, half depth, height
const BASIN_MM = [6, 1.6, 2.5, 4.6]; // spring basin height, wall, floor, water top
const ROCK_MM = [1.6, 2.8]; // spring rock radius range
const CATCHER_MM = [5, 11, 9.4, 2.5, 0.8, 7.8]; // rain catcher drum radius, drum top, dish radius, rim height, bowl floor, bowl radius
const CATCHER_FLARE = 1.1; // dish flare rise per mm out, steeper than 45 degrees
const CATCHER_BASE_MM = 2; // rain catcher base plate
const WELL_MM = [8, 1.6, 6.5, 2.2, 1.4, 16, 2]; // well curb half, wall, height, water drop, post half, beam height, beam depth
const WELL_MOTOR_MM = [3.2, 2.6, 4]; // well pump motor half x, half y, height
const WHEEL_MM = [9, 2.2, 4, 1.6, 2.4, 2]; // wheel apothem, rim lift, pier width, axle apothem, notch width, notch depth
const WHEEL_SIDES_MM = 8; // wheel thickness across the flow
const WHEEL_GROW_MM = 6; // wheel apothem added per story past one
const WHEEL_UP_MM = 6; // raised wheel apothem, clear under the flume
const FLUME_MM = [5, 1.2, 3]; // raised wheel flume half width, wall, depth
const STUB_ZONE_MM = 5.5; // stub reach between the body and the cell line
const STUB_MM = [2.2, 0.9, 1.15]; // stub half size, bore half size, keel depth share
const STUB_COUNT = [2, 5]; // stubs on the outlet face, by seed
const STUB_FLOWING = [1, 2]; // stubs that pour, by seed
const STUB_BAND_MM = [2.5, 3]; // stubs keep this far off the floor and the top
const STUB_GAP_MM = 1.2; // clear space between two stubs
const BASIN_INSET_MM = [2, 1.6, 0.6]; // runoff roof basin inset, depth, water below the top
const DISPOSAL_TANK_MM = [5, 4]; // disposal roof tank radius and height
const ARCH_MM = [7.5, 6, 1.15]; // arch half width, springing height, crown rise per mm of half width
const SUPPORT_FORMS = ['columns', 'struts']; // support frame forms by seed
const BAY_USES = ['garden', 'stall', 'empty']; // what the open bay holds, by seed
const SUPPORT_POST_MM = 4.5; // column frame pillar width
const STRUT_POST_MM = 3; // strut frame corner post width
const SUPPORT_FLOOR_MM = 1.4; // floor plate under the frame and its bay
const STRUT_MM = 2.4; // strut thickness
const SUPPORT_SLAB_MM = 6; // top slab, deep enough for a socket
const BAY_BED_MM = 4.5; // garden bed half width
const BAY_SOIL_MM = 3.5; // garden bed soil height
const BAY_BUSH_MM = 4; // garden bush height
const BAY_COUNTER_MM = [5, 3, 7]; // stall counter half length, depth, height
const BAY_TARP_MM = 1.4; // stall tarp under the slab
export const TURBINE_FORMS = ['vertical', 'three', 'drum', 'frame', 'ducted']; // turbine forms by seed
export const SOLAR_FORMS = ['rack', 'tracker', 'wall', 'awning']; // solar forms by seed
const MAST_MM = [2, 1.5]; // turbine mast radius low and high
const NACELLE_MM = [5, 2, 2.4]; // nacelle half length, half width, height
const BLADE_MM = [0.6, 1.2]; // blade half thickness, half width
const BLADE_REACH_MM = [7, 10]; // three blade rotor radius range
const DRUM_MM = [5.5, 0.9, 6]; // drum rotor radius, vane half width, vanes
const FRAME_MM = [1.4, 4, 3.2]; // frame post half, rotor spacing, small rotor radius
const DUCT_MM = [4.2, 1.4, 6]; // duct half size, wall, length
const PANEL_MM = [1.3, 1.8, 0.6]; // panel skin, wedge foot, wedge thin end
const POLE_MM = [1.6, 7.5, 6]; // tracker pole radius, panel half size, cone rise
const WALL_PANEL_MM = [2.4, 17]; // facade panel slab half thickness, height
const AWNING_MM = [1.3, 13, 2.4]; // awning post half, eave height, roof thickness
const AWNING_STEP_MM = 16; // awning post spacing along a long side

const centre = (kit) => [kit.W / 2, kit.D / 2];

// Turbine or solar form, as the recipe rolls it
export function formOf(variant) {
  const forms = variant.family === 'turbine' ? TURBINE_FORMS : SOLAR_FORMS;
  return makeRng(mixSeed(variant.seed >>> 0, hashString(variant.family))).pick(forms);
}

// Generator room: a block with louvres, a hazard band and a stack on top
function generator(kit) {
  const [zone, radiusLow, radiusHigh, cap] = GEN_STACK_MM;
  const roomTop = kit.H - zone;
  kit.slab('concrete', kit.clear, 0, roomTop - GEN_BAND_MM);
  kit.slab('hazard', kit.clear, roomTop - GEN_BAND_MM, roomTop);
  const [slot, depth, pitch, margin] = GEN_LOUVRE_MM;
  const low = kit.clear;
  for (let at = CURB_MM; at + slot < roomTop - GEN_BAND_MM - CUT_OVER_MM; at += pitch) {
    kit.cut(box(low - CUT_OVER_MM, kit.D * margin, at, low + depth, kit.D * (1 - margin), at + slot));
    kit.cut(box(kit.W - low - depth, kit.D * margin, at, kit.W - low + CUT_OVER_MM, kit.D * (1 - margin), at + slot));
  }
  const [centerX, centerY] = kit.cellCenters()[0];
  kit.add('steel', cyl(centerX, centerY, roomTop - SINK_MM, kit.H - cap, radiusLow, radiusHigh, ROUND_SIDES));
  kit.add('soot', cyl(centerX, centerY, kit.H - cap, kit.H, radiusHigh, radiusHigh, ROUND_SIDES));
  kit.anchors.smoke.push([centerX, centerY, kit.H]);
  const [halfX, halfY, tall] = GEN_VENT_MM;
  const [lastX, lastY] = kit.cellCenters()[kit.cells.length - 1];
  const ventX = kit.cells.length > 1 ? lastX : centerX + radiusLow + halfX + 1.5;
  if (ventX + halfX <= kit.W - kit.clear) kit.add('steel', box(ventX - halfX, lastY - halfY, roomTop - SINK_MM, ventX + halfX, lastY + halfY, roomTop + tall));
}

// Spring: a low stone basin of water with a few rocks on its rim
function spring(kit) {
  const [height, wall, floor, water] = BASIN_MM;
  kit.slab('concrete', kit.clear, 0, height);
  kit.carve(kit.clear + wall, floor, height + 1);
  kit.slab('water', kit.clear + wall, floor - SINK_MM, water);
  for (const [centerX, centerY] of kit.cellCenters()) {
    const radius = kit.rng.range(ROCK_MM[0], ROCK_MM[1]);
    const corner = kit.rng.pick([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    const reach = 12.5 - kit.clear - radius;
    kit.add('dark', cyl(centerX + corner[0] * reach, centerY + corner[1] * reach, height - SINK_MM, height + radius, radius, radius * 0.5, 7));
  }
}

// Rain catcher: a drum under a flared dish that holds the rain
function raincatcher(kit) {
  const [drum, drumTop, dish, rim, lip, bowl] = CATCHER_MM;
  // A shared base plate keeps two catchers one piece
  kit.slab('concrete', kit.clear, 0, CATCHER_BASE_MM);
  for (const [centerX, centerY] of kit.cellCenters()) {
    kit.add('steel', cyl(centerX, centerY, CATCHER_BASE_MM - SINK_MM, drumTop, drum, drum, 12));
    const flareTop = drumTop + (dish - drum) * CATCHER_FLARE;
    kit.add('steel', cyl(centerX, centerY, drumTop - SINK_MM, flareTop, drum, dish, 12));
    kit.add('concrete', cyl(centerX, centerY, flareTop - SINK_MM, flareTop + rim, dish, dish, 12));
    kit.cut(cyl(centerX, centerY, flareTop + lip, flareTop + rim + 1, bowl, bowl, 12), 'concrete');
    kit.add('water', cyl(centerX, centerY, flareTop + lip - SINK_MM, flareTop + rim - 0.7, bowl + SINK_MM, bowl + SINK_MM, 12));
  }
}

// Well: a square curb round a shaft, two posts, a beam and a pump motor
function well(kit) {
  const [centerX, centerY] = centre(kit);
  const [half, wall, height, drop, post, beam, beamDepth] = WELL_MM;
  kit.add('concrete', box(centerX - half, centerY - half, 0, centerX + half, centerY + half, height));
  kit.cut(box(centerX - half + wall, centerY - half + wall, height - drop - 3, centerX + half - wall, centerY + half - wall, height + 1));
  kit.add('water', box(centerX - half + wall - SINK_MM, centerY - half + wall - SINK_MM, height - drop - 3.2, centerX + half - wall + SINK_MM, centerY + half - wall + SINK_MM, height - drop));
  for (const sign of [-1, 1]) kit.add('wood', box(centerX + sign * (half - post) - post, centerY - post, height - SINK_MM, centerX + sign * (half - post) + post, centerY + post, beam + beamDepth));
  kit.add('wood', box(centerX - half, centerY - post, beam, centerX + half, centerY + post, beam + beamDepth));
  const [motorX, motorY, motorTall] = WELL_MOTOR_MM;
  kit.add('steel', box(centerX - motorX, centerY + half - wall - motorY * 2 + SINK_MM, height - SINK_MM, centerX + motorX, centerY + half - SINK_MM, height + motorTall));
}

// Wheel disc in the flow plane, with notched paddles and an axle into its piers
function wheelOn(kit, base, apothem, pierTop) {
  const [, , pierWidth, axle, notchWide, notchDeep] = WHEEL_MM;
  const centerX = kit.W / 2;
  const axleZ = base + apothem + WHEEL_MM[1];
  const sideA = kit.clear + pierWidth;
  const sideB = kit.D - kit.clear - pierWidth;
  const middle = kit.D / 2;
  for (const [from, to] of [[kit.clear, sideA], [sideB, kit.D - kit.clear]]) kit.add('concrete', box(kit.clear, from, base, kit.W - kit.clear, to, pierTop));
  kit.add('steel', prismY(octagon(centerX, axleZ, axle), sideA - SINK_MM, sideB + SINK_MM));
  const half = WHEEL_SIDES_MM / 2;
  kit.add('wheel', prismY(octagon(centerX, axleZ, apothem), middle - half, middle + half));
  for (const [stepX, stepZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tipX = centerX + stepX * apothem;
    const tipZ = axleZ + stepZ * apothem;
    // Each notch starts past the rim so no faces meet flush
    const notch = stepX === 0
      ? box(centerX - notchWide / 2, middle - half - 1, stepZ > 0 ? tipZ - notchDeep : tipZ - 1, centerX + notchWide / 2, middle + half + 1, stepZ > 0 ? tipZ + 1 : tipZ + notchDeep)
      : box(stepX > 0 ? tipX - notchDeep : tipX - 1, middle - half - 1, axleZ - notchWide / 2, stepX > 0 ? tipX + 1 : tipX + notchDeep, middle + half + 1, axleZ + notchWide / 2);
    kit.cut(notch, 'wheel');
  }
  kit.anchors.spinY = [...(kit.anchors.spinY || []), [centerX, axleZ]];
  return axleZ;
}

// Base water wheel: stands in the stream, flow along its length
function wheel(kit) {
  const apothem = Math.min(WHEEL_MM[0] + (kit.stories - 1) * WHEEL_GROW_MM, kit.W / 2 - kit.clear - 0.5);
  wheelOn(kit, 0, apothem, apothem + WHEEL_MM[1] + WHEEL_MM[3] + 2);
}

// Raised wheel: one pier rises to carry a flume that pours onto the wheel
function wheelup(kit) {
  kit.slab('concrete', kit.clear, 0, CURB_MM);
  const axleZ = wheelOn(kit, CURB_MM - SINK_MM, WHEEL_UP_MM, CURB_MM + WHEEL_UP_MM + 4);
  const [, wall, depth] = FLUME_MM;
  const top = kit.H - 1;
  const floor = top - depth - wall;
  const pier = kit.clear + WHEEL_MM[2];
  // Both piers rise so the flume floor spans between them
  kit.add('concrete', box(kit.clear, kit.clear, CURB_MM - SINK_MM, kit.W - kit.clear, pier, floor + SINK_MM));
  kit.add('concrete', box(kit.clear, kit.D - pier, CURB_MM - SINK_MM, kit.W - kit.clear, kit.D - kit.clear, floor + SINK_MM));
  kit.add('concrete', box(kit.clear, kit.clear, floor, kit.W / 2, kit.D - kit.clear, top));
  kit.cut(box(kit.clear - 1, kit.clear + wall, top - depth, kit.W / 2 + 1, kit.D - kit.clear - wall, top + 1));
  kit.add('water', box(kit.clear, kit.clear + wall - SINK_MM, top - depth - SINK_MM, kit.W / 2, kit.D - kit.clear - wall + SINK_MM, top - 1));
  return axleZ;
}

// Teardrop section: flat top, pointed keel steeper than 45 degrees
function teardrop(centerY, centerZ, half, keel) {
  const side = half * Math.tan(Math.PI / 8);
  return [[centerY + half, centerZ - side], [centerY + half, centerZ + side], [centerY + side, centerZ + half], [centerY - side, centerZ + half], [centerY - half, centerZ + side], [centerY - half, centerZ - side], [centerY, centerZ - side - half * keel]];
}

// Evenly spread slot centers on one axis, and the jitter each may take
function slotAxis(low, high, size) {
  const count = Math.max(1, Math.floor((high - low) / (size + STUB_GAP_MM)) + 1);
  const step = count > 1 ? (high - low) / (count - 1) : 0;
  return { centers: Array.from({ length: count }, (unused, index) => low + index * step), jitter: count > 1 ? (step - size - STUB_GAP_MM) / 2 : 0 };
}

// Seeded stub spots on the outlet face, one per slot, none overlapping
function stubSpots(kit, top) {
  const [half, , keel] = STUB_MM;
  const below = half * Math.tan(Math.PI / 8) + half * keel;
  const across = slotAxis(kit.clear + half + STUB_GAP_MM, kit.D - kit.clear - half - STUB_GAP_MM, 2 * half);
  const up = slotAxis(STUB_BAND_MM[0] + below, top - STUB_BAND_MM[1] - half, half + below);
  const slots = across.centers.flatMap((centerY) => up.centers.map((centerZ) => [centerY, centerZ]));
  const want = Math.min(slots.length, kit.rng.int(STUB_COUNT[0], STUB_COUNT[1]));
  return kit.rng.shuffle(slots).slice(0, want).map(([centerY, centerZ]) => [centerY + kit.rng.range(-across.jitter, across.jitter), centerZ + kit.rng.range(-up.jitter, up.jitter)]);
}

// Full body with pipe stubs on local +x; one or two of them pour
function outletBody(kit, stubGroup, top) {
  const face = kit.W - kit.clear - STUB_ZONE_MM;
  const [half, bore, keel] = STUB_MM;
  const spots = stubSpots(kit, top);
  const pouring = kit.rng.shuffle(spots.map((spot, index) => index)).slice(0, kit.rng.int(STUB_FLOWING[0], STUB_FLOWING[1]));
  spots.forEach(([centerY, centerZ], index) => {
    kit.add(stubGroup, prismX(teardrop(centerY, centerZ, half, keel), face - SINK_MM, kit.W - kit.clear));
    kit.cut(prismX([[centerY + bore, centerZ], [centerY, centerZ + bore], [centerY - bore, centerZ], [centerY, centerZ - bore]], face + SINK_MM, kit.W - kit.clear + 1), stubGroup);
    if (pouring.includes(index)) kit.anchors.outlet.push({ at: [kit.W - kit.clear, centerY, centerZ - bore / 2], dir: [1, 0, 0] });
  });
  return face;
}

// Runoff: a full block with steel stubs and a rain basin on top
function runoff(kit) {
  const face = kit.W - kit.clear - STUB_ZONE_MM;
  kit.add('concrete', box(kit.clear, kit.clear, 0, face, kit.D - kit.clear, kit.H));
  const [inset, depth, water] = BASIN_INSET_MM;
  kit.cut(box(kit.clear + inset, kit.clear + inset, kit.H - depth, face - inset, kit.D - kit.clear - inset, kit.H + 1), 'concrete');
  kit.add('water', box(kit.clear + inset - SINK_MM, kit.clear + inset - SINK_MM, kit.H - depth - SINK_MM, face - inset + SINK_MM, kit.D - kit.clear - inset + SINK_MM, kit.H - water));
  outletBody(kit, 'steel', kit.H);
}

// Disposal: a full block with rusty stubs, a hazard band and a roof tank
function disposal(kit) {
  const [radius, height] = DISPOSAL_TANK_MM;
  const top = kit.H - height;
  const face = kit.W - kit.clear - STUB_ZONE_MM;
  kit.add('concrete', box(kit.clear, kit.clear, 0, face, kit.D - kit.clear, top - GEN_BAND_MM));
  kit.add('hazard', box(kit.clear, kit.clear, top - GEN_BAND_MM - SINK_MM, face, kit.D - kit.clear, top));
  outletBody(kit, 'rust', top - GEN_BAND_MM);
  kit.add('rust', cyl((kit.clear + face) / 2, kit.D / 2, top - SINK_MM, kit.H, radius, radius * 0.8, 10));
}

// Arched foundation: pointed arch along local x
function arch(kit) {
  kit.slab('concrete', kit.inset, 0, kit.H);
  const [half, spring, rise] = ARCH_MM;
  const centerY = kit.D / 2;
  const crown = spring + half * rise;
  kit.cut(prismX([[centerY - half, -1], [centerY + half, -1], [centerY + half, spring], [centerY, crown], [centerY - half, spring]], -1, kit.W + 1));
}

// Three-blade rotor in the plane across local x, blades render only
function threeBlade(kit, hubX, hubY, hubZ, reach, turn) {
  const [halfThick, halfWide] = BLADE_MM;
  for (let blade = 0; blade < 3; blade++) {
    const angle = turn + (blade * Math.PI * 2) / 3;
    const out = [Math.cos(angle), Math.sin(angle)];
    const side = [-out[1], out[0]];
    const tip = [hubY + out[0] * reach, hubZ + out[1] * reach];
    const root = [hubY, hubZ];
    kit.add('blade', prismX([[root[0] - side[0] * halfWide, root[1] - side[1] * halfWide], [tip[0] - side[0] * halfWide * 0.4, tip[1] - side[1] * halfWide * 0.4], [tip[0] + side[0] * halfWide * 0.4, tip[1] + side[1] * halfWide * 0.4], [root[0] + side[0] * halfWide, root[1] + side[1] * halfWide]], hubX - halfThick, hubX + halfThick));
  }
  kit.anchors.spinX = [...(kit.anchors.spinX || []), [hubY, hubZ]];
}

// Turbine forms; size and count vary by seed and height
export function turbineForm(kit, vertical) {
  const form = kit.rng.pick(TURBINE_FORMS);
  if (form === 'vertical') return vertical(kit);
  const [centerX, centerY] = centre(kit);
  kit.slab('concrete', kit.clear, 0, CURB_MM);
  const turn = kit.rng.range(0, Math.PI * 2);
  if (form === 'three') {
    const [length, half, tall] = NACELLE_MM;
    const reach = kit.rng.range(BLADE_REACH_MM[0], BLADE_REACH_MM[1]);
    const hubZ = kit.H - reach - 1;
    kit.add('steel', cyl(centerX, centerY, CURB_MM - SINK_MM, hubZ - tall / 2, MAST_MM[0], MAST_MM[1], 10));
    kit.add('steel', box(centerX - length, centerY - half, hubZ - tall / 2, centerX + length * 0.6, centerY + half, hubZ + tall / 2));
    kit.add('hazard', prismX(octagon(centerY, hubZ, tall / 2), centerX + length * 0.6 - SINK_MM, centerX + length * 0.6 + 1.2));
    threeBlade(kit, centerX + length * 0.6 + 1.6, centerX, hubZ, Math.min(reach, kit.D / 2 - kit.clear - 0.5), turn);
    return null;
  }
  if (form === 'drum') {
    const [radius, vane, count] = DRUM_MM;
    const low = kit.H - kit.rng.range(12, Math.min(18, kit.H - CURB_MM - 4));
    kit.add('steel', cyl(centerX, centerY, CURB_MM - SINK_MM, kit.H - 1, MAST_MM[1], MAST_MM[1], 10));
    kit.add('rotor', cyl(centerX, centerY, low, low + 1.2, radius, radius, 12));
    kit.add('rotor', cyl(centerX, centerY, kit.H - 2.2, kit.H - 1, radius, radius, 12));
    for (let at = 0; at < count; at++) {
      const angle = turn + (at * Math.PI * 2) / count;
      const out = [Math.cos(angle), Math.sin(angle)];
      const side = [-out[1], out[0]];
      const inner = radius * 0.45;
      const quad = [[out[0] * inner - side[0] * vane, out[1] * inner - side[1] * vane], [out[0] * radius - side[0] * vane, out[1] * radius - side[1] * vane], [out[0] * radius + side[0] * vane, out[1] * radius + side[1] * vane], [out[0] * inner + side[0] * vane, out[1] * inner + side[1] * vane]].map(([x, y]) => [centerX + x, centerY + y]);
      kit.add('rotor', prismZ(quad, low + 1, kit.H - 2));
    }
    kit.anchors.spin = [centerX, centerY];
    return null;
  }
  if (form === 'frame') {
    const [post, spacing, radius] = FRAME_MM;
    const rows = Math.max(1, Math.min(FRAME_ROWS_MAX, Math.floor((kit.H - CURB_MM - FRAME_ROOM_MM[0]) / (radius * 2 + spacing))));
    const top = CURB_MM + rows * (radius * 2 + spacing) + FRAME_ROOM_MM[1];
    for (const sign of [-1, 1]) kit.add('steel', box(centerX - post, centerY + sign * (kit.D / 2 - kit.clear - post) - post, CURB_MM - SINK_MM, centerX + post, centerY + sign * (kit.D / 2 - kit.clear - post) + post, top));
    kit.add('steel', box(centerX - post, kit.clear, top - post * 2, centerX + post, kit.D - kit.clear, top));
    for (let row = 0; row < rows; row++) {
      const hubZ = CURB_MM + spacing + radius + row * (radius * 2 + spacing);
      kit.add('steel', box(centerX - post, kit.clear + post, hubZ - FRAME_BAR_MM, centerX + post, kit.D - kit.clear - post, hubZ + FRAME_BAR_MM));
      for (const sign of [-1, 1]) threeBlade(kit, centerX + post + FRAME_HUB_MM[0], centerY + sign * (radius + FRAME_HUB_MM[1]), hubZ, radius, turn + row);
    }
    return null;
  }
  // Ducted: small square ducts on a curb, each with a fan
  const [half, wall, length] = DUCT_MM;
  const count = Math.min(kit.rng.int(DUCT_COUNT[0], DUCT_COUNT[1]), Math.floor((kit.D - 2 * kit.clear) / (half * 2 + DUCT_GAP_MM)));
  const levels = kit.stories > 2 ? 2 : 1;
  for (let level = 0; level < levels; level++) {
    for (let at = 0; at < count; at++) {
      const ductY = kit.clear + half + at * (half * 2 + DUCT_GAP_MM);
      const ductZ = CURB_MM + half + level * (half * 2 - SINK_MM);
      kit.add('steel', box(centerX - length / 2, ductY - half, ductZ - half, centerX + length / 2, ductY + half, ductZ + half));
      kit.cut(box(centerX - length / 2 - CUT_OVER_MM, ductY - half + wall, ductZ - half + wall, centerX + length / 2 + CUT_OVER_MM, ductY + half - wall, ductZ + half - wall), 'steel');
      threeBlade(kit, centerX, ductY, ductZ, half - wall - DUCT_FAN_GAP_MM, turn + at);
    }
  }
  return null;
}

// Solar forms: tilted rack, pole tracker, upright wall panels, panel awning
export function solarForm(kit, rack) {
  const form = kit.rng.pick(SOLAR_FORMS);
  if (form === 'rack') return rack(kit);
  const [skin, foot] = PANEL_MM;
  kit.slab('concrete', kit.clear, 0, SOLAR_BASE_MM);
  if (form === 'tracker') {
    const [pole, half, rise] = POLE_MM;
    for (const [centerX, centerY] of kit.cellCenters()) {
      const top = Math.min(kit.H - half - POLE_TOP_MM[2], kit.rng.range(POLE_TOP_MM[0], POLE_TOP_MM[1]));
      kit.add('steel', cyl(centerX, centerY, SOLAR_BASE_MM - SINK_MM, top - rise, pole, pole, POLE_SIDES[0]));
      kit.add('steel', cyl(centerX, centerY, top - rise - SINK_MM, top, pole, half, POLE_SIDES[1], POLE_SIDES[2]));
      // Panel on a wedge, tilted to the seeded side
      const tilt = kit.rng.range(PANEL_TILT[0], PANEL_TILT[1]);
      const low = top;
      const thin = PANEL_MM[2];
      kit.add('steel', prismY([[centerX - half, low - SINK_MM], [centerX + half, low - SINK_MM], [centerX + half, low + half * 2 * tilt], [centerX - half, low + thin]], centerY - half, centerY + half));
      kit.add('solar', prismY([[centerX - half, low + thin - SINK_MM], [centerX + half, low + half * 2 * tilt - SINK_MM], [centerX + half, low + half * 2 * tilt + skin], [centerX - half, low + thin + skin]], centerY - half, centerY + half));
    }
    return null;
  }
  if (form === 'wall') {
    const [half, tall] = WALL_PANEL_MM;
    const height = Math.min(kit.H - SOLAR_EDGE_MM, tall);
    const alongX = kit.W >= kit.D;
    const middle = alongX ? kit.D / 2 : kit.W / 2;
    const span = (from, to, low, high) => (alongX ? box(kit.clear + SOLAR_EDGE_MM, from, low, kit.W - kit.clear - SOLAR_EDGE_MM, to, high) : box(from, kit.clear + SOLAR_EDGE_MM, low, to, kit.D - kit.clear - SOLAR_EDGE_MM, high));
    kit.add('concrete', span(middle - half, middle + half, SOLAR_BASE_MM - SINK_MM, height));
    kit.add('solar', span(middle - half - skin, middle - half + SINK_MM, foot + SOLAR_BASE_MM, height - SOLAR_EDGE_MM));
    kit.add('solar', span(middle + half - SINK_MM, middle + half + skin, foot + SOLAR_BASE_MM, height - SOLAR_EDGE_MM));
    return null;
  }
  // Awning on one or two cells only: wider roofs would need posts inside
  if (kit.cells.length > 2) return rack(kit);
  const [post, eave, roof] = AWNING_MM;
  const top = Math.min(kit.H - roof - skin, eave);
  for (const [cornerX, cornerY] of [[kit.clear + post, kit.clear + post], [kit.W - kit.clear - post, kit.clear + post], [kit.W - kit.clear - post, kit.D - kit.clear - post], [kit.clear + post, kit.D - kit.clear - post]]) {
    kit.add('steel', box(cornerX - post, cornerY - post, SOLAR_BASE_MM - SINK_MM, cornerX + post, cornerY + post, top));
  }
  // Posts under long sides keep every roof bridge under the limit
  for (let at = kit.clear + post + AWNING_STEP_MM; at < kit.W - kit.clear - post - AWNING_END_MM; at += AWNING_STEP_MM) {
    for (const cornerY of [kit.clear + post, kit.D - kit.clear - post]) kit.add('steel', box(at - post, cornerY - post, SOLAR_BASE_MM - SINK_MM, at + post, cornerY + post, top));
  }
  for (let at = kit.clear + post + AWNING_STEP_MM; at < kit.D - kit.clear - post - AWNING_END_MM; at += AWNING_STEP_MM) {
    for (const cornerX of [kit.clear + post, kit.W - kit.clear - post]) kit.add('steel', box(cornerX - post, at - post, SOLAR_BASE_MM - SINK_MM, cornerX + post, at + post, top));
  }
  kit.add('concrete', box(kit.clear, kit.clear, top - SINK_MM, kit.W - kit.clear, kit.D - kit.clear, top + roof));
  kit.add('solar', box(kit.clear + AWNING_SKIN_IN_MM, kit.clear + AWNING_SKIN_IN_MM, top + roof - SINK_MM, kit.W - kit.clear - AWNING_SKIN_IN_MM, kit.D - kit.clear - AWNING_SKIN_IN_MM, top + roof + skin));
  return null;
}

// Support: a frame that carries one module and, through it, its neighbours
function support(kit) {
  const form = kit.rng.pick(SUPPORT_FORMS);
  const use = kit.rng.pick(BAY_USES);
  const low = kit.clear;
  const high = kit.W - kit.clear;
  const middle = kit.W / 2;
  const slab = kit.H - SUPPORT_SLAB_MM;
  kit.add('concrete', box(low, low, slab, high, high, kit.H));
  // Floor plate under the frame and bay
  kit.add('concrete', box(low, low, 0, high, high, SUPPORT_FLOOR_MM));
  const post = form === 'columns' ? SUPPORT_POST_MM : STRUT_POST_MM;
  for (const cornerX of [low, high - post]) for (const cornerY of [low, high - post]) kit.add('concrete', box(cornerX, cornerY, SUPPORT_FLOOR_MM - SINK_MM, cornerX + post, cornerY + post, slab + SINK_MM));
  if (form === 'struts') {
    // A raking pair up each edge, meeting under the middle of the slab
    const foot = SUPPORT_FLOOR_MM - SINK_MM;
    const head = slab + SINK_MM;
    const pairs = [
      [[low, foot], [low + STRUT_MM, foot], [middle, head], [middle - STRUT_MM, head]],
      [[high - STRUT_MM, foot], [high, foot], [middle + STRUT_MM, head], [middle, head]],
    ];
    for (const strut of pairs) {
      for (const [faceFrom, faceTo] of [[low, low + STRUT_MM], [high - STRUT_MM, high]]) {
        kit.add('steel', prismY(strut, faceFrom, faceTo));
        kit.add('steel', prismX(strut, faceFrom, faceTo));
      }
    }
  }
  // The open bay holds a small ground use inside the frame
  if (use === 'garden') {
    kit.add('soil', box(middle - BAY_BED_MM, middle - BAY_BED_MM, SUPPORT_FLOOR_MM - SINK_MM, middle + BAY_BED_MM, middle + BAY_BED_MM, BAY_SOIL_MM));
    kit.add('plant', cyl(middle, middle, BAY_SOIL_MM - SINK_MM, BAY_SOIL_MM + BAY_BUSH_MM, BAY_BUSH_MM * 0.6, BAY_BUSH_MM * 0.3, 7));
  } else if (use === 'stall') {
    const [counterHalf, counterDeep, counterTall] = BAY_COUNTER_MM;
    kit.add('wood', box(middle - counterHalf, low + post + 0.5, SUPPORT_FLOOR_MM - SINK_MM, middle + counterHalf, low + post + 0.5 + counterDeep, counterTall));
    kit.add(kit.rng.pick(['tarpTerracotta', 'tarpMustard', 'tarpTeal']), box(low + post - SINK_MM, low + post - SINK_MM, slab - BAY_TARP_MM, high - post + SINK_MM, high - post + SINK_MM, slab + SINK_MM));
  }
}

export const PIECE_RECIPES = { generator, spring, raincatcher, well, wheel, wheelup, runoff, disposal, arch, support };
