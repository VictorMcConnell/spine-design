// A cross-link between the two rods. A plain shape of its kind: it does not copy any maker's
// product.

import { vSub, vAdd, vScale, vUnit, vLerp, vCross, vDot, vLen } from '../core/vec.js';
import { appendMesh, tube, arcThrough } from '../core/mesh.js';
import { HARDWARE } from './sizes.js';
import { rodDirectionNear } from './rod.js';

// A cross-link: a clamp on each rod, closed by a small set screw, and a bar between the two
// that arches away from the spine to clear the bone in the middle. The bar is in two halves
// that slide in a sleeve at the top of the arch, which is how these are set to length.
//   alongFrom, alongTo: which way each rod runs where the cross-link grips it
//   away: the direction pointing away from the spine (to the back of the person)
export function crosslinkMesh(link, alongFrom = [0, 0, 1], alongTo = [0, 0, 1], away = [0, 1, 0]) {
  const span = vSub(link.to, link.from), length = vLen(span), across = vUnit(span), r = HARDWARE.crosslinkBar / 2;
  // "out" is straight away from the spine as seen from the bar
  let out = vSub(away, vScale(across, vDot(away, across)));
  out = vLen(out) > 0.1 ? vUnit(out) : vUnit(vCross(across, [0, 0, 1]));
  const mesh = { positions: [], indices: [] };
  const clamp = (at, along) => {
    const run = vUnit(along), bulge = (t) => { const k = 5.3 - 0.9 * Math.abs(2 * t - 1) ** 4; return [k, k]; };
    // the body round the rod, and the boss with the set screw on its back
    appendMesh(mesh, tube([vSub(at, vScale(run, 5)), vAdd(at, vScale(run, 5))], bulge, out, 16));
    appendMesh(mesh, tube([vAdd(at, vScale(out, 3)), vAdd(at, vScale(out, 8.2))], (t) => [t > 0.8 ? 2.1 : 3.1, t > 0.8 ? 2.1 : 3.1], run, 12));
  };
  clamp(link.from, alongFrom); clamp(link.to, alongTo);
  // the bar: out of the side of each clamp, up over the middle
  const rise = Math.min(14, 5 + length * 0.12), a = vAdd(link.from, vAdd(vScale(across, 4.5), vScale(out, 1.5))), b = vAdd(link.to, vAdd(vScale(across, -4.5), vScale(out, 1.5)));
  const top = vAdd(vLerp(a, b, 0.5), vScale(out, rise));
  appendMesh(mesh, tube(arcThrough(a, top, b, 18), () => [r, r], out, 12));
  // the sleeve at the top of the arch, with its own set screw
  if (length > 22) {
    appendMesh(mesh, tube([vAdd(top, vScale(across, -4.5)), vAdd(top, vScale(across, 4.5))], (t) => { const k = 3.3 - 0.5 * Math.abs(2 * t - 1) ** 4; return [k, k]; }, out, 14));
    appendMesh(mesh, tube([vAdd(top, vScale(out, 2)), vAdd(top, vScale(out, 5.4))], (t) => [t > 0.75 ? 1.5 : 2.2, t > 0.75 ? 1.5 : 2.2], across, 10));
  }
  return mesh;
}

// What the scene draws for one cross-link.
//   around: { rods, backAt(point) } the rods it grips, and which way is away from the spine
export function crosslinkItems(link, index, around) {
  return [{ mesh: crosslinkMesh(link, rodDirectionNear(around.rods, link.from), rodDirectionNear(around.rods, link.to), around.backAt(link.from)), name: 'crosslink_' + (index + 1) }];
}
