// The model as a file for 3D printing: one binary STL.

// items: what the scene draws ({ mesh: { positions, indices }, matrix }), already narrowed
//        down to what should be printed
// scale: 1 for full size. The file is in millimetres.
// note:  up to 80 plain characters kept at the start of the file
// Returns the bytes of the file.
export function stlOf(items, scale = 1, note = '') {
  let count = 0;
  for (const it of items) count += it.mesh.indices.length / 3;
  const out = new DataView(new ArrayBuffer(84 + 50 * count));
  for (let i = 0; i < Math.min(80, note.length); i++) out.setUint8(i, note.charCodeAt(i) & 127);
  let at = 84, written = 0;
  for (const it of items) {
    const p = it.mesh.positions, ix = it.mesh.indices, m = it.matrix, placed = new Float64Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      placed[i] = (m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x) * scale;
      placed[i + 1] = (m ? m[1] * x + m[5] * y + m[9] * z + m[13] : y) * scale;
      placed[i + 2] = (m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z) * scale;
    }
    // faces must point outward. A shape whose volume comes out negative is wound the other way round.
    let volume = 0;
    for (let f = 0; f < ix.length; f += 3) {
      const a = ix[f] * 3, b = ix[f + 1] * 3, c = ix[f + 2] * 3;
      volume += placed[a] * (placed[b + 1] * placed[c + 2] - placed[b + 2] * placed[c + 1]) - placed[a + 1] * (placed[b] * placed[c + 2] - placed[b + 2] * placed[c]) + placed[a + 2] * (placed[b] * placed[c + 1] - placed[b + 1] * placed[c]);
    }
    const flip = volume < 0;
    for (let f = 0; f < ix.length; f += 3) {
      const a = ix[f] * 3, b = ix[f + (flip ? 2 : 1)] * 3, c = ix[f + (flip ? 1 : 2)] * 3;
      const ux = placed[b] - placed[a], uy = placed[b + 1] - placed[a + 1], uz = placed[b + 2] - placed[a + 2], vx = placed[c] - placed[a], vy = placed[c + 1] - placed[a + 1], vz = placed[c + 2] - placed[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;                     // a face with no area (the tip of a cone, say) is left out
      nx /= l; ny /= l; nz /= l;
      for (const v of [nx, ny, nz, placed[a], placed[a + 1], placed[a + 2], placed[b], placed[b + 1], placed[b + 2], placed[c], placed[c + 1], placed[c + 2]]) { out.setFloat32(at, v, true); at += 4; }
      at += 2; written++;
    }
  }
  out.setUint32(80, written, true);
  return new Uint8Array(out.buffer.slice(0, at));
}
