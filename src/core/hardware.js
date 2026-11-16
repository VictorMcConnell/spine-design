// Generic spinal hardware drawn from typical sizes: rods, screws with a rod-holding head,
// hooks and cross-links. These are plain shapes of their kind, the way a drawing of a hammer
// is just a hammer. They do not copy any maker's product.

import { vSub, vAdd, vScale, vUnit, vLerp, vCross, vDot, vLen } from './vec.js';
import { appendMesh, tube, arcThrough } from './mesh.js';
import { softMax, meshFromDistance } from './solid.js';
import { ANATOMY } from './anatomy.js';
import { LEVEL_ORDER } from './spinefile.js';

// Typical sizes in millimetres.
export const HARDWARE = {
  rodDiameter: 5.5,                        // 5.5 is the usual rod, 6.0 to 6.35 for deformity work
  head: { diameter: 13, height: 17 },      // the rod-holding head of a screw or hook
  screw: { pitch: 2.0, threadDepth: 1.0 }, // one thread pitch for every screw
  hooks: {                                 // blade width and thickness by where the hook sits
    pedicle: { width: 5.5, thick: 1.6 },
    lamina: { width: 7.5, thick: 1.8 },
    'transverse process': { width: 7, thick: 1.6 },
  },
  crosslinkBar: 3.5,
};

// Typical sizes by part of the spine, in millimetres. General figures for the builder to start
// from when a piece is added. A surgeon sizes every piece to the person, so a real spine can
// differ from these and still be perfectly normal.
export const TYPICAL = {
  screws: {                                // thinnest, thickest and usual length
    neck: { thin: 3.5, thick: 4, length: 14 },
    'upper chest': { thin: 4, thick: 5, length: 30 },      // T1 to T6
    'lower chest': { thin: 4.5, thick: 5.5, length: 40 },  // T7 to T12
    'lower back': { thin: 5.5, thick: 7.5, length: 45 },
    sacrum: { thin: 6.5, thick: 7.5, length: 40 },
  },
  rods: { neck: 3.5, usual: 5.5, heavy: 6 },
  heads: { neck: { diameter: 8, height: 12 }, usual: { diameter: 13, height: 17 } },
  hooks: { lamina: { throat: 6.5, blade: 10 }, pedicle: { throat: 5, blade: 9 } },
  crosslink: { bar: 3.5, shortest: 15, longest: 60 },
};

// Which row of TYPICAL.screws a level belongs to.
export function screwRegion(levelId) {
  const i = LEVEL_ORDER.indexOf(levelId);
  if (i < 0) return 'lower chest';
  if (levelId[0] === 'C') return 'neck';
  if (levelId[0] === 'T') return i <= LEVEL_ORDER.indexOf('T6') ? 'upper chest' : 'lower chest';
  return levelId[0] === 'L' ? 'lower back' : 'sacrum';
}

// A sensible screw to start with at a level: about four fifths of the typical width of the
// pedicle it goes through, kept inside the usual range for that part of the spine and rounded
// to the half millimetre.
export function typicalScrew(levelId) {
  const row = TYPICAL.screws[screwRegion(levelId)], pedicle = (ANATOMY[levelId] || ANATOMY.T8).pw;
  const diameter = Math.min(row.thick, Math.max(row.thin, Math.round(pedicle * 0.8 * 2) / 2));
  return { diameter, length: levelId === 'C7' ? 22 : row.length };
}

// How far a screw points toward the middle of the body as it goes in, in degrees: most in the
// lower back and at the top of the chest, least in the middle of the chest.
export function screwLean(levelId) {
  const low = ['L1', 'L2', 'L3', 'L4', 'L5', 'S1'].indexOf(levelId), high = ['T1', 'T2', 'T3'].indexOf(levelId);
  return low >= 0 ? 12 + 3 * low : high >= 0 ? 22 - 5 * high : levelId[0] === 'C' ? 20 : 8;
}

