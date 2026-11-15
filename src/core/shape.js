// The shape of the spine: its curves seen from the front and from the side, and the ways to
// change them (by numbers, or by pulling a vertebra).
//
// A spine file stores where every vertebra is. To bend the spine without stretching it, the
// app treats it as a chain: every vertebra sits on the one below at a fixed distance, and only
// the angles change. The lowest vertebra stays where it is.

import { frameFromTilt, toWorld, vAdd, vSub, vScale, vDot, vUnit, vDist } from './vec.js';
import { sortedLevels } from './spinefile.js';
import { measureSpine } from './measures.js';
import { ALIGNMENT, ANATOMY } from './anatomy.js';

const DEG = 180 / Math.PI;
const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const frameOf = (level) => frameFromTilt(level.tilt, level.turn);

// A point in the world, written in a vertebra's own axes (left, back, up).
export function toLocal(point, centre, frame) {
  const d = vSub(point, centre);
  return [vDot(d, frame.left), vDot(d, frame.back), vDot(d, frame.up)];
}

// ---- the chain

// How each vertebra sits on the one below: the gap between the two bodies, and any sideways
// step between them. Worked out once from a spine, then kept while the angles change.
export function rigOf(spine) {
  const levels = sortedLevels(spine), joints = [];
  for (let i = levels.length - 2; i >= 0; i--) {
    const lower = levels[i + 1], upper = levels[i], fl = frameOf(lower), fu = frameOf(upper);
    const mid = vUnit(vAdd(fl.up, fu.up)), d = vSub(upper.centre, lower.centre), hl = lower.size[2] / 2, hu = upper.size[2] / 2;
    const gap = (vDot(d, mid) - hl * vDot(fl.up, mid) - hu * vDot(fu.up, mid)) / ((vDot(fl.up, mid) + vDot(fu.up, mid)) / 2);
    const rest = vSub(d, vAdd(vScale(fl.up, hl + gap / 2), vScale(fu.up, gap / 2 + hu)));
    joints[i] = { gap, step: [vDot(rest, fl.left), vDot(rest, fl.back), vDot(rest, fl.up)] };
  }
  return { joints };
}

// Put every vertebra back on the one below it, from the bottom up.
export function restack(spine, rig) {
  const levels = sortedLevels(spine);
  for (let i = levels.length - 2; i >= 0; i--) {
    const lower = levels[i + 1], upper = levels[i], fl = frameOf(lower), fu = frameOf(upper), j = rig.joints[i] || { gap: 4, step: [0, 0, 0] };
    const along = vAdd(vScale(fl.up, lower.size[2] / 2 + j.gap / 2), vScale(fu.up, j.gap / 2 + upper.size[2] / 2));
    upper.centre = toWorld(j.step, vAdd(lower.centre, along), fl).map(round1);
  }
}

// Every point of the hardware and the marks, with the vertebra it rides on.
function riders(spine) {
  const levels = sortedLevels(spine), hw = spine.hardware || {}, out = [];
  const byId = (id) => levels.find((l) => l.id === id);
  const nearest = (p) => levels.reduce((best, l) => (vDist(p, l.centre) < vDist(p, best.centre) ? l : best));
  const add = (holder, key, level) => { if (Array.isArray(holder[key])) out.push({ holder, key, level: level || nearest(holder[key]) }); };
  for (const s of hw.screws || []) for (const k of ['head', 'entry', 'tip']) add(s, k, byId(s.level));
  for (const h of hw.hooks || []) for (const k of ['at', 'mid', 'tip']) add(h, k, byId(h.level));
  for (const r of hw.rods || []) r.points.forEach((p, i) => add(r.points, i, null));
  for (const c of hw.crosslinks || []) for (const k of ['from', 'to']) add(c, k, null);
  for (const m of spine.marks || []) for (const k of ['at', 'from', 'to']) add(m, k, null);
  return out;
}

