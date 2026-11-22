// Turns a spine file into the list of things the renderer draws.

import { FRACTURES, sortedLevels, isFused } from '../core/spinefile.js';
import { vertebraShape, levelFrame, discMesh, discParts, archMarks } from '../core/bones.js';
import { colorOf, DISC, discTint } from '../core/finish.js';
import { USUAL_FINISH } from '../parts/kinds.js';
import { PARTS } from '../parts/catalogue.js';
import { HARDWARE } from '../parts/sizes.js';
import { crosslinkMesh } from '../parts/crosslink.js';
import { rodDirectionNear } from '../parts/rod.js';
import { tube, ball } from '../core/mesh.js';

const COLORS = { bone: [0.78, 0.68, 0.52], disc: DISC, fusedDisc: [0.6, 0.56, 0.48], picked: [1, 0.78, 0.3], between: [0.93, 0.8, 0.55], spot: [0.45, 0.75, 1], note: [0.55, 0.8, 1] };
// a colour for the hardware of each level, from violet at the top to red at the bottom
const BY_LEVEL = [[0.52, 0.34, 0.86], [0.39, 0.41, 0.9], [0.27, 0.51, 0.92], [0.18, 0.62, 0.87], [0.15, 0.71, 0.76], [0.17, 0.75, 0.61], [0.31, 0.77, 0.42], [0.53, 0.78, 0.26], [0.74, 0.76, 0.19], [0.89, 0.69, 0.18], [0.94, 0.57, 0.18], [0.93, 0.42, 0.21], [0.89, 0.28, 0.25]];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The colour of a pain point: from yellow for mild to red for the worst.
export function painColor(strength) {
  return mix([1, 0.82, 0.25], [0.95, 0.16, 0.14], (Math.max(1, Math.min(10, strength || 5)) - 1) / 9);
}

// Vertebrae the person placed by guessing are drawn paler than ones taken from a scan or an X-ray.
// Hardware is always drawn solid: a part put on by hand must look like any other part.
const sourceOpacity = (source) => (source === 'guessed' ? 0.5 : 1);

// The matrix that places a shape drawn in a vertebra's own axes where that vertebra is.
export function levelMatrix(level) {
  const f = levelFrame(level), c = level.centre;
  return new Float32Array([f.left[0], f.left[1], f.left[2], 0, f.back[0], f.back[1], f.back[2], 0, f.up[0], f.up[1], f.up[2], 0, c[0], c[1], c[2], 1]);
}

const SPOT = ball([0, 0, 0], 3.2);
// What the renderer needs to draw the dark line of a break: the kind (1 wedge, 2 crush, 3 burst), then half the
// depth, half the width and half the height of the body.
const crackOf = (level) => [FRACTURES.indexOf(level.fracture.kind) + 1, level.size[1] / 2, level.size[0] / 2, level.size[2] / 2];

