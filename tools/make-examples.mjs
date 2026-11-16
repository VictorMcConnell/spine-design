// Writes the ready-made examples of the gallery (all but the real one) and examples/index.json,
// the list the gallery shows. Run: node tools/make-examples.mjs   (after make-average.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpine } from '../src/core/spinefile.js';
import { rigOf, setBow, setTwist } from '../src/core/shape.js';
import { fitOut, setCell, drawRod } from '../src/core/place.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const average = read('average.spine.json');

// A copy of the average spine with sideways curves: [top, bottom, degrees (plus bows right), turn]
//   side: curves seen from the side, [top, bottom, degrees (plus rounds backward)]
function curved(name, about, curves, side = []) {
  const s = JSON.parse(JSON.stringify(average)), rig = rigOf(s);
  s.name = name; s.about = about;
  for (const [top, bottom, degrees] of side) setBow(s, rig, top, bottom, 1, degrees);
  for (let round = 0; round < 4; round++) for (const [top, bottom, degrees] of curves) setBow(s, rig, top, bottom, 0, degrees);
  // bodies turn toward the side a curve bows to
  for (const [top, bottom, degrees, turn] of curves) setTwist(s, rig, top, bottom, degrees > 0 ? -turn : turn);
  for (const l of s.levels) l.source = 'typical';
  return s;
}
const ids = average.levels.map((l) => l.id);

// The presets, in the groups the gallery shows them in. The curve patterns follow the six
// types of the Lenke system for scoliosis in teenagers (docs/sources.md says where the
// patterns and the figures were looked up). They are made-up spines, not real people.
const CURVES = 'Sideways curves', SIDE = 'Round and flat backs', AFTER = 'After surgery';
const made = {
  'curve-chest-45.spine.json': [CURVES, curved('One curve in the chest', 'One main curve of 45° to the right from T5 to T12, with the bodies turned. The gentler bends above and below it bring the head back over the pelvis. The most common pattern in teenagers with scoliosis.', [['T5', 'T12', 45, 15]])],
  'curve-chest-70.spine.json': [CURVES, curved('A strong curve in the chest', 'The same pattern at 70°, with more turn in the bodies.', [['T5', 'T12', 70, 24]])],
  'curve-two-chest.spine.json': [CURVES, curved('Two curves in the chest', 'A short, stiff curve of about 40° to the left high in the chest and a larger one of 55° to the right below it. The top of the chest leans, which is what lifts one shoulder.', [['T1', 'T5', -40, 9], ['T5', 'T12', 55, 17]])],
  'curve-double.spine.json': [CURVES, curved('Two curves, an S shape', 'A curve of 50° to the right in the chest and one of 40° to the left in the lower back.', [['T5', 'T11', 50, 16], ['T11', 'L4', -40, 12]])],
  'curve-triple.spine.json': [CURVES, curved('Three curves', 'A curve high in the chest to the left, a larger one in the chest to the right and a third in the lower back to the left.', [['T1', 'T5', -28, 6], ['T5', 'T11', 55, 17], ['T11', 'L4', -42, 12]])],
  'curve-lower-back-35.spine.json': [CURVES, curved('One curve in the lower back', 'One main curve of 35° to the left from T11 to L4, with gentler bends above and below it.', [['T11', 'L4', -35, 12]])],
  'curve-low-and-chest.spine.json': [CURVES, curved('A large curve low down, a smaller one above', 'A curve of 55° to the left where the chest meets the lower back and a smaller one of 38° to the right above it.', [['T5', 'T10', 38, 11], ['T10', 'L4', -55, 17]])],
  'curve-long-c.spine.json': [CURVES, curved('One long curve, a C shape', 'One long curve of 55° to the left that runs from the upper chest to the lower back, with a gentler bend under it that brings the spine back onto the pelvis.', [['T4', 'L3', -55, 13]])],
  'round-back.spine.json': [SIDE, curved('Round upper back', 'The chest part rounds backward by about 65°, where 20° to 40° is usual. Seen from the side. This is the shape that goes with Scheuermann\'s kyphosis.', [], [['T5', 'T12', 65]])],
  'flat-back.spine.json': [SIDE, curved('Flat lower back', 'The lower back has lost most of its hollow, so the trunk leans forward. Seen from the side.', [], [['L1', 'L5', -8]])],
  'hollow-back.spine.json': [SIDE, curved('Deep hollow in the lower back', 'The lower back hollows by about 60°, more than usual. Seen from the side.', [], [['L1', 'L5', -60]])],
  'fusion-screws-t4-l1.spine.json': [AFTER, curved('Fusion with screws at every level', 'A curve in the chest after surgery: fused from T4 to L1 with a screw on each side of every vertebra, two rods and a cross-link. Made up, not a real person.', [['T5', 'T12', 16, 6]])],
  'fusion-rods-t4-l4.spine.json': [AFTER, curved('Fusion with hooks on top and screws below', 'What is left of an S shape after surgery: fused from T4 to L4, with hooks on the top two levels, screws below, two rods and two cross-links. Made up, not a real person.', [['T5', 'T11', 22, 8], ['T11', 'L4', -15, 5]])],
  'fusion-one-rod.spine.json': [AFTER, curved('One rod with a hook at each end', 'The way many fusions were done from the 1960s into the 1990s: one straight rod on the inner side of the curve, held by a hook at each end. Fused from T4 to L2. Made up, not a real person.', [['T5', 'T12', 28, 10]], [['L1', 'L5', -22]])],
};
// (fitted out the way the app does it for the three questions of the guide, so a preset behaves like a spine that was built by hand:
// the cross-links sit in the middle of a gap between two vertebrae and the fused stretch is marked)
const fit = (file, top, bottom, pattern, links) => { const s = made[file][1]; s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] }; fitOut(s, top, bottom, pattern, links); return s; };
fit('fusion-screws-t4-l1.spine.json', 'T4', 'L1', 'screws', 1);
fit('fusion-rods-t4-l4.spine.json', 'T4', 'L4', 'hooksTop', 2);
// the single rod: its upper hook points up and its lower hook points down, which is how the two were pushed apart
const one = made['fusion-one-rod.spine.json'][1];
one.fused = [['T4', 'L2']]; one.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };      // (the usual colours: a steel rod on a fused spine is hard to see)
setCell(one, 'T4', 'left', 'hook', 'up'); setCell(one, 'L2', 'left', 'hook', 'down'); drawRod(one, 'left', 'T4', 'L2');
one.hardware.rods[0].diameter = 6.5;

const index = [{ file: 'average.spine.json', name: average.name, about: average.about, group: 'Start here' }];
for (const [file, [group, spine]] of Object.entries(made)) {
  const problems = validateSpine(spine);
  if (problems.length) throw new Error(file + ': ' + problems.join(' '));
  fs.writeFileSync(path.join(dir, file), JSON.stringify(spine, null, 1) + '\n');
  index.push({ file, name: spine.name, about: spine.about, group });
}
const real = read('fusion-t4-l2.spine.json');
index.push({ file: 'fusion-t4-l2.spine.json', name: 'A real spine: ' + real.name.replace(/^Example: /, ''), about: real.about, group: AFTER });
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log('examples written:', index.map((e) => e.file).join(', '));
