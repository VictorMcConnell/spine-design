// Building blocks for shapes. A mesh is { positions: number[], indices: number[] } with
// positions as a flat list x, y, z, x, y, z ... and indices as triangles.

import { vAdd, vSub, vScale, vCross, vUnit, vLen, vDot } from './vec.js';

export function emptyMesh() {
  return { positions: [], indices: [] };
}

// Append mesh b to mesh a.
export function appendMesh(a, b) {
  const base = a.positions.length / 3;
  for (const p of b.positions) a.positions.push(p);
  for (const i of b.indices) a.indices.push(i + base);
  return a;
}

// Join a list of rings (each a list of points, all the same length) into a skin, with flat
// caps at both ends when capped is true.
export function loft(rings, capped = true) {
  const mesh = emptyMesh(), n = rings[0].length;
  for (const ring of rings) for (const p of ring) mesh.positions.push(p[0], p[1], p[2]);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < n; k++) {
      const a = r * n + k, b = r * n + (k + 1) % n, c = a + n, d = b + n;
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
  if (capped) {
    for (const [r, flip] of [[0, true], [rings.length - 1, false]]) {
      const centre = rings[r].reduce((s, p) => vAdd(s, p), [0, 0, 0]).map((v) => v / n);
      const ci = mesh.positions.length / 3;
      mesh.positions.push(centre[0], centre[1], centre[2]);
      for (let k = 0; k < n; k++) {
        const a = r * n + k, b = r * n + (k + 1) % n;
        if (flip) mesh.indices.push(ci, b, a); else mesh.indices.push(ci, a, b);
      }
    }
  }
  return mesh;
}

// Sweep an oval along a path.
//   points: the centre line
//   radii:  function (t) -> [tall, thick] half sizes, t running 0..1 along the path
//   upHint: the direction the "tall" half size should follow as closely as it can
export function tube(points, radii, upHint = [0, 0, 1], sides = 14) {
  const rings = [], n = points.length;
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + vLen(vSub(points[i], points[i - 1])));
  const total = lengths[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    const dir = vUnit(vSub(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]));
    let tall = vSub(upHint, vScale(dir, vDot(upHint, dir)));
    if (vLen(tall) < 0.2) tall = vSub([0, 1, 0], vScale(dir, dir[1]));
    tall = vUnit(tall);
    const thick = vCross(dir, tall), [ra, rb] = radii(lengths[i] / total), ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * 2 * Math.PI;
      ring.push(vAdd(points[i], vAdd(vScale(tall, Math.cos(a) * ra), vScale(thick, Math.sin(a) * rb))));
    }
    rings.push(ring);
  }
  return loft(rings, true);
}

// A smooth curve through three points (start, a point it passes near the middle, end).
export function arcThrough(a, mid, b, steps = 12) {
  const control = vSub(vScale(mid, 2), vScale(vAdd(a, b), 0.5)), out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([0, 1, 2].map((j) => u * u * a[j] + 2 * u * t * control[j] + t * t * b[j]));
  }
  return out;
}

// Smooth shading: one normal per point, averaged from the triangles that share it.
export function computeNormals(mesh) {
  const p = mesh.positions, normals = new Float32Array(p.length);
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const a = mesh.indices[f] * 3, b = mesh.indices[f + 1] * 3, c = mesh.indices[f + 2] * 3;
    const n = vCross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]);
    for (const i of [a, b, c]) { normals[i] += n[0]; normals[i + 1] += n[1]; normals[i + 2] += n[2]; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

// A ball, built as a tube whose width follows a half circle.
export function ball(centre, radius) {
  const points = [];
  for (let i = 0; i <= 12; i++) points.push([centre[0], centre[1], centre[2] - radius + (2 * radius * i) / 12]);
  const r = (t) => { const v = radius * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)); return [v, v]; };
  return tube(points, r, [1, 0, 0], 18);
}
