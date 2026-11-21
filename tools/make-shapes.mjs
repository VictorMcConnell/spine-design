// Makes src/shapes/bodyparts3d.js: the shape of every vertebra and of the sacrum, taken from
// the BodyParts3D anatomy models and put into the axes and the typical sizes this app uses.
//   node tools/make-shapes.mjs <folder with the BodyParts3D OBJ files> [--table]
//
// Where the files come from, and what is done to them, is written down in NOTICE.md.
// Each bone is recognised by the English name in the header of its file, so the folder may
// hold the spine files alone or the whole archive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANATOMY } from '../src/core/anatomy.js';
import { LEVEL_ORDER } from '../src/core/spinefile.js';
import { vAdd, vSub, vScale, vDot, vCross, vUnit } from '../src/core/vec.js';
import { rayMesh } from '../src/core/pick.js';
import { typicalScrew, screwLean } from '../src/parts/sizes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = process.argv[2], showTable = process.argv.includes('--table');
if (!folder || !fs.existsSync(folder)) {
  console.error('Give the folder that holds the BodyParts3D OBJ files:\n  node tools/make-shapes.mjs <folder>');
  process.exit(1);
}

// ---------------------------------------------------------------- reading the files
const COUNT = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
function levelNamed(name) {
  const n = name.toLowerCase();
  if (n === 'atlas') return 'C1';
  if (n === 'axis') return 'C2';
  if (n === 'sacrum') return 'S1';
  const m = /^(\w+) (cervical|thoracic|lumbar) vertebra$/.exec(n);
  return m && COUNT.includes(m[1]) ? m[2][0].toUpperCase() + (COUNT.indexOf(m[1]) + 1) : null;
}

// The header of a file: its English name, without reading the rest.
function nameIn(file) {
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1500), read = fs.readSync(fd, buffer, 0, 1500, 0);
  fs.closeSync(fd);
  const m = /^# English name\s*:\s*(.+?)\s*$/m.exec(buffer.toString('utf8', 0, read));
  return m ? m[1] : '';
}

// The points and faces of a file. Points written twice are merged and faces are cut into
// triangles.
function readObj(file) {
  const seen = new Map(), map = [], positions = [], indices = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/).slice(1, 4).map(Number), key = p.map((v) => Math.round(v * 1000)).join(',');
      if (!seen.has(key)) { seen.set(key, positions.length / 3); positions.push(...p); }
      map.push(seen.get(key));
    } else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map((s) => map[parseInt(s, 10) - 1]);
      for (let k = 1; k + 1 < f.length; k++) if (f[0] !== f[k] && f[k] !== f[k + 1] && f[k + 1] !== f[0]) indices.push(f[0], f[k], f[k + 1]);
    }
  }
  return { positions, indices };
}

const bones = {}, discs = [];
for (const file of fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.obj')).sort()) {
  const name = nameIn(path.join(folder, file)), id = levelNamed(name), disc = /^intervertebral dis[ck]/i.test(name);
  if (!id && !disc) continue;
  const mesh = { ...readObj(path.join(folder, file)), file: path.basename(file, path.extname(file)), name };
  if (disc) discs.push(mesh);
  else if (bones[id]) console.warn('Two files are named ' + name + ': kept ' + bones[id].file + ', left out ' + mesh.file);
  else bones[id] = mesh;
}
const missing = LEVEL_ORDER.filter((id) => !bones[id]);
if (missing.length) { console.error('No file found for: ' + missing.join(', ')); process.exit(1); }

const pointsOf = (mesh) => { const out = []; for (let i = 0; i < mesh.positions.length; i += 3) out.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]); return out; };
const middle = (points) => vScale(points.reduce((s, p) => vAdd(s, p), [0, 0, 0]), 1 / points.length);
const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;

// The discs are named unevenly in the archive, so they are told apart by height: the highest
// sits under C2, the lowest on the sacrum.
discs.forEach((d) => { d.points = pointsOf(d); d.middle = middle(d.points); });
discs.sort((a, b) => b.middle[2] - a.middle[2]);
if (discs.length !== 23) { console.error('Expected 23 discs, found ' + discs.length); process.exit(1); }
const discUnder = {};
LEVEL_ORDER.slice(1, 24).forEach((id, i) => { discUnder[id] = discs[i]; });
const discOver = (id) => discUnder[LEVEL_ORDER[LEVEL_ORDER.indexOf(id) - 1]];

