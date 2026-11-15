import { CONNECTOR_CLEARANCE_MM } from '../config.js';
import { GROUPS, KIND_SPIN, KIND_SWAY } from './palette.js';
import { buildRecipe } from './recipes.js';
import { creaseEdges } from './meshtools.js';

const CREASE_DEG = 28; // edge angle drawn as a line

export async function loadManifold(factory, options = {}) {
  const wasm = await factory(options);
  wasm.setup();
  return wasm;
}

export function createSolids(wasm) {
  const { Manifold } = wasm;

  function shapeSolid(shape, bin) {
    const keep = (solid) => {
      bin.add(solid);
      return solid;
    };
    if (shape.kind === 'box') {
      const size = [shape.max[0] - shape.min[0], shape.max[1] - shape.min[1], shape.max[2] - shape.min[2]];
      return keep(keep(Manifold.cube(size)).translate(shape.min));
    }
    if (shape.kind === 'cyl') {
      const solid = keep(Manifold.cylinder(shape.to - shape.from, shape.radiusLow, shape.radiusHigh, shape.sides));
      const turned = shape.turnDeg ? keep(solid.rotate([0, 0, shape.turnDeg])) : solid;
      return keep(turned.translate([shape.center[0], shape.center[1], shape.from]));
    }
    let [axisA, axisB, axisC] = shape.axes;
    let poly = shape.poly;
    const handed =
      axisA[0] * (axisB[1] * axisC[2] - axisB[2] * axisC[1]) -
      axisA[1] * (axisB[0] * axisC[2] - axisB[2] * axisC[0]) +
      axisA[2] * (axisB[0] * axisC[1] - axisB[1] * axisC[0]);
    if (handed < 0) {
      [axisA, axisB] = [axisB, axisA];
      poly = poly.map(([first, second]) => [second, first]);
    }
    let area = 0;
    for (let index = 0; index < poly.length; index++) {
      const [fromA, fromB] = poly[index];
      const [toA, toB] = poly[(index + 1) % poly.length];
      area += fromA * toB - toA * fromB;
    }
    if (area < 0) poly = poly.slice().reverse();
    const raised = keep(keep(Manifold.extrude([poly], shape.to - shape.from)).translate([0, 0, shape.from]));
    return keep(
      raised.transform([
        axisA[0], axisA[1], axisA[2], 0,
        axisB[0], axisB[1], axisB[2], 0,
        axisC[0], axisC[1], axisC[2], 0,
        shape.origin[0], shape.origin[1], shape.origin[2], 1,
      ])
    );
  }

  // Adds and cuts applied in order
  function fold(ops, bin, start = null) {
    let current = start;
    let batch = [];
    let cutting = false;
    const flush = () => {
      if (batch.length === 0) return;
      const merged = batch.length === 1 ? batch[0] : Manifold.union(batch);
      bin.add(merged);
      if (cutting) {
        if (current) {
          current = Manifold.difference(current, merged);
          bin.add(current);
        }
      } else if (current) {
        current = Manifold.union(current, merged);
        bin.add(current);
      } else {
        current = merged;
      }
      batch = [];
    };
    for (const op of ops) {
      if (op.cut !== cutting) {
        flush();
        cutting = op.cut;
      }
      batch.push(shapeSolid(op.shape, bin));
    }
    flush();
    return current;
  }

  function toMesh(solid) {
    const mesh = solid.getMesh();
    const stride = mesh.numProp;
    const count = mesh.vertProperties.length / stride;
    const positions = new Float32Array(count * 3);
    for (let vertex = 0; vertex < count; vertex++) {
      positions[vertex * 3] = mesh.vertProperties[vertex * stride];
      positions[vertex * 3 + 1] = mesh.vertProperties[vertex * stride + 1];
      positions[vertex * 3 + 2] = mesh.vertProperties[vertex * stride + 2];
    }
    return { positions, index: new Uint32Array(mesh.triVerts) };
  }

  function groupSolids(ops, bin) {
    const byGroup = new Map();
    for (const op of ops) {
      if (!byGroup.has(op.group)) byGroup.set(op.group, []);
      byGroup.get(op.group).push(op);
    }
    const solids = new Map();
    for (const [group, groupOps] of byGroup) {
      const solid = fold(groupOps, bin);
      if (solid && !solid.isEmpty()) solids.set(group, solid);
    }
    return solids;
  }

  function mergeRender(solids, anchors) {
    const parts = [];
    let vertexTotal = 0;
    let indexTotal = 0;
    for (const [group, solid] of solids) {
      const mesh = toMesh(solid);
      parts.push({ group, mesh });
      vertexTotal += mesh.positions.length / 3;
      indexTotal += mesh.index.length;
    }
    const positions = new Float32Array(vertexTotal * 3);
    const colors = new Uint8Array(vertexTotal * 3);
    const meta = new Float32Array(vertexTotal * 3);
    const index = new Uint32Array(indexTotal);
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const { group, mesh } of parts) {
      const [color, kind] = GROUPS[group];
      const count = mesh.positions.length / 3;
      positions.set(mesh.positions, vertexOffset * 3);
      for (let vertex = 0; vertex < count; vertex++) {
        const at = (vertexOffset + vertex) * 3;
        colors[at] = (color >> 16) & 255;
        colors[at + 1] = (color >> 8) & 255;
        colors[at + 2] = color & 255;
        meta[at] = kind;
        if (kind === KIND_SPIN && anchors.spin) {
          meta[at + 1] = anchors.spin[0];
          meta[at + 2] = anchors.spin[1];
        } else if (kind === KIND_SWAY) {
          meta[at + 1] = 1;
        }
      }
      for (let corner = 0; corner < mesh.index.length; corner++) {
        index[indexOffset + corner] = mesh.index[corner] + vertexOffset;
      }
      vertexOffset += count;
      indexOffset += mesh.index.length;
    }
    return { positions, colors, meta, index };
  }

  function printedUnion(solids, bin) {
    const printed = [];
    for (const [group, solid] of solids) {
      if (GROUPS[group][2]) printed.push(solid);
    }
    if (printed.length === 0) return null;
    if (printed.length === 1) return printed[0];
    const merged = Manifold.union(printed);
    bin.add(merged);
    return merged;
  }

  function release(bin) {
    for (const solid of bin) solid.delete();
  }

  // Options: clearance, extra ops for connectors, want render
  function buildVariant(variant, options = {}) {
    const clearance = options.clearance === undefined ? CONNECTOR_CLEARANCE_MM : options.clearance;
    const recipe = buildRecipe(variant, clearance);
    const bin = new Set();
    try {
      const solids = groupSolids(recipe.ops, bin);
      const result = { anchors: recipe.anchors };
      if (options.render !== false) result.render = mergeRender(solids, recipe.anchors);
      let body = printedUnion(solids, bin);
      if (body && options.connectorOps) {
        body = fold(options.connectorOps, bin, body) || body;
      }
      if (body) {
        result.solid = toMesh(body);
        result.parts = body.decompose().map((piece) => {
          piece.delete();
          return 1;
        }).length;
        if (options.edges !== false) result.edges = creaseEdges(result.solid, CREASE_DEG);
      }
      return result;
    } finally {
      release(bin);
    }
  }

  // Plain op list to one mesh
  function buildOps(ops) {
    const bin = new Set();
    try {
      const solid = fold(ops, bin);
      return solid ? toMesh(solid) : null;
    } finally {
      release(bin);
    }
  }

  return { buildVariant, buildOps };
}
