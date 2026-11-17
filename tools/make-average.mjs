// Writes examples/average.spine.json: a straight, typical adult spine stacked from the sizes in
// src/core/anatomy.js and the usual side curves. This is the spine the builder starts from.
//   node tools/make-average.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANATOMY, DISCS, ALIGNMENT } from '../src/core/anatomy.js';
import { LEVEL_ORDER } from '../src/core/spinefile.js';
import { frameFromTilt } from '../src/core/vec.js';
import { typicalLean } from '../src/core/shape.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = (v) => Math.round(v * 10) / 10;

// How far the top of each vertebra leans back (plus) or forward (minus), from the bottom up.
const lean = typicalLean(ALIGNMENT);

const height = (id) => (id === 'C1' ? 9 : (ANATOMY[id].hf + ANATOMY[id].hb) / 2);
const ids = [...LEVEL_ORDER].reverse(), levels = [];
let centre = [0, 0, 0];
ids.forEach((id, i) => {
  const up = frameFromTilt([0, lean[id]], 0).up;
  if (i > 0) {
    const below = ids[i - 1], disc = DISCS[id + '/' + below], gap = disc ? (disc[0] + disc[1]) / 2 : 1;
    const upBelow = frameFromTilt([0, lean[below]], 0).up;
    centre = centre.map((c, j) => c + upBelow[j] * (height(below) / 2 + gap / 2) + up[j] * (gap / 2 + height(id) / 2));
  }
  const a = ANATOMY[id];
  levels.unshift({ id, centre: centre.map(round), tilt: [0, round(lean[id])], turn: 0, size: [a.w, a.d, round(height(id))], source: 'typical' });
});

const spine = {
  schema: 1, name: 'Average spine', units: 'mm',
  frame: 'x = patient left, y = back, z = up, origin at the centre of S1, standing',
  about: 'A typical adult spine with no sideways curve, stacked from general measurements. Start here and shape it into your own.',
  levels, fused: [], hardware: { rods: [], screws: [], hooks: [], crosslinks: [] }, marks: [], pictures: [],
};
const text = JSON.stringify(spine, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3]').replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]');
fs.writeFileSync(path.join(root, 'examples', 'average.spine.json'), text + '\n');
const top = levels[0].centre, tall = Math.round(top[2] - levels[levels.length - 1].centre[2]);
console.log('examples/average.spine.json written:', levels.length, 'levels, C1 sits', tall, 'mm above S1 and', Math.round(top[1]), 'mm behind it');
