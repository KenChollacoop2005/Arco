import { CELL_MM, STORY_MM } from '../config.js';

export const SUPPORT_FAMILIES = ['support']; // families that spread what they carry
export const GROUP_REACH = 1; // cells a group reaches past its support, so at most 3 by 3

const sideBySide = (first, second) => first.cells.some(([x, y]) => second.cells.some(([otherX, otherY]) => Math.abs(otherX - x) + Math.abs(otherY - y) === 1));

// Rigid groups: the module right on a support plus the modules joined to it at that level, all inside the 3 by 3 window
export function rigidGroups(items) {
  const groups = [];
  const taken = new Set();
  const supports = items.filter((item) => item.support && item.cells.length === 1).sort((first, second) => first.z1 - second.z1 || first.id - second.id);
  for (const support of supports) {
    const [cellX, cellY] = support.cells[0];
    const level = items.filter((item) => !item.support && item.z0 === support.z1 && !taken.has(item.id));
    const above = level.find((item) => item.cells.some(([x, y]) => x === cellX && y === cellY));
    if (!above) continue;
    const inWindow = (item) => item.cells.every(([x, y]) => Math.abs(x - cellX) <= GROUP_REACH && Math.abs(y - cellY) <= GROUP_REACH);
    if (!inWindow(above)) continue;
    // Everything in the window joined to it side by side, corners through their neighbours
    const members = [above];
    const pool = level.filter((item) => item !== above && inWindow(item));
    for (let grew = true; grew; ) {
      grew = false;
      for (const item of pool) {
        if (members.includes(item) || !members.some((member) => sideBySide(item, member))) continue;
        members.push(item);
        grew = true;
      }
    }
    members.sort((first, second) => first.id - second.id);
    if (members.length < 2) continue;
    for (const member of members) taken.add(member.id);
    groups.push({ support: support.id, members: members.map((member) => member.id) });
  }
  return groups;
}

// Group items from placed modules, in cells and stories
export const moduleItems = (modules, cellsOf) => modules.map((instance) => ({ id: instance.id, cells: cellsOf(instance), z0: instance.z, z1: instance.z + instance.h, support: SUPPORT_FAMILIES.includes(instance.family) }));

// Group items from stability bodies: cell rectangles and heights in mm
export const bodyItems = (bodies) => bodies.map((body) => ({
  id: body.id,
  cells: body.rects.map(([minX, minY]) => [Math.round(minX / CELL_MM), Math.round(minY / CELL_MM)]),
  z0: Math.round(body.z0 / STORY_MM),
  z1: Math.round(body.z1 / STORY_MM),
  support: !!body.support,
}));

// True when a module would hang as a member of a support's group
export function groupCarried(modules, instance, cellsOf) {
  const items = moduleItems([...modules.filter((other) => other.id !== instance.id), instance], cellsOf);
  return rigidGroups(items).some((group) => group.members.includes(instance.id));
}
