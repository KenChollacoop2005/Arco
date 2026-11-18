import { cleanProfiles } from './profiles.js';
import { makeRng, mixSeed } from './rng.js';

export const ROLE_GROUPS = [
  'Structure',
  'Living',
  'Circulation',
  'Outdoor',
  'Roof and services',
  'Expression',
  'Ground',
  'Industrial',
  'Eco',
];

export const PLACEMENTS = ['Facade', 'Interior', 'Filler', 'Cap', 'Base', 'Spanning'];

const ANY = ['1x1', '1x2', '2x2', '2x3', 'L3', 'L4'];
const SPAN = ['1x3', '2x3']; // two ends and one cell between
const DOCK_SPAN = ['1x2', '1x3', '1x4', '1x5']; // docked bridge lengths
const SMALL = ['1x1', '1x2'];
const MID = ['1x1', '1x2', '2x2', 'L3'];
const BOXY = ['1x1', '1x2', '2x2', '2x3'];

// Columns match the destructuring below
const TABLE = [
  ['core', 'Structure', 'Core', 'neutral', MID, [1, 4], 1, 0, 0, 1, 1],
  ['pilotis', 'Structure', 'Pilotis', 'neutral', ANY, [1, 2], 1, 0, 0, 1, 0],
  ['transfer', 'Structure', 'Transfer slab', 'neutral', ANY, [1, 1], 1, 0, 0, 1, 0],
  ['strut', 'Structure', 'Strut', 'neutral', ['1x1'], [1, 3], 1, 0, 0, 0, 0],
  ['pier', 'Structure', 'Pier', 'neutral', ['1x1'], [1, 4], 1, 0, 0, 0, 0],
  ['buttress', 'Structure', 'Buttress', 'neutral', SMALL, [1, 4], 0, 1, 0, 0, 0],
  ['housing', 'Living', 'Housing unit', 'neutral', ANY, [1, 4], 1, 0, 0, 1, 1],
  ['studio', 'Living', 'Studio', 'neutral', MID, [1, 2], 1, 0, 0, 1, 1],
  ['hall', 'Living', 'Communal hall', 'neutral', ['1x2', '2x2', '2x3', 'L3', 'L4'], [2, 3], 1, 0, 0, 1, 1],
  ['penthouse', 'Living', 'Penthouse', 'neutral', ['1x2', '2x2', '2x3'], [1, 2], 1, 0, 0, 1, 1],
  ['shacks', 'Living', 'Stacked shacks', 'neutral', ['1x1', '1x2', '2x2'], [1, 3], 1, 0, 0, 1, 0],
  ['flared', 'Living', 'Flared housing', 'neutral', BOXY, [1, 3], 1, 0, 0, 1, 1],
  ['shop', 'Living', 'Shop', 'neutral', ANY, [1, 2], 1, 1, 0, 1, 0],
  ['walkway', 'Circulation', 'Walkway', 'neutral', SPAN, [1, 1], 0, 0, 1, 0, 0],
  ['bridge', 'Circulation', 'Bridge', 'neutral', ['1x2', '2x2', '2x3', 'L4'], [1, 2], 1, 0, 1, 1, 0],
  ['stair', 'Circulation', 'Stair tower', 'neutral', SMALL, [2, 4], 1, 0, 0, 1, 1],
  ['ramp', 'Circulation', 'Ramp', 'neutral', ['1x2'], [1, 1], 0, 1, 0, 0, 0],
  ['deck', 'Circulation', 'Deck access', 'neutral', ANY, [1, 2], 1, 0, 0, 1, 0],
  ['balcony', 'Outdoor', 'Balcony', 'neutral', SMALL, [1, 1], 0, 0, 0, 0, 0],
  ['terrace', 'Outdoor', 'Terrace', 'neutral', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['patio', 'Outdoor', 'Patio', 'neutral', MID, [1, 1], 0, 1, 0, 0, 0],
  ['garden', 'Outdoor', 'Roof garden', 'eco', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['tank', 'Roof and services', 'Water tank', 'neutral', ['1x1', '2x2'], [1, 2], 0, 0, 0, 0, 0],
  ['plant', 'Roof and services', 'Plant room', 'neutral', MID, [1, 1], 0, 0, 0, 0, 0],
  ['vent', 'Roof and services', 'Vent stack', 'neutral', SMALL, [1, 2], 0, 0, 0, 0, 0],
  ['skylight', 'Roof and services', 'Skylight', 'neutral', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['antenna', 'Roof and services', 'Antenna', 'neutral', ['1x1'], [2, 4], 0, 0, 0, 0, 0],
  ['brise', 'Expression', 'Brise-soleil', 'neutral', ANY, [1, 3], 1, 0, 0, 1, 0],
  ['fins', 'Expression', 'Concrete fins', 'neutral', ANY, [1, 4], 1, 0, 0, 1, 0],
  ['spout', 'Expression', 'Water spout', 'neutral', SMALL, [1, 2], 1, 0, 0, 1, 0],
  ['panel', 'Expression', 'Textured panel', 'neutral', ANY, [1, 3], 1, 0, 0, 1, 0],
  ['steps', 'Ground', 'Steps', 'neutral', ['1x1', '1x2', '2x2'], [1, 1], 0, 1, 0, 0, 0],
  ['planter', 'Ground', 'Planter', 'eco', MID, [1, 1], 0, 1, 0, 0, 0],
  ['podium', 'Ground', 'Podium', 'neutral', ANY, [1, 2], 1, 1, 0, 1, 0],
  ['smokestack', 'Industrial', 'Smokestack', 'industrial', ['1x1'], [2, 4], 0, 0, 0, 0, 0],
  ['pipes', 'Industrial', 'Pipe run', 'industrial', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['tankfarm', 'Industrial', 'Tank farm', 'industrial', ['1x2', '2x2', '2x3'], [1, 2], 0, 0, 0, 0, 0],
  ['gantry', 'Industrial', 'Conveyor gantry', 'industrial', SPAN, [1, 1], 0, 0, 1, 0, 0],
  ['chimney', 'Industrial', 'Chimney', 'industrial', ['1x1'], [2, 3], 0, 0, 0, 0, 0],
  ['cooling', 'Industrial', 'Cooling block', 'industrial', ['1x1', '2x2'], [1, 2], 0, 0, 0, 0, 0],
  ['solar', 'Eco', 'Solar array', 'eco', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['turbine', 'Eco', 'Wind turbine', 'eco', ['1x1'], [2, 3], 0, 0, 0, 0, 0],
  ['farm', 'Eco', 'Rooftop farm', 'eco', BOXY, [1, 1], 0, 0, 0, 0, 0],
  ['greenhouse', 'Eco', 'Greenhouse', 'eco', ['1x1', '1x2', '2x2'], [1, 1], 0, 0, 0, 0, 0],
  ['market', 'Eco', 'Market stall', 'eco', SMALL, [1, 1], 0, 0, 0, 0, 0],
  ['planted', 'Eco', 'Planted terrace', 'eco', MID, [1, 1], 0, 0, 0, 0, 0],
  ['pumproom', 'Industrial', 'Pump room', 'industrial', ['1x1', '1x2', '2x2'], [1, 2], 1, 0, 0, 0, 0],
  ['smallpump', 'Roof and services', 'Small pump', 'neutral', ['1x1'], [1, 1], 0, 0, 0, 0, 0],
  ['pumptank', 'Roof and services', 'Pumped tank', 'neutral', ['1x1', '2x2'], [1, 2], 0, 0, 0, 0, 0],
  ['watermain', 'Roof and services', 'Water main', 'neutral', ['1x1'], [1, 4], 1, 0, 0, 0, 0],
  ['powerroom', 'Roof and services', 'Power room', 'neutral', ['1x1', '1x2'], [1, 1], 0, 0, 0, 0, 0],
  ['generator', 'Industrial', 'Generator room', 'industrial', ['1x1', '1x2'], [1, 2], 0, 0, 0, 0, 0],
  ['spring', 'Ground', 'Spring', 'eco', ['1x1', '1x2'], [1, 1], 0, 1, 0, 0, 0],
  ['raincatcher', 'Roof and services', 'Rain catcher', 'neutral', ['1x1', '1x2'], [1, 1], 0, 0, 0, 0, 0],
  ['well', 'Ground', 'Well', 'neutral', ['1x1'], [1, 1], 0, 1, 0, 0, 0],
  ['wheel', 'Eco', 'Water wheel', 'eco', ['1x1'], [1, 2], 0, 1, 0, 0, 0],
  ['wheelup', 'Roof and services', 'Raised water wheel', 'neutral', ['1x1'], [1, 1], 0, 0, 0, 0, 0],
  ['runoff', 'Expression', 'Runoff', 'neutral', ['1x1'], [1, 1], 0, 0, 0, 0, 0],
  ['disposal', 'Industrial', 'Disposal', 'industrial', ['1x1'], [1, 1], 0, 0, 0, 0, 0],
  ['arch', 'Structure', 'Arched foundation', 'neutral', ['1x1'], [1, 1], 1, 1, 0, 1, 0],
  ['support', 'Structure', 'Support', 'neutral', ['1x1'], [1, 3], 1, 0, 0, 0, 0],
  ['gym', 'Living', 'Gym', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['clinic', 'Living', 'Clinic', 'neutral', ['1x1', '1x2'], [1, 2], 1, 0, 0, 1, 0],
  ['school', 'Living', 'School', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['shrine', 'Outdoor', 'Shrine', 'neutral', ['1x1'], [1, 1], 0, 0, 0, 0, 0],
  ['bathhouse', 'Living', 'Bathhouse', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['foodstall', 'Living', 'Noodle bar', 'neutral', ['1x1', '1x2'], [1, 2], 1, 0, 0, 1, 0],
  ['laundromat', 'Living', 'Laundromat', 'neutral', ['1x1', '1x2'], [1, 2], 1, 0, 0, 1, 0],
  ['library', 'Living', 'Library', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['arcade', 'Living', 'Arcade', 'neutral', ['1x1', '1x2'], [1, 2], 1, 0, 0, 1, 0],
  ['playground', 'Outdoor', 'Rooftop playground', 'neutral', ['1x1', '1x2'], [1, 1], 0, 0, 0, 0, 0],
  ['teahouse', 'Outdoor', 'Teahouse', 'neutral', ['1x1', '1x2'], [1, 1], 0, 0, 0, 0, 0],
  ['barber', 'Living', 'Barber', 'neutral', ['1x1'], [1, 2], 1, 0, 0, 1, 0],
  ['pharmacy', 'Living', 'Pharmacy', 'neutral', ['1x1', '1x2'], [1, 2], 1, 0, 0, 1, 0],
  ['workshop', 'Living', 'Repair workshop', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['courier', 'Living', 'Courier depot', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['canteen', 'Living', 'Canteen', 'neutral', ['1x2', '2x2'], [1, 2], 1, 0, 0, 1, 0],
  ['lookout', 'Outdoor', 'Lookout', 'neutral', ['1x1'], [1, 2], 0, 0, 0, 0, 0],
];

// Categories the Generate panel can switch off; everything else is always on
export const CATEGORIES = ['social', 'nature', 'industrial', 'walled', 'utilities'];
export const UTILITIES = 'utilities'; // services category, its own URL field
const AMENITY_IDS = ['gym', 'clinic', 'school', 'shrine', 'bathhouse', 'foodstall', 'laundromat', 'library', 'arcade', 'playground', 'teahouse', 'barber', 'pharmacy', 'workshop', 'courier', 'canteen', 'lookout'];
const CATEGORY_LISTS = {
  social: ['market', 'shop', 'hall', ...AMENITY_IDS],
  nature: ['farm', 'garden', 'greenhouse', 'planted'],
  industrial: ['smokestack', 'chimney', 'tankfarm', 'gantry', 'cooling', 'generator', 'disposal'],
  walled: ['shacks', 'flared'],
  utilities: ['pumproom', 'smallpump', 'pumptank', 'watermain', 'powerroom', 'turbine', 'solar', 'generator', 'well', 'spring', 'raincatcher', 'wheel', 'wheelup', 'runoff', 'disposal'],
};
// What a resident might walk to: one type per amenity, for the walking network
const AMENITY_TYPES = { market: 'market', shop: 'shop', hall: 'hall', ...Object.fromEntries(AMENITY_IDS.map((id) => [id, id])) };

// Sides a family always keeps open, as a local side mask
const OPEN_SIDES = { arch: 0b0101 };
// Families that may carry a junction box on an outward wall
export const JUNCTION_FAMILIES = ['housing', 'studio', 'hall', 'penthouse', 'shacks', 'flared', 'shop', 'stair', 'deck', 'core', 'podium', 'pumproom'];
// Local side that meets the building a ground piece leans on or climbs to
export const BUTT_SIDES = { buttress: 2, steps: 0, ramp: 0, strut: 2 };
// Bridge families whose ends get a cap, steps or nothing, by what they meet
export const END_FAMILIES = ['walkway', 'gantry'];
export const END_OPEN = 0; // meets a wall or a dock
export const END_CAP = 1; // meets open air
export const END_STEP = 2; // meets a roof at deck level
// Code of one end, 0 the local low x end, 1 the high
export const endCode = (variant, end) => ((variant.ends || 0) >> (end * 2)) & 3;

// Platforms whose mask marks outward sides: railed there, open toward walls
export const OPEN_SIDE_FAMILIES = ['lookout', 'terrace', 'patio', 'balcony'];
// Local sides a platform leaves open, from its mask
export const openSides = (variant) => (OPEN_SIDE_FAMILIES.includes(variant.family) ? ~variant.mask & 15 : 0);
// Families that stand on support below, never hang in a group
export const STANDING_FAMILIES = ['lookout'];

// Families kept in code but never generated or placed
export const DISABLED_FAMILIES = ['wheelup'];

// Families that may stand on the stream
export const STREAM_FAMILIES = ['wheel', 'arch'];

// Families whose facade sides take side profiles
export const PROFILE_FAMILIES = ['core', 'transfer', 'housing', 'studio', 'hall', 'penthouse', 'shop', 'stair', 'deck', 'brise', 'fins', 'spout', 'panel', 'podium'];

// Bridge families that dock between two buildings
export const DOCK_BRIDGES = ['walkway', 'gantry'];
// Railed families without a body at the slot foot
const NO_DOCK = ['pilotis', 'arch'];
export const PLUG_ENDS = 5; // both end sides of a 1xN bridge

export const FAMILIES = {};
for (const row of TABLE) {
  const [id, group, label, theme, footprints, heights, stack, ground, spanning, rails, roofable] = row;
  FAMILIES[id] = {
    id,
    group,
    label,
    theme,
    footprints,
    minStories: heights[0],
    maxStories: heights[1],
    stack: !!stack,
    ground: !!ground,
    spanning: !!spanning,
    rails: !!rails,
    roofable: !!roofable,
    profiles: PROFILE_FAMILIES.includes(id),
    docks: !!rails && !NO_DOCK.includes(id),
    dockFootprints: DOCK_BRIDGES.includes(id) ? DOCK_SPAN : [],
    category: CATEGORIES.find((name) => CATEGORY_LISTS[name].includes(id)) || 'base',
    categories: CATEGORIES.filter((name) => CATEGORY_LISTS[name].includes(id)),
    amenity: AMENITY_TYPES[id] || null,
    disabled: DISABLED_FAMILIES.includes(id),
  };
}

// True when a family may be generated with these categories on
export const categoryOn = (familyId, categories) => !FAMILIES[familyId].disabled && FAMILIES[familyId].categories.every((name) => categories.includes(name));

export const FAMILY_IDS = Object.keys(FAMILIES);

export function canSupport(instance) {
  return FAMILIES[instance.family].stack && !instance.roof;
}

export function hasRails(instance) {
  return FAMILIES[instance.family].rails;
}

// Local side type after rotation
export function sideType(instance, worldSide) {
  const family = FAMILIES[instance.family];
  const localSide = (worldSide - instance.rot + 8) & 3;
  const docked = ((instance.dock || 0) >> localSide) & 1;
  if (!family.rails) return docked ? 'plug' : 'clear';
  if ((instance.mask >> localSide) & 1) return 'facade';
  return docked ? 'dock' : 'connector';
}

// True for a bridge that hangs between two docks
export const isDocked = (instance) => !FAMILIES[instance.family].rails && !!instance.dock;

// Dock sides a variant may keep
function cleanDock(dock, mask, footprintId, family) {
  if (!Number.isInteger(dock) || dock <= 0) return 0;
  if (family.dockFootprints.includes(footprintId)) return PLUG_ENDS;
  return family.docks ? dock & ~mask & 15 : 0;
}

export function defaultPlacement(instance) {
  const family = FAMILIES[instance.family];
  if (family.spanning) return 'Spanning';
  if (family.ground) return 'Base';
  if (!canSupport(instance)) return 'Cap';
  if ((instance.mask & 15) === 0) return 'Interior';
  return 'Facade';
}

export function normalizeVariant(variant) {
  const family = FAMILIES[variant.family];
  const record = {
    family: variant.family,
    fp: variant.fp,
    h: variant.h,
    seed: variant.seed >>> 0,
    mask: family.rails ? (variant.mask | (OPEN_SIDES[variant.family] || 0)) & 15 : OPEN_SIDE_FAMILIES.includes(variant.family) && Number.isInteger(variant.mask) ? variant.mask & 15 : 15,
    roof: family.roofable ? !!variant.roof : !family.stack,
  };
  // Flush variants carry no prof field
  const prof = cleanProfiles(variant.prof, record.mask, record.fp, family.profiles);
  if (prof) record.prof = prof;
  // Variants without docks carry no dock field
  const dock = cleanDock(variant.dock, record.mask, record.fp, family);
  if (dock) record.dock = dock;
  // A junction box is a render only option, kept only where it may go
  if (variant.jb && JUNCTION_FAMILIES.includes(variant.family)) record.jb = 1;
  // Bridge ends; docked ends plug into their docks and stay open
  if (Number.isInteger(variant.ends) && variant.ends > 0 && END_FAMILIES.includes(variant.family) && !record.dock) record.ends = variant.ends & 15;
  return record;
}

const PLANT_PUMP_SEED = 0x9a17; // keeps the pump roll apart from shape rolls
export const PLANT_PUMP_CHANCE = 0.35; // share of plant rooms with a pump
export const PUMP_FAMILIES = ['pumproom', 'smallpump', 'pumptank', 'well']; // families that always pump

// True when a variant carries a pump, seeded for plant rooms
export function hasPump(variant) {
  if (PUMP_FAMILIES.includes(variant.family)) return true;
  if (variant.family !== 'plant') return false;
  return makeRng(mixSeed(variant.seed >>> 0, PLANT_PUMP_SEED)).chance(PLANT_PUMP_CHANCE);
}
