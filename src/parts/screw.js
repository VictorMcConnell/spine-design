// A pedicle screw with its rod-holding head. A plain shape of its kind: it does not copy any
// maker's product.

import { vSub, vLerp, vLen } from '../core/vec.js';
import { appendMesh, tube } from '../core/mesh.js';
import { HARDWARE } from './sizes.js';
import { headMesh, headPlaced } from './head.js';
import { rodDirectionNear } from './rod.js';

// A screw: a threaded shaft with one pitch along its whole length, a blunt tip and a head.
// The thread stays the same width from end to end while the core inside it slims toward the
// tip, so the thread bites deeper the further in it goes. Most screws of this kind are made so.
//   rodDirection: which way the rod runs past this screw (so the slot lines up with it)
// A screw can carry a "look" for its head: 'tall' or 'low'. Without it the head is the usual one.
export function screwMesh(screw, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return appendMesh(screwShaft(screw), headMesh(screw.head, vSub(screw.head, screw.tip), rodDirection, rodDiameter, screw.look));
}

// The same screw in two pieces for the screen: the threaded shaft, and the head as a placed shape.
export function screwParts(screw, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return { shaft: screwShaft(screw), head: headPlaced(screw.head, vSub(screw.head, screw.tip), rodDirection, rodDiameter, screw.look) };
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

// What the scene draws for one screw: the shaft, and the head as a shape that is drawn once
// and placed.
//   around: { rods, rodSize(id) } what the screw sits among
export function screwItems(screw, index, around) {
  const parts = screwParts(screw, rodDirectionNear(around.rods, screw.head), around.rodSize(screw.rod));
  const name = 'screw_' + (screw.level || index + 1) + '_' + (screw.side || '');
  return [{ mesh: parts.shaft, name }, { mesh: parts.head.mesh, matrix: parts.head.matrix, name }];
}
