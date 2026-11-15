// Putting hardware on a spine: the usual spot for a screw or a hook on each side of each
// vertebra, rods that run through whatever is placed, and a quick way to fit out a whole
// stretch in one go. Positions are typical ones worked out from the size of each vertebra.

import { vAdd, vSub, vScale, vUnit, vLen, vDist, toWorld } from './vec.js';
import { sortedLevels, LEVEL_ORDER } from './spinefile.js';
import { anatomyFor, levelFrame, screwEntryFor } from './bones.js';
import { typicalScrew, screwLean, HARDWARE } from './hardware.js';
import { toLocal } from './shape.js';

const RAD = Math.PI / 180;
const round1 = (v) => Math.round(v * 10) / 10;
const sign = (side) => (side === 'left' ? 1 : -1);

// The usual spot on one side of a vertebra, in the world.
//   screw: { head, entry, tip, diameter }   hook: { at, mid, tip, kind }
export function slot(level, side) {
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
    hook: { at: out(head), mid: out([head[0] - sg * 4, head[1] - 8, head[2] - 4]), tip: out([head[0] - sg * 6, head[1] - 9, head[2] - 12]), kind: 'lamina' },
  };
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

// A smooth path through a list of points, with a point about every 8 mm, running a little
// past both ends.
function pathThrough(points) {
  const first = vAdd(points[0], vScale(vUnit(vSub(points[0], points[1])), 9)), last = vAdd(points[points.length - 1], vScale(vUnit(vSub(points[points.length - 1], points[points.length - 2])), 9));
  const p = [first, ...points, last], out = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)], steps = Math.max(1, Math.ceil(vDist(p1, p2) / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((j) => round1(0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3))));
    }
  }
  out.push(last.map(round1));
  return out;
}

// Draw the rods again so that they run through every screw and hook. Each side gets one rod,
// or several where the person has said the rods end (hardware.splits: the levels below which
// the rods stop and start again). A rod that came with the file (traced from a scan) is left
// alone unless "all" is true. Cross-links made by the sheet are put back on the new rods.
export function fitRods(spine, all = false) {
  const hw = spine.hardware = spine.hardware || {};
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) hw[key] = hw[key] || [];
  const order = (id) => LEVEL_ORDER.indexOf(id), splits = (hw.splits || []).map(order);
  for (const side of ['right', 'left']) {
    const old = hw.rods.filter((r) => r.side === side);
    if (old.some((r) => !r.auto) && !all) continue;
    const grips = [...hw.screws.filter((s) => s.side === side).map((s) => ({ at: s.head, level: s.level, piece: s })), ...hw.hooks.filter((h) => h.side === side).map((h) => ({ at: h.at, level: h.level, piece: h }))];
    grips.sort((p, q) => order(p.level) - order(q.level) || q.at[2] - p.at[2]);
    hw.rods = hw.rods.filter((r) => r.side !== side);
    // cut the list of grips wherever the rods are said to end between two of them
    const runs = [[]];
    for (const g of grips) {
      const run = runs[runs.length - 1], last = run[run.length - 1];
      if (last && splits.some((sp) => sp >= order(last.level) && sp < order(g.level))) runs.push([g]); else run.push(g);
    }
    runs.forEach((run, k) => {
      const id = side + (k ? '-' + (k + 1) : '');
      for (const g of run) g.piece.rod = id;
      if (run.length < 2) return;
      hw.rods.push({ id, side, diameter: (old[0] && old[0].diameter) || HARDWARE.rodDiameter, points: pathThrough(run.map((g) => g.at)), auto: true, source: 'typical', ...(old[0] && old[0].color ? { color: old[0].color } : {}) });
    });
  }
  hw.rods.sort((p, q) => (p.side === 'right' ? 0 : 1) - (q.side === 'right' ? 0 : 1));
  // cross-links that belong to a gap between two levels follow the rods, or go if a rod is gone
  hw.crosslinks = hw.crosslinks.map((c) => (c.below ? linkUnder(spine, c.below) || null : c)).filter(Boolean);
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
//            'hooksTop' (hooks on the top two levels, screws below)
// Returns { T4: { right: 'screw', left: 'hook' }, ... } with '' for an empty spot.
export function planFor(ids, top, bottom, pattern) {
  const a = ids.indexOf(top), b = ids.indexOf(bottom), plan = {};
  for (let i = Math.min(a, b); i <= Math.max(a, b) && a >= 0 && b >= 0; i++) {
    const n = i - Math.min(a, b), last = i === Math.max(a, b);
    const kind = pattern === 'alternate' ? (n % 2 === 0 || last ? 'screw' : '') : pattern === 'hooksTop' && n < 2 ? 'hook' : 'screw';
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
      if (want[side] === 'hook') hw.hooks.push({ level: level.id, side, rod: side, ...spot.hook, source: 'typical' });
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

// Put a screw, a hook or nothing on one side of a vertebra, at the usual spot.
export function setCell(spine, id, side, kind) {
  const hw = spine.hardware = spine.hardware || {}, level = spine.levels.find((l) => l.id === id);
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) hw[key] = hw[key] || [];
  if (!level || cellOf(spine, id, side) === kind) return;
  hw.screws = hw.screws.filter((p) => !(p.level === id && p.side === side));
  hw.hooks = hw.hooks.filter((p) => !(p.level === id && p.side === side));
  const spot = slot(level, side);
  if (kind === 'screw') hw.screws.push({ level: id, side, rod: side, ...spot.screw, source: 'typical' });
  if (kind === 'hook') hw.hooks.push({ level: id, side, rod: side, ...spot.hook, source: 'typical' });
  fitRods(spine);
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
