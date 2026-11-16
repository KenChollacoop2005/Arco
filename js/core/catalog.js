import { cleanProfiles } from './profiles.js';

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
const SMALL = ['1x1', '1x2'];
const MID = ['1x1', '1x2', '2x2', 'L3'];
const BOXY = ['1x1', '1x2', '2x2', '2x3'];

// Columns match the destructuring below
const TABLE = [
  ['core', 'Structure', 'Core', 'neutral', MID, [1, 4], 1, 0, 0, 1, 1],
  ['pilotis', 'Structure', 'Pilotis', 'neutral', ANY, [1, 2], 1, 0, 0, 1, 0],
  ['transfer', 'Structure', 'Transfer slab', 'neutral', ANY, [1, 1], 1, 0, 0, 1, 0],
  ['strut', 'Structure', 'Strut', 'neutral', ['1x1'], [1, 3], 1, 0, 0, 0, 0],
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
];

// Families whose facade sides take side profiles
export const PROFILE_FAMILIES = ['core', 'transfer', 'housing', 'studio', 'hall', 'penthouse', 'shop', 'stair', 'deck', 'brise', 'fins', 'spout', 'panel', 'podium'];

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
  };
}

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
  if (!family.rails) return 'clear';
  const localSide = (worldSide - instance.rot + 8) & 3;
  return (instance.mask >> localSide) & 1 ? 'facade' : 'connector';
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
    mask: family.rails ? variant.mask & 15 : 15,
    roof: family.roofable ? !!variant.roof : !family.stack,
  };
  // Flush variants carry no prof field
  const prof = cleanProfiles(variant.prof, record.mask, record.fp, family.profiles);
  if (prof) record.prof = prof;
  return record;
}
