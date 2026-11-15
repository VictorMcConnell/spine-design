// The shapes of the vertebrae and the discs. There are two sets of bones:
//   real    shapes from the BodyParts3D anatomy models (src/shapes/bodyparts3d.js), resized
//           to the body size of each level. This is what the app shows.
//   drawn   simple shapes worked out here from plain measurements (see anatomy.js): a body,
//           two pedicles, the arch round the canal, the side processes, the spinous process
//           and the small joints, blended into one solid. Nothing in this set comes from an
//           existing 3D model. It stands in for any level the real set does not have.

import { frameFromTilt, toWorld, vLerp } from './vec.js';
import { loft } from './mesh.js';
import { softMin, softMax, capsule, ellipsoid, meshFromDistance } from './solid.js';
import { regionOf } from './spinefile.js';
import { ANATOMY } from './anatomy.js';
import { SHAPES } from '../shapes/bodyparts3d.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The measurements of one level, taken from the table and stretched to the body size given in
// the spine file (if it gives one).
export function anatomyFor(id, size) {
  const base = ANATOMY[id] || ANATOMY.T6, a = { ...base, id, region: regionOf(id) };
  if (!size) return a;
  const [w, d, h] = size, rise = (base.hf + base.hb) / 2;
  if (!rise) return a;                             // the atlas has no body to stretch
  const across = clamp(w / base.w, 0.85, 1.2), deep = clamp(d / base.d, 0.85, 1.2), tall = clamp(h / rise, 0.8, 1.25);
  return { ...a, w, d, hf: base.hf * (h / rise), hb: base.hb * (h / rise), cw: base.cw * across, cd: base.cd * deep, sp: base.sp * deep, tp: base.tp * across, pw: base.pw * across, ph: base.ph * tall };
}

// Height of the body's top surface above its middle, at a given depth (the body can be a
// wedge: taller at the front or at the back).
const halfHeight = (a, y) => (a.hf + ((a.hb - a.hf) * clamp(y + a.d / 2, 0, a.d)) / a.d) / 2;

// The body alone: an oval pillar, slightly waisted, with softened rims.
function bodyDistance(a, x, y, z) {
  const hh = halfHeight(a, y), waist = 1 - 0.07 * (1 - Math.min(1, (z / hh) ** 2));
  const side = (Math.hypot(x / ((a.w / 2) * waist), y / ((a.d / 2) * waist)) - 1) * (a.d / 2) * 0.95;
  return softMax(side, Math.abs(z) - hh, 2);
}

