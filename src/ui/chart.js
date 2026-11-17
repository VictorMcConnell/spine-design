// Three more ways to shape the spine, all flat:
//   - the blocks: every vertebra as a block in a column, seen from the back or from the side.
//     Drag a block sideways and its neighbours follow, tap it to lock it in place,
//   - a line with points: a line over the model that stays. Drag its points and the spine
//     follows, click the line for one more point,
//   - locks: vertebrae that stay where they are while the curve is drawn, the line is moved
//     or the blocks are slid.
// All three end in followLine and slideLevel of core/shape.js.

import { followLine, slideLevel, restack } from '../core/shape.js';
import { pathThrough } from '../core/place.js';
import { LEVEL_ORDER } from '../core/spinefile.js';

// kit: the helpers of build.js that are needed here ($, each, pressed, ids, levelOf, hint, stopOthers, regionIds)
export function setupChart(app, kit) {
  const { $, each, pressed, ids, levelOf, hint } = kit, { renderer } = app;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const held = () => [...app.held].filter((id) => levelOf(id));

  // ---------------------------------------------------------------- locks
  let lockFor = '', picking = false;
  // the locked vertebrae in words: "C1 to T4, L3 to S1"
  function lockWords() {
    const list = ids(), runs = [];
    list.forEach((id, i) => { if (!app.held.has(id)) return; const last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); });
    return runs.map(([a, b]) => (a === b ? list[a] : list[a] + ' to ' + list[b])).join(', ');
  }
  function changed() { app.redraw(); sync(); hint(); }
  $('lockNone').addEventListener('click', () => { app.held = new Set(); changed(); });
  // A whole part of the spine at once (the neck, the chest, the low back): locked, or unlocked if all of it was locked.
  function lockPart(name) {
    const part = kit.regionIds(name), all = part.length > 0 && part.every((id) => app.held.has(id));
    for (const id of part) { if (all) app.held.delete(id); else app.held.add(id); }
    changed();
  }
  each('[data-lockpart]', (b) => b.addEventListener('click', () => lockPart(b.dataset.lockpart)));
  // While this is on, a click on a vertebra of the model locks or unlocks it (the Lock tool).
  function setPicking(on) { picking = on; $('stage').classList.toggle('placing', on); }
  // a click on the model while locks are being picked
  function tapLock(id) { if (app.held.has(id)) app.held.delete(id); else app.held.add(id); changed(); }

  // ---------------------------------------------------------------- the blocks
  const ROW = 22, WIDE = 300, SCALE = 1.5;
  let plane = 0, slide = null;
  each('[data-chart]', (b) => b.addEventListener('click', () => { plane = Number(b.dataset.chart); sync(); }));
  function drawBlocks() {
    const svg = $('blocks');
    if (!$('blocksWrap').offsetParent && svg.childNodes.length) return;      // not on screen: drawn when it is next shown
    const list = ids(), n = list.length, axis = plane === 0 ? 0 : 1, turn = plane === 0 ? -1 : 1, base = levelOf(list[n - 1]).centre[axis];
    const stiff = new Set();
    if (app.stiff) for (const b of app.rig.blocks || []) list.slice(b.from, b.to + 1).forEach((id) => stiff.add(id));
    svg.setAttribute('viewBox', '0 0 ' + WIDE + ' ' + (n * ROW + 30)); svg.textContent = '';
    el('text', { x: 40, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = plane === 0 ? 'Left' : 'Front';
    el('text', { x: WIDE - 40, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = plane === 0 ? 'Right' : 'Back';
    el('line', { x1: WIDE / 2, y1: 22, x2: WIDE / 2, y2: n * ROW + 26, class: 'plumb' }, svg);
    list.forEach((id, i) => {
      const l = levelOf(id), x = Math.max(38, Math.min(WIDE - 38, WIDE / 2 + turn * (l.centre[axis] - base) * SCALE)), y = 24 + i * ROW + ROW / 2, locked = app.held.has(id);
      const g = el('g', { 'data-block': id, class: (locked ? 'locked ' : '') + (stiff.has(id) ? 'stiff ' : '') + (slide && slide.id === id ? 'hot' : ''), transform: 'translate(' + x.toFixed(1) + ' ' + y + ') rotate(' + (turn * l.tilt[plane]).toFixed(1) + ')' }, svg);
      el('rect', { x: -32, y: -8.5, width: 64, height: 17, rx: 5, class: 'bone' }, g);
      el('text', { x: locked ? -6 : 0, y: 4, 'text-anchor': 'middle' }, g).textContent = id;
      if (locked) { el('path', { d: 'M9 -1 v-2.5 a3 3 0 0 1 6 0 v2.5', class: 'shackle' }, g); el('rect', { x: 7.5, y: -1, width: 9, height: 7, rx: 1.5, class: 'padlock' }, g); }
    });
    app.showGlow();
  }
  // pointing at a block shows which bone it is on the model
  $('blocks').addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' || slide) return; const g = e.target.closest ? e.target.closest('[data-block]') : null; app.point(g ? g.dataset.block : null); });
  $('blocks').addEventListener('pointerleave', () => { if (!slide) app.point(null); });
  $('blocks').addEventListener('pointerdown', (e) => {
    const g = e.target.closest ? e.target.closest('[data-block]') : null;
    if (!g || !app.spine) return;
    e.preventDefault(); app.say('');
    // the bone of the pressed block lights up on the model
    app.flash(g.dataset.block, true);
    // (the spine as it is when the drag starts: every step of the drag is worked out from there)
    slide = { id: g.dataset.block, x: e.clientX, moved: false, from: app.spine.levels.map((l) => ({ l, tilt: [l.tilt[0], l.tilt[1]], turn: l.turn })), wide: $('blocks').getBoundingClientRect().width / WIDE };
  });
  window.addEventListener('pointermove', (e) => {
    if (!slide) return;
    const dx = e.clientX - slide.x;
    if (!slide.moved && Math.abs(dx) < 4) return;
    const list = ids();
    if (app.held.has(slide.id)) { app.say(slide.id + ' is locked. Tap it to unlock it.'); return; }
    if (slide.id === list[list.length - 1]) { app.say('The bottom of the spine stays where it is.'); return; }
    slide.moved = true;
    const by = (dx / slide.wide / SCALE) * (plane === 0 ? -1 : 1);
    app.change(() => {
      for (const was of slide.from) { was.l.tilt = [was.tilt[0], was.tilt[1]]; was.l.turn = was.turn; }
      restack(app.spine, app.rig);
      slideLevel(app.spine, app.rig, plane, slide.id, by, held());
    }, { settle: false });
    drawBlocks();
  });
  const letGo = (e) => {
    if (!slide) return;
    const was = slide;
    slide = null;
    if (was.moved) app.settle();
    else if (e.type === 'pointerup') tapLock(was.id);
    else drawBlocks();
  };
  window.addEventListener('pointerup', letGo); window.addEventListener('pointercancel', letGo);

  // ---------------------------------------------------------------- a line with points
  // "line" is null, or { plane, points: [[across, up]] from the bottom up, picked, drag }.
  let line = null;
  const depthOf = (pl) => { const axis = pl === 0 ? 1 : 0, levels = app.spine.levels; return levels.reduce((sum, l) => sum + l.centre[axis], 0) / levels.length; };
  const inSpace = (p) => (line.plane === 0 ? [p[0], line.depth, p[1]] : [line.depth, p[0], p[1]]);
  // the spot under the pointer on the flat sheet the line lies in: [across, up] in mm
  function onSheet(e) {
    const ray = renderer.ray(e.clientX, e.clientY), axis = line.plane === 0 ? 1 : 0, j = line.plane === 0 ? 0 : 1;
    if (Math.abs(ray.direction[axis]) < 0.08) return null;
    const t = (line.depth - ray.origin[axis]) / ray.direction[axis];
    return t > 0 ? [ray.origin[j] + ray.direction[j] * t, ray.origin[2] + ray.direction[2] * t] : null;
  }
  const curve = () => pathThrough(line.points.map((p) => [p[0], 0, p[1]])).map((p) => [p[0], p[2]]);
  function drawLine() {
    if (!line) return;
    const at = (p) => renderer.project(inSpace(p)), path = curve().map(at).filter(Boolean).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    $('anchorPath').setAttribute('points', path); $('anchorHit').setAttribute('points', path);
    const dots = $('anchorDots');
    while (dots.childNodes.length > line.points.length) dots.lastChild.remove();
    line.points.forEach((p, i) => {
      const c = dots.childNodes[i] || el('circle', { r: 11 }, dots), q = at(p);      // (large enough for a finger: 24 px across with its ring)
      c.dataset.point = i; c.setAttribute('class', (i === 0 ? 'base ' : '') + (i === line.picked ? 'picked' : ''));
      c.style.display = q ? '' : 'none';
      if (q) { c.setAttribute('cx', q[0].toFixed(1)); c.setAttribute('cy', q[1].toFixed(1)); }
    });
  }
  app.frames.push(drawLine);
  let lastPlane = 0;
  function startLine(pl = lastPlane) {
    kit.stopOthers(); setPicking(false); lastPlane = pl;
    const list = ids(), n = list.length, axis = pl === 0 ? 0 : 1, points = [];
    // a point on every third vertebra, from the bottom up, and one on the top: close to the shape the spine has now
    for (let i = n - 1; i > 0; i -= 3) { const l = levelOf(list[i]); points.push([l.centre[axis], l.centre[2]]); }
    const top = levelOf(list[0]);
    points.push([top.centre[axis], top.centre[2] + top.size[2] / 2]);
    line = { plane: pl, points, picked: -1, drag: null, depth: depthOf(pl) };
    renderer.look(pl === 0 ? 0 : Math.PI / 2);
    show();
    $('drawSay').textContent = 'Drag a point and the spine follows the line. ' + (kit.touch() ? 'Tap' : 'Click') + ' the line to add a point.';
  }
  function stopLine() { if (!line) return; line = null; show(); $('drawSay').textContent = ''; }
  function show() {
    pressed('[data-points]', 'points', line ? line.plane : 'none');
    $('drawPad').hidden = !line && !kit.drawing();
    $('pointGone').hidden = !line || line.picked < 1 || line.points.length < 3;
    if (!line) { $('anchorPath').setAttribute('points', ''); $('anchorHit').setAttribute('points', ''); $('anchorDots').textContent = ''; }
    drawLine(); hint();
  }
  each('[data-points]', (b) => b.addEventListener('click', () => { const pl = Number(b.dataset.points); if (!line || line.plane !== pl) startLine(pl); }));
  // the spine takes the shape of the line as it is now
  const follow = (settle) => app.change(() => followLine(app.spine, app.rig, line.plane, curve(), { held: held(), smooth: 2 }), { settle });
  function removePoint(i) { if (!line || i < 1 || line.points.length < 3) return; line.points.splice(i, 1); line.picked = -1; follow(true); show(); }
  $('pointGone').addEventListener('click', () => removePoint(line ? line.picked : -1));
  $('anchorDots').addEventListener('dblclick', (e) => { if (e.target.dataset.point !== undefined) removePoint(Number(e.target.dataset.point)); });
  $('drawSvg').addEventListener('pointerdown', (e) => {
    if (!line || !app.spine) return;
    let i = e.target.dataset && e.target.dataset.point !== undefined ? Number(e.target.dataset.point) : -1;
    if (i < 0 && e.target.id === 'anchorHit') {
      // a click on the line: one more point there, and it is held at once
      const p = onSheet(e);
      if (!p) return;
      i = line.points.findIndex((q) => q[1] > p[1]);
      if (i < 1) return;
      line.points.splice(i, 0, p);
    }
    if (i < 0) return;
    e.preventDefault();
    line.picked = i; line.drag = i > 0 ? { i, moved: false } : null;
    app.say(i === 0 ? 'The point at the bottom stays put: the bottom of the spine does not move.' : '');
    show();
  });
  window.addEventListener('pointermove', (e) => {
    if (!line || !line.drag) return;
    const p = onSheet(e), i = line.drag.i, below = line.points[i - 1], above = line.points[i + 1];
    if (!p) return;
    // a point stays between the one below it and the one above it
    line.points[i] = [p[0], Math.max(below[1] + 14, above ? Math.min(above[1] - 14, p[1]) : p[1])];
    line.drag.moved = true;
    follow(false); drawLine();
  });
  const dropPoint = () => { if (line && line.drag) { const moved = line.drag.moved; line.drag = null; if (moved) app.settle(); else follow(true); } };
  window.addEventListener('pointerup', dropPoint); window.addEventListener('pointercancel', dropPoint);

  function sync() {
    const list = ids();
    if (lockFor !== list.join()) {
      // a new spine: its locks are gone, and so is the line that was laid over the one before
      lockFor = list.join();
      app.held = new Set(held());
      if (line) stopLine();
    }
    $('lockNone').disabled = !app.held.size;
    each('[data-lockpart]', (b) => { const part = kit.regionIds(b.dataset.lockpart); b.hidden = !part.length; b.setAttribute('aria-pressed', part.length && part.every((id) => app.held.has(id)) ? 'true' : 'false'); });
    pressed('[data-chart]', 'chart', plane);
    drawBlocks();
  }

  return { sync, tapLock, lockWords, setPicking, startLine, picking: () => picking, stopPicking: () => { if (picking) setPicking(false); }, lineOn: () => !!line, stopLine, held, order: LEVEL_ORDER };
}
