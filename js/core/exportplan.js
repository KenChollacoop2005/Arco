import { CONNECTOR_CLEARANCE_MM, PLATE_GAP_MM, RAIL_DEPTH_MM } from '../config.js';
import { instanceCells, variantKey } from './grid.js';
import { meshStats, moveMesh, mergeMeshes, weldMesh } from './meshtools.js';
import { packPlates } from './packing.js';
import { pegOps, couponOps } from './connectors.js';

// Pegs needed: a top socket under a bottom socket
export function pegJoints(modules, socketsOf) {
  const tops = new Set();
  for (const instance of modules) {
    const cells = instanceCells(instance);
    for (const cell of socketsOf(instance).top) tops.add(cells[cell][0] + ',' + cells[cell][1] + ',' + (instance.z + instance.h));
  }
  let joints = 0;
  for (const instance of modules) {
    const cells = instanceCells(instance);
    for (const cell of socketsOf(instance).bottom) {
      if (tops.has(cells[cell][0] + ',' + cells[cell][1] + ',' + instance.z)) joints++;
    }
  }
  return joints;
}

// Mesh moved so its low corner is the origin
function seated(mesh) {
  const stats = meshStats(mesh);
  return {
    mesh: moveMesh(mesh, 0, -stats.min[0], -stats.min[1], -stats.min[2]),
    width: stats.max[0] - stats.min[0],
    depth: stats.max[1] - stats.min[1],
  };
}

function layPlates(shapes, parts) {
  const packed = packPlates(parts);
  const plates = packed.plates.map((items) =>
    weldMesh(mergeMeshes(
      items.map((item) => {
        const shape = shapes.get(item.id);
        return item.turned
          ? moveMesh(shape.mesh, 1, item.x + shape.depth, item.y, 0)
          : moveMesh(shape.mesh, 0, item.x, item.y, 0);
      })
    ))
  );
  return { plates, layout: packed.plates, oversize: packed.oversize };
}

// Modules and their pegs laid out on print plates
export function buildExport(solids, modules, clearance = CONNECTOR_CLEARANCE_MM) {
  const built = new Map();
  for (const instance of modules) {
    const key = variantKey(instance);
    if (built.has(key)) continue;
    const result = solids.buildVariant(instance, { clearance, connectors: true, render: false, edges: false });
    built.set(key, { ...seated(result.solid), sockets: result.sockets });
  }
  const pegs = pegJoints(modules, (instance) => built.get(variantKey(instance)).sockets);
  const peg = pegs > 0 ? seated(solids.buildOps(pegOps(clearance))) : null;
  const shapes = new Map();
  const parts = [];
  for (const instance of modules) {
    const shape = built.get(variantKey(instance));
    shapes.set('module ' + instance.id, shape);
    parts.push({ id: 'module ' + instance.id, width: shape.width, depth: shape.depth });
  }
  for (let count = 0; count < pegs; count++) {
    shapes.set('peg ' + count, peg);
    parts.push({ id: 'peg ' + count, width: peg.width, depth: peg.depth });
  }
  return { ...layPlates(shapes, parts), pegs, modules: modules.length };
}

// Fit test: two mating blocks and one peg
export function buildCoupon(solids, clearance = CONNECTOR_CLEARANCE_MM) {
  const block = seated(solids.buildOps(couponOps(clearance)));
  const peg = seated(solids.buildOps(pegOps(clearance)));
  const step = block.depth + PLATE_GAP_MM + RAIL_DEPTH_MM;
  return weldMesh(mergeMeshes([
    block.mesh,
    moveMesh(block.mesh, 0, 0, step, 0),
    moveMesh(peg.mesh, 0, block.width + PLATE_GAP_MM, 0, 0),
  ]));
}