// ---------------------------------------------------------------- measuring a bone
const ACROSS = [1, 0, 0];                          // the archive's axes: x across, y to the back, z up
const axesFor = (up) => { const left = vUnit(vSub(ACROSS, vScale(up, vDot(ACROSS, up)))); return { left, back: vCross(up, left), up }; };
const reach = (mesh, from, dir) => rayMesh(from, dir, mesh);
const along = (p, d, k) => vAdd(p, vScale(d, k));

// The flat surface that fits a patch of points best, as its direction (made to point the
// same way as `like`). The patch is close to level in the axes given, so a plain fit of
// height against the two other directions is enough.
function facing(points, axes, like) {
  const c = middle(points);
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of points) {
    const d = vSub(p, c), x = vDot(d, axes.left), y = vDot(d, axes.back), z = vDot(d, axes.up);
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  const det = sxx * syy - sxy * sxy, a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det;
  const n = vUnit(vSub(axes.up, vAdd(vScale(axes.left, a), vScale(axes.back, b))));
  return vDot(n, like) < 0 ? vScale(n, -1) : n;
}

// Points on the surface of the bone reached from a small patch of starting points.
function patch(mesh, from, axes, radius, dir) {
  const out = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (i * i + j * j > 5) continue;
    const start = vAdd(from, vAdd(vScale(axes.left, (i * radius) / 2), vScale(axes.back, (j * radius) / 2))), t = reach(mesh, start, dir);
    if (t !== null) out.push(along(start, dir, t));
  }
  return out;
}

// Put a point in the middle of the body, from side to side and from front to back.
function centred(mesh, c, axes) {
  for (let pass = 0; pass < 2; pass++) {
    const l = reach(mesh, c, axes.left), r = reach(mesh, c, vScale(axes.left, -1));
    if (l !== null && r !== null) c = along(c, axes.left, (l - r) / 2);
    const b = reach(mesh, c, axes.back), f = reach(mesh, c, vScale(axes.back, -1));
    if (b !== null && f !== null) c = along(c, axes.back, (b - f) / 2);
  }
  return c;
}
const span = (mesh, c, dir) => reach(mesh, c, dir) + reach(mesh, c, vScale(dir, -1));

// How far the top (or the underside) of a body reaches from the point c: walk outward over
// the surface, to the left, right, front and back, until it falls away or rises into a rim.
//   returns { level, across: [low, high], deep: [low, high] } measured from c along the axes
function surfaceOf(mesh, c, axes, top, start = 20) {
  const dir = vScale(axes.up, top ? -1 : 1), from = along(c, axes.up, top ? start : -start);
  const heightAt = (x, y) => { const o = vAdd(from, vAdd(vScale(axes.left, x), vScale(axes.back, y))), t = reach(mesh, o, dir); return t === null ? null : (top ? start - t : t - start); };
  const level = heightAt(0, 0);
  const walk = (dx, dy) => {
    let far = 0;
    for (let k = 0.5; k < 45; k += 0.5) {
      const z = heightAt(dx * k, dy * k), off = z === null ? 99 : (top ? z - level : level - z);
      if (off < -3 || off > 4) break;             // fell off the edge, or climbed a rim or a neighbouring part
      far = k;
    }
    return far;
  };
  return { level, across: [-walk(-1, 0), walk(1, 0)], deep: [-walk(0, -1), walk(0, 1)] };
}

