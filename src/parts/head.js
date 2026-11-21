// The head that holds a screw or a hook on its rod. Screws and hooks share it.

import { vSub, vScale, vUnit, vCross, vDot, vLen } from '../core/vec.js';
import { softMax, meshFromDistance } from '../core/solid.js';
import { HEADS } from './sizes.js';

// The head that grips the rod, in its own axes: z points away from the bone, the rod runs
// along x through the origin. A drum with a U-shaped slot for the rod, closed above the rod
// by a set screw with a six-lobed socket. "look" is one of the HEADS of sizes.js.
let headShapes = new Map();
function headShape(rodDiameter, look) {
  const key = rodDiameter + '|' + look;
  if (headShapes.has(key)) return headShapes.get(key);
  const H = HEADS[look] || HEADS.standard, R = H.diameter / 2, top = H.top, cap = H.cap, bottom = top - H.height, slot = Math.min(rodDiameter / 2 + 0.35, R - 1.6);
  const distance = (x, y, z) => {
    const round = Math.hypot(x, y);
    // the drum, narrowing a little toward the bone
    let f = softMax(round - (R - (z < -3 ? (-3 - z) * 0.35 : 0)), Math.max(z - top, bottom - z), 0.8);
    // the slot for the rod: open to the top, round at the bottom
    const u = z > 0 ? Math.abs(y) - slot : Math.hypot(y, z) - slot;
    f = Math.max(f, -u);
    // the set screw that closes the slot above the rod, with its socket
    const lobes = 2.3 + 0.5 * Math.cos(6 * Math.atan2(y, x));
    let plug = Math.max(round - (R - 2.2), Math.max(z - (cap - 0.8), slot + 0.4 - z));
    plug = Math.max(plug, -Math.max(round - lobes * Math.min(1, (R - 2.2) / 4.3), cap - 3.4 - z));
    return Math.min(f, plug);
  };
  const mesh = meshFromDistance(distance, [-R - 1.5, -R - 1.5, bottom - 1.5], [R + 1.5, R + 1.5, top + 1.5], 0.55);
  headShapes.set(key, mesh);
  return mesh;
}

// A head placed in the world. "away" is the direction pointing away from the bone and "along"
// the direction of the rod at that spot.
function headAxes(away, along) {
  const z = vUnit(away);
  let x = vSub(along, vScale(z, vDot(along, z)));
  if (vLen(x) < 0.1) x = vCross(z, [1, 0, 0]);
  x = vUnit(x);
  return { x, y: vCross(z, x), z };
}
export function headMesh(at, away, along, rodDiameter, look = 'standard') {
  const { x, y, z } = headAxes(away, along), shape = headShape(rodDiameter, look), p = shape.positions, positions = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) for (let j = 0; j < 3; j++) positions[i + j] = at[j] + x[j] * p[i] + y[j] * p[i + 1] + z[j] * p[i + 2];
  // (its own copy of the faces: the caller may add more shapes to this mesh)
  return { positions, indices: shape.indices.slice() };
}
// The same head as a shape that is drawn once and then placed: { mesh, matrix }. The screen
// uses this, so moving a screw does not mean working out its head again.
export function headPlaced(at, away, along, rodDiameter, look = 'standard') {
  const { x, y, z } = headAxes(away, along);
  return { mesh: headShape(rodDiameter, look), matrix: new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, at[0], at[1], at[2], 1]) };
}
