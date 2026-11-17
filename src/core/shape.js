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
  for (const r of hw.rods || []) { r.points.forEach((p, i) => add(r.points, i, null)); (r.via || []).forEach((p, i) => add(r.via, i, null)); }
  for (const c of hw.crosslinks || []) for (const k of ['from', 'to']) add(c, k, null);
  for (const m of spine.marks || []) {
    for (const k of ['at', 'from', 'to']) add(m, k, null);
    // a label that was moved off its mark rides with the vertebra the mark is on
    const spot = m.at || (m.from && m.to ? [0, 1, 2].map((j) => (m.from[j] + m.to[j]) / 2) : null);
    if (spot) add(m, 'label', nearest(spot));
  }
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

// Turn one vertebra and take everything above it along, as if the spine were bent in that
// one place and stiff above it. "change" is given the vertebra and sets its tilt or turn.
export function pivotAt(spine, rig, id, change) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id);
  if (k < 0) return;
  const before = levels.slice(0, k + 1).map(frameOf), was = before[k];
  change(levels[k]);
  const now = frameOf(levels[k]);
  const carried = (v) => vAdd(vAdd(vScale(now.left, vDot(was.left, v)), vScale(now.back, vDot(was.back, v))), vScale(now.up, vDot(was.up, v)));
  for (let i = 0; i < k; i++) {
    const t = tiltFromFrame({ left: carried(before[i].left), back: carried(before[i].back), up: carried(before[i].up) });
    levels[i].tilt = [round2(clamp(t.tilt[0], -80, 80)), round2(clamp(t.tilt[1], -80, 80))]; levels[i].turn = round2(t.turn);
  }
  restack(spine, rig, id);
}

