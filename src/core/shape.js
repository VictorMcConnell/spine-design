// The shape of the spine: its curves seen from the front and from the side, and the ways to
// change them (by numbers, or by pulling a vertebra).
//
// A spine file stores where every vertebra is. To bend the spine without stretching it, the
// app treats it as a chain: every vertebra sits on the one below at a fixed distance, and only
// the angles change. The lowest vertebra stays where it is.
//
// A fused stretch can be made stiff: its vertebrae then keep their places against each other
// and move as one block, and every bend goes into the joints that are still free.

import { frameFromTilt, tiltFromFrame, toWorld, vAdd, vSub, vScale, vDot, vUnit, vDist } from './vec.js';
import { sortedLevels, LEVEL_ORDER } from './spinefile.js';
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
//   stiff: true to make the fused stretches of the spine move as blocks (see stiffen)
export function rigOf(spine, stiff = false) {
  const levels = sortedLevels(spine), joints = [];
  for (let i = levels.length - 2; i >= 0; i--) {
    const lower = levels[i + 1], upper = levels[i], fl = frameOf(lower), fu = frameOf(upper);
    const mid = vUnit(vAdd(fl.up, fu.up)), d = vSub(upper.centre, lower.centre), hl = lower.size[2] / 2, hu = upper.size[2] / 2;
    const gap = (vDot(d, mid) - hl * vDot(fl.up, mid) - hu * vDot(fu.up, mid)) / ((vDot(fl.up, mid) + vDot(fu.up, mid)) / 2);
    const rest = vSub(d, vAdd(vScale(fl.up, hl + gap / 2), vScale(fu.up, gap / 2 + hu)));
    joints[i] = { gap, step: [vDot(rest, fl.left), vDot(rest, fl.back), vDot(rest, fl.up)] };
  }
  return stiffen(spine, { joints, blocks: [] }, stiff);
}

// ---- fused stretches as stiff blocks

// Make the fused stretches of a spine stiff, as they are now, or free them again (on = false).
// The chain remembers how the vertebrae of each stretch face each other. From then on every
// change keeps that: see restack. Call it again when the list of fused stretches changes.
//   rig.blocks = [{ from, to, frames }]: the first and last level of a block, counted from
//   the top of the spine, and the axes of each of its levels at this moment
export function stiffen(spine, rig, on = true) {
  const levels = sortedLevels(spine), o = (id) => LEVEL_ORDER.indexOf(id);
  const fused = (i) => on && i < levels.length - 1 && (spine.fused || []).some(([top, bottom]) => o(top) <= o(levels[i].id) && o(levels[i + 1].id) <= o(bottom));
  rig.blocks = [];
  for (let i = 0; i < levels.length - 1; i++) {
    if (!fused(i)) continue;
    let end = i;
    while (fused(end + 1)) end++;
    rig.blocks.push({ from: i, to: end + 1, frames: levels.slice(i, end + 2).map(frameOf) });
    i = end;
  }
  return rig;
}

// The stiff block a vertebra belongs to, as the names of its top and bottom vertebra, or null.
export function blockOf(spine, rig, id) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id), b = (rig.blocks || []).find((x) => k >= x.from && k <= x.to);
  return b ? { top: levels[b.from].id, bottom: levels[b.to].id, ids: levels.slice(b.from, b.to + 1).map((l) => l.id) } : null;
}

// Which joints cannot bend. Joint i sits between level i and level i + 1, from the top down.
const lockedJoints = (rig, n) => {
  const out = new Array(Math.max(n - 1, 0)).fill(false);
  for (const b of rig.blocks || []) for (let i = b.from; i < b.to; i++) out[i] = true;
  return out;
};
// For every level, how many joints that can bend lie above it. Two levels with the same
// count are fused to each other.
const freeAbove = (rig, n) => {
  const locked = lockedJoints(rig, n), out = [0];
  for (let i = 0; i < n - 1; i++) out.push(out[i] + (locked[i] ? 0 : 1));
  return out;
};

