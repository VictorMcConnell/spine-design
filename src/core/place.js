// Putting hardware on a spine: the usual spot for a screw or a hook on each side of each
// vertebra, rods that run through whatever is placed, and a quick way to fit out a whole
// stretch in one go. Positions are typical ones worked out from the size of each vertebra.

import { vAdd, vSub, vScale, vUnit, vLen, vDist, vDot, toWorld } from './vec.js';
import { sortedLevels, LEVEL_ORDER } from './spinefile.js';
import { anatomyFor, levelFrame, screwEntryFor, boneSurface } from './bones.js';
import { typicalScrew, screwLean, HARDWARE } from '../parts/sizes.js';
import { PART_TYPES, typeOf } from '../parts/kinds.js';
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
  const head = along(entry, dir, -9), grip = out(laminaSpot(level, head, back, faces) || head);
  return {
    screw: { head: out(head), entry: out(entry), tip: out(along(entry, dir, length)), diameter: size.diameter },
    hook: { at: grip, ...bladeFrom(level, grip, sg, faces), kind: 'lamina', faces },
  };
}

// Where the head of a hook sits, in the axes of the vertebra: over the lamina, the plate of
// bone behind the canal, and no further out than HOOK_OUT from the middle. In the lower back
// the screws go in far out to the side, where there is no lamina for a hook to hold on to.
// The spot is looked for on the real bone near the height of the screw: the nearest height
// where there is bone under the head and under the whole foot. Null when it cannot be found
// (the drawn bones): the hook then sits where a screw head would.
const HOOK_OUT = 13, HOOK_UP = 8.6;
function laminaSpot(level, head, back, faces) {
  const x = Math.sign(head[0]) * Math.min(Math.abs(head[0]), HOOK_OUT), k = faces === 'up' ? 1 : -1;
  // (bone well behind the body: the lamina, not the back of the body seen through the canal)
  const bone = (z) => { const y = boneSurface(level.id, level.size, x, z); return y !== null && y > back + 7 ? y : null; };
  let fair = null;
  for (const step of [0, 2, -2, 4, -4, 6, -6, 8, -8, -10, -12]) {
    const z = head[2] + step, here = bone(z), heel = bone(z + 3.5 * k), toe = bone(z + 11 * k);
    if (here === null) continue;
    if (heel !== null && toe !== null && Math.abs(heel - here) < 4 && Math.abs(toe - here) < 6) return [x, here + HOOK_UP, z];
    if (!fair && heel !== null) fair = [x, here + HOOK_UP, z];
  }
  return fair;
}

// The foot of a hook whose head is at a point. The hook stands straight on the bone: its
// foot comes down from under the head to the bone ("mid", the heel) and reaches along the
// bone, down or up, to its toe ("tip"), which dips into the bone. The foot lies on the bone
// where it can be seen, so the picture shows which way the hook grips.
function bladeFrom(level, at, sg, faces) {
  const frame = levelFrame(level), k = faces === 'up' ? 1 : -1, here = toLocal(at, level.centre, frame);
  // (where the real bone is under the foot, the heel rests on it and the toe dips into it. The foot never reaches further than a foot can.)
  const onBone = (z, usual, into) => { const y = boneSurface(level.id, level.size, here[0], here[2] + z); return y === null ? usual : Math.max(usual - 5, Math.min(usual + 4, y - here[1] - into)); };
  const off = (x, y, z) => vAdd(at, vAdd(vScale(frame.left, x), vAdd(vScale(frame.back, y), vScale(frame.up, z)))).map(round1);
  return { mid: off(0, onBone(3.5 * k, -7, -1.2), 3.5 * k), tip: off(0, onBone(11 * k, -9, 1.5), 11 * k) };
}

// Point the blade of a hook down or up, where the hook is.
export function faceHook(spine, hook, faces) {
  const level = spine.levels.find((l) => l.id === hook.level);
  if (!level) return;
  Object.assign(hook, bladeFrom(level, hook.at, sign(hook.side), faces), { faces });
}

// Give a screw the look of its head. The usual head is not written down.
function lookOf(screw, look) {
  if (look && look !== 'standard') screw.look = look; else delete screw.look;
  return screw;
}

