// A zip file, written here so that nothing has to be loaded from anywhere: a few files in,
// one file out. The files are packed with the browser's own deflate where it has one and
// stored as they are where it has not.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
// The check number a zip keeps for each file.
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function packed(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new CompressionStream('deflate-raw'), writer = stream.writable.getWriter();
  writer.write(bytes); writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

// files: [{ name, bytes }] with bytes a Uint8Array, or text given as a string
// Returns the bytes of the zip.
export async function zipOf(files) {
  const parts = [], index = [], now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let at = 0;
  for (const file of files) {
    const raw = typeof file.bytes === 'string' ? new TextEncoder().encode(file.bytes) : file.bytes, name = new TextEncoder().encode(file.name);
    const small = await packed(raw), body = small && small.length < raw.length ? small : raw, method = body === raw ? 0 : 8;
    // what is the same in the entry before the file and in the list at the end
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true); common.setUint16(2, 0x0800, true); common.setUint16(4, method, true); common.setUint16(6, time, true); common.setUint16(8, date, true);
    common.setUint32(10, crc32(raw), true); common.setUint32(14, body.length, true); common.setUint32(18, raw.length, true); common.setUint16(22, name.length, true);
    const head = new Uint8Array(30 + name.length), hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true); head.set(new Uint8Array(common.buffer), 4); head.set(name, 30);
    const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); entry.set(new Uint8Array(common.buffer), 6); ev.setUint32(42, at, true); entry.set(name, 46);
    parts.push(head, body); index.push(entry);
    at += head.length + body.length;
  }
  const size = index.reduce((sum, e) => sum + e.length, 0), end = new Uint8Array(22), dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true); dv.setUint32(12, size, true); dv.setUint32(16, at, true);
  const out = new Uint8Array(at + size + 22);
  let to = 0;
  for (const part of [...parts, ...index, end]) { out.set(part, to); to += part.length; }
  return out;
}
