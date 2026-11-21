// Broken vertebrae: the body of a vertebra squashed in one of a few general ways. These are
// pictures of their kind for a sketch, not a reading of anyone's scan.
//   wedge  the front of the body has lost height and the back has not, so the spine above tips forward
//   crush  the whole body has lost height
//   burst  the body has lost height and spread outward
//   wedge-left, wedge-right  one side of the body has lost height, so the spine above tips to that side
//   hairline  a fine crack part of the way round, nothing has moved
//   split  a break straight across the body and the back of the bone, nothing squashed
//   chip  a corner broken off the front of the body
// A broken vertebra carries "fracture": { kind, amount, was, lean }. "was" is the height its
// body had, and "size" holds the height it has now (for a wedge, at the middle of the body),
// so everything that stacks the spine keeps working. "lean" is by how many degrees the
// vertebra and the spine above it were tipped for a wedge: forward, or for a wedge to one side
// to that side. bones.js draws the shape and the renderer the dark line.

import { sortedLevels, FRACTURES, ARCHES, BONE_LOOKS } from './spinefile.js';
import { pivotAt, restack, blockOf, frameOf } from './shape.js';
import { tiltFromFrame, vAdd, vScale } from './vec.js';

// The top two bones of the neck and the sacrum have no body that breaks this way.
export const canBreak = (id) => !['C1', 'C2', 'S1'].includes(id);
// How much of its height a body loses at the most: a wedge at its front, the others all over.
// The last three squash nothing: they are a line on the bone.
const MOST = { wedge: 0.6, crush: 0.5, burst: 0.4, 'wedge-left': 0.5, 'wedge-right': 0.5, hairline: 0, split: 0, chip: 0 };
const SIDEWAYS = { 'wedge-left': 1, 'wedge-right': -1 };
const round2 = (v) => Math.round(v * 100) / 100;

// What a body of a size becomes when it breaks: { size, lean }, lean in degrees.
export function brokenSize(size, kind, amount) {
  const [w, d, h] = size, lost = h * MOST[kind] * amount;
  if (SIDEWAYS[kind]) return { size: [w, d, round2(h - lost / 2)], lean: round2((Math.atan2(lost / 2, w) * 180) / Math.PI) };
  if (kind !== 'wedge') return { size: [w, d, round2(h - lost)], lean: 0 };
  // a wedge is squashed evenly about its middle: each end plate tips by half the angle of the wedge
  return { size: [w, d, round2(h - lost / 2)], lean: round2((Math.atan2(lost / 2, d) * 180) / Math.PI) };
}

// Tip a vertebra forward about its own side-to-side axis, with everything above it. Or
// (sideways: 1 or -1) to its left or its right, about its own front-to-back axis.
function tip(spine, rig, id, degrees, sideways) {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  pivotAt(spine, rig, id, (l) => {
    const f = frameOf(l), q = s * (sideways || 0);
    const t = tiltFromFrame(sideways ? { left: vAdd(vScale(f.left, c), vScale(f.up, -q)), back: f.back, up: vAdd(vScale(f.up, c), vScale(f.left, q)) } : { left: f.left, back: vAdd(vScale(f.back, c), vScale(f.up, s)), up: vAdd(vScale(f.up, c), vScale(f.back, -s)) });
    l.tilt = [round2(Math.max(-80, Math.min(80, t.tilt[0]))), round2(Math.max(-80, Math.min(80, t.tilt[1])))]; l.turn = round2(t.turn);
  });
}

// Break a vertebra, change how it is broken, or make it whole again.
//   change: { kind, amount }, either of them. kind 'healthy' makes it whole.
// The spine above comes down with the lost height. For a wedge the vertebra tips forward by
// half the angle of the wedge and the one above it by the other half, so the discs on both
// sides keep even (a wedge to one side tips them to that side the same way). A vertebra in a fused stretch that is held stiff is not tipped.
// Run this inside carry (shape.js) so the hardware and the marks come along.
// Returns the fracture as it is now, { kind: 'healthy' }, or null if the vertebra cannot break.
export function setFracture(spine, rig, id, change) {
  const levels = sortedLevels(spine), k = levels.findIndex((l) => l.id === id), l = levels[k], above = k > 0 ? levels[k - 1] : null;
  const was = l && l.fracture, next = { ...(was || {}), ...change };
  if (!l || !canBreak(id) || (next.kind !== 'healthy' && !FRACTURES.includes(next.kind))) return null;
  // first whole again, the way it was
  if (was) {
    if (was.lean) { if (above) tip(spine, rig, above.id, -was.lean, SIDEWAYS[was.kind]); tip(spine, rig, id, -was.lean, SIDEWAYS[was.kind]); }
    l.size = [l.size[0], l.size[1], was.was]; delete l.fracture;
  }
  if (next.kind === 'healthy') { restack(spine, rig); return { kind: 'healthy' }; }
  const amount = Math.max(0.1, Math.min(1, typeof next.amount === 'number' ? next.amount : 0.5)), b = brokenSize(l.size, next.kind, amount);
  const lean = b.lean && !blockOf(spine, rig, id) ? b.lean : 0;
  l.fracture = { kind: next.kind, amount, was: l.size[2], ...(lean ? { lean } : {}) };
  l.size = b.size;
  if (lean) { tip(spine, rig, id, lean, SIDEWAYS[next.kind]); if (above) tip(spine, rig, above.id, lean, SIDEWAYS[next.kind]); } else restack(spine, rig);
  return l.fracture;
}

