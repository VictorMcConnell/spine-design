// Rods, screws, hooks and cross-links drawn from the points stored in a spine file.
// The shapes are simplified on purpose: a screw is a shaft and a head, a hook is a seat and a
// curved blade. They show where things are, not what a particular product looks like.

import { vSub, vAdd, vScale, vUnit, vLerp } from './vec.js';
import { appendMesh, tube, arcThrough } from './mesh.js';

export function rodMesh(rod) {
  const r = (rod.diameter || 5.5) / 2;
  return tube(rod.points, () => [r, r], [1, 0, 0], 12);
}

export function screwMesh(screw) {
  const r = (screw.diameter || 5) / 2, start = screw.entry || screw.head;
  const mesh = tube([start, vLerp(start, screw.tip, 0.85), screw.tip], (t) => (t > 0.86 ? [r * 0.45, r * 0.45] : [r, r]), [1, 0, 0], 10);
  return appendMesh(mesh, headMesh(screw.head, vUnit(vSub(screw.head, screw.tip))));
}

// The part of a screw or hook that grips the rod, as a short drum.
function headMesh(at, axis) {
  return tube([vSub(at, vScale(axis, 5)), vAdd(at, vScale(axis, 6.5))], () => [6.2, 6.2], [1, 0, 0], 16);
}

export function hookMesh(hook) {
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5);
  const mesh = headMesh(hook.at, vUnit(vSub(hook.at, mid)));
  return appendMesh(mesh, tube(arcThrough(hook.at, mid, hook.tip, 12), (t) => [3.6 - 0.8 * t, 1.5 - 0.5 * t], [1, 0, 0], 10));
}

export function crosslinkMesh(link) {
  const mesh = tube([link.from, link.to], () => [2.2, 2.2], [0, 0, 1], 10);
  for (const end of [link.from, link.to]) {
    const along = vUnit(vSub(link.to, link.from));
    appendMesh(mesh, tube([vSub(end, vScale(along, 4)), vAdd(end, vScale(along, 4))], () => [4, 4], [0, 0, 1], 12));
  }
  return mesh;
}
