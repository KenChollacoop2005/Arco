const ZIP_VERSION = 20; // plain stored entries
const ZIP_DATE = 0x21; // fixed date, Jan 1 1980
const LOCAL_BYTES = 30; // local header size
const INDEX_BYTES = 46; // central directory record size
const END_BYTES = 22; // end record size

let table = null;

export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let entry = 0; entry < 256; entry++) {
      let value = entry;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[entry] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset++) crc = table[(crc ^ bytes[offset]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Uncompressed zip from [{ name, bytes }]
export function zipStore(files) {
  const entries = files.map((file) => ({
    name: Uint8Array.from(file.name, (letter) => letter.charCodeAt(0) & 127),
    bytes: file.bytes,
    crc: crc32(file.bytes),
  }));
  const bodySize = entries.reduce((sum, entry) => sum + LOCAL_BYTES + entry.name.length + entry.bytes.length, 0);
  const indexSize = entries.reduce((sum, entry) => sum + INDEX_BYTES + entry.name.length, 0);
  const out = new Uint8Array(bodySize + indexSize + END_BYTES);
  const view = new DataView(out.buffer);
  let at = 0;
  // Fields shared by local and index records
  const shared = (entry, from) => {
    view.setUint16(from, ZIP_VERSION, true);
    view.setUint16(from + 8, ZIP_DATE, true);
    view.setUint32(from + 10, entry.crc, true);
    view.setUint32(from + 14, entry.bytes.length, true);
    view.setUint32(from + 18, entry.bytes.length, true);
    view.setUint16(from + 22, entry.name.length, true);
  };
  for (const entry of entries) {
    entry.offset = at;
    view.setUint32(at, 0x04034b50, true);
    shared(entry, at + 4);
    out.set(entry.name, at + LOCAL_BYTES);
    out.set(entry.bytes, at + LOCAL_BYTES + entry.name.length);
    at += LOCAL_BYTES + entry.name.length + entry.bytes.length;
  }
  const indexStart = at;
  for (const entry of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, ZIP_VERSION, true);
    shared(entry, at + 6);
    view.setUint32(at + 42, entry.offset, true);
    out.set(entry.name, at + INDEX_BYTES);
    at += INDEX_BYTES + entry.name.length;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - indexStart, true);
  view.setUint32(at + 16, indexStart, true);
  return out;
}
