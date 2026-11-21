// The shapes of the vertebrae and the discs. There are two sets of bones:
//   real    shapes from the BodyParts3D anatomy models (src/shapes/bodyparts3d.js), resized
//           to the body size of each level. This is what the app shows.
//   drawn   simple shapes worked out here from plain measurements (see anatomy.js): a body,
//           two pedicles, the arch round the canal, the side processes, the spinous process
//           and the small joints, blended into one solid. Nothing in this set comes from an
//           existing 3D model. It stands in for any level the real set does not have.

import { frameFromTilt, toWorld, vLerp, vSub, vAdd, vScale, vUnit, vDot, vCross, vLen } from './vec.js';
import { loft, ball } from './mesh.js';
import { softMin, softMax, capsule, ellipsoid, meshFromDistance } from './solid.js';
import { regionOf } from './spinefile.js';
import { ANATOMY } from './anatomy.js';
import { SHAPES } from '../shapes/bodyparts3d.js';
import { rayMesh } from './pick.js';

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
// The same for a vertebra whose body is broken (see fractures.js): the whole bone keeps the
// height it had, and warpOf then squashes the body alone.
const stretchWhole = (id, size, fracture) => { const k = stretchOf(id, size); return fracture ? [k[0], k[1], fracture.was / SHAPES[id].size[2]] : k; };
// Where a point of a broken vertebra goes, in its own axes (x = left, y = back, z = up, the
// middle of the body at 0, 0, 0). The arch and the processes behind the body stay as they are.
//   size: of the body as it is now (the height in it is the height left)
function warpOf(size, fracture) {
  const w = size[0], d = size[1], left = size[2] / fracture.was, a = fracture.amount;
  // 1 inside the body, fading to 0 behind its back wall, where the pedicles start
  const body = (y) => { const t = Math.max(0, Math.min(1, (y - (d / 2 + 2.5)) / 7)); return 1 - t * t * (3 - 2 * t); };
  if (fracture.kind === 'wedge') {
    // the front has lost twice what the middle has, the back nothing
    const front = 2 * (1 - left);
    return (x, y, z) => [x, y, z * (1 - front * (1 - Math.max(0, Math.min(1, (y + d / 2) / d))))];
  }
  if (fracture.kind === 'wedge-left' || fracture.kind === 'wedge-right') {
    // that side has lost twice what the middle has, the other side nothing
    const side = 2 * (1 - left), sign = fracture.kind === 'wedge-left' ? 1 : -1;
    return (x, y, z) => [x, y, z * (1 - side * Math.max(0, Math.min(1, (sign * x + w / 2) / w)) * body(y))];
  }
  if (left > 0.999) return (x, y, z) => [x, y, z];          // (a crack, a split or a chip: nothing is squashed)
  if (fracture.kind === 'burst') return (x, y, z) => { const b = body(y); return [x * (1 + 0.2 * a * b), y * (1 + 0.12 * a * b), z * (1 + (left - 1) * b)]; };
  return (x, y, z) => [x, y, z * (1 + (left - 1) * body(y))];
}
// Bone spurs: the rims of the body, top and bottom, grow outward in uneven lips, most at the front and the sides.
//   size: of the whole body [wide, deep, tall]
function spurOf(size) {
  const [w, d, h] = size, step = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  return (x, y, z) => {
    const r = Math.hypot(x / (w / 2), y / (d / 2)), high = Math.abs(z) / (h / 2), back = step(d / 2 - 4, d / 2 + 1, y);
    const much = step(0.6, 0.93, high) * (1 - step(1.02, 1.25, high)) * step(0.55, 0.9, r) * (1 - step(1.05, 1.3, r)) * (1 - back);
    if (much < 0.001) return [x, y, z];
    const a = Math.atan2(y, x), lip = 0.55 + 0.45 * Math.sin(3 * a + 1.3 + (z > 0 ? 0 : 2.1)) * Math.sin(5 * a + 0.4), k = 1 + 0.2 * much * lip;
    return [x * k, y * k, z];
  };
}
const hasReal = (id) => style === 'real' && !!SHAPES[id];

