import { CELL_MM, STORY_MM, PEG_SIZE_MM, RAIL_OFFSET_MM } from '../config.js';
import { SIDES, instanceCells, instancePose, poseApply } from './grid.js';
import { FAMILIES, canSupport, sideType } from './catalog.js';

const CENTER_MARK_MM = 3; // half length of a center of mass cross
const SEAT_MARK_MM = 2.5; // half width of a plinth seat tick
const LIFT_MM = 0.2; // marks sit off the surface
const DASH_MM = 2; // dash length on a blocked string
const DASH_GAP_MM = 1.5; // gap between dashes on a blocked string
const CONSUMER_MARK_MM = 4; // half width of a dry or partial diamond
const CONSUMER_MARKS = { dry: 'fail', partial: 'warn' }; // consumer status to line status
const STRING_STATUS = { pipe: 'water', wire: 'power' }; // string type to line status

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

// One polyline, solid or dashed
function polyline(target, points, status, dashed) {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (!dashed) {
      segment(target, from, to, status);
      continue;
    }
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const at = (share) => from.map((value, axis) => value + (to[axis] - value) * share);
    for (let start = 0; start < length; start += DASH_MM + DASH_GAP_MM) {
      segment(target, at(start / length), at(Math.min(length, start + DASH_MM) / length), status);
    }
  }
}

// Diamond on a consumer's roof, crossed when dry
function consumerMark(target, instance, status) {
  const cells = instanceCells(instance);
  const centerX = (cells.reduce((sum, cell) => sum + cell[0], 0) / cells.length + 0.5) * CELL_MM;
  const centerY = (cells.reduce((sum, cell) => sum + cell[1], 0) / cells.length + 0.5) * CELL_MM;
  const top = (instance.z + instance.h) * STORY_MM + LIFT_MM;
  const size = CONSUMER_MARK_MM;
  const corners = [[size, 0], [0, size], [-size, 0], [0, -size]].map(([offsetX, offsetY]) => [centerX + offsetX, centerY + offsetY, top]);
  corners.forEach((corner, index) => segment(target, corner, corners[(index + 1) % 4], CONSUMER_MARKS[status]));
  if (status !== 'dry') return;
  const half = size / 2;
  segment(target, [centerX - half, centerY - half, top], [centerX + half, centerY + half, top], 'fail');
  segment(target, [centerX - half, centerY + half, top], [centerX + half, centerY - half, top], 'fail');
}

// Services from the strings: pipes and overflow as 'water', cables as 'power', blocked dashed
export function serviceLines(services, modules = []) {
  const target = sheet();
  if (!services) return target;
  for (const pipe of services.pipes) polyline(target, pipe.points, 'water', false);
  for (const overflow of services.sheets) polyline(target, overflow.points, 'water', false);
  for (const wire of services.wires) polyline(target, wire.points, 'power', false);
  for (const string of services.blocked) polyline(target, string.points, STRING_STATUS[string.type], true);
  const byId = new Map(modules.map((instance) => [instance.id, instance]));
  for (const [id, report] of Object.entries(services.water.consumers)) {
    const instance = byId.get(Number(id));
    if (instance && CONSUMER_MARKS[report.status]) consumerMark(target, instance, report.status);
  }
  return target;
}
