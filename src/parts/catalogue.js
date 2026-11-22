// Every kind of part with the code that draws it. kinds.js holds the facts about each kind
// and can be read from anywhere. This file adds the drawing, which needs the shapes.

import { PART_KINDS } from './kinds.js';
import { rodItems, rodMesh } from './rod.js';
import { screwItems, screwMesh } from './screw.js';
import { hookItems, hookMesh } from './hook.js';
import { crosslinkItems, crosslinkMesh } from './crosslink.js';
import { USUAL_FINISH } from './kinds.js';
import { colorOf, DISC, discTint } from '../core/finish.js';
import { discParts, endplateRing, levelFrame, vertebraShape, vertebraMesh, archMarks } from '../core/bones.js';
import { brokenSize, crackMarks, boneMarks } from '../core/fractures.js';
import { loft } from '../core/mesh.js';
import { vAdd, vScale } from '../core/vec.js';

// What the scene shows for one piece of each kind: (piece, index, around) => [{ mesh, matrix, name }]
//   around: { rods, rodSize(id), backAt(point) } what the piece sits among
const DRAWINGS = { rods: rodItems, screws: screwItems, hooks: hookItems, crosslinks: crosslinkItems };

// The rows of kinds.js, each with its drawing as "items".
export const PARTS = PART_KINDS.map((p) => ({ ...p, items: DRAWINGS[p.kind] }));

// One of each part on its own, for the small picture on its tile of the catalogue: a list of
// { group, mesh, color } by the id of the tile, or null for a tile that has no picture.
// (y points away from the bone and z up, as on a spine seen from the back.)
const up = [0, 0, 1], stub = (x) => rodMesh({ diameter: 5.5, points: [[x, 0, -16], [x, 0, 16]] });
const SAMPLES = {
  screw: () => [['screws', screwMesh({ head: [0, 0, 0], entry: [0, -9, 0], tip: [0, -27, 0], diameter: 5.5 }, up)]],
  'screw-tall': () => [['screws', screwMesh({ head: [0, 0, 0], entry: [0, -9, 0], tip: [0, -27, 0], diameter: 5.5, look: 'tall' }, up)]],
  'screw-low': () => [['screws', screwMesh({ head: [0, 0, 0], entry: [0, -7, 0], tip: [0, -25, 0], diameter: 5.5, look: 'low' }, up)]],
  'hook-down': () => [['hooks', hookMesh({ at: [0, 0, 0], mid: [0, -7, -3.5], tip: [0, -9, -11], kind: 'lamina', faces: 'down' }, up)]],
  'hook-up': () => [['hooks', hookMesh({ at: [0, 0, 0], mid: [0, -7, 3.5], tip: [0, -9, 11], kind: 'lamina', faces: 'up' }, up)]],
  link: () => [['crosslinks', crosslinkMesh({ from: [-19, 0, 0], to: [19, 0, 0] }, up, up, [0, 1, 0])], ['rods', stub(-19)], ['rods', stub(19)]],
  'link-plate': () => [['crosslinks', crosslinkMesh({ from: [-19, 0, 0], to: [19, 0, 0], style: 'plate' }, up, up, [0, 1, 0])], ['rods', stub(-19)], ['rods', stub(19)]],
  'link-straight': () => [['crosslinks', crosslinkMesh({ from: [-19, 0, 0], to: [19, 0, 0], style: 'straight' }, up, up, [0, 1, 0])], ['rods', stub(-19)], ['rods', stub(19)]],
  'rod-thick': () => [['rods', rodMesh({ diameter: 8, points: ROD_SAMPLE })]],
  'rod-thin': () => [['rods', rodMesh({ diameter: 3.6, points: ROD_SAMPLE })]],
  rod: () => [['rods', rodMesh({ diameter: 5.5, points: [[0, 0, -44], [0, 3.5, -22], [0, 5, 0], [0, 3.5, 22], [0, 0, 44]] })]],
};
// (the two other thicknesses are drawn a little further apart than they are, or the three tiles would look the same)
const ROD_SAMPLE = [[0, 0, -44], [0, 3.5, -22], [0, 5, 0], [0, 3.5, 22], [0, 0, 44]];
// (a disc between two bodies of the low back, standing a usual space apart, or a small one for the thin disc)
const twoBodies = (gap) => [{ id: 'L3', centre: [0, 0, 14.4 + gap + 13.85], tilt: [0, 0], turn: 0, size: [47, 35, 27.7] }, { id: 'L4', centre: [0, 0, 0], tilt: [0, 0], turn: 0, size: [49, 35.5, 28.8] }];
const BONE = [0.78, 0.68, 0.52];
const DISC_SAMPLES = { 'disc-standard': [{ state: 'standard' }, 10], 'disc-thin': [{ state: 'thin', amount: 0.6 }, 3.2], 'disc-bulging': [{ state: 'bulging', amount: 1, toward: 'back-left' }, 10], 'disc-herniated': [{ state: 'herniated', amount: 0.9, toward: 'back-left' }, 10], 'disc-dried': [{ state: 'dried' }, 7], 'disc-replacement': [{ state: 'replacement' }, 10], 'disc-cage': [{ state: 'cage' }, 10], 'disc-cage-screws': [{ state: 'cage-screws' }, 10] };
// (seen from the front and a little to one side, where the screws are)
const DISC_VIEWS = { 'disc-cage-screws': [Math.PI + 0.45, 0.12] };
// (a vertebra of the low back, whole or broken, seen from the side so the height of its body shows)
const BONE_SAMPLES = { 'bone-healthy': null, 'bone-wedge': ['wedge', 0.9], 'bone-crush': ['crush', 0.9], 'bone-burst': ['burst', 1], 'bone-wedge-left': ['wedge-left', 1], 'bone-wedge-right': ['wedge-right', 1], 'bone-hairline': ['hairline', 0.7], 'bone-split': ['split', 0.6], 'bone-chip': ['chip', 0.6],
  'bone-clean': null, 'bone-aged': null, 'bone-porous': null, 'look-plain': null, 'look-spurs': null, 'look-dense': null, 'look-sore': null };