// The mesh of a vertebra in its own axes. Built once for each set of measurements and kept.
//   detail: for the drawn bones, the size of the sampling grid in millimetres. Smaller is
//           smoother and slower.
//   fracture: how its body is broken, if it is (the "fracture" of its level in a spine file)
//   spurs: true for bone spurs at the rims of its body
export function vertebraShape(id, size, detail = 1.4, fracture = null, spurs = false) {
  if (hasReal(id) && (fracture || spurs) && size) {
    const key = id + '|real|' + size.join(',') + '|' + (fracture ? fracture.kind + fracture.amount + '|' + fracture.was : '') + (spurs ? '|spurs' : '');
    if (!cache.has(key)) {
      const base = storedShape(id), k = stretchWhole(id, size, fracture), same = (x, y, z) => [x, y, z], warp = fracture ? warpOf(size, fracture) : same, p = base.positions, positions = new Float32Array(p.length);
      // (the spurs grow on the body as it was, and then break with it)
      const spur = spurs ? spurOf([size[0], size[1], fracture ? fracture.was : size[2]]) : same;
      for (let i = 0; i < p.length; i += 3) { const s = spur(p[i] * k[0], p[i + 1] * k[1], p[i + 2] * k[2]), q = warp(s[0], s[1], s[2]); positions[i] = q[0]; positions[i + 1] = q[1]; positions[i + 2] = q[2]; }
      cache.set(key, { positions, indices: base.indices });
      if (cache.size > 150) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
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
  const shape = vertebraShape(level.id, level.size, detail, level.fracture), frame = levelFrame(level), p = shape.positions;
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

// How far back the bone reaches at a spot, seen from behind: the y of its surface at (x, z) in
// the axes of the vertebra. Null where there is no bone there, and with the drawn bones.
// Hooks use it to sit on the bone. Kept for the spots that were asked for before.
const surfaces = new Map();
export function boneSurface(id, size, x, z) {
  if (!hasReal(id)) return null;
  const key = id + '|' + size.join(',') + '|' + Math.round(x * 2) + '|' + Math.round(z * 2);
  if (!surfaces.has(key)) {
    const t = rayMesh([Math.round(x * 2) / 2, 150, Math.round(z * 2) / 2], [0, -1, 0], vertebraShape(id, size));
    surfaces.set(key, t === null ? null : 150 - t);
    if (surfaces.size > 4000) surfaces.delete(surfaces.keys().next().value);
  }
  return surfaces.get(key);
}

// The outline of the top or the underside of a body, in the world.
export function endplateRing(level, top) {
  const frame = levelFrame(level), ring = [];
  const real = hasReal(level.id) ? SHAPES[level.id][top ? 'top' : 'bottom'] : null;
  if (real) {
    // (the end plates of a broken body go where the body went, so the discs follow them)
    const k = stretchWhole(level.id, level.size, level.fracture), warp = level.fracture ? warpOf(level.size, level.fracture) : (x, y, z) => [x, y, z];
    return real.map((p) => toWorld(warp(p[0] * k[0], p[1] * k[1], p[2] * k[2]), level.centre, frame));
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

// A disc as the file describes it (see discs.js): a list of { mesh, tint }. A standard disc is
// the one shape of discMesh. The others are general pictures of their kind:
//   thin       the same skin, a little fuller at the rim (the space itself is closed by setDisc)
//   bulging    the rim pushes out all round, most toward one side of the back
//   herniated  the rim is pushed out at one spot, where a soft lump has come through
//   dried      no fullness at the rim, and drawn darker (tint 'dried')
//   none       nothing at all
// "tint" tells the scene to shade a part away from the colour of the discs: 'dried' or 'sore'.
// (discParts, below, is what the rest of the app calls: it adds the implants.)
function naturalDisc(upper, lower, disc) {
  const state = (disc && disc.state) || 'standard';
  if (state === 'standard') return [{ mesh: discMesh(upper, lower) }];
  if (state === 'none') return [];
  const a = endplateRing(upper, false), b = endplateRing(lower, true), n = a.length;
  const centre = a.concat(b).reduce((s, q) => vAdd(s, q), [0, 0, 0]).map((v) => v / (2 * n));
  const amount = Math.max(0.1, Math.min(1, typeof disc.amount === 'number' ? disc.amount : 0.5)), f = levelFrame(lower);
  const toward = vUnit(disc.toward === 'back-left' ? vAdd(f.back, vScale(f.left, 0.85)) : disc.toward === 'back-right' ? vSub(f.back, vScale(f.left, 0.85)) : disc.toward === 'left' ? f.left : disc.toward === 'right' ? vScale(f.left, -1) : disc.toward === 'front' ? vScale(f.back, -1) : f.back);
  const rim = a.map((q, i) => vLerp(q, b[i], 0.5)), facing = rim.map((p) => Math.max(0, vDot(vUnit(vSub(p, centre)), toward)));
  const swell = facing.map((w) => (state === 'thin' ? 0.1 : state === 'dried' ? 0 : state === 'bulging' ? 0.06 + amount * (0.08 + 0.3 * w * w) : 0.06 + amount * 0.5 * w ** 10));
  const ring = (t, full) => a.map((q, i) => vLerp(centre, vLerp(b[i], q, t), 1 + swell[i] * full));
  const parts = [{ mesh: loft([b, ring(0.25, 0.72), ring(0.5, 1), ring(0.75, 0.72), a], true), ...(state === 'dried' ? { tint: 'dried' } : {}) }];
  if (state === 'herniated') {
    // the lump: a ball pressed flat between the two bones, half out of the rim where it faces that side most
    const k = facing.indexOf(Math.max(...facing)), out = vSub(rim[k], centre), up = vUnit(vSub(a[k], b[k])), across = vUnit(vCross(up, toward));
    const at = vAdd(centre, vScale(out, 1 + 0.12 + 0.3 * amount)), r = [3 + 4 * amount, 4 + 3.5 * amount, Math.max(2.2, Math.min(5.5, vLen(vSub(a[k], b[k])) * 0.6))];
    const lump = oval(at, [vUnit(out), across, up], r);
    parts.push({ mesh: lump, tint: 'sore' });
  }
  return parts;
}

// What the renderer needs to draw the back of a vertebra as the file describes it ("arch", see
// fractures.js): { cut } to leave bone out, or { snap } for the dark line of a broken process,
// each four numbers in the axes of the vertebra. Null for a whole back and for the drawn bones.
//   cut:  1, half the width of the slot down the middle of the back, how far back it starts, 0
//   snap: 1, how far back the line is, half its width, 0                 the process at the back
//         2 or 3, how far out the line is, where it starts and ends front to back    left, right
const reaches = new Map();
export function archMarks(level) {
  if (!level.arch || !hasReal(level.id)) return null;
  const size = level.fracture ? [level.size[0], level.size[1], level.fracture.was] : level.size, a = anatomyFor(level.id, size), key = level.id + '|' + size.join(',');
  if (!reaches.has(key)) {
    // how far the bone reaches back and to the side, measured on the shape itself
    const p = vertebraShape(level.id, size).positions; let back = 0, side = 0;
    for (let i = 0; i < p.length; i += 3) { back = Math.max(back, p[i + 1]); side = Math.max(side, Math.abs(p[i])); }
    reaches.set(key, { back, side }); if (reaches.size > 200) reaches.delete(reaches.keys().next().value);
  }
  const { back, side } = reaches.get(key), canal = a.d / 2 + a.cd;
  if (level.arch === 'laminectomy') return { cut: [1, a.cw / 2 + 2, a.d / 2 + a.cd * 0.8, 0] };
  if (level.arch === 'spinous') return { snap: [1, back - 0.45 * (back - canal), 7.5, 0] };
  // (in the neck the side processes stand beside the body, lower down they stand behind it)
  const neck = level.id[0] === 'C';
  return { snap: [level.arch === 'tp-left' ? 2 : 3, a.cw / 2 + (side - a.cw / 2) * 0.45, neck ? -a.d / 2 : a.d / 2 + 2, neck ? a.d / 2 + 10 : canal + 8] };
}

// A ball pulled into an oval and put somewhere: its three axes and how far it reaches along each.
function oval(at, axes, radii) {
  const mesh = ball([0, 0, 0], 1), p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) { const q = [p[i], p[i + 1], p[i + 2]]; for (let j = 0; j < 3; j++) p[i + j] = at[j] + axes[0][j] * q[0] * radii[0] + axes[1][j] * q[1] * radii[1] + axes[2][j] * q[2] * radii[2]; }
  return mesh;
}
const middleOf = (ring) => ring.reduce((s, q) => vAdd(s, q), [0, 0, 0]).map((v) => v / ring.length);
// The colours of the implants. They are general shapes of their kind, not products.
const PLATE = [0.72, 0.74, 0.78], CORE = [0.9, 0.92, 0.95], CAGE = [0.62, 0.65, 0.7], SPACER = [0.74, 0.7, 0.58];

// An implant in the place of a disc: a list of { mesh, color, metal }.
//   replacement  an artificial disc: a plate on each bone and a smooth core between them
//   cage         a fusion cage: one block, smaller than the bones it holds apart
function implantParts(upper, lower, state) {
  const a = endplateRing(upper, false), b = endplateRing(lower, true), ca = middleOf(a), cb = middleOf(b), up = vUnit(vSub(ca, cb)), gap = vLen(vSub(ca, cb));
  const inward = (ring, c, k) => ring.map((p) => vLerp(c, p, k)), lifted = (ring, by) => ring.map((p) => vAdd(p, vScale(up, by)));
  if (state === 'cage' || state === 'cage-screws') return [{ mesh: loft([inward(b, cb, 0.6), inward(a, ca, 0.6)], true), color: CAGE, metal: true }, ...(state === 'cage-screws' ? cageFace(upper, lower) : [])];
  const thick = Math.min(2, gap / 3.5), top = inward(a, ca, 0.86), bottom = inward(b, cb, 0.86), f = levelFrame(lower);
  const reach = (axis) => Math.max(...bottom.map((p) => Math.abs(vDot(vSub(p, cb), axis))));
  return [
    { mesh: loft([bottom, lifted(bottom, thick)], true), color: PLATE, metal: true },
    { mesh: loft([lifted(top, -thick), top], true), color: PLATE, metal: true },
    { mesh: oval(vLerp(ca, cb, 0.5), [f.left, f.back, up], [reach(f.left) * 0.55, reach(f.back) * 0.55, Math.max(1, gap / 2 - thick * 0.6)]), color: CORE },
  ];
}

// A spot on the process at the back of a vertebra, in the world: on its middle line, about half
// way out. Null with the drawn bones and for the atlas and the sacrum, which have no such process.
const spots = new Map();
function backProcess(level) {
  if (!hasReal(level.id) || level.id === 'C1' || level.id === 'S1') return null;
  const size = level.fracture ? [level.size[0], level.size[1], level.fracture.was] : level.size, key = level.id + '|' + size.join(',');
  if (!spots.has(key)) {
    const a = anatomyFor(level.id, size), p = vertebraShape(level.id, size).positions; let back = 0;
    for (let i = 0; i < p.length; i += 3) back = Math.max(back, p[i + 1]);
    // (how high the process is there: the middle of the bone that lies near that spot)
    const y = a.d / 2 + a.cd + 0.5 * (back - a.d / 2 - a.cd); let z = 0, n = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < 5 && Math.abs(p[i + 1] - y) < 4) { z += p[i + 2]; n++; }
    spots.set(key, [0, y, n ? z / n : 0]); if (spots.size > 200) spots.delete(spots.keys().next().value);
  }
  return toWorld(spots.get(key), level.centre, levelFrame(level));
}
// A spacer between the back processes of two neighbouring vertebrae: a block that sits in the
// gap, with a wing on each side to keep it there. An empty list where there is no such gap.
function spacerParts(upper, lower) {
  const pu = backProcess(upper), pl = backProcess(lower);
  if (!pu || !pl) return [];
  const along = vUnit(vSub(pu, pl)), left = levelFrame(lower).left, deep = vUnit(vCross(left, along)), mid = vLerp(pu, pl, 0.5), tall = Math.max(3.5, Math.min(7, vLen(vSub(pu, pl)) / 2 - 8));
  return [
    // (the two spots are on the processes themselves, so the gap between the processes is a good deal shorter
    // than the way from one spot to the other)
    { mesh: oval(mid, [left, deep, along], [4.2, 6, tall]), color: SPACER, metal: true },
    ...[-1, 1].map((s) => ({ mesh: oval(vAdd(mid, vScale(left, s * 5.4)), [left, deep, along], [1.4, 6.5, tall + 5]), color: SPACER, metal: true })),
  ];
}

// A plate on the front of the spine, across one disc or several in a row: a strap with rounded
// ends that follows the front of the bones, held by two screws in each bone (only their heads show).
//   levels: the vertebrae it lies on, from the top one down (two for one disc)
const DARK = [0.3, 0.31, 0.35];
function plateParts(levels) {
  const last = levels.length - 1, fl = levelFrame(levels[last]), left = fl.left;
  // its line: down the front of each body. It starts a little above the middle of the top one and ends a little below the middle of the bottom one
  const front = (level, s) => { const f = levelFrame(level); return vAdd(level.centre, vAdd(vScale(f.back, -(level.size[1] / 2 + 0.8)), vScale(f.up, s * level.size[2]))); };
  // (the sacrum slopes away under its top, so there the plate stops short)
  const stops = levels.flatMap((l, k) => [front(l, k === 0 ? 0.16 : 0.5), front(l, k === last ? (l.id === 'S1' ? 0.22 : -0.16) : -0.5)]), line = [], own = [];
  for (let i = 0; i < stops.length - 1; i++) for (let k = i ? 1 : 0; k <= 6; k++) { line.push(vLerp(stops[i], stops[i + 1], k / 6)); own.push(i % 2 === 0 ? i / 2 : -1); }
  const lengths = [0]; for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + vLen(vSub(line[i], line[i - 1])));
  const total = lengths[lengths.length - 1], wide = Math.max(6, Math.min(12, Math.min(...levels.map((l) => l.size[0])) * 0.27)), round = Math.min(wide * 0.7, total * 0.3);
  const frames = line.map((p, i) => { const along = vUnit(vSub(line[Math.min(i + 1, line.length - 1)], line[Math.max(i - 1, 0)])); let out = vUnit(vCross(left, along)); if (vDot(out, fl.back) > 0) out = vScale(out, -1); return { p, out }; });
  // a flat strap with rounded edges, its two ends rounded off
  const rings = frames.map(({ p, out }, i) => {
    const end = Math.min(lengths[i], total - lengths[i]), w = wide * (end >= round ? 1 : Math.sqrt(Math.max(0.02, 1 - (1 - end / round) ** 2))), ring = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a); ring.push(vAdd(p, vAdd(vScale(left, w * Math.sign(c) * Math.abs(c) ** 0.35), vScale(out, 1.5 + 1.2 * Math.sign(sn) * Math.abs(sn) ** 0.5)))); }
    return ring;
  });
  // two screws in each bone, over the middle of that bone's share of the plate (at the two ends a little in from the end)
  const heads = levels.flatMap((l, k) => {
    const mine = own.map((o, i) => (o === k ? i : -1)).filter((i) => i >= 0), t = k === 0 ? 0.6 : k === last ? 0.4 : 0.5, { p, out } = frames[mine[Math.round((mine.length - 1) * t)]];
    return [1, -1].map((side) => ({ mesh: oval(vAdd(p, vAdd(vScale(left, side * wide * 0.5), vScale(out, 2.9))), [left, vUnit(vCross(left, out)), out], [Math.min(2.5, wide * 0.32), Math.min(2.5, wide * 0.32), 0.9]), color: PLATE, metal: true }));
  });
  return [{ mesh: loft(rings, true), color: DARK, metal: true }, ...heads];
}
// Where a mark for a plate goes: on the front of the disc between two vertebrae. And for a spacer:
// between their two back processes (null where there are none).
export function plateSpot(upper, lower) {
  const a = endplateRing(upper, false), b = endplateRing(lower, true), back = levelFrame(lower).back, front = (ring) => ring.reduce((best, p) => (vDot(p, back) < vDot(best, back) ? p : best));
  return vAdd(vLerp(front(a), front(b), 0.5), vScale(back, -2.5));
}
export function spacerSpot(upper, lower) {
  const pu = backProcess(upper), pl = backProcess(lower);
  return pu && pl ? vLerp(pu, pl, 0.5) : null;
}
// Plates on discs next to each other are one long plate. For the disc under the vertebra at place "i" in a
// list of vertebrae (top first): the vertebrae its plate lies on if a plate starts here, false if the disc is
// under a plate that started higher up, and nothing if it has no plate.
//   discs: the "discs" of a spine file
export function plateRun(levels, discs, i) {
  const plated = (k) => k >= 0 && k < levels.length - 1 && !!((discs || {})[levels[k].id + '/' + levels[k + 1].id] || {}).plate;
  if (!plated(i)) return undefined;
  if (plated(i - 1)) return false;
  let j = i; while (plated(j + 1)) j++;
  return levels.slice(i, j + 2);
}