// A vertebra with a disc above and a disc below: its axes, the middle of its body and the
// size of that body.
function measureBody(id) {
  const mesh = bones[id], over = discOver(id), under = discUnder[id];
  let c = vLerpMid(over.middle, under.middle), axes = axesFor(vUnit(vSub(over.middle, under.middle)));
  const xs = under.points.map((p) => p[0]), radius = 0.22 * (Math.max(...xs) - Math.min(...xs));
  for (let pass = 0; pass < 3; pass++) {
    const top = patch(mesh, c, axes, radius, axes.up), bottom = patch(mesh, c, axes, radius, vScale(axes.up, -1));
    const up = vUnit(vAdd(facing(top, axes, axes.up), facing(bottom, axes, axes.up)));
    axes = axesFor(up);
    c = along(c, up, (mean(top.map((p) => vDot(vSub(p, c), up))) + mean(bottom.map((p) => vDot(vSub(p, c), up)))) / 2);
    c = centred(mesh, c, axes);
  }
  // the table gives the width and depth of the body where a disc sits on it, so those are
  // measured on its top and on its underside
  // (in the neck the body runs into the side processes without an edge, so there only the
  // depth is measured and the width follows it)
  const neck = id[0] === 'C';
  let t = surfaceOf(mesh, c, axes, true), u = surfaceOf(mesh, c, axes, false);
  c = vAdd(c, vAdd(vScale(axes.left, neck ? 0 : (t.across[0] + t.across[1] + u.across[0] + u.across[1]) / 4), vScale(axes.back, (t.deep[0] + t.deep[1] + u.deep[0] + u.deep[1]) / 4)));
  t = surfaceOf(mesh, c, axes, true); u = surfaceOf(mesh, c, axes, false);
  const w = (t.across[1] - t.across[0] + u.across[1] - u.across[0]) / 2, d = (t.deep[1] - t.deep[0] + u.deep[1] - u.deep[0]) / 2;
  // and its height at the front and at the back
  const tall = (y) => mean([-0.15, 0, 0.15].map((x) => span(mesh, vAdd(c, vAdd(vScale(axes.back, y * d), vScale(axes.left, x * d))), axes.up)));
  const hf = tall(-0.3), hb = tall(0.3);
  c = along(c, axes.up, (t.level + u.level) / 2);
  return { c, axes, w: neck ? NaN : w, d, h: (hf + hb) / 2, hf, hb, top: [t.across[1] - t.across[0], t.deep[1] - t.deep[0]], under: [u.across[1] - u.across[0], u.deep[1] - u.deep[0]] };
}
function vLerpMid(a, b) { return vScale(vAdd(a, b), 0.5); }

// ---------------------------------------------------------------- the frame of every bone
// frame[id] = { c, axes, scale: [across, deep, tall] }: a point p of the archive becomes
// scale * (p - c) read along the axes.
const frame = {}, table = [];
const typical = (id) => { const a = ANATOMY[id]; return [a.w, a.d, id === 'C1' ? 9 : (a.hf + a.hb) / 2]; };
for (const id of LEVEL_ORDER.slice(2, 24)) {
  const m = measureBody(id), [w, d, h] = typical(id);
  const deep = d / m.d, across = Number.isFinite(m.w) ? w / m.w : deep;
  frame[id] = { c: m.c, axes: m.axes, scale: [across, deep, h / m.h] };
  table.push([id, bones[id].file, m.w, m.d, m.hf, m.hb, across, deep, h / m.h, m.top, m.under, [w, d, h]]);
}
{
  // The axis has no disc above it: its underside gives the axes and the depth of its body,
  // and the height of the body follows the table.
  const mesh = bones.C2, under = discUnder.C2, [w, d, h] = typical('C2');
  let axes = frame.C3.axes, c = along(under.middle, axes.up, 8);
  axes = axesFor(facing(patch(mesh, c, axes, 4, vScale(axes.up, -1)), axes, axes.up));
  c = centred(mesh, c, axes);
  let u = surfaceOf(mesh, c, axes, false);
  c = along(c, axes.back, (u.deep[0] + u.deep[1]) / 2);
  u = surfaceOf(mesh, c, axes, false);
  const md = u.deep[1] - u.deep[0], even = d / md;
  c = along(c, axes.up, u.level + h / 2 / even);
  frame.C2 = { c, axes, scale: [even, even, even] };
  table.push(['C2', mesh.file, NaN, md, NaN, NaN, even, even, even]);
  // The atlas has no body. It keeps the place it has on the axis in the archive, and the
  // middle of the app's atlas is the spot the average spine gives it above the axis.
  frame.C1 = { c: along(c, axes.up, (h / 2 + 1 + 4.5) / even), axes, scale: [even, even, even] };
  table.push(['C1', bones.C1.file, NaN, NaN, NaN, NaN, even, even, even]);
}
{
  // The sacrum: the surface the lowest disc sits on gives the axes, the place and the size.
  const mesh = bones.S1, disc = discUnder.L5, [w, d, h] = typical('S1');
  let axes = frame.L5.axes, c = disc.middle;
  const xs = disc.points.map((p) => p[0]);
  axes = axesFor(facing(patch(mesh, along(c, axes.up, 8), axes, 0.22 * (Math.max(...xs) - Math.min(...xs)), vScale(axes.up, -1)), axes, axes.up));
  let t = surfaceOf(mesh, c, axes, true);
  c = vAdd(c, vAdd(vScale(axes.left, (t.across[0] + t.across[1]) / 2), vScale(axes.back, (t.deep[0] + t.deep[1]) / 2)));
  t = surfaceOf(mesh, c, axes, true);
  const mw = t.across[1] - t.across[0], md = t.deep[1] - t.deep[0], even = (w / mw + d / md) / 2;
  frame.S1 = { c: along(c, axes.up, t.level - h / 2 / even), axes, scale: [even, even, even] };
  table.push(['S1', mesh.file, mw, md, NaN, NaN, w / mw, d / md, even]);
}

