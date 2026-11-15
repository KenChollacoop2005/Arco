import { BED_MM, PLATE_GAP_MM, PLATE_EDGE_MM } from '../config.js';

// Shelf packing of part footprints onto print plates
export function packPlates(parts, bed = BED_MM, gap = PLATE_GAP_MM, edge = PLATE_EDGE_MM) {
  const usable = bed - 2 * edge;
  const oversize = [];
  const items = [];
  for (const part of parts) {
    const turned = part.depth > part.width;
    const long = Math.max(part.width, part.depth);
    const short = Math.min(part.width, part.depth);
    if (long > usable) oversize.push(part.id);
    else items.push({ id: part.id, turned, long, short });
  }
  items.sort((first, second) => second.short - first.short || second.long - first.long || (first.id < second.id ? -1 : 1));
  const plates = [];
  const shelves = [];
  for (const item of items) {
    let shelf = shelves.find((entry) => item.short <= entry.height && entry.cursor + item.long <= usable);
    if (!shelf) {
      const last = shelves[shelves.length - 1];
      const nextY = last ? last.y + last.height + gap : 0;
      const samePlate = last && nextY + item.short <= usable;
      if (!samePlate) plates.push([]);
      shelf = { plate: plates.length - 1, y: samePlate ? nextY : 0, height: item.short, cursor: 0 };
      shelves.push(shelf);
    }
    plates[shelf.plate].push({
      id: item.id,
      x: edge + shelf.cursor,
      y: edge + shelf.y,
      width: item.long,
      depth: item.short,
      turned: item.turned,
    });
    shelf.cursor += item.long + gap;
  }
  return { plates, oversize };
}
