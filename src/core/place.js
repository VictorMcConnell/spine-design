// Putting hardware on a spine: the usual spot for a screw or a hook on each side of each
// vertebra, rods that run through whatever is placed, and a quick way to fit out a whole
// stretch in one go. Positions are typical ones worked out from the size of each vertebra.

import { vAdd, vSub, vScale, vUnit, vLen, vDist, vDot, toWorld } from './vec.js';
import { sortedLevels, LEVEL_ORDER } from './spinefile.js';
import { anatomyFor, levelFrame, screwEntryFor } from './bones.js';
import { typicalScrew, screwLean, HARDWARE } from './hardware.js';
import { toLocal } from './shape.js';

const RAD = Math.PI / 180;
const round1 = (v) => Math.round(v * 10) / 10;
const sign = (side) => (side === 'left' ? 1 : -1);

// The usual spot on one side of a vertebra, in the world.
//   screw: { head, entry, tip, diameter }   hook: { at, mid, tip, kind, faces }
//   faces: which way the blade of the hook points, 'down' (the usual) or 'up'
export function slot(level, side, faces = 'down') {
  const a = anatomyFor(level.id, level.size), frame = levelFrame(level), sg = sign(side);
  const h = (a.hf + a.hb) / 2, back = a.d / 2, cy = back + a.cd / 2 - 1, px = a.cw / 2 + a.pw / 2, zp = h * 0.16;
  // screws point forward through the pedicle and a little toward the middle, more so lower down
  // with the real bones the screw goes in where the way through that bone was found
  const found = screwEntryFor(level.id, level.size), inward = (found && found.lean !== null ? found.lean : screwLean(level.id)) * RAD;
  const dir = [-sg * Math.sin(inward), -Math.cos(inward), 0], entry = found ? [sg * found.entry[0], found.entry[1], found.entry[2]] : [sg * (px + 1.5), cy + 3, zp];
  const size = typicalScrew(level.id), longest = (entry[1] + back - 3) / Math.cos(inward), length = Math.max(8, Math.min(size.length, longest));
  const out = (p) => toWorld(p, level.centre, frame).map(round1), along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  const head = along(entry, dir, -9);
  return {
    screw: { head: out(head), entry: out(entry), tip: out(along(entry, dir, length)), diameter: size.diameter },
    hook: { at: out(head), ...bladeFrom(level, out(head), sg, faces), kind: 'lamina', faces },
  };
}

// The blade of a hook whose head is at a point: it leaves the head down or up along the
// bone, where it can be seen, and then curls forward to catch under the edge of the bone.
function bladeFrom(level, at, sg, faces) {
  const frame = levelFrame(level), k = faces === 'up' ? 1 : -1;
  const off = (x, y, z) => vAdd(at, vAdd(vScale(frame.left, x), vAdd(vScale(frame.back, y), vScale(frame.up, z)))).map(round1);
  return { mid: off(-sg * 2.5, -3, 11 * k), tip: off(-sg * 4, -12, 15 * k) };
}

// Point the blade of a hook down or up, where the hook is.
export function faceHook(spine, hook, faces) {
  const level = spine.levels.find((l) => l.id === hook.level);
  if (!level) return;
  Object.assign(hook, bladeFrom(level, hook.at, sign(hook.side), faces), { faces });
}

// A screw put in by hand at a point on the bone: it heads for the middle of the body.
export function freeScrew(level, point) {
  const frame = levelFrame(level), local = toLocal(point, level.centre, frame), a = anatomyFor(level.id, level.size), sg = local[0] >= 0 ? 1 : -1;
  const aim = toWorld([sg * a.w * 0.15, -a.d * 0.15, Math.max(-3, Math.min(3, local[2]))], level.centre, frame), dir = vUnit(vSub(aim, point));
  const size = typicalScrew(level.id), length = Math.min(size.length, vDist(aim, point) + a.d * 0.25);
  return { level: level.id, side: sg > 0 ? 'left' : 'right', head: vAdd(point, vScale(dir, -9)).map(round1), entry: point.map(round1), tip: vAdd(point, vScale(dir, length)).map(round1), diameter: size.diameter };
}

