// A stand for a printed spine. Two kinds:
//   'post':   a round base with a post. The spine gets a peg under the sacrum that plugs
//             into the top of the post.
//   'hanger': a round base with a tall post behind the spine and an arm over its top. The
//             spine gets a ring on its top vertebra and hangs from the arm.
// The stand is a part of its own, printed apart from the spine, so nothing has to be cut
// out of the bone shapes: the spine only has a peg or a ring added to it.
//
// Sizes that decide whether a print holds (how thick the post is, how loose the fit is) are
// set in millimetres of the print, so they come out the same at every print size. They are
// rules of thumb and have not been tried on a printer.

import { vertebraShape, levelFrame } from './bones.js';
import { sortedLevels } from './spinefile.js';
import { rayMesh } from './pick.js';
import { loft, tube, appendMesh } from './mesh.js';

export const STAND_NAMES = { post: 'round base with a post', hanger: 'tall hanger' };

// A shape turned on a lathe about an upright axis. The outline is a list of [radius, height]
// that runs from the outer edge of the underside, up the outside, to the middle of the top
// (or down into a hole, for a cup). Both ends are closed.
function lathe(outline, x, y, sides = 48) {
  return loft(outline.map(([r, z]) => Array.from({ length: sides }, (_, k) => [x + r * Math.cos((k / sides) * 2 * Math.PI), y + r * Math.sin((k / sides) * 2 * Math.PI), z])), true);
}
// A closed ring (a torus) standing upright, with its hole facing front to back.
function ring(centre, radius, thick, around = 36, sides = 14) {
  const rings = [];
  for (let i = 0; i <= around; i++) {
    const a = ((i % around) / around) * 2 * Math.PI, out = [Math.cos(a), 0, Math.sin(a)], row = [];
    for (let k = 0; k < sides; k++) { const b = (k / sides) * 2 * Math.PI, r = radius + thick * Math.cos(b); row.push([centre[0] + out[0] * r, centre[1] + thick * Math.sin(b), centre[2] + out[2] * r]); }
    rings.push(row);
  }
  return loft(rings, false);
}
// Where a line straight up (dir 1) or straight down (dir -1) from a point first meets a vertebra: the height, or null.
function meet(level, detail, x, y, z, dir) {
  const f = levelFrame(level), d = [x - level.centre[0], y - level.centre[1], z - level.centre[2]];
  const local = [d[0] * f.left[0] + d[1] * f.left[1] + d[2] * f.left[2], d[0] * f.back[0] + d[1] * f.back[1] + d[2] * f.back[2], d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2]];
  const t = rayMesh(local, [f.left[2] * dir, f.back[2] * dir, f.up[2] * dir], vertebraShape(level.id, level.size, detail));
  return t === null ? null : z + dir * t;
}
// The lowest, highest, backmost point of the bones, from the corners of every vertebra shape.
function reach(levels, detail) {
  const out = { low: Infinity, high: -Infinity, back: -Infinity };
  for (const l of levels) {
    const f = levelFrame(l), p = vertebraShape(l.id, l.size, detail).positions;
    for (let i = 0; i < p.length; i += 3) {
      const z = l.centre[2] + f.left[2] * p[i] + f.back[2] * p[i + 1] + f.up[2] * p[i + 2], y = l.centre[1] + f.left[1] * p[i] + f.back[1] * p[i + 1] + f.up[1] * p[i + 2];
      if (z < out.low) out.low = z; if (z > out.high) out.high = z; if (y > out.back) out.back = y;
    }
  }
  return out;
}
const disc = (x, y, top, radius, thick, edge) => lathe([[radius - edge, top - thick], [radius, top - thick + edge], [radius, top - edge], [radius - edge, top]], x, y, 64);

