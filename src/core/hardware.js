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

// Colours a person can pick for a piece of hardware.
export const FINISHES = {
  titanium: [0.6, 0.62, 0.66], steel: [0.78, 0.8, 0.83], blue: [0.16, 0.33, 0.72], green: [0.2, 0.55, 0.3],
  purple: [0.5, 0.36, 0.78], gold: [0.8, 0.62, 0.2],
};

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
  return { positions, indices: shape.indices };
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
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5);
  return appendMesh(headMesh(hook.at, vSub(hook.at, mid), rodDirection, rodDiameter), hookBlade(hook, rodDirection));
}

// The same hook in two pieces for the screen: the blade, and the head as a placed shape.
export function hookParts(hook, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5);
  return { blade: hookBlade(hook, rodDirection), head: headPlaced(hook.at, vSub(hook.at, mid), rodDirection, rodDiameter) };
}

function hookBlade(hook, rodDirection) {
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5), kind = HARDWARE.hooks[hook.kind] || HARDWARE.hooks.lamina;
  const foot = vAdd(hook.at, vScale(vUnit(vSub(mid, hook.at)), 6));
  // the blade is wide across the plane it curves in
  let across = vCross(vSub(mid, hook.at), vSub(hook.tip, hook.at));
  across = vLen(across) > 1e-6 ? vUnit(across) : rodDirection;
  return tube(arcThrough(foot, mid, hook.tip, 14), (t) => [kind.width / 2, kind.thick * (1.25 - 0.45 * t)], across, 12);
}

// A cross-link: a bar between the two rods with a clamp at each end.
export function crosslinkMesh(link) {
  const r = HARDWARE.crosslinkBar / 2, along = vUnit(vSub(link.to, link.from));
  const mesh = tube([link.from, link.to], () => [r, r], [0, 0, 1], 12);
  for (const end of [link.from, link.to]) {
    appendMesh(mesh, tube([vSub(end, vScale(along, 4.5)), vAdd(end, vScale(along, 4.5))], (t) => { const k = 4.6 - 1.2 * Math.abs(2 * t - 1) ** 3; return [k, k]; }, [0, 0, 1], 14));
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