// Change how thick or how long a screw is, keeping where it enters the bone.
export function resizeScrew(screw, diameter, length) {
  const start = screw.entry || screw.head, dir = vUnit(vSub(screw.tip, start));
  if (diameter) screw.diameter = diameter;
  if (length) screw.tip = vAdd(start, vScale(dir, length)).map(round1);
}
export const screwLength = (screw) => Math.round(vLen(vSub(screw.tip, screw.entry || screw.head)));

// A smooth path through a list of points, with a point about every 6 mm, running a little
// past both ends. The curve passes through every point and does not swing out beyond them
// the way a simpler curve does when the points are unevenly spread (a centripetal
// Catmull-Rom curve). Points that all but sit on each other are taken as one.
function pathThrough(points) {
  const list = [];
  for (const p of points) if (!list.length || vDist(p, list[list.length - 1]) > 3) list.push(p);
  if (list.length < 2) return list.map((p) => p.map(round1));
  const first = vAdd(list[0], vScale(vUnit(vSub(list[0], list[1])), 9)), last = vAdd(list[list.length - 1], vScale(vUnit(vSub(list[list.length - 1], list[list.length - 2])), 9));
  const p = [vAdd(first, vSub(first, list[0])), first, ...list, last, vAdd(last, vSub(last, list[list.length - 1]))], out = [];
  const mixed = (a, b, ta, tb, t) => [0, 1, 2].map((j) => (a[j] * (tb - t) + b[j] * (t - ta)) / (tb - ta));
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t0 = 0, t1 = t0 + Math.sqrt(vDist(p0, p1)), t2 = t1 + Math.sqrt(vDist(p1, p2)), t3 = t2 + Math.sqrt(vDist(p2, p3)), steps = Math.max(1, Math.ceil(vDist(p1, p2) / 6));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const a1 = mixed(p0, p1, t0, t1, t), a2 = mixed(p1, p2, t1, t2, t), a3 = mixed(p2, p3, t2, t3, t);
      out.push(mixed(mixed(a1, a2, t0, t2, t), mixed(a2, a3, t1, t3, t), t1, t2, t).map(round1));
    }
  }
  out.push(last.map(round1));
  return out;
}

// How far down the spine a point is: the distance along the line through the middles of the
// vertebrae, from the top one, to the place on that line nearest the point. Rods are strung
// through their screws and hooks in this order, whichever vertebra each one is named after.
function stationOf(levels, point) {
  let best = null, gone = 0;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i].centre, ab = vSub(levels[i + 1].centre, a), length = vLen(ab);
    let t = vDot(vSub(point, a), ab) / (length * length);
    if (i > 0) t = Math.max(0, t);
    if (i < levels.length - 2) t = Math.min(1, t);
    const off = vDist(point, vAdd(a, vScale(ab, Math.max(0, Math.min(1, t)))));
    if (!best || off < best.off) best = { off, station: gone + t * length };
    gone += length;
  }
  return best ? best.station : 0;
}

// The screws and hooks of one side in the order a rod runs through them, cut into the runs
// that each get a rod of their own (see hardware.splits).
//   returns [[{ at, level, piece }]]
function runsOf(spine, side) {
  const hw = spine.hardware, levels = sortedLevels(spine), order = (id) => LEVEL_ORDER.indexOf(id), splits = (hw.splits || []).map(order);
  const grips = [...hw.screws.filter((s) => s.side === side).map((s) => ({ at: s.head, level: s.level, piece: s })), ...hw.hooks.filter((h) => h.side === side).map((h) => ({ at: h.at, level: h.level, piece: h }))];
  for (const g of grips) g.station = stationOf(levels, g.at);
  grips.sort((p, q) => p.station - q.station);
  const runs = [[]];
  for (const g of grips) {
    const run = runs[runs.length - 1], last = run[run.length - 1];
    if (last && splits.some((sp) => sp >= order(last.level) && sp < order(g.level))) runs.push([g]); else run.push(g);
  }
  return runs;
}