// Change a screw or a hook that is on the spine into another type (an id of PART_TYPES in
// parts/kinds.js): a screw into a hook, a hook into a screw, or a hook pointing the other way.
// It stays on its vertebra, on its side and on its rod, and keeps a colour of its own. A hook
// that only turns round stays where it is. A part that becomes another kind goes to the usual
// spot for that kind, in its usual size. A screw that only gets another head keeps its place,
// its length and its thickness.
// Returns the part as it is now ({ kind, piece }), or null and changes nothing if it is
// frozen, has no vertebra, or the type is not one it can become.
export function retypePiece(spine, kind, piece, to) {
  const hw = spine.hardware || {}, type = PART_TYPES.find((t) => t.id === to), now = typeOf(kind, piece);
  const level = spine.levels.find((l) => l.id === piece.level);
  if (!type || !now || type.group !== now.group || piece.locked || !level || !(hw[kind] || []).includes(piece)) return null;
  if (type === now) return { kind, piece };
  // (a hook turns round where it is, and a screw only gets another head)
  if (type.kind === kind && kind === 'hooks') { faceHook(spine, piece, type.set.faces); fitRods(spine); return { kind, piece }; }
  if (type.kind === kind) { lookOf(piece, type.set.look); return { kind, piece }; }
  const spot = slot(level, piece.side, type.set.faces || 'down');
  const next = { level: piece.level, side: piece.side, rod: piece.rod || piece.side, ...(type.kind === 'screws' ? lookOf(spot.screw, type.set.look) : spot.hook), source: 'typical', ...(piece.color ? { color: piece.color } : {}) };
  // (it takes the place of the old part in the order of things only loosely: each kind has a list of its own)
  hw[kind] = hw[kind].filter((p) => p !== piece);
  (hw[type.kind] = hw[type.kind] || []).push(next);
  fitRods(spine);
  return { kind: type.kind, piece: next };
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
export function pathThrough(points) {
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

// Where the rods of one side are cut, as places in the order of the vertebrae. hardware.splits
// lists them: "T7" cuts the rods of both sides below T7, "T7:left" only the left one.
const cutsFor = (hw, side) => (hw.splits || []).filter((x) => !x.includes(':') || x.endsWith(':' + side)).map((x) => LEVEL_ORDER.indexOf(x.split(':')[0]));

// The screws and hooks of one side in the order a rod runs through them, cut into the runs
// that each get a rod of their own (see hardware.splits).
//   returns [[{ at, level, piece }]]
function runsOf(spine, side) {
  const hw = spine.hardware, levels = sortedLevels(spine), order = (id) => LEVEL_ORDER.indexOf(id), splits = cutsFor(hw, side);
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
  // (a refitted cross-link keeps its own colour and stays frozen if it was)
  const kept = (c) => ({ ...(c.color ? { color: c.color } : {}), ...(c.locked ? { locked: true } : {}) });
  hw.crosslinks = hw.crosslinks.map((c) => { if (!c.below) return c; const link = linkUnder(spine, c.below); return link ? { ...link, ...kept(c) } : null; }).filter(Boolean);
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
  // (a side can have several rods, one for each fusion: the one that passes this height is the one to hold on to)
  const rods = (spine.hardware || {}).rods || [], reach = (side) => { for (const r of rods) { const p = r.side === side ? rodAtHeight(r, z) : null; if (p) return p; } return null; };
  const from = reach('right'), to = reach('left');
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
//   look:  for a screw, the look of its head ('standard', 'tall' or 'low')
// Returns false, and changes nothing, if the part that sits there is frozen ("locked").
export function setCell(spine, id, side, kind, faces = 'down', look = 'standard') {
  const hw = spine.hardware = spine.hardware || {}, level = spine.levels.find((l) => l.id === id);
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) hw[key] = hw[key] || [];
  if (!level || (cellOf(spine, id, side) === kind && (kind !== 'hook' || hookFaces(spine, id, side) === faces))) return true;
  if ([...hw.screws, ...hw.hooks].some((p) => p.level === id && p.side === side && p.locked)) return false;
  const before = hw.screws.length + hw.hooks.length;
  hw.screws = hw.screws.filter((p) => !(p.level === id && p.side === side));
  hw.hooks = hw.hooks.filter((p) => !(p.level === id && p.side === side));
  const spot = slot(level, side, faces), had = cellOf(spine, id, side) !== '' || hw.screws.length + hw.hooks.length < before;
  if (kind === 'screw') hw.screws.push(lookOf({ level: id, side, rod: side, ...spot.screw, source: 'typical' }, look));
  if (kind === 'hook') hw.hooks.push({ level: id, side, rod: side, ...spot.hook, source: 'typical' });
  if (kind && !had) settleCuts(spine, id, side);
  fitRods(spine);
  return true;
}

// A part was put on a spot that had none. Which rod is it on?
//   - where a rod already ran past the spot, it is on that rod
//   - in a break between two rods, or beyond the last part of its side, it joins what is
//     near and stays apart from what is far: "far" is FAR_APART vertebrae or more without a
//     part in between. So a second group of screws further down the spine becomes a fusion
//     of its own, with its own rods, and a screw added next to a rod makes that rod longer.
export const FAR_APART = 3;
function settleCuts(spine, id, side) {
  const gaps = gapsOf(spine, side), above = gaps.find((g) => g.lower === id), below = gaps.find((g) => g.upper === id);
  if (above && below) {
    if (!above.cut && !below.cut) return;
    setRodCut(spine, side, above.upper, id, above.bare >= FAR_APART); setRodCut(spine, side, id, below.lower, below.bare >= FAR_APART);
  } else {
    const g = above || below;
    if (g && !g.cut && g.bare >= FAR_APART) setRodCut(spine, side, g.upper, g.lower, true);
  }
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
  // The stretch is a fusion of its own: where other parts sit further up or down, with a bare
  // vertebra in between, its rods end. Where they sit right next to it, the two are joined.
  for (const side of ['right', 'left']) for (const g of gapsOf(spine, side)) {
    const a = ids.indexOf(g.upper), b = ids.indexOf(g.lower);
    if (((a < lo && b >= lo) || (a <= hi && b > hi)) && g.cut !== g.bare >= 1) setRodCut(spine, side, g.upper, g.lower, g.bare >= 1);
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

// Move a group of screws and hooks up or down the spine together, by whole vertebrae: each
// goes to the usual spot of the vertebra "by" places further down (up, if negative), on its
// own side. Nothing moves unless every one of them has a free place to go to and none is
// frozen. The cross-links that were put into a gap between two of the moved vertebrae go
// along, and every break between two rods stays between the same two parts. True if they moved.
export function shiftParts(spine, parts, by) {
  const levels = sortedLevels(spine), ids = levels.map((l) => l.id), hw = spine.hardware, all = [...hw.screws, ...hw.hooks], moving = new Set(parts);
  if (!by || !parts.length || parts.some((p) => p.locked || !all.includes(p))) return false;
  const goal = (p) => levels[ids.indexOf(p.level) + by];
  for (const p of parts) { const to = goal(p); if (ids.indexOf(p.level) < 0 || !to || to.id === 'C1' || all.some((q) => !moving.has(q) && q.level === to.id && q.side === p.side)) return false; }
  // what to keep: the breaks between rods, as pairs of parts, and the cross-links that go along
  const sides = ['left', 'right'], pieceAt = (id, side) => all.find((q) => q.level === id && q.side === side);
  const breaks = sides.map((side) => gapsOf(spine, side).map((g) => [pieceAt(g.upper, side), pieceAt(g.lower, side), g.cut]));
  const from = new Set(parts.map((p) => p.level)), links = hw.crosslinks.filter((c) => c.below && !c.locked && from.has(c.below) && from.has(ids[ids.indexOf(c.below) + 1]));
  for (const p of parts) {
    const to = goal(p), spot = slot(to, p.side, p.faces || 'down');
    Object.assign(p, hw.screws.includes(p) ? { level: to.id, ...spot.screw, diameter: p.diameter } : { level: to.id, ...spot.hook });
  }
  for (const c of links) c.below = ids[ids.indexOf(c.below) + by];
  // (breaks are written down by vertebra. Where the parts of a side are still in the same order, they are written again for where the parts are now.)
  hw.splits = (hw.splits || []).flatMap((x) => (x.includes(':') ? [x] : [x + ':left', x + ':right']));
  sides.forEach((side, k) => {
    const now = gapsOf(spine, side);
    if (now.length !== breaks[k].length || now.some((g, i) => pieceAt(g.upper, side) !== breaks[k][i][0] || pieceAt(g.lower, side) !== breaks[k][i][1])) return;
    hw.splits = (hw.splits || []).filter((x) => !x.endsWith(':' + side));
    now.forEach((g, i) => { if (breaks[k][i][2]) (hw.splits = hw.splits || []).push(g.upper + ':' + side); });
  });
  if (!hw.splits || !hw.splits.length) delete hw.splits;
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
  const hw = spine.hardware, parts = [...hw.screws, ...hw.hooks], order = (p) => levels.findIndex((l) => l.id === p.level);
  // on each side, the rod that runs across this gap: it holds a part at or above the upper vertebra and one at or below the lower
  const across = (side) => hw.rods.find((r) => r.side === side && parts.some((p) => p.rod === r.id && order(p) >= 0 && order(p) <= i) && parts.some((p) => p.rod === r.id && order(p) > i));
  const right = across('right'), left = across('left');
  if (!right || !left) return null;
  // halfway between the two vertebrae, at the height where their parts sit, or would sit
  const zOf = (level, side) => { const p = parts.find((q) => q.level === level.id && q.side === side); return p ? (p.head || p.at)[2] : slot(level, side).screw.head[2]; };
  const z = (zOf(levels[i], 'left') + zOf(levels[i], 'right') + zOf(levels[i + 1], 'left') + zOf(levels[i + 1], 'right')) / 4;
  const from = rodAtHeight(right, z), to = rodAtHeight(left, z);
  return from && to ? { level: id, from, to, source: 'typical', below: id, auto: true } : null;
}
// The gap a cross-link is in, as the id of the vertebra above that gap: the gap it was put
// into, or, for one that was placed by hand or traced from a scan, the gap it is nearest to.
// (Hardware sits behind the bodies, and where the spine leans that is higher or lower than
// the bodies themselves. So the link is compared with the spots behind each pair of vertebrae.)
export function linkGap(spine, link) {
  if (link.below) return link.below;
  const levels = sortedLevels(spine), mid = [0, 1, 2].map((k) => (link.from[k] + link.to[k]) / 2), behind = levels.map((l) => vAdd(l.centre, vScale(levelFrame(l).back, 38)));
  let best = null, least = Infinity;
  for (let i = 0; i < levels.length - 1; i++) { const d = vDist(mid, vScale(vAdd(behind[i], behind[i + 1]), 0.5)); if (d < least) { least = d; best = levels[i].id; } }
  return best;
}
const linksBelow = (spine, id) => ((spine.hardware || {}).crosslinks || []).filter((c) => linkGap(spine, c) === id);
export const linkBelow = (spine, id) => linksBelow(spine, id).length > 0;

// Add or remove the cross-link in the gap below a vertebra. False if it cannot be added, or
// if the one that is there is frozen and cannot be taken off.
export function setLinkBelow(spine, id, on) {
  const hw = spine.hardware, there = linksBelow(spine, id);
  if (there.some((c) => c.locked)) return !!on;
  hw.crosslinks = hw.crosslinks.filter((c) => !there.includes(c));
  if (!on) return true;
  const link = linkUnder(spine, id);
  if (link) hw.crosslinks.push(link);
  return !!link;
}
// Could a cross-link sit in the gap below a vertebra? It needs a rod on both sides there.
// (linkSpot gives the cross-link that would sit there, or null)
export const linkSpot = (spine, id) => linkUnder(spine, id);
export const linkFits = (spine, id) => !!linkUnder(spine, id);

// Do the rods end below this vertebra? Setting it cuts each rod in two there.
export const rodsEndBelow = (spine, id) => { const cuts = (spine.hardware || {}).splits || []; return cuts.includes(id) || (cuts.includes(id + ':left') && cuts.includes(id + ':right')); };
export function setRodsEndBelow(spine, id, on) {
  const hw = spine.hardware;
  hw.splits = (hw.splits || []).filter((x) => x.split(':')[0] !== id);
  if (on) hw.splits.push(id);
  if (!hw.splits.length) delete hw.splits;
  fitRods(spine);
}

// The gaps of one side: every two parts that follow each other down the spine, and whether
// the rod is cut between them.
//   returns [{ upper, lower, bare, cut }]: the vertebrae of the two parts, how many
//   vertebrae without a part lie between them, and whether the rod ends there
export function gapsOf(spine, side) {
  const hw = spine.hardware || {}, order = (id) => LEVEL_ORDER.indexOf(id), cuts = cutsFor(hw, side);
  const at = [...new Set([...(hw.screws || []), ...(hw.hooks || [])].filter((p) => p.side === side).map((p) => p.level))].sort((p, q) => order(p) - order(q));
  return at.slice(1).map((lower, i) => ({ upper: at[i], lower, bare: order(lower) - order(at[i]) - 1, cut: cuts.some((c) => c >= order(at[i]) && c < order(lower)) }));
}
// Cut the rod of one side between two parts that follow each other, or join it there again.
export function setRodCut(spine, side, upper, lower, on) {
  const hw = spine.hardware, order = (id) => LEVEL_ORDER.indexOf(id), other = side === 'left' ? 'right' : 'left', kept = [];
  // every cut in this gap goes first. One that was for both sides stays for the other side.
  for (const x of hw.splits || []) {
    const [id, only] = x.split(':'), here = order(id) >= order(upper) && order(id) < order(lower);
    if (!here || only === other) kept.push(x); else if (!only) kept.push(id + ':' + other);
  }
  if (on) kept.push(upper + ':' + side);
  if (kept.length) hw.splits = kept; else delete hw.splits;
  fitRods(spine);
}
// One rod from one part to another on the same side: the rod is joined all the way between
// the two and cut just above and just below, so it is a rod of its own.
export function drawRod(spine, side, from, to) {
  const order = (id) => LEVEL_ORDER.indexOf(id), top = Math.min(order(from), order(to)), bottom = Math.max(order(from), order(to));
  if (top === bottom) return false;
  for (const g of gapsOf(spine, side)) {
    const a = order(g.upper), b = order(g.lower), inside = a >= top && b <= bottom, edge = (b === top || a === bottom);
    if (inside && g.cut) setRodCut(spine, side, g.upper, g.lower, false);
    if (edge && !g.cut) setRodCut(spine, side, g.upper, g.lower, true);
  }
  return true;
}
// No rods at all: every part stands alone, until rods are drawn from part to part.
export function cutAll(spine) {
  const hw = spine.hardware;
  delete hw.splits;
  for (const side of ['left', 'right']) for (const g of gapsOf(spine, side)) (hw.splits = hw.splits || []).push(g.upper + ':' + side);
  fitRods(spine);
}
// A rod down each side through all of its parts, the way most fusions are. Groups of parts
// that are far apart get rods of their own (see splitAtGaps). Returns how many cuts that made.
// (Rods that were traced from a scan are drawn again through their parts.)
export function rodsThroughAll(spine) {
  delete spine.hardware.splits; delete spine.hardware.norods;
  fitRods(spine, true);
  return splitAtGaps(spine);
}
// The rod of one side at a height, cut between the two parts around that height.
// Returns the two vertebrae it was cut between, or null if no rod runs there.
export function cutRodAt(spine, side, z) {
  const at = (id) => { const p = [...spine.hardware.screws, ...spine.hardware.hooks].find((q) => q.side === side && q.level === id); return p ? (p.head || p.at)[2] : null; };
  const g = gapsOf(spine, side).find((x) => !x.cut && at(x.upper) >= z && at(x.lower) <= z);
  if (!g) return null;
  setRodCut(spine, side, g.upper, g.lower, true);
  return [g.upper, g.lower];
}

// Cut the rods wherever a side has "least" or more vertebrae in a row without a part: two
// groups of parts that far apart are taken to be two fusions, each with rods of its own.
// A cut is only made where both groups have two parts or more, so a rod held by one hook
// at each end stays in one piece. Returns how many cuts were made.
export function splitAtGaps(spine, least = FAR_APART) {
  let made = 0;
  for (const side of ['left', 'right']) {
    const gaps = gapsOf(spine, side);
    let above = 1;                                    // parts in the group that ends at this gap
    gaps.forEach((g, i) => {
      let below = 1;
      for (let k = i + 1; k < gaps.length && !(gaps[k].cut || gaps[k].bare >= least); k++) below++;
      if (g.cut) { above = 1; return; }
      if (g.bare >= least && above >= 2 && below >= 2) { (spine.hardware.splits = spine.hardware.splits || []).push(g.upper + ':' + side); made++; above = 1; } else above++;
    });
  }
  if (made) fitRods(spine);
  return made;
}
// The sets of rods in words, for a line of text: "T4 to T7 and L1 to L4".
export function rodSets(spine) {
  const hw = spine.hardware || {}, order = (id) => LEVEL_ORDER.indexOf(id), seen = [];
  for (const rod of hw.rods || []) {
    const at = [...(hw.screws || []), ...(hw.hooks || [])].filter((p) => p.rod === rod.id).map((p) => order(p.level)).filter((i) => i >= 0);
    if (at.length < 2) continue;
    const span = [Math.min(...at), Math.max(...at)], same = seen.find((x) => x[0] <= span[1] && span[0] <= x[1]);
    if (same) { same[0] = Math.min(same[0], span[0]); same[1] = Math.max(same[1], span[1]); } else seen.push(span);
  }
  return seen.sort((p, q) => p[0] - q[0]).map(([a, b]) => [LEVEL_ORDER[a], LEVEL_ORDER[b]]);
}