// The stand for a spine.
//   scale: the print size (1 for full size). detail: the grid the bone shapes are drawn on.
// Returns null if there is nothing to stand, or
//   { onSpine: [mesh], stand: [mesh], says } with the shapes in the axes of the spine, in
//   millimetres at full size: what is added to the spine, the stand itself, and a line
//   that says how the two go together.
export function standFor(kind, spine, scale = 1, detail = 1.4) {
  const levels = sortedLevels(spine);
  if (!STAND_NAMES[kind] || levels.length < 2) return null;
  const k = 1 / scale, box = reach(levels, detail), tall = (box.high - box.low) * scale, bottom = levels[levels.length - 1], top = levels[0];
  const middle = [0, 1].map((j) => levels.reduce((sum, l) => sum + l.centre[j], 0) / levels.length);
  const thick = Math.max(4, 0.02 * tall) * k, edge = Math.min(1.2 * k, thick / 4);
  if (kind === 'post') {
    // the post comes up under the body of the lowest vertebra, a little further forward if the bone is thin or missing there
    let spot = null;
    for (const forward of [0, 6, 12, -6, 18]) {
      const x = bottom.centre[0], y = bottom.centre[1] - forward, z = meet(bottom, detail, x, y, box.low - 10, 1);
      if (z !== null && (!spot || z > spot.z)) spot = { x, y, z };
      if (z !== null && z > bottom.centre[2] - bottom.size[2]) break;
    }
    if (!spot) spot = { x: bottom.centre[0], y: bottom.centre[1], z: bottom.centre[2] - bottom.size[2] / 2 };
    const peg = Math.max(3, 0.009 * tall) * k, cup = peg + 2.5 * k, deep = Math.max(12, 0.05 * tall) * k, baseTop = box.low - 6 * k - 4;
    const away = Math.hypot(spot.x - middle[0], spot.y - middle[1]), radius = Math.max(0.19 * (box.high - box.low), 40 * k), pull = away > radius * 0.5 ? 1 - (radius * 0.5) / away : 0;
    const cx = middle[0] + (spot.x - middle[0]) * pull, cy = middle[1] + (spot.y - middle[1]) * pull;
    return {
      onSpine: [lathe([[peg, spot.z - deep], [peg, spot.z + 10]], spot.x, spot.y, 32)],
      // the post is a cup at its top: the hole is a little wider and a little deeper than the peg
      stand: [disc(cx, cy, baseTop, radius, thick, edge), lathe([[cup, baseTop - thick / 2], [cup, spot.z - 0.6 * k], [peg + 0.3 * k, spot.z - 0.6 * k], [peg + 0.3 * k, spot.z - deep - 1 * k]], spot.x, spot.y, 40)],
      says: 'The spine gets a peg under the sacrum. It plugs into the top of the post.',
    };
  }
  // the hanger: a ring on the top vertebra, an arm through it, a post behind the spine
  const x = top.centre[0], y = top.centre[1], crown = meet(top, detail, x, y, box.high + 10, -1), over = crown === null ? top.centre[2] + top.size[2] / 2 : crown;
  const loop = Math.max(6, 0.02 * tall) * k, wire = Math.max(1.8, 0.006 * tall) * k, pin = loop - wire - 1.2 * k, at = [x, y, over + loop + wire - Math.min(4, wire * 1.5)];
  const post = Math.max(5, 0.016 * tall) * k, behind = box.back + 10 * k + post, baseTop = box.low - 12 * k;
  const cy = (y + behind) / 2, radius = Math.max(0.2 * (box.high - box.low), (behind - cy) + post + 6 * k);
  // the arm leaves the post, runs forward through the ring and turns up at its end so the ring cannot slide off
  const path = [];
  for (let i = 0; i <= 10; i++) path.push([x, behind + (y - 7 * k - behind) * (i / 10), at[2]]);
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); path.push([x, y - 7 * k - 5 * k * Math.sin(a), at[2] + 5 * k * (1 - Math.cos(a))]); }
  const arm = tube(path, (t) => { const r = t < 0.35 ? post + (pin - post) * (t / 0.35) : pin; return [r, r]; }, [0, 0, 1], 20);
  return {
    onSpine: [ring(at, loop, wire)],
    stand: [disc(x, cy, baseTop, radius, thick, edge), appendMesh(lathe([[post, baseTop - thick / 2], [post, at[2] + post * 0.6], [post * 0.5, at[2] + post]], x, behind, 40), arm)],
    says: 'The spine gets a ring on its top vertebra. It hangs from the arm of the stand.',
  };
}