// What each rod of a side is strung through, in order along the spine: its screws and hooks
// (each with .piece) and the bends made by hand that lie between its two ends (each with
// .via). One list for each run of runsOf.
function strungOf(spine, side) {
  const levels = sortedLevels(spine), bends = ((spine.hardware || {}).rods || []).filter((r) => r.side === side && r.auto).flatMap((r) => r.via || []).map((at) => ({ at, station: stationOf(levels, at), via: true }));
  return runsOf(spine, side).map((run) => (run.length < 2 ? run : [...run, ...bends.filter((v) => v.station > run[0].station + 4 && v.station < run[run.length - 1].station - 4)].sort((p, q) => p.station - q.station)));
}
// The corner a rod turns at point k of a list of points, in degrees.
function cornerAt(points, k) {
  if (k <= 0 || k >= points.length - 1) return 0;
  const a = vSub(points[k], points[k - 1]), b = vSub(points[k + 1], points[k]), la = vLen(a), lb = vLen(b);
  return la < 0.5 || lb < 0.5 ? 180 : (Math.acos(Math.max(-1, Math.min(1, vDot(a, b) / (la * lb)))) * 180) / Math.PI;
}

// ---- keeping a rod believable
// A real rod is a stiff bar that a surgeon bends by a few degrees here and there. These two
// numbers keep a sketch from doing what no rod could: the sharpest corner a rod may turn at
// one screw or hook, in degrees, and the least room between two of them on one rod, in
// millimetres.
// "bend" is the sharpest corner at a bend that is put into a rod by hand.
export const ROD_RULES = { sharpest: 45, closest: 11, bend: 32 };

// How hard a rod is asked to bend at each of its screws and hooks, and how crowded they are.
//   returns { corner, gap } for one piece: the sharpest corner at it or at its two
//   neighbours, and the distance to its nearest neighbour. Null if it is on no rod.
export function strainAt(spine, piece) {
  const list = strungOf(spine, piece.side).find((r) => r.some((g) => g.piece === piece));
  if (!list) return null;
  const i = list.findIndex((g) => g.piece === piece), points = list.map((g) => g.at);
  // (the room is counted to the next screw or hook each way, not to a bend in between)
  const gaps = [-1, 1].map((step) => { for (let k = i + step; k >= 0 && k < list.length; k += step) if (list[k].piece) return vDist(points[i], points[k]); return Infinity; });
  return { corner: Math.max(cornerAt(points, i - 1), cornerAt(points, i), cornerAt(points, i + 1)), gap: Math.min(...gaps) };
}

// Move a screw or a hook by a step, but only as far as its rod can follow: the move stops
// where the rod would have to turn a sharper corner than ROD_RULES allows or where two
// pieces would crowd each other. A piece that is already out of line may always move back
// toward the line. Returns how much of the step was taken, from 0 to 1.
export function moveInLine(spine, piece, step) {
  const keys = ['head', 'entry', 'tip', 'at', 'mid'].filter((k) => piece[k]), from = keys.map((k) => piece[k]);
  const put = (f) => keys.forEach((k, n) => { piece[k] = from[n].map((v, j) => round1(v + step[j] * f)); });
  const before = strainAt(spine, piece);
  const fine = () => { const now = strainAt(spine, piece); return !now || ((now.corner <= ROD_RULES.sharpest || now.corner <= before.corner + 0.01) && (now.gap >= ROD_RULES.closest || now.gap >= before.gap - 0.01)); };
  put(1);
  if (!before || fine()) return 1;
  let low = 0, high = 1;
  for (let k = 0; k < 9; k++) { const mid = (low + high) / 2; put(mid); if (fine()) low = mid; else high = mid; }
  put(low);
  return low;
}