// Run a change to the vertebrae and take the hardware and the marks along with them.
export function carry(spine, change) {
  const held = riders(spine).map((r) => ({ ...r, local: toLocal(r.holder[r.key], r.level.centre, frameOf(r.level)) }));
  change();
  for (const h of held) h.holder[h.key] = toWorld(h.local, h.level.centre, frameOf(h.level)).map(round1);
}

// ---- the usual side profile

// How far the top of each vertebra leans back (plus) or forward (minus) in a typical spine.
// The lower back takes its hollow mostly in its last three levels, the chest rounds evenly
// and the neck hollows evenly again.
export function typicalLean(A = ALIGNMENT) {
  const lean = { S1: -A.sacralSlope }, lowerBack = { L5: 0.34, L4: 0.68, L3: 0.86, L2: 0.95, L1: 1 };
  for (const id in lowerBack) lean[id] = -A.sacralSlope + A.lowerBackLordosis * lowerBack[id];
  for (let i = 12; i >= 1; i--) lean['T' + i] = lean.L1 + 2 - (A.chestKyphosis * (12 - i)) / 11;
  for (let i = 7; i >= 2; i--) lean['C' + i] = lean.T1 + 4 + (A.neckLordosis * (7 - i)) / 5;
  lean.C1 = lean.C2;
  return lean;
}

// ---- from numbers to angles

// Tilt seen from the front for every level, from a list of curves. A curve is
// { top, bottom, degrees, bowsTo: 'left' | 'right', turn }. Inside a curve the tilt changes
// evenly from one end to the other. Above the first curve and below the last one the spine
// eases back to upright, the way a real spine makes up for a curve.
function frontFromCurves(ids, curves) {
  const out = ids.map(() => 0), list = orderly(ids, curves);
  if (!list.length) return out;
  const nodes = [{ at: list[0].a, tilt: 0 }];
  for (const c of list) {
    let last = nodes[nodes.length - 1];
    if (c.a > last.at) { nodes.push({ at: c.a, tilt: last.tilt }); last = nodes[nodes.length - 1]; }
    nodes.push({ at: c.b, tilt: last.tilt - (c.bowsTo === 'left' ? -1 : 1) * c.degrees });
  }
  // Slide the whole set of tilts up or down until the top of the spine ends up over the
  // bottom again, the way a person keeps their head over their pelvis.
  const span = ids.map((id) => (ANATOMY[id] ? (ANATOMY[id].hf + ANATOMY[id].hb) / 2 : 12) + 5);
  const fill = (shift) => {
    const first = nodes[0], last = nodes[nodes.length - 1];
    const all = [{ at: 0, tilt: first.at === 0 ? first.tilt + shift : 0 }, ...nodes.map((n) => ({ at: n.at, tilt: n.tilt + shift })), { at: ids.length - 1, tilt: last.at === ids.length - 1 ? last.tilt + shift : 0 }];
    for (let k = 0; k < all.length - 1; k++) {
      const a = all[k], b = all[k + 1];
      for (let i = a.at; i <= b.at; i++) out[i] = b.at === a.at ? b.tilt : a.tilt + ((b.tilt - a.tilt) * (i - a.at)) / (b.at - a.at);
    }
    return out.reduce((sum, tilt, i) => sum + span[i] * Math.sin(tilt / DEG), 0);
  };
  let low = -90, high = 90;
  for (let step = 0; step < 30; step++) { const mid = (low + high) / 2; if (fill(mid) > 0) high = mid; else low = mid; }
  fill((low + high) / 2);
  return out;
}

// The turn of every level about its own axis, from the same list. Bodies turn toward the side
// a curve bows to, most in the middle of the curve.
function turnFromCurves(ids, curves) {
  const out = ids.map(() => 0);
  for (const c of orderly(ids, curves)) {
    for (let i = c.a; i <= c.b; i++) out[i] += (c.bowsTo === 'left' ? 1 : -1) * (c.turn || 0) * Math.sin((Math.PI * (i - c.a)) / (c.b - c.a)) ** 2;
  }
  return out;
}