// Give the spine the shape of a line drawn over it. The line is a list of points [across, up]
// in millimetres, in the plane the spine is looked at: plane 0 from the back (across = to
// the left), plane 1 from the side (across = to the back). Only the shape of the line counts,
// not where it was drawn: it is slid sideways until it starts on the spine. From its lowest
// point upward, each vertebra leans so that it lies along the line. Vertebrae below the
// line keep the lean they had, and above its end the spine eases back to the lean it had.
// A stiff block keeps its shape: it is turned as a
// whole so that it starts and ends on the line, like a ruler laid along a curve. No joint
// is bent further than JOINT_MOST, so a wild line still gives a spine. Returns false if the
// line is too short to mean anything.
//   JOINT_MOST: the most one vertebra may lean against the one below it, in degrees,
//   sideways and front to back. Rules of thumb that only stop the absurd: the lowest joints
//   of a normal lower back already bend about 17 degrees front to back.
export const JOINT_MOST = [18, 26];
//   opts.held:   names of vertebrae that are locked. They stay where they are, and each free
//                stretch between two of them takes the shape of the line between its ends.
//   opts.smooth: how many times the line is smoothed first (8 for a line drawn by hand)
export function followLine(spine, rig, plane, line, opts = {}) {
  const levels = sortedLevels(spine), n = levels.length, locked = new Set(opts.held || []);
  // from the bottom up, evenly spaced and smoothed, so a shaky hand does not make a shaky spine
  const pts = line.slice().sort((p, q) => p[1] - q[1]).filter((p, i, all) => i === 0 || p[1] - all[i - 1][1] > 0.5);
  if (pts.length < 2 || pts[pts.length - 1][1] - pts[0][1] < 30) return false;
  const start = pts[0][1], reach = pts[pts.length - 1][1], STEP = 4;
  let across = [];
  for (let z = start, i = 1; z <= reach; z += STEP) {
    while (i < pts.length - 1 && pts[i][1] < z) i++;
    across.push(pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * (z - pts[i - 1][1])) / Math.max(1e-6, pts[i][1] - pts[i - 1][1]));
  }
  for (let pass = 0; pass < (opts.smooth === undefined ? 8 : opts.smooth); pass++) across = across.map((v, i) => (i === 0 || i === across.length - 1 ? v : (across[i - 1] + 2 * v + across[i + 1]) / 4));
  const lineAt = (z) => { const k = Math.max(0, Math.min(across.length - 1.001, (z - start) / STEP)), i = Math.floor(k); return across[i] + (across[i + 1] - across[i]) * (k - i); };
  // the first vertebra the line reaches: the lowest one whose middle is above the start of the line
  let first = n - 2;                                   // the bottom vertebra never leans to follow
  while (first > 0 && levels[first].centre[2] < start) first--;
  if (levels[first].centre[2] < start || levels[first].centre[2] > reach) return false;
  const base = levels.map((l) => l.tilt[plane]), kept = levels.map((l) => [l.tilt[0], l.tilt[1], l.turn]), axis = plane === 0 ? 0 : 1, DEG = 180 / Math.PI;
  const gapOver = (i) => (i > 0 ? (rig.joints[i - 1] || { gap: 4 }).gap : 0);
  const blockAt = (i) => (rig.blocks || []).find((x) => i >= x.from && i <= x.to);
  // a vertebra that must stay as it is: a locked one, or one in a stiff block with a locked one
  const fixed = (i) => { const b = blockAt(i); return b ? levels.slice(b.from, b.to + 1).some((l) => locked.has(l.id)) : locked.has(levels[i].id); };
  // where vertebra i stands: the middle of the gap under it
  const footOf = (i) => { const lower = levels[i + 1], j = rig.joints[i] || { gap: 4 }; return vAdd(lower.centre, vScale(frameOf(lower).up, lower.size[2] / 2 + j.gap / 2)); };
  // The line as one free stretch sees it: slid sideways until it starts where the stretch
  // starts, and leant about that point by "shear" when the stretch has to end at a fixed place.
  let shift = 0, shear = 0, pivot = 0;
  const lineHere = (z) => lineAt(z) + shift + shear * (z - pivot);
  // the lean that puts a point "arm" away from "foot" onto the line, found in a few rounds
  const reachLine = (foot, arm) => {
    let z = foot[2] + arm, side = 0;
    for (let round = 0; round < 5; round++) { side = clamp(lineHere(z) - foot[axis], -0.9 * arm, 0.9 * arm); z = foot[2] + Math.sqrt(arm * arm - side * side); }
    return { z, lean: Math.atan2(side, z - foot[2]) * DEG };
  };
  // Lay the vertebrae from "lo" up to "hi" along the line (they are counted from the top, so
  // lo is the larger number). "open" says the stretch has a free upper end: it then stops
  // where the line stops. Returns the first vertebra that was not laid.
  const lay = (lo, hi, open) => {
    let i = lo;
    for (; i >= hi; i--) {
      const block = blockAt(i);
      if (block && i !== block.to) continue;             // held by its block, which was laid along the line from its lowest vertebra
      // the vertebra swings about the middle of the gap under it and reaches to the middle of
      // the gap above it. Putting that upper end on the line, one vertebra after the other,
      // lays the whole chain along the line without the vertebrae leaning to and fro.
      const lower = levels[i + 1], j = rig.joints[i] || { gap: 4 }, foot = footOf(i);
      let lean;
      if (block) {
        // a stiff block: the straight line from its foot to its upper end is what is laid on the line
        const top = levels[block.from], end = vAdd(top.centre, vScale(frameOf(top).up, top.size[2] / 2 + gapOver(block.from) / 2));
        const over = end[axis] - foot[axis], up = end[2] - foot[2], arm = Math.hypot(over, up), now = Math.atan2(over, up) * DEG;
        if (open && foot[2] + 20 > reach) break;
        // (a block that sticks out past the end of the line is pointed at that end)
        const want = open && foot[2] + up > reach + 12 ? Math.atan2(lineHere(reach) - foot[axis], reach - foot[2]) * DEG : reachLine(foot, arm).lean;
        lean = levels[i].tilt[plane] + want - now;
      } else {
        const arm = j.gap / 2 + levels[i].size[2] + gapOver(i) / 2, on = reachLine(foot, arm);
        if (open && on.z > reach + arm / 2) break;
        // a vertebra that starts beside the line (above a block, or after a joint that was held back) closes
        // half of the distance and leaves the rest to the next one, so the spine eases back onto the line
        const miss = lineHere(foot[2]) - foot[axis];
        lean = Math.abs(miss) > 0.5 ? reachLine([foot[0] + (axis === 0 ? miss / 2 : 0), foot[1] + (axis === 1 ? miss / 2 : 0), foot[2]], arm).lean : on.lean;
      }
      const under = lower.tilt[plane];
      levels[i].tilt[plane] = round2(clamp(clamp(lean, under - JOINT_MOST[plane], under + JOINT_MOST[plane]), -80, 80));
      restack(spine, rig);
    }
    return i;
  };
  let i = first;
  while (i >= 0) {
    if (fixed(i)) { i--; continue; }
    let hi = i;
    while (hi > 0 && !fixed(hi - 1)) hi--;
    const foot = footOf(i);
    shift = foot[axis] - lineAt(foot[2]); shear = 0; pivot = foot[2];
    if (hi === 0) {
      // the top of the spine is free. Above the end of the line it eases back to the lean it
      // had: each vertebra keeps half of the change of the one below it, so there is no sharp
      // corner where the line stops.
      for (let k = lay(i, 0, true); k >= 0; k--) {
        const block = blockAt(k);
        if (block && k !== block.to) continue;
        const under = levels[k + 1].tilt[plane], more = (under - base[k + 1]) / 2;
        if (Math.abs(more) < 0.2) break;
        levels[k].tilt[plane] = round2(clamp(clamp(base[k] + more, under - JOINT_MOST[plane], under + JOINT_MOST[plane]), -80, 80));
        restack(spine, rig);
      }
      break;
    }
    // A locked vertebra stands on this stretch. The line is leant, a little more or less,
    // until the stretch ends where that vertebra stood, so nothing above it is pushed aside.
    const want = footOf(hi - 1)[axis], tall = Math.max(20, footOf(hi - 1)[2] - foot[2]), lo = i;
    const miss = (c) => {
      for (let k = lo; k >= hi; k--) { levels[k].tilt = [kept[k][0], kept[k][1]]; levels[k].turn = kept[k][2]; }
      restack(spine, rig);
      shear = c;
      lay(lo, hi, false);
      return footOf(hi - 1)[axis] - want;
    };
    let c0 = 0, e0 = miss(0);
    if (Math.abs(e0) > 0.25) {
      let c1 = -e0 / tall, e1 = miss(c1);
      for (let round = 0; round < 7 && Math.abs(e1) > 0.25 && Math.abs(e1 - e0) > 1e-6; round++) { const c2 = c1 - (e1 * (c1 - c0)) / (e1 - e0); c0 = c1; e0 = e1; c1 = c2; e1 = miss(c1); }
    }
    i = hi - 1;
  }
  tidy(levels);
  restack(spine, rig);
  return levels.some((l, k) => Math.abs(l.tilt[plane] - base[k]) > 0.2);
}