const WORDS = { wedge: 'wedge fracture', crush: 'crush fracture', burst: 'burst fracture', 'wedge-left': 'squashed on the left', 'wedge-right': 'squashed on the right', hairline: 'hairline crack', split: 'split across', chip: 'chipped corner' };
// Whether a kind of break changes the shape of the body (the others are a line on it).
export const squashes = (kind) => MOST[kind] > 0;
// What the renderer needs to draw the dark line of a break: the kind (its place in FRACTURES, from 1) with how
// much it is broken behind the point (kind + 0.4 * amount), then half the depth, half the width and half the
// height of the body as it is now.
export const crackMarks = (fracture, size) => [FRACTURES.indexOf(fracture.kind) + 1 + 0.4 * Math.max(0, Math.min(1, fracture.amount || 0.5)), size[1] / 2, size[0] / 2, size[2] / 2];
export const fractureWords = (f) => (f && WORDS[f.kind]) || 'healthy';

// How worn the bone of a vertebra looks: 0 clean (nothing is written down), up to 1 aged and
// porous. It changes the look only, not the shape. Any vertebra can be worn.
export function setWear(spine, id, wear) {
  const l = spine.levels.find((x) => x.id === id);
  if (!l) return null;
  const w = Math.round(Math.max(0, Math.min(1, wear)) * 100) / 100;
  if (w > 0) l.wear = w; else delete l.wear;
  return w;
}
// What else the bone shows: 'spurs' (bony lips at the rims of the body, drawn in the shape), 'dense' (hardened,
// chalky bone) or 'sore' (the bone next to the discs is inflamed). Nothing moves. '' takes it away.
export function setBoneLook(spine, id, look) {
  const l = spine.levels.find((x) => x.id === id);
  if (!l || (look && !BONE_LOOKS.includes(look))) return null;
  if (look) l.bone = look; else delete l.bone;
  return look || 'plain';
}
const LOOK_WORDS = { spurs: 'bone spurs', dense: 'hardened bone', sore: 'sore end plates' };
export const boneLookWords = (look) => LOOK_WORDS[look] || '';
// What the renderer needs for the two that are painted on: the kind (1 dense, 2 sore), then half the depth,
// half the width and half the height of the body.
export const boneMarks = (level) => (level.bone === 'dense' || level.bone === 'sore' ? [level.bone === 'dense' ? 1 : 2, level.size[1] / 2, level.size[0] / 2, level.size[2] / 2] : null);
export const wearWords = (w) => (!w ? 'clean bone' : w < 0.4 ? 'slightly aged bone' : w < 0.75 ? 'aged bone' : 'aged and porous bone');

// The back of a vertebra: whole (nothing is written down), opened ('laminectomy': the bone over
// the canal and the process at the back are taken away), or with a broken process ('spinous',
// 'tp-left', 'tp-right'). It changes what is drawn, not where anything is. The atlas and the
// sacrum are left out. bones.js works out where on each bone the cut or the line goes.
export const canArch = (id) => id !== 'C1' && id !== 'S1';
export function setArch(spine, id, arch) {
  const l = spine.levels.find((x) => x.id === id);
  if (!l || !canArch(id) || (arch && !ARCHES.includes(arch))) return null;
  if (arch) l.arch = arch; else delete l.arch;
  return arch || 'whole';
}
const ARCH_WORDS = { laminectomy: 'back opened', spinous: 'back process broken', 'tp-left': 'left side process broken', 'tp-right': 'right side process broken' };
export const archWords = (arch) => ARCH_WORDS[arch] || 'back whole';
