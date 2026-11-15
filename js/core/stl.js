const HEADER_BYTES = 80; // binary STL header size
const FACET_BYTES = 50; // bytes per triangle record

// Binary STL from { positions, index }
export function writeStl(mesh, label = '') {
  const { positions, index } = mesh;
  const count = index.length / 3;
  const bytes = new Uint8Array(HEADER_BYTES + 4 + count * FACET_BYTES);
  const view = new DataView(bytes.buffer);
  const title = ('Arco ' + label).slice(0, HEADER_BYTES - 1);
  for (let letter = 0; letter < title.length; letter++) bytes[letter] = title.charCodeAt(letter) & 127;
  view.setUint32(HEADER_BYTES, count, true);
  let at = HEADER_BYTES + 4;
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
    const normal = [abY * acZ - abZ * acY, abZ * acX - abX * acZ, abX * acY - abY * acX];
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    for (let axis = 0; axis < 3; axis++) view.setFloat32(at + axis * 4, normal[axis] / length, true);
    for (const [slot, vertex] of [[12, a], [24, b], [36, c]]) {
      for (let axis = 0; axis < 3; axis++) view.setFloat32(at + slot + axis * 4, positions[vertex + axis], true);
    }
    at += FACET_BYTES;
  }
  return bytes;
}

// Binary STL back to a welded mesh
export function parseStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER_BYTES, true);
  if (bytes.byteLength !== HEADER_BYTES + 4 + count * FACET_BYTES) throw new Error('STL size does not match its triangle count');
  const lookup = new Map();
  const positions = [];
  const index = new Uint32Array(count * 3);
  let at = HEADER_BYTES + 4;
  for (let face = 0; face < count; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const from = at + 12 + corner * 12;
      const key = view.getUint32(from, true) + ':' + view.getUint32(from + 4, true) + ':' + view.getUint32(from + 8, true);
      let vertex = lookup.get(key);
      if (vertex === undefined) {
        vertex = positions.length / 3;
        lookup.set(key, vertex);
        positions.push(view.getFloat32(from, true), view.getFloat32(from + 4, true), view.getFloat32(from + 8, true));
      }
      index[face * 3 + corner] = vertex;
    }
    at += FACET_BYTES;
  }
  return { positions: new Float32Array(positions), index };
}
