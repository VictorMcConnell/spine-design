// A whole spine packed into the text of a link, and unpacked again. Nothing is sent anywhere:
// the sketch travels inside the address itself, after the # sign, and that part of an address
// is never sent to a web server.
//
//   #spine=z...   the spine file, squeezed (deflate) and written in base 64
//   #spine=j...   the spine file as it is, in base 64, for browsers that cannot squeeze

const LIMIT = 2e6;                     // the most text a link may unpack to, in bytes

const toText = (bytes) => {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromText = (text) => {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

// Run bytes through a squeezing or unsqueezing stream, giving up if the result grows too big.
async function through(bytes, stream, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { reader.cancel(); throw new Error('The link unpacks to more than a spine can be.'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The text that stands for a spine in a link.
export async function packSpine(spine) {
  const bytes = new TextEncoder().encode(JSON.stringify(spine));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + toText(await through(bytes, new CompressionStream('deflate-raw'), Infinity)); } catch (e) { /* this browser cannot squeeze: send it as it is */ }
  }
  return 'j' + toText(bytes);
}

// The spine a link stands for. Fails (rejects) if the text is not one.
export async function unpackSpine(text) {
  let bytes = fromText(text.slice(1));
  if (text[0] === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'), LIMIT);
  else if (text[0] !== 'j' || bytes.length > LIMIT) throw new Error('Not a spine link.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

// A full link from the address of the app and the packed text, and the packed text out of
// the part of an address after the # sign (null if there is none).
export const linkFor = (address, packed) => address.split('#')[0] + '#spine=' + packed;
export const packedIn = (hash) => { const m = /^#spine=([A-Za-z0-9_-]+)$/.exec(hash || ''); return m ? m[1] : null; };
