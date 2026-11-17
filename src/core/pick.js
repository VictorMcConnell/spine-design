// Finding what is under the pointer: where a ray from the eye first meets a shape.

import { vSub, vDot, vCross } from './vec.js';

// Distance along the ray to the first triangle of the mesh it hits, or null.
//   origin, direction: the ray, in the same axes as the mesh
export function rayMesh(origin, direction, mesh) {
  const p = mesh.positions, ix = mesh.indices;
  let best = null;
  for (let f = 0; f < ix.length; f += 3) {
    const a = ix[f] * 3, b = ix[f + 1] * 3, c = ix[f + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const h = vCross(direction, e2), det = vDot(e1, h);
    if (Math.abs(det) < 1e-9) continue;
    const s = [origin[0] - p[a], origin[1] - p[a + 1], origin[2] - p[a + 2]], u = vDot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = vCross(s, e1), v = vDot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = vDot(e2, q) / det;
    if (t > 0 && (best === null || t < best)) best = t;
  }
  return best;
}

// How close a ray passes to a point: { along: distance along the ray, off: distance from it }.
export function rayPoint(origin, direction, point) {
  const d = vSub(point, origin), along = vDot(d, direction);
  return { along, off: Math.hypot(d[0] - direction[0] * along, d[1] - direction[1] * along, d[2] - direction[2] * along) };
}
