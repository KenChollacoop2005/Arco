// Mesh shape: { positions: Float32Array, index: Uint32Array }

export function faceNormals(mesh) {
  const { positions, index } = mesh;
  const count = index.length / 3;
  const normals = new Float64Array(count * 3);
  const areas = new Float64Array(count);
  for (let face = 0; face < count; face++) {
    const a = index[face * 3] * 3;
    const b = index[face * 3 + 1] * 3;
    const c = index[face * 3 + 2] * 3;
    const abX = positions[b] - positions[a];
    const abY = positions[b + 1] - positions[a + 1];
    const abZ = positions[b + 2] - positions[a + 2];
    const acX = positions[c] - positions[a];
    const acY = positions[c + 1] - positions[a + 1];
    const acZ = positions[c + 2] - positions[a + 2];
    const crossX = abY * acZ - abZ * acY;
    const crossY = abZ * acX - abX * acZ;
    const crossZ = abX * acY - abY * acX;
    const length = Math.hypot(crossX, crossY, crossZ);
    areas[face] = length / 2;
    if (length > 0) {
      normals[face * 3] = crossX / length;
      normals[face * 3 + 1] = crossY / length;
      normals[face * 3 + 2] = crossZ / length;
    }
  }
  return { normals, areas };
}

// Directed edge key to face index
export function edgeMap(mesh) {
  const { positions, index } = mesh;
  const vertexCount = positions.length / 3;
  const edges = new Map();
  let duplicates = 0;
  for (let face = 0; face < index.length / 3; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const from = index[face * 3 + corner];
      const to = index[face * 3 + ((corner + 1) % 3)];
      const key = from * vertexCount + to;
      if (edges.has(key)) duplicates++;
      edges.set(key, face);
    }
  }
  return { edges, vertexCount, duplicates };
}

export function meshStats(mesh) {
  const { positions, index } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  let volume = 0;
  for (let face = 0; face < index.length / 3; face++) {
    const a = index[face * 3] * 3;
    const b = index[face * 3 + 1] * 3;
    const c = index[face * 3 + 2] * 3;
    volume +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  volume /= 6;
  const { edges, vertexCount, duplicates } = edgeMap(mesh);
  let watertight = duplicates === 0 && index.length > 0;
  if (watertight) {
    for (const key of edges.keys()) {
      const from = Math.floor(key / vertexCount);
      const to = key - from * vertexCount;
      if (!edges.has(to * vertexCount + from)) {
        watertight = false;
        break;
      }
    }
  }
  return { triangles: index.length / 3, volume, min, max, watertight };
}

// Line segments along sharp edges
export function creaseEdges(mesh, angleDeg) {
  const { positions } = mesh;
  const { normals } = faceNormals(mesh);
  const { edges, vertexCount } = edgeMap(mesh);
  const limit = Math.cos((angleDeg * Math.PI) / 180);
  const segments = [];
  for (const [key, face] of edges) {
    const from = Math.floor(key / vertexCount);
    const to = key - from * vertexCount;
    if (from > to) continue;
    const other = edges.get(to * vertexCount + from);
    if (other === undefined) continue;
    const dot =
      normals[face * 3] * normals[other * 3] +
      normals[face * 3 + 1] * normals[other * 3 + 1] +
      normals[face * 3 + 2] * normals[other * 3 + 2];
    if (dot < limit) {
      segments.push(
        positions[from * 3], positions[from * 3 + 1], positions[from * 3 + 2],
        positions[to * 3], positions[to * 3 + 1], positions[to * 3 + 2]
      );
    }
  }
  return new Float32Array(segments);
}

const QUARTER_TURNS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // cos and sin per turn

// Quarter turns about z, then a shift
export function moveMesh(mesh, turns, shiftX, shiftY, shiftZ) {
  const [cos, sin] = QUARTER_TURNS[turns & 3];
  const positions = new Float32Array(mesh.positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const localX = mesh.positions[offset];
    const localY = mesh.positions[offset + 1];
    positions[offset] = shiftX + localX * cos - localY * sin;
    positions[offset + 1] = shiftY + localX * sin + localY * cos;
    positions[offset + 2] = shiftZ + mesh.positions[offset + 2];
  }
  return { positions, index: mesh.index };
}

export function mergeMeshes(meshes) {
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const mesh of meshes) {
    vertexTotal += mesh.positions.length / 3;
    indexTotal += mesh.index.length;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const index = new Uint32Array(indexTotal);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertexOffset * 3);
    for (let corner = 0; corner < mesh.index.length; corner++) index[indexOffset + corner] = mesh.index[corner] + vertexOffset;
    vertexOffset += mesh.positions.length / 3;
    indexOffset += mesh.index.length;
  }
  return { positions, index };
}