// Turn the vertebrae of every block the way one of them has turned: the one that was changed
// by hand ("lead") if it is in the block, the bottom one otherwise.
function holdBlocks(levels, rig, lead) {
  for (const b of rig.blocks) {
    const k = lead >= b.from && lead <= b.to ? lead : b.to, now = frameOf(levels[k]), was = b.frames[k - b.from];
    const carried = (v) => vAdd(vAdd(vScale(now.left, vDot(was.left, v)), vScale(now.back, vDot(was.back, v))), vScale(now.up, vDot(was.up, v)));
    for (let i = b.from; i <= b.to; i++) {
      if (i === k) continue;
      const old = b.frames[i - b.from], t = tiltFromFrame({ left: carried(old.left), back: carried(old.back), up: carried(old.up) });
      levels[i].tilt = [Math.round(t.tilt[0] * 100) / 100, Math.round(t.tilt[1] * 100) / 100]; levels[i].turn = Math.round(t.turn * 100) / 100;
    }
  }
}

// Put every vertebra back on the one below it, from the bottom up. Stiff blocks are set
// straight first.
//   lead: the name of a vertebra whose angles were just changed by hand. If it is part of a
//         stiff block, the block follows it.
export function restack(spine, rig, lead) {
  const levels = sortedLevels(spine);
  if (rig.blocks && rig.blocks.length) holdBlocks(levels, rig, lead === undefined ? -1 : levels.findIndex((l) => l.id === lead));
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
// it was. A stiff block counts as one vertebra: it goes along whole.
export function pullLevel(spine, rig, id, toLeft, toBack) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id), n = levels.length;
  if (k < 0) return;
  const free = freeAbove(rig, n), bump = levels.map((l, i) => Math.exp(-0.5 * ((free[i] - free[k]) / 2.2) ** 2));
  const add = levels.map((l, i) => {
    const above = Math.max(i - 1, 0), below = Math.min(i + 1, n - 1), run = levels[above].centre[2] - levels[below].centre[2] || 1, slope = (bump[above] - bump[below]) / run;
    return [Math.atan(slope * toLeft) * DEG, Math.atan(slope * toBack) * DEG];
  });
  levels.forEach((l, i) => { l.tilt = [clamp(l.tilt[0] + add[i][0], -80, 80), clamp(l.tilt[1] + add[i][1], -80, 80)]; });
  tidy(levels);
  restack(spine, rig, id);
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
// With stiff blocks the bend goes into the joints that are free: "evenly" then counts those
// joints, and a stretch that is fused from end to end does not bend at all.
export function setBow(spine, rig, top, bottom, plane, degrees) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom), n = levels.length, EASE = 3;
  if (a < 0 || b <= a) return;
  const delta = (degrees - bowOf(spine, top, bottom, plane)) * (plane === 0 ? 1 : -1), free = freeAbove(rig, n), inside = free[b] - free[a];
  if (Math.abs(delta) < 1e-6 || !inside) return;
  // a level fused all the way down to the bottom vertebra cannot be tilted. If the lower end
  // of the stretch is one, the upper end takes the whole change.
  const tied = (i) => free[i] === free[n - 1], upper = tied(b) ? 1 : 0.5, ease = (count) => Math.max(0, 1 - count / (EASE + 1));
  const change = levels.map(() => 0), weight = levels.map(() => 0);
  let keep = 0;
  for (let i = 0; i < n; i++) {
    if (i < a) { weight[i] = ease(free[a] - free[i]); change[i] = delta * upper * weight[i]; if (!weight[i]) keep = i; }
    else if (i <= b) { weight[i] = tied(b) ? 0 : 1; change[i] = delta * (upper - (free[i] - free[a]) / inside); }
    else { weight[i] = tied(i) ? 0 : ease(free[i] - free[b]); change[i] = delta * (upper - 1) * weight[i]; }
  }
  if (tied(b)) for (let i = 0; i < a; i++) weight[i] = 0;
  bendKeeping(spine, rig, levels, plane, change, weight, keep);
}

