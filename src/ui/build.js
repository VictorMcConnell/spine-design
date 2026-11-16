// The builder. Shape: draw the curve, or pick one vertebra and move, turn or resize it, or
// pick a stretch between two vertebrae and bow or offset it. Hardware: answer three questions
// (the easy way, in easy.js) or place, drag and bend every part by hand. Pain: mark where it
// hurts and pin notes. Everything changes the spine through app.change, which redraws, moves
// the hardware with the bones and keeps the history for Undo.

import { sortedLevels, LEVEL_ORDER } from '../core/spinefile.js';
import { vertebraShape, levelFrame } from '../core/bones.js';
import { ANATOMY } from '../core/anatomy.js';
import { pullLevel, moveAlone, liftLevel, gapUnder, restack, toLocal, bowOf, setBow, offsetOf, setOffset, twistOf, setTwist, straighten, stiffen, blockOf, pivotAt } from '../core/shape.js';
import { slot, freeScrew, resizeScrew, screwLength, fitRods, crosslinkAt, planFor, cellOf, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow, rodsEndBelow, setRodsEndBelow, putPlanned, moveInLine, settleInLine, placePiece, hookAt, faceHook, bendRod, unbendRod , shiftParts } from '../core/place.js';
import { rayMesh, rayPoint } from '../core/pick.js';
import { gizmoHit, dragAlong, dragAround } from '../view/gizmo.js';
import { vAdd, vSub, vScale, vLerp, vDist, vDot } from '../core/vec.js';
import { setupEasy, swatches } from './easy.js';
import { setupChart } from './chart.js';

const PART_NAMES = { screws: 'Screw', hooks: 'Hook', crosslinks: 'Cross-link', rods: 'Rod' };
const AXES = { left: [1, 0, 0], back: [0, 1, 0], up: [0, 0, 1] };
const DEG = 180 / Math.PI;