// Bring a piece that was just put down into line with its rod, if it would kink the rod or
// crowd a neighbour: it slides toward the straight line between its neighbours, only as far
// as needed. Returns true if it had to move.
export function settleInLine(spine, piece) {
  const now = strainAt(spine, piece);
  if (!now || (now.corner <= ROD_RULES.sharpest && now.gap >= ROD_RULES.closest)) return false;
  const run = runsOf(spine, piece.side).find((r) => r.some((g) => g.piece === piece)), i = run.findIndex((g) => g.piece === piece), here = run[i].at;
  const prev = run[i - 1] && run[i - 1].at, next = run[i + 1] && run[i + 1].at;
  // where it would sit with no corner at all: on the line between its neighbours, or a clear step along the rod from its only one
  let goal;
  if (prev && next) { const ab = vSub(next, prev), t = Math.max(0.2, Math.min(0.8, vDot(vSub(here, prev), ab) / vDot(ab, ab))); goal = vAdd(prev, vScale(ab, t)); }
  else { const other = prev || next, away = vSub(here, other); goal = vAdd(other, vScale(vLen(away) > 0.5 ? vUnit(away) : [0, 0, prev ? -1 : 1], Math.max(vLen(away), ROD_RULES.closest + 1))); }
  const keys = ['head', 'entry', 'tip', 'at', 'mid'].filter((k) => piece[k]), from = keys.map((k) => piece[k]), step = vSub(goal, here);
  const put = (f) => keys.forEach((k, n) => { piece[k] = from[n].map((v, j) => round1(v + step[j] * f)); });
  const fine = () => { const s = strainAt(spine, piece); return s.corner <= ROD_RULES.sharpest && s.gap >= ROD_RULES.closest; };
  let low = 0, high = 1;
  put(1);
  if (fine()) { for (let k = 0; k < 8; k++) { const mid = (low + high) / 2; put(mid); if (fine()) high = mid; else low = mid; } put(high); }
  return true;
}

// Draw the rods again so that they run through every screw and hook. Each side gets one rod,
// or several where the person has said the rods end (hardware.splits: the levels below which
// the rods stop and start again). A rod that came with the file (traced from a scan) is left
// alone unless "all" is true. Bends put into a rod by hand (rod.via: extra points the rod
// passes through) are kept. Cross-links made by the sheet are put back on the new rods.
export function fitRods(spine, all = false) {
  const hw = spine.hardware = spine.hardware || {};
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) hw[key] = hw[key] || [];
  for (const side of ['right', 'left']) {
    const old = hw.rods.filter((r) => r.side === side);
    if (old.some((r) => !r.auto) && !all) continue;
    const lists = strungOf(spine, side);
    hw.rods = hw.rods.filter((r) => r.side !== side);
    lists.forEach((list, k) => {
      const id = side + (k ? '-' + (k + 1) : ''), was = old.find((r) => r.id === id) || old[0] || {}, via = list.filter((g) => g.via).map((g) => g.at);
      for (const g of list) if (g.piece) g.piece.rod = id;
      if (list.length - via.length < 2) return;
      hw.rods.push({ id, side, diameter: was.diameter || HARDWARE.rodDiameter, points: pathThrough(list.map((g) => g.at)), auto: true, source: 'typical', ...(was.color ? { color: was.color } : {}), ...(via.length ? { via } : {}) });
    });
  }
  hw.rods.sort((p, q) => (p.side === 'right' ? 0 : 1) - (q.side === 'right' ? 0 : 1));
  // cross-links that belong to a gap between two levels follow the rods, or go if a rod is gone
  hw.crosslinks = hw.crosslinks.map((c) => (c.below ? linkUnder(spine, c.below) || null : c)).filter(Boolean);
}

