import { BED_MM, MAX_OVERHANG_DEG, MAX_BRIDGE_MM, MIN_WALL_MM, MIN_BED_CONTACT_MM2 } from '../config.js';
import { edgeMap, faceNormals, meshStats } from './meshtools.js';

const ANGLE_TOL_DEG = 0.5; // slack on the overhang limit
const FLAT_TOL_DEG = 1; // faces this close to level count as flat
const BASE_TOL_MM = 0.01; // faces this close to the bed touch it
const SIZE_TOL_MM = 0.01; // slack on the bed size
const MIN_FACE_MM2 = 0.01; // smaller triangles are ignored
const WALL_TOL_MM = 0.02; // slack on the wall limit
const WALL_PARALLEL_DEG = 30; // far face counts if this parallel
const WALL_GRID_MM = 4; // search grid cell
const RAY_START_MM = 1e-3; // ray hits closer than this are ignored
const SAMPLE_MAX = 60; // bridge samples per side
const SAMPLE_MM = [0.25, 1]; // bridge sample spacing range

const degrees = (radians) => (radians * 180) / Math.PI;

function segmentDistance(pointX, pointY, segment) {
  const [fromX, fromY, toX, toY] = segment;
  const spanX = toX - fromX;
  const spanY = toY - fromY;
  const lengthSq = spanX * spanX + spanY * spanY;
  const share = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((pointX - fromX) * spanX + (pointY - fromY) * spanY) / lengthSq));
  return Math.hypot(pointX - fromX - spanX * share, pointY - fromY - spanY * share);
}

function inTriangle(pointX, pointY, triangle) {
  const [aX, aY, bX, bY, cX, cY] = triangle;
  const first = (bX - aX) * (pointY - aY) - (bY - aY) * (pointX - aX);
  const second = (cX - bX) * (pointY - bY) - (cY - bY) * (pointX - bX);
  const third = (aX - cX) * (pointY - cY) - (aY - cY) * (pointX - cX);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}

