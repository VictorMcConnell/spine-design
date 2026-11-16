// Making a shape smoother for a print. Every triangle is cut into four and the corners are
// eased toward their neighbours (Loop's scheme), so a faceted bone comes out rounded. The
// shape keeps its size to within a fraction of the length of its edges.

// mesh: { positions, indices }, with corners shared between the triangles that meet there
// Returns a new mesh with four times the triangles. Edges that have only one triangle, or
// more than two, are kept as creases: they are cut in the middle and not rounded off.
export function smoother(mesh) {
  const p = mesh.positions, ix = mesh.indices, count = p.length / 3;
  const edges = new Map(), key = (a, b) => (a < b ? a * count + b : b * count + a);
  for (let f = 0; f < ix.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = ix[f + k], b = ix[f + (k + 1) % 3], c = ix[f + (k + 2) % 3], id = key(a, b);
      let e = edges.get(id);
      if (!e) { e = { a, b, across: [], at: 0 }; edges.set(id, e); }
      e.across.push(c);
    }
  }
  const out = new Array((count + edges.size) * 3), sum = new Float64Array(count * 3), near = new Uint16Array(count), crease = new Array(count);
  let next = count;
  for (const e of edges.values()) {
    e.at = next++;
    const smooth = e.across.length === 2;
    for (let j = 0; j < 3; j++) {
      const a = p[e.a * 3 + j], b = p[e.b * 3 + j];
      out[e.at * 3 + j] = smooth ? 0.375 * (a + b) + 0.125 * (p[e.across[0] * 3 + j] + p[e.across[1] * 3 + j]) : 0.5 * (a + b);
      sum[e.a * 3 + j] += b; sum[e.b * 3 + j] += a;
    }
    near[e.a]++; near[e.b]++;
    if (!smooth) { (crease[e.a] = crease[e.a] || []).push(e.b); (crease[e.b] = crease[e.b] || []).push(e.a); }
  }
  for (let v = 0; v < count; v++) {
    const n = near[v], c = crease[v];
    for (let j = 0; j < 3; j++) {
      const here = p[v * 3 + j];
      if (c) out[v * 3 + j] = c.length === 2 ? 0.75 * here + 0.125 * (p[c[0] * 3 + j] + p[c[1] * 3 + j]) : here;
      else if (!n) out[v * 3 + j] = here;
      else { const beta = n === 3 ? 3 / 16 : 3 / (8 * n); out[v * 3 + j] = (1 - n * beta) * here + beta * sum[v * 3 + j]; }
    }
  }
  const indices = new Array(ix.length * 4);
  for (let f = 0, to = 0; f < ix.length; f += 3) {
    const a = ix[f], b = ix[f + 1], c = ix[f + 2], ab = edges.get(key(a, b)).at, bc = edges.get(key(b, c)).at, ca = edges.get(key(c, a)).at;
    for (const v of [a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca]) indices[to++] = v;
  }
  return { positions: out, indices };
}