//   detail: size of the grid the bones are sampled on, in millimetres (smaller = smoother, slower)
//   extras: for the builder and the look of things
//     picked: { kind: 'level', id, mates } | { kind: 'stretch', top, bottom } | { kind: 'screws' ..., index } | { kind: 'discs', id: 'L4/L5' }
//             (mates: the vertebrae that move with the picked one, drawn paler)
//     also:   more parts that are selected along with the picked one: [{ kind, index }]
//     locked: ids of the vertebrae that are locked in place while the curve is shaped, drawn darker
//     stiff:  ids of the vertebrae that are held stiff in a fused block, drawn in a cooler colour
//             the selected piece is drawn in a warm colour (a stretch: its two ends, and paler between)
//     spots:  [points] the usual spots for a new part, drawn as small dots
//     look:   { bone, disc, hardware: [r, g, b] or null, byLevel: true to colour hardware by level }
export function buildScene(spine, detail, extras = {}) {
  const items = [], levels = sortedLevels(spine), hw = spine.hardware || {}, picked = extras.picked || {}, look = extras.look || {};
  const add = (group, mesh, color, opacity = 1, more = {}) => items.push({ group, mesh, color, opacity, baseOpacity: opacity, visible: true, ...more });
  const order = levels.map((l) => l.id), used = order.filter((id) => [...(hw.screws || []), ...(hw.hooks || [])].some((p) => p.level === id));
  const also = extras.also || [];
  const finish = (group, piece, index) => {
    // the piece's own colour, then the viewer's choices, then the colour the spine file gives this kind of part
    const own = (piece.color && colorOf(piece.color)) || (look.byLevel && piece.level && used.includes(piece.level) ? BY_LEVEL[Math.round((used.indexOf(piece.level) * (BY_LEVEL.length - 1)) / Math.max(1, used.length - 1))] : null) || look.hardware || colorOf((hw.colors || {})[group]) || colorOf(USUAL_FINISH[group]);
    // a selected part glows toward the pick colour but keeps enough of its own for a new colour to show at once
    const chosen = (picked.kind === group && picked.index === index) || also.some((p) => p.kind === group && p.index === index);
    return chosen ? own.map((v, k) => v * 0.4 + COLORS.picked[k] * 0.6) : own;
  };
  const a = order.indexOf(picked.top), b = order.indexOf(picked.bottom);
  // (stiff vertebrae: the bone colour pulled toward a cool steel blue, so a fused block reads as one piece)
  const locked = extras.locked || [], dim = (c) => c.map((v) => v * 0.55 + 0.06);
  const stiff = extras.stiff || [], cool = (c) => c.map((v, k) => v * 0.5 + [0.5, 0.66, 0.86][k] * 0.5);
  // (the vertebra whose block is under the pointer, or was just tapped, lights up part of the way to the pick colour)
  // (the one under the pointer more softly, so that a locked or a stiff vertebra still shows as what it is)
  const lit = (id, c) => (extras.lit === id ? mix(c, COLORS.picked, 0.55) : extras.pointed === id ? mix(c, COLORS.picked, 0.3) : c);
  // (a vertebra can carry a colour of its own, the way a piece of hardware can)
  const ownBone = (id) => { const l = levels.find((x) => x.id === id); return (l && l.color && colorOf(l.color)) || look.bone || COLORS.bone; };
  const boneColor = (id, i) => lit(id, (picked.kind === 'level' && picked.id === id) || (picked.kind === 'stretch' && (i === a || i === b)) ? COLORS.picked : picked.kind === 'stretch' && a >= 0 && b >= 0 && i > Math.min(a, b) && i < Math.max(a, b) ? COLORS.between : picked.kind === 'level' && picked.mates && picked.mates.includes(id) ? COLORS.between : locked.includes(id) ? dim(ownBone(id)) : stiff.includes(id) ? cool(ownBone(id)) : ownBone(id));
  // a vertebra is drawn once in its own axes and then placed, so bending the spine only moves it
  levels.forEach((level, i) => add('vertebrae', vertebraShape(level.id, level.size, detail, level.fracture), boneColor(level.id, i), sourceOpacity(level.source), { matrix: levelMatrix(level), name: level.id, ...(level.wear ? { wear: level.wear } : {}), ...(level.fracture ? { crack: crackOf(level) } : {}), ...(level.arch ? archMarks(level) || {} : {}) }));
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i].id === 'C1') continue;          // the atlas sits on the axis without a disc
    const fused = isFused(spine, levels[i].id) && isFused(spine, levels[i + 1].id);
    // a disc is drawn as the file describes it (standard when it says nothing). The selected one glows,
    // and one that is gone shows as a ghost while it is selected, so there is something to see.
    const key = levels[i].id + '/' + levels[i + 1].id, base = fused ? COLORS.fusedDisc : look.disc || COLORS.disc, chosen = picked.kind === 'discs' && picked.id === key, name = 'disc_' + levels[i].id + '_' + levels[i + 1].id;
    const parts = discParts(levels[i], levels[i + 1], (spine.discs || {})[key]);
    for (const part of parts) add('discs', part.mesh, chosen ? mix(discTint(base, part.tint), COLORS.picked, 0.6) : discTint(base, part.tint), 1, { name });
    if (chosen && !parts.length) add('discs', discMesh(levels[i], levels[i + 1]), COLORS.picked, 0.3, { name });
  }
  const rodSize = (id) => ((hw.rods || []).find((r) => r.id === id) || {}).diameter || HARDWARE.rodDiameter;
  // a cross-link arches away from the spine: backward as the vertebra next to it sees it
  const backAt = (p) => levelFrame(levels.reduce((best, l) => (Math.hypot(p[0] - l.centre[0], p[1] - l.centre[1], p[2] - l.centre[2]) < Math.hypot(p[0] - best.centre[0], p[1] - best.centre[1], p[2] - best.centre[2]) ? l : best))).back;
  // Every kind of part, in the order of the catalogue. Each kind says what to draw for one of
  // its pieces (src/parts): one shape, or more when a part of it is drawn once and placed, the
  // way the head of a screw or a hook is.
  const around = { rods: hw.rods, rodSize, backAt };
  for (const part of PARTS) {
    // (rods that have not been put on yet, at the Easy level, are in the file but are not drawn)
    const pieces = part.kind === 'rods' && hw.norods ? [] : hw[part.kind] || [];
    pieces.forEach((piece, i) => { const color = finish(part.kind, piece, i); for (const { mesh, ...more } of part.items(piece, i, around)) add(part.kind, mesh, color, 1, more); });
  }
  // the bends put into a rod by hand show as small knobs while that rod is picked
  if (picked.kind === 'rods' && (hw.rods || [])[picked.index]) for (const p of hw.rods[picked.index].via || []) add('spots', SPOT, COLORS.picked, 1, { matrix: new Float32Array([1.15, 0, 0, 0, 0, 1.15, 0, 0, 0, 0, 1.15, 0, p[0], p[1], p[2], 1]) });
  // pain points glow stronger the worse they are; notes are small pins
  (spine.marks || []).forEach((mark, i) => {
    const chosen = picked.kind === 'marks' && picked.index === i;
    if (mark.kind === 'note') { if (mark.at) add('marks', ball(mark.at, 3.2), chosen ? COLORS.picked : COLORS.note, 1); return; }
    if (mark.kind !== 'pain') return;
    const r = mark.radius || 15, strength = mark.strength || 5, color = chosen ? COLORS.picked : painColor(strength), opacity = 0.14 + 0.035 * strength;
    if (mark.at) add('marks', ball(mark.at, r), color, opacity);
    else if (mark.from && mark.to) add('marks', tube([mark.from, mark.to], () => [r, r], [1, 0, 0], 18), color, opacity * 0.8);
  });
  for (const p of extras.spots || []) add('spots', SPOT, COLORS.spot, 1, { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1]) });
  // Soft marks that show where a click would put the part of the tool in hand:
  //   dots:  [{ at, color, size, opacity }]   links: [{ from, to, color, opacity }] (a cross-link that could be there)
  // They are see-through, are left out of saved pictures and are never printed.
  const hints = extras.hints || {};
  for (const d of hints.dots || []) { const k = d.size || 1; add('hints', SPOT, d.color, d.opacity || 0.4, { hint: true, matrix: new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, d.at[0], d.at[1], d.at[2], 1]) }); }
  for (const l of hints.links || []) add('hints', crosslinkMesh(l, rodDirectionNear(hw.rods, l.from), rodDirectionNear(hw.rods, l.to), backAt(l.from)), l.color, l.opacity || 0.4, { hint: true });
  return items;
}

// The two corners of the box that holds every vertebra.
export function boundsOf(spine) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const l of spine.levels) for (let i = 0; i < 3; i++) { low[i] = Math.min(low[i], l.centre[i] - 40); high[i] = Math.max(high[i], l.centre[i] + 40); }
  // the sacrum hangs well below and behind its own middle
  const s = spine.levels.find((l) => l.id === 'S1');
  if (s) { low[2] = Math.min(low[2], s.centre[2] - 120); high[1] = Math.max(high[1], s.centre[1] + 70); }
  return { low, high };
}
