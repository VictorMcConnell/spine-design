// Solid shapes described by a distance function, and a way to turn one into a mesh.
// A distance function takes a point (x, y, z) and returns how far it is from the surface:
// negative inside the shape, positive outside. Simple shapes are blended into each other with
// soft joins, which is what makes the bones look grown rather than assembled.

// Soft union and soft intersection of two shapes. k is the width of the blend in millimetres.
export function softMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function softMax(a, b, k) {
  return -softMin(-a, -b, k);
}

// A rod with rounded ends from point a to point b whose radius goes from ra to rb.
export function capsule(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - (ra + (rb - ra) * t);
}

// An egg shape with its own radius along each axis (a close approximation of the distance).
export function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  return (Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
}

// Turn a distance function into a closed mesh by sampling it on a grid ("surface nets").
// Every grid cell the surface passes through gets one point, placed at the average of where
// the surface crosses the cell's edges. Neighbouring points are then joined into faces.
//   low, high: corners of the box to sample (the shape must fit inside with room to spare)
//   step: size of a grid cell in millimetres; smaller is smoother and slower
export function meshFromDistance(distance, low, high, step) {
  // an odd number of samples each way, so the grid can first be walked two steps at a time
  const odd = (n) => (n % 2 ? n : n + 1);
  const nx = odd(Math.ceil((high[0] - low[0]) / step) + 1), ny = odd(Math.ceil((high[1] - low[1]) / step) + 1), nz = odd(Math.ceil((high[2] - low[2]) / step) + 1);
  const field = new Float32Array(nx * ny * nz).fill(NaN), at = (i, j, k) => i + nx * (j + ny * k);
  const sample = (i, j, k) => distance(low[0] + i * step, low[1] + j * step, low[2] + k * step);
  // Most of the box is empty space or solid bone. Sample every second point first, then fill
  // in the points between only where the surface can be close. This relies on the distance
  // function never changing faster than the distance moved, which holds for the shapes above.
  for (let k = 0; k < nz; k += 2) for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) field[at(i, j, k)] = sample(i, j, k);
  const reach = step * 2 * 1.74 * 1.05;
  for (let k0 = 0; k0 < nz - 1; k0 += 2) for (let j0 = 0; j0 < ny - 1; j0 += 2) for (let i0 = 0; i0 < nx - 1; i0 += 2) {
    let near = false;
    for (let c = 0; c < 8 && !near; c++) near = Math.abs(field[at(i0 + 2 * (c & 1), j0 + (c & 2), k0 + ((c & 4) >> 1))]) < reach;
    const fill = field[at(i0, j0, k0)] < 0 ? -1000 : 1000;
    for (let k = k0; k <= k0 + 2; k++) for (let j = j0; j <= j0 + 2; j++) for (let i = i0; i <= i0 + 2; i++) {
      const n = at(i, j, k);
      if (Number.isNaN(field[n])) field[n] = near ? sample(i, j, k) : fill;
    }
  }

  const cellPoint = new Int32Array(nx * ny * nz).fill(-1), positions = [], indices = [];
  const corner = new Float32Array(8), sx = nx * ny;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const n = i + nx * j + sx * k;
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      corner[c] = field[n + (c & 1) + (c & 2 ? nx : 0) + (c & 4 ? sx : 0)];
      if (corner[c] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let px = 0, py = 0, pz = 0, count = 0;
    for (let a = 0; a < 8; a++) for (let bit = 1; bit <= 4; bit <<= 1) {
      const b = a | bit;
      if (a & bit || (corner[a] < 0) === (corner[b] < 0)) continue;
      const t = corner[a] / (corner[a] - corner[b]);
      px += (a & 1) + (bit === 1 ? t : 0); py += ((a >> 1) & 1) + (bit === 2 ? t : 0); pz += ((a >> 2) & 1) + (bit === 4 ? t : 0);
      count++;
    }
    cellPoint[n] = positions.length / 3;
    positions.push(low[0] + (i + px / count) * step, low[1] + (j + py / count) * step, low[2] + (k + pz / count) * step);
  }

  // one four-sided face for every grid edge that goes from inside to outside
  const face = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const n = i + nx * j + sx * k, here = field[n] < 0;
    if (here !== field[n + 1] < 0) face(cellPoint[n - nx - sx], cellPoint[n - sx], cellPoint[n], cellPoint[n - nx], !here);
    if (here !== field[n + nx] < 0) face(cellPoint[n - 1 - sx], cellPoint[n - 1], cellPoint[n], cellPoint[n - sx], !here);
    if (here !== field[n + sx] < 0) face(cellPoint[n - 1 - nx], cellPoint[n - nx], cellPoint[n], cellPoint[n - 1], !here);
  }
  return { positions, indices };
}