// Bend a rod by hand: make it pass through a point between two of its screws or hooks.
// "index" names a bend that is there already (to move it), or is left out to add one.
// Returns the number of the bend in rod.via, or -1 if the rod cannot be bent there.
//   inLine: the bend is taken only as far as a rod could be bent: the rod turns no sharper
//           corner there, or at the point before or after, than ROD_RULES allows
export function bendRod(spine, rod, at, index = -1, inLine = true) {
  if (!rod.auto) return -1;
  rod.via = rod.via || [];
  const was = index >= 0 ? rod.via[index] : null;
  let kept = at.map(round1);
  if (index < 0) index = rod.via.push(kept) - 1; else rod.via[index] = kept;
  const list = inLine && strungOf(spine, rod.side).find((r) => r.some((g) => g.at === kept));
  if (list) {
    const i = list.findIndex((g) => g.at === kept), points = list.map((g) => g.at), a = points[i - 1], b = points[i + 1], ab = vSub(b, a);
    // with no bend at all it would sit here, on the straight line between the points before and after
    const base = vAdd(a, vScale(ab, Math.max(0.15, Math.min(0.85, vDot(vSub(kept, a), ab) / vDot(ab, ab)))));
    // the corners at the point before, at the bend and at the point after. None may get sharper than the rules
    // allow, unless it was that sharp already (with no bend, or with the bend where it was).
    const corners = (p) => { points[i] = p; return [cornerAt(points, i - 1), cornerAt(points, i), cornerAt(points, i + 1)]; };
    const calm = corners(base), held = was ? corners(was) : [0, 0, 0], reach = (f) => vAdd(base, vScale(vSub(kept, base), f));
    const fine = (p) => corners(p).every((c, k) => c <= Math.max(k === 1 ? ROD_RULES.bend : ROD_RULES.sharpest, calm[k], held[k]) + 0.01);
    if (!fine(kept)) {
      let low = 0, high = 1;
      for (let k = 0; k < 9; k++) { const mid = (low + high) / 2; if (fine(reach(mid))) low = mid; else high = mid; }
      kept = rod.via[index] = reach(low).map(round1);
    }
  }
  fitRods(spine);
  const now = spine.hardware.rods.find((r) => r.id === rod.id);
  return now && now.via ? now.via.indexOf(kept) : -1;
}
// Take one bend out of a rod, or all of them (index left out).
export function unbendRod(spine, rod, index = -1) {
  if (index < 0) delete rod.via; else if (rod.via) rod.via.splice(index, 1);
  fitRods(spine);
}

// The point of a rod at a given height.
function rodAtHeight(rod, z) {
  const p = rod.points;
  for (let i = 0; i < p.length - 1; i++) {
    if ((p[i][2] - z) * (p[i + 1][2] - z) <= 0 && p[i][2] !== p[i + 1][2]) { const t = (z - p[i][2]) / (p[i + 1][2] - p[i][2]); return [0, 1, 2].map((j) => round1(p[i][j] + (p[i + 1][j] - p[i][j]) * t)); }
  }
  return null;
}

// A cross-link between the two rods at a height. Null when the rods do not both reach it.
export function crosslinkAt(spine, z) {
  const rods = (spine.hardware || {}).rods || [], right = rods.find((r) => r.side === 'right'), left = rods.find((r) => r.side === 'left');
  const from = right && rodAtHeight(right, z), to = left && rodAtHeight(left, z);
  if (!from || !to) return null;
  const levels = sortedLevels(spine), near = levels.reduce((best, l) => (Math.abs(l.centre[2] - z) < Math.abs(best.centre[2] - z) ? l : best));
  return { level: near.id, from, to, source: 'typical' };
}

// Which pieces go where, for a stretch of the spine.
//   pattern: 'screws' (both sides, every level), 'alternate' (every other level),
//            'hooksTop' (hooks on the top two levels, screws below. The highest hooks
//            point down and the ones under them point up, so that the two grip the bone
//            between them like a claw)
// Returns { T4: { right: 'screw', left: 'hook' }, ... } with '' for an empty spot and
// 'hook-up' for a hook that points up.
export function planFor(ids, top, bottom, pattern) {
  const a = ids.indexOf(top), b = ids.indexOf(bottom), plan = {};
  for (let i = Math.min(a, b); i <= Math.max(a, b) && a >= 0 && b >= 0; i++) {
    const n = i - Math.min(a, b), last = i === Math.max(a, b);
    const kind = pattern === 'alternate' ? (n % 2 === 0 || last ? 'screw' : '') : pattern === 'hooksTop' && n < 2 ? (n ? 'hook-up' : 'hook') : 'screw';
    plan[ids[i]] = { right: kind, left: kind };
  }
  return plan;
}

// Fit out the spine from a plan: screws and hooks at the usual spots, a rod down each side
// and a number of cross-links spread evenly. Replaces the hardware that was there.
export function buildHardware(spine, plan, crosslinks = 0) {
  const hw = spine.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const level of sortedLevels(spine)) {
    const want = plan[level.id];
    if (!want) continue;
    for (const side of ['right', 'left']) {
      const spot = slot(level, side);
      if (want[side] === 'screw') hw.screws.push({ level: level.id, side, rod: side, ...spot.screw, source: 'typical' });
      if (want[side] === 'hook' || want[side] === 'hook-up') hw.hooks.push({ level: level.id, side, rod: side, ...(want[side] === 'hook' ? spot : slot(level, side, 'up')).hook, source: 'typical' });
    }
  }
  fitRods(spine, true);
  const right = hw.rods.find((r) => r.side === 'right'), left = hw.rods.find((r) => r.side === 'left');
  if (right && left && crosslinks > 0) {
    const z = (rod) => rod.points.map((p) => p[2]), high = Math.min(Math.max(...z(right)), Math.max(...z(left))) - 12, low = Math.max(Math.min(...z(right)), Math.min(...z(left))) + 12;
    for (let k = 1; k <= crosslinks; k++) { const link = crosslinkAt(spine, high - ((high - low) * k) / (crosslinks + 1)); if (link) hw.crosslinks.push({ ...link, auto: true }); }
  }
}

