// Checks of the core code. Run with:  node tools/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { frameFromTilt, tiltFromFrame, vDot, vLen } from '../src/core/vec.js';
import { validateSpine, sortedLevels, isFused, isHeld } from '../src/core/spinefile.js';
import { vertebraMesh, discMesh, vertebraShape, setBoneStyle, boneStyle, screwEntryFor } from '../src/core/bones.js';
import { SHAPES, SHAPE_CREDIT } from '../src/shapes/bodyparts3d.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh, rodDirectionNear, TYPICAL, screwRegion, typicalScrew } from '../src/core/hardware.js';
import { meshFromDistance } from '../src/core/solid.js';
import { ANATOMY } from '../src/core/anatomy.js';
import { LEVEL_ORDER } from '../src/core/spinefile.js';
import { measureSpine } from '../src/core/measures.js';
import { rigOf, restack, carry, readShape, applyShape, pullLevel, toLocal, frameOf, bowOf, setBow, offsetOf, setOffset, twistOf, setTwist, moveAlone, liftLevel, straighten } from '../src/core/shape.js';
import { slot, planFor, buildHardware, fitRods, crosslinkAt, freeScrew, resizeScrew, screwLength, cellOf, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow, rodsEndBelow, setRodsEndBelow } from '../src/core/place.js';
import { rayMesh } from '../src/core/pick.js';
import { ball } from '../src/core/mesh.js';

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
  const split = JSON.parse(JSON.stringify(spine)); split.hardware.splits = ['T10'];
  assert.deepEqual(validateSpine(split), []);
  split.hardware.splits = ['T99'];
  assert.equal(validateSpine(split).length, 1);
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
const typicalSize = (id) => { const a = ANATOMY[id]; return id === 'C1' ? [20, 15, 9] : [a.w, a.d, (a.hf + a.hb) / 2]; };
ok('every level in the size table builds a closed bone of a believable volume, real and drawn', () => {
  assert.equal(boneStyle(), 'real');
  for (const style of ['drawn', 'real']) {
    setBoneStyle(style);
    for (const id of LEVEL_ORDER) {
      assert.ok(ANATOMY[id], id + ' is missing from the size table');
      const c = closed(vertebraMesh({ id, centre: [0, 0, 0], tilt: [0, 0], turn: 0, size: typicalSize(id) }, 1.6));
      assert.ok(c.watertight, id + ' (' + style + ') is not a closed solid');
      assert.ok(c.volume > 1500 && c.volume < 260000, id + ' (' + style + ') has a volume of ' + (c.volume / 1000).toFixed(1) + ' cm3');
    }
  }
});
// every place a line from a point crosses the surface of a shape, as distances along the line
const crossings = (origin, direction, mesh) => {
  const out = [];
  for (let from = origin, gone = 0; ;) {
    const t = rayMesh(from, direction, mesh);
    if (t === null) return out;
    gone += t + 1e-4; out.push(gone); from = origin.map((v, i) => v + direction[i] * gone);
  }
};
const inside = (point, mesh) => crossings(point, [0.3, 0.2, 0.93], mesh).length % 2 === 1;
ok('the real bones: one for every level, in the app\'s axes, with a body of the size in the table', () => {
  assert.ok(SHAPE_CREDIT.includes('BodyParts3D') && SHAPE_CREDIT.includes('Database Center for Life Science') && SHAPE_CREDIT.includes('CC Attribution 4.0'));
  for (const id of LEVEL_ORDER) {
    assert.ok(SHAPES[id], 'no real shape for ' + id);
    assert.deepEqual(SHAPES[id].size, typicalSize(id).map((v) => Math.round(v * 100) / 100));
  }
  for (const id of LEVEL_ORDER.slice(7, 24)) {
    const [w, d, h] = typicalSize(id), mesh = vertebraShape(id, [w, d, h]), go = (dir) => rayMesh([0, 0, 0], dir, mesh);
    assert.ok(inside([0, 0, 0], mesh), 'the middle of ' + id + ' is not in bone');
    const tall = go([0, 0, 1]) + go([0, 0, -1]), deep = go([0, 1, 0]) + go([0, -1, 0]), across = go([1, 0, 0]) + go([-1, 0, 0]);
    // through the middle a body is a little slimmer than at its top and underside, where the table measures it
    assert.ok(tall > h * 0.75 && tall < h * 1.05, id + ' is ' + tall.toFixed(1) + ' tall through the middle, table ' + h);
    assert.ok(deep > d * 0.8 && deep < d * 1.08, id + ' is ' + deep.toFixed(1) + ' deep through the middle, table ' + d);
    assert.ok(across > w * 0.75 && across < w * 1.08, id + ' is ' + across.toFixed(1) + ' across through the middle, table ' + w);
    assert.ok(Math.abs(go([1, 0, 0]) - go([-1, 0, 0])) < 2.5 && Math.abs(go([0, 1, 0]) - go([0, -1, 0])) < 3.5, id + ' is not centred');
    assert.ok(SHAPES[id].top.length === 28 && SHAPES[id].bottom.length === 28 && SHAPES[id].pedicle, id + ' lacks its disc outlines or its screw spot');
  }
  // a wider body stretches the shape
  const wide = (mesh) => { let m = 0; for (let i = 0; i < mesh.positions.length; i += 3) m = Math.max(m, mesh.positions[i]); return m; };
  const [w, d, h] = typicalSize('L3');
  assert.ok(Math.abs(wide(vertebraShape('L3', [w * 1.2, d, h])) / wide(vertebraShape('L3', [w, d, h])) - 1.2) < 1e-3);
  // and the drawn bones are still there
  setBoneStyle('drawn');
  assert.ok(vertebraShape('L3', [w, d, h]) !== SHAPES.L3 && screwEntryFor('L3', [w, d, h]) === null && vertebraShape('L3', [w, d, h]).positions.length > 3000);
  setBoneStyle('real');
  assert.ok(screwEntryFor('L3', [w, d, h]).entry.length === 3);
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
ok('a typical screw is offered for every level, inside the usual range for its part of the spine', () => {
  for (const id of LEVEL_ORDER) {
    const s = typicalScrew(id), row = TYPICAL.screws[screwRegion(id)];
    assert.ok(s.diameter >= row.thin && s.diameter <= row.thick && s.length >= 12 && s.length <= 55, id + ' gets ' + JSON.stringify(s));
    const mesh = screwMesh({ head: [0, 12, 0], entry: [0, 0, 0], tip: [0, -s.length, 0], diameter: s.diameter });
    assert.ok(mesh.positions.length > 0 && mesh.positions.every(Number.isFinite), id + ' screw does not build');
  }
  assert.ok(typicalScrew('L5').diameter > typicalScrew('T5').diameter, 'lower back screws are thicker than chest screws');
  assert.ok(typicalScrew('T5').diameter <= 0.8 * ANATOMY.T5.pw + 0.5, 'the T5 screw is too thick for its pedicle');
});
ok('the core of a screw slims toward the tip while the thread keeps its width', () => {
  const mesh = screwMesh({ head: [0, 12, 0], entry: [0, 0, 0], tip: [0, -40, 0], diameter: 6 }), p = mesh.positions;
  const band = (from, to) => { let thin = 99, wide = 0; for (let i = 0; i < p.length; i += 3) if (p[i + 1] < -from && p[i + 1] > -to) { const r = Math.hypot(p[i], p[i + 2]); thin = Math.min(thin, r); wide = Math.max(wide, r); } return [thin, wide]; };
  const near = band(6, 12), far = band(26, 32);
  assert.ok(near[0] > far[0] + 0.15, 'core near the head ' + near[0].toFixed(2) + ', further in ' + far[0].toFixed(2));
  assert.ok(Math.abs(near[1] - 3) < 0.05 && Math.abs(far[1] - 3) < 0.05, 'thread width ' + near[1].toFixed(2) + ' and ' + far[1].toFixed(2));
});
ok('a straight spine has no curve', () => {
  const straight = { schema: 1, levels: ['T1', 'T2', 'T3', 'T4'].map((id, i) => ({ id, centre: [0, 0, 100 - 25 * i], tilt: [0, 0], turn: 0, size: [30, 22, 18] })) };
  assert.deepEqual(validateSpine(straight), []);
  assert.equal(measureSpine(straight).curves.length, 0);
});

// ---- the builder
const copy = (o) => JSON.parse(JSON.stringify(o));
const average = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'average.spine.json'), 'utf8'));
ok('taking a spine apart into a chain and putting it back changes nothing', () => {
  for (const original of [spine, average]) {
    const s = copy(original); restack(s, rigOf(s));
    s.levels.forEach((l, i) => l.centre.forEach((v, j) => assert.ok(Math.abs(v - original.levels[i].centre[j]) <= 0.11, l.id + ' moved by ' + (v - original.levels[i].centre[j]).toFixed(2))));
  }
});
ok('reading the shape of a spine and writing it straight back changes nothing', () => {
  const s = copy(spine), shape = readShape(s);
  assert.deepEqual(shape.curves.map((c) => [c.top, c.bottom, c.degrees, c.bowsTo]), [['C7', 'T2', 23, 'left'], ['T2', 'T10', 75, 'right'], ['T10', 'L4', 39, 'left'], ['L4', 'S1', 19, 'right']]);
  applyShape(s, shape, rigOf(s));
  s.levels.forEach((l, i) => { assert.ok(Math.abs(l.tilt[0] - spine.levels[i].tilt[0]) < 0.11 && Math.abs(l.turn - spine.levels[i].turn) < 0.11 && Math.abs(l.centre[0] - spine.levels[i].centre[0]) < 0.3, l.id + ' changed'); });
});
ok('a curve entered as numbers comes out as that curve', () => {
  const s = copy(average), rig = rigOf(s), shape = readShape(s);
  shape.curves = [{ top: 'T5', bottom: 'T12', degrees: 40, bowsTo: 'right', turn: 15 }];
  applyShape(s, shape, rig);
  const main = measureSpine(s).curves.find((c) => c.degrees >= 30);
  assert.ok(main && Math.abs(main.degrees - 40) <= 2 && main.top === 'T5' && main.bottom === 'T12' && main.bowsTo === 'right', JSON.stringify(measureSpine(s).curves));
  const t8 = s.levels.find((l) => l.id === 'T8'), c1 = s.levels[0];
  assert.ok(t8.turn < -10 && t8.centre[0] < -8 && t8.centre[0] > -70, 'T8 turn ' + t8.turn + ', offset ' + t8.centre[0]);
  assert.ok(Math.abs(c1.centre[0]) < 25, 'the top ends ' + c1.centre[0] + ' mm off to the side');
  assert.deepEqual(validateSpine(s), []);
  shape.curves = [{ top: 'T4', bottom: 'T11', degrees: 60, bowsTo: 'right', turn: 20 }, { top: 'T11', bottom: 'L4', degrees: 45, bowsTo: 'left', turn: 15 }];
  applyShape(s, shape, rig);
  const found = measureSpine(s).curves, upper = found.find((c) => c.top === 'T4'), lower = found.find((c) => c.top === 'T11');
  assert.ok(upper && upper.bottom === 'T11' && upper.bowsTo === 'right' && Math.abs(upper.degrees - 60) <= 2, JSON.stringify(found));
  assert.ok(lower && lower.bowsTo === 'left' && Math.abs(lower.degrees - 45) <= 3, JSON.stringify(found));
  assert.ok(Math.abs(s.levels[0].centre[0]) < 25, 'the top ends ' + s.levels[0].centre[0] + ' mm off to the side');
});
ok('the side angles entered as numbers come out as those angles', () => {
  const s = copy(average), rig = rigOf(s), shape = readShape(s);
  shape.side = { neck: 20, chest: 55, lowerBack: 60 };
  applyShape(s, shape, rig);
  const m = measureSpine(s), tilt = (id) => s.levels.find((l) => l.id === id).tilt[1];
  assert.ok(Math.abs(m.kyphosis - 55) <= 1 && Math.abs(m.lordosis - 60) <= 1 && Math.abs(tilt('C2') - tilt('C7') - 20) <= 1, m.kyphosis + ' ' + m.lordosis);
});
ok('pulling a vertebra moves it and its neighbours, and the top settles back', () => {
  const s = copy(average), rig = rigOf(s), x = (id) => s.levels.find((l) => l.id === id).centre[0];
  pullLevel(s, rig, 'T8', 20, 0);
  assert.ok(x('T8') > 12 && x('T8') < 28 && x('T7') > 8 && Math.abs(x('C1')) < 6 && x('S1') === 0, 'T8 ' + x('T8') + ', T7 ' + x('T7') + ', C1 ' + x('C1'));
  assert.deepEqual(validateSpine(s), []);
});
ok('a stretch can be bowed to an angle while the rest of the spine stays put', () => {
  const s = copy(average), rig = rigOf(s), at = (id) => s.levels.find((l) => l.id === id);
  setBow(s, rig, 'T5', 'T12', 0, 40);
  const main = measureSpine(s).curves.find((c) => c.degrees >= 30);
  assert.ok(Math.abs(bowOf(s, 'T5', 'T12', 0) - 40) < 0.1 && main && main.top === 'T5' && main.bottom === 'T12' && main.bowsTo === 'right' && Math.abs(main.degrees - 40) <= 1, JSON.stringify(measureSpine(s).curves));
  for (const id of ['C3', 'T1', 'L4', 'S1']) assert.ok(Math.abs(at(id).centre[0]) < 0.6 && Math.abs(at(id).tilt[0]) < 0.01, id + ' moved: ' + at(id).centre[0] + ' mm, ' + at(id).tilt[0] + ' degrees');
  assert.ok(at('T8').centre[0] < -8, 'the middle went ' + at('T8').centre[0]);
  setBow(s, rig, 'T5', 'T12', 0, -25);
  assert.ok(Math.abs(bowOf(s, 'T5', 'T12', 0) + 25) < 0.1 && at('T8').centre[0] > 5 && Math.abs(at('C3').centre[0]) < 0.6);
  setBow(s, rig, 'T5', 'T12', 1, 60);
  assert.ok(Math.abs(measureSpine(s).kyphosis - 60) <= 1, 'rounding ' + measureSpine(s).kyphosis);
  setBow(s, rig, 'L1', 'L5', 1, -65);
  assert.ok(Math.abs(measureSpine(s).lordosis - 65) <= 1 && at('S1').tilt[1] === average.levels[24].tilt[1], 'hollow ' + measureSpine(s).lordosis);
  assert.deepEqual(validateSpine(s), []);
});
ok('a stretch can be offset: the top slides over, both ends keep their tilt', () => {
  const s = copy(average), rig = rigOf(s), at = (id) => s.levels.find((l) => l.id === id);
  setOffset(s, rig, 'T4', 'L1', 0, 15);
  assert.ok(Math.abs(offsetOf(s, 'T4', 'L1', 0) - 15) < 0.3 && at('T4').tilt[0] === 0 && at('L1').tilt[0] === 0 && Math.abs(at('C2').centre[0] - 15) < 1 && at('L3').centre[0] === 0, 'offset ' + offsetOf(s, 'T4', 'L1', 0));
  setOffset(s, rig, 'L4', 'L5', 1, offsetOf(s, 'L4', 'L5', 1) + 5);
  const before = offsetOf(average, 'L4', 'L5', 1);
  assert.ok(Math.abs(offsetOf(s, 'L4', 'L5', 1) - before - 5) < 0.3 && at('L4').tilt[1] === average.levels.find((l) => l.id === 'L4').tilt[1], 'neighbours slid ' + (offsetOf(s, 'L4', 'L5', 1) - before));
});
ok('one vertebra can be twisted, slid alone and lifted; everything sideways can be taken out', () => {
  const s = copy(average), rig = rigOf(s), at = (id) => s.levels.find((l) => l.id === id), z0 = at('T1').centre[2];
  setTwist(s, rig, 'T5', 'T12', 20);
  assert.ok(Math.abs(twistOf(s, 'T5', 'T12') - 20) < 0.1 && at('T5').turn === 0 && at('T12').turn === 0);
  moveAlone(s, rig, 'L3', 6, 0);
  assert.ok(Math.abs(at('L3').centre[0] - 6) < 0.3 && Math.abs(at('L2').centre[0]) < 0.3 && Math.abs(at('L4').centre[0]) < 0.01, 'L3 ' + at('L3').centre[0] + ', L2 ' + at('L2').centre[0]);
  liftLevel(s, rig, 'L3', 4);
  assert.ok(Math.abs(at('T1').centre[2] - z0 - 4) < 0.6, 'T1 rose ' + (at('T1').centre[2] - z0));
  setBow(s, rig, 'T5', 'T12', 0, 30); straighten(s, rig);
  assert.ok(s.levels.every((l) => l.tilt[0] === 0 && l.turn === 0 && Math.abs(l.centre[0]) < 0.05));
});
ok('hardware stays on its vertebra when the spine is bent', () => {
  const s = copy(spine), rig = rigOf(s), shape = readShape(s), screw = s.hardware.screws[3], level = () => s.levels.find((l) => l.id === screw.level);
  const before = toLocal(screw.tip, level().centre, frameOf(level()));
  carry(s, () => { shape.curves[1].degrees = 40; applyShape(s, shape, rig); });
  const after = toLocal(screw.tip, level().centre, frameOf(level()));
  assert.ok(Math.hypot(...before.map((v, i) => v - after[i])) < 0.3 && Math.abs(screw.tip[0] - spine.hardware.screws[3].tip[0]) > 2, 'the screw came loose');
});
ok('a stretch can be fitted out in one go: screws inside their bones, rods through every head', () => {
  const s = copy(average), ids = s.levels.map((l) => l.id);
  buildHardware(s, planFor(ids, 'T4', 'L4', 'hooksTop'), 2);
  const hw = s.hardware;
  assert.deepEqual(validateSpine(s), []);
  assert.deepEqual([hw.screws.length, hw.hooks.length, hw.rods.length, hw.crosslinks.length], [22, 4, 2, 2]);
  for (const screw of hw.screws) {
    const l = s.levels.find((x) => x.id === screw.level), tip = toLocal(screw.tip, l.centre, frameOf(l));
    assert.ok(Math.abs(tip[0]) < l.size[0] / 2 && Math.abs(tip[1]) < l.size[1] / 2 && Math.abs(tip[2]) < l.size[2] / 2, screw.level + ' ' + screw.side + ' tip is outside the body: ' + tip.map((v) => v.toFixed(1)));
    assert.ok((tip[0] > 0) === (screw.side === 'left'), screw.level + ' crosses the middle');
    const rod = hw.rods.find((r) => r.id === screw.rod), near = Math.min(...rod.points.map((p) => Math.hypot(p[0] - screw.head[0], p[1] - screw.head[1], p[2] - screw.head[2])));
    assert.ok(near < 0.2, 'the rod misses the ' + screw.level + ' screw by ' + near.toFixed(1) + ' mm');
  }
  hw.screws.pop(); fitRods(s);
  assert.equal(hw.rods.length, 2);
  const l8 = s.levels.find((x) => x.id === 'T8'), free = freeScrew(l8, slot(l8, 'left').screw.entry);
  resizeScrew(free, 6, 30);
  assert.ok(free.side === 'left' && free.diameter === 6 && screwLength(free) === 30);
  assert.ok(crosslinkAt(s, l8.centre[2]) && crosslinkAt(s, 9999) === null);
});
ok('on the real bones a screw from the usual spot runs through bone from its entry to its tip', () => {
  const s = copy(average), report = [];
  for (const l of s.levels.filter((x) => /^[TL]/.test(x.id))) {
    const mesh = vertebraMesh(l);
    for (const side of ['left', 'right']) {
      const sc = slot(l, side).screw;
      let within = 0;
      for (let k = 1; k <= 10; k++) if (inside(sc.entry.map((v, i) => v + (sc.tip[i] - v) * (0.08 + 0.088 * k)), mesh)) within++;
      report.push(l.id + ' ' + side + ' ' + within);
      assert.ok(within >= 9, l.id + ' ' + side + ': only ' + within + ' of 10 points along the screw are in bone');
      assert.ok(!inside(sc.head, mesh), 'the head of the ' + l.id + ' ' + side + ' screw is buried in bone');
    }
  }
});
ok('the sheet: cells, separate fusions, cross-links in gaps and rods that end part way', () => {
  const s = copy(average), hw = () => s.hardware;
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T4', 'T5', 'T6', 'T10', 'T11', 'T12']) for (const side of ['left', 'right']) setCell(s, id, side, id === 'T4' ? 'hook' : 'screw');
  assert.deepEqual([hw().screws.length, hw().hooks.length, hw().rods.length, cellOf(s, 'T4', 'left'), cellOf(s, 'T5', 'right'), cellOf(s, 'T7', 'left')], [10, 2, 2, 'hook', 'screw', '']);
  setRodsEndBelow(s, 'T6', true);
  assert.deepEqual([hw().rods.length, rodsEndBelow(s, 'T6'), hw().screws.find((p) => p.level === 'T10' && p.side === 'left').rod], [4, true, 'left-2']);
  for (const id of ['T4', 'T5', 'T10', 'T11']) setFusedBelow(s, id, true);
  assert.deepEqual(s.fused, [['T4', 'T6'], ['T10', 'T12']]);
  assert.ok(fusedBelow(s, 'T5') && !fusedBelow(s, 'T6') && !fusedBelow(s, 'T9'));
  setFusedBelow(s, 'T5', false);
  assert.deepEqual(s.fused, [['T4', 'T5'], ['T10', 'T12']]);
  assert.ok(setLinkBelow(s, 'T4', true) && linkBelow(s, 'T4') && !setLinkBelow(s, 'T7', true) && hw().crosslinks.length === 1, 'cross-links: ' + hw().crosslinks.length);
  setCell(s, 'T4', 'left', ''); setCell(s, 'T5', 'left', '');
  assert.equal(hw().crosslinks.length, 0, 'the cross-link should go when its rod is gone');
  setRodsEndBelow(s, 'T6', false); setCell(s, 'T6', 'left', 'screw'); setCell(s, 'T6', 'left', 'screw');
  assert.deepEqual([hw().rods.length, hw().screws.filter((p) => p.level === 'T6' && p.side === 'left').length], [2, 1]);
  assert.deepEqual(validateSpine(s), []);
});
ok('a ray finds the front of a ball', () => {
  const t = rayMesh([0, -100, 0], [0, 1, 0], ball([0, 0, 0], 10));
  assert.ok(Math.abs(t - 90) < 0.3 && rayMesh([30, -100, 0], [0, 1, 0], ball([0, 0, 0], 10)) === null, 'hit at ' + t);
});
console.log(checks + ' checks passed');