export function setupBuilder(app) {
  const { $, renderer } = app;
  let tab = 'shape', mode = 'draw', plane = 0, placing = null, marking = null, drag = null, pending = null, hot = null;
  const tool = { one: 'move', stretch: 'bow' };
  const levels = () => sortedLevels(app.spine), ids = () => levels().map((l) => l.id);
  const levelOf = (id) => app.spine.levels.find((l) => l.id === id);
  const hw = () => app.spine.hardware;
  const round1 = (v) => Math.round(v * 10) / 10;
  const each = (selector, fn) => document.querySelectorAll(selector).forEach(fn);
  const pressed = (selector, key, value) => each(selector, (b) => b.setAttribute('aria-pressed', b.dataset[key] === String(value) ? 'true' : 'false'));

  // The three levels of control. Outside "Full control" the rules are always on: parts snap
  // to the usual spots, rods stay believable, fused parts stay stiff, neighbours follow.
  const full = () => app.level === 'full';
  const opt = (id) => !full() || $(id).checked;
  const snapping = () => opt('snapOn');
  const LEVEL_SAYS = { easy: 'The simple tools. Rules keep the spine and the rods believable.', standard: 'More tools for fine work, with the same rules.', full: 'Everything can be set by hand and the rules can be switched off. You can break the model here.' };
  function guard() {
    app.inLine = opt('inLineOn');
    if (app.stiff !== opt('stiffOn')) { app.stiff = opt('stiffOn'); if (app.spine) { stiffen(app.spine, app.rig, app.stiff); app.redraw(); } }
  }
  function setLevel(next) {
    app.level = next;
    for (const name of ['easy', 'standard', 'full']) document.body.classList.toggle('level-' + name, name === next);
    pressed('[data-level]', 'level', next); $('levelSay').textContent = LEVEL_SAYS[next];
    stopPlacing();
    if (next === 'easy' && mode !== 'draw' && mode !== 'blocks') { mode = 'draw'; if (app.spine && tab === 'shape') app.picked = null; }
    if (next === 'easy') app.also = [];
    guard();
    if (app.spine) { app.redraw(); sync(); }
  }
  each('[data-level]', (b) => b.addEventListener('click', () => setLevel(b.dataset.level)));

  // what is selected, in the builder's own words
  const one = () => (app.picked && app.picked.kind === 'level' ? levelOf(app.picked.id) : null);
  const stretch = () => (app.picked && app.picked.kind === 'stretch' && app.picked.top && app.picked.bottom ? app.picked : null);
  const markOf = () => (app.picked && app.picked.kind === 'marks' ? app.spine.marks[app.picked.index] : null);
  const pieceOf = () => (app.picked && PART_NAMES[app.picked.kind] ? hw()[app.picked.kind][app.picked.index] : null);
  // every part that is selected: the picked one first, then the ones selected along with it
  const chosen = () => [app.picked, ...(app.also || [])].filter((p) => p && PART_NAMES[p.kind] && hw()[p.kind][p.index]).map((p) => ({ kind: p.kind, index: p.index, piece: hw()[p.kind][p.index] }));
  const middle = (s) => { const list = ids(); return levelOf(list[Math.round((list.indexOf(s.top) + list.indexOf(s.bottom)) / 2)]); };
  const markSpot = (m) => m.at || vLerp(m.from, m.to, 0.5);

  // ---------------------------------------------------------------- tabs, modes, tools
  function showTab(name) {
    const was = tab;
    tab = name === 'share' && !app.guided ? 'shape' : name;      // (the Share step is part of the phone and tablet layout only)
    name = tab;
    document.body.dataset.at = name;      // (for the styles: which step or tab is open)
    each('[data-tab]', (b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    each('[data-pane]', (p) => { p.hidden = p.dataset.pane !== name; });
    if (was !== name) setMore(false);
    arrange(was !== name);
    stopPlacing(); easy.stopDrawing(); easy.stopPicking(); chart.stopLine(); chart.stopPicking();
    app.showStiff = name === 'shape';
    $('stage').classList.toggle('tagsLive', name === 'marks');
    const fits = !app.picked || (name === 'shape' && app.level !== 'easy' && (app.picked.kind === 'level' || app.picked.kind === 'stretch')) || (name === 'parts' && (PART_NAMES[app.picked.kind] || app.picked.kind === 'level')) || (name === 'marks' && app.picked.kind === 'marks');
    if (app.spine) app.pick(fits ? app.picked : null);
    hint();
  }
  // The line under the picture: what the mouse or a finger does there right now.
  function hint() {
    const turn = ' Drag the background to turn. Scroll or pinch to zoom.';
    $('hint').textContent = tab === 'shape' ? (easy.draw.on() ? 'Drag a line along the spine. Scroll or pinch to zoom. Press "Done drawing" to turn the model again.' : chart.picking() ? 'Click vertebrae to lock or unlock them.' + turn : chart.lineOn() ? 'Drag a point of the line. Click the line to add a point.' + turn : mode === 'blocks' ? 'Slide the blocks in the panel. The model follows.' + turn : mode === 'draw' ? 'Press one of the buttons in the panel.' + turn : mode === 'one' ? 'Click a vertebra, then drag its handles.' + turn : 'Click the two ends of a stretch, then drag its handles.' + turn)
      : tab === 'parts' ? (easy.rodding() ? 'Click two screws or hooks of one side to join them with a rod. Click a rod to end it there.'
        : app.level === 'easy' ? 'Click a soft mark or a vertebra to put the part of this step there, or click a part to select it.' + turn : 'Click a soft mark to put the part in hand there. Click a part or a vertebra to select it. Drag a screw or a hook to move it, a rod to bend it.' + turn)
        : 'Drag to turn. Scroll or pinch to zoom. Right-drag or two fingers to move.';
  }
  each('[data-tab]', (b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------------------------------------------------------------- the phone and tablet layout
  // One step at a time: Shape, Hardware, Pain, Share, with one pair of Back and Next that
  // also walks through the four steps of the hardware. In the Hardware step the flat map
  // stands beside the model, so a tap on the map shows on the model at once.
  const home = (el, to) => { if (!el.home) { el.home = document.createComment('home'); el.before(el.home); } if (to) to.appendChild(el); else el.home.after(el); };
  // Put the map and the box of hardware controls where the layout wants them.
  //   fresh: the step was just opened (the model is then shown from the back, whole, beside the map)
  function arrange(fresh) {
    const side = app.guided && tab === 'parts', shown = !$('sideMap').hidden;
    home($('mapWrap'), side ? $('sideMap') : null);
    home($('fieldBar'), app.guided ? $('steps') : null);
    // ("Done drawing" floats over the model, under the thumb, so the sheet keeps its height while a line is drawn)
    home($('drawDone'), app.guided ? $('stage') : null);
    $('sideMap').hidden = !side;
    document.body.classList.toggle('with-map', side);
    if (side !== shown || (side && fresh)) {
      // (the picture has a new shape: fit the spine into it again once the page has been laid out)
      if (side) renderer.look(0);
      requestAnimationFrame(() => { app.fit(); renderer.requestDraw(); });
    }
  }
  // "More tools": the less used tools of a step, hidden until they are asked for
  function setMore(on) { document.body.classList.toggle('more-on', !!on); $('guideMore').setAttribute('aria-pressed', on ? 'true' : 'false'); $('guideMore').textContent = on ? 'Less' : 'More'; }
  $('guideMore').addEventListener('click', () => setMore(!document.body.classList.contains('more-on')));
  // where Back and Next lead from here: [the step before, the step after, what Next says]
  const WALK = ['shape', 'parts', 'marks', 'share'];
  function guideSteps() {
    const n = tab === 'parts' ? easy.step() : 0;
    if (tab === 'parts') return [n > 1 ? () => easy.setStep(n - 1) : () => showTab('shape'), n < 4 ? () => easy.setStep(n + 1) : () => showTab('marks'), ['', 'Next: hooks', 'Next: links', 'Next: rods', 'Next: pain'][n]];
    const i = WALK.indexOf(tab);
    return [i > 0 ? () => { showTab(WALK[i - 1]); if (WALK[i - 1] === 'parts') easy.setStep(4); } : null, i < WALK.length - 1 ? () => { showTab(WALK[i + 1]); if (WALK[i + 1] === 'parts') easy.setStep(hw().screws.length + hw().hooks.length ? 4 : 1); } : null, ['Next: hardware', '', 'Next: share', ''][i]];
  }
  function guideNav() {
    if (!app.guided || !app.spine) return;
    const [back, next, says] = guideSteps();
    $('guideBack').disabled = !back; $('guideNext').hidden = !next; $('guideNext').textContent = says;
    // (drawing is finished by going on: the button says so while a line can be drawn)
    $('guideMore').hidden = tab === 'share' || tab === 'marks';
  }
  $('guideBack').addEventListener('click', () => { const [back] = guideSteps(); if (back) { easy.stopDrawing(); back(); sync(); } });
  $('guideNext').addEventListener('click', () => { const [, next] = guideSteps(); if (next) { easy.stopDrawing(); next(); sync(); } });

  const LOOK = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 };
  each('[data-look]', (b) => b.addEventListener('click', () => renderer.look(LOOK[b.dataset.look])));

  function setMode(next) {
    if (mode === next) return;
    const was = one(), p = app.picked;
    easy.stopDrawing(); chart.stopLine(); chart.stopPicking();
    mode = next;
    // carry the selection over: the vertebra becomes the top of a stretch, or the other way round
    app.pick(next === 'draw' || next === 'blocks' ? null : next === 'stretch' ? (was ? { kind: 'stretch', top: was.id, bottom: null } : null) : p && p.kind === 'stretch' && p.top ? { kind: 'level', id: p.top } : null);
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
  // (a vertebra turned by hand leads the stiff block it is part of, and with "The spine above
  // turns with it" ticked everything above it comes along, as if the spine bent in that place)
  const turned = (l, set) => { if (opt('pivotOn')) pivotAt(app.spine, app.rig, l.id, set); else { set(l); restack(app.spine, app.rig, l.id); } };
  const turnTo = (set) => (v) => { const l = one(); if (l) live(() => turned(l, (x) => set(x, v))); };
  const sizeTo = (axis) => (v) => { const l = one(); if (l) { l.size[axis] = v; live(() => restack(app.spine, app.rig)); } };
  const gapDial = dial('gapR', 'gapN', (v) => { const l = one(); if (l) live(() => liftLevel(app.spine, app.rig, l.id, v - gapUnder(app.spine, app.rig, l.id))); });
  const angleDials = [dial('angF', 'angFn', turnTo((l, v) => { l.tilt[0] = v; })), dial('angS', 'angSn', turnTo((l, v) => { l.tilt[1] = v; })), dial('angT', 'angTn', turnTo((l, v) => { l.turn = v; }))];
  const sizeDials = [dial('sizeW', 'sizeWn', sizeTo(0)), dial('sizeD', 'sizeDn', sizeTo(1)), dial('sizeH', 'sizeHn', sizeTo(2))];
  $('angZero').addEventListener('click', () => { const l = one(); if (l) app.change(() => turned(l, (x) => { x.tilt[0] = 0; x.turn = 0; })); });
  $('stiffOn').addEventListener('change', () => { guard(); sync(); });
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
    const last = ids().indexOf(l.id) === ids().length - 1, typ = typicalSize(l.id), block = blockOf(app.spine, app.rig, l.id);
    $('oneFused').hidden = !block;
    if (block) $('oneFused').textContent = l.id + ' is part of the fused stretch from ' + block.top + ' to ' + block.bottom + '. That stretch moves and turns as one block.';
    // a fused joint has no space to change
    $('gapRow').hidden = last || (!!block && block.bottom !== l.id);
    if (!last) gapDial(round1(gapUnder(app.spine, app.rig, l.id)));
    angleDials[0](round1(l.tilt[0])); angleDials[1](round1(l.tilt[1])); angleDials[2](round1(l.turn));
    sizeDials.forEach((set, i) => set(half(l.size[i]), Math.floor(typ[i] * 0.6), Math.ceil(typ[i] * 1.6)));
  }

  // ---------------------------------------------------------------- shape: the fused part
  // Which stretches are fused is said here, before or after the hardware goes on. A fused
  // stretch keeps its shape while the rest is bent, as long as the box is ticked.
  let fusedFor = '';
  const fuseRange = (top, bottom, on) => { const list = ids(), a = list.indexOf(top), b = list.indexOf(bottom); app.change(() => { for (let i = Math.min(a, b); i < Math.max(a, b); i++) setFusedBelow(app.spine, list[i], on); }, { ride: false }); };
  $('fuseAdd').addEventListener('click', () => { if ($('fuseTop').value !== $('fuseBottom').value) fuseRange($('fuseTop').value, $('fuseBottom').value, true); });
  function fusedBox() {
    const list = ids(), fused = app.spine.fused || [], box = $('fusedList');
    if (fusedFor !== list.join()) {
      fusedFor = list.join();
      const all = list.map((id) => [id, id]);
      options($('fuseTop'), all, list.includes('T4') ? 'T4' : list[0]); options($('fuseBottom'), all, list.includes('L2') ? 'L2' : list[list.length - 1]);
    }
    box.textContent = '';
    for (const [top, bottom] of fused) {
      const li = document.createElement('li'), b = document.createElement('button');
      li.textContent = top + ' to ' + bottom + ' is fused. ';
      b.textContent = 'Not fused'; b.className = 'plain'; b.addEventListener('click', () => fuseRange(top, bottom, false));
      li.appendChild(b); box.appendChild(li);
    }
    $('fusedNone').hidden = fused.length > 0; $('stiffRow').hidden = $('stiffSay').hidden = !fused.length; $('stiffOn').checked = app.stiff;
    $('stiffSay').textContent = app.stiff ? 'The fused part moves as one block and is drawn in a cooler colour. Bends go into the joints that are still free.' : 'The fused part can be reshaped like the rest. Tick the box once it has the shape it should keep.';
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
  $('straighten').addEventListener('click', () => {
    app.change(() => straighten(app.spine, app.rig));
    const kept = (app.rig.blocks || []).length && levels().some((l) => Math.abs(l.tilt[0]) > 0.5 || Math.abs(l.turn) > 0.5);
    app.say(kept ? 'The fused part kept its shape. Untick "Fused parts stay stiff" to straighten it too.' : '');
  });

  function stretchBox() {
    const s = stretch(), p = app.picked && app.picked.kind === 'stretch' ? app.picked : {}, all = [['', 'choose'], ...ids().map((id) => [id, id])];
    options($('strTop'), all, p.top || ''); options($('strBottom'), all, p.bottom || '');
    $('stretchOn').hidden = !s;
    const stiffIds = s ? ids().slice(ids().indexOf(s.top), ids().indexOf(s.bottom) + 1).map((id) => blockOf(app.spine, app.rig, id)) : [];
    const whole = stiffIds.length > 0 && stiffIds.every((b) => b && b.top === stiffIds[0].top), some = stiffIds.find((b) => b);
    $('stretchFused').hidden = !some;
    if (some) $('stretchFused').textContent = whole ? 'This stretch lies inside the fused part from ' + some.top + ' to ' + some.bottom + ', so it cannot be bent. Untick "Fused parts stay stiff" above to reshape it.' : 'The fused part from ' + some.top + ' to ' + some.bottom + ' stays stiff. The bend goes into the joints that are free.';
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
      for (let i = lo; i <= hi; i++) for (const side of SIDES) if (list[i] !== 'C1') putPlanned(app.spine, list[i], side, (plan[list[i]] || {})[side] || '');
      if ($('fillFused').checked) for (let i = lo; i < hi; i++) setFusedBelow(app.spine, list[i], pattern !== 'clear');
    }, { ride: false });
  });
  $('hwClear').addEventListener('click', () => {
    // (frozen parts stay, with the rods that still have two parts to hold them)
    const kept = [...hw().screws, ...hw().hooks, ...hw().crosslinks].filter((p) => p.locked).length;
    app.pick(null);
    app.change(() => { const h = hw(); app.spine.hardware = { ...(h.colors ? { colors: h.colors } : {}), rods: [], screws: h.screws.filter((p) => p.locked), hooks: h.hooks.filter((p) => p.locked), crosslinks: h.crosslinks.filter((p) => p.locked) }; fitRods(app.spine, true); }, { ride: false });
    app.say(kept ? 'The frozen parts were kept: ' + kept + '.' : '');
  });
  $('rodsFit').addEventListener('click', () => app.change(() => fitRods(app.spine, true), { ride: false }));

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
    app.say(!placing ? '' : placing === 'crosslink' ? 'Click between the rods where the cross-link should go. Esc to stop.' : snapping() ? 'Click a blue dot to put a ' + placing + ' there. Esc to stop.' : 'Click the bone where the ' + placing + ' should go. Esc to stop.');
  }
  function startMarking(kind) {
    marking = marking === kind ? null : kind; placing = null;
    showPlacing();
    app.say(!marking ? '' : marking === 'pain' ? 'Click the spot that hurts. Esc to stop.' : 'Click the spot the note is about. Esc to stop.');
  }
  function showPlacing() {
    pressed('[data-part]', 'part', placing); pressed('[data-mark]', 'mark', marking);
    $('stage').classList.toggle('placing', !!(placing || marking));
    app.spots = placing && snapping() ? spotsFor(placing).map((s) => s.at) : [];
    if (app.spine) app.redraw();
  }
  function stopPlacing() { if (placing || marking) { placing = marking = null; showPlacing(); app.say(''); } }
  each('[data-part]', (b) => b.addEventListener('click', () => startPlacing(b.dataset.part)));
  each('[data-mark]', (b) => b.addEventListener('click', () => startMarking(b.dataset.mark)));
  $('snapOn').addEventListener('change', () => { if (placing) showPlacing(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopPlacing();
    if ((e.key === 'Delete' || e.key === 'Backspace') && (pieceOf() || markOf()) && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (markOf()) removePicked(); else removeChosen(); }
  });

  // Put the part being placed where the click landed.
  function place(e) {
    const hit = hitLevel(e);
    let added = null;
    if (placing === 'screw' || placing === 'hook') {
      const group = placing === 'screw' ? 'screws' : 'hooks';
      if (snapping()) {
        let best = null;
        const box = $('view').getBoundingClientRect();
        for (const s of spotsFor(placing)) { const p = renderer.project(s.at); if (!p) continue; const d = Math.hypot(p[0] + box.left - e.clientX, p[1] + box.top - e.clientY); if (d < 26 && (!best || d < best.d)) best = { ...s, d }; }
        if (!best) { app.say('Click closer to a blue dot, or turn off snapping to place it freely.'); return; }
        const spot = slot(best.level, best.side);
        added = { group, piece: { level: best.level.id, side: best.side, rod: best.side, ...(placing === 'screw' ? spot.screw : spot.hook), source: 'guessed' } };
      } else if (hit) {
        if (placing === 'screw') added = { group, piece: { ...freeScrew(hit.level, hit.point), source: 'guessed' } };
        else {
          const side = toLocal(hit.point, hit.level.centre, levelFrame(hit.level))[0] >= 0 ? 'left' : 'right';
          added = { group, piece: { rod: side, kind: 'lamina', ...hookAt(hit.level, vAdd(hit.point, vScale(levelFrame(hit.level).back, 6)), side), source: 'guessed' } };
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
    let nudged = false;
    app.change(() => {
      list.push(added.piece);
      if (added.group === 'crosslinks') return;
      // a part dropped out of line with its rod slides in, just far enough for the rod to reach it
      nudged = app.inLine && !snapping() && settleInLine(app.spine, added.piece);
      fitRods(app.spine);
    }, { ride: false });
    if (placing) showPlacing();
    if (nudged) app.say('Moved it a little so that the rod can reach it. Untick "Keep rods believable" to place parts anywhere.');
  }

  function removePicked() {
    const p = app.picked, list = p.kind === 'marks' ? app.spine.marks : hw()[p.kind];
    app.picked = null;
    app.change(() => { list.splice(p.index, 1); if (p.kind === 'screws' || p.kind === 'hooks') fitRods(app.spine); }, { ride: false });
  }
  // ---- the selection: one part, or several
  const same = (p, q) => p && q && p.kind === q.kind && p.index === q.index;
  const FROZEN = 'That part is frozen. Untick "Frozen" under Full control to change it.';
  function pickPart(what, add) {
    const all = add && pieceOf() ? [app.picked, ...(app.also || [])] : [], i = all.findIndex((p) => same(p, what));
    if (i >= 0) all.splice(i, 1); else all.unshift({ kind: what.kind, index: what.index });
    app.pick(all[0] || null, all.slice(1));
  }
  // Take the selected parts off (rods are drawn by the app and go when their parts go).
  function removeChosen() {
    const all = chosen().filter((c) => c.kind !== 'rods'), go = all.filter((c) => !c.piece.locked);
    if (!go.length) { app.say(all.length ? FROZEN : ''); return; }
    app.pick(null);
    app.change(() => {
      for (const kind of ['screws', 'hooks', 'crosslinks']) { const gone = new Set(go.filter((c) => c.kind === kind).map((c) => c.piece)); if (gone.size) hw()[kind] = hw()[kind].filter((p) => !gone.has(p)); }
      fitRods(app.spine);
    }, { ride: false });
    app.say(go.length < all.length ? 'The frozen parts were kept.' : '');
  }
  $('pieceRemove').addEventListener('click', removeChosen);
  $('pieceDone').addEventListener('click', () => app.pick(null));
  const again = (settle) => app.change(() => {}, { settle, ride: false });
  const thick = dial('pieceThick', 'pieceThickN', (v) => { const s = pieceOf(); if (s && app.picked.kind === 'screws') { resizeScrew(s, v, 0); again(false); } });
  const long = dial('pieceLong', 'pieceLongN', (v) => { const s = pieceOf(); if (s && app.picked.kind === 'screws') { resizeScrew(s, 0, v); again(false); } });
  const rodThick = dial('rodThick', 'rodThickN', (v) => { const r = pieceOf(); if (r && app.picked.kind === 'rods') { r.diameter = v; again(false); } });
  // a colour for the selected parts, or none to give them back the colour of their kind
  const colored = (name) => { const all = chosen(); if (!all.length) return; for (const c of all) { if (name) c.piece.color = name; else delete c.piece.color; } again(true); };
  each('[data-face]', (b) => b.addEventListener('click', () => {
    const hooks = chosen().filter((c) => c.kind === 'hooks' && !c.piece.locked);
    if (hooks.length) app.change(() => hooks.forEach((c) => faceHook(app.spine, c.piece, b.dataset.face)), { ride: false });
  }));
  $('rodUnbend').addEventListener('click', () => { const r = pieceOf(); if (r && app.picked.kind === 'rods') app.change(() => unbendRod(app.spine, r), { ride: false }); });
  $('inLineOn').addEventListener('change', guard);
  $('pieceLocked').addEventListener('change', () => { const all = chosen(); for (const c of all) { if ($('pieceLocked').checked) c.piece.locked = true; else delete c.piece.locked; } again(true); });
  // the place of a part typed in as numbers: the whole part moves by the difference
  const spotOf = (part) => part.head || part.at;
  ['posX', 'posY', 'posZ'].forEach((id, j) => $(id).addEventListener('change', () => {
    const part = pieceOf(), v = parseFloat($(id).value);
    if (!part || !spotOf(part) || !Number.isFinite(v) || part.locked) return;
    const step = [0, 0, 0];
    step[j] = v - spotOf(part)[j];
    app.change(() => { if (app.inLine) moveInLine(app.spine, part, step); else for (const key of ['head', 'entry', 'tip', 'at', 'mid']) if (part[key]) part[key] = part[key].map((x, k) => round1(x + step[k])); fitRods(app.spine); }, { ride: false });
  }));

  function pieceBox() {
    const all = chosen(), p = pieceOf(), kind = p ? app.picked.kind : '', many = all.length > 1, lone = many ? null : p;
    const word = (k) => PART_NAMES[k].toLowerCase(), plural = { screws: 'screws', hooks: 'hooks', crosslinks: 'cross-links', rods: 'rods' };
    $('pickHint').hidden = !!app.picked;
    $('pieceBox').hidden = !p || (kind === 'rods' && !many); $('rodBox').hidden = kind !== 'rods' || many;
    if (!p) return;
    const kinds = [...new Set(all.map((c) => c.kind))], shared = all.every((c) => (c.piece.color || '') === (all[0].piece.color || '')) ? all[0].piece.color || '' : null;
    if (kind === 'rods' && !many) {
      const bends = (p.via || []).length;
      $('rodName').textContent = 'Rod, ' + p.side + ' side' + (!p.auto ? ', traced from a scan' : bends ? ', bent by hand in ' + bends + (bends === 1 ? ' place' : ' places') : '');
      rodThick(p.diameter || 5.5);
      swatches($('rodColors'), 'This rod', p.color || '', colored, true);
      swatches($('rodKindColors'), 'All rods', easy.kindColor('rods'), (name) => easy.setKindColor('rods', name));
      $('rodUnbend').disabled = !bends;
      return;
    }
    const frozen = all.some((c) => c.piece.locked);
    $('pieceName').textContent = many ? all.length + ' parts selected' : PART_NAMES[kind] + (p.level ? ' at ' + p.level : '') + (p.side ? ', ' + p.side + ' side' : '');
    $('pieceHow').textContent = many ? 'What you set here goes for all of them. Drag one of the screws or hooks along the spine and the others move with it.' : frozen ? 'Frozen: it stays as it is until that is unticked under Full control.' : kind === 'crosslinks' ? (app.level === 'easy' ? 'It sits between the two rods.' : 'Drag its arrow to slide it along the rods.') : app.level === 'easy' ? 'Drag it over the bone to move it.' : 'Drag it over the bone, or drag its arrows for small steps.';
    $('pieceThickRow').hidden = $('pieceLongRow').hidden = !lone || kind !== 'screws';
    if (lone && kind === 'screws') { thick(p.diameter || 5); long(screwLength(p)); }
    const hooks = all.filter((c) => c.kind === 'hooks');
    $('pieceFaceRow').hidden = hooks.length !== all.length;
    pressed('[data-face]', 'face', hooks.length && hooks.every((c) => (c.piece.faces || 'down') === (hooks[0].piece.faces || 'down')) ? hooks[0].piece.faces || 'down' : 'none');
    swatches($('pieceColors'), many ? 'These parts' : 'This ' + word(kind), shared === null ? '?' : shared, colored, true);
    $('pieceKindColors').hidden = kinds.length !== 1;
    if (kinds.length === 1) swatches($('pieceKindColors'), 'All ' + plural[kinds[0]], easy.kindColor(kinds[0]), (name) => easy.setKindColor(kinds[0], name));
    $('piecePlace').hidden = false;
    const at = lone && spotOf(lone);
    $('posX').parentElement.parentElement.hidden = !at;
    if (at) ['posX', 'posY', 'posZ'].forEach((id, j) => { if (document.activeElement !== $(id)) $(id).value = at[j]; $(id).disabled = !!lone.locked; });
    $('pieceLocked').checked = all.every((c) => c.piece.locked); $('pieceLocked').indeterminate = frozen && !$('pieceLocked').checked;
    $('pieceRemove').textContent = many ? 'Remove these parts' : 'Remove this ' + word(kind);
  }

  // Dragging a screw or a hook over the bone. With snapping it hops from one usual spot to
  // the next. Without, it sits where the pointer is on the bone.
  function dragPart(e) {
    const { kind, index } = drag.part, part = hw()[kind][index], hit = hitLevel({ clientX: e.clientX - drag.off[0], clientY: e.clientY - drag.off[1] });
    if (!part || !hit) return;
    if (part.locked) { app.say(FROZEN); return; }
    const frame = levelFrame(hit.level), side = toLocal(hit.point, hit.level.centre, frame)[0] >= 0 ? 'left' : 'right';
    // several screws and hooks are selected and one of them is dragged: they all move along the spine together, vertebra by vertebra
    const group = chosen().filter((c) => c.kind === 'screws' || c.kind === 'hooks').map((c) => c.piece);
    if (group.length > 1 && group.includes(part)) {
      if (snapping()) {
        const list = ids(), by = list.indexOf(hit.level.id) - list.indexOf(part.level);
        if (!by) return;
        let went = false;
        live(() => { went = shiftParts(app.spine, group, by); }, false);
        app.say(went ? '' : 'There is no room for all of them there: a part that is not selected is in the way, one of them is frozen, or the spine ends.');
        return;
      }
      app.say('With snapping off, parts are moved one at a time.');
    }
    let next;
    if (snapping()) {
      if (hit.level.id === 'C1' || (part.level === hit.level.id && part.side === side) || [...hw().screws, ...hw().hooks].some((p) => p !== part && p.level === hit.level.id && p.side === side)) return;
      const spot = slot(hit.level, side, part.faces || 'down');
      next = kind === 'screws' ? { level: hit.level.id, side, ...spot.screw, diameter: part.diameter } : { level: hit.level.id, side, ...spot.hook };
    } else if (kind === 'screws') {
      const f = freeScrew(hit.level, hit.point);
      next = { level: f.level, side: f.side, head: f.head, entry: f.entry, tip: f.tip };
    } else next = hookAt(hit.level, vAdd(hit.point, vScale(frame.back, 6)), side, part.faces || 'down');
    app.picked = { kind, index };
    let went = true;
    live(() => { went = placePiece(app.spine, part, next, app.inLine); }, false);
    app.say(went ? '' : 'The rod could not follow it there. Untick "Keep rods believable" to place it anyway.');
  }
  // Dragging a rod between two of its parts bends it there: the rod is made to pass through
  // the spot under the pointer.
  function dragRod(e) {
    const rod = hw().rods.find((r) => r.id === drag.rod);
    if (!rod) return;
    const ray = renderer.ray(e.clientX, e.clientY), t = vDot(vSub(drag.at, ray.origin), drag.facing) / vDot(ray.direction, drag.facing);
    if (!(t > 0)) return;
    const at = vAdd(ray.origin, vScale(ray.direction, t));
    let via = -1;
    live(() => { via = bendRod(app.spine, rod, at, drag.via, app.inLine); }, false);
    drag.via = via;
    const now = hw().rods.find((r) => r.id === drag.rod);
    app.picked = { kind: 'rods', index: hw().rods.indexOf(now) };
    app.say(via < 0 ? 'A rod can be bent between its two ends, not beyond them.' : vDist(now.via[via], at) > 1.5 ? 'That is as far as a rod bends there. Untick "Keep rods believable" to bend it further.' : '');
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
  $('markLabelBack').addEventListener('click', () => { const m = markOf(); if (m && m.label) { delete m.label; again(true); } });
  // The label of a mark can be dragged off its spot, so the words do not cover it. It keeps
  // its new place in space and a line joins it to the mark.
  let tagDrag = null;
  $('tags').addEventListener('pointerdown', (e) => {
    const el = e.target.closest ? e.target.closest('span[data-mark]') : null, index = el ? Number(el.dataset.mark) : -1, m = el && app.spine.marks[index];
    if (!m || tab !== 'marks') return;
    e.preventDefault();
    const spot = markSpot(m), scale = renderer.screenScale(spot), box = $('view').getBoundingClientRect(), r = el.getBoundingClientRect(), p = renderer.project(spot);
    // where the label is now, as a point in space: its own, or the place above the mark where it is drawn
    const from = m.label || [0, 1, 2].map((j) => spot[j] + (scale.right[j] * (r.left + r.width / 2 - box.left - p[0]) - scale.up[j] * (r.top + r.height / 2 - box.top - p[1])) * scale.perPixel);
    tagDrag = { index, from, x: e.clientX, y: e.clientY, scale, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!tagDrag) return;
    const dx = e.clientX - tagDrag.x, dy = e.clientY - tagDrag.y, m = app.spine.marks[tagDrag.index], sc = tagDrag.scale;
    if (!m || (!tagDrag.moved && Math.hypot(dx, dy) < 4)) return;
    tagDrag.moved = true;
    live(() => { m.label = tagDrag.from.map((v, j) => round1(v + (sc.right[j] * dx - sc.up[j] * dy) * sc.perPixel)); }, false);
  });
  const dropTag = () => { if (!tagDrag) return; const was = tagDrag; tagDrag = null; if (was.moved) app.settle(); app.pick({ kind: 'marks', index: was.index }); };
  window.addEventListener('pointerup', dropTag); window.addEventListener('pointercancel', dropTag);

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
    $('markLabelBack').hidden = !m.label;
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
      // (no up arrow where there is no space to change: the bottom vertebra, and one fused to the one below)
      const block = blockOf(app.spine, app.rig, l.id), lift = ids().indexOf(l.id) < ids().length - 1 && !(block && block.bottom !== l.id);
      if (tool.one === 'move') return set(l.centre, { left: 'double', back: 'double', ...(lift ? { up: 'arrow' } : {}) });
      if (tool.one === 'turn') return set(l.centre, { left: 'ring', back: 'ring', up: 'ring' });
      const f = levelFrame(l);
      return { spec: { at: l.centre, handles: [{ name: 'left', kind: 'knob', axis: f.left }, { name: 'back', kind: 'knob', axis: f.back }, { name: 'up', kind: 'knob', axis: f.up }] }, active: (drag && drag.name) || hot };
    }
    if (tab === 'shape' && s) return set(tool.stretch === 'bow' ? middle(s).centre : levelOf(s.top).centre, { left: 'double', back: 'double' });
    if (tab === 'marks' && m) return set(markSpot(m), { left: 'double', back: 'double', up: 'double' });
    const part = pieceOf();
    if (tab === 'parts' && app.level !== 'easy' && part && app.picked.kind !== 'rods' && !(app.also || []).length) return app.picked.kind === 'crosslinks' ? set(vLerp(part.from, part.to, 0.5), { up: 'double' }) : set(part.head || part.at, { left: 'double', back: 'double', up: 'double' });
    return null;
  }

  // What one step of a drag does. "name" is the handle (left, back, up), "by" how far along it
  // in millimetres, "turn" how far round it in degrees.
  function pull(name, by, turn) {
    const l = one(), s = stretch(), m = markOf(), part = pieceOf(), spine = app.spine, rig = app.rig;
    if (tab === 'parts' && part) {
      if (part.locked) { app.say(FROZEN); return; }
      // a part moves as a whole; the rods on its side are drawn again through it
      const j = { left: 0, back: 1, up: 2 }[name];
      live(() => {
        if (app.picked.kind === 'crosslinks') {
          const link = crosslinkAt(spine, (part.from[2] + part.to[2]) / 2 + by);
          if (link) { part.from = link.from; part.to = link.to; part.level = link.level; delete part.below; }
        } else {
          const step = [0, 0, 0];
          step[j] = by;
          if (app.inLine) moveInLine(spine, part, step);
          else for (const key of ['head', 'entry', 'tip', 'at', 'mid']) if (part[key]) part[key] = part[key].map((v, k) => round1(v + step[k]));
          fitRods(spine);
        }
      }, false);
    } else if (tab === 'marks' && m) {
      const j = { left: 0, back: 1, up: 2 }[name];
      live(() => { for (const key of ['at', 'from', 'to']) if (m[key]) m[key][j] = round1(m[key][j] + by); }, false);
    } else if (l && tool.one === 'move') {
      const soft = opt('softOn');
      live(() => { if (name === 'up') liftLevel(spine, rig, l.id, by); else if (soft) pullLevel(spine, rig, l.id, name === 'left' ? by : 0, name === 'back' ? by : 0); else moveAlone(spine, rig, l.id, name === 'left' ? by : 0, name === 'back' ? by : 0); });
    } else if (l && tool.one === 'turn') {
      live(() => turned(l, (x) => { if (name === 'up') x.turn += turn; else if (name === 'back') x.tilt[0] = Math.max(-80, Math.min(80, x.tilt[0] + turn)); else x.tilt[1] = Math.max(-80, Math.min(80, x.tilt[1] - turn)); }));
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
      // a rod is thin and runs behind its screws: it is only taken when nothing else is under the pointer
      if (!hw().norods) hw().rods.forEach((rod, index) => rod.points.forEach((p) => at.push({ kind: 'rods', index, p, r: 4.2, behind: 14 })));
    }
    let best = null;
    for (const c of at) { const near = rayPoint(ray.origin, ray.direction, c.p), rank = near.along + (c.behind || 0); if (near.off <= c.r && near.along > 0 && (!best || rank < best.rank)) best = { ...c, rank }; }
    return best && { kind: best.kind, index: best.index, at: best.p };
  }

  let hovering = null, hoverFrame = null;
  function tap(e) {
    if (!app.spine) return;
    if (placing) { place(e); return; }
    if (marking) { addMark(e); return; }
    if (tab === 'parts') {
      if (easy.picking()) { easy.tap(e); return; }
      // a click on a part selects it (with Shift, or "select several", along with the others). A click on bone picks that vertebra.
      const what = hitThing(e, false), hit = what ? null : hitLevel(e);
      // with the rod tool in hand, a click on a screw or a hook starts or ends a rod there, and a click on a rod ends it there
      if (easy.rodTap(what)) return;
      // a click on one of the soft marks puts the part of the tool in hand there (a rod that runs behind a mark does not get in the way)
      if ((!what || what.kind === 'rods') && easy.putOnModel(null, e)) { app.pick(null); app.settle(); return; }
      if (what) { pickPart(what, app.level !== 'easy' && (e.shiftKey || $('multiOn').checked)); return; }
      // the clicked vertebra and its block on the map light up together, so it is clear which block is which bone
      if (hit) app.flash(hit.level.id, true);
      // at the Easy level a click on bone puts the part of the current step there
      if (app.level === 'easy') { app.pick(null); if (hit && easy.putOnModel(hit, e)) app.settle(); return; }
      app.pick(hit ? { kind: 'level', id: hit.level.id } : null);
      const row = hit && full() && $('sheetFold').open && document.querySelector('#sheet tr[data-level="' + hit.level.id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (tab === 'marks') { const m = hitThing(e, true); app.pick(m && { kind: m.kind, index: m.index }); return; }
    if (tab !== 'shape') return;
    const hit = hitLevel(e), id = hit && hit.level.id, list = ids(), p = app.picked || {};
    if (chart.picking()) { if (id) chart.tapLock(id); return; }
    // the clicked vertebra and its block on the chart light up together, so it is clear which block is which bone
    if (id) app.flash(id, true);
    if (mode === 'blocks') return;
    // while the curve is drawn, a click on a vertebra opens the fine work on it
    if (mode === 'draw') { if (id && app.level !== 'easy' && !chart.lineOn()) { mode = 'one'; app.pick({ kind: 'level', id }); } return; }
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
      if (!app.spine) return false;
      if (easy.draw.on()) return easy.draw.down(e);
      if (placing || marking) return false;
      // (a press right on the picked screw or hook drags the part itself, not one of its arrows)
      const h = handles(), box = renderer.canvas.getBoundingClientRect(), mid = h && tab === 'parts' && renderer.project(h.spec.at);
      const onPart = mid && Math.hypot(mid[0] + box.left - e.clientX, mid[1] + box.top - e.clientY) < (e.pointerType === 'touch' ? 16 : 10);
      const grabbed = h && !onPart && gizmoHit(h.spec, renderer, e.clientX, e.clientY, e.pointerType === 'touch' ? 24 : 13);
      if (grabbed) { drag = { name: grabbed.handle.name, ring: grabbed.handle.kind === 'ring', grab: grabbed.grab, dx: 0, dy: 0, moved: false }; app.redraw(); return true; }
      if (tab === 'parts') {
        // a press on a screw or a hook grabs it, a press on a rod grabs the rod there (bending is for Standard and up)
        const what = hitThing(e, false), ray = renderer.ray(e.clientX, e.clientY), sel = chosen();
        // (while several parts are being selected a press does not grab, so the model can be turned. But a press on one of several selected parts grabs them all.)
        const inGroup = what && sel.length > 1 && sel.some((c) => c.kind === what.kind && c.index === what.index);
        if (easy.picking() || ((e.shiftKey || (app.level !== 'easy' && $('multiOn').checked)) && !inGroup)) return false;
        if (what && (what.kind === 'screws' || what.kind === 'hooks')) {
          // (the part keeps its place under the pointer: the spot where it meets the bone stays as far from the pointer as it was at the press)
          const part = hw()[what.kind][what.index], foot = renderer.project(part.entry || part.at);
          drag = { part: what, off: foot ? [e.clientX - foot[0] - box.left, e.clientY - foot[1] - box.top] : [0, 0], dx: 0, dy: 0, moved: false };
          return true;
        }
        if (what && what.kind === 'rods' && app.level !== 'easy' && hw().rods[what.index].auto) {
          const rod = hw().rods[what.index], via = (rod.via || []).findIndex((p) => rayPoint(ray.origin, ray.direction, p).off < 6);
          drag = { rod: rod.id, via, at: via >= 0 ? rod.via[via] : what.at, facing: ray.direction, dx: 0, dy: 0, moved: false };
          return true;
        }
        return false;
      }
      if (tab !== 'shape') return false;
      const hit = hitLevel(e), l = one(), s = stretch(), list = ids();
      if (!hit) return false;
      const i = list.indexOf(hit.level.id), body = l && tool.one === 'move' && hit.level.id === l.id ? 'one' : s && i > list.indexOf(s.top) && i < list.indexOf(s.bottom) ? 'bow' : s && hit.level.id === s.top ? 'offset' : null;
      if (!body) return false;
      drag = { body, dx: 0, dy: 0, moved: false, at: hit.level.centre };
      return true;
    },
    move(e, dx, dy) {
      if (easy.draw.on()) { easy.draw.move(e); return; }
      if (!drag) return;
      drag.dx += dx; drag.dy += dy; drag.e = e;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) < 3 && !drag.moved) return;
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (!drag) return;
        const h = handles(), dx2 = drag.dx, dy2 = drag.dy;
        drag.dx = drag.dy = 0; drag.moved = true;
        if (drag.part) dragPart(drag.e);
        else if (drag.rod) dragRod(drag.e);
        else if (drag.name) {
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
      if (easy.draw.on()) { easy.draw.up(e); return; }
      const was = drag; drag = null;
      if (was && was.moved) app.settle(); else { if (was && was.name) app.redraw(); if (e.type === 'pointerup' && !(was && was.name)) tap(e); }
    },
    tap,
    // light up the handle under the pointer
    hover(e) {
      const h = handles(), over = h && gizmoHit(h.spec, renderer, e.clientX, e.clientY), name = over ? over.handle.name : null;
      if (name !== hot) { hot = name; $('view').style.cursor = name ? 'grab' : ''; app.redraw(); }
      // while the map or the chart of blocks is open, the block of the bone under the pointer is marked there
      if (!app.spine || e.pointerType === 'touch' || !(tab === 'parts' || (tab === 'shape' && mode === 'blocks'))) { app.peek(null); return; }
      hovering = e;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = null; const hit = hitLevel(hovering); app.peek(hit ? hit.level.id : null); });
    },
  });

  function sync() {
    if (!app.spine) return;
    pressed('[data-mode]', 'mode', mode);
    $('drawBox').hidden = mode !== 'draw'; $('blocksBox').hidden = mode !== 'blocks'; $('oneBox').hidden = mode !== 'one'; $('stretchBox').hidden = mode !== 'stretch';
    $('lockBox').hidden = mode !== 'draw' && mode !== 'blocks';
    $('fieldBar').hidden = tab !== 'parts';             // the box of hardware controls floats over the model while that tab is open
    oneBox(); stretchBox(); fusedBox(); sheet(); pieceBox(); markBox(); easy.sync(); chart.sync(); hint(); guideNav();
  }

  const easy = setupEasy(app, { $, each, pressed, options, ids, levelOf, hitLevel, hint, chosen, pickPart, stepped: () => guideNav(), held: () => chart.held(), stopLine: () => { chart.stopLine(); chart.stopPicking(); }, lineOn: () => chart.lineOn() });
  const chart = setupChart(app, { $, each, pressed, options, ids, levelOf, hint, stopOthers: () => easy.stopDrawing(), drawing: () => easy.draw.on() });
  $('presetBtn').addEventListener('click', () => $('galleryBtn').click());
  setLevel(app.level);
  showTab('shape');
  return {
    sync, handles,
    // a new spine was opened, or Undo went back: drop whatever was being placed
    setLevel,
    // the soft marks on the model that show where the tool in hand can be used (only while the Hardware tab is open)
    hints: () => (tab === 'parts' && !placing && !marking ? easy.hints() : null),
    // a spine was opened: the steps of the Easy level start over for it
    opened() { easy.opened(); },
    // the layout was changed (the phone and tablet one, or the desktop one): move what has another place in it, and use the tools that go with it
    layout() { setMore(false); setLevel(app.level); showTab(tab); if (app.spine) sync(); },
    // open a step or a tab by its name
    go(name) { showTab(name); if (app.spine) sync(); },
    reset() { easy.stopDrawing(); easy.stopPicking(); chart.stopLine(); chart.stopPicking(); placing = marking = null; hot = null; pressed('[data-part]', 'part', null); pressed('[data-mark]', 'mark', null); $('stage').classList.remove('placing'); },
    // select a stretch and open the Shape tab on it (the list of curves does this)
    // the vertebra under a point of the page, if there is one (the checks in a browser use this)
    levelAt(clientX, clientY) { const hit = hitLevel({ clientX, clientY }); return hit ? hit.level.id : null; },
    // the kind of part under a point of the page ('screws', 'hooks', 'crosslinks', 'rods'), if there is one
    // is one of the soft marks under a point of the page? (the checks in a browser use this)
    markAt(clientX, clientY) { return easy.markAt({ clientX, clientY }); },
    thingAt(clientX, clientY) { const what = hitThing({ clientX, clientY }, false); return what ? what.kind : null; },
    workOn(top, bottom, which) { mode = 'stretch'; tool.stretch = 'bow'; plane = which; if (tab !== 'shape') showTab('shape'); app.pick({ kind: 'stretch', top, bottom }); },
  };
}