// Joins vertices at the same spot, drops collapsed triangles
export function weldMesh(mesh) {
  const bits = new Uint32Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.length);
  const lookup = new Map();
  const remap = new Uint32Array(mesh.positions.length / 3);
  const kept = [];
  for (let vertex = 0; vertex < remap.length; vertex++) {
    // Adding zero folds minus zero into zero
    const key = (mesh.positions[vertex * 3] + 0 === 0 ? 0 : bits[vertex * 3]) + ':' +
      (mesh.positions[vertex * 3 + 1] + 0 === 0 ? 0 : bits[vertex * 3 + 1]) + ':' +
      (mesh.positions[vertex * 3 + 2] + 0 === 0 ? 0 : bits[vertex * 3 + 2]);
    let target = lookup.get(key);
    if (target === undefined) {
      target = kept.length / 3;
      lookup.set(key, target);
      kept.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
    }
    remap[vertex] = target;
  }
  const faces = [];
  const facing = new Map();
  for (let face = 0; face < mesh.index.length; face += 3) {
    const a = remap[mesh.index[face]];
    const b = remap[mesh.index[face + 1]];
    const c = remap[mesh.index[face + 2]];
    if (a === b || b === c || a === c) continue;
    // Rotate so the lowest vertex leads
    const turned = a < b && a < c ? [a, b, c] : b < c ? [b, c, a] : [c, a, b];
    const mirror = facing.get(turned[0] + ':' + turned[2] + ':' + turned[1]);
    if (mirror !== undefined && faces[mirror]) {
      // Two faces back to back enclose nothing
      faces[mirror] = null;
      continue;
    }
    facing.set(turned.join(':'), faces.length);
    faces.push(turned);
  }
  const index = faces.filter(Boolean).flat();
  return { positions: new Float32Array(kept), index: new Uint32Array(index) };
}

// Smallest gap between two meshes, vertex to face
export function meshGap(meshA, meshB) {
  return Math.min(vertexToMesh(meshA, meshB), vertexToMesh(meshB, meshA));
}

function vertexToMesh(points, mesh) {
  let best = Infinity;
  const { positions, index } = mesh;
  for (let offset = 0; offset < points.positions.length; offset += 3) {
    const pointX = points.positions[offset];
    const pointY = points.positions[offset + 1];
    const pointZ = points.positions[offset + 2];
    for (let face = 0; face < index.length; face += 3) {
      const distance = pointTriangle(pointX, pointY, pointZ, positions, index[face] * 3, index[face + 1] * 3, index[face + 2] * 3);
      if (distance < best) best = distance;
    }
  }
  return best;
}

function pointTriangle(pointX, pointY, pointZ, positions, a, b, c) {
  const abX = positions[b] - positions[a], abY = positions[b + 1] - positions[a + 1], abZ = positions[b + 2] - positions[a + 2];
  const acX = positions[c] - positions[a], acY = positions[c + 1] - positions[a + 1], acZ = positions[c + 2] - positions[a + 2];
  const apX = pointX - positions[a], apY = pointY - positions[a + 1], apZ = pointZ - positions[a + 2];
  const d1 = abX * apX + abY * apY + abZ * apZ;
  const d2 = acX * apX + acY * apY + acZ * apZ;
  let closestX, closestY, closestZ;
  const at = (weightB, weightC) => {
    closestX = positions[a] + abX * weightB + acX * weightC;
    closestY = positions[a + 1] + abY * weightB + acY * weightC;
    closestZ = positions[a + 2] + abZ * weightB + acZ * weightC;
  };
  const bpX = pointX - positions[b], bpY = pointY - positions[b + 1], bpZ = pointZ - positions[b + 2];
  const d3 = abX * bpX + abY * bpY + abZ * bpZ;
  const d4 = acX * bpX + acY * bpY + acZ * bpZ;
  const cpX = pointX - positions[c], cpY = pointY - positions[c + 1], cpZ = pointZ - positions[c + 2];
  const d5 = abX * cpX + abY * cpY + abZ * cpZ;
  const d6 = acX * cpX + acY * cpY + acZ * cpZ;
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) at(0, 0);
  else if (d3 >= 0 && d4 <= d3) at(1, 0);
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) at(d1 / (d1 - d3), 0);
  else if (d6 >= 0 && d5 <= d6) at(0, 1);
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) at(0, d2 / (d2 - d6));
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const along = (d4 - d3) / (d4 - d3 + (d5 - d6));
    at(1 - along, along);
  } else {
    const scale = 1 / (va + vb + vc);
    at(vb * scale, vc * scale);
  }
  return Math.hypot(pointX - closestX, pointY - closestY, pointZ - closestZ);
}
