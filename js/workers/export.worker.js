import Module from '../../vendor/manifold/manifold.js';
import { loadManifold, createSolids } from '../core/solids.js';
import { meshGap } from '../core/meshtools.js';
import { writeStl } from '../core/stl.js';
import { zipStore } from '../core/zip.js';
import { buildExport, buildCoupon, partsList, PLATE_DIGITS } from '../core/exportplan.js';
import { couponOps, couponMate } from '../core/connectors.js';
import { assemblySteps } from '../core/assembly.js';

const LIST_NAME = 'parts-list.txt'; // the zip's list of plates and modules

const ready = loadManifold(Module, {
  locateFile: (name) => new URL('../../vendor/manifold/' + name, import.meta.url).href,
}).then(createSolids);

// Plates as one STL, or a zip of several with a parts list
function plateFile(plates, name, list) {
  if (plates.length === 1) return { name: name + '.stl', bytes: writeStl(plates[0], name) };
  const files = plates.map((plate, index) => {
    const label = `${name}-plate-${String(index + 1).padStart(PLATE_DIGITS, '0')}`;
    return { name: label + '.stl', bytes: writeStl(plate, label) };
  });
  files.push({ name: LIST_NAME, bytes: new TextEncoder().encode(list) });
  return { name: name + '-plates.zip', bytes: zipStore(files) };
}

async function run(message) {
  if (message.kind === 'steps') return { result: assemblySteps(message.modules) };
  const solids = await ready;
  if (message.kind === 'fit') {
    const coupon = solids.buildOps(couponOps(message.clearance));
    return { result: { clearance: message.clearance, gap: meshGap(coupon, couponMate(coupon)) } };
  }
  if (message.kind === 'coupon') {
    const name = `arco-fit-${message.clearance.toFixed(2)}mm`;
    const file = { name: name + '.stl', bytes: writeStl(buildCoupon(solids, message.clearance), name) };
    return { result: { file, plates: 1, pegs: 1 }, transfer: [file.bytes.buffer] };
  }
  const built = buildExport(solids, message.modules, message.clearance);
  if (built.plates.length === 0) return { result: { file: null, plates: 0, pegs: 0, oversize: built.oversize.length } };
  const file = plateFile(built.plates, message.name, partsList(built.layout, message.modules, message.name));
  return {
    result: { file, plates: built.plates.length, pegs: built.pegs, oversize: built.oversize.length },
    transfer: [file.bytes.buffer],
  };
}

self.onmessage = async (event) => {
  const { id } = event.data;
  try {
    const { result, transfer } = await run(event.data);
    self.postMessage({ id, done: true, result }, transfer || []);
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