// How far the top vertebra of a stretch sits to the side of the bottom one, in millimetres.
// Sideways, plus means to the left. Front to back, plus means further back.
export function offsetOf(spine, top, bottom, plane) {
  const a = spine.levels.find((l) => l.id === top), b = spine.levels.find((l) => l.id === bottom);
  return !a || !b ? 0 : a.centre[plane] - b.centre[plane];
}

// Shift the top vertebra of a stretch, and everything above it, sideways against the bottom
// one. The two ends keep their own tilt. The vertebrae between them lean over to make the
// step. Two neighbours with nothing between them simply slide on each other, and so do two
// stiff blocks with one free joint between them.
export function setOffset(spine, rig, top, bottom, plane, mm) {
  const levels = sortedLevels(spine), a = levels.findIndex((l) => l.id === top), b = levels.findIndex((l) => l.id === bottom);
  if (a < 0 || b <= a) return;
  const free = freeAbove(rig, levels.length), inside = free[b] - free[a];
  if (!inside) return;                             // fused from end to end: nothing can give
  if (inside === 1) {
    // one joint can give: the two parts slide on each other there
    let j = a;
    while (free[j + 1] === free[a]) j++;
    for (let step = 0; step < 3; step++) { rig.joints[j].step[plane] += mm - offsetOf(spine, top, bottom, plane); restack(spine, rig); }
    return;
  }
  const base = levels.map((l) => l.tilt[plane]), lean = levels.map((l, i) => (i > a && i < b ? Math.sin((Math.PI * (free[i] - free[a])) / inside) : 0));
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
  const free = freeAbove(rig, levels.length), inside = free[b] - free[a], part = (i) => (inside ? Math.sin((Math.PI * (free[i] - free[a])) / inside) ** 2 : 0);
  const mid = Math.round((a + b) / 2), peak = part(mid);
  if (peak < 0.02) return;                         // the middle is fused to one of the ends: it cannot turn against them
  const delta = (degrees - twistOf(spine, top, bottom)) / peak;
  for (let i = a; i <= b; i++) levels[i].turn = round2(clamp(levels[i].turn + delta * part(i), -90, 90));
  restack(spine, rig);
}

// Slide one vertebra on its own, without bending the spine: it steps sideways (toLeft) or
// backward (toBack) against the one below, and the ones above stay where they are.
export function moveAlone(spine, rig, id, toLeft, toBack) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id), n = levels.length;
  if (k < 0 || k >= n - 1) return;
  // a vertebra in a stiff block takes the block along: it slides at the joints at its two ends
  const locked = lockedJoints(rig, n);
  let low = k, high = k;
  while (low < n - 1 && locked[low]) low++;
  while (high > 0 && locked[high - 1]) high--;
  if (low >= n - 1) return;                        // fused down to the bottom vertebra
  rig.joints[low].step[0] += toLeft; rig.joints[low].step[1] += toBack;
  if (high > 0) { rig.joints[high - 1].step[0] -= toLeft; rig.joints[high - 1].step[1] -= toBack; }
  restack(spine, rig);
}

// Make the space under a vertebra taller or shorter. Everything above moves with it.
export function liftLevel(spine, rig, id, mm) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id);
  if (k < 0 || !rig.joints[k] || lockedJoints(rig, levels.length)[k]) return;      // a fused joint has no space to change
  rig.joints[k].gap = Math.max(0.5, rig.joints[k].gap + mm);
  restack(spine, rig);
}
export const gapUnder = (spine, rig, id) => { const j = rig.joints[sortedLevels(spine).findIndex((l) => l.id === id)]; return j ? j.gap : 0; };

// Take out everything sideways: no tilt to the side, no turn, no step to the side. A stiff
// block keeps the shape it has and is set upright as a whole.
export function straighten(spine, rig) {
  const locked = lockedJoints(rig, spine.levels.length);
  for (const l of spine.levels) { l.tilt = [0, l.tilt[1]]; l.turn = 0; }
  rig.joints.forEach((j, i) => { if (j && !locked[i]) j.step[0] = 0; });
  restack(spine, rig);
}
