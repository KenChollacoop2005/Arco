import { box, prismX, prismY, prismZ, cyl, octagon } from './kit.js';
import { makeRng, mixSeed, hashString } from './rng.js';

const SINK_MM = 0.25; // parts sunk into what holds them
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
const OUTLET_MM = [7, 6, 9, 2.3, 6]; // outlet box half x, half y, height, pipe apothem, pipe reach
const OUTLET_WALL_MM = 1.4; // outlet pipe wall
const DISPOSAL_TANK_MM = [5, 11]; // disposal tank radius and height
const ARCH_MM = [7.5, 6, 1.15]; // arch half width, springing height, crown rise per mm of half width
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

// Form a turbine or solar variant takes: the first roll of its shape rng, as the recipe makes it
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
  for (let at = CURB_MM; at + slot < roomTop - GEN_BAND_MM - 1; at += pitch) {
    kit.cut(box(low - 1, kit.D * margin, at, low + depth, kit.D * (1 - margin), at + slot));
    kit.cut(box(kit.W - low - depth, kit.D * margin, at, kit.W - low + 1, kit.D * (1 - margin), at + slot));
  }
  const [centerX, centerY] = kit.cellCenters()[0];
  kit.add('steel', cyl(centerX, centerY, roomTop - SINK_MM, kit.H - cap, radiusLow, radiusHigh, 10));
  kit.add('soot', cyl(centerX, centerY, kit.H - cap, kit.H, radiusHigh, radiusHigh, 10));
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

// Box with a pipe outlet out of its local +x side; the outlet is kept for the pour
function outletBox(kit, pipeGroup) {
  const [centerX, centerY] = centre(kit);
  const [halfX, halfY, height, pipe, reach] = OUTLET_MM;
  kit.add('concrete', box(centerX - halfX, centerY - halfY, 0, centerX + halfX, centerY + halfY, height));
  const end = Math.min(kit.W - kit.clear, centerX + halfX + reach);
  const pipeZ = height - pipe - 1.5;
  kit.add(pipeGroup, prismX(octagon(centerY, pipeZ, pipe), centerX + halfX - SINK_MM, end));
  kit.cut(prismX(octagon(centerY, pipeZ, pipe - OUTLET_WALL_MM), centerX, end + 1), pipeGroup);
  kit.anchors.outlet.push({ at: [end, centerY, pipeZ - pipe * 0.4], dir: [1, 0, 0] });
  return { centerX, centerY, height };
}

// Runoff: a clean water outlet that pours off its edge
function runoff(kit) {
  outletBox(kit, 'steel');
}

// Disposal: a rusty tank and outlet that pours murky water
function disposal(kit) {
  const { centerX, centerY } = outletBox(kit, 'rust');
  const [radius, height] = DISPOSAL_TANK_MM;
  kit.add('rust', cyl(centerX - OUTLET_MM[0] + radius, centerY, OUTLET_MM[2] - SINK_MM, OUTLET_MM[2] + height * 0.5, radius, radius * 0.8, 10));
}

// Arched foundation: a block with a pointed arch cut along local x, for a stream to run under
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
    const rows = Math.max(1, Math.min(3, Math.floor((kit.H - CURB_MM - 6) / (radius * 2 + spacing))));
    const top = CURB_MM + rows * (radius * 2 + spacing) + 2;
    for (const sign of [-1, 1]) kit.add('steel', box(centerX - post, centerY + sign * (kit.D / 2 - kit.clear - post) - post, CURB_MM - SINK_MM, centerX + post, centerY + sign * (kit.D / 2 - kit.clear - post) + post, top));
    kit.add('steel', box(centerX - post, kit.clear, top - post * 2, centerX + post, kit.D - kit.clear, top));
    for (let row = 0; row < rows; row++) {
      const hubZ = CURB_MM + spacing + radius + row * (radius * 2 + spacing);
      kit.add('steel', box(centerX - post, kit.clear + post, hubZ - 0.7, centerX + post, kit.D - kit.clear - post, hubZ + 0.7));
      for (const sign of [-1, 1]) threeBlade(kit, centerX + post + 0.8, centerY + sign * (radius + 1), hubZ, radius, turn + row);
    }
    return null;
  }
  // Ducted: small square ducts on a curb, each with a fan
  const [half, wall, length] = DUCT_MM;
  const count = Math.min(kit.rng.int(2, 3), Math.floor((kit.D - 2 * kit.clear) / (half * 2 + 1)));
  const levels = kit.stories > 2 ? 2 : 1;
  for (let level = 0; level < levels; level++) {
    for (let at = 0; at < count; at++) {
      const ductY = kit.clear + half + at * (half * 2 + 1);
      const ductZ = CURB_MM + half + level * (half * 2 - SINK_MM);
      kit.add('steel', box(centerX - length / 2, ductY - half, ductZ - half, centerX + length / 2, ductY + half, ductZ + half));
      kit.cut(box(centerX - length / 2 - 1, ductY - half + wall, ductZ - half + wall, centerX + length / 2 + 1, ductY + half - wall, ductZ + half - wall), 'steel');
      threeBlade(kit, centerX, ductY, ductZ, half - wall - 0.3, turn + at);
    }
  }
  return null;
}

