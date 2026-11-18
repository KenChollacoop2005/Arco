import { CELL_MM, PLINTH_DIAMETER_CELLS, STREAM_CHANCE, STREAM_LENGTH } from '../config.js';
import { cellInPlinth } from './grid.js';
import { STREAM_FAMILIES } from './catalog.js';
import { hashString, mixSeed, makeRng } from './rng.js';

const STREAM_SEED = 0x57e4a; // keeps stream rolls apart from layout rolls
const LINE_RANGE = [-4, 3]; // cell row the stream runs along
const HALF = PLINTH_DIAMETER_CELLS / 2; // cells from the centre to the rim
export const STREAM_REASON = 'Only a water wheel or an arched foundation can stand on the stream';
export const STREAM_TURN_REASON = 'Turn it to run with the stream';
export const WHEEL_REASON = 'A water wheel stands only on the stream';

// The seeded stream of a plinth, or null; it rises in a pool and runs off the rim
export function streamOf(seedText) {
  const rng = makeRng(mixSeed(hashString(String(seedText)), STREAM_SEED));
  if (!rng.chance(STREAM_CHANCE)) return null;
  const alongX = rng.chance(0.5);
  const line = rng.int(LINE_RANGE[0], LINE_RANGE[1]);
  const flow = rng.chance(0.5) ? 1 : -1;
  const at = (step) => (alongX ? [step, line] : [line, step]);
  // Every plinth cell on the line, ordered downstream
  const steps = [];
  for (let step = -HALF; step < HALF; step++) if (cellInPlinth(...at(step))) steps.push(step);
  steps.sort((first, second) => (first - second) * flow);
  const length = Math.min(steps.length, rng.int(STREAM_LENGTH[0], STREAM_LENGTH[1]));
  const cells = steps.slice(steps.length - length).map(at);
  const keys = new Set(cells.map(([cellX, cellY]) => cellX + ',' + cellY));
  const centre = ([cellX, cellY]) => [(cellX + 0.5) * CELL_MM, (cellY + 0.5) * CELL_MM];
  return { alongX, flow, line, cells, keys, path: cells.map(centre) };
}

// True when a cell is part of the stream
export const onStream = (stream, cellX, cellY) => !!stream && stream.keys.has(cellX + ',' + cellY);

// Reason a module may not stand where it is on or off the stream, or ''
export function streamReason(stream, instance, cells) {
  if (instance.z !== 0) return instance.family === 'wheel' ? WHEEL_REASON : '';
  const wet = cells.filter(([cellX, cellY]) => onStream(stream, cellX, cellY));
  if (instance.family === 'wheel' && wet.length < cells.length) return WHEEL_REASON;
  if (wet.length === 0) return '';
  if (!STREAM_FAMILIES.includes(instance.family)) return STREAM_REASON;
  // Arches and wheels run their local x along the flow
  return ((instance.rot & 1) === 0) === stream.alongX ? '' : STREAM_TURN_REASON;
}

// Plain record for files and workers: no sets
export const streamRecord = (stream) => (stream ? { alongX: stream.alongX, flow: stream.flow, line: stream.line, cells: stream.cells, path: stream.path } : null);

// Stream back from a plain record
export function streamFrom(record) {
  if (!record || !Array.isArray(record.cells)) return null;
  return { ...record, keys: new Set(record.cells.map(([cellX, cellY]) => cellX + ',' + cellY)) };
}