// ---- the sheet: one row for each vertebra, a few things to switch on and off in each row

// What sits on one side of a vertebra: 'screw', 'hook' or ''.
export function cellOf(spine, id, side) {
  const hw = spine.hardware || {};
  return (hw.screws || []).some((p) => p.level === id && p.side === side) ? 'screw' : (hw.hooks || []).some((p) => p.level === id && p.side === side) ? 'hook' : '';
}

// Which way the hook on one side of a vertebra points: 'down', 'up', or '' if there is none.
export function hookFaces(spine, id, side) {
  const hook = ((spine.hardware || {}).hooks || []).find((p) => p.level === id && p.side === side);
  return hook ? hook.faces || 'down' : '';
}

// Put a screw, a hook or nothing on one side of a vertebra, at the usual spot.
//   faces: for a hook, which way its blade points ('down' or 'up')
export function setCell(spine, id, side, kind, faces = 'down') {
  const hw = spine.hardware = spine.hardware || {}, level = spine.levels.find((l) => l.id === id);
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) hw[key] = hw[key] || [];
  if (!level || (cellOf(spine, id, side) === kind && (kind !== 'hook' || hookFaces(spine, id, side) === faces))) return;
  hw.screws = hw.screws.filter((p) => !(p.level === id && p.side === side));
  hw.hooks = hw.hooks.filter((p) => !(p.level === id && p.side === side));
  const spot = slot(level, side, faces);
  if (kind === 'screw') hw.screws.push({ level: id, side, rod: side, ...spot.screw, source: 'typical' });
  if (kind === 'hook') hw.hooks.push({ level: id, side, rod: side, ...spot.hook, source: 'typical' });
  fitRods(spine);
}

// Put on one side of a vertebra what a plan asks for there ('screw', 'hook', 'hook-up' or '').
export function putPlanned(spine, id, side, what) {
  const [kind, faces] = (what || '').split('-');
  return setCell(spine, id, side, kind, faces || 'down');
}

// Fit out a stretch of the spine in one go, the way the three questions of the easy mode
// ask for it. What is on the stretch already is replaced. Hardware elsewhere stays.
//   kind:  'screws', 'hooksTop', 'alternate' or 'hooks' (see planFor; 'hooks' is hooks all
//          the way, the two highest pointing down and the others up, which is how hooks
//          are set against each other)
//   links: how many cross-links, spread evenly
export function fitOut(spine, top, bottom, kind, links = 0) {
  const ids = sortedLevels(spine).map((l) => l.id), a = ids.indexOf(top), b = ids.indexOf(bottom), lo = Math.min(a, b), hi = Math.max(a, b);
  if (a < 0 || b < 0 || lo === hi) return false;
  const plan = planFor(ids, ids[lo], ids[hi], kind === 'hooks' ? 'screws' : kind);
  for (let i = lo; i <= hi; i++) {
    if (ids[i] === 'C1') continue;
    for (const side of ['right', 'left']) {
      putPlanned(spine, ids[i], side, kind === 'hooks' ? (i - lo >= 2 ? 'hook-up' : 'hook') : plan[ids[i]][side]);
    }
  }
  for (let i = lo; i < hi; i++) { setFusedBelow(spine, ids[i], true); setLinkBelow(spine, ids[i], false); }
  for (let k = 1; k <= links; k++) {
    // the gap nearest to an even share of the way down, moved on if a cross-link cannot sit there
    const want = Math.min(hi - 1, Math.max(lo, Math.round(lo + ((hi - lo) * k) / (links + 1) - 0.5)));
    for (const i of [want, want + 1, want - 1, want + 2, want - 2]) if (i >= lo && i < hi && !linkBelow(spine, ids[i]) && setLinkBelow(spine, ids[i], true)) break;
  }
  return true;
}