// Colours a person can pick for a piece of hardware. The first two are what the metal looks
// like. The rest are there to tell parts apart at a glance and to make a point in a picture.
export const FINISHES = {
  titanium: [0.6, 0.62, 0.66], steel: [0.78, 0.8, 0.83], black: [0.13, 0.14, 0.16], white: [0.93, 0.93, 0.9],
  blue: [0.16, 0.33, 0.72], sky: [0.3, 0.62, 0.92], teal: [0.1, 0.6, 0.6], green: [0.2, 0.55, 0.3], lime: [0.58, 0.78, 0.2],
  gold: [0.8, 0.62, 0.2], orange: [0.93, 0.5, 0.13], red: [0.82, 0.2, 0.18], pink: [0.92, 0.42, 0.66], purple: [0.5, 0.36, 0.78],
};
// The colour each kind of part has when nothing else is chosen.
export const USUAL_FINISH = { rods: 'blue', screws: 'titanium', hooks: 'purple', crosslinks: 'gold' };
// Sets of colours that go together, for one click.
export const PALETTES = {
  metal: { rods: 'steel', screws: 'titanium', hooks: 'titanium', crosslinks: 'steel' },
  classic: { rods: 'blue', screws: 'titanium', hooks: 'purple', crosslinks: 'gold' },
  bright: { rods: 'sky', screws: 'orange', hooks: 'pink', crosslinks: 'lime' },
  bold: { rods: 'red', screws: 'white', hooks: 'gold', crosslinks: 'black' },
};
// A colour from its name in FINISHES or from '#rrggbb', as [red, green, blue] from 0 to 1.
export function colorOf(name) {
  if (FINISHES[name]) return FINISHES[name];
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(name || '');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : null;
}

export function rodMesh(rod) {
  const r = (rod.diameter || HARDWARE.rodDiameter) / 2;
  return tube(rod.points, () => [r, r], [1, 0, 0], 14);
}

// The head that grips the rod, in its own axes: z points away from the bone, the rod runs
// along x through the origin. A drum with a U-shaped slot for the rod, closed above the rod
// by a set screw with a six-lobed socket.
let headShapes = new Map();
function headShape(rodDiameter) {
  if (headShapes.has(rodDiameter)) return headShapes.get(rodDiameter);
  const R = HARDWARE.head.diameter / 2, top = 9, bottom = top - HARDWARE.head.height, slot = rodDiameter / 2 + 0.35;
  const distance = (x, y, z) => {
    const round = Math.hypot(x, y);
    // the drum, narrowing a little toward the bone
    let f = softMax(round - (R - (z < -3 ? (-3 - z) * 0.35 : 0)), Math.max(z - top, bottom - z), 0.8);
    // the slot for the rod: open to the top, round at the bottom
    const u = z > 0 ? Math.abs(y) - slot : Math.hypot(y, z) - slot;
    f = Math.max(f, -u);
    // the set screw that closes the slot above the rod, with its socket
    const lobes = 2.3 + 0.5 * Math.cos(6 * Math.atan2(y, x));
    let plug = Math.max(round - (R - 2.2), Math.max(z - (top - 0.8), slot + 0.4 - z));
    plug = Math.max(plug, -Math.max(round - lobes, top - 3.4 - z));
    return Math.min(f, plug);
  };
  const mesh = meshFromDistance(distance, [-R - 1.5, -R - 1.5, bottom - 1.5], [R + 1.5, R + 1.5, top + 1.5], 0.55);
  headShapes.set(rodDiameter, mesh);
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
function headMesh(at, away, along, rodDiameter) {
  const { x, y, z } = headAxes(away, along), shape = headShape(rodDiameter), p = shape.positions, positions = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) for (let j = 0; j < 3; j++) positions[i + j] = at[j] + x[j] * p[i] + y[j] * p[i + 1] + z[j] * p[i + 2];
  // (its own copy of the faces: the caller may add more shapes to this mesh)
  return { positions, indices: shape.indices.slice() };
}
// The same head as a shape that is drawn once and then placed: { mesh, matrix }. The screen
// uses this, so moving a screw does not mean working out its head again.
function headPlaced(at, away, along, rodDiameter) {
  const { x, y, z } = headAxes(away, along);
  return { mesh: headShape(rodDiameter), matrix: new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, at[0], at[1], at[2], 1]) };
}

