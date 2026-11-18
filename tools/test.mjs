// Checks of the core code. Run with:  node tools/test.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { frameFromTilt, tiltFromFrame, vDot, vLen } from '../src/core/vec.js';
import { validateSpine, sortedLevels, isFused, isHeld } from '../src/core/spinefile.js';
import { vertebraMesh, discMesh, vertebraShape, setBoneStyle, boneStyle, screwEntryFor, boneSurface, levelFrame } from '../src/core/bones.js';
import { SHAPES, SHAPE_CREDIT } from '../src/shapes/bodyparts3d.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh, rodDirectionNear, TYPICAL, screwRegion, typicalScrew, FINISHES, PALETTES, USUAL_FINISH, colorOf } from '../src/core/hardware.js';
import { meshFromDistance } from '../src/core/solid.js';
import { ANATOMY } from '../src/core/anatomy.js';
import { LEVEL_ORDER } from '../src/core/spinefile.js';
import { measureSpine } from '../src/core/measures.js';
import { JOINT_MOST, lineOf, slideLevel, rigOf, restack, carry, readShape, applyShape, pullLevel, toLocal, frameOf, bowOf, setBow, offsetOf, setOffset, twistOf, setTwist, moveAlone, liftLevel, gapUnder, straighten, stiffen, blockOf, pivotAt, followLine } from '../src/core/shape.js';
import { slot, planFor, buildHardware, fitRods, crosslinkAt, freeScrew, resizeScrew, screwLength, cellOf, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow, rodsEndBelow, setRodsEndBelow, gapsOf, setRodCut, drawRod, splitAtGaps, rodSets, cutAll, rodsThroughAll, cutRodAt, linkFits, linkSpot, shiftParts, fitOut, ROD_RULES, strainAt, moveInLine, settleInLine, bendRod, unbendRod, faceHook } from '../src/core/place.js';
import { rayMesh } from '../src/core/pick.js';
import { ball } from '../src/core/mesh.js';
import { packSpine, unpackSpine, linkFor, packedIn } from '../src/io/share.js';
import { stlOf, objOf } from '../src/io/print.js';
import { zipOf, crc32 } from '../src/io/zip.js';
import { standFor } from '../src/core/stand.js';
import { smoother } from '../src/core/smooth.js';
import zlib from 'node:zlib';
import { buildScene } from '../src/view/scene.js';
import { sheetOf, pictureOf, placeAbout, firstPlace, cornersOf, depthOf, fitTrace, followTrace, runOf, spotsAlong, toneTable, tonePicture, quadMatrix, USUAL_TONE } from '../src/core/trace.js';

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
ok('a fused stretch made stiff moves as one block and the bend goes into the free joints', () => {
  const s = copy(average), at = (id) => s.levels.find((l) => l.id === id);
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  setBow(s, rigOf(s), 'T5', 'T11', 0, 30);                    // the stretch has a curve of its own to keep
  s.fused = [['T4', 'L2']];
  buildHardware(s, planFor(s.levels.map((l) => l.id), 'T4', 'L2', 'screws'), 1);
  const rig = rigOf(s, true);
  assert.deepEqual([rig.blocks.length, rig.blocks[0].from, rig.blocks[0].to], [1, 10, 20]);
  assert.deepEqual([blockOf(s, rig, 'T8').top, blockOf(s, rig, 'T8').bottom, blockOf(s, rig, 'T3'), blockOf(s, rigOf(s), 'T8')], ['T4', 'L2', null, null]);
  // how T4 and T8 sit against L2, and how far two screws of the block are apart
  const pose = () => {
    const base = at('L2'), f = frameOf(base), out = [];
    for (const id of ['T4', 'T8']) { const g = frameOf(at(id)); out.push(...toLocal(at(id).centre, base.centre, f), 100 * vDot(g.up, f.up), 100 * vDot(g.left, f.left), 100 * vDot(g.up, f.left)); }
    const a = s.hardware.screws.find((x) => x.level === 'T5' && x.side === 'left').head, b = s.hardware.screws.find((x) => x.level === 'L1' && x.side === 'right').head;
    return [...out, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])];
  };
  const before = pose(), held = (what) => pose().forEach((v, i) => assert.ok(Math.abs(v - before[i]) < 0.35, what + ': the block changed shape (' + i + ': ' + before[i].toFixed(2) + ' to ' + v.toFixed(2) + ')'));
  const far = () => [at('C3').centre[0], at('S1').centre[0], at('L5').tilt[0]];
  // a bow across the block: the angle is reached, the block is as it was, the far ends stay
  const f0 = far();
  carry(s, () => setBow(s, rig, 'T2', 'L4', 0, 25));
  assert.ok(Math.abs(bowOf(s, 'T2', 'L4', 0) - 25) < 0.3, 'the bow came out as ' + bowOf(s, 'T2', 'L4', 0));
  held('bow across');
  assert.ok(Math.abs(far()[0] - f0[0]) < 1.5 && far()[1] === f0[1], 'the far ends moved: ' + far());
  // a bow inside the block does nothing, and neither does a twist or an offset there
  const inside = [bowOf(s, 'T5', 'T11', 0), twistOf(s, 'T5', 'T11'), offsetOf(s, 'T5', 'T11', 0)];
  carry(s, () => { setBow(s, rig, 'T5', 'T11', 0, 0); setTwist(s, rig, 'T5', 'T11', 20); setOffset(s, rig, 'T5', 'T11', 0, 30); });
  assert.deepEqual([bowOf(s, 'T5', 'T11', 0), twistOf(s, 'T5', 'T11'), offsetOf(s, 'T5', 'T11', 0)], inside);
  // pulling a vertebra of the block takes the block along
  const x0 = at('T8').centre[0];
  carry(s, () => pullLevel(s, rig, 'T8', 12, 0));
  assert.ok(Math.abs(at('T8').centre[0] - x0) > 4, 'T8 moved ' + (at('T8').centre[0] - x0).toFixed(1));
  held('pull');
  // sliding it slides the block on the free joint below
  const step = () => at('L2').centre[0] - at('L3').centre[0], st0 = step();
  carry(s, () => moveAlone(s, rig, 'T8', 6, 0));
  assert.ok(Math.abs(step() - st0 - 6) < 0.6, 'the block slid ' + (step() - st0).toFixed(1));
  held('slide');
  // turning one by hand turns them all
  const t0 = at('L2').turn;
  carry(s, () => { at('T8').turn += 12; restack(s, rig, 'T8'); });
  assert.ok(Math.abs(at('L2').turn - t0) > 6, 'L2 turned ' + (at('L2').turn - t0).toFixed(1));
  held('turn by hand');
  // a twist and an offset across the block, and the space under a fused vertebra
  carry(s, () => setTwist(s, rig, 'T1', 'L5', twistOf(s, 'T1', 'L5') + 8));
  held('twist across');
  carry(s, () => setOffset(s, rig, 'T2', 'L4', 0, 14));
  assert.ok(Math.abs(offsetOf(s, 'T2', 'L4', 0) - 14) < 0.5, 'the offset came out as ' + offsetOf(s, 'T2', 'L4', 0));
  held('offset across');
  const gap = gapUnder(s, rig, 'T8');
  liftLevel(s, rig, 'T8', 5); assert.equal(gapUnder(s, rig, 'T8'), gap);
  const under = gapUnder(s, rig, 'L2');
  liftLevel(s, rig, 'L2', 5); assert.ok(Math.abs(gapUnder(s, rig, 'L2') - under - 5) < 1e-9);
  // taking out everything sideways leaves the block its shape
  carry(s, () => straighten(s, rig));
  held('straighten');
  assert.ok(at('C3').tilt[0] === 0 && at('L4').tilt[0] === 0 && at('L2').tilt[0] === 0 && Math.abs(at('T8').tilt[0]) > 2);
  // freed again, the stretch can be reshaped
  stiffen(s, rig, false);
  setBow(s, rig, 'T5', 'T11', 0, 0);
  assert.ok(Math.abs(bowOf(s, 'T5', 'T11', 0)) < 0.3 && rig.blocks.length === 0);
  // two separate blocks, and a stretch fused down to the bottom vertebra
  const two = copy(average); two.fused = [['T2', 'T6'], ['L3', 'S1']];
  const r2 = rigOf(two, true), l3 = two.levels.find((l) => l.id === 'L3'), was = [...l3.tilt];
  assert.equal(r2.blocks.length, 2);
  setBow(two, r2, 'T10', 'L4', 0, 18);
  assert.ok(Math.abs(bowOf(two, 'T10', 'L4', 0) - 18) < 0.3 && l3.tilt[0] === was[0] && two.levels.find((l) => l.id === 'S1').tilt[0] === 0, 'bow ' + bowOf(two, 'T10', 'L4', 0) + ', L3 ' + l3.tilt);
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
// how far a point is from a line drawn through a list of points
const offLine = (p, line) => {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], ab = line[i + 1].map((v, j) => v - a[j]), t = Math.max(0, Math.min(1, ab.reduce((x, v, j) => x + v * (p[j] - a[j]), 0) / ab.reduce((x, v) => x + v * v, 0)));
    best = Math.min(best, Math.hypot(...p.map((v, j) => v - a[j] - ab[j] * t)));
  }
  return best;
};
ok('a rod runs through its screws in the order they sit along the spine and never spikes', () => {
  const s = copy(average), list = s.levels.map((l) => l.id);
  buildHardware(s, planFor(list, 'T4', 'L2', 'screws'), 0);
  const left = s.hardware.screws.filter((x) => x.side === 'left');
  // a zigzag: every second screw pushed 14 mm outward, one named after the wrong vertebra and two crowded together
  left.forEach((sc, i) => { if (i % 2) for (const k of ['head', 'entry', 'tip']) sc[k] = [sc[k][0] + 14, sc[k][1], sc[k][2]]; });
  left[3].level = 'T11'; left[6].level = 'T5';
  for (const k of ['head', 'entry', 'tip']) left[8][k] = left[7][k].map((v, j) => v - (j === 2 ? 5 : 0));
  fitRods(s);
  const rod = s.hardware.rods.find((r) => r.side === 'left'), heads = left.map((x) => x.head).sort((p, q) => q[2] - p[2]);
  assert.ok(rod.points.every((p) => p.every(Number.isFinite)));
  for (const h of heads) assert.ok(offLine(h, rod.points) < 1.2, 'the rod misses a head by ' + offLine(h, rod.points).toFixed(1) + ' mm');
  // it keeps to the straight lines from head to head and never doubles back
  const ends = [rod.points[0], ...heads, rod.points[rod.points.length - 1]], worst = Math.max(...rod.points.map((p) => offLine(p, ends)));
  assert.ok(worst < 4, 'the rod swings ' + worst.toFixed(1) + ' mm away from the line through its screws');
  for (let i = 1; i < rod.points.length; i++) assert.ok(rod.points[i][2] < rod.points[i - 1][2] + 0.6, 'the rod doubles back at point ' + i);
  sound(rodMesh(rod), 'the rod');
});
ok('moving a screw or hook stops where its rod could no longer follow, and a stray one is brought into line', () => {
  const s = copy(average), list = s.levels.map((l) => l.id);
  buildHardware(s, planFor(list, 'T4', 'L2', 'hooksTop'), 0);
  const sc = s.hardware.screws.find((x) => x.level === 'T9' && x.side === 'left'), calm = strainAt(s, sc);
  assert.ok(calm.corner < 20 && calm.gap > 18, 'at rest: ' + JSON.stringify(calm));
  // 60 mm sideways is asked for, in steps: the screw stops where the rod would turn too sharp a corner
  let gone = 0;
  for (let i = 0; i < 30; i++) gone += 2 * moveInLine(s, sc, [2, 0, 0]);
  assert.ok(gone > 6 && gone < 30 && strainAt(s, sc).corner <= ROD_RULES.sharpest + 0.3, 'moved ' + gone.toFixed(1) + ' mm, corner ' + strainAt(s, sc).corner.toFixed(1));
  assert.equal(moveInLine(s, sc, [-2, 0, 0]), 1);                 // back toward the line is always free
  // and it cannot be pushed into its neighbour
  let down = 0;
  for (let i = 0; i < 30; i++) down += 2 * moveInLine(s, sc, [0, 0, -2]);
  assert.ok(strainAt(s, sc).gap >= ROD_RULES.closest - 0.3 && down < 30, 'gap ' + strainAt(s, sc).gap.toFixed(1));
  // a hook rides the same rules, with its blade
  const hook = s.hardware.hooks.find((x) => x.side === 'right' && x.level === 'T5'), blade = hook.tip.map((v, j) => v - hook.at[j]);
  for (let i = 0; i < 30; i++) moveInLine(s, hook, [-2, 0, 0]);
  assert.ok(strainAt(s, hook).corner <= ROD_RULES.sharpest + 0.3 && hook.tip.every((v, j) => Math.abs(v - hook.at[j] - blade[j]) < 0.25));
  // a screw dropped far out of line slides in, a well placed one is left alone
  const far = s.hardware.screws.find((x) => x.level === 'T12' && x.side === 'right'), fine = s.hardware.screws.find((x) => x.level === 'L1' && x.side === 'left'), kept = [...fine.head];
  for (const k of ['head', 'entry', 'tip']) far[k] = [far[k][0] - 45, far[k][1] + 10, far[k][2]];
  assert.ok(strainAt(s, far).corner > 60);
  assert.equal(settleInLine(s, far), true);
  assert.ok(strainAt(s, far).corner <= ROD_RULES.sharpest + 0.3 && strainAt(s, far).gap >= ROD_RULES.closest - 0.3, JSON.stringify(strainAt(s, far)));
  assert.equal(settleInLine(s, fine), false); assert.deepEqual(fine.head, kept);
});
ok('a rod can be bent by hand between two screws, keeps the bend and can lose it again', () => {
  const s = copy(average), list = s.levels.map((l) => l.id), at = (id) => s.levels.find((l) => l.id === id);
  buildHardware(s, planFor(list, 'T4', 'L2', 'alternate'), 0);
  const rod = () => s.hardware.rods.find((r) => r.side === 'left'), a = s.hardware.screws.find((x) => x.level === 'T8' && x.side === 'left').head, b = s.hardware.screws.find((x) => x.level === 'T10' && x.side === 'left').head;
  const straight = rod().points.map((p) => [...p]), want = [(a[0] + b[0]) / 2 + 9, (a[1] + b[1]) / 2 + 6, (a[2] + b[2]) / 2];
  // a bend that asks too much of the rod is taken only as far as a rod could go
  const corner = (p) => { const u = p.map((v, j) => v - a[j]), w = b.map((v, j) => v - p[j]); return (Math.acos((u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / Math.hypot(...u) / Math.hypot(...w)) * 180) / Math.PI; };
  const wild = [(a[0] + b[0]) / 2 + 40, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  assert.equal(bendRod(s, rod(), wild), 0);
  assert.ok(corner(rod().via[0]) <= ROD_RULES.bend + 0.5 && corner(rod().via[0]) > ROD_RULES.bend - 6 && rod().via[0][0] > (a[0] + b[0]) / 2 + 4 && offLine(rod().via[0], rod().points) < 0.8, 'corner ' + corner(rod().via[0]).toFixed(1));
  assert.ok(strainAt(s, s.hardware.screws.find((x) => x.level === 'T8' && x.side === 'left')).corner <= ROD_RULES.sharpest + 0.5);
  unbendRod(s, rod());
  // with the rule off the rod goes exactly where it is asked to
  const n = bendRod(s, rod(), want, -1, false);
  assert.ok(n === 0 && rod().via.length === 1 && offLine(want, rod().points) < 0.8 && offLine(a, rod().points) < 0.8 && offLine(b, rod().points) < 0.8, 'the rod misses the bend by ' + offLine(want, rod().points).toFixed(1));
  // moving the bend, and it stays through a redraw of the rods and rides along when the spine is bent
  const moved = want.map((v, j) => v + (j === 0 ? 4 : 0));
  assert.equal(bendRod(s, rod(), moved, 0, false), 0);
  fitRods(s);
  assert.ok(rod().via.length === 1 && offLine(moved, rod().points) < 0.8);
  const rig = rigOf(s), before = toLocal(rod().via[0], at('T9').centre, frameOf(at('T9')));
  carry(s, () => setBow(s, rig, 'T6', 'T12', 0, 25)); fitRods(s);
  const after = toLocal(rod().via[0], at('T9').centre, frameOf(at('T9')));
  assert.ok(after.every((v, j) => Math.abs(v - before[j]) < 0.4) && offLine(rod().via[0], rod().points) < 0.8, 'the bend did not ride along');
  // a bend outside the ends of the rod is dropped, and a rod traced from a scan is not bent
  assert.equal(bendRod(s, rod(), [a[0], a[1], at('T1').centre[2]]), -1);
  unbendRod(s, rod());
  assert.ok(!rod().via);
  const real = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'fusion-t4-l2.spine.json'), 'utf8'));
  assert.equal(bendRod(real, real.hardware.rods[0], real.hardware.rods[0].points[5]), -1);
});
ok('a hook can point down or up', () => {
  const s = copy(average), level = s.levels.find((l) => l.id === 'T5'), f = frameOf(level);
  const reach = (h) => vDot(h.tip.map((v, j) => v - h.at[j]), f.up);
  const down = slot(level, 'left').hook, up = slot(level, 'left', 'up').hook;
  assert.ok(down.faces === 'down' && reach(down) < -9 && up.faces === 'up' && reach(up) > 9 && down.at.every((v, j) => v === up.at[j]));
  const hook = { level: 'T5', side: 'right', ...slot(level, 'right').hook };
  faceHook(s, hook, 'up'); assert.ok(hook.faces === 'up' && reach(hook) > 9);
  faceHook(s, hook, 'down'); assert.ok(hook.faces === 'down' && reach(hook) < -9);
  for (const h of [down, up]) sound(hookMesh(h, [0, 0, 1]), 'hook');
});
ok('colours: a wider choice, sets that go together, and any colour by its code', () => {
  assert.ok(Object.keys(FINISHES).length >= 14);
  for (const set of Object.values(PALETTES)) for (const kind of ['rods', 'screws', 'hooks', 'crosslinks']) assert.ok(FINISHES[set[kind]], 'a set names a colour that does not exist: ' + set[kind]);
  assert.deepEqual(colorOf('#ff8000').map((v) => Math.round(v * 100)), [100, 50, 0]);
  assert.ok(colorOf('gold') === FINISHES.gold && colorOf('nonsense') === null && colorOf('') === null);
  // the file's colour for a kind of part shows, and a piece's own colour wins over it
  const s = copy(average), list = s.levels.map((l) => l.id);
  buildHardware(s, planFor(list, 'T4', 'T8', 'screws'), 1);
  const shown = (group) => buildScene(s, 2, {}).find((it) => it.group === group).color;
  assert.deepEqual(shown('rods'), FINISHES[USUAL_FINISH.rods]);
  s.hardware.colors = { rods: 'red', screws: '#00ff00' };
  assert.deepEqual(shown('rods'), FINISHES.red); assert.deepEqual(shown('screws'), [0, 1, 0]);
  s.hardware.screws[0].color = 'pink';
  assert.deepEqual(shown('screws'), FINISHES.pink);
  s.hardware.colors = { rods: 'no such colour' };
  assert.equal(validateSpine(s).length, 1);
  // one vertebra can have a colour of its own: it shows on that vertebra only, and a colour the app does not know is reported
  delete s.hardware.colors;
  const bone = (id) => buildScene(s, 2, { look: { bone: [0.5, 0.4, 0.3] } }).find((it) => it.group === 'vertebrae' && it.name === id).color;
  s.levels.find((l) => l.id === 'T6').color = 'red';
  assert.deepEqual(bone('T6'), FINISHES.red); assert.deepEqual(bone('T7'), [0.5, 0.4, 0.3]);
  assert.equal(validateSpine(s).length, 0);
  s.levels.find((l) => l.id === 'T6').color = '#0000ff'; assert.deepEqual(bone('T6'), [0, 0, 1]); assert.equal(validateSpine(s).length, 0);
  s.levels.find((l) => l.id === 'T6').color = 'no such colour'; assert.equal(validateSpine(s).length, 1);
});
ok('a cross-link has clamps and a bar that arches away from the spine', () => {
  const link = { from: [-20, 30, 100], to: [22, 31, 101] }, mesh = crosslinkMesh(link, [0, 0.1, 1], [0, 0.1, 1], [0, 1, 0]);
  sound(mesh, 'cross-link');
  let back = -Infinity, front = Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) { back = Math.max(back, mesh.positions[i + 1]); front = Math.min(front, mesh.positions[i + 1]); }
  assert.ok(back > 38 && front > 23, 'it reaches from ' + front.toFixed(1) + ' to ' + back.toFixed(1) + ' front to back');
  sound(crosslinkMesh({ from: [-8, 0, 0], to: [8, 0, 0] }), 'short cross-link');
});
ok('turning one vertebra can take everything above it along', () => {
  const s = copy(average), rig = rigOf(s), at = (id) => s.levels.find((l) => l.id === id);
  setBow(s, rig, 'T5', 'T11', 0, 20);
  const inner = () => at('T5').tilt[0] - at('T10').tilt[0], i0 = inner(), below = JSON.stringify(s.levels.filter((l) => ['L4', 'L5', 'S1'].includes(l.id))), top = [...at('C2').centre], t0 = at('T8').tilt[0];
  pivotAt(s, rig, 'L3', (l) => { l.tilt[0] += 12; });
  assert.ok(Math.abs(at('L3').tilt[0] - 12) < 0.3 && Math.abs(at('T8').tilt[0] - t0 - 12) < 1.2 && Math.abs(inner() - i0) < 0.6, 'T8 went from ' + t0 + ' to ' + at('T8').tilt[0]);
  assert.equal(JSON.stringify(s.levels.filter((l) => ['L4', 'L5', 'S1'].includes(l.id))), below);
  assert.ok(at('C2').centre[0] - top[0] > 60, 'the top moved ' + (at('C2').centre[0] - top[0]).toFixed(0) + ' mm');
  // a turn about its own axis turns the fronts of everything above the same way
  const face = at('T3').turn;
  pivotAt(s, rig, 'L3', (l) => { l.turn += 15; });
  assert.ok(Math.abs(at('T3').turn - face) > 8);
});
ok('the spine takes the shape of a line drawn over it', () => {
  const s = copy(average), rig = rigOf(s), at = (id) => s.levels.find((l) => l.id === id);
  // an S drawn from just above the pelvis to the top of the chest, as seen from the back
  const z0 = at('L5').centre[2] - 10, z1 = at('T2').centre[2], want = (z) => 26 * Math.sin((2 * Math.PI * (z - z0)) / (z1 - z0)), line = [];
  for (let z = z1; z >= z0; z -= 3) line.push([want(z) + (Math.round(z) % 2 ? 0.8 : -0.8), z]);      // drawn from the top down, a little shaky
  assert.equal(followLine(s, rig, 0, line), true);
  for (const l of s.levels) {
    if (l.centre[2] < z0 + 15 || l.centre[2] > z1 - 15) continue;
    assert.ok(Math.abs(l.centre[0] - want(l.centre[2])) < 7, l.id + ' sits ' + (l.centre[0] - want(l.centre[2])).toFixed(1) + ' mm off the line');
  }
  assert.ok(at('S1').tilt[0] === 0 && Math.abs(at('T9').centre[0]) > 12);
  // the vertebrae lean the way the line runs, each a little more or less than the last: no leaning to and fro
  const leans = s.levels.filter((l) => l.centre[2] > z0 + 25 && l.centre[2] < z1 - 25).map((l) => l.tilt[0]);
  for (let i = 1; i < leans.length; i++) assert.ok(Math.abs(leans[i] - leans[i - 1]) < 12, 'two neighbours lean ' + leans[i - 1] + ' and ' + leans[i]);
  // from the side, and a line too short to mean anything
  assert.equal(followLine(s, rig, 1, [[20, z0], [60, z0 + 150], [40, z1]]), true);
  assert.equal(followLine(s, rig, 0, [[0, 100], [3, 110]]), false);
  // a stiff fused part keeps its shape while the rest follows the line
  const f = copy(average); f.fused = [['T6', 'T12']];
  const stiff = rigOf(f, true), a6 = () => f.levels.find((l) => l.id === 'T6'), a12 = () => f.levels.find((l) => l.id === 'T12'), span = () => Math.hypot(...a6().centre.map((v, j) => v - a12().centre[j])), kept = span();
  followLine(f, stiff, 0, line);
  // (the block is turned as a whole, so seen from the front its two ends still lean alike, give or take the roundness of the chest)
  assert.ok(Math.abs(span() - kept) < 0.4 && Math.abs(a6().tilt[0] - a12().tilt[0]) < 2 && Math.abs(f.levels.find((l) => l.id === 'L3').centre[0]) > 12, 'span ' + kept.toFixed(1) + ' to ' + span().toFixed(1) + ', leans ' + a6().tilt[0] + ' and ' + a12().tilt[0] + ', L3 ' + f.levels.find((l) => l.id === 'L3').tilt[0]);
  // the block is laid on the line like a ruler: both its ends are near the line, and so is the free spine above it
  for (const id of ['L1', 'T5', 'T4', 'T3']) { const l = f.levels.find((x) => x.id === id); assert.ok(Math.abs(l.centre[0] - want(l.centre[2])) < 8, id + ' sits ' + (l.centre[0] - want(l.centre[2])).toFixed(1) + ' mm off the line'); }
  // a wild zigzag still gives a spine: no vertebra leans more against the one below than a joint could
  const w = copy(average), wild = [];
  for (let z = z0; z <= z1; z += 3) wild.push([(Math.floor((z - z0) / 45) % 2 ? 40 : -40), z]);
  followLine(w, rigOf(w), 0, wild);
  const order = w.levels.map((l) => l.tilt[0]);
  for (let i = 1; i < order.length; i++) assert.ok(Math.abs(order[i] - order[i - 1]) <= JOINT_MOST[0] + 0.01, 'a joint bends ' + (order[i] - order[i - 1]).toFixed(1));
  assert.ok(Math.max(...order.map(Math.abs)) > 10);
});
ok('locked vertebrae stay put while a line is drawn, and a block can be slid with its neighbours', () => {
  const s = copy(average), rig = rigOf(s), at = (t, id) => t.levels.find((l) => l.id === id), before = copy(s);
  const z0 = at(s, 'L5').centre[2] - 10, z1 = at(s, 'T1').centre[2], line = [];
  for (let z = z0; z <= z1; z += 3) line.push([30 * Math.sin((Math.PI * (z - z0)) / (z1 - z0)), z]);
  // everything outside T5 to L2 is locked: only that part takes the curve, the rest does not move sideways or lean
  const held = s.levels.map((l) => l.id).filter((id) => LEVEL_ORDER.indexOf(id) < LEVEL_ORDER.indexOf('T5') || LEVEL_ORDER.indexOf(id) > LEVEL_ORDER.indexOf('L2'));
  assert.equal(followLine(s, rig, 0, line, { held }), true);
  for (const id of held) assert.ok(Math.abs(at(s, id).centre[0] - at(before, id).centre[0]) < 0.8 && at(s, id).tilt[0] === at(before, id).tilt[0], id + ' moved by ' + (at(s, id).centre[0] - at(before, id).centre[0]).toFixed(2));
  assert.ok(Math.abs(at(s, 'T10').centre[0]) > 6, 'the free part did not bend: T10 at ' + at(s, 'T10').centre[0]);
  // a second line over the whole spine with that part locked leaves the part as it is
  const part = ['T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'], shape = part.map((id) => at(s, id).tilt[0] - at(s, 'T12').tilt[0]);
  followLine(s, rig, 0, line.map(([x, z]) => [-x, z]), { held: part });
  part.forEach((id, k) => assert.ok(Math.abs(at(s, id).tilt[0] - at(s, 'T12').tilt[0] - shape[k]) < 0.01, id + ' changed its lean'));
  // the line a spine runs along gives the same spine back: following it changes nothing
  const t = copy(s), same = rigOf(t);
  followLine(t, same, 0, lineOf(t, same, 0), { smooth: 0 });
  for (const l of t.levels) assert.ok(Math.abs(l.tilt[0] - at(s, l.id).tilt[0]) < 0.6 && Math.abs(l.centre[0] - at(s, l.id).centre[0]) < 0.8, l.id + ' drifted by ' + (l.tilt[0] - at(s, l.id).tilt[0]).toFixed(2) + ' degrees');
  // sliding one block: it moves by about what was asked, its neighbours less, and far away nothing moves
  const u = copy(average), r2 = rigOf(u), was = copy(u);
  assert.equal(slideLevel(u, r2, 0, 'T8', 12), true);
  const moved = (id) => at(u, id).centre[0] - at(was, id).centre[0];
  assert.ok(Math.abs(moved('T8') - 12) < 2.5 && moved('T6') > 3 && moved('T6') < moved('T8') && Math.abs(moved('T2')) < 0.8 && Math.abs(moved('L3')) < 0.8 && Math.abs(moved('C3')) < 0.8, ['T8', 'T6', 'T2', 'L3', 'C3'].map((id) => id + ' ' + moved(id).toFixed(1)).join(', '));
  // front to back works the same way, and a locked neighbour holds its ground
  assert.equal(slideLevel(u, r2, 1, 'L3', -8, ['L1']), true);
  // (with L1 locked two levels up, L3 can only go part of the way)
  const back = at(u, 'L3').centre[1] - at(was, 'L3').centre[1];
  assert.ok(back < -2 && back > -8 && Math.abs(at(u, 'L1').centre[1] - at(was, 'L1').centre[1]) < 0.8 && Math.abs(at(u, 'T10').centre[1] - at(was, 'T10').centre[1]) < 0.8, 'L3 went ' + back.toFixed(1));
  assert.equal(slideLevel(u, r2, 0, 'S1', 5), false); assert.equal(slideLevel(u, r2, 0, 'T8', 5, ['T8']), false);
});
ok('the sheet: cells, separate fusions, cross-links in gaps and rods that end part way', () => {
  const s = copy(average), hw = () => s.hardware;
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T4', 'T5', 'T6', 'T10', 'T11', 'T12']) for (const side of ['left', 'right']) setCell(s, id, side, id === 'T4' ? 'hook' : 'screw');
  // (two groups of parts with three bare vertebrae between them are two fusions, each with its own rods)
  assert.deepEqual([hw().screws.length, hw().hooks.length, hw().rods.length, cellOf(s, 'T4', 'left'), cellOf(s, 'T5', 'right'), cellOf(s, 'T7', 'left'), rodsEndBelow(s, 'T6')], [10, 2, 4, 'hook', 'screw', '', true]);
  setRodsEndBelow(s, 'T6', false);
  assert.deepEqual([hw().rods.length, rodsEndBelow(s, 'T6')], [2, false]);
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
ok('a hook sits on the lamina, on the bone, at every level of the chest and the lower back', () => {
  const s = copy(average);
  for (const l of s.levels.filter((x) => /^[TL]/.test(x.id))) for (const side of ['left', 'right']) for (const faces of ['down', 'up']) {
    const spot = slot(l, side, faces), f = levelFrame(l), local = (p) => toLocal(p, l.centre, f), head = local(spot.hook.at), heel = local(spot.hook.mid), toe = local(spot.hook.tip), name = l.id + ' ' + side + ' ' + faces;
    // no further out than the lamina is wide, also where the screws go in far out to the side
    assert.ok(Math.abs(head[0]) <= 13.5 && Math.sign(head[0]) === (side === 'left' ? 1 : -1), name + ' is ' + head[0].toFixed(1) + ' mm out');
    const above = (p) => p[1] - boneSurface(l.id, l.size, p[0], p[2]);
    assert.ok(above(head) > 7.5 && above(head) < 9.7, name + ': the head is ' + above(head).toFixed(1) + ' mm off the bone');
    // the heel rests on the bone and the toe points the way the hook faces
    assert.ok(above(heel) > 0 && above(heel) < 3, name + ': the heel is ' + above(heel).toFixed(1) + ' mm off the bone');
    assert.ok((toe[2] - head[2]) * (faces === 'up' ? 1 : -1) > 9, name + ' points the wrong way');
    if (!(l.id === 'L5' && faces === 'up')) assert.ok(above(toe) < 1.5 && above(toe) > -4, name + ': the toe is ' + above(toe).toFixed(1) + ' mm off the bone');
  }
  // in the lower back a screw goes in well out to the side, a hook does not
  const l2 = s.levels.find((l) => l.id === 'L2'), far = toLocal(slot(l2, 'left').screw.head, l2.centre, levelFrame(l2))[0];
  assert.ok(far > 20, 'the L2 screw head is ' + far.toFixed(1) + ' mm out');
  // with the drawn bones there is no surface to look for: the hook sits where a screw head would
  setBoneStyle('drawn');
  assert.deepEqual(slot(l2, 'left').hook.at, slot(l2, 'left').screw.head);
  setBoneStyle('real');
});
ok('a cross-link goes where rods run across the gap on both sides, in the middle of the gap', () => {
  const s = copy(average), hw = () => s.hardware, zOf = (id, side) => hw().screws.find((p) => p.level === id && p.side === side).head[2];
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T5', 'T6', 'T7', 'T9']) for (const side of ['left', 'right']) setCell(s, id, side, 'screw');
  // above the top screws and below the bottom ones no rod runs across the gap
  assert.deepEqual(['T4', 'T5', 'T6', 'T7', 'T8', 'T9'].map((id) => linkFits(s, id)), [false, true, true, true, true, false]);
  const link = linkSpot(s, 'T5'), mid = (zOf('T5', 'left') + zOf('T5', 'right') + zOf('T6', 'left') + zOf('T6', 'right')) / 4;
  assert.ok(Math.abs((link.from[2] + link.to[2]) / 2 - mid) < 0.6 && Math.abs(link.from[2] - zOf('T5', 'right')) > 7 && Math.abs(link.from[2] - zOf('T6', 'right')) > 7, 'the cross-link is not in the middle of the gap');
  // a rod on one side only is not enough
  setCell(s, 'T5', 'left', ''); 
  assert.equal(linkFits(s, 'T5'), false); assert.equal(setLinkBelow(s, 'T5', true), false);
  setCell(s, 'T5', 'left', 'screw');
  // a cross-link keeps its own colour and stays frozen when the rods are fitted again
  assert.ok(setLinkBelow(s, 'T6', true));
  hw().crosslinks[0].color = 'red'; hw().crosslinks[0].locked = true;
  setCell(s, 'T10', 'left', 'screw');
  assert.deepEqual([hw().crosslinks.length, hw().crosslinks[0].color, hw().crosslinks[0].locked, hw().crosslinks[0].below], [1, 'red', true, 'T6']);
  // a frozen one is not taken off, and is not doubled
  assert.equal(setLinkBelow(s, 'T6', false), false); assert.equal(setLinkBelow(s, 'T6', true), true); assert.equal(hw().crosslinks.length, 1);
  delete hw().crosslinks[0].locked;
  // one that was placed by hand or traced has no gap written on it: it is found by its height
  delete hw().crosslinks[0].below; delete hw().crosslinks[0].auto;
  assert.deepEqual(['T5', 'T6', 'T7'].map((id) => linkBelow(s, id)), [false, true, false]);
  assert.equal(setLinkBelow(s, 'T6', false), true); assert.equal(hw().crosslinks.length, 0);
  // the traced cross-links of the real example can be taken off the same way
  const real = copy(spine), ids = sortedLevels(real).map((l) => l.id), there = ids.filter((id) => linkBelow(real, id));
  assert.equal(there.length, real.hardware.crosslinks.length);
  for (const id of there) setLinkBelow(real, id, false);
  assert.equal(real.hardware.crosslinks.length, 0);
});
ok('every preset is sound: its parts sit where they should and it is what its words say', () => {
  const list = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'index.json'), 'utf8')), open = (file) => JSON.parse(fs.readFileSync(path.join(root, 'examples', file), 'utf8'));
  assert.equal(list.length, 16);
  for (const e of list) {
    const s = open(e.file), hw = s.hardware || {}, parts = [...(hw.screws || []), ...(hw.hooks || [])];
    assert.deepEqual(validateSpine(s), [], e.file);
    assert.ok(e.name && e.about && e.group && s.about === e.about, e.file + ': the list and the file say different things');
    if (e.file === 'fusion-t4-l2.spine.json') continue;                 // the real one is as it was traced
    for (const c of hw.crosslinks || []) {
      // in a gap, and clear of the heads of the screws and hooks next to it
      const near = Math.min(...parts.map((p) => Math.abs((p.head || p.at)[2] - (c.from[2] + c.to[2]) / 2)));
      assert.ok(c.below && near > 7, e.file + ': a cross-link sits ' + near.toFixed(1) + ' mm from a screw head');
    }
    for (const h of hw.hooks || []) { const l = s.levels.find((x) => x.id === h.level), x = toLocal(h.at, l.centre, levelFrame(l))[0]; assert.ok(Math.abs(x) <= 13.5, e.file + ': the hook on ' + h.level + ' is ' + x.toFixed(1) + ' mm out'); }
    // every part is on a rod, and the rods keep to the rules of thumb
    for (const p of parts) { assert.ok((hw.rods || []).some((r) => r.id === p.rod), e.file + ': a part on ' + p.level + ' has no rod'); const strain = strainAt(s, p); assert.ok(!strain || strain.corner <= ROD_RULES.sharpest + 0.01, e.file + ': the rod turns ' + (strain && strain.corner.toFixed(0)) + '° at ' + p.level); }
  }
  // no made-up preset bends sideways more sharply between two neighbours than a drawn line is allowed to bend the spine
  for (const e of list) {
    if (e.file === 'fusion-t4-l2.spine.json') continue;
    const levels = sortedLevels(open(e.file));
    for (let i = 1; i < levels.length; i++) { const bend = Math.abs(levels[i].tilt[0] - levels[i - 1].tilt[0]); assert.ok(bend <= JOINT_MOST[0] + 0.5, e.file + ': ' + levels[i - 1].id + ' and ' + levels[i].id + ' lean ' + bend.toFixed(0) + '° apart'); }
  }
  const curvesOf = (file) => measureSpine(open(file)).curves, top = (file) => curvesOf(file)[0].degrees;
  // the preset with two curves in the chest is not a twin of the one with one curve
  assert.ok(top('curve-two-chest.spine.json') >= 36 && top('curve-chest-45.spine.json') <= 28 && curvesOf('curve-two-chest.spine.json')[1].degrees === 55);
  assert.deepEqual([open('fusion-one-rod.spine.json').hardware.rods.length, open('fusion-one-rod.spine.json').hardware.hooks.length], [1, 2]);
});
ok('several screws and hooks move along the spine together, with their rods, cross-links and rod ends', () => {
  const s = copy(average), hw = () => s.hardware, where = () => [...hw().screws, ...hw().hooks].map((p) => p.level + p.side[0]).sort().join(' ');
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T4', 'T5', 'T6']) for (const side of ['left', 'right']) setCell(s, id, side, id === 'T4' ? 'hook' : 'screw', 'up');
  for (const id of ['L1', 'L2']) for (const side of ['left', 'right']) setCell(s, id, side, 'screw');
  assert.ok(setLinkBelow(s, 'T5', true));
  assert.equal(hw().rods.length, 4);
  const upper = [...hw().screws, ...hw().hooks].filter((p) => /^T/.test(p.level));
  // two vertebrae down: every part to the usual spot of its new vertebra, hooks still pointing up
  assert.equal(shiftParts(s, upper, 2), true);
  assert.equal(where(), 'L1l L1r L2l L2r T6l T6r T7l T7r T8l T8r');
  assert.deepEqual(hw().hooks.map((h) => h.level + h.faces).sort(), ['T6up', 'T6up']);
  const t8 = s.levels.find((l) => l.id === 'T8'), sc = hw().screws.find((p) => p.level === 'T8' && p.side === 'left');
  assert.deepEqual(sc.head, slot(t8, 'left').screw.head);
  // the cross-link went along, and the two fusions still have their own rods (the break moved with the parts)
  assert.deepEqual([hw().crosslinks.length, hw().crosslinks[0].below, hw().rods.length], [1, 'T7', 4]);
  assert.deepEqual(gapsOf(s, 'left').map((g) => g.upper + (g.cut ? '|' : '-') + g.lower), ['T6-T7', 'T7-T8', 'T8|L1', 'L1-L2']);
  // no room: the lower fusion is in the way, or the spine ends. Then nothing moves at all.
  const was = JSON.stringify(s);
  assert.equal(shiftParts(s, upper, 5), false); assert.equal(shiftParts(s, upper, -30), false); assert.equal(shiftParts(s, upper, 0), false);
  assert.equal(JSON.stringify(s), was);
  // a frozen part holds the whole group
  upper[0].locked = true;
  assert.equal(shiftParts(s, upper, -1), false);
  delete upper[0].locked;
  // back up again, and everything is where it started
  assert.equal(shiftParts(s, upper, -2), true);
  assert.equal(where(), 'L1l L1r L2l L2r T4l T4r T5l T5r T6l T6r');
  assert.deepEqual([hw().crosslinks[0].below, hw().rods.length], ['T5', 4]);
  assert.deepEqual(validateSpine(s), []);
});
// (the checks below wait for an answer, so they are run one after the other at the end)
const later = [];
later.push(['a spine goes into a link and comes out the same, and a damaged link is refused', async () => {
  for (const name of ['average', 'fusion-rods-t4-l4', 'fusion-t4-l2']) {
    const s = JSON.parse(fs.readFileSync(path.join(root, 'examples', name + '.spine.json'), 'utf8')), packed = await packSpine(s);
    const link = linkFor('https://example.org/spine/index.html#spine=old', packed);
    assert.ok(link.startsWith('https://example.org/spine/index.html#spine=z') && link.length < 5000, name + ' makes a link of ' + link.length + ' characters');
    assert.deepEqual(await unpackSpine(packedIn(new URL(link).hash)), s);
  }
  assert.equal(packedIn('#other'), null); assert.equal(packedIn(''), null); assert.equal(packedIn('#spine=a b'), null);
  const good = await packSpine(average);
  for (const bad of ['z', 'zAAAA', 'j!!!', 'q' + good.slice(1), good.slice(0, 200)]) await assert.rejects(unpackSpine(bad), 'a damaged link opened: ' + bad.slice(0, 12));
  // a link that would unpack to something huge is stopped
  const huge = { schema: 1, levels: [], pad: 'x'.repeat(3e6) };
  await assert.rejects(unpackSpine(await packSpine(huge)));
}]);
ok('the model is written as an STL file: every face, to scale, pointing outward', () => {
  const read = (bytes) => {
    const v = new DataView(bytes.buffer), n = v.getUint32(80, true), tris = [];
    assert.equal(bytes.length, 84 + 50 * n);
    for (let i = 0; i < n; i++) tris.push(Array.from({ length: 12 }, (x, j) => v.getFloat32(84 + 50 * i + 4 * j, true)));
    return tris;
  };
  const volume = (tris) => tris.reduce((s, t) => s + (t[3] * (t[7] * t[11] - t[8] * t[10]) - t[4] * (t[6] * t[11] - t[8] * t[9]) + t[5] * (t[6] * t[10] - t[7] * t[9])) / 6, 0);
  const round = ball([0, 0, 0], 10), inside = { positions: round.positions, indices: round.indices.map((x, i, all) => all[i - (i % 3) + [0, 2, 1][i % 3]]) };
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
  const bytes = stlOf([{ mesh: round }, { mesh: inside, matrix: shift }], 0.5, 'Spine Builder test'), tris = read(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 18)), 'Spine Builder test');
  assert.ok(tris.length <= (2 * round.indices.length) / 3 && tris.length > (1.6 * round.indices.length) / 3 && tris.length % 2 === 0, tris.length + ' faces');
  // two balls of 5 mm radius, the second one 50 mm along, both counted as solid (not as a hole)
  assert.ok(volume(tris) > 950 && volume(tris) < 1050, 'volume ' + volume(tris).toFixed(0));
  assert.ok(Math.abs(Math.max(...tris.map((t) => Math.max(t[3], t[6], t[9]))) - 55) < 0.2 && tris.every((t) => Math.abs(Math.hypot(t[0], t[1], t[2]) - 1) < 1e-3));
  // the whole example: every shape the scene draws, with the vertebrae placed by their matrices
  const whole = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'fusion-t4-l2.spine.json'), 'utf8'));
  const parts = buildScene(whole, 1.8, {}).filter((it) => ['vertebrae', 'discs', 'rods', 'screws', 'hooks', 'crosslinks'].includes(it.group));
  const all = read(stlOf(parts, 1)), zs = all.flatMap((t) => [t[5], t[8], t[11]]), low = zs.reduce((a, b) => Math.min(a, b)), high = zs.reduce((a, b) => Math.max(a, b));
  assert.ok(all.length > 60000 && high - low > 450 && high - low < 700 && volume(all) > 300000, all.length + ' faces, ' + (high - low).toFixed(0) + ' mm tall, ' + (volume(all) / 1000).toFixed(0) + ' cm3');
});
// ---- tracing over a picture of an X-ray
const openExample = (name) => JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
// The spots a person would mark on a picture of this spine: the middles of some of its vertebrae, as pixels of a picture that lies at "place".
const marksOn = (target, place, size, ids) => ids.map((id) => { const l = target.levels.find((x) => x.id === id), axis = place.plane === 0 ? 0 : 1; return pictureOf(place, size, [l.centre[axis], l.centre[2]]); });
ok('a picture keeps its place on the sheet: there and back, flipped and turned, and held by one spot while it is resized', () => {
  const size = [800, 1400];
  for (const place of [{ plane: 0, at: [12, 300], k: 0.4, turn: 0, flip: false }, { plane: 0, at: [-30, 280], k: 0.55, turn: 7, flip: true }, { plane: 1, at: [5, 310], k: 0.3, turn: -12, flip: false }]) {
    for (const px of [[0, 0], [800, 0], [400, 700], [123, 1311]]) { const back = pictureOf(place, size, sheetOf(place, size, px)); assert.ok(Math.abs(back[0] - px[0]) < 1e-6 && Math.abs(back[1] - px[1]) < 1e-6); }
    // the middle of the picture is where the place says, and going down the picture goes down the sheet
    assert.deepEqual(sheetOf(place, size, [400, 700]).map((v) => Math.round(v * 1e6) / 1e6), place.at);
    if (!place.turn) assert.ok(sheetOf(place, size, [400, 1400])[1] < sheetOf(place, size, [400, 0])[1]);
    const held = [200, 1000], was = sheetOf(place, size, held), next = placeAbout(place, size, held, { k: place.k * 1.7, turn: place.turn + 9 }), now = sheetOf(next, size, held);
    assert.ok(Math.abs(now[0] - was[0]) < 1e-9 && Math.abs(now[1] - was[1]) < 1e-9 && next.k === place.k * 1.7);
  }
  // seen from the back the person's left is on the left of the picture, unless it is flipped
  const plain = { plane: 0, at: [0, 300], k: 0.5, turn: 0, flip: false };
  assert.ok(sheetOf(plain, size, [0, 700])[0] > 0 && sheetOf({ ...plain, flip: true }, size, [0, 700])[0] < 0);
  // seen from the side the back of the person is on the right
  assert.ok(sheetOf({ ...plain, plane: 1 }, size, [800, 700])[0] > 0);
  // a new picture stands upright over the whole spine
  const s = openExample('average.spine.json'), first = firstPlace(s, 0, size), corners = cornersOf(first, size, depthOf(s, 0));
  assert.ok(corners[0][2] > 605 && corners[2][2] < 0 && Math.abs(corners[0][1] - depthOf(s, 0)) < 1e-9 && first.turn === 0 && !first.flip);
});
ok('a trace over a picture fits the spine to it and finds the size of the picture', () => {
  const size = [900, 1500], ids = ['L5', 'L3', 'L1', 'T11', 'T9', 'T7', 'T5', 'T3', 'T1'];
  for (const [file, plane] of [['curve-chest-45.spine.json', 0], ['curve-double.spine.json', 0], ['round-back.spine.json', 1]]) {
    const target = openExample(file), s = openExample('average.spine.json'), rig = rigOf(s);
    // the picture as it really lies over the target, which the fit is not told: its size, its place and that it is flipped
    const real = { plane, at: [14, 270], k: 0.43, turn: 0, flip: plane === 0 };
    const points = marksOn(target, real, size, ids);
    const start = { ...firstPlace(s, plane, size), flip: real.flip };
    const fit = fitTrace(s, rig, start, size, points, 'T1', 'L5');
    assert.ok(fit, file + ' was not fitted');
    assert.ok(Math.abs(fit.place.k - real.k) < real.k * 0.04, file + ': one pixel came out as ' + fit.place.k.toFixed(3) + ' mm, not ' + real.k);
    assert.ok(fit.miss < 6, file + ': the top of the trace ends ' + fit.miss + ' mm from T1');
    const axis = plane === 0 ? 0 : 1, base = (x) => x.levels.find((l) => l.id === 'L5').centre;
    let worst = 0;
    for (const id of LEVEL_ORDER.slice(LEVEL_ORDER.indexOf('T1'), LEVEL_ORDER.indexOf('L5') + 1)) {
      const a = s.levels.find((l) => l.id === id), b = target.levels.find((l) => l.id === id);
      worst = Math.max(worst, Math.abs((a.centre[axis] - base(s)[axis]) - (b.centre[axis] - base(target)[axis])));
    }
    assert.ok(worst < 6, file + ': a vertebra lies ' + worst.toFixed(1) + ' mm off the traced spine');
    // the traced spots lie on the vertebrae they were marked on
    ids.forEach((id, i) => { const at = sheetOf(fit.place, size, points[i]), l = s.levels.find((x) => x.id === id); assert.ok(Math.hypot(at[0] - l.centre[axis], at[1] - l.centre[2]) < 7, file + ': the spot for ' + id + ' is ' + Math.hypot(at[0] - l.centre[axis], at[1] - l.centre[2]).toFixed(1) + ' mm off'); });
    // the other direction was left alone
    const other = plane === 0 ? 1 : 0, plain = openExample('average.spine.json');
    assert.ok(s.levels.every((l, i) => Math.abs(l.tilt[other] - plain.levels[i].tilt[other]) < 1e-9 && l.turn === plain.levels[i].turn));
  }
});
ok('a trace that is too short is refused, locked vertebrae stay put, and a moved picture is followed where it lies', () => {
  const size = [900, 1500], target = openExample('curve-chest-45.spine.json'), real = { plane: 0, at: [0, 270], k: 0.43, turn: 0, flip: false };
  const s = openExample('average.spine.json'), rig = rigOf(s), before = JSON.stringify(s.levels);
  assert.equal(fitTrace(s, rig, real, size, [[400, 700]], 'T1', 'L5'), null);
  assert.equal(fitTrace(s, rig, real, size, [[400, 700], [401, 702]], 'T1', 'L5'), null);
  assert.equal(fitTrace(s, rig, real, size, marksOn(target, real, size, ['L5', 'T10', 'T1']), 'L5', 'T1'), null, 'the ends are the wrong way round');
  assert.equal(JSON.stringify(s.levels), before, 'a trace that was refused changed the spine');
  // the low back is locked: it stays as it was, and the chest takes the curve
  const points = marksOn(target, real, size, ['L5', 'L3', 'L1', 'T11', 'T9', 'T7', 'T5', 'T3', 'T1']), held = ['L1', 'L2', 'L3', 'L4', 'L5', 'S1'], was = held.map((id) => JSON.stringify(s.levels.find((l) => l.id === id)));
  assert.ok(fitTrace(s, rig, real, size, points, 'T1', 'L5', { held }));
  assert.deepEqual(held.map((id) => JSON.stringify(s.levels.find((l) => l.id === id))), was);
  assert.ok(measureSpine(s).curves.length > 0, 'the chest did not take the curve');
  // following the trace where the picture lies: a straight line up the picture straightens the spine again
  const again = openExample('curve-chest-45.spine.json'), rig2 = rigOf(again);
  assert.ok(followTrace(again, rig2, real, size, [[450, 1400], [450, 1000], [450, 600], [450, 100]]));
  assert.ok(Math.max(...again.levels.map((l) => Math.abs(l.tilt[0]))) < 1.5, 'still leaning ' + Math.max(...again.levels.map((l) => Math.abs(l.tilt[0]))).toFixed(1));
  assert.ok(Math.abs(runOf(s, 0, 'T1', 'L5') - runOf(s, 0, 'L5', 'T1')) < 1e-9 && runOf(s, 0, 'T1', 'T1') === 0);
});
ok('a line drawn by hand becomes a few spots, and the picture can be made lighter, harder and see-through where it is dark', () => {
  const stroke = []; for (let i = 0; i <= 200; i++) stroke.push([300 + 40 * Math.sin(i / 30), 1200 - i * 5]);
  const spots = spotsAlong(stroke, 8);
  assert.equal(spots.length, 8);
  assert.deepEqual(spots[0], stroke[0]); assert.ok(Math.hypot(spots[7][0] - stroke[200][0], spots[7][1] - stroke[200][1]) < 1e-6);
  const gaps = spots.slice(1).map((p, i) => Math.hypot(p[0] - spots[i][0], p[1] - spots[i][1]));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 6, 'the spots are not evenly spaced');
  // as it is: every grey is itself and covers fully
  const plain = toneTable(USUAL_TONE);
  assert.ok([0, 60, 128, 255].every((g) => plain.shade[g] === g && plain.cover[g] === 255));
  // lighter, harder, and the other way round
  assert.ok(toneTable({ bright: 40 }).shade[100] > 100 && toneTable({ bright: -40 }).shade[100] < 100);
  const hard = toneTable({ contrast: 60 }), flat = toneTable({ contrast: -60 });
  assert.ok(hard.shade[200] - hard.shade[60] > 140 && flat.shade[200] - flat.shade[60] < 140 && hard.shade[128] === 128);
  assert.ok(toneTable({ invert: true }).shade[0] === 255 && toneTable({ invert: true }).shade[255] === 0);
  // the dark goes see-through up to a level, with a soft edge, and what is light stays
  const cut = toneTable({ cut: 30 });
  assert.ok(cut.cover[0] === 0 && cut.cover[40] === 0 && cut.cover[255] === 255 && cut.cover[76] > 0 && cut.cover[76] < 255);
  for (let g = 1; g < 256; g++) assert.ok(cut.cover[g] >= cut.cover[g - 1]);
  assert.ok(Math.abs(toneTable({ solid: 50 }).cover[200] - 127) <= 1 && toneTable({ solid: 0 }).cover[200] === 0);
  const out = tonePicture(new Uint8Array([0, 128, 255]), new Uint8ClampedArray(12), { cut: 20, solid: 80 });
  assert.deepEqual([...out], [0, 0, 0, 0, 128, 128, 128, 204, 255, 255, 255, 204]);
});
ok('a flat picture is laid onto four spots of the screen, and not when it is seen from its edge', () => {
  const w = 640, h = 900, at = (m, x, y) => { const k = m[3] * x + m[7] * y + m[15]; return [(m[0] * x + m[4] * y + m[12]) / k, (m[1] * x + m[5] * y + m[13]) / k]; };
  for (const quad of [[[10, 20], [330, 20], [330, 470], [10, 470]], [[100, 50], [420, 80], [380, 600], [60, 520]], [[300, 40], [180, 60], [200, 500], [330, 560]]]) {
    const m = quadMatrix(w, h, quad);
    assert.ok(m && m.length === 16);
    [[0, 0], [w, 0], [w, h], [0, h]].forEach((corner, i) => { const p = at(m, corner[0], corner[1]); assert.ok(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) < 1e-6, 'corner ' + i + ' lands on ' + p); });
  }
  assert.equal(quadMatrix(w, h, [[100, 50], [100, 50.5], [100, 600], [100, 600.5]]), null);
  assert.equal(quadMatrix(w, h, [[0, 0], [10, 10], [20, 20], [30, 30]]), null);
});
ok('the website at the top of the repository: the page allows its own scripts and nothing else, and its small files are there', () => {
  const top = root, page = fs.readFileSync(path.join(top, 'index.html'), 'utf8'), headers = fs.readFileSync(path.join(top, '_headers'), 'utf8');
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page);
  assert.ok(policy, 'index.html carries no rule. Run node tools/build.mjs');
  const rule = policy[1].replace(/&amp;/g, '&');
  // every script in the page is named in the rule by its fingerprint, in the page and in the headers file
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  assert.ok(!/<script[^>]+src=/.test(page) && page.indexOf(policy[0]) < page.indexOf('<script>'), 'a script is loaded from a file, or stands before the rule');
  for (const text of scripts) {
    const print = "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";
    assert.ok(rule.includes(print) && headers.includes(print), 'index.html is out of date: a script does not match its fingerprint. Run node tools/build.mjs');
  }
  for (const part of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(rule.includes(part) && headers.includes(part), 'the rule lacks ' + part);
  assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline|script-src[^;]*https?:/.test(rule));
  assert.ok(headers.includes("frame-ancestors 'none'") && headers.includes('X-Content-Type-Options: nosniff') && headers.includes('Referrer-Policy: no-referrer') && !headers.includes('{{'));
  // nothing is loaded from another site, and nothing in the code calls out
  // (a link that only names the site's own address, for search engines, loads nothing)
  assert.deepEqual([...page.matchAll(/<(?:script|link|img|iframe|source|video|audio|object|embed)\b[^>]*\b(?:src|href)="(https?:[^"]+)"/g)].filter((m) => !/^<link rel="canonical"/.test(m[0])).map((m) => m[1]), []);
  assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|document\.cookie/.test(scripts[1]), 'the app code names something that talks to a server or sets a cookie');
  assert.equal((scripts[1].match(/\bfetch\(/g) || []).length, 2, 'only the two fallbacks for running from the source files may call fetch');
  // the opening note and the files a host needs
  for (const words of ['not a medical device', 'no accounts and no tracking', 'Do not show this again on this device']) assert.ok(page.includes(words), 'the opening note lacks: ' + words);
  assert.ok(fs.readFileSync(path.join(top, '404.html'), 'utf8').includes('There is no page here') && fs.readFileSync(path.join(top, 'robots.txt'), 'utf8').includes('Disallow: /src/') && fs.existsSync(path.join(top, 'picture.png')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, /"version":"([^"]+)"/.exec(scripts[0])[1]);
  // the plain pages of the site: each is there, says what it is for, runs no script and loads nothing from another site
  for (const [file, words] of [['privacy.html', 'Nothing you build, open or type'], ['terms.html', 'not a medical device'], ['accessibility.html', 'With a keyboard']]) {
    const text = fs.readFileSync(path.join(top, file), 'utf8');
    assert.ok(text.includes(words) && text.includes('<html lang="en">') && /<h1>/.test(text), file + ' lacks its words, its language or its heading');
    assert.ok(!/<script|<iframe|<img|<form|\bon[a-z]+=/.test(text), file + ' holds a script, a frame, a picture or a form');
    for (const page2 of ['privacy.html', 'terms.html', 'accessibility.html']) assert.ok(text.includes('href="' + page2 + '"'), file + ' does not link to ' + page2);
  }
  assert.ok(fs.readFileSync(path.join(top, 'sitemap.xml'), 'utf8').includes('/privacy.html') && fs.existsSync(path.join(top, 'apple-touch-icon.png')) && fs.readFileSync(path.join(top, '.well-known', 'security.txt'), 'utf8').includes('Contact:'));
  for (const file of ['privacy.html', 'terms.html', 'accessibility.html']) assert.ok(page.includes('data-page="' + file + '"'), 'the app does not link to ' + file);
  // a host that serves the top of the repository must find no folder it would treat as code to run
  assert.ok(!fs.existsSync(path.join(root, 'functions')) && !fs.existsSync(path.join(root, '_worker.js')) && page.startsWith('<!doctype html>\n<!-- Built by tools/build.mjs'));
});
ok('two fusions get rods of their own, and a rod can be cut, joined and drawn on one side', () => {
  const s = copy(average), ids = s.levels.map((l) => l.id), rods = () => s.hardware.rods.map((r) => r.id).sort().join();
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T4', 'T5', 'T6', 'T7', 'L1', 'L2', 'L3', 'L4']) for (const side of ['left', 'right']) setCell(s, id, side, 'screw');
  // as placed, the second group is far from the first, so it has rods of its own
  assert.equal(rods(), 'left,left-2,right,right-2');
  assert.deepEqual(gapsOf(s, 'left').map((g) => g.bare + (g.cut ? 'x' : '')), ['0', '0', '0', '5x', '0', '0', '0']);
  // joined by hand they are one long rod on each side. "Rods through all parts" finds the two fusions again.
  setRodCut(s, 'left', 'T7', 'L1', false); setRodCut(s, 'right', 'T7', 'L1', false);
  assert.equal(rods(), 'left,right');
  assert.equal(rodsThroughAll(s), 2);
  assert.equal(rods(), 'left,left-2,right,right-2');
  assert.deepEqual(rodSets(s), [['T4', 'T7'], ['L1', 'L4']]);
  assert.deepEqual(validateSpine(s), []);
  const reach = (id) => { const z = s.hardware.rods.find((r) => r.id === id).points.map((p) => p[2]); return [Math.max(...z), Math.min(...z)]; }, zOf = (id) => s.levels.find((l) => l.id === id).centre[2];
  assert.ok(reach('left')[1] > zOf('T9') && reach('left-2')[0] < zOf('T11'), 'the two rods of one side overlap');
  assert.equal(splitAtGaps(s), 0);
  // one side is joined again: only that side has a long rod
  setRodCut(s, 'left', 'T7', 'L1', false);
  assert.equal(rods(), 'left,right,right-2');
  // a rod drawn from T5 to T7 on the left is a rod of its own: cut above T5 and below T7
  assert.equal(drawRod(s, 'left', 'T7', 'T5'), true);
  assert.deepEqual(gapsOf(s, 'left').map((g) => (g.cut ? 'x' : '-')).join(''), 'x--x---');
  // (T4 is alone now and holds no rod: the left side has two rods, and neither reaches up to T4)
  const lefts = s.hardware.rods.filter((r) => r.side === 'left');
  assert.ok(lefts.length === 2 && lefts.every((r) => r.points.every((p) => p[2] < zOf('T4') + 2)) && s.hardware.rods.length === 4, rods());
  // a cut for both sides (the table of Full control) and a cut for one side live together
  setRodsEndBelow(s, 'L2', true);
  assert.ok(gapsOf(s, 'right').find((g) => g.upper === 'L2').cut && gapsOf(s, 'left').find((g) => g.upper === 'L2').cut);
  setRodCut(s, 'right', 'L2', 'L3', false);
  assert.ok(!gapsOf(s, 'right').find((g) => g.upper === 'L2').cut && gapsOf(s, 'left').find((g) => g.upper === 'L2').cut && s.hardware.splits.includes('L2:left'));
  assert.deepEqual(validateSpine(s), []);
  s.hardware.splits.push('T9:up'); assert.equal(validateSpine(s).length, 1); s.hardware.splits.pop();
  // one hook at each end of a long rod: nothing is cut, the rod stays whole
  const h = copy(average);
  h.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  setCell(h, 'T4', 'left', 'hook', 'up'); setCell(h, 'L2', 'left', 'hook', 'down');
  // (put on one by one, the far hook stands alone at first: a rod drawn from one to the other joins them)
  assert.equal(h.hardware.rods.length, 0);
  assert.equal(drawRod(h, 'left', 'T4', 'L2'), true); assert.equal(h.hardware.rods.length, 1);
  assert.equal(rodsThroughAll(h), 0); assert.equal(h.hardware.rods.length, 1);
  // new parts: next to a rod they make it longer, far away they start their own, and in a break they join what is near
  const n = copy(average), nr = () => n.hardware.rods.filter((r) => r.side === 'left').length, cuts = () => gapsOf(n, 'left').map((g) => g.upper + (g.cut ? '|' : '-') + g.lower).join(' ');
  n.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  for (const id of ['T4', 'T5']) setCell(n, id, 'left', 'screw');
  setCell(n, 'T7', 'left', 'screw');                                   // one bare vertebra between: the same rod
  assert.equal(cuts(), 'T4-T5 T5-T7');
  setCell(n, 'L3', 'left', 'screw'); setCell(n, 'L4', 'left', 'screw'); // far down: a second fusion
  assert.equal(cuts(), 'T4-T5 T5-T7 T7|L3 L3-L4'); assert.equal(nr(), 2);
  setCell(n, 'T11', 'left', 'screw');                                  // in the break, three bare vertebrae from either: alone
  assert.equal(cuts(), 'T4-T5 T5-T7 T7|T11 T11|L3 L3-L4'); assert.equal(nr(), 2);
  setCell(n, 'T9', 'left', 'screw');                                   // near T7 and near T11: it joins both
  assert.equal(cuts(), 'T4-T5 T5-T7 T7-T9 T9-T11 T11|L3 L3-L4'); assert.equal(nr(), 2);
  setCell(n, 'T6', 'left', 'hook');                                    // a rod already ran past this spot
  assert.equal(cuts(), 'T4-T5 T5-T6 T6-T7 T7-T9 T9-T11 T11|L3 L3-L4');
  setCell(n, 'T6', 'left', 'screw');                                   // a hook swapped for a screw changes no rod
  assert.equal(cuts(), 'T4-T5 T5-T6 T6-T7 T7-T9 T9-T11 T11|L3 L3-L4');
  // no rods at all, then one drawn from part to part
  cutAll(n);
  assert.equal(nr(), 0);
  drawRod(n, 'left', 'T9', 'L3');
  assert.equal(cuts(), 'T4|T5 T5|T6 T6|T7 T7|T9 T9-T11 T11-L3 L3|L4'); assert.equal(nr(), 1);
  // a rod cut at a height: between the two parts around it
  const zMid = (n.levels.find((l) => l.id === 'T12').centre[2] + n.levels.find((l) => l.id === 'L1').centre[2]) / 2;
  assert.deepEqual(cutRodAt(n, 'left', zMid), ['T11', 'L3']); assert.equal(cutRodAt(n, 'left', zMid), null);
  assert.equal(cuts(), 'T4|T5 T5|T6 T6|T7 T7|T9 T9-T11 T11|L3 L3|L4');
  assert.deepEqual(validateSpine(n), []);
  // filling in a second stretch makes it a fusion of its own
  const f = copy(average);
  fitOut(f, 'T4', 'T7', 'screws', 1); fitOut(f, 'L1', 'L4', 'screws', 1);
  assert.deepEqual(rodSets(f), [['T4', 'T7'], ['L1', 'L4']]);
  assert.equal(f.hardware.rods.length, 4); assert.equal(f.hardware.crosslinks.length, 2); assert.deepEqual(f.fused, [['T4', 'T7'], ['L1', 'L4']]);
  // a stretch filled in right next to another one joins it
  fitOut(f, 'T8', 'T10', 'screws', 0);
  assert.deepEqual(rodSets(f), [['T4', 'T10'], ['L1', 'L4']]);
});
ok('a frozen part stays where it is, and the file says so', () => {
  const s = copy(average);
  s.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] };
  assert.equal(setCell(s, 'T6', 'left', 'screw'), true); assert.equal(setCell(s, 'T8', 'left', 'screw'), true);
  s.hardware.screws[0].locked = true;
  // nothing replaces or erases it, and the rest goes on as before
  assert.equal(setCell(s, 'T6', 'left', 'hook', 'up'), false); assert.equal(setCell(s, 'T6', 'left', ''), false);
  assert.ok(s.hardware.screws.some((p) => p.level === 'T6' && p.locked) && s.hardware.hooks.length === 0);
  assert.equal(setCell(s, 'T8', 'left', ''), true);
  assert.deepEqual(validateSpine(s), []);
  s.hardware.screws[0].locked = 'yes';
  assert.ok(validateSpine(s).some((line) => /frozen/.test(line)));
});
ok('hardware put on by hand is drawn as solid as any other', () => {
  const s = copy(average);
  buildHardware(s, planFor(s.levels.map((l) => l.id), 'T4', 'T8', 'screws'), 1);
  for (const kind of ['screws', 'rods', 'crosslinks']) s.hardware[kind][0].source = 'guessed';
  const items = buildScene(s, 2.2, {}).filter((it) => ['screws', 'rods', 'hooks', 'crosslinks'].includes(it.group));
  assert.ok(items.length > 10 && items.every((it) => it.opacity === 1), 'some hardware is see-through');
  // parts selected together are all shown as picked, and every shape carries a name for the files that are saved
  const lit = buildScene(s, 2.2, { picked: { kind: 'screws', index: 0 }, also: [{ kind: 'screws', index: 3 }] }).filter((it) => it.group === 'screws').map((it) => it.color.join());
  assert.equal(lit.filter((c) => c === lit[0]).length, 4);
  assert.ok(buildScene(s, 2.2, {}).filter((it) => it.group !== 'marks').every((it) => typeof it.name === 'string' && it.name.length > 1));
});
ok('a stand for printing: a base with a post the spine plugs onto, or a hanger', () => {
  const s = copy(average), levels = sortedLevels(s), sacrum = levels[levels.length - 1], atlas = levels[0];
  const span = (mesh, j) => { let lo = Infinity, hi = -Infinity; for (let i = j; i < mesh.positions.length; i += 3) { lo = Math.min(lo, mesh.positions[i]); hi = Math.max(hi, mesh.positions[i]); } return [lo, hi]; };
  for (const scale of [1, 1 / 3]) {
    const post = standFor('post', s, scale, 2.2), [base, pole] = post.stand, peg = post.onSpine[0];
    const [pegLow, pegHigh] = span(peg, 2), [poleLow, poleHigh] = span(pole, 2), [baseLow, baseHigh] = span(base, 2), pegWide = (span(peg, 0)[1] - span(peg, 0)[0]) * scale, poleWide = (span(pole, 0)[1] - span(pole, 0)[0]) * scale;
    // the peg starts inside the bone and comes out below it; the post reaches up around the peg and stands in the base
    assert.ok(pegHigh > poleHigh + 5 && pegLow < poleHigh - 10 / scale && poleLow < baseHigh && poleLow > baseLow - 0.01, 'peg ' + pegLow.toFixed(1) + ' to ' + pegHigh.toFixed(1) + ', post ' + poleLow.toFixed(1) + ' to ' + poleHigh.toFixed(1));
    // sizes that matter for a print are the same at every print size: a peg of 6 mm or more and a wall around it
    assert.ok(pegWide >= 5.9 && poleWide - pegWide >= 4.5 && (baseHigh - baseLow) * scale >= 3.9, 'peg ' + pegWide.toFixed(1) + ' mm, post ' + poleWide.toFixed(1) + ' mm');
    // the hole in the post is wider than the peg, and deeper
    const inner = []; for (let i = 0; i < pole.positions.length; i += 3) if (pole.positions[i + 2] < poleHigh - 1) inner.push(Math.hypot(pole.positions[i] - sacrum.centre[0], pole.positions[i + 1] - (span(peg, 1)[0] + span(peg, 1)[1]) / 2));
    const hole = Math.min(...inner.filter((r) => r > 0.01)) * 2 * scale, floor = Math.min(...Array.from({ length: pole.positions.length / 3 }, (_, i) => i).filter((i) => Math.abs(Math.hypot(pole.positions[i * 3] - sacrum.centre[0], pole.positions[i * 3 + 1] - (span(peg, 1)[0] + span(peg, 1)[1]) / 2) * 2 * scale - hole) < 0.01).map((i) => pole.positions[i * 3 + 2]));
    assert.ok(hole > pegWide + 0.4 && hole < pegWide + 1 && floor < pegLow, 'hole ' + hole.toFixed(2) + ' mm for a peg of ' + pegWide.toFixed(2) + ' mm');
    // the base is flat, lies under the lowest bone and reaches under the post
    assert.ok(baseHigh < sacrum.centre[2] - 60 && span(base, 0)[1] - span(base, 0)[0] > 200);
    const hang = standFor('hanger', s, scale, 2.2), ring = hang.onSpine[0], frame = hang.stand[1];
    // the ring sits on the top vertebra, the arm comes from behind the spine, runs through the ring and ends past it
    const middle = (span(ring, 2)[0] + span(ring, 2)[1]) / 2;
    assert.ok(span(ring, 2)[0] < atlas.centre[2] + atlas.size[2] && span(ring, 2)[1] > atlas.centre[2] + 8 && span(frame, 2)[1] > middle && span(frame, 1)[0] < span(ring, 1)[0] && span(frame, 1)[1] > Math.max(...levels.map((l) => l.centre[1])) + 30, 'ring ' + span(ring, 2).map((v) => v.toFixed(1)));
    assert.ok(span(hang.stand[0], 2)[1] < span(sacrum && buildScene(s, 2.2, {}).find((it) => it.name === 'S1').mesh, 2)[0] + sacrum.centre[2] + 40);
  }
  assert.equal(standFor('', s, 1), null); assert.ok(/peg/.test(standFor('post', s, 1, 2.2).says) && /ring/.test(standFor('hanger', s, 1, 2.2).says));
});
ok('a shape is made smoother for a print without changing its size', () => {
  const volume = (m) => { let v = 0; for (let f = 0; f < m.indices.length; f += 3) { const a = m.indices[f] * 3, b = m.indices[f + 1] * 3, c = m.indices[f + 2] * 3, p = m.positions; v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]); } return Math.abs(v) / 6; };
  // every edge of a closed shape is shared by two triangles, before and after
  const closed = (m) => { const count = new Map(), n = m.positions.length / 3; for (let f = 0; f < m.indices.length; f += 3) for (let k = 0; k < 3; k++) { const a = m.indices[f + k], b = m.indices[f + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; count.set(key, (count.get(key) || 0) + 1); } return [...count.values()].every((c) => c === 2); };
  const round = ball([0, 0, 0], 10), once = smoother(round), twice = smoother(once);
  assert.ok(once.indices.length === round.indices.length * 4 && twice.indices.length === round.indices.length * 16 && closed(once) && closed(twice));
  // (rounding off the corners of a coarse ball takes a little off it: a few percent, no more)
  assert.ok(volume(twice) <= volume(round) && volume(twice) > 0.94 * volume(round), 'a ball of ' + volume(round).toFixed(0) + ' mm3 came out as ' + volume(twice).toFixed(0));
  // a real bone: four times the triangles, the same shape to within a few percent, and no corner moves far
  const bone = vertebraShape('T8', average.levels.find((l) => l.id === 'T8').size, 1.4), fine = smoother(bone);
  let far = 0;
  for (let i = 0; i < bone.positions.length; i++) far = Math.max(far, Math.abs(fine.positions[i] - bone.positions[i]));
  assert.ok(fine.indices.length === bone.indices.length * 4 && Math.abs(volume(fine) / volume(bone) - 1) < 0.05 && far < 2.5, 'volume ' + (volume(fine) / volume(bone)).toFixed(3) + ', a corner moved ' + far.toFixed(2) + ' mm');
});
ok('rods that are not on yet are kept out of the picture, and a label rides with its mark', () => {
  const s = copy(average);
  buildHardware(s, planFor(s.levels.map((l) => l.id), 'T4', 'T8', 'screws'), 1);
  assert.ok(buildScene(s, 2.2, {}).some((it) => it.group === 'rods'));
  s.hardware.norods = true;
  const items = buildScene(s, 2.2, {});
  assert.ok(!items.some((it) => it.group === 'rods') && items.some((it) => it.group === 'crosslinks') && items.some((it) => it.group === 'screws'));
  assert.deepEqual(validateSpine(s), []);
  s.hardware.norods = 'no'; assert.ok(validateSpine(s).length === 1); delete s.hardware.norods;
  // a label pulled off its pain point keeps its place beside the vertebra when the spine is bent
  const t8 = () => s.levels.find((l) => l.id === 'T8'), rig = rigOf(s);
  s.marks = [{ kind: 'pain', text: 'Ache', at: [t8().centre[0] + 5, t8().centre[1] + 20, t8().centre[2]], radius: 12, strength: 6, label: [t8().centre[0] + 70, t8().centre[1] + 20, t8().centre[2] + 30] }];
  const before = toLocal(s.marks[0].label, t8().centre, frameOf(t8()));
  carry(s, () => setBow(s, rig, 'T4', 'T12', 0, 35));
  const after = toLocal(s.marks[0].label, t8().centre, frameOf(t8()));
  assert.ok(after.every((v, j) => Math.abs(v - before[j]) < 0.4), 'the label did not ride along');
  assert.deepEqual(validateSpine(s), []);
  s.marks[0].label = [1, 2]; assert.ok(validateSpine(s).some((line) => /label/.test(line)));
  // locked vertebrae are drawn darker while the curve is shaped
  const dark = buildScene(copy(average), 2.2, { locked: ['T6'] }).filter((it) => it.group === 'vertebrae');
  assert.ok(dark.find((it) => it.name === 'T6').color[0] < dark.find((it) => it.name === 'T7').color[0] - 0.1);
});
ok('a ray finds the front of a ball', () => {
  const t = rayMesh([0, -100, 0], [0, 1, 0], ball([0, 0, 0], 10));
  assert.ok(Math.abs(t - 90) < 0.3 && rayMesh([30, -100, 0], [0, 1, 0], ball([0, 0, 0], 10)) === null, 'hit at ' + t);
});
later.push(['files go into a zip that other programs can open, and the model into an OBJ with colours', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const s = copy(average);
  buildHardware(s, planFor(s.levels.map((l) => l.id), 'T4', 'T6', 'screws'), 0);
  const items = buildScene(s, 2.4, {}).filter((it) => it.group !== 'marks'), files = objOf(items, 0.5, 'a note', 'spine.mtl'), lines = files.obj.split('\n');
  const count = (start) => lines.filter((l) => l.startsWith(start)).length, vertices = items.reduce((sum, it) => sum + it.mesh.positions.length / 3, 0), faces = items.reduce((sum, it) => sum + it.mesh.indices.length / 3, 0);
  assert.ok(count('v ') === vertices && count('f ') === faces && count('o ') === items.length && lines[2] === 'mtllib spine.mtl', count('v ') + ' of ' + vertices + ' corners');
  const names = lines.filter((l) => l.startsWith('o ')).map((l) => l.slice(2));
  assert.ok(new Set(names).size === names.length && names.includes('T5') && names.includes('screw_T4_left') && names.includes('screw_T4_left_2') && names.includes('rod_left'));
  // it stands upright for programs that take y as up: the top vertebra has the largest y, at half size
  const top = s.levels[0].centre[2] * 0.5, ys = lines.filter((l) => l.startsWith('v ')).map((l) => Number(l.split(' ')[2]));
  assert.ok(Math.abs(Math.max(...ys) - top) < 25 && files.mtl.split('newmtl').length - 1 >= 3 && /Kd 0\.\d+ 0\.\d+ 0\.\d+/.test(files.mtl));
  // the zip: every file comes out again as it went in
  const big = new TextEncoder().encode(files.obj), small = new Uint8Array([1, 2, 3]), zip = await zipOf([{ name: 'model/spine.obj', bytes: files.obj }, { name: 'tiny.bin', bytes: small }]), view = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  let at = view.getUint32(end + 16, true);
  for (const want of [['model/spine.obj', big], ['tiny.bin', small]]) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true), packed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true), from = view.getUint32(at + 42, true);
    assert.equal(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)), want[0]);
    assert.equal(view.getUint32(from, true), 0x04034b50);
    const body = zip.subarray(from + 30 + view.getUint16(from + 26, true), from + 30 + view.getUint16(from + 26, true) + packed), out = method === 8 ? new Uint8Array(zlib.inflateRawSync(body)) : body;
    assert.ok(size === want[1].length && out.length === size && crc === crc32(want[1]) && out.every((v, i) => v === want[1][i]), want[0] + ' did not come out as it went in');
    at += 46 + nameLength;
  }
  assert.ok(zip.length < big.length / 2, 'the zip is not smaller than the text in it');
}]);
for (const [name, fn] of later) { await fn(); checks++; console.log('ok   ' + name); }
console.log(checks + ' checks passed');