// The line a spine runs along now, as followLine reads one: [across, up] from the middle of
// the bottom vertebra, through the middle of every gap, to the top of the top vertebra, with
// points every few millimetres.
export function lineOf(spine, rig, plane) {
  const levels = sortedLevels(spine), n = levels.length, axis = plane === 0 ? 0 : 1, knots = [[levels[n - 1].centre[axis], levels[n - 1].centre[2]]];
  for (let i = n - 2; i >= 0; i--) { const lower = levels[i + 1], j = rig.joints[i] || { gap: 4 }, p = vAdd(lower.centre, vScale(frameOf(lower).up, lower.size[2] / 2 + j.gap / 2)); knots.push([p[axis], p[2]]); }
  const top = vAdd(levels[0].centre, vScale(frameOf(levels[0]).up, levels[0].size[2] / 2));
  knots.push([top[axis], top[2]]);
  const out = [];
  for (let k = 0; k < knots.length - 1; k++) for (let t = 0; t < 5; t++) out.push([knots[k][0] + ((knots[k + 1][0] - knots[k][0]) * t) / 5, knots[k][1] + ((knots[k + 1][1] - knots[k][1]) * t) / 5]);
  out.push(knots[knots.length - 1]);
  return out;
}

// Slide one vertebra across (to the left in plane 0, to the back in plane 1) by so many
// millimetres. The vertebrae near it follow in a smooth bulge, "reach" of them on each
// side, and everything further away stays where it is. Locked vertebrae ("held") do not
// move either. Returns false if that vertebra cannot be slid.
export function slideLevel(spine, rig, plane, id, by, held = [], reach = 4) {
  const levels = sortedLevels(spine), n = levels.length, m = levels.findIndex((l) => l.id === id);
  if (m < 0 || m === n - 1 || held.includes(id)) return false;
  // the stretch that follows: "reach" vertebrae each way, but never past a locked one
  let lo = m, hi = m;
  while (lo < n - 2 && lo < m + reach && !held.includes(levels[lo + 1].id)) lo++;
  while (hi > 0 && hi > m - reach && !held.includes(levels[hi - 1].id)) hi--;
  const line = lineOf(spine, rig, plane);
  // the bulge: nothing at the two ends of the stretch that follows, all of "by" at the vertebra itself
  const low = levels[lo + 1].centre[2] + levels[lo + 1].size[2] / 2, high = levels[hi].centre[2] + levels[hi].size[2] / 2, peak = levels[m].centre[2];
  const bulge = (z) => (z <= low || z >= high ? 0 : z < peak ? 0.5 - 0.5 * Math.cos((Math.PI * (z - low)) / (peak - low)) : 0.5 + 0.5 * Math.cos((Math.PI * (z - peak)) / (high - peak)));
  const fixed = held.concat(levels.filter((l, i) => i < hi || i > lo).map((l) => l.id));
  return followLine(spine, rig, plane, line.map(([x, z]) => [x + by * bulge(z), z]), { held: fixed, smooth: 0 });
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