// The distance function of a whole vertebra in its own axes: x = left, y = back, z = up.
function vertebraDistance(a) {
  const { w, d, cw, cd, sp, tp, pw, ph, region, id } = a;
  const h = (a.hf + a.hb) / 2, back = d / 2;
  const cy = back + cd / 2 - 1;                    // middle of the canal
  const wall = Math.max(3.6, pw * 0.7);            // thickness of the arch
  const A = cw / 2 + wall / 2, B = cd / 2 + wall / 2;
  const px = cw / 2 + pw / 2;                      // how far out the pedicles sit
  const zp = h * 0.16;                             // pedicles leave the upper half of the body
  const chest = region === 'chest', low = region === 'lower back', neck = region === 'neck';
  const archTall = (chest ? 0.95 : low ? 0.8 : 0.75) * h, za = zp - (chest ? 0.24 : 0.1) * h;
  // side processes: straight out in the neck and lower back, swept backward in the chest
  const tipY = chest ? cy + B + 8 : low ? cy - 2 : back - 2, tipZ = chest ? zp + 2 : zp - 2;
  const tpR = low ? [4.6, 3.2] : chest ? [5.4, 5] : [4.6, 3.8];
  // spinous process: its tip, and how tall and thin its section is
  const rootY = cy + B - 1.5, fall = (a.drop * Math.PI) / 180;
  const tip = [rootY + sp * Math.cos(fall), za - sp * Math.sin(fall)];
  const blade = low ? [9.5, 3.2] : chest ? [5.8, 3.3] : [3.8, 2.8], flat = blade[0] / blade[1];
  const forked = neck && id !== 'C7';

  if (id === 'C1') {
    // the atlas has no body: a ring with a thick mass on each side
    return (x, y, z) => {
      const ax = Math.abs(x), ring = Math.abs(Math.hypot(x / A, (y - cy) / B) - 1) * Math.min(A, B) - 2.6;
      let f = softMax(ring, Math.abs(z) - 4.2, 2);
      f = softMin(f, ellipsoid(ax, y, z, cw / 2 + 4.5, cy - 2, 0, 6.5, 9, 6.5), 3);
      f = softMin(f, capsule(ax, y, z, cw / 2 + 8, cy - 1, 0, tp / 2, cy, 0, 3.4, 3), 2.5);
      return softMax(f, -(Math.hypot(x / (cw / 2), (y - cy) / (cd / 2)) - 1) * Math.min(cw, cd) * 0.5, 1);
    };
  }

  return (x, y, z) => {
    const ax = Math.abs(x);
    let f = bodyDistance(a, x, y, z);
    // pedicles: short bridges running straight back from the body
    const ty = clamp(y, back - 3, cy + 1);
    f = softMin(f, (Math.hypot((ax - px) / (pw / 2), (z - zp) / (ph / 2), (y - ty) / (pw / 2)) - 1) * Math.min(pw, ph) * 0.5, 2);
    // the arch: the back half of a ring round the canal
    const ring = Math.abs(Math.hypot(x / A, (y - cy) / B) - 1) * Math.min(A, B) - wall / 2;
    f = softMin(f, softMax(softMax(ring, Math.abs(z - za) - archTall / 2, 2), cy - 1 - y, 2), 2.5);
    // side processes
    f = softMin(f, capsule(ax, y, z, px + 1, cy, zp, tp / 2, tipY, tipZ, tpR[0], tpR[1]), 3);
    // spinous process, flattened from side to side
    f = softMin(f, capsule(x * flat, y, z, 0, rootY, za, 0, tip[0], tip[1], blade[0], blade[0] * 0.95) / flat, 3);
    if (forked) f = softMin(f, capsule(ax, y, z, 0, tip[0] - 2, tip[1], 3.4, tip[0] + 3.5, tip[1] - 1, 2.4, 2.1), 1.5);
    // the small joints that link a vertebra to its neighbours: two reaching up, two down
    f = softMin(f, ellipsoid(ax, y, z, px + 1.5, cy + 1, zp + ph / 2 + 3.5, 4.3, 3.2, 5.6), 2);
    f = softMin(f, ellipsoid(ax, y, z, cw / 2 + 2.5, cy + B - 1.5, za - archTall / 2 - 2.5, 4, 3, 5.2), 2);
    // the axis carries the peg the atlas turns on
    if (id === 'C2') f = softMin(f, capsule(x, y, z, 0, -1, h / 2 - 2, 0, -1.5, h / 2 + 14, 5.2, 4.4), 2.5);
    // the canal for the cord
    return softMax(f, -(Math.hypot(x / (cw / 2), (y - cy) / (cd / 2)) - 1) * Math.min(cw, cd) * 0.5, 1);
  };
}

// The sacrum: the body of S1 on top, a wing on each side, and the rest tapering down and
// back to the tailbone.
function sacrumDistance(a) {
  const back = a.d / 2;
  const lumps = [];
  for (let i = 1; i <= 7; i++) {
    const t = i / 7, taper = 1 - 0.78 * t;
    lumps.push([back * 0.2 + 46 * t * t, -a.hf * 0.2 - 118 * t * (1 - 0.3 * t), (a.w * 0.62) * taper + 4, 15 * taper + 4, 13]);
  }
  return (x, y, z) => {
    const ax = Math.abs(x);
    let f = bodyDistance(a, x, y, z);
    f = softMin(f, ellipsoid(ax, y, z, a.w * 0.7, back * 0.4, -a.hf * 0.25, a.w * 0.5, 17, 17), 8);
    for (const [ly, lz, rx, ry, rz] of lumps) f = softMin(f, ellipsoid(x, y, z, 0, ly, lz, rx, ry, rz), 7);
    return f;
  };
}

// The box that is sure to contain a vertebra, with room to spare.
function boundsFor(a) {
  if (a.id === 'S1') return [[-a.w * 1.25 - 6, -a.d / 2 - 6, -a.hf / 2 - 125], [a.w * 1.25 + 6, a.d / 2 + 62, a.hf / 2 + 6]];
  const cy = a.d / 2 + a.cd / 2, reach = cy + a.cd / 2 + a.sp + 14, fall = a.sp * Math.sin((a.drop * Math.PI) / 180);
  const h = (a.hf + a.hb) / 2;
  return [[-a.tp / 2 - 8, -a.d / 2 - 5, -h * 0.75 - fall - 12], [a.tp / 2 + 8, reach, h / 2 + 22]];
}

const cache = new Map();

// Which set of bones is in use: 'real' or 'drawn'.
let style = 'real';
export function setBoneStyle(name) { style = name === 'drawn' ? 'drawn' : 'real'; }
export function boneStyle() { return style; }