// Move a screw or hook to a new place (the fields of "next" are written onto it). With
// "inLine" the move is refused, and the piece left where it was, if its rod could not
// follow there. Returns true if it moved.
export function placePiece(spine, piece, next, inLine = true) {
  const before = strainAt(spine, piece), old = {};
  for (const k of Object.keys(next)) old[k] = piece[k];
  Object.assign(piece, next);
  const now = strainAt(spine, piece);
  if (inLine && now && before && !((now.corner <= ROD_RULES.sharpest || now.corner <= before.corner + 0.01) && (now.gap >= ROD_RULES.closest || now.gap >= before.gap - 0.01))) { Object.assign(piece, old); return false; }
  fitRods(spine);
  return true;
}

// A hook whose head is at a point near a vertebra: the fields that place it.
export function hookAt(level, at, side, faces = 'down') {
  return { level: level.id, side, at: at.map(round1), ...bladeFrom(level, at.map(round1), sign(side), faces), faces };
}

// Is this vertebra fused to the one below it?
export function fusedBelow(spine, id) {
  const levels = sortedLevels(spine), i = levels.findIndex((l) => l.id === id), o = (x) => LEVEL_ORDER.indexOf(x);
  return i >= 0 && i < levels.length - 1 && (spine.fused || []).some(([top, bottom]) => o(top) <= o(id) && o(levels[i + 1].id) <= o(bottom));
}

// Fuse a vertebra to the one below it, or free it. The fused stretches of the spine are
// written again from the joints, so there can be any number of separate ones.
export function setFusedBelow(spine, id, on) {
  const levels = sortedLevels(spine), joints = levels.map((l) => fusedBelow(spine, l.id)), i = levels.findIndex((l) => l.id === id);
  if (i < 0 || i >= levels.length - 1) return;
  joints[i] = on;
  spine.fused = [];
  for (let k = 0; k < levels.length - 1; k++) {
    if (!joints[k]) continue;
    let end = k;
    while (end + 1 < levels.length - 1 && joints[end + 1]) end++;
    spine.fused.push([levels[k].id, levels[end + 1].id]);
    k = end;
  }
}

// The cross-link in the gap below a vertebra, as it would sit on the rods now. Null when the
// rods do not both pass there.
function linkUnder(spine, id) {
  const levels = sortedLevels(spine), i = levels.findIndex((l) => l.id === id);
  if (i < 0 || i >= levels.length - 1) return null;
  const hw = spine.hardware, heads = [...hw.screws, ...hw.hooks].filter((p) => p.level === id || p.level === levels[i + 1].id).map((p) => (p.head || p.at)[2]);
  // halfway between the parts of the two levels if there are any, else between the two bodies
  const z = heads.length > 1 ? (Math.max(...heads) + Math.min(...heads)) / 2 : (levels[i].centre[2] + levels[i + 1].centre[2]) / 2, link = crosslinkAt(spine, z);
  return link && { ...link, level: id, below: id, auto: true };
}
export const linkBelow = (spine, id) => ((spine.hardware || {}).crosslinks || []).some((c) => c.below === id);

// Add or remove the cross-link in the gap below a vertebra. False if it cannot be added.
export function setLinkBelow(spine, id, on) {
  const hw = spine.hardware;
  hw.crosslinks = hw.crosslinks.filter((c) => c.below !== id);
  if (!on) return true;
  const link = linkUnder(spine, id);
  if (link) hw.crosslinks.push(link);
  return !!link;
}

// Do the rods end below this vertebra? Setting it cuts each rod in two there.
export const rodsEndBelow = (spine, id) => ((spine.hardware || {}).splits || []).includes(id);
export function setRodsEndBelow(spine, id, on) {
  const hw = spine.hardware;
  hw.splits = (hw.splits || []).filter((x) => x !== id);
  if (on) hw.splits.push(id);
  if (!hw.splits.length) delete hw.splits;
  fitRods(spine);
}
