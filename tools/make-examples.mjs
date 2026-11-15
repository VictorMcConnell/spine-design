// Writes the ready-made examples of the gallery (all but the real one) and examples/index.json,
// the list the gallery shows. Run: node tools/make-examples.mjs   (after make-average.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpine } from '../src/core/spinefile.js';
import { rigOf, setBow, setTwist } from '../src/core/shape.js';
import { planFor, buildHardware } from '../src/core/place.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const average = read('average.spine.json');

// A copy of the average spine with sideways curves: [top, bottom, degrees (plus bows right), turn]
function curved(name, about, curves) {
  const s = JSON.parse(JSON.stringify(average)), rig = rigOf(s);
  s.name = name; s.about = about;
  for (let round = 0; round < 4; round++) for (const [top, bottom, degrees] of curves) setBow(s, rig, top, bottom, 0, degrees);
  // bodies turn toward the side a curve bows to
  for (const [top, bottom, degrees, turn] of curves) setTwist(s, rig, top, bottom, degrees > 0 ? -turn : turn);
  for (const l of s.levels) l.source = 'typical';
  return s;
}

const made = {
  'curve-chest-45.spine.json': curved('One curve in the chest', 'A single sideways curve of 45° from T5 to T12, bowing to the right, with the bodies turned. A place to start if your curve is in the upper back.', [['T5', 'T12', 45, 15]]),
  'curve-lower-back-35.spine.json': curved('One curve in the lower back', 'A single sideways curve of 35° from T11 to L4, bowing to the left.', [['T11', 'L4', -35, 12]]),
  'curve-double.spine.json': curved('Two curves, an S shape', 'A curve of 50° to the right in the chest and one of 40° to the left in the lower back.', [['T5', 'T11', 50, 16], ['T11', 'L4', -40, 12]]),
  'fusion-rods-t4-l4.spine.json': curved('Fusion with rods and screws', 'What is left of an S shape after surgery: fused from T4 to L4, with hooks on the top two levels, screws below, two rods and two cross-links. Made up, not a real person.', [['T5', 'T11', 22, 8], ['T11', 'L4', -15, 5]]),
};
const fused = made['fusion-rods-t4-l4.spine.json'];
fused.fused = [['T4', 'L4']];
buildHardware(fused, planFor(fused.levels.map((l) => l.id), 'T4', 'L4', 'hooksTop'), 2);

const index = [{ file: 'average.spine.json', name: average.name, about: average.about }];
for (const [file, spine] of Object.entries(made)) {
  const problems = validateSpine(spine);
  if (problems.length) throw new Error(file + ': ' + problems.join(' '));
  fs.writeFileSync(path.join(dir, file), JSON.stringify(spine, null, 1) + '\n');
  index.push({ file, name: spine.name, about: spine.about });
}
const real = read('fusion-t4-l2.spine.json');
index.push({ file: 'fusion-t4-l2.spine.json', name: 'A real spine: ' + real.name.replace(/^Example: /, ''), about: real.about });
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log('examples written:', index.map((e) => e.file).join(', '));