// A real shape as stored: its points in millimetres and its triangles.
const stored = new Map();
function storedShape(id) {
  if (!stored.has(id)) {
    const bytes = (text) => { const raw = atob(text), view = new DataView(new ArrayBuffer(raw.length)); for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i)); return view; };
    const p = bytes(SHAPES[id].points), f = bytes(SHAPES[id].faces);
    const positions = new Float32Array(p.byteLength / 2), indices = new Uint16Array(f.byteLength / 2);
    for (let i = 0; i < positions.length; i++) positions[i] = p.getInt16(i * 2, true) / 100;
    for (let i = 0; i < indices.length; i++) indices[i] = f.getUint16(i * 2, true);
    stored.set(id, { positions, indices });
  }
  return stored.get(id);
}
// How much a real shape is stretched each way to give its body the size asked for.
const stretchOf = (id, size) => (size ? size.map((v, i) => v / SHAPES[id].size[i]) : [1, 1, 1]);
const hasReal = (id) => style === 'real' && !!SHAPES[id];

// The mesh of a vertebra in its own axes. Built once for each set of measurements and kept.
//   detail: for the drawn bones, the size of the sampling grid in millimetres. Smaller is
//           smoother and slower.
export function vertebraShape(id, size, detail = 1.4) {
  if (hasReal(id)) {
    const base = storedShape(id), k = stretchOf(id, size);
    if (k.every((v) => Math.abs(v - 1) < 1e-6)) return base;
    const key = id + '|real|' + size.join(',');
    if (!cache.has(key)) {
      const positions = new Float32Array(base.positions.length);
      for (let i = 0; i < positions.length; i++) positions[i] = base.positions[i] * k[i % 3];
      cache.set(key, { positions, indices: base.indices });
      if (cache.size > 150) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  const key = id + '|' + (size ? size.join(',') : '') + '|' + detail;
  if (!cache.has(key)) {
    const a = anatomyFor(id, size), [lo, hi] = boundsFor(a);
    cache.set(key, meshFromDistance(id === 'S1' ? sacrumDistance(a) : vertebraDistance(a), lo, hi, id === 'S1' ? detail * 1.5 : detail));
    // sizes tried while a slider moves pile up: let go of the oldest shapes
    if (cache.size > 150) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

// The axes of a level, worked out from its tilt and turn.
export function levelFrame(level) {
  return frameFromTilt(level.tilt, level.turn);
}

// A vertebra placed in the world.
export function vertebraMesh(level, detail) {
  const shape = vertebraShape(level.id, level.size, detail), frame = levelFrame(level), p = shape.positions;
  const positions = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const q = toWorld([p[i], p[i + 1], p[i + 2]], level.centre, frame);
    positions[i] = q[0]; positions[i + 1] = q[1]; positions[i + 2] = q[2];
  }
  return { positions, indices: shape.indices };
}

// Where a screw enters the bone, on the left side and in the axes of the vertebra, when the
// real bones are in use and the spot was found on them. Otherwise null.
//   returns { entry: [x, y, z], lean: degrees toward the middle, or null for the usual angle }
export function screwEntryFor(id, size) {
  if (!hasReal(id) || !SHAPES[id].pedicle) return null;
  const k = stretchOf(id, size), spot = SHAPES[id].pedicle;
  return { entry: spot.entry.map((v, i) => v * k[i]), lean: typeof spot.lean === 'number' ? spot.lean : null };
}

// The outline of the top or the underside of a body, in the world.
function endplateRing(level, top) {
  const frame = levelFrame(level), ring = [];
  const real = hasReal(level.id) ? SHAPES[level.id][top ? 'top' : 'bottom'] : null;
  if (real) {
    const k = stretchOf(level.id, level.size);
    return real.map((p) => toWorld([p[0] * k[0], p[1] * k[1], p[2] * k[2]], level.centre, frame));
  }
  const a = anatomyFor(level.id, level.size);
  for (let k = 0; k < 28; k++) {
    const t = (k / 28) * 2 * Math.PI, x = (a.w / 2) * 0.93 * Math.cos(t), y = (a.d / 2) * 0.93 * Math.sin(t);
    ring.push(toWorld([x, y, (top ? 1 : -1) * (halfHeight(a, y) - 0.6)], level.centre, frame));
  }
  return ring;
}

// The disc between two neighbouring vertebrae: a skin from the underside of the upper body to
// the top of the lower one, bulging slightly in the middle.
export function discMesh(upper, lower) {
  const a = endplateRing(upper, false), b = endplateRing(lower, true);
  const centre = a.concat(b).reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map((v) => v / (a.length + b.length));
  const mid = a.map((q, i) => vLerp(centre, vLerp(q, b[i], 0.5), 1.06));
  return loft([b, mid, a], true);
}