// Solar forms: tilted rack, pole tracker, upright wall panels, panel awning
export function solarForm(kit, rack) {
  const form = kit.rng.pick(SOLAR_FORMS);
  if (form === 'rack') return rack(kit);
  const [skin, foot] = PANEL_MM;
  kit.slab('concrete', kit.clear, 0, 2.5);
  if (form === 'tracker') {
    const [pole, half, rise] = POLE_MM;
    for (const [centerX, centerY] of kit.cellCenters()) {
      const top = Math.min(kit.H - half - 1, kit.rng.range(10, 15));
      kit.add('steel', cyl(centerX, centerY, 2.5 - SINK_MM, top - rise, pole, pole, 8));
      kit.add('steel', cyl(centerX, centerY, top - rise - SINK_MM, top, pole, half, 4, 45));
      // Panel on a wedge, tilted to the seeded side
      const tilt = kit.rng.range(0.25, 0.5);
      const low = top;
      const thin = PANEL_MM[2];
      kit.add('steel', prismY([[centerX - half, low - SINK_MM], [centerX + half, low - SINK_MM], [centerX + half, low + half * 2 * tilt], [centerX - half, low + thin]], centerY - half, centerY + half));
      kit.add('solar', prismY([[centerX - half, low + thin - SINK_MM], [centerX + half, low + half * 2 * tilt - SINK_MM], [centerX + half, low + half * 2 * tilt + skin], [centerX - half, low + thin + skin]], centerY - half, centerY + half));
    }
    return null;
  }
  if (form === 'wall') {
    const [half, tall] = WALL_PANEL_MM;
    const height = Math.min(kit.H - 1, tall);
    const alongX = kit.W >= kit.D;
    const middle = alongX ? kit.D / 2 : kit.W / 2;
    const span = (from, to, low, high) => (alongX ? box(kit.clear + 1, from, low, kit.W - kit.clear - 1, to, high) : box(from, kit.clear + 1, low, to, kit.D - kit.clear - 1, high));
    kit.add('concrete', span(middle - half, middle + half, 2.5 - SINK_MM, height));
    kit.add('solar', span(middle - half - skin, middle - half + SINK_MM, foot + 2.5, height - 1));
    kit.add('solar', span(middle + half - SINK_MM, middle + half + skin, foot + 2.5, height - 1));
    return null;
  }
  // Awning on one or two cells only: wider roofs would need posts inside
  if (kit.cells.length > 2) return rack(kit);
  const [post, eave, roof] = AWNING_MM;
  const top = Math.min(kit.H - roof - skin, eave);
  for (const [cornerX, cornerY] of [[kit.clear + post, kit.clear + post], [kit.W - kit.clear - post, kit.clear + post], [kit.W - kit.clear - post, kit.D - kit.clear - post], [kit.clear + post, kit.D - kit.clear - post]]) {
    kit.add('steel', box(cornerX - post, cornerY - post, 2.5 - SINK_MM, cornerX + post, cornerY + post, top));
  }
  // Posts under long sides keep every roof bridge under the limit
  for (let at = kit.clear + post + AWNING_STEP_MM; at < kit.W - kit.clear - post - 4; at += AWNING_STEP_MM) {
    for (const cornerY of [kit.clear + post, kit.D - kit.clear - post]) kit.add('steel', box(at - post, cornerY - post, 2.5 - SINK_MM, at + post, cornerY + post, top));
  }
  for (let at = kit.clear + post + AWNING_STEP_MM; at < kit.D - kit.clear - post - 4; at += AWNING_STEP_MM) {
    for (const cornerX of [kit.clear + post, kit.W - kit.clear - post]) kit.add('steel', box(cornerX - post, at - post, 2.5 - SINK_MM, cornerX + post, at + post, top));
  }
  kit.add('concrete', box(kit.clear, kit.clear, top - SINK_MM, kit.W - kit.clear, kit.D - kit.clear, top + roof));
  kit.add('solar', box(kit.clear + 0.6, kit.clear + 0.6, top + roof - SINK_MM, kit.W - kit.clear - 0.6, kit.D - kit.clear - 0.6, top + roof + skin));
  return null;
}

export const PIECE_RECIPES = { generator, spring, raincatcher, well, wheel, wheelup, runoff, disposal, arch };
