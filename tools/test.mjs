// Checks of the core code. Run with:  node tools/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { frameFromTilt, tiltFromFrame, vDot, vLen } from '../src/core/vec.js';
import { validateSpine, sortedLevels, isFused, isHeld } from '../src/core/spinefile.js';
import { vertebraMesh, discMesh } from '../src/core/bones.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh, rodDirectionNear } from '../src/core/hardware.js';
import { meshFromDistance } from '../src/core/solid.js';
import { ANATOMY } from '../src/core/anatomy.js';
import { LEVEL_ORDER } from '../src/core/spinefile.js';
import { measureSpine } from '../src/core/measures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spine = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'fusion-t4-l2.spine.json'), 'utf8'));
let checks = 0;
const ok = (name, fn) => { fn(); checks++; console.log('ok   ' + name); };

ok('the example is a valid spine file', () => assert.deepEqual(validateSpine(spine), []));
ok('a broken file is reported in words', () => {
  const bad = JSON.parse(JSON.stringify(spine));
  bad.levels[0].centre = [1, 2]; bad.levels[1].id = 'T99'; bad.schema = 7;
  assert.equal(validateSpine(bad).length, 3);
  assert.ok(validateSpine(null).length === 1 && validateSpine({ schema: 1, levels: [] }).length === 1);
});
ok('tilt and turn give three axes at right angles, and come back unchanged', () => {
  for (const l of spine.levels) {
    const f = frameFromTilt(l.tilt, l.turn);
    for (const a of [f.left, f.back, f.up]) assert.ok(Math.abs(vLen(a) - 1) < 1e-9);
    assert.ok(Math.abs(vDot(f.left, f.up)) < 1e-9 && Math.abs(vDot(f.left, f.back)) < 1e-9 && Math.abs(vDot(f.back, f.up)) < 1e-9);
    const back = tiltFromFrame(f);
    assert.ok(Math.abs(back.tilt[0] - l.tilt[0]) < 1e-6 && Math.abs(back.tilt[1] - l.tilt[1]) < 1e-6 && Math.abs(back.turn - l.turn) < 1e-6, l.id);
  }
});
ok('levels sort from the top down, fused and held levels are known', () => {
  const ids = sortedLevels(spine).map((l) => l.id);
  assert.equal(ids[0], 'C7'); assert.equal(ids[ids.length - 1], 'S1');
  assert.ok(isFused(spine, 'T8') && !isFused(spine, 'L3') && isHeld(spine, 'L3') && !isHeld(spine, 'L5') && !isHeld(spine, 'T2'));
});
const sound = (mesh, what) => {
  assert.ok(mesh.positions.length > 0 && mesh.positions.length % 3 === 0 && mesh.indices.length % 3 === 0, what);
  assert.ok(mesh.positions.every(Number.isFinite), what + ' has a point that is not a number');
  assert.ok(mesh.indices.every((i) => i >= 0 && i < mesh.positions.length / 3), what + ' points at a corner that does not exist');
};
ok('every vertebra, disc and piece of hardware builds a sound shape', () => {
  const levels = sortedLevels(spine);
  levels.forEach((l) => sound(vertebraMesh(l), l.id));
  for (let i = 0; i < levels.length - 1; i++) sound(discMesh(levels[i], levels[i + 1]), 'disc under ' + levels[i].id);
  spine.hardware.rods.forEach((r) => sound(rodMesh(r), 'rod'));
  spine.hardware.screws.forEach((s) => sound(screwMesh(s, rodDirectionNear(spine.hardware.rods, s.head), 6), 'screw ' + s.level));
  spine.hardware.hooks.forEach((h) => sound(hookMesh(h, rodDirectionNear(spine.hardware.rods, h.at), 6), 'hook ' + h.level));
  spine.hardware.crosslinks.forEach((c) => sound(crosslinkMesh(c), 'cross-link'));
});
// a closed solid: no edge is left open, and the faces point outward. Where two sheets of the
// surface pass through one grid cell an edge can be shared by four faces; that is still closed.
const closed = (mesh) => {
  const edges = new Map(), p = mesh.positions, ix = mesh.indices;
  let volume = 0;
  for (let f = 0; f < ix.length; f += 3) {
    const a = ix[f] * 3, b = ix[f + 1] * 3, c = ix[f + 2] * 3;
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    for (const [u, v] of [[ix[f], ix[f + 1]], [ix[f + 1], ix[f + 2]], [ix[f + 2], ix[f]]]) { const key = Math.min(u, v) + '_' + Math.max(u, v); edges.set(key, (edges.get(key) || 0) + 1); }
  }
  return { watertight: [...edges.values()].every((n) => n === 2 || n === 4), volume };
};
ok('a ball turned into a mesh is closed and has the right volume', () => {
  const c = closed(meshFromDistance((x, y, z) => Math.hypot(x, y, z) - 10, [-14, -14, -14], [14, 14, 14], 1));
  assert.ok(c.watertight && Math.abs(c.volume - 4189) < 120, 'volume ' + c.volume.toFixed(0));
});
ok('every level in the size table builds a closed bone of a believable volume', () => {
  for (const id of LEVEL_ORDER) {
    assert.ok(ANATOMY[id], id + ' is missing from the size table');
    const a = ANATOMY[id], c = closed(vertebraMesh({ id, centre: [0, 0, 0], tilt: [0, 0], turn: 0, size: id === 'C1' ? [20, 15, 9] : [a.w, a.d, (a.hf + a.hb) / 2] }, 1.6));
    assert.ok(c.watertight, id + ' is not a closed solid');
    assert.ok(c.volume > 1500 && c.volume < 260000, id + ' has a volume of ' + (c.volume / 1000).toFixed(1) + ' cm3');
  }
});
ok('the average spine is valid, straight from the front and curved from the side', () => {
  const average = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'average.spine.json'), 'utf8')), m = measureSpine(average);
  assert.deepEqual(validateSpine(average), []);
  assert.equal(average.levels.length, 25); assert.equal(m.curves.length, 0);
  assert.ok(m.kyphosis > 15 && m.kyphosis < 45 && m.lordosis > 25 && m.lordosis < 60, 'kyphosis ' + m.kyphosis + ', lordosis ' + m.lordosis);
  const gaps = average.levels.slice(1).map((l, i) => Math.hypot(...l.centre.map((v, j) => v - average.levels[i].centre[j])));
  assert.ok(gaps.every((g) => g > 8 && g < 45), 'neighbouring vertebrae are ' + Math.min(...gaps).toFixed(0) + ' to ' + Math.max(...gaps).toFixed(0) + ' mm apart');
});
ok('a vertebra sits where the file says', () => {
  const l = spine.levels.find((x) => x.id === 'T8'), p = vertebraMesh(l).positions;
  let far = 0;
  for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i] - l.centre[0], p[i + 1] - l.centre[1], p[i + 2] - l.centre[2]));
  assert.ok(far > 25 && far < 90, 'T8 reaches ' + far.toFixed(0) + ' mm from its centre');
});
ok('the numbers for the example are the ones worked out independently', () => {
  const m = measureSpine(spine);
  assert.deepEqual(m.curves.map((c) => [c.top, c.bottom, c.degrees]), [['C7', 'T2', 23], ['T2', 'T10', 75], ['T10', 'L4', 39], ['L4', 'S1', 19]]);
  assert.deepEqual(m.curves.map((c) => c.held), [false, false, true, false]);
  assert.equal(m.kyphosis, 36); assert.equal(m.lordosis, 46);
});
ok('a straight spine has no curve', () => {
  const straight = { schema: 1, levels: ['T1', 'T2', 'T3', 'T4'].map((id, i) => ({ id, centre: [0, 0, 100 - 25 * i], tilt: [0, 0], turn: 0, size: [30, 22, 18] })) };
  assert.deepEqual(validateSpine(straight), []);
  assert.equal(measureSpine(straight).curves.length, 0);
});
console.log(checks + ' checks passed');