// A screw: a threaded shaft with one pitch along its whole length, a blunt tip and a head.
// The thread stays the same width from end to end while the core inside it slims toward the
// tip, so the thread bites deeper the further in it goes. Most screws of this kind are made so.
//   rodDirection: which way the rod runs past this screw (so the slot lines up with it)
export function screwMesh(screw, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return appendMesh(screwShaft(screw), headMesh(screw.head, vSub(screw.head, screw.tip), rodDirection, rodDiameter));
}

// The same screw in two pieces for the screen: the threaded shaft, and the head as a placed shape.
export function screwParts(screw, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return { shaft: screwShaft(screw), head: headPlaced(screw.head, vSub(screw.head, screw.tip), rodDirection, rodDiameter) };
}

function screwShaft(screw) {
  const start = screw.entry || screw.head, length = vLen(vSub(screw.tip, start));
  const crest = (screw.diameter || 5) / 2, depth = HARDWARE.screw.threadDepth;
  const coreAt = (t) => Math.max(crest * 0.45, crest - depth * (0.55 + 0.5 * t)), core = coreAt(0);
  const turns = Math.max(2, Math.round(length / HARDWARE.screw.pitch)), points = [];
  for (let i = 0; i <= turns * 2; i++) points.push(vLerp(start, screw.tip, i / (turns * 2)));
  const radius = (t) => {
    const ridge = Math.round(t * turns * 2) % 2 === 1 ? crest : coreAt(t), taper = Math.min(1, (1 - t) * length / 4 + 0.35);
    const r = (t * length < 2.5 ? core : ridge) * taper;
    return [r, r];
  };
  const mesh = tube(points, radius, [1, 0, 0], 12);
  // the short neck between the head and the thread
  return appendMesh(mesh, tube([screw.head, start], () => [core, core], [1, 0, 0], 12));
}

// A hook: a head on the rod and a curved blade that catches the bone.
export function hookMesh(hook, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return appendMesh(headMesh(hook.at, hookOut(hook, rodDirection), rodDirection, rodDiameter), hookBlade(hook, rodDirection));
}
// Which way the head of a hook opens: away from where its blade ends, square to the rod.
function hookOut(hook, rodDirection) {
  const away = vSub(hook.at, hook.tip), along = vUnit(rodDirection), flat = vSub(away, vScale(along, vDot(away, along)));
  return vLen(flat) > 1 ? flat : vSub(hook.at, hook.mid || vLerp(hook.at, hook.tip, 0.5));
}

// The same hook in two pieces for the screen: the blade, and the head as a placed shape.
export function hookParts(hook, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return { blade: hookBlade(hook, rodDirection), head: headPlaced(hook.at, hookOut(hook, rodDirection), rodDirection, rodDiameter) };
}

function hookBlade(hook, rodDirection) {
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5), kind = HARDWARE.hooks[hook.kind] || HARDWARE.hooks.lamina;
  const foot = vAdd(hook.at, vScale(vUnit(vSub(mid, hook.at)), 6));
  // the blade is wide across the plane it curves in
  let across = vCross(vSub(mid, hook.at), vSub(hook.tip, hook.at));
  across = vLen(across) > 1e-6 ? vUnit(across) : rodDirection;
  return tube(arcThrough(foot, mid, hook.tip, 14), (t) => [kind.width / 2, kind.thick * (1.25 - 0.45 * t)], across, 12);
}

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
