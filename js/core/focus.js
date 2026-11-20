import { CELL_MM, STORY_MM, NOISY_FAMILIES, BRIDGE_FAMILIES } from '../config.js';
import { FAMILIES, residentCapacity } from './catalog.js';
import { EMITTER_FAMILIES } from './emitters.js';
import { INDUSTRY_FAMILIES, cellGap } from './residents.js';

const NEAREST_SHOWN = 3; // most modules shown when none is in range

// Modules of these families within cells of the home, or the nearest few when none is
function near(modules, home, families, cells) {
  const ranked = modules.filter((other) => other.id !== home.id && families.includes(other.family)).map((other) => ({ id: other.id, gap: cellGap(home, other) })).sort((first, second) => first.gap - second.gap);
  const inRange = ranked.filter((entry) => entry.gap <= cells);
  return (inRange.length > 0 ? inRange : ranked.slice(0, NEAREST_SHOWN)).map((entry) => entry.id);
}

const neighbours = (analysis, id) => {
  const entry = analysis && analysis.modules && analysis.modules[id];
  return entry ? [...new Set([...entry.side, ...entry.above, ...entry.below])] : [];
};

// Light sources as rings: centre and radius in mm
const rings = (lights, kinds = null) => ((lights && lights.sources) || []).filter((source) => source.lit && (!kinds || kinds.includes(source.kind))).map((source) => ({ point: source.point, radius: source.radius * CELL_MM, module: source.module }));

// Power: blocked cable routes into the home, what blocks them, and the nearest relay
function powerFocus(flows, home) {
  const services = flows && flows.services;
  const out = { modules: [], lines: [] };
  if (!services) return out;
  for (const wire of services.blocked || []) {
    if (wire.type !== 'wire' || !wire.to || wire.to.module !== home.id) continue;
    out.lines.push(wire.points);
    if (wire.blocked && wire.blocked.module !== null && wire.blocked.module !== undefined) out.modules.push(wire.blocked.module);
  }
  const report = services.power && services.power.consumers && services.power.consumers[home.id];
  if (report && report.nearestRelay) out.modules.push(report.nearestRelay.module);
  return out;
}

// What a trait is about, for highlighting: modules, residents, a level line in mm, light rings, route lines
// ctx: {modules, home (instance), homeOf(residentId), analysis ({modules, flows, walking, lights}), start (home id)}
export function traitFocus(kind, trait, ctx) {
  const focus = { modules: [], residents: [], level: null, rings: [], lines: [] };
  const { modules, home, analysis } = ctx;
  if (!home) {
    if (trait.resident) focus.residents.push(trait.resident);
    return focus;
  }
  const tagText = `${kind}:${trait.id}`;
  const byFamily = (families) => modules.filter((other) => families.includes(other.family)).map((other) => other.id);
  const homesNext = () => neighbours(analysis, home.id).filter((id) => {
    const other = modules.find((instance) => instance.id === id);
    return other && residentCapacity(other) > 0;
  });
  if (tagText === 'want:calm' || tagText === 'hate:industry') focus.modules = near(modules, home, kind === 'hate' ? [...new Set([...INDUSTRY_FAMILIES, ...EMITTER_FAMILIES])] : INDUSTRY_FAMILIES, trait.cells);
  else if (tagText === 'hate:disposal') focus.modules = near(modules, home, ['disposal'], trait.cells);
  else if (tagText === 'hate:noise') focus.modules = neighbours(analysis, home.id).filter((id) => NOISY_FAMILIES.includes((modules.find((instance) => instance.id === id) || {}).family));
  else if (trait.id === 'amenity') focus.modules = modules.filter((other) => FAMILIES[other.family].amenity === trait.type).map((other) => other.id);
  else if (trait.id === 'nextto' || trait.id === 'feud') {
    focus.residents.push(trait.resident);
    const theirs = ctx.homeOf(trait.resident);
    if (theirs !== null && theirs !== undefined) focus.modules.push(theirs);
  } else if (tagText === 'want:lit' || tagText === 'hate:dark') focus.rings = rings(analysis.lights);
  else if (tagText === 'hate:glare') focus.rings = rings(analysis.lights, ['floodlight']);
  else if (tagText === 'want:stepfree' || tagText === 'hate:stairs' || tagText === 'hate:walk') {
    const route = analysis.walking && analysis.walking.routes && analysis.walking.routes[home.id];
    if (route) focus.lines.push(route);
  } else if (tagText === 'want:high') focus.level = trait.story * STORY_MM;
  else if (tagText === 'want:low' || tagText === 'hate:heights') focus.level = (trait.story + 1) * STORY_MM;
  else if (tagText === 'hate:ground') focus.level = STORY_MM;
  else if (tagText === 'dream:tall') focus.level = trait.stories * STORY_MM;
  else if (tagText === 'want:neighbour' || tagText === 'want:community' || tagText === 'hate:crowding') focus.modules = homesNext();
  else if (tagText === 'dream:bridge') focus.modules = byFamily(BRIDGE_FAMILIES);
  else if (tagText === 'dream:garden' || tagText === 'dream:market') focus.modules = byFamily([trait.id]);
  else if (tagText === 'want:power' || tagText === 'need:power') Object.assign(focus, powerFocus(analysis.flows, home));
  else if ((tagText === 'want:stay' || tagText === 'want:move') && ctx.start !== null && ctx.start !== undefined) focus.modules = [ctx.start];
  if (focus.modules.length === 0 && focus.lines.length === 0 && focus.rings.length === 0 && focus.level === null) focus.modules = [home.id];
  focus.modules = [...new Set(focus.modules)];
  return focus;
}