// A fusion cage that is held by its own screws: the cage, a small face plate on its front that
// laps over the rims of the two bones, and four screws through it, two up into the bone above and
// two down into the bone below. Only the heads of the screws show, tipped the way they go.
function cageFace(upper, lower) {
  const a = endplateRing(upper, false), b = endplateRing(lower, true), ca = middleOf(a), cb = middleOf(b), f = levelFrame(lower), up = vUnit(vSub(ca, cb));
  const front = (ring) => ring.reduce((best, p) => (vDot(p, f.back) < vDot(best, f.back) ? p : best)), fa = front(a), fb = front(b);
  const mid = vAdd(vLerp(fa, fb, 0.5), vScale(f.back, -0.4)), gap = Math.max(4, vDot(vSub(fa, fb), up)), tall = gap / 2 + Math.max(2.5, Math.min(5, lower.size[2] * 0.16)), wide = Math.max(5.5, Math.min(13, Math.min(upper.size[0], lower.size[0]) * 0.3));
  let out = vUnit(vCross(f.left, up)); if (vDot(out, f.back) > 0) out = vScale(out, -1);
  const ring = (lift) => { const pts = []; for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); pts.push(vAdd(mid, vAdd(vAdd(vScale(f.left, wide * Math.sign(c) * Math.abs(c) ** 0.4), vScale(up, tall * Math.sign(s) * Math.abs(s) ** 0.4)), vScale(out, lift)))); } return pts; };
  const heads = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([side, high]) => {
    // (a head lies over the rim of its bone and is tipped toward it)
    const at = vAdd(mid, vAdd(vAdd(vScale(f.left, side * wide * 0.5), vScale(up, high * (tall - 2.2))), vScale(out, 2.6))), lean = vUnit(vAdd(out, vScale(up, -high * 0.55)));
    return { mesh: oval(at, [f.left, vUnit(vCross(f.left, lean)), lean], [Math.min(2.3, wide * 0.3), Math.min(2.3, wide * 0.3), 0.9]), color: PLATE, metal: true };
  });
  return [{ mesh: loft([ring(0.2), ring(2.4)], true), color: CAGE.map((v) => v * 0.8), metal: true }, ...heads];
}

// Everything that is drawn for the disc between two vertebrae, as the file describes it (see
// discs.js): a list of { mesh, tint, color, metal }. A part with a "color" is an implant and
// keeps that colour. "metal" asks the renderer to light it as metal.
//   run: for a plate, what plateRun gives for this disc. Left out, the plate lies on these two vertebrae.
export function discParts(upper, lower, disc, run) {
  const state = (disc && disc.state) || 'standard', plate = disc && disc.plate && run !== false ? plateParts(run || [upper, lower]) : [];
  return [...(['replacement', 'cage', 'cage-screws'].includes(state) ? implantParts(upper, lower, state) : naturalDisc(upper, lower, disc)), ...plate, ...(disc && disc.spacer ? spacerParts(upper, lower) : [])];
}