// Widest unsupported flat underside, as a bridge span
function bridgeSpan(mesh, flat, edges, vertexCount) {
  const { positions, index } = mesh;
  const parent = new Map();
  const find = (face) => {
    let root = face;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(face, root);
    return root;
  };
  for (const face of flat) parent.set(face, face);
  const neighbour = (face, corner) => {
    const from = index[face * 3 + corner];
    const to = index[face * 3 + ((corner + 1) % 3)];
    return edges.get(to * vertexCount + from);
  };
  for (const face of flat) {
    for (let corner = 0; corner < 3; corner++) {
      const other = neighbour(face, corner);
      if (other !== undefined && parent.has(other)) parent.set(find(face), find(other));
    }
  }
  const regions = new Map();
  for (const face of flat) {
    const root = find(face);
    if (!regions.has(root)) regions.set(root, { triangles: [], supports: [], points: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const region = regions.get(root);
    const triangle = [];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index[face * 3 + corner] * 3;
      triangle.push(positions[vertex], positions[vertex + 1]);
      region.points.push([positions[vertex], positions[vertex + 1]]);
      region.minX = Math.min(region.minX, positions[vertex]);
      region.maxX = Math.max(region.maxX, positions[vertex]);
      region.minY = Math.min(region.minY, positions[vertex + 1]);
      region.maxY = Math.max(region.maxY, positions[vertex + 1]);
    }
    region.triangles.push(triangle);
    region.points.push([(triangle[0] + triangle[2] + triangle[4]) / 3, (triangle[1] + triangle[3] + triangle[5]) / 3]);
    const level = positions[index[face * 3] * 3 + 2];
    for (let corner = 0; corner < 3; corner++) {
      const other = neighbour(face, corner);
      if (other === undefined || parent.has(other)) continue;
      let lowest = Infinity;
      for (let otherCorner = 0; otherCorner < 3; otherCorner++) lowest = Math.min(lowest, positions[index[other * 3 + otherCorner] * 3 + 2]);
      if (lowest >= level - BASE_TOL_MM) continue;
      const from = index[face * 3 + corner] * 3;
      const to = index[face * 3 + ((corner + 1) % 3)] * 3;
      region.supports.push([positions[from], positions[from + 1], positions[to], positions[to + 1]]);
    }
  }
  let worst = 0;
  for (const region of regions.values()) {
    const width = region.maxX - region.minX;
    const depth = region.maxY - region.minY;
    if (region.supports.length === 0) {
      worst = Math.max(worst, Math.min(width, depth));
      continue;
    }
    const reach = (pointX, pointY) => {
      let nearest = Infinity;
      for (const segment of region.supports) nearest = Math.min(nearest, segmentDistance(pointX, pointY, segment));
      return nearest;
    };
    let farthest = 0;
    for (const [pointX, pointY] of region.points) farthest = Math.max(farthest, reach(pointX, pointY));
    if (Math.hypot(width, depth) > MAX_BRIDGE_MM / 2) {
      const step = Math.min(SAMPLE_MM[1], Math.max(SAMPLE_MM[0], Math.max(width, depth) / SAMPLE_MAX));
      for (let pointX = region.minX + step / 2; pointX < region.maxX; pointX += step) {
        for (let pointY = region.minY + step / 2; pointY < region.maxY; pointY += step) {
          if (region.triangles.some((triangle) => inTriangle(pointX, pointY, triangle))) farthest = Math.max(farthest, reach(pointX, pointY));
        }
      }
    }
    worst = Math.max(worst, farthest * 2);
  }
  return worst;
}

function rayTriangle(origin, direction, positions, a, b, c) {
  const edge1X = positions[b] - positions[a], edge1Y = positions[b + 1] - positions[a + 1], edge1Z = positions[b + 2] - positions[a + 2];
  const edge2X = positions[c] - positions[a], edge2Y = positions[c + 1] - positions[a + 1], edge2Z = positions[c + 2] - positions[a + 2];
  const crossX = direction[1] * edge2Z - direction[2] * edge2Y;
  const crossY = direction[2] * edge2X - direction[0] * edge2Z;
  const crossZ = direction[0] * edge2Y - direction[1] * edge2X;
  const determinant = edge1X * crossX + edge1Y * crossY + edge1Z * crossZ;
  if (Math.abs(determinant) < 1e-12) return Infinity;
  const inverse = 1 / determinant;
  const offsetX = origin[0] - positions[a], offsetY = origin[1] - positions[a + 1], offsetZ = origin[2] - positions[a + 2];
  const weightB = (offsetX * crossX + offsetY * crossY + offsetZ * crossZ) * inverse;
  if (weightB < 0 || weightB > 1) return Infinity;
  const qX = offsetY * edge1Z - offsetZ * edge1Y;
  const qY = offsetZ * edge1X - offsetX * edge1Z;
  const qZ = offsetX * edge1Y - offsetY * edge1X;
  const weightC = (direction[0] * qX + direction[1] * qY + direction[2] * qZ) * inverse;
  if (weightC < 0 || weightB + weightC > 1) return Infinity;
  return (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverse;
}

// Thinnest solid between two near parallel faces
function thinnestWall(mesh, normals, areas, limit) {
  const { positions, index } = mesh;
  const faceCount = index.length / 3;
  const grid = new Map();
  const cellOf = (value) => Math.floor(value / WALL_GRID_MM);
  const cellKey = (cellX, cellY, cellZ) => (cellX + 512) * 1048576 + (cellY + 512) * 1024 + (cellZ + 512);
  for (let face = 0; face < faceCount; face++) {
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index[face * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], positions[vertex + axis]);
        high[axis] = Math.max(high[axis], positions[vertex + axis]);
      }
    }
    for (let cellX = cellOf(low[0]); cellX <= cellOf(high[0]); cellX++) {
      for (let cellY = cellOf(low[1]); cellY <= cellOf(high[1]); cellY++) {
        for (let cellZ = cellOf(low[2]); cellZ <= cellOf(high[2]); cellZ++) {
          const key = cellKey(cellX, cellY, cellZ);
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(face);
        }
      }
    }
  }
  const parallel = Math.cos((WALL_PARALLEL_DEG * Math.PI) / 180);
  let thinnest = Infinity;
  let where = null;
  for (let face = 0; face < faceCount; face++) {
    if (areas[face] < MIN_FACE_MM2) continue;
    const a = index[face * 3] * 3, b = index[face * 3 + 1] * 3, c = index[face * 3 + 2] * 3;
    const origin = [
      (positions[a] + positions[b] + positions[c]) / 3,
      (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3,
      (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3,
    ];
    const direction = [-normals[face * 3], -normals[face * 3 + 1], -normals[face * 3 + 2]];
    const end = [origin[0] + direction[0] * limit, origin[1] + direction[1] * limit, origin[2] + direction[2] * limit];
    let nearest = limit;
    let nearestFace = -1;
    for (let cellX = cellOf(Math.min(origin[0], end[0])); cellX <= cellOf(Math.max(origin[0], end[0])); cellX++) {
      for (let cellY = cellOf(Math.min(origin[1], end[1])); cellY <= cellOf(Math.max(origin[1], end[1])); cellY++) {
        for (let cellZ = cellOf(Math.min(origin[2], end[2])); cellZ <= cellOf(Math.max(origin[2], end[2])); cellZ++) {
          const bucket = grid.get(cellKey(cellX, cellY, cellZ));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === face) continue;
            const distance = rayTriangle(origin, direction, positions, index[other * 3] * 3, index[other * 3 + 1] * 3, index[other * 3 + 2] * 3);
            if (distance > RAY_START_MM && distance < nearest) {
              nearest = distance;
              nearestFace = other;
            }
          }
        }
      }
    }
    if (nearestFace < 0) continue;
    const facing = normals[nearestFace * 3] * direction[0] + normals[nearestFace * 3 + 1] * direction[1] + normals[nearestFace * 3 + 2] * direction[2];
    if (facing > parallel && nearest < thinnest) {
      thinnest = nearest;
      where = origin;
    }
  }
  return { thinnest, where };
}