// Curves with both ends in this spine, top end above bottom end, sorted from the top down and
// kept from overlapping.
function orderly(ids, curves) {
  const list = [];
  for (const c of curves || []) {
    const a = ids.indexOf(c.top), b = ids.indexOf(c.bottom);
    if (a >= 0 && b > a && c.degrees > 0) list.push({ ...c, a, b });
  }
  list.sort((p, q) => p.a - q.a);
  for (let k = 1; k < list.length; k++) list[k].a = Math.max(list[k].a, list[k - 1].b);
  return list.filter((c) => c.b > c.a);
}

// Lean seen from the side for every level: the typical profile, with the neck, the chest and
// the lower back each made deeper or flatter to reach the wanted angles.
//   side = { neck, chest, lowerBack } in degrees, measured C2 to C7, T5 to T12 and L1 to L5
function sideFromAngles(ids, side) {
  const typ = typicalLean(), scale = {
    C: side.neck == null ? 1 : side.neck / (typ.C2 - typ.C7),
    T: side.chest == null ? 1 : side.chest / (typ.T12 - typ.T5),
    L: side.lowerBack == null ? 1 : side.lowerBack / (typ.L1 - typ.L5),
  };
  const out = ids.map(() => 0);
  out[ids.length - 1] = typ[ids[ids.length - 1]];
  for (let i = ids.length - 2; i >= 0; i--) out[i] = out[i + 1] + (typ[ids[i]] - typ[ids[i + 1]]) * (scale[ids[i][0]] || 1);
  return out;
}

// ---- reading and writing the shape of a spine

// The shape of a spine as the builder shows it: its curves and side angles as numbers, plus
// "rest": whatever the spine has on top of those numbers (so a real, uneven spine keeps its
// detail when one number is changed).
export function readShape(spine) {
  const levels = sortedLevels(spine), ids = levels.map((l) => l.id), m = measureSpine(spine);
  const sideAt = (id) => { const l = levels.find((x) => x.id === id); return l ? l.tilt[1] : null; };
  const curves = m.curves.map((c) => {
    const a = ids.indexOf(c.top), b = ids.indexOf(c.bottom), want = c.bowsTo === 'left' ? 1 : -1;
    let turn = 0;
    for (let i = a; i <= b; i++) if (levels[i].turn * want > turn) turn = levels[i].turn * want;
    return { top: c.top, bottom: c.bottom, degrees: c.degrees, bowsTo: c.bowsTo, turn: Math.round(turn) };
  });
  const side = { neck: sideAt('C2') === null || sideAt('C7') === null ? null : Math.round(sideAt('C2') - sideAt('C7')), chest: m.kyphosis, lowerBack: m.lordosis };
  const shape = { curves, side }, made = anglesOf(ids, shape);
  shape.rest = { front: levels.map((l, i) => l.tilt[0] - made.front[i]), side: levels.map((l, i) => l.tilt[1] - made.side[i]), turn: levels.map((l, i) => l.turn - made.turn[i]) };
  return shape;
}

function anglesOf(ids, shape) {
  return { front: frontFromCurves(ids, shape.curves), side: sideFromAngles(ids, shape.side), turn: turnFromCurves(ids, shape.curves) };
}

// Write a shape into the spine: set every angle, then put the chain back together.
export function applyShape(spine, shape, rig) {
  const levels = sortedLevels(spine), made = anglesOf(levels.map((l) => l.id), shape), rest = shape.rest;
  levels.forEach((l, i) => {
    l.tilt = [round1(clamp(made.front[i] + (rest ? rest.front[i] : 0), -80, 80)), round1(clamp(made.side[i] + (rest ? rest.side[i] : 0), -80, 80))];
    l.turn = round1(clamp(made.turn[i] + (rest ? rest.turn[i] : 0), -90, 90));
  });
  restack(spine, rig);
}

// ---- changing the shape directly (what the builder's handles and sliders do)
//
// These work on the spine as it is. Each one changes some angles and puts the chain back
// together. "plane" is 0 for sideways (seen from the front) and 1 for front to back (seen
// from the side).