const toLocal = (id, p) => { const f = frame[id], q = vSub(p, f.c); return [vDot(q, f.axes.left) * f.scale[0], vDot(q, f.axes.back) * f.scale[1], vDot(q, f.axes.up) * f.scale[2]]; };
const toArchive = (id, l) => { const f = frame[id]; return vAdd(f.c, vAdd(vScale(f.axes.left, l[0] / f.scale[0]), vAdd(vScale(f.axes.back, l[1] / f.scale[1]), vScale(f.axes.up, l[2] / f.scale[2])))); };

// ---------------------------------------------------------------- where the discs meet the bone
// The outline of the top (or the underside) of a body, as 28 points in the bone's own axes.
// The disc in the archive shows how far out the surface reaches in each direction.
const RING = 28;
function ringFor(id, top) {
  const disc = top ? discOver(id) : discUnder[id], mesh = bones[id], f = frame[id], [w, d, h] = typical(id);
  if (!disc) return null;
  const flat = disc.points.map((p) => toLocal(id, p)), reachOut = new Array(RING * 2).fill(0);
  for (const p of flat) {
    const t = Math.atan2(p[1] / d, p[0] / w), bin = ((Math.round((t / (2 * Math.PI)) * RING * 2) % (RING * 2)) + RING * 2) % (RING * 2);
    reachOut[bin] = Math.max(reachOut[bin], Math.hypot((2 * p[0]) / w, (2 * p[1]) / d));
  }
  const level = (top ? 1 : -1) * (h / 2), dir = vScale(f.axes.up, top ? -1 : 1), ring = [];
  for (let k = 0; k < RING; k++) {
    const near = [-1, 0, 1].map((j) => reachOut[(2 * k + j + RING * 2) % (RING * 2)]).filter((v) => v > 0);
    let out = (near.length ? Math.min(...near) : 1) * 0.9, point = null;
    for (let tries = 0; tries < 8 && !point; tries++, out *= 0.93) {
      const t = (k / RING) * 2 * Math.PI, x = (w / 2) * out * Math.cos(t), y = (d / 2) * out * Math.sin(t);
      const start = toArchive(id, [x, y, level + (top ? 14 : -14)]), hit = reach(mesh, start, dir);
      if (hit === null) continue;
      const z = toLocal(id, along(start, dir, hit))[2];
      if (Math.abs(z - level) < 4.5) point = [x, y, z - (top ? 0.6 : -0.6)];
    }
    if (!point) return null;
    ring.push(point.map((v) => Math.round(v * 10) / 10));
  }
  return ring;
}

