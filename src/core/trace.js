// Tracing over a picture of an X-ray.
//
// The picture lies on a flat sheet through the spine: the sheet seen from the back (plane 0)
// or the one seen from the side (plane 1). A spot on the sheet is [across, up] in millimetres,
// the way followLine of shape.js reads a line: across is to the person's left in plane 0 and
// to the back in plane 1.
//
// Where the picture lies on its sheet is its "place":
//   { plane, at: [across, up] of the middle of the picture, k: millimetres for one pixel,
//     turn: degrees, clockwise as it is looked at, flip: true when left and right are swapped }
// A trace is a list of spots on the picture, in pixels. They belong to the picture, so they
// stay on it when it is moved, resized or turned.
//
// Nothing here reads the picture. A person marks the line of the spine, and the model is
// laid along that line. It is a way to sketch, not a way to measure.

import { sortedLevels } from './spinefile.js';
import { followLine } from './shape.js';
import { pathThrough } from './place.js';

const RAD = Math.PI / 180;
// which way "to the right, as it is looked at" runs along the sheet: from the back the
// person's left is on the left, so right is minus across. From the side the back is on the right.
const rightOf = (plane) => (plane === 0 ? -1 : 1);
const axisOf = (plane) => (plane === 0 ? 0 : 1);

// A spot of the picture (pixels, from its top left corner) as a spot on the sheet.
//   size: [width, height] of the picture in pixels
export function sheetOf(place, size, px) {
  const c = Math.cos(place.turn * RAD), s = Math.sin(place.turn * RAD), u = (px[0] - size[0] / 2) * (place.flip ? -1 : 1), v = px[1] - size[1] / 2;
  return [place.at[0] + rightOf(place.plane) * place.k * (u * c - v * s), place.at[1] - place.k * (u * s + v * c)];
}

// The other way round: a spot on the sheet as a spot of the picture, in pixels.
export function pictureOf(place, size, spot) {
  const c = Math.cos(place.turn * RAD), s = Math.sin(place.turn * RAD), x = (rightOf(place.plane) * (spot[0] - place.at[0])) / place.k, y = -(spot[1] - place.at[1]) / place.k;
  return [(x * c + y * s) * (place.flip ? -1 : 1) + size[0] / 2, -x * s + y * c + size[1] / 2];
}

// A spot on the sheet as a point of the model. "depth" is where the sheet stands along the
// third direction (see depthOf).
export const inSpace = (plane, depth, spot) => (plane === 0 ? [spot[0], depth, spot[1]] : [depth, spot[0], spot[1]]);

// Where the sheet of a plane stands: at the middle of the spine, front to back for plane 0 and
// side to side for plane 1.
export function depthOf(spine, plane) {
  const j = plane === 0 ? 1 : 0;
  return spine.levels.reduce((sum, l) => sum + l.centre[j], 0) / spine.levels.length;
}

// The four corners of the picture as points of the model: top left, top right, bottom right, bottom left.
export function cornersOf(place, size, depth) {
  return [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]].map((px) => inSpace(place.plane, depth, sheetOf(place, size, px)));
}

// A place for a picture that was just opened: upright, not flipped, its middle on the middle of
// the spine, and a little taller than the spine so that all of it shows.
export function firstPlace(spine, plane, size) {
  const axis = axisOf(plane), zs = spine.levels.map((l) => l.centre[2]), as = spine.levels.map((l) => l.centre[axis]);
  const low = Math.min(...zs), high = Math.max(...zs);
  return { plane, at: [round2((Math.min(...as) + Math.max(...as)) / 2), round2((low + high) / 2)], k: ((high - low) * 1.25) / size[1], turn: 0, flip: false };
}

// Resize or turn the picture about one of its own spots (in pixels), which stays where it is on the sheet.
export function placeAbout(place, size, px, change) {
  const held = sheetOf(place, size, px), next = { ...place, ...change }, now = sheetOf(next, size, px);
  return { ...next, at: [next.at[0] + held[0] - now[0], next.at[1] + held[1] - now[1]] };
}

// The spots of a trace from the lowest to the highest, as they lie on the sheet.
export function ordered(place, size, points) {
  return points.map((px) => ({ px, at: sheetOf(place, size, px) })).sort((a, b) => a.at[1] - b.at[1]);
}

// The smooth line through the spots of a trace, on the sheet, from the bottom up.
export function lineOfTrace(place, size, points) {
  const list = ordered(place, size, points).map((p) => p.at);
  if (list.length < 2) return list;
  return pathThrough(list.map((p) => [p[0], 0, p[1]])).map((p) => [p[0], p[2]]);
}
const lengthOf = (line) => line.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);

// How long the spine is between two vertebrae as it shows on a sheet: from middle to middle, along the vertebrae between them.
export function runOf(spine, plane, top, bottom) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom), axis = axisOf(plane);
  if (a < 0 || b < 0 || a === b) return 0;
  return lengthOf(levels.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => [l.centre[axis], l.centre[2]]));
}

// The spine takes the shape of the trace as the picture lies now. Nothing about the picture
// changes. Returns false if the trace is too short to follow.
//   opts.held: names of locked vertebrae (they stay where they are)
export function followTrace(spine, rig, place, size, points, opts = {}) {
  const line = lineOfTrace(place, size, points);
  if (line.length < 2 || line[line.length - 1][1] - line[0][1] < 30) return false;
  followLine(spine, rig, place.plane, line, { held: opts.held || [], smooth: 2 });
  return true;
}

