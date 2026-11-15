// Typical sizes of the vertebrae, in millimetres. Plain numbers, no 3D models.
// Source: general measurement tables compiled for this project, corrected where they did not
// follow well known anatomy. docs/measurements.md lists every change.
//   w, d      width and depth of the vertebral body
//   hf, hb    height of the body at the front and at the back
//   cw, cd    width and depth of the canal the cord runs through
//   sp, drop  length of the spinous process and how steeply it points down, in degrees
//   tp        span across the two side processes
//   pw, ph    width and height of a pedicle

export const ANATOMY = {
  C1: { w: 20, d: 15, hf: 0, hb: 0, cw: 24, cd: 16, sp: 0, drop: 0, tp: 78, pw: 5, ph: 6 },
  C2: { w: 16.5, d: 15.5, hf: 15, hb: 14, cw: 23.8, cd: 15.8, sp: 18, drop: 10, tp: 52, pw: 5.1, ph: 6.1 },
  C3: { w: 16, d: 15.5, hf: 12, hb: 13, cw: 23.6, cd: 15.6, sp: 13, drop: 15, tp: 48, pw: 5.2, ph: 6.2 },
  C4: { w: 16.5, d: 15.5, hf: 12.5, hb: 13.5, cw: 23.4, cd: 15.4, sp: 13, drop: 15, tp: 50, pw: 5.3, ph: 6.3 },
  C5: { w: 17.5, d: 16, hf: 13, hb: 14, cw: 23.2, cd: 15.2, sp: 14, drop: 15, tp: 52, pw: 5.4, ph: 6.4 },
  C6: { w: 19, d: 16.5, hf: 13.5, hb: 14.5, cw: 23, cd: 15, sp: 18, drop: 15, tp: 55, pw: 5.5, ph: 6.5 },
  C7: { w: 22, d: 17, hf: 14, hb: 15, cw: 22.8, cd: 14.8, sp: 30, drop: 12, tp: 62, pw: 5.6, ph: 6.6 },
  T1: { w: 27, d: 18.5, hf: 16, hb: 18, cw: 18, cd: 15, sp: 25, drop: 30, tp: 75, pw: 8, ph: 10 },
  T2: { w: 26, d: 19.5, hf: 16.8, hb: 18.8, cw: 18, cd: 15, sp: 26.5, drop: 35, tp: 70, pw: 6.5, ph: 10.3 },
  T3: { w: 25.5, d: 21, hf: 17.6, hb: 19.6, cw: 18, cd: 15, sp: 28, drop: 40, tp: 66, pw: 5.5, ph: 10.6 },
  T4: { w: 26, d: 22.5, hf: 18.4, hb: 20.4, cw: 18, cd: 15, sp: 29.5, drop: 50, tp: 64, pw: 4.8, ph: 10.9 },
  T5: { w: 27, d: 24, hf: 19.2, hb: 21.2, cw: 18, cd: 15, sp: 31, drop: 55, tp: 63, pw: 4.8, ph: 11.2 },
  T6: { w: 28, d: 26, hf: 20, hb: 22, cw: 18, cd: 15, sp: 32.5, drop: 60, tp: 62, pw: 5, ph: 11.5 },
  T7: { w: 29.5, d: 27.5, hf: 20.8, hb: 22.8, cw: 18, cd: 15, sp: 34, drop: 60, tp: 61, pw: 5.3, ph: 11.8 },
  T8: { w: 31, d: 28.5, hf: 21.6, hb: 23.6, cw: 18, cd: 15, sp: 35, drop: 55, tp: 60, pw: 5.8, ph: 12.1 },
  T9: { w: 33, d: 29.5, hf: 22.4, hb: 24.4, cw: 18, cd: 15, sp: 33, drop: 50, tp: 59, pw: 6.3, ph: 12.4 },
  T10: { w: 35, d: 30.5, hf: 23.2, hb: 25.2, cw: 18, cd: 15, sp: 31, drop: 40, tp: 56, pw: 7, ph: 12.7 },
  T11: { w: 38, d: 31.5, hf: 24, hb: 26, cw: 18, cd: 15, sp: 29, drop: 25, tp: 50, pw: 8.5, ph: 13 },
  T12: { w: 41, d: 32.5, hf: 24.8, hb: 26.8, cw: 18, cd: 15, sp: 27, drop: 15, tp: 46, pw: 8.5, ph: 13.3 },
  L1: { w: 43, d: 33, hf: 24.4, hb: 26.6, cw: 22, cd: 16, sp: 30, drop: 5, tp: 70, pw: 8, ph: 15 },
  L2: { w: 45, d: 34, hf: 27.2, hb: 26, cw: 22.5, cd: 16.2, sp: 30, drop: 5, tp: 76, pw: 8.5, ph: 15.5 },
  L3: { w: 47, d: 35, hf: 28.4, hb: 27, cw: 23, cd: 16.4, sp: 30, drop: 5, tp: 84, pw: 10, ph: 16 },
  L4: { w: 49, d: 35.5, hf: 29.6, hb: 28, cw: 23.5, cd: 16.6, sp: 30, drop: 5, tp: 82, pw: 12.5, ph: 16.5 },
  L5: { w: 51, d: 35.5, hf: 32.2, hb: 27.6, cw: 24, cd: 16.8, sp: 30, drop: 5, tp: 86, pw: 16, ph: 17 },
  S1: { w: 50, d: 33, hf: 30, hb: 27, cw: 26, cd: 15, sp: 0, drop: 0, tp: 105, pw: 18, ph: 18 },
};

// Height of each disc at the front and at the back, named by the two vertebrae it sits between.
export const DISCS = {
  'C2/C3': [4.5, 3.5],
  'C3/C4': [4.5, 3.5],
  'C4/C5': [4.5, 3.5],
  'C5/C6': [4.5, 3.5],
  'C6/C7': [4.5, 3.5],
  'C7/T1': [4.5, 3.5],
  'T1/T2': [5, 5.5],
  'T2/T3': [5, 5.5],
  'T3/T4': [5, 5.5],
  'T4/T5': [5, 5.5],
  'T5/T6': [5, 5.5],
  'T6/T7': [5, 5.5],
  'T7/T8': [5, 5.5],
  'T8/T9': [5, 5.5],
  'T9/T10': [5, 5.5],
  'T10/T11': [5, 5.5],
  'T11/T12': [5, 5.5],
  'T12/L1': [5, 5.5],
  'L1/L2': [10, 7],
  'L2/L3': [10, 7],
  'L3/L4': [10, 7],
  'L4/L5': [10, 7],
  'L5/S1': [10, 7],
};

// The usual curves seen from the side, in degrees.
export const ALIGNMENT = { neckLordosis: 30, chestKyphosis: 40, lowerBackLordosis: 50, sacralSlope: 40 };