const round2 = (v) => Math.round(v * 100) / 100;
const tidy = (levels) => { for (const l of levels) { l.tilt = [round2(l.tilt[0]), round2(l.tilt[1])]; l.turn = round2(l.turn); } };

// Pull one vertebra sideways (toLeft) and backward (toBack), in millimetres. Its neighbours
// follow less and less the further away they are, and the spine above settles back to where
// it was.
export function pullLevel(spine, rig, id, toLeft, toBack) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id), n = levels.length;
  if (k < 0) return;
  const bump = levels.map((l, i) => Math.exp(-0.5 * ((i - k) / 2.2) ** 2));
  const add = levels.map((l, i) => {
    const above = Math.max(i - 1, 0), below = Math.min(i + 1, n - 1), run = levels[above].centre[2] - levels[below].centre[2] || 1, slope = (bump[above] - bump[below]) / run;
    return [Math.atan(slope * toLeft) * DEG, Math.atan(slope * toBack) * DEG];
  });
  levels.forEach((l, i) => { l.tilt = [clamp(l.tilt[0] + add[i][0], -80, 80), clamp(l.tilt[1] + add[i][1], -80, 80)]; });
  tidy(levels);
  restack(spine, rig);
}

// Add "change" to the tilt of every level in one plane, plus as much of "weight" as it takes
// for the level "keep" to end up where it was. That is what keeps the rest of the spine still
// while one stretch is bent.
function bendKeeping(spine, rig, levels, plane, change, weight, keep) {
  const base = levels.map((l) => l.tilt[plane]), was = levels[keep].centre[plane];
  const run = (c) => { levels.forEach((l, i) => { l.tilt[plane] = clamp(base[i] + change[i] + c * weight[i], -80, 80); }); restack(spine, rig); return levels[keep].centre[plane] - was; };
  let c0 = 0, e0 = run(0), c1 = 1, e1 = run(1);
  for (let step = 0; step < 8 && Math.abs(e1) > 0.05 && e1 !== e0; step++) { const c2 = c1 - (e1 * (c1 - c0)) / (e1 - e0); c0 = c1; e0 = e1; c1 = c2; e1 = run(c1); }
  tidy(levels);
  restack(spine, rig);
}

// How strongly the stretch between two vertebrae bows, in degrees: the angle between the two
// end vertebrae. Sideways, plus means it bows to the right. Front to back, plus means it bows
// backward (a rounded back) and minus forward (a hollow back).
export function bowOf(spine, top, bottom, plane) {
  const a = spine.levels.find((l) => l.id === top), b = spine.levels.find((l) => l.id === bottom);
  return !a || !b ? 0 : plane === 0 ? a.tilt[0] - b.tilt[0] : b.tilt[1] - a.tilt[1];
}

// Bow the stretch between two vertebrae to a given angle. The tilt changes evenly from one end
// to the other, a few vertebrae beyond each end ease the change out, and everything further
// away stays where it is. The bottom vertebra of the spine is never tilted to make up.
export function setBow(spine, rig, top, bottom, plane, degrees) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom), n = levels.length, EASE = 3;
  if (a < 0 || b <= a) return;
  const delta = (degrees - bowOf(spine, top, bottom, plane)) * (plane === 0 ? 1 : -1), change = levels.map(() => 0), weight = levels.map(() => 0);
  if (Math.abs(delta) < 1e-6) return;
  for (let i = a; i <= b; i++) { change[i] = delta / 2 - (delta * (i - a)) / (b - a); weight[i] = 1; }
  for (let k = 1; k <= EASE; k++) {
    const f = 1 - k / (EASE + 1);
    if (a - k >= 0) { change[a - k] = (delta / 2) * f; weight[a - k] = f; }
    if (b + k < n - 1) { change[b + k] = (-delta / 2) * f; weight[b + k] = f; }
  }
  bendKeeping(spine, rig, levels, plane, change, weight, Math.max(a - EASE - 1, 0));
}

