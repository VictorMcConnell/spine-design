// The builder. Shape: pick one vertebra and move, turn or resize it, or pick a stretch between
// two vertebrae and bow or offset it. Hardware: fit out a stretch in one go or place parts by
// hand. Pain: mark where it hurts and pin notes. Everything changes the spine through
// app.change, which redraws, moves the hardware with the bones and keeps the history for Undo.

import { sortedLevels, LEVEL_ORDER } from '../core/spinefile.js';
import { vertebraShape, levelFrame } from '../core/bones.js';
import { ANATOMY } from '../core/anatomy.js';
import { FINISHES } from '../core/hardware.js';
import { pullLevel, moveAlone, liftLevel, gapUnder, restack, toLocal, bowOf, setBow, offsetOf, setOffset, twistOf, setTwist, straighten } from '../core/shape.js';
import { slot, freeScrew, resizeScrew, screwLength, fitRods, crosslinkAt, planFor, cellOf, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow, rodsEndBelow, setRodsEndBelow } from '../core/place.js';
import { rayMesh, rayPoint } from '../core/pick.js';
import { gizmoHit, dragAlong, dragAround } from '../view/gizmo.js';
import { vAdd, vScale, vLerp, vDist } from '../core/vec.js';

const PART_NAMES = { screws: 'Screw', hooks: 'Hook', crosslinks: 'Cross-link' };
const AXES = { left: [1, 0, 0], back: [0, 1, 0], up: [0, 0, 1] };
const DEG = 180 / Math.PI;