// (the two squashed to a side are seen from the front, where the lower side shows)
const FROM_FRONT = ['bone-wedge-left', 'bone-wedge-right'];
const LOOK_SAMPLES = { 'look-spurs': 'spurs', 'look-dense': 'dense', 'look-sore': 'sore' };
const WEAR_SAMPLES = { 'bone-aged': 0.5, 'bone-porous': 1 };
// (a whole vertebra of the low back seen from behind and above, where its back shows best)
const ARCH_SAMPLES = { 'arch-whole': '', 'arch-laminectomy': 'laminectomy', 'arch-spinous': 'spinous', 'arch-tp-left': 'tp-left', 'arch-tp-right': 'tp-right' };
export function sampleOf(id) {
  if (id in ARCH_SAMPLES) {
    const level = { id: 'L3', size: [47, 35, 27.7], ...(ARCH_SAMPLES[id] ? { arch: ARCH_SAMPLES[id] } : {}) };
    return [{ group: 'vertebrae', mesh: vertebraShape(level.id, level.size), color: BONE, view: [id === 'arch-tp-right' ? -0.42 : 0.42, 0.62], ...(archMarks(level) || {}) }];
  }
  if (id in BONE_SAMPLES) {
    const size = [43, 33, 25.5], how = BONE_SAMPLES[id], broken = how ? brokenSize(size, how[0], how[1]) : null;
    // (only the body is shown, cut off where the arch starts, so that its height fills the tile)
    const look = LOOK_SAMPLES[id], now = broken ? broken.size : size;
    const whole = vertebraShape('L1', now, 1.4, how ? { kind: how[0], amount: how[1], was: size[2] } : null, look === 'spurs'), p = whole.positions, ix = whole.indices, indices = [];
    for (let i = 0; i < ix.length; i += 3) if (p[ix[i] * 3 + 1] < 21 && p[ix[i + 1] * 3 + 1] < 21 && p[ix[i + 2] * 3 + 1] < 21) indices.push(ix[i], ix[i + 1], ix[i + 2]);
    // (a broken body carries its dark line, and worn bone its pits, the way the scene draws them)
    const marks = boneMarks({ bone: look, size: now });
    const fine = { ...(broken ? { crack: crackMarks({ kind: how[0], amount: how[1] }, now) } : {}), ...(marks ? { bone: marks } : {}) };
    return [{ group: 'vertebrae', mesh: { positions: p, indices }, color: BONE, view: FROM_FRONT.includes(id) ? [Math.PI, 0.08] : [1.95, 0.1], box: [[-24, -19, -14], [24, 21, 14]], ...fine, ...(WEAR_SAMPLES[id] ? { wear: WEAR_SAMPLES[id] } : {}) }];
  }
  if (DISC_SAMPLES[id]) {
    // the disc between a slice of the bone above it and a slice of the bone below, so its height and its bulge can be judged
    const [disc, gap] = DISC_SAMPLES[id], [upper, lower] = twoBodies(gap);
    const slice = (level, top) => { const ring = endplateRing(level, top), away = vScale(levelFrame(level).up, top ? -8 : 8), far = ring.map((p) => vAdd(p, away)); return { group: 'vertebrae', mesh: loft(top ? [far, ring] : [ring, far], true), color: BONE }; };
    const first = slice(upper, false); if (DISC_VIEWS[id]) first.view = DISC_VIEWS[id];
    return [first, slice(lower, true), ...discParts(upper, lower, disc).map((p) => ({ group: 'discs', mesh: p.mesh, color: p.color || discTint(DISC, p.tint), ...(p.metal ? { metal: true } : {}) }))];
  }
  if (id === 'disc-plate') {
    // two bodies seen from the front and a little to one side, with the plate across the disc between them
    const [upper, lower] = twoBodies(10), parts = discParts(upper, lower, { state: 'standard', plate: true });
    return [{ group: 'vertebrae', mesh: vertebraMesh(upper, 1.4), color: BONE, view: [Math.PI + 0.55, 0.12], box: [[-26, -20, -14], [26, 14, 56]] }, { group: 'vertebrae', mesh: vertebraMesh(lower, 1.4), color: BONE },
      ...parts.map((p) => ({ group: 'discs', mesh: p.mesh, color: p.color || discTint(DISC, p.tint), ...(p.metal ? { metal: true } : {}) }))];
  }
  if (id === 'disc-spacer') {
    // two whole vertebrae seen from behind and to one side, with the spacer between their back processes
    const [upper, lower] = twoBodies(10), parts = discParts(upper, lower, { state: 'none', spacer: true });
    return [{ group: 'vertebrae', mesh: vertebraMesh(upper, 1.4), color: BONE, view: [0.7, 0.2], box: [[-26, 8, -26], [26, 62, 62]] }, { group: 'vertebrae', mesh: vertebraMesh(lower, 1.4), color: BONE },
      ...parts.map((p) => ({ group: 'discs', mesh: p.mesh, color: p.color, metal: true }))];
  }
  return SAMPLES[id] ? SAMPLES[id]().map(([group, mesh]) => ({ group, mesh, color: colorOf(USUAL_FINISH[group]) })) : null;
}