// How far the top vertebra of a stretch sits to the side of the bottom one, in millimetres.
// Sideways, plus means to the left. Front to back, plus means further back.
export function offsetOf(spine, top, bottom, plane) {
  const a = spine.levels.find((l) => l.id === top), b = spine.levels.find((l) => l.id === bottom);
  return !a || !b ? 0 : a.centre[plane] - b.centre[plane];
}

// Shift the top vertebra of a stretch, and everything above it, sideways against the bottom
// one. The two ends keep their own tilt. The vertebrae between them lean over to make the
// step. Two neighbours with nothing between them simply slide on each other.
export function setOffset(spine, rig, top, bottom, plane, mm) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom);
  if (a < 0 || b <= a) return;
  if (b === a + 1) {
    for (let step = 0; step < 3; step++) { rig.joints[a].step[plane] += mm - offsetOf(spine, top, bottom, plane); restack(spine, rig); }
    return;
  }
  const base = levels.map((l) => l.tilt[plane]), lean = levels.map((l, i) => (i > a && i < b ? Math.sin((Math.PI * (i - a)) / (b - a)) : 0));
  const run = (k) => { levels.forEach((l, i) => { l.tilt[plane] = clamp(base[i] + k * lean[i], -80, 80); }); restack(spine, rig); return offsetOf(spine, top, bottom, plane) - mm; };
  let k0 = 0, e0 = run(0), k1 = e0 > 0 ? -3 : 3, e1 = run(k1);
  for (let step = 0; step < 8 && Math.abs(e1) > 0.05 && e1 !== e0; step++) { const k2 = k1 - (e1 * (k1 - k0)) / (e1 - e0); k0 = k1; e0 = e1; k1 = k2; e1 = run(k1); }
  tidy(levels);
  restack(spine, rig);
}

// How far the bodies in the middle of a stretch are turned against its two ends, in degrees.
// Plus means their fronts face left.
export function twistOf(spine, top, bottom) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom);
  return a < 0 || b <= a ? 0 : levels[Math.round((a + b) / 2)].turn - (levels[a].turn + levels[b].turn) / 2;
}

// Turn the bodies of a stretch, most in the middle and not at all at the two ends.
export function setTwist(spine, rig, top, bottom, degrees) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom);
  if (a < 0 || b <= a) return;
  const mid = Math.round((a + b) / 2), peak = Math.sin((Math.PI * (mid - a)) / (b - a)) ** 2 || 1, delta = (degrees - twistOf(spine, top, bottom)) / peak;
  for (let i = a; i <= b; i++) levels[i].turn = round2(clamp(levels[i].turn + delta * Math.sin((Math.PI * (i - a)) / (b - a)) ** 2, -90, 90));
  restack(spine, rig);
}

// Slide one vertebra on its own, without bending the spine: it steps sideways (toLeft) or
// backward (toBack) against the one below, and the ones above stay where they are.
export function moveAlone(spine, rig, id, toLeft, toBack) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id);
  if (k < 0 || k >= levels.length - 1) return;
  rig.joints[k].step[0] += toLeft; rig.joints[k].step[1] += toBack;
  if (k > 0) { rig.joints[k - 1].step[0] -= toLeft; rig.joints[k - 1].step[1] -= toBack; }
  restack(spine, rig);
}

// Make the space under a vertebra taller or shorter. Everything above moves with it.
export function liftLevel(spine, rig, id, mm) {
  const k = sortedLevels(spine).findIndex((l) => l.id === id);
  if (k < 0 || !rig.joints[k]) return;
  rig.joints[k].gap = Math.max(0.5, rig.joints[k].gap + mm);
  restack(spine, rig);
}
export const gapUnder = (spine, rig, id) => { const j = rig.joints[sortedLevels(spine).findIndex((l) => l.id === id)]; return j ? j.gap : 0; };

// Take out everything sideways: no tilt to the side, no turn, no step to the side.
export function straighten(spine, rig) {
  for (const l of spine.levels) { l.tilt = [0, l.tilt[1]]; l.turn = 0; }
  for (const j of rig.joints) if (j) j.step[0] = 0;
  restack(spine, rig);
}
