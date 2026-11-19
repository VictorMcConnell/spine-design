// A moving picture as a GIF file, made here in the browser from a list of pictures.
// A GIF holds at most 256 colours, so the colours of all the pictures are first brought down
// to the 256 that serve them best, and every pixel takes the nearest of those.

// frames: pictures of the same size, each a list of bytes (red, green, blue and one unused byte for every pixel)
// delay:  how long each picture stays, in hundredths of a second
// Returns the bytes of the file.
export function gifOf(frames, width, height, delay) {
  const { palette, indexOf } = paletteFor(frames);
  const out = [];
  const word = (v) => out.push(v & 255, (v >> 8) & 255), text = (s) => { for (const c of s) out.push(c.charCodeAt(0)); };
  text('GIF89a'); word(width); word(height); out.push(0xf7, 0, 0);          // a table of 256 colours for the whole file
  for (let i = 0; i < 256; i++) out.push(palette[i * 3] || 0, palette[i * 3 + 1] || 0, palette[i * 3 + 2] || 0);
  out.push(0x21, 0xff, 11); text('NETSCAPE2.0'); out.push(3, 1, 0, 0, 0);    // play it round and round
  const pixels = new Uint8Array(width * height);
  for (const f of frames) {
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) pixels[p] = indexOf[((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3)];
    out.push(0x21, 0xf9, 4, 0); word(delay); out.push(0, 0);
    out.push(0x2c); word(0); word(0); word(width); word(height); out.push(0, 8);
    const data = squeeze(pixels);
    for (let at = 0; at < data.length; at += 255) { const n = Math.min(255, data.length - at); out.push(n); for (let j = 0; j < n; j++) out.push(data[at + j]); }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

// The 256 colours for a set of pictures, by cutting the box of all their colours in two at its
// middle, over and over, always the box with the most pixels in it along its longest side.
// Colours are counted in steps of 8 (32 shades of red, of green and of blue), which is fine
// enough for the eye and keeps the count small.
// Returns { palette: 256 colours as bytes, indexOf: the colour of the table for each of the 32768 counted colours }.
function paletteFor(frames) {
  const count = new Uint32Array(32768);
  for (const f of frames) for (let i = 0; i < f.length; i += 16) count[((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3)]++;
  const used = [];
  for (let c = 0; c < 32768; c++) if (count[c]) used.push(c);
  const part = (c, j) => (c >> (10 - 5 * j)) & 31;
  let boxes = [used];
  while (boxes.length < 256) {
    // the box to cut: the one that holds the most pixels and more than one colour
    let pick = -1, most = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; let n = 0; for (const c of b) n += count[c]; if (n > most) { most = n; pick = i; } });
    if (pick < 0) break;
    const box = boxes[pick];
    let axis = 0, span = -1;
    for (let j = 0; j < 3; j++) { let lo = 31, hi = 0; for (const c of box) { const v = part(c, j); if (v < lo) lo = v; if (v > hi) hi = v; } if (hi - lo > span) { span = hi - lo; axis = j; } }
    box.sort((a, b) => part(a, axis) - part(b, axis));
    let half = most / 2, cut = 1, n = 0;
    for (let i = 0; i < box.length - 1; i++) { n += count[box[i]]; cut = i + 1; if (n >= half) break; }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  const palette = new Uint8Array(768), indexOf = new Uint8Array(32768);
  boxes.forEach((box, i) => {
    let n = 0; const sum = [0, 0, 0];
    for (const c of box) { n += count[c]; for (let j = 0; j < 3; j++) sum[j] += count[c] * (part(c, j) * 8 + 4); }
    for (let j = 0; j < 3; j++) palette[i * 3 + j] = Math.round(sum[j] / Math.max(1, n));
    for (const c of box) indexOf[c] = i;
  });
  // (a colour that was not counted, because only every fourth pixel is, takes the nearest colour of the table)
  for (let c = 0; c < 32768; c++) {
    if (count[c]) continue;
    const r = part(c, 0) * 8 + 4, g = part(c, 1) * 8 + 4, b = part(c, 2) * 8 + 4;
    let best = 0, far = Infinity;
    for (let i = 0; i < boxes.length; i++) { const d = (palette[i * 3] - r) ** 2 + (palette[i * 3 + 1] - g) ** 2 + (palette[i * 3 + 2] - b) ** 2; if (d < far) { far = d; best = i; } }
    indexOf[c] = best;
  }
  return { palette, indexOf };
}

// The pixels of one picture squeezed the way a GIF wants them (LZW): runs of pixels that
// came before are written as one number each.
function squeeze(pixels) {
  const out = [], CLEAR = 256, END = 257;
  let hold = 0, bits = 0, size = 9, next = END + 1, table = new Map();
  const put = (code) => { hold |= code << bits; bits += size; while (bits >= 8) { out.push(hold & 255); hold >>>= 8; bits -= 8; } };
  put(CLEAR);
  let run = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = (run << 8) | k, known = table.get(key);
    if (known !== undefined) { run = known; continue; }
    put(run);
    if (next === 4096) { put(CLEAR); next = END + 1; size = 9; table = new Map(); }
    else { if (next >= (1 << size)) size++; table.set(key, next++); }
    run = k;
  }
  put(run); put(END);
  if (bits > 0) out.push(hold & 255);
  return out;
}
