// Checks of the core code. Run with:  node tools/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { frameFromTilt, tiltFromFrame, vDot, vLen } from '../src/core/vec.js';
import { validateSpine, sortedLevels, isFused, isHeld } from '../src/core/spinefile.js';
import { vertebraMesh, discMesh } from '../src/core/bones.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh } from '../src/core/hardware.js';
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
  spine.hardware.screws.forEach((s) => sound(screwMesh(s), 'screw ' + s.level));
  spine.hardware.hooks.forEach((h) => sound(hookMesh(h), 'hook ' + h.level));
  spine.hardware.crosslinks.forEach((c) => sound(crosslinkMesh(c), 'cross-link'));
});
ok('a vertebra sits where the file says', () => {
  const l = spine.levels.find((x) => x.id === 'T8'), p = vertebraMesh(l).positions;
  let far = 0;
  for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i] - l.centre[0], p[i + 1] - l.centre[1], p[i + 2] - l.centre[2]));
  assert.ok(far > 20 && far < 80, 'T8 reaches ' + far.toFixed(0) + ' mm from its centre');
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