// ---------------------------------------------------------------- where a screw goes
// The pedicle is the bridge from the body to the arch, on each side of the canal. A cut
// across the bone just behind the body goes through the two pedicles and nothing else, so
// the middle of each patch of bone in that cut is the middle of a pedicle.
function crossings(mesh, origin, direction) {
  const p = mesh.positions, ix = mesh.indices, out = [];
  for (let f = 0; f < ix.length; f += 3) {
    const a = ix[f] * 3, b = ix[f + 1] * 3, c = ix[f + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const h = vCross(direction, e2), det = vDot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = [origin[0] - p[a], origin[1] - p[a + 1], origin[2] - p[a + 2]], u = vDot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = vCross(s, e1), v = vDot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = vDot(e2, q) / det;
    if (t > 0) out.push(t);
  }
  return out.sort((x, y) => x - y);
}
const round1 = (v) => Math.round(v * 10) / 10;
const isInside = (id, local) => crossings(bones[id], toArchive(id, local), vUnit([0.31, 0.22, 0.92])).length % 2 === 1;
// The back of the bone at a given distance from the middle and a given height: how far back it is.
function backOf(id, x, z) {
  const mesh = bones[id], from = toArchive(id, [x, 70, z]), dir = vUnit(vSub(toArchive(id, [x, 0, z]), from)), t = reach(mesh, from, dir);
  return t === null ? null : toLocal(id, along(from, dir, t))[1];
}
function pedicleFor(id) {
  const mesh = bones[id], [, d, h] = typical(id), a = ANATOMY[id], inward = (screwLean(id) * Math.PI) / 180;
  const usual = [a.cw / 2 + a.pw / 2 + 1.5, d / 2 + a.cd / 2 + 2, h * 0.16];
  if (/^C[3-7]$/.test(id)) {
    // In the neck a screw sits in the block of bone beside the canal. Try spots and angles
    // and keep the one where the screw stays in bone on both sides, close to the usual spot.
    const length = typicalScrew(id).length;
    let best = null;
    for (const lean of [0, -10, 10, -20, 20, -30, 30]) for (const dz of [0, 2, -2, 4]) for (let x = 9; x <= 24; x += 1) {
      const z = usual[2] + dz, rad = (lean * Math.PI) / 180, backs = [backOf(id, x, z), backOf(id, -x, z)];
      if (backs[0] === null || backs[1] === null || Math.abs(backs[0] - backs[1]) > 6) continue;
      const y = (backs[0] + backs[1]) / 2;
      const inBone = [1, -1].map((sg) => { let n = 0; for (let k = 1; k <= 12; k++) if (isInside(id, [sg * (x - Math.sin(rad) * length * (k / 12)), y - Math.cos(rad) * length * (k / 12), z])) n++; return n; });
      const score = Math.min(...inBone) - 0.12 * Math.abs(x - usual[0]) - 0.02 * Math.abs(lean) - 0.1 * Math.abs(dz);
      if (!best || score > best.score) best = { score, inBone, entry: [x, y, z].map(round1), lean };
    }
    return best ? { at: null, entry: best.entry, lean: best.lean, usual, inBone: best.inBone } : null;
  }
  if (!/^[TL]/.test(id)) {
    // Atlas, axis and sacrum: keep the usual spot, but set it on the back of the real bone.
    const sides = [backOf(id, usual[0], usual[2]), backOf(id, -usual[0], usual[2])];
    if (sides[0] === null || sides[1] === null || Math.abs(sides[0] - sides[1]) > 8) return null;
    return { at: null, entry: [usual[0], (sides[0] + sides[1]) / 2, usual[2]].map(round1), usual };
  }
  let best = null;
  // try a few cuts behind the back wall of the body and keep the one where the bridge is lowest
  for (let behind = 1.5; behind <= 7.5; behind += 1) {
    const y = d / 2 + behind, sides = [[], []];
    for (let z = -h * 0.7; z <= h * 0.9; z += 0.5) {
      const start = toArchive(id, [-70, y, z]), far = toArchive(id, [70, y, z]), dir = vUnit(vSub(far, start)), hits = crossings(mesh, start, dir);
      const runs = [];
      for (let k = 0; k + 1 < hits.length; k += 2) runs.push([toLocal(id, along(start, dir, hits[k]))[0], toLocal(id, along(start, dir, hits[k + 1]))[0]]);
      // the bone nearest the canal on each side; a side process that has grown onto the pedicle is cut off
      const left = runs.find((r) => r[0] > 2 && r[1] - r[0] > 0.5), right = [...runs].reverse().find((r) => r[1] < -2 && r[1] - r[0] > 0.5);
      if (left) sides[0].push([left[0], Math.min(left[1] - left[0], a.pw * 1.4), z]);
      if (right) sides[1].push([-right[1], Math.min(right[1] - right[0], a.pw * 1.4), z]);
    }
    const blob = (rows) => {
      // the rows that hang together, largest group
      const groups = [];
      for (const r of rows) { const g = groups[groups.length - 1]; if (g && r[2] - g[g.length - 1][2] < 0.75) g.push(r); else groups.push([r]); }
      const size = (g) => g.reduce((s, r) => s + r[1], 0), g = groups.sort((p, q) => size(q) - size(p))[0];
      if (!g) return null;
      return { x: g.reduce((s, r) => s + (r[0] + r[1] / 2) * r[1], 0) / size(g), z: g.reduce((s, r) => s + r[2] * r[1], 0) / size(g), tall: g.length * 0.5 };
    };
    const l = blob(sides[0]), r = blob(sides[1]);
    if (!l || !r) continue;
    const tall = l.tall + r.tall;
    if (!best || tall < best.tall - 0.01) best = { tall, y, x: (l.x + r.x) / 2, z: (l.z + r.z) / 2 };
  }
  if (!best) return null;
  // the place where a screw aimed through that pedicle enters the bone at the back
  const entries = [1, -1].map((sg) => {
    const from = toArchive(id, [sg * best.x, best.y, best.z]), to = toArchive(id, [sg * (best.x + Math.sin(inward) * 10), best.y + Math.cos(inward) * 10, best.z]);
    const dir = vUnit(vSub(to, from)), hits = crossings(mesh, from, dir);
    let k = 0;
    while (k + 2 < hits.length && hits[k + 1] - hits[k] < 2.5) k += 2;       // step over a small notch
    return hits.length ? toLocal(id, along(from, dir, hits[k])) : null;
  });
  if (!entries[0] || !entries[1]) return null;
  return { at: [best.x, best.y, best.z].map(round1), entry: [(entries[0][0] - entries[1][0]) / 2, (entries[0][1] + entries[1][1]) / 2, (entries[0][2] + entries[1][2]) / 2].map(round1), usual, each: entries.map((e) => e.map(round1)) };
}

// ---------------------------------------------------------------- writing the module
const base64 = (numbers, signed) => {
  const buffer = Buffer.alloc(numbers.length * 2);
  numbers.forEach((v, i) => (signed ? buffer.writeInt16LE(v, i * 2) : buffer.writeUInt16LE(v, i * 2)));
  return buffer.toString('base64');
};
const signedVolume = (p, ix) => { let v = 0; for (let f = 0; f < ix.length; f += 3) { const a = p.slice(ix[f] * 3, ix[f] * 3 + 3), b = p.slice(ix[f + 1] * 3, ix[f + 1] * 3 + 3), c = p.slice(ix[f + 2] * 3, ix[f + 2] * 3 + 3); v += vDot(a, vCross(b, c)) / 6; } return v; };

const lines = [], counts = [];
for (const id of LEVEL_ORDER) {
  const mesh = bones[id], local = [];
  for (const p of pointsOf(mesh)) local.push(...toLocal(id, p).map((v) => Math.round(v * 100)));
  if (Math.max(...local.map(Math.abs)) > 32767) throw new Error(id + ' does not fit the number range used to store it');
  if (mesh.positions.length / 3 > 65535) throw new Error(id + ' has too many points to store');
  let indices = mesh.indices;
  if (signedVolume(local, indices) < 0) { indices = indices.slice(); for (let f = 0; f < indices.length; f += 3) [indices[f + 1], indices[f + 2]] = [indices[f + 2], indices[f + 1]]; }
  const top = ringFor(id, true), bottom = ringFor(id, false), pedicle = pedicleFor(id);
  counts.push([id, local.length / 3, indices.length / 3, top ? 'yes' : '-', bottom ? 'yes' : '-', pedicle]);
  lines.push('  ' + id + ': { file: \'' + mesh.file + '\', size: ' + JSON.stringify(typical(id).map((v) => Math.round(v * 100) / 100)) + ', top: ' + JSON.stringify(top) + ', bottom: ' + JSON.stringify(bottom)
    + ', pedicle: ' + JSON.stringify(pedicle ? { at: pedicle.at, entry: pedicle.entry, ...(typeof pedicle.lean === 'number' ? { lean: pedicle.lean } : {}) } : null) + ', points: \'' + base64(local, true) + '\', faces: \'' + base64(indices, false) + '\' },');
}

const text = `// The shape of every vertebra and of the sacrum, from the BodyParts3D anatomy models.
// Written by tools/make-shapes.mjs. Do not edit by hand.
//
// BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
// https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
// Changed for this app: each bone was moved into its own axes (x = left, y = back, z = up,
// the middle of its body at 0, 0, 0), resized so its body has the typical size listed in
// src/core/anatomy.js, its doubled points were merged and its numbers rounded to 0.01 mm.
// NOTICE.md tells the whole story.
//
//   file      the file of the archive the bone comes from
//   size      width, depth and height of the body the shape is drawn for
//   top, bottom   where a disc meets the body: 28 points round the surface
//   pedicle   at: the middle of the left pedicle, entry: where a screw enters the bone at the
//             back, lean: the angle toward the middle that keeps the screw in bone (neck only)
//   points    x, y, z of every point, in hundredths of a millimetre, as 16 bit numbers in base 64
//   faces     three point numbers for every triangle, as 16 bit numbers in base 64

export const SHAPE_CREDIT = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';

export const SHAPES = {
${lines.join('\n')}
};
`;
fs.mkdirSync(path.join(root, 'src', 'shapes'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'shapes', 'bodyparts3d.js'), text);

if (showTable) {
  const n = (v, w = 6) => (Number.isFinite(v) ? v.toFixed(1) : '-').padStart(w);
  console.log('bone  file      width  depth  front   back   scale across, deep, tall');
  for (const r of table.sort((a, b) => LEVEL_ORDER.indexOf(a[0]) - LEVEL_ORDER.indexOf(b[0]))) console.log(r[0].padEnd(5), r[1].padEnd(8), n(r[2]), n(r[3]), n(r[4]), n(r[5]), '  ', r[6].toFixed(2), r[7].toFixed(2), r[8].toFixed(2), r[9] ? '  top ' + r[9].map((v) => v.toFixed(1)).join(' x ') + ' under ' + r[10].map((v) => v.toFixed(1)).join(' x ') + '  table ' + r[11].map((v) => v.toFixed(1)).join(' x ') : '');
  console.log('\nbone  points faces  rings  pedicle at (found) | screw entry the drawn bones use | screw entry');
  for (const c of counts) console.log(c[0].padEnd(5), String(c[1]).padStart(5), String(c[2]).padStart(6), ' ', c[3], c[4], '  ', c[5] ? (c[5].at ? c[5].at.join(', ') : 'usual spot') + ' | ' + c[5].usual.map((v) => v.toFixed(1)).join(', ') + ' | ' + c[5].entry.join(', ') + (typeof c[5].lean === 'number' ? '   lean ' + c[5].lean + ', in bone ' + c[5].inBone.join(' and ') + ' of 12' : '') + (c[5].each ? '   (left ' + c[5].each[0].join(', ') + ', right ' + c[5].each[1].join(', ') + ')' : '') : '-');
}
const points = counts.reduce((s, c) => s + c[1], 0), faces = counts.reduce((s, c) => s + c[2], 0);
console.log('src/shapes/bodyparts3d.js written:', counts.length, 'bones,', points, 'points,', faces, 'triangles,', Math.round(text.length / 1024), 'KB');
