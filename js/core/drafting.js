import { CELL_MM, STORY_MM, PEG_SIZE_MM, RAIL_OFFSET_MM } from '../config.js';
import { SIDES, instanceCells, instancePose, poseApply } from './grid.js';
import { FAMILIES, canSupport, sideType } from './catalog.js';

const CENTER_MARK_MM = 3; // half length of a center of mass cross
const SEAT_MARK_MM = 2.5; // half width of a plinth seat tick
const LIFT_MM = 0.2; // marks sit off the surface

// All results: { positions: number[], statuses: string[] }, one status per segment
const sheet = () => ({ positions: [], statuses: [] });
function segment(target, from, to, status) {
  target.positions.push(from[0], from[1], from[2], to[0], to[1], to[2]);
  target.statuses.push(status);
}

export function centerMarks(checks) {
  const marks = sheet();
  for (const entry of Object.values(checks.modules)) {
    const [centerX, centerY, centerZ] = entry.com;
    const status = entry.stability.status;
    segment(marks, [centerX - CENTER_MARK_MM, centerY, centerZ], [centerX + CENTER_MARK_MM, centerY, centerZ], status);
    segment(marks, [centerX, centerY - CENTER_MARK_MM, centerZ], [centerX, centerY + CENTER_MARK_MM, centerZ], status);
    segment(marks, [centerX, centerY, centerZ - CENTER_MARK_MM], [centerX, centerY, centerZ + CENTER_MARK_MM], status);
  }
  return marks;
}

// Center of mass to contact point to the support below
export function loadPaths(checks) {
  const paths = sheet();
  for (const contact of checks.interfaces) {
    const upper = checks.modules[contact.upper];
    if (!upper) continue;
    segment(paths, upper.com, contact.at, contact.status);
    if (contact.lower === 0) {
      const [seatX, seatY, seatZ] = contact.at;
      segment(paths, [seatX - SEAT_MARK_MM, seatY, seatZ + LIFT_MM], [seatX + SEAT_MARK_MM, seatY, seatZ + LIFT_MM], contact.status);
      segment(paths, [seatX, seatY - SEAT_MARK_MM, seatZ + LIFT_MM], [seatX, seatY + SEAT_MARK_MM, seatZ + LIFT_MM], contact.status);
    } else if (checks.modules[contact.lower]) {
      segment(paths, contact.at, checks.modules[contact.lower].com, contact.status);
    }
  }
  return paths;
}

// Peg sockets on tops and rail lines on connector sides
export function connectorMarks(modules) {
  const marks = sheet();
  const half = PEG_SIZE_MM / 2;
  for (const instance of modules) {
    const family = FAMILIES[instance.family];
    const low = instance.z * STORY_MM;
    const high = (instance.z + instance.h) * STORY_MM;
    const cells = instanceCells(instance);
    if (family.stack && canSupport(instance)) {
      for (const [cellX, cellY] of cells) {
        const centerX = (cellX + 0.5) * CELL_MM;
        const centerY = (cellY + 0.5) * CELL_MM;
        const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
        corners.forEach(([offsetX, offsetY], index) => {
          const [nextX, nextY] = corners[(index + 1) % 4];
          segment(marks, [centerX + offsetX, centerY + offsetY, high + LIFT_MM], [centerX + nextX, centerY + nextY, high + LIFT_MM], 'line');
        });
      }
    }
    if (!family.rails) continue;
    for (let side = 0; side < 4; side++) {
      if (sideType(instance, side) !== 'connector') continue;
      const [stepX, stepY] = SIDES[side];
      for (const [cellX, cellY] of cells) {
        if (cells.some((cell) => cell[0] === cellX + stepX && cell[1] === cellY + stepY)) continue;
        const faceX = (cellX + 0.5 + stepX / 2) * CELL_MM;
        const faceY = (cellY + 0.5 + stepY / 2) * CELL_MM;
        for (const offset of [-RAIL_OFFSET_MM, RAIL_OFFSET_MM]) {
          const railX = faceX - stepY * offset;
          const railY = faceY + stepX * offset;
          segment(marks, [railX, railY, low], [railX, railY, high], 'line');
        }
      }
    }
  }
  return marks;
}

// Crease edges of every module moved to world space
export function edgeLines(modules, edgesOf) {
  const positions = [];
  for (const instance of modules) {
    const edges = edgesOf(instance);
    if (!edges) continue;
    const pose = instancePose(instance);
    for (let offset = 0; offset < edges.length; offset += 3) {
      positions.push(...poseApply(pose, edges[offset], edges[offset + 1], edges[offset + 2]));
    }
  }
  return positions;
}
