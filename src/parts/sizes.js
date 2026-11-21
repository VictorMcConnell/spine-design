// Typical sizes of generic spinal hardware, in millimetres. docs/measurements.md says where
// the figures come from.

import { ANATOMY } from '../core/anatomy.js';
import { LEVEL_ORDER } from '../core/spinefile.js';

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

// The looks a screw's head can have. They are general shapes of their kind, not products:
//   standard  the usual head: a drum with a slot for the rod, closed by a set screw
//   tall      the same with its two arms carried on well above the set screw, as on screws
//             that are used to draw a rod down into the head
//   low       a smaller, lower head that sits closer to the bone
// diameter and height of the head, how far its top is above the middle of the rod ("top"),
// and where the set screw ends ("cap": at the top, except on the tall head)
export const HEADS = {
  standard: { diameter: 13, height: 17, top: 9, cap: 9 },
  tall: { diameter: 13, height: 27, top: 19, cap: 9 },
  low: { diameter: 10.5, height: 12.5, top: 7, cap: 7 },
};
export const SCREW_LOOKS = Object.keys(HEADS);

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