// Fit the spine to a trace, and the picture to the spine.
//
// The trace is taken to run from the middle of the vertebra "bottom" up to the middle of the
// vertebra "top". That gives the size of the picture: it is made as large as it has to be for
// the traced line to be as long as that part of the spine. The spine is laid along the line,
// and the picture is moved so that the bottom of the trace sits on the bottom vertebra. Laying
// the spine along a curve changes how long it shows on the sheet, so this is done a few
// times over, until the size settles.
//
// Returns null if there is nothing to fit, or
//   { place: where the picture lies now, miss: how far the top of the trace ends from the middle of the top vertebra, in mm }
export function fitTrace(spine, rig, place, size, points, top, bottom, opts = {}) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom), axis = axisOf(place.plane);
  if (points.length < 2 || a < 0 || b < 0 || a >= b) return null;
  let next = { ...place, at: [place.at[0], place.at[1]] };
  // The length of the trace in pixels, which does not depend on where the picture lies. It is taken from the picture
  // blown up to about the size of a spine, as the smooth line is made for that size, less the short piece it
  // runs on past each end.
  const span = (j) => Math.max(...points.map((p) => p[j])) - Math.min(...points.map((p) => p[j])), tall = Math.max(span(0), span(1)), blown = 500 / Math.max(1e-6, tall);
  const long = (lengthOf(lineOfTrace({ ...next, k: blown }, size, points)) - 18) / blown;
  if (tall < 8 || !(long > 8)) return null;
  const foot = () => [levels[b].centre[axis], levels[b].centre[2]];
  // put the picture where its lowest traced spot sits on the bottom vertebra
  const settle = () => { const low = ordered(next, size, points)[0], to = foot(); next.at = [next.at[0] + to[0] - low.at[0], next.at[1] + to[1] - low.at[1]]; };
  for (let round = 0; round < 6; round++) {
    const k = runOf(spine, place.plane, top, bottom) / long, was = next.k;
    next.k = k; settle();
    if (!followTrace(spine, rig, next, size, points, opts)) return null;
    if (round > 0 && Math.abs(k - was) < was * 0.002) break;
  }
  settle();
  next.at = next.at.map(round2);
  const high = ordered(next, size, points).pop().at, head = levels[a].centre;
  return { place: next, miss: round2(Math.hypot(high[0] - head[axis], high[1] - head[2])) };
}

// A line drawn by hand over the picture (pixels) as a few spots that can be dragged after: its
// two ends and evenly spaced spots between them.
export function spotsAlong(stroke, count = 8) {
  const pts = stroke.filter((p, i) => i === 0 || Math.hypot(p[0] - stroke[i - 1][0], p[1] - stroke[i - 1][1]) > 0.5);
  if (pts.length < 2) return pts.slice();
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const whole = at[at.length - 1], out = [];
  for (let n = 0, i = 1; n < count; n++) {
    const want = (whole * n) / (count - 1);
    while (i < pts.length - 1 && at[i] < want) i++;
    const t = (want - at[i - 1]) / Math.max(1e-9, at[i] - at[i - 1]);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
  }
  return out;
}

// ---- how the picture is shown

// The usual settings of a picture: as it is, fully solid, nothing hidden.
export const USUAL_TONE = { bright: 0, contrast: 0, cut: 0, solid: 100, invert: false };

// Work out how every shade of grey is shown.
//   bright:   -100 (darker) to 100 (lighter)
//   contrast: -100 (flatter) to 100 (harder)
//   cut:      0 to 100. The dark of the picture, up to this level, is see-through, with a soft edge.
//   solid:    0 (not there) to 100 (solid): how much of what is left covers the model
//   invert:   light and dark swapped (some films are stored that way round)
// Returns { shade, cover }: for each grey from 0 to 255, the grey that is drawn and how much it covers (0 to 255).
export function toneTable(tone) {
  const t = { ...USUAL_TONE, ...tone }, C = Math.max(-254, Math.min(254, t.contrast * 2.2)), f = (259 * (C + 255)) / (255 * (259 - C));
  const shade = new Uint8ClampedArray(256), cover = new Uint8ClampedArray(256), edge = 36, at = t.cut * 2.55;
  for (let g = 0; g < 256; g++) {
    const v = Math.max(0, Math.min(255, f * ((t.invert ? 255 - g : g) - 128) + 128 + t.bright * 1.275));
    shade[g] = v;
    cover[g] = (t.cut > 0 ? Math.max(0, Math.min(1, (v - at + edge / 2) / edge)) : 1) * (t.solid / 100) * 255;
  }
  return { shade, cover };
}

// Paint the picture with those settings.
//   grey: one number for every pixel (0 dark to 255 light)     out: four numbers for every pixel (red, green, blue, cover)
export function tonePicture(grey, out, tone) {
  const { shade, cover } = toneTable(tone);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) { const g = grey[i]; out[j] = out[j + 1] = out[j + 2] = shade[g]; out[j + 3] = cover[g]; }
  return out;
}

// ---- laying a flat picture over the 3D view

// The numbers for a CSS "matrix3d" that lays a box of w by h pixels, whose top left corner is at
// the top left of the page, onto four spots of the screen: top left, top right, bottom
// right, bottom left. Null when the four spots do not make a shape a picture can be laid on
// (seen from its edge, for one).
export function quadMatrix(w, h, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  // the unit square onto the four spots, then the box onto the unit square
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  const area = Math.abs((x2 - x0) * (y3 - y1) - (x3 - x1) * (y2 - y0)) / 2;
  if (area < 4 || ![a, b, c, d, e, f, g, hh].every(Number.isFinite)) return null;
  // (every corner has to lie in front of the eye, or the picture would fold over itself)
  if (1 + g <= 0.02 || 1 + hh <= 0.02 || 1 + g + hh <= 0.02) return null;
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
}

function round2(v) { return Math.round(v * 100) / 100; }
