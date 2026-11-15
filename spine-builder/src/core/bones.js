// Vertebrae and discs drawn from a few numbers. These are simple shapes made by this code, so
// they carry no licence of their own. They are meant to read clearly, not to be anatomy plates.

import { frameFromTilt, toWorld, vLerp } from './vec.js';
import { appendMesh, loft, tube } from './mesh.js';
import { regionOf } from './spinefile.js';

const BODY_SIDES = 28;

// Outline of a vertebral body seen from above: an oval, flatter and slightly dented at the back.
function bodyRing(w, d, z, scale) {
  const ring = [];
  for (let k = 0; k < BODY_SIDES; k++) {
    const a = (k / BODY_SIDES) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const y = s > 0 ? 0.86 * s - 0.13 * Math.exp(-((c / 0.45) ** 2)) : s;
    ring.push([(w / 2) * scale * c, (d / 2) * scale * y, z]);
  }
  return ring;
}

// The rings of a body from bottom to top, a little narrower at the waist.
function bodyRings(w, d, h) {
  const rings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, z = -h / 2 + h * t, waist = 1 - 0.09 * (1 - (2 * t - 1) ** 2);
    const lip = i === 0 || i === 6 ? 0.96 : 1;
    rings.push(bodyRing(w, d, z, waist * lip));
  }
  return rings;
}

// How the back half of a vertebra differs by region. Lengths are in millimetres for a body
// 30 mm wide and are scaled with the body.
const BACK_SHAPE = {
  neck: { wing: 7, wingBack: 3, wingUp: 0.1, spine: 16, spineDrop: 0.35, spineTall: 4, spineThick: 2.2 },
  chest: { wing: 15, wingBack: 13, wingUp: 0.25, spine: 24, spineDrop: 0.9, spineTall: 5, spineThick: 2.2 },
  'lower back': { wing: 19, wingBack: 5, wingUp: 0.05, spine: 22, spineDrop: 0.15, spineTall: 9, spineThick: 2.4 },
};

// One vertebra in its own axes: x = left, y = back, z = up, centre of the body at the origin.
function vertebraLocal(id, size) {
  const [w, d, h] = size, mesh = loft(bodyRings(w, d, h), true), region = regionOf(id);
  const k = Math.min(1.5, Math.max(0.7, w / 30));
  if (region === 'sacrum') {
    // the first piece of the sacrum: two wings and the rest of the bone tapering down and back
    for (const side of [-1, 1]) {
      appendMesh(mesh, tube([[side * w * 0.35, 0, -h * 0.1], [side * (w / 2 + 26 * k), d * 0.1, -h * 0.35]], (t) => [11 * k - 2 * t, 9 * k - 2 * t]));
    }
    appendMesh(mesh, tube([[0, d * 0.1, -h * 0.3], [0, d * 0.45, -h * 1.1], [0, d * 0.95, -h * 1.9]], (t) => [w * 0.42 * (1 - 0.6 * t), d * 0.36 * (1 - 0.5 * t)], [1, 0, 0]));
    return mesh;
  }
  const s = BACK_SHAPE[region], back = d / 2, canal = 0.27 * w;
  for (const side of [-1, 1]) {
    // pedicle: the short bridge from the body to the arch
    appendMesh(mesh, tube([[side * (canal + 2), back - 1.5, 0.2 * h], [side * (canal + 3), back + 8 * k, 0.22 * h]], () => [3.4 * k, 3 * k]));
    // side process (transverse process)
    const tipOut = w / 2 + s.wing * k;
    appendMesh(mesh, tube([[side * (canal + 3), back + 7 * k, 0.2 * h], [side * tipOut, back + s.wingBack * k, s.wingUp * h]], (t) => [3.8 * k - 0.6 * t, 3 * k - 0.4 * t]));
  }
  // the arch behind the canal, from one pedicle round to the other
  const arch = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    arch.push([-(canal + 3) * Math.cos(a), back + 8 * k + 10 * k * Math.sin(a), 0.15 * h - 0.12 * h * Math.sin(a)]);
  }
  appendMesh(mesh, tube(arch, () => [4.6 * k, 2.3 * k]));
  // the process that points backward (spinous process)
  const root = [0, back + 17 * k, 0.03 * h], long = id === 'C7' ? 1.4 : 1;
  const tip = [0, back + (17 + s.spine * long) * k, 0.03 * h - s.spineDrop * h];
  appendMesh(mesh, tube([root, vLerp(root, tip, 0.5), tip], (t) => [s.spineTall * k * (1 - 0.3 * t), s.spineThick * k * (1 - 0.2 * t)]));
  return mesh;
}

// The axes of a level, worked out once from its tilt and turn.
export function levelFrame(level) {
  return frameFromTilt(level.tilt, level.turn);
}

// A vertebra placed in the world.
export function vertebraMesh(level) {
  const local = vertebraLocal(level.id, level.size), frame = levelFrame(level), p = local.positions;
  for (let i = 0; i < p.length; i += 3) {
    const q = toWorld([p[i], p[i + 1], p[i + 2]], level.centre, frame);
    p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2];
  }
  return local;
}

// The disc between two neighbouring vertebrae: a skin from the underside of the upper body to
// the top of the lower one, bulging slightly in the middle.
export function discMesh(upper, lower) {
  const ring = (level, top) => {
    const [w, d, h] = level.size, frame = levelFrame(level);
    return bodyRing(w, d, top ? h / 2 : -h / 2, 0.96).map((q) => toWorld(q, level.centre, frame));
  };
  const a = ring(upper, false), b = ring(lower, true);
  const centre = a.concat(b).reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map((v) => v / (a.length + b.length));
  const mid = a.map((q, i) => vLerp(centre, vLerp(q, b[i], 0.5), 1.05));
  return loft([b, mid, a], false);
}