export function setupBuilder(app) {
  const { $, renderer } = app;
  let tab = 'shape', mode = 'one', hwMode = 'easy', plane = 0, placing = null, marking = null, drag = null, pending = null, hot = null;
  const tool = { one: 'move', stretch: 'bow' };
  const levels = () => sortedLevels(app.spine), ids = () => levels().map((l) => l.id);
  const levelOf = (id) => app.spine.levels.find((l) => l.id === id);
  const hw = () => app.spine.hardware;
  const round1 = (v) => Math.round(v * 10) / 10;
  const each = (selector, fn) => document.querySelectorAll(selector).forEach(fn);
  const pressed = (selector, key, value) => each(selector, (b) => b.setAttribute('aria-pressed', b.dataset[key] === String(value) ? 'true' : 'false'));

  // what is selected, in the builder's own words
  const one = () => (app.picked && app.picked.kind === 'level' ? levelOf(app.picked.id) : null);
  const stretch = () => (app.picked && app.picked.kind === 'stretch' && app.picked.top && app.picked.bottom ? app.picked : null);
  const markOf = () => (app.picked && app.picked.kind === 'marks' ? app.spine.marks[app.picked.index] : null);
  const pieceOf = () => (app.picked && PART_NAMES[app.picked.kind] ? hw()[app.picked.kind][app.picked.index] : null);
  const middle = (s) => { const list = ids(); return levelOf(list[Math.round((list.indexOf(s.top) + list.indexOf(s.bottom)) / 2)]); };
  const markSpot = (m) => m.at || vLerp(m.from, m.to, 0.5);

  // ---------------------------------------------------------------- tabs, modes, tools
  function showTab(name) {
    tab = name;
    each('[data-tab]', (b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    each('[data-pane]', (p) => { p.hidden = p.dataset.pane !== name; });
    stopPlacing();
    const fits = !app.picked || (name === 'shape' && (app.picked.kind === 'level' || app.picked.kind === 'stretch')) || (name === 'parts' && (PART_NAMES[app.picked.kind] || app.picked.kind === 'level')) || (name === 'marks' && app.picked.kind === 'marks');
    $('hint').textContent = name === 'shape' ? 'Click a vertebra, then drag its handles. Drag the background to turn. Scroll or pinch to zoom.' : 'Drag to turn. Scroll or pinch to zoom. Right-drag or two fingers to move.';
    if (app.spine) app.pick(fits ? app.picked : null);
  }
  each('[data-tab]', (b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const LOOK = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 };
  each('[data-look]', (b) => b.addEventListener('click', () => renderer.look(LOOK[b.dataset.look])));

  function setMode(next) {
    if (mode === next) return;
    const was = one(), s = stretch();
    mode = next;
    // carry the selection over: the vertebra becomes the top of a stretch, or the other way round
    app.pick(next === 'stretch' ? (was ? { kind: 'stretch', top: was.id, bottom: null } : null) : s || (app.picked && app.picked.top) ? { kind: 'level', id: app.picked.top } : null);
  }
  each('[data-mode]', (b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  each('[data-tool]', (b) => b.addEventListener('click', () => { tool[b.dataset.tool === 'bow' || b.dataset.tool === 'offset' ? 'stretch' : 'one'] = b.dataset.tool; app.pick(app.picked); }));
  each('[data-plane]', (b) => b.addEventListener('click', () => { plane = Number(b.dataset.plane); sync(); }));

  // A slider and a number box that show the same value. "live" runs while it moves, "done"
  // when it is let go.
  function dial(rangeId, numberId, live, done = () => app.settle()) {
    const range = $(rangeId), number = $(numberId);
    const from = (el) => () => { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; if (el !== range) range.value = v; if (el !== number) number.value = v; live(v); };
    range.addEventListener('input', from(range)); number.addEventListener('input', from(number));
    range.addEventListener('change', done); number.addEventListener('change', done);
    return (v, lo, hi) => { if (lo !== undefined) { range.min = lo; range.max = hi; number.min = lo; number.max = hi; } if (document.activeElement !== number) number.value = v; range.value = v; };
  }
  const options = (select, list, chosen) => {
    select.textContent = '';
    for (const [value, text] of list) { const o = document.createElement('option'); o.value = value; o.textContent = text; if (value === chosen) o.selected = true; select.appendChild(o); }
  };
  const live = (fn, ride = true) => app.change(fn, { settle: false, ride });

  // ---------------------------------------------------------------- shape: one vertebra
  const half = (v) => Math.round(v * 2) / 2;
  const typicalSize = (id) => { const a = ANATOMY[id] || ANATOMY.T6; return [a.w, a.d, half((a.hf + a.hb) / 2) || 9]; };
  const turnTo = (set) => (v) => { const l = one(); if (l) live(() => { set(l, v); restack(app.spine, app.rig); }); };
  const sizeTo = (axis) => (v) => { const l = one(); if (l) { l.size[axis] = v; live(() => restack(app.spine, app.rig)); } };
  const gapDial = dial('gapR', 'gapN', (v) => { const l = one(); if (l) live(() => liftLevel(app.spine, app.rig, l.id, v - gapUnder(app.spine, app.rig, l.id))); });
  const angleDials = [dial('angF', 'angFn', turnTo((l, v) => { l.tilt[0] = v; })), dial('angS', 'angSn', turnTo((l, v) => { l.tilt[1] = v; })), dial('angT', 'angTn', turnTo((l, v) => { l.turn = v; }))];
  const sizeDials = [dial('sizeW', 'sizeWn', sizeTo(0)), dial('sizeD', 'sizeDn', sizeTo(1)), dial('sizeH', 'sizeHn', sizeTo(2))];
  $('angZero').addEventListener('click', () => { const l = one(); if (l) app.change(() => { l.tilt[0] = 0; l.turn = 0; restack(app.spine, app.rig); }); });
  $('boneTypical').addEventListener('click', () => { const l = one(); if (l) { l.size = typicalSize(l.id); app.change(() => restack(app.spine, app.rig)); } });
  const step = (by) => () => { const list = ids(), i = list.indexOf(app.picked.id) + by; if (i >= 0 && i < list.length) app.pick({ kind: 'level', id: list[i] }); };
  $('boneUp').addEventListener('click', step(-1)); $('boneDown').addEventListener('click', step(1));

  function oneBox() {
    const l = one();
    $('oneOn').hidden = !l; $('oneHint').hidden = !!l;
    if (!l) return;
    $('boneName').textContent = l.id;
    pressed('#oneOn [data-tool]', 'tool', tool.one);
    each('#oneOn [data-toolpane]', (p) => { p.hidden = p.dataset.toolpane !== tool.one; });
    const last = ids().indexOf(l.id) === ids().length - 1, typ = typicalSize(l.id);
    $('gapRow').hidden = last;
    if (!last) gapDial(round1(gapUnder(app.spine, app.rig, l.id)));
    angleDials[0](round1(l.tilt[0])); angleDials[1](round1(l.tilt[1])); angleDials[2](round1(l.turn));
    sizeDials.forEach((set, i) => set(half(l.size[i]), Math.floor(typ[i] * 0.6), Math.ceil(typ[i] * 1.6)));
  }

  // ---------------------------------------------------------------- shape: a stretch
  // What the sliders show. Sideways, to the right is plus. Front to back, backward is plus.
  const shown = {
    bow: (s) => bowOf(app.spine, s.top, s.bottom, plane),
    offset: (s) => offsetOf(app.spine, s.top, s.bottom, plane) * (plane === 0 ? -1 : 1),
    twist: (s) => -twistOf(app.spine, s.top, s.bottom),
  };
  const bowDial = dial('bowR', 'bowN', (v) => { const s = stretch(); if (s) { live(() => setBow(app.spine, app.rig, s.top, s.bottom, plane, v)); say(); } });
  const twistDial = dial('twistR', 'twistN', (v) => { const s = stretch(); if (s) live(() => setTwist(app.spine, app.rig, s.top, s.bottom, -v)); });
  const offDial = dial('offR', 'offN', (v) => { const s = stretch(); if (s) { live(() => setOffset(app.spine, app.rig, s.top, s.bottom, plane, plane === 0 ? -v : v)); say(); } });
  function say() {
    const s = stretch();
    if (!s) return;
    const b = Math.round(shown.bow(s)), o = Math.round(shown.offset(s)), span = 'from ' + s.top + ' to ' + s.bottom;
    $('bowSay').textContent = Math.abs(b) < 1 ? 'No bow ' + span + (plane === 0 ? ' seen from the front.' : ' seen from the side.') : plane === 0 ? 'Bows ' + Math.abs(b) + '° to the ' + (b > 0 ? 'right' : 'left') + ' ' + span + '.' : (b > 0 ? 'Rounded backward by ' : 'Hollow, bowed forward by ') + Math.abs(b) + '° ' + span + '.';
    $('offSay').textContent = Math.abs(o) < 1 ? s.top + ' sits straight over ' + s.bottom + (plane === 0 ? ' seen from the front.' : ' seen from the side.') : s.top + ' sits ' + Math.abs(o) + ' mm ' + (plane === 0 ? (o > 0 ? 'to the right of ' : 'to the left of ') : o > 0 ? 'further back than ' : 'in front of ') + s.bottom + '.';
  }
  const pickEnds = () => { const top = $('strTop').value, bottom = $('strBottom').value, list = ids(); app.pick(top && bottom && top !== bottom ? { kind: 'stretch', top: list.indexOf(top) < list.indexOf(bottom) ? top : bottom, bottom: list.indexOf(top) < list.indexOf(bottom) ? bottom : top } : { kind: 'stretch', top: top || bottom || null, bottom: null }); };
  $('strTop').addEventListener('change', pickEnds); $('strBottom').addEventListener('change', pickEnds);
  $('straighten').addEventListener('click', () => app.change(() => straighten(app.spine, app.rig)));

  function stretchBox() {
    const s = stretch(), p = app.picked && app.picked.kind === 'stretch' ? app.picked : {}, all = [['', 'choose'], ...ids().map((id) => [id, id])];
    options($('strTop'), all, p.top || ''); options($('strBottom'), all, p.bottom || '');
    $('stretchOn').hidden = !s;
    $('stretchHint').textContent = s ? 'Click two other vertebrae to pick a different stretch.' : p.top ? p.top + ' is one end. Now click the vertebra at the other end.' : 'Click the two vertebrae at the ends of the stretch, or choose them here.';
    if (!s) return;
    pressed('#stretchOn [data-tool]', 'tool', tool.stretch); pressed('[data-plane]', 'plane', plane);
    each('#stretchOn [data-toolpane]', (el) => { el.hidden = el.dataset.toolpane !== tool.stretch; });
    $('bowLo').textContent = plane === 0 ? 'to the left' : 'hollow (forward)'; $('bowHi').textContent = plane === 0 ? 'to the right' : 'rounded (backward)';
    $('offLo').textContent = plane === 0 ? 'to the left' : 'forward'; $('offHi').textContent = plane === 0 ? 'to the right' : 'backward';
    $('twistLo').textContent = 'fronts to the left'; $('twistHi').textContent = 'fronts to the right';
    $('twistRow').hidden = plane !== 0;
    bowDial(Math.round(shown.bow(s))); offDial(Math.round(shown.offset(s))); twistDial(Math.round(shown.twist(s)));
    say();
  }

  // ---------------------------------------------------------------- hardware: the sheet
  // One row for each vertebra. Left and Right hold a screw, a hook or nothing. The other three
  // columns are switches for the gap below the vertebra. Every change goes straight to the model.
  const SIDES = ['left', 'right'];
  const valueOf = (id, col) => (SIDES.includes(col) ? cellOf(app.spine, id, col) : (col === 'fused' ? fusedBelow(app.spine, id) : col === 'link' ? linkBelow(app.spine, id) : rodsEndBelow(app.spine, id)) ? 'yes' : '');
  const nextOf = (col, v) => (SIDES.includes(col) ? { '': 'screw', screw: 'hook', hook: '' }[v] : v ? '' : 'yes');
  const wordOf = (col, v) => (v === 'screw' ? 'Screw' : v === 'hook' ? 'Hook' : v ? (col === 'ends' ? 'end' : 'yes') : '');
  const NAMES = { left: 'left side', right: 'right side', fused: 'fused to the one below', link: 'cross-link below', ends: 'rods end below' };
  function setValue(id, col, v) {
    const spine = app.spine;
    if (SIDES.includes(col)) setCell(spine, id, col, v);
    else if (col === 'fused') setFusedBelow(spine, id, !!v);
    else if (col === 'ends') setRodsEndBelow(spine, id, !!v);
    else if (!setLinkBelow(spine, id, !!v)) app.say('A cross-link needs a rod on both sides of that gap. Put screws or hooks above and below it first.');
  }
  let sheetFor = '', paint = null;
  function showCells() {
    each('#sheet button[data-col]', (b) => { const v = valueOf(b.dataset.level, b.dataset.col); b.dataset.on = v; b.textContent = wordOf(b.dataset.col, v); b.setAttribute('aria-label', b.dataset.level + ', ' + NAMES[b.dataset.col] + ': ' + (v || 'nothing')); });
    each('#sheet tbody tr', (tr) => tr.classList.toggle('picked', !!app.picked && app.picked.kind === 'level' && app.picked.id === tr.dataset.level));
  }
  function sheet() {
    const list = ids(), body = $('sheet').tBodies[0];
    if (sheetFor !== list.join()) {
      sheetFor = list.join(); body.textContent = '';
      list.forEach((id, i) => {
        const tr = body.insertRow(); tr.dataset.level = id;
        const name = document.createElement('button'); name.textContent = id; name.dataset.name = id; name.title = 'Show ' + id + ' on the model'; tr.insertCell().appendChild(name);
        for (const col of ['left', 'right', 'fused', 'link', 'ends']) {
          const td = tr.insertCell();
          if (i === list.length - 1 && !SIDES.includes(col)) continue;          // nothing below the last one
          if (id === 'C1' && SIDES.includes(col)) continue;                      // the atlas takes no screw here
          const b = document.createElement('button'); b.dataset.level = id; b.dataset.col = col; td.appendChild(b);
        }
      });
      const all = list.map((id) => [id, id]);
      options($('hwTop'), all, list.includes('T4') ? 'T4' : list[0]); options($('hwBottom'), all, list.includes('L4') ? 'L4' : list[list.length - 1]);
    }
    showCells();
  }
  // tap a cell to change it; keep the pointer down and run over more cells of the column to give them the same
  function paintCell(b, value) {
    if (valueOf(b.dataset.level, b.dataset.col) === value) return;
    live(() => setValue(b.dataset.level, b.dataset.col, value), false);
    showCells();
  }
  $('sheet').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-col]');
    if (!b || !app.spine) return;
    e.preventDefault(); app.say('');
    paint = { col: b.dataset.col, value: nextOf(b.dataset.col, valueOf(b.dataset.level, b.dataset.col)) };
    paintCell(b, paint.value);
  });
  window.addEventListener('pointermove', (e) => {
    if (!paint) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest ? el.closest('#sheet button[data-col]') : null;
    if (b && b.dataset.col === paint.col) paintCell(b, paint.value);
  });
  const endPaint = () => { if (paint) { paint = null; app.settle(); } };
  window.addEventListener('pointerup', endPaint); window.addEventListener('pointercancel', endPaint);
  $('sheet').addEventListener('click', (e) => {
    const name = e.target.closest('button[data-name]'), b = e.target.closest('button[data-col]');
    if (name) app.pick({ kind: 'level', id: name.dataset.name });
    // a click that did not come from a pointer (the keyboard) changes the cell too
    else if (b && e.detail === 0) { live(() => setValue(b.dataset.level, b.dataset.col, nextOf(b.dataset.col, valueOf(b.dataset.level, b.dataset.col))), false); app.settle(); }
  });
  $('hwFill').addEventListener('click', () => {
    const list = ids(), a = list.indexOf($('hwTop').value), b = list.indexOf($('hwBottom').value), lo = Math.min(a, b), hi = Math.max(a, b), pattern = $('hwPattern').value;
    if (a < 0 || b < 0) return;
    const plan = pattern === 'clear' ? {} : planFor(list, list[lo], list[hi], pattern);
    app.change(() => {
      for (let i = lo; i <= hi; i++) for (const side of SIDES) if (list[i] !== 'C1') setCell(app.spine, list[i], side, (plan[list[i]] || {})[side] || '');
      if ($('fillFused').checked) for (let i = lo; i < hi; i++) setFusedBelow(app.spine, list[i], pattern !== 'clear');
    }, { ride: false });
  });
  $('hwClear').addEventListener('click', () => { app.picked = null; app.change(() => { app.spine.hardware = { rods: [], screws: [], hooks: [], crosslinks: [] }; }, { ride: false }); });
  $('rodsFit').addEventListener('click', () => app.change(() => fitRods(app.spine, true), { ride: false }));
  each('[data-hw]', (b) => b.addEventListener('click', () => { hwMode = b.dataset.hw; stopPlacing(); app.pick(hwMode === 'easy' && pieceOf() ? null : app.picked); }));

  // ---------------------------------------------------------------- hardware: parts by hand
  function spotsFor(kind) {
    if (kind !== 'screw' && kind !== 'hook') return [];
    const taken = new Set([...hw().screws, ...hw().hooks].map((p) => p.level + p.side)), out = [];
    for (const l of levels()) for (const side of ['right', 'left']) {
      if (l.id === 'C1' || taken.has(l.id + side)) continue;
      out.push({ level: l, side, at: slot(l, side).screw.head });
    }
    return out;
  }
  function startPlacing(kind) {
    placing = placing === kind ? null : kind; marking = null;
    showPlacing();
    app.say(!placing ? '' : placing === 'crosslink' ? 'Click between the rods where the cross-link should go. Esc to stop.' : $('snapOn').checked ? 'Click a blue dot to put a ' + placing + ' there. Esc to stop.' : 'Click the bone where the ' + placing + ' should go. Esc to stop.');
  }
  function startMarking(kind) {
    marking = marking === kind ? null : kind; placing = null;
    showPlacing();
    app.say(!marking ? '' : marking === 'pain' ? 'Click the spot that hurts. Esc to stop.' : 'Click the spot the note is about. Esc to stop.');
  }
  function showPlacing() {
    pressed('[data-part]', 'part', placing); pressed('[data-mark]', 'mark', marking);
    $('stage').classList.toggle('placing', !!(placing || marking));
    app.spots = placing && $('snapOn').checked ? spotsFor(placing).map((s) => s.at) : [];
    if (app.spine) app.redraw();
  }
  function stopPlacing() { if (placing || marking) { placing = marking = null; showPlacing(); app.say(''); } }
  each('[data-part]', (b) => b.addEventListener('click', () => startPlacing(b.dataset.part)));
  each('[data-mark]', (b) => b.addEventListener('click', () => startMarking(b.dataset.mark)));
  $('snapOn').addEventListener('change', () => { if (placing) showPlacing(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopPlacing();
    if ((e.key === 'Delete' || e.key === 'Backspace') && (pieceOf() || markOf()) && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) removePicked();
  });

  // Put the part being placed where the click landed.
  function place(e) {
    const hit = hitLevel(e);
    let added = null;
    if (placing === 'screw' || placing === 'hook') {
      const group = placing === 'screw' ? 'screws' : 'hooks';
      if ($('snapOn').checked) {
        let best = null;
        const box = $('view').getBoundingClientRect();
        for (const s of spotsFor(placing)) { const p = renderer.project(s.at); if (!p) continue; const d = Math.hypot(p[0] + box.left - e.clientX, p[1] + box.top - e.clientY); if (d < 26 && (!best || d < best.d)) best = { ...s, d }; }
        if (!best) { app.say('Click closer to a blue dot, or turn off snapping to place it freely.'); return; }
        const spot = slot(best.level, best.side);
        added = { group, piece: { level: best.level.id, side: best.side, rod: best.side, ...(placing === 'screw' ? spot.screw : spot.hook), source: 'guessed' } };
      } else if (hit) {
        if (placing === 'screw') added = { group, piece: { ...freeScrew(hit.level, hit.point), source: 'guessed' } };
        else {
          const side = toLocal(hit.point, hit.level.centre, levelFrame(hit.level))[0] >= 0 ? 'left' : 'right', spot = slot(hit.level, side).hook, at = vAdd(hit.point, vScale(levelFrame(hit.level).back, 6)), by = [0, 1, 2].map((j) => at[j] - spot.at[j]);
          added = { group, piece: { level: hit.level.id, side, rod: side, kind: spot.kind, at, mid: vAdd(spot.mid, by), tip: vAdd(spot.tip, by), source: 'guessed' } };
        }
      } else { app.say('Click on a vertebra.'); return; }
      added.piece.rod = (hw().rods.find((r) => r.side === added.piece.side) || { id: added.piece.side }).id;
    } else if (placing === 'crosslink') {
      const link = hit ? crosslinkAt(app.spine, hit.point[2]) : null;
      if (!link) { app.say('A cross-link needs a rod on both sides at that height. Click on the spine between the rods.'); return; }
      added = { group: 'crosslinks', piece: { ...link, source: 'guessed' } };
    }
    if (!added) return;
    const list = hw()[added.group];
    app.picked = { kind: added.group, index: list.length };
    app.change(() => { list.push(added.piece); if (added.group !== 'crosslinks') fitRods(app.spine); }, { ride: false });
    if (placing) showPlacing();
  }

  function removePicked() {
    const p = app.picked, list = p.kind === 'marks' ? app.spine.marks : hw()[p.kind];
    app.picked = null;
    app.change(() => { list.splice(p.index, 1); if (p.kind === 'screws' || p.kind === 'hooks') fitRods(app.spine); }, { ride: false });
  }
  $('pieceRemove').addEventListener('click', () => { if (pieceOf()) removePicked(); });
  const again = (settle) => app.change(() => {}, { settle, ride: false });
  const thick = dial('pieceThick', 'pieceThickN', (v) => { const s = pieceOf(); if (s) { resizeScrew(s, v, 0); again(false); } });
  const long = dial('pieceLong', 'pieceLongN', (v) => { const s = pieceOf(); if (s) { resizeScrew(s, 0, v); again(false); } });
  $('pieceColor').addEventListener('change', () => { const p = pieceOf(); if (p) { if ($('pieceColor').value) p.color = $('pieceColor').value; else delete p.color; again(true); } });

  function pieceBox() {
    const p = pieceOf(), kind = p ? app.picked.kind : '';
    $('pieceBox').hidden = !p;
    if (!p) return;
    $('pieceName').textContent = PART_NAMES[kind] + (p.level ? ' at ' + p.level : '') + (p.side ? ', ' + p.side + ' side' : '');
    $('pieceThickRow').hidden = $('pieceLongRow').hidden = kind !== 'screws';
    if (kind === 'screws') { thick(p.diameter || 5); long(screwLength(p)); }
    options($('pieceColor'), [['', 'the usual'], ...Object.keys(FINISHES).map((k) => [k, k])], p.color || '');
  }

  // ---------------------------------------------------------------- pain points and notes
  const markName = (m) => (m.kind === 'note' ? 'Note: ' : 'Pain: ') + (m.text || 'no label') + (m.kind === 'pain' ? ', ' + (m.strength || 5) + ' out of 10' : '');
  function addMark(e) {
    const hit = hitLevel(e);
    if (!hit) { app.say('Click on a vertebra.'); return; }
    const at = hit.point.map(round1), mark = marking === 'pain' ? { kind: 'pain', text: 'Pain', at, radius: 14, strength: 5 } : { kind: 'note', text: 'Note', at };
    app.picked = { kind: 'marks', index: app.spine.marks.length };
    marking = null; showPlacing(); app.say('');
    app.change(() => app.spine.marks.push(mark), { ride: false });
    $('markText').focus(); $('markText').select();
  }
  $('markText').addEventListener('input', () => { const m = markOf(); if (m) { m.text = $('markText').value; again(false); } });
  $('markText').addEventListener('change', () => app.settle());
  const strong = dial('markStrong', 'markStrongN', (v) => { const m = markOf(); if (m) { m.strength = Math.max(1, Math.min(10, Math.round(v))); again(false); } });
  const wide = dial('markSize', 'markSizeN', (v) => { const m = markOf(); if (m) { m.radius = v; again(false); } });
  $('markRemove').addEventListener('click', () => { if (markOf()) removePicked(); });

  function markBox() {
    const list = $('markList'), m = markOf();
    list.textContent = '';
    app.spine.marks.forEach((mark, index) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.textContent = markName(mark); b.setAttribute('aria-pressed', app.picked && app.picked.kind === 'marks' && app.picked.index === index ? 'true' : 'false');
      b.addEventListener('click', () => app.pick({ kind: 'marks', index }));
      li.appendChild(b); list.appendChild(li);
    });
    $('markBox').hidden = !m;
    if (!m) return;
    if (document.activeElement !== $('markText')) $('markText').value = m.text || '';
    $('markStrongRow').hidden = $('markSizeRow').hidden = m.kind !== 'pain';
    if (m.kind === 'pain') { strong(m.strength || 5); wide(m.radius || 15); }
  }

  // ---------------------------------------------------------------- handles on the model
  // The handles for what is selected, or null: { spec, active } (see view/gizmo.js).
  function handles() {
    if (!app.spine || placing || marking) return null;
    const set = (at, kinds) => ({ spec: { at, handles: Object.entries(kinds).map(([name, kind]) => ({ name, kind, axis: AXES[name] })) }, active: (drag && drag.name) || hot });
    const l = one(), s = stretch(), m = markOf();
    if (tab === 'shape' && l) {
      if (tool.one === 'move') return set(l.centre, { left: 'double', back: 'double', ...(ids().indexOf(l.id) < ids().length - 1 ? { up: 'arrow' } : {}) });
      if (tool.one === 'turn') return set(l.centre, { left: 'ring', back: 'ring', up: 'ring' });
      const f = levelFrame(l);
      return { spec: { at: l.centre, handles: [{ name: 'left', kind: 'knob', axis: f.left }, { name: 'back', kind: 'knob', axis: f.back }, { name: 'up', kind: 'knob', axis: f.up }] }, active: (drag && drag.name) || hot };
    }
    if (tab === 'shape' && s) return set(tool.stretch === 'bow' ? middle(s).centre : levelOf(s.top).centre, { left: 'double', back: 'double' });
    if (tab === 'marks' && m) return set(markSpot(m), { left: 'double', back: 'double', up: 'double' });
    const part = pieceOf();
    if (tab === 'parts' && hwMode === 'hand' && part) return app.picked.kind === 'crosslinks' ? set(vLerp(part.from, part.to, 0.5), { up: 'double' }) : set(part.head || part.at, { left: 'double', back: 'double', up: 'double' });
    return null;
  }

  // What one step of a drag does. "name" is the handle (left, back, up), "by" how far along it
  // in millimetres, "turn" how far round it in degrees.
  function pull(name, by, turn) {
    const l = one(), s = stretch(), m = markOf(), part = pieceOf(), spine = app.spine, rig = app.rig;
    if (tab === 'parts' && part) {
      // a part moves as a whole; the rods on its side are drawn again through it
      const j = { left: 0, back: 1, up: 2 }[name];
      live(() => {
        if (app.picked.kind === 'crosslinks') {
          const link = crosslinkAt(spine, (part.from[2] + part.to[2]) / 2 + by);
          if (link) { part.from = link.from; part.to = link.to; part.level = link.level; delete part.below; }
        } else {
          for (const key of ['head', 'entry', 'tip', 'at', 'mid']) if (part[key]) part[key] = part[key].map((v, k) => (k === j ? round1(v + by) : v));
          fitRods(spine);
        }
      }, false);
    } else if (tab === 'marks' && m) {
      const j = { left: 0, back: 1, up: 2 }[name];
      live(() => { for (const key of ['at', 'from', 'to']) if (m[key]) m[key][j] = round1(m[key][j] + by); }, false);
    } else if (l && tool.one === 'move') {
      const soft = $('softOn').checked;
      live(() => { if (name === 'up') liftLevel(spine, rig, l.id, by); else if (soft) pullLevel(spine, rig, l.id, name === 'left' ? by : 0, name === 'back' ? by : 0); else moveAlone(spine, rig, l.id, name === 'left' ? by : 0, name === 'back' ? by : 0); });
    } else if (l && tool.one === 'turn') {
      live(() => { if (name === 'up') l.turn += turn; else if (name === 'back') l.tilt[0] = Math.max(-80, Math.min(80, l.tilt[0] + turn)); else l.tilt[1] = Math.max(-80, Math.min(80, l.tilt[1] - turn)); restack(spine, rig); });
    } else if (l && tool.one === 'size') {
      const j = { left: 0, back: 1, up: 2 }[name], typ = typicalSize(l.id);
      l.size[j] = Math.max(typ[j] * 0.5, Math.min(typ[j] * 1.8, l.size[j] + 2 * by));
      live(() => restack(spine, rig));
    } else if (s && tool.stretch === 'bow') {
      // pulling the middle out by so many millimetres makes an arc of this many degrees
      const p = name === 'left' ? 0 : 1, deg = ((8 * by) / Math.max(40, vDist(levelOf(s.top).centre, levelOf(s.bottom).centre))) * DEG;
      live(() => setBow(spine, rig, s.top, s.bottom, p, bowOf(spine, s.top, s.bottom, p) + (p === 0 ? -deg : deg)));
    } else if (s && tool.stretch === 'offset') {
      const p = name === 'left' ? 0 : 1;
      live(() => setOffset(spine, rig, s.top, s.bottom, p, offsetOf(spine, s.top, s.bottom, p) + by));
    }
  }

  // ---------------------------------------------------------------- what is under the pointer
  function hitLevel(e) {
    const ray = renderer.ray(e.clientX, e.clientY);
    let best = null;
    for (const l of levels()) {
      if (rayPoint(ray.origin, ray.direction, l.centre).off > 75) continue;
      const f = levelFrame(l), d = ray.direction, t = rayMesh(toLocal(ray.origin, l.centre, f), [d[0] * f.left[0] + d[1] * f.left[1] + d[2] * f.left[2], d[0] * f.back[0] + d[1] * f.back[1] + d[2] * f.back[2], d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2]], vertebraShape(l.id, l.size, app.DETAIL));
      if (t !== null && (!best || t < best.t)) best = { level: l, t, point: vAdd(ray.origin, vScale(d, t)) };
    }
    return best;
  }
  function hitThing(e, marks) {
    const ray = renderer.ray(e.clientX, e.clientY), at = [];
    if (marks) app.spine.marks.forEach((m, index) => at.push({ kind: 'marks', index, p: markSpot(m), r: m.kind === 'note' ? 8 : Math.min(m.radius || 15, 18) }));
    else {
      hw().screws.forEach((s, index) => at.push({ kind: 'screws', index, p: s.head, r: 9 }));
      hw().hooks.forEach((h, index) => at.push({ kind: 'hooks', index, p: h.at, r: 9 }));
      hw().crosslinks.forEach((c, index) => { for (const t of [0.25, 0.5, 0.75]) at.push({ kind: 'crosslinks', index, p: vLerp(c.from, c.to, t), r: 6 }); });
    }
    let best = null;
    for (const c of at) { const near = rayPoint(ray.origin, ray.direction, c.p); if (near.off <= c.r && near.along > 0 && (!best || near.along < best.along)) best = { ...c, along: near.along }; }
    return best && { kind: best.kind, index: best.index };
  }

  function tap(e) {
    if (!app.spine) return;
    if (placing) { place(e); return; }
    if (marking) { addMark(e); return; }
    if (tab === 'parts' && hwMode === 'easy') {
      // the sheet and the model point at each other: a click on a vertebra finds its row
      const hit = hitLevel(e);
      app.pick(hit ? { kind: 'level', id: hit.level.id } : null);
      const row = hit && document.querySelector('#sheet tr[data-level="' + hit.level.id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (tab === 'parts') { app.pick(hitThing(e, false)); return; }
    if (tab === 'marks') { app.pick(hitThing(e, true)); return; }
    if (tab !== 'shape') return;
    const hit = hitLevel(e), id = hit && hit.level.id, list = ids(), p = app.picked || {};
    if (!id) { app.pick(null); return; }
    if (mode === 'one' && e.shiftKey && p.kind === 'level' && p.id !== id) { mode = 'stretch'; app.pick({ kind: 'stretch', top: list.indexOf(p.id) < list.indexOf(id) ? p.id : id, bottom: list.indexOf(p.id) < list.indexOf(id) ? id : p.id }); return; }
    if (mode === 'one') { app.pick({ kind: 'level', id }); return; }
    if (p.kind === 'stretch' && p.top && !p.bottom && p.top !== id) app.pick({ kind: 'stretch', top: list.indexOf(p.top) < list.indexOf(id) ? p.top : id, bottom: list.indexOf(p.top) < list.indexOf(id) ? id : p.top });
    else app.pick({ kind: 'stretch', top: id, bottom: null });
  }

  renderer.setTool({
    // A press on a handle grabs it. A press on the selected vertebra (or inside the selected
    // stretch) grabs that: it then follows the pointer.
    down(e) {
      if (!app.spine || placing || marking) return false;
      const h = handles(), grabbed = h && gizmoHit(h.spec, renderer, e.clientX, e.clientY, e.pointerType === 'touch' ? 24 : 13);
      if (grabbed) { drag = { name: grabbed.handle.name, ring: grabbed.handle.kind === 'ring', grab: grabbed.grab, dx: 0, dy: 0, moved: false }; app.redraw(); return true; }
      if (tab !== 'shape') return false;
      const hit = hitLevel(e), l = one(), s = stretch(), list = ids();
      if (!hit) return false;
      const i = list.indexOf(hit.level.id), body = l && tool.one === 'move' && hit.level.id === l.id ? 'one' : s && i > list.indexOf(s.top) && i < list.indexOf(s.bottom) ? 'bow' : s && hit.level.id === s.top ? 'offset' : null;
      if (!body) return false;
      drag = { body, dx: 0, dy: 0, moved: false, at: hit.level.centre };
      return true;
    },
    move(e, dx, dy) {
      if (!drag) return;
      drag.dx += dx; drag.dy += dy;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) < 3 && !drag.moved) return;
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (!drag) return;
        const h = handles(), dx2 = drag.dx, dy2 = drag.dy;
        drag.dx = drag.dy = 0; drag.moved = true;
        if (drag.name) {
          const handle = h && h.spec.handles.find((x) => x.name === drag.name);
          if (!handle) return;
          if (drag.ring) pull(drag.name, 0, dragAround(h.spec, handle, renderer, drag.grab, dx2, dy2)); else pull(drag.name, dragAlong(h.spec, handle, renderer, dx2, dy2), 0);
        } else {
          // the body itself: sideways and front to back, as far as the pointer went on screen
          const s = renderer.screenScale(drag.at), by = [0, 1].map((j) => (s.right[j] * dx2 - s.up[j] * dy2) * s.perPixel), was = tool.stretch;
          if (drag.body !== 'one') tool.stretch = drag.body;
          if (Math.abs(by[0]) > 0.01) pull('left', by[0], 0);
          if (Math.abs(by[1]) > 0.01) pull('back', by[1], 0);
          tool.stretch = was;
        }
      });
    },
    up(e) {
      const was = drag; drag = null;
      if (was && was.moved) app.settle(); else { if (was && was.name) app.redraw(); if (e.type === 'pointerup' && !(was && was.name)) tap(e); }
    },
    tap,
    // light up the handle under the pointer
    hover(e) {
      const h = handles(), over = h && gizmoHit(h.spec, renderer, e.clientX, e.clientY), name = over ? over.handle.name : null;
      if (name !== hot) { hot = name; $('view').style.cursor = name ? 'grab' : ''; app.redraw(); }
    },
  });

  function sync() {
    if (!app.spine) return;
    pressed('[data-mode]', 'mode', mode);
    $('oneBox').hidden = mode !== 'one'; $('stretchBox').hidden = mode !== 'stretch';
    pressed('[data-hw]', 'hw', hwMode);
    $('easyBox').hidden = hwMode !== 'easy'; $('handBox').hidden = hwMode !== 'hand';
    oneBox(); stretchBox(); sheet(); pieceBox(); markBox();
  }

  showTab('shape');
  return {
    sync, handles,
    // a new spine was opened, or Undo went back: drop whatever was being placed
    reset() { placing = marking = null; hot = null; pressed('[data-part]', 'part', null); pressed('[data-mark]', 'mark', null); $('stage').classList.remove('placing'); },
    // select a stretch and open the Shape tab on it (the list of curves does this)
    workOn(top, bottom, which) { mode = 'stretch'; tool.stretch = 'bow'; plane = which; if (tab !== 'shape') showTab('shape'); app.pick({ kind: 'stretch', top, bottom }); },
  };
}
