// A rod: a round bar along a path of points.

import { vSub, vAdd, vScale, vUnit, vDot, vLen } from '../core/vec.js';
import { tube } from '../core/mesh.js';
import { HARDWARE } from './sizes.js';

export function rodMesh(rod) {
  const r = (rod.diameter || HARDWARE.rodDiameter) / 2;
  return tube(rod.points, () => [r, r], [1, 0, 0], 14);
}

// Which way a rod runs where it passes closest to a point.
export function rodDirectionNear(rods, point) {
  let best = null, bestDistance = Infinity;
  for (const rod of rods || []) {
    for (let i = 0; i < rod.points.length - 1; i++) {
      const a = rod.points[i], b = rod.points[i + 1], ab = vSub(b, a);
      const t = Math.max(0, Math.min(1, vDot(vSub(point, a), ab) / vDot(ab, ab))), gap = vLen(vSub(point, vAdd(a, vScale(ab, t))));
      if (gap < bestDistance) { bestDistance = gap; best = vUnit(ab); }
    }
  }
  return best || [0, 0, 1];
}

// What the scene draws for one rod: a list of { mesh, name }.
export function rodItems(rod, index) {
  return [{ mesh: rodMesh(rod), name: 'rod_' + (rod.id || index + 1) }];
}