// Mesh is in print orientation, base down. Options: pieces
export function checkPrintability(mesh, options = {}) {
  const stats = meshStats(mesh);
  const { normals, areas } = faceNormals(mesh);
  const { edges, vertexCount } = edgeMap(mesh);
  const { positions, index } = mesh;
  const faceCount = index.length / 3;
  const size = [stats.max[0] - stats.min[0], stats.max[1] - stats.min[1], stats.max[2] - stats.min[2]];
  let baseArea = 0;
  let steepest = 0;
  const flat = [];
  for (let face = 0; face < faceCount; face++) {
    const down = -normals[face * 3 + 2];
    if (down <= 0 || areas[face] < MIN_FACE_MM2) continue;
    const tilt = degrees(Math.asin(Math.min(1, down)));
    const height = Math.max(positions[index[face * 3] * 3 + 2], positions[index[face * 3 + 1] * 3 + 2], positions[index[face * 3 + 2] * 3 + 2]);
    if (tilt >= 90 - FLAT_TOL_DEG) {
      if (height <= stats.min[2] + BASE_TOL_MM) baseArea += areas[face];
      else flat.push(face);
    } else {
      steepest = Math.max(steepest, tilt);
    }
  }
  const span = bridgeSpan(mesh, flat, edges, vertexCount);
  const wall = thinnestWall(mesh, normals, areas, MIN_WALL_MM - WALL_TOL_MM);
  const pieces = options.pieces === undefined ? 1 : options.pieces;
  const verdict = (ok) => (ok ? 'pass' : 'fail');
  const rules = {
    size: { status: verdict(size.every((length) => length <= BED_MM + SIZE_TOL_MM)), value: size },
    base: { status: verdict(baseArea >= MIN_BED_CONTACT_MM2), value: baseArea },
    overhang: { status: verdict(steepest <= MAX_OVERHANG_DEG + ANGLE_TOL_DEG), value: steepest },
    bridge: { status: verdict(span <= MAX_BRIDGE_MM), value: span },
    wall: { status: verdict(wall.thinnest === Infinity), value: wall.thinnest === Infinity ? null : wall.thinnest, at: wall.where },
    solid: { status: verdict(stats.watertight && stats.volume > 0 && pieces === 1), value: pieces },
  };
  const status = Object.values(rules).every((rule) => rule.status === 'pass') ? 'pass' : 'fail';
  return { status, rules };
}
