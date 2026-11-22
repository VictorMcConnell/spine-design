// The builder. There are four things to work on: the shape of the spine, its hardware, pain
// points and notes, and the look. Each has a few tools, and one tool is in hand at a time:
//   Shape:    Turn, Draw, Curve (sliders for a part of the spine), Points, One bone, Lock, X-ray (trace over a picture)
//   Hardware: Turn, Screw, Hook, Link, Rod, Erase
//   Pain:     Turn, Pain point, Note
// A tool that works with sliders, and anything that is selected, shows a card. Everything
// changes the spine through app.change, which redraws, moves the hardware with the bones and
// keeps the history for Undo. The tools that draw and tap are in easy.js and chart.js.

import { sortedLevels } from '../core/spinefile.js';
import { vertebraShape, levelFrame, discParts, discMesh } from '../core/bones.js';
import { setDisc, discAt, discKeys, discWords, DISC_SIZED, DISC_AIMED } from '../core/discs.js';
import { setFracture, canBreak, fractureWords, setWear, wearWords, setArch, archWords } from '../core/fractures.js';
import { ANATOMY } from '../core/anatomy.js';
import { pullLevel, liftLevel, gapUnder, restack, toLocal, bowOf, setBow, offsetOf, setOffset, twistOf, setTwist, straighten, blockOf, pivotAt } from '../core/shape.js';
import { slot, resizeScrew, screwLength, fitRods, fusedBelow, setFusedBelow, placePiece, retypePiece, bendRod, unbendRod, shiftParts, rodSets } from '../core/place.js';
import { measureSpine } from '../core/measures.js';
import { rayMesh, rayPoint } from '../core/pick.js';
import { gizmoHit, dragAlong, dragAround } from '../view/gizmo.js';
import { vAdd, vSub, vScale, vLerp, vDist, vDot } from '../core/vec.js';
import { setupEasy, swatches } from './easy.js';
import { PALETTES, FINISHES } from '../core/finish.js';
import { PART_KINDS, KINDS, FREEZING, kindOf, typeOf, CATEGORIES, categoryOf, tilesOf } from '../parts/kinds.js';
import { catalogue, icon } from './grid.js';
import { setupChart } from './chart.js';
import { setupXray } from './xray.js';

const PART_NAMES = Object.fromEntries(PART_KINDS.map((p) => [p.kind, p.name]));
const AXES = { left: [1, 0, 0], back: [0, 1, 0], up: [0, 0, 1] };
const DEG = 180 / Math.PI;
// the parts of the spine that can be picked as a whole: the letters their vertebrae start with
const REGIONS = { neck: /^C/, chest: /^T/, low: /^L/ };
// which tool of the hardware is which tool of the map (see easy.js)
const MAP_TOOL = { turn: 'none', screw: 'screw', link: 'link', rod: 'rod', erase: 'erase', disc: 'none', bone: 'none' };

export function setupBuilder(app) {
  const { $, renderer } = app;
  // tab:  what is being worked on ('shape', 'parts' for the hardware, 'marks' for pain and notes, 'look')
  // hand: the tool in hand for each of them        how: what the handles on the model do for one bone and for a stretch
  let tab = 'shape', marking = null, drag = null, pending = null, hot = null, hookFace = 'down', screwLook = 'standard', discState = 'bulging', boneTile = 'bone-wedge', both = true, filling = false, stripWas = '', cardWas = null, cat = 'side', shots = null;
  const hand = { shape: 'draw', parts: 'screw', marks: 'pain' }, how = { one: 'move', stretch: 'bow' };
  const stripOn = { shape: false, parts: true };
  const levels = () => sortedLevels(app.spine), ids = () => levels().map((l) => l.id);
  const levelOf = (id) => app.spine.levels.find((l) => l.id === id);
  const hw = () => app.spine.hardware;
  const round1 = (v) => Math.round(v * 10) / 10;
  const each = (selector, fn) => document.querySelectorAll(selector).forEach(fn);
  const pressed = (selector, key, value) => each(selector, (b) => b.setAttribute('aria-pressed', b.dataset[key] === String(value) ? 'true' : 'false'));
  // a wide screen has the cards in a column beside the model, a narrow one has them in place of the tools
  const WIDE = window.matchMedia('(min-width: 900px) and (min-height: 560px)'), COARSE = window.matchMedia('(pointer: coarse)');
  const wide = () => WIDE.matches, touch = () => COARSE.matches;
  const Press = () => (touch() ? 'Tap' : 'Click'), press = () => (touch() ? 'tap' : 'click');

  // what is selected, in the builder's own words
  const one = () => (app.picked && app.picked.kind === 'level' ? levelOf(app.picked.id) : null);
  const stretch = () => (app.picked && app.picked.kind === 'stretch' && app.picked.top && app.picked.bottom ? app.picked : null);
  const markOf = () => (app.picked && app.picked.kind === 'marks' ? app.spine.marks[app.picked.index] : null);
  const pieceOf = () => (app.picked && PART_NAMES[app.picked.kind] ? hw()[app.picked.kind][app.picked.index] : null);
  // every part that is selected: the picked one first, then the ones selected along with it
  const chosen = () => [app.picked, ...(app.also || [])].filter((p) => p && PART_NAMES[p.kind] && hw()[p.kind][p.index]).map((p) => ({ kind: p.kind, index: p.index, piece: hw()[p.kind][p.index] }));
  const middle = (s) => { const list = ids(); return levelOf(list[Math.round((list.indexOf(s.top) + list.indexOf(s.bottom)) / 2)]); };
  const markSpot = (m) => m.at || vLerp(m.from, m.to, 0.5);

  // ---------------------------------------------------------------- parts of the spine
  // The vertebrae of the neck, the chest or the low back, from the top down. "whole" is the chest and the low back together.
  function regionIds(name) {
    const list = ids();
    if (name !== 'whole') return list.filter((id) => REGIONS[name].test(id));
    const lows = list.filter((id) => /^[TL]/.test(id));
    return lows.length > 1 ? lows : list;
  }
  const regionEnds = (name) => { const part = regionIds(name); return part.length > 1 ? { kind: 'stretch', top: part[0], bottom: part[part.length - 1] } : null; };
  // The stretch the Curve tool starts with: the largest sideways curve there is, or the chest.
  function firstStretch() {
    const curves = measureSpine(app.spine).curves.slice().sort((a, b) => b.degrees - a.degrees);
    return curves.length ? { kind: 'stretch', top: curves[0].top, bottom: curves[0].bottom } : regionEnds('chest') || regionEnds('whole');
  }

  // ---------------------------------------------------------------- what to work on, and the tool in hand
  function showTab(name) {
    const was = tab;
    tab = name;
    document.body.dataset.at = name;      // (for the styles: what is open)
    each('#modes [data-tab]', (b) => { if (b.dataset.tab === name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    each('#tray [data-tools]', (g) => { g.hidden = g.dataset.tools !== name; });
    filling = false; hot = null;
    app.showStiff = name === 'shape';
    $('stage').classList.toggle('tagsLive', name === 'marks');
    if (!app.spine) return;
    // what was selected belongs to the place that was left
    if (was !== name) { app.picked = null; app.also = []; }
    if (name === 'shape' && hand.shape === 'curve' && !app.picked) app.picked = firstStretch();
    arm();
    // the hardware goes on from the back: turn the model that way if it is seen from somewhere else
    if (name === 'parts' && was !== 'parts') { const a = Math.atan2(Math.sin(renderer.camera.around), Math.cos(renderer.camera.around)); if (Math.abs(a) > 1 || Math.abs(renderer.camera.tilt) > 0.9) renderer.look(0); }
    if (name === 'look') app.thumbs();
    if (name === 'parts') picturesSoon();
    // (what was compared on the Story place is over when it is left)
    if (was === 'story' && name !== 'story' && story) story.left();
    app.redraw(); sync();
  }
  each('#modes [data-tab]', (b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Make the tool in hand ready: what a press on the model does from now on.
  function arm() {
    easy.stopDrawing(); chart.stopLine(); chart.stopPicking(); easy.stopPicking(); xray.stop();
    marking = null;
    const t = hand[tab];
    if (tab === 'shape') { if (t === 'draw') easy.startDrawing(); else if (t === 'points') chart.startLine(); else if (t === 'lock') chart.setPicking(true); else if (t === 'xray') xray.start(); }
    else if (tab === 'parts') easy.setTool(t === 'hook' ? 'hook-' + hookFace : MAP_TOOL[t]);
    else if (tab === 'marks') marking = t === 'turn' ? null : t;
    $('stage').classList.toggle('placing', (tab === 'shape' && t === 'lock') || (tab === 'parts' && t !== 'turn') || (tab === 'marks' && t !== 'turn'));
  }
  function pickTool(name) {
    if (!(tab in hand) || !document.querySelector('#tray [data-tools="' + tab + '"] [data-t="' + name + '"]')) return;
    const p = app.picked;
    hand[tab] = name; filling = false; app.also = [];
    // the selection goes over to the new tool where it can: a stretch gives its top vertebra to One bone, the rest is dropped
    if (tab === 'shape' && name === 'curve') app.picked = p && p.kind === 'stretch' ? p : firstStretch();
    else if (tab === 'shape' && name === 'one') app.picked = p && p.kind === 'level' ? p : p && p.kind === 'stretch' && p.top ? { kind: 'level', id: p.top } : null;
    else app.picked = null;
    app.say('');
    arm();
    app.redraw(); sync();
  }
  each('#tray [data-t]', (b) => b.addEventListener('click', () => pickTool(b.dataset.t)));
  each('[data-hook]', (b) => b.addEventListener('click', () => { hookFace = b.dataset.hook; arm(); sync(); }));
  $('bothBtn').addEventListener('click', () => { both = !both; sync(); });
  $('fillBtn').addEventListener('click', () => { filling = true; app.pick(null); });
  // "Done" on a card: a tool that works in its card is put down, a selection is let go
  each('[data-done]', (b) => b.addEventListener('click', () => {
    const card = b.closest('[data-card]').dataset.card;
    if (card === 'curve' || card === 'one' || card === 'xray') pickTool('turn');
    else if (card === 'fill') { filling = false; easy.stopPicking(); app.say(''); sync(); }
    else app.pick(null);
  }));
  // the flat view beside the model: the map of the hardware, or the blocks of the shape
  $('stripBtn').addEventListener('click', () => { if (tab in stripOn) { stripOn[tab] = !stripOn[tab]; sync(); } });

  const LOOK = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 };
  each('[data-look]', (b) => b.addEventListener('click', () => renderer.look(LOOK[b.dataset.look])));

  // A slider and a number box that show the same value. "live" runs while it moves, "done"
  // when it is let go.
  function dial(rangeId, numberId, live, done = () => app.settle()) {
    const range = $(rangeId), number = $(numberId), label = range.closest('label');
    if (label && label.firstChild) number.setAttribute('aria-label', label.firstChild.textContent.trim() + ', as a number');
    const from = (el) => () => { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; if (el !== range) range.value = v; if (el !== number) number.value = v; live(v); };
    range.addEventListener('input', from(range)); number.addEventListener('input', from(number));
    range.addEventListener('change', done); number.addEventListener('change', done);
    return (v, lo, hi) => { if (lo !== undefined) { range.min = lo; range.max = hi; number.min = lo; number.max = hi; } if (document.activeElement !== number) number.value = v; range.value = v; };
  }
  const options = (select, list, chosenValue) => {
    select.textContent = '';
    for (const [value, text] of list) { const o = document.createElement('option'); o.value = value; o.textContent = text; if (value === chosenValue) o.selected = true; select.appendChild(o); }
  };
  const live = (fn, ride = true) => app.change(fn, { settle: false, ride });

  // ---------------------------------------------------------------- shape: one vertebra
  const half = (v) => Math.round(v * 2) / 2;
  const typicalSize = (id) => { const a = ANATOMY[id] || ANATOMY.T6; return [a.w, a.d, half((a.hf + a.hb) / 2) || 9]; };
  // (a vertebra turned by hand leads the stiff block it is part of, and everything above it
  // comes along, as if the spine bent in that place)
  const turned = (l, set) => pivotAt(app.spine, app.rig, l.id, set);
  const turnTo = (set) => (v) => { const l = one(); if (l) live(() => turned(l, (x) => set(x, v))); };
  const sizeTo = (axis) => (v) => { const l = one(); if (l) { l.size[axis] = v; live(() => restack(app.spine, app.rig)); } };
  const gapDial = dial('gapR', 'gapN', (v) => { const l = one(); if (l) live(() => liftLevel(app.spine, app.rig, l.id, v - gapUnder(app.spine, app.rig, l.id))); });
  const angleDials = [dial('angF', 'angFn', turnTo((l, v) => { l.tilt[0] = v; })), dial('angS', 'angSn', turnTo((l, v) => { l.tilt[1] = v; })), dial('angT', 'angTn', turnTo((l, v) => { l.turn = v; }))];
  const sizeDials = [dial('sizeW', 'sizeWn', sizeTo(0)), dial('sizeD', 'sizeDn', sizeTo(1)), dial('sizeH', 'sizeHn', sizeTo(2))];
  $('angZero').addEventListener('click', () => { const l = one(); if (l) app.change(() => turned(l, (x) => { x.tilt[0] = 0; x.turn = 0; })); });
  $('boneTypical').addEventListener('click', () => { const l = one(); if (l) { l.size = typicalSize(l.id); app.change(() => restack(app.spine, app.rig)); } });
  const step = (by) => () => { const list = ids(), i = list.indexOf(app.picked && app.picked.id) + by; if (app.picked && i >= 0 && i < list.length) app.pick({ kind: 'level', id: list[i] }); };
  $('boneUp').addEventListener('click', step(-1)); $('boneDown').addEventListener('click', step(1));
  // (a vertebra can be picked by name too, without touching the model)
  $('bonePick').addEventListener('change', () => { const id = $('bonePick').value; app.pick(id ? { kind: 'level', id } : null); });
  each('#oneOn [data-tool]', (b) => b.addEventListener('click', () => { how.one = b.dataset.tool; app.pick(app.picked); }));

  function oneBox() {
    const l = one(), list = ids();
    $('oneOn').hidden = !l; $('oneHint').hidden = !!l;
    $('oneHint').textContent = Press() + ' a vertebra to pick it, or choose it by name.';
    options($('bonePick'), [['', 'Vertebra'], ...list.map((id) => [id, id])], l ? l.id : '');
    $('boneUp').disabled = !l || list.indexOf(l.id) === 0; $('boneDown').disabled = !l || list.indexOf(l.id) === list.length - 1;
    if (!l) return;
    pressed('#oneOn [data-tool]', 'tool', how.one);
    each('#oneOn [data-toolpane]', (p) => { p.hidden = p.dataset.toolpane !== how.one; });
    const last = ids().indexOf(l.id) === ids().length - 1, typ = typicalSize(l.id), block = blockOf(app.spine, app.rig, l.id);
    $('oneFused').hidden = !block;
    if (block) $('oneFused').textContent = l.id + ' is part of the fused stretch from ' + block.top + ' to ' + block.bottom + '. That stretch moves and turns as one block.';
    // a fused joint has no space to change
    $('gapRow').hidden = last || (!!block && block.bottom !== l.id);
    if (!last) gapDial(round1(gapUnder(app.spine, app.rig, l.id)));
    angleDials[0](round1(l.tilt[0])); angleDials[1](round1(l.tilt[1])); angleDials[2](round1(l.turn));
    sizeDials.forEach((set, i) => set(half(l.size[i]), Math.floor(typ[i] * 0.6), Math.ceil(typ[i] * 1.6)));
  }

  // ---------------------------------------------------------------- shape: the curve of a stretch
  // A stretch runs from one vertebra to another: a part of the spine picked by name, or any
  // two vertebrae tapped on the model. Four sliders bend it. What they show: sideways, to
  // the right is plus. Front to back, rounded backward is plus.
  const shown = {
    bow: (s, plane) => bowOf(app.spine, s.top, s.bottom, plane),
    offset: (s) => -offsetOf(app.spine, s.top, s.bottom, 0),
    twist: (s) => -twistOf(app.spine, s.top, s.bottom),
  };
  const bowDials = [0, 1].map((plane) => dial('bow' + plane + 'R', 'bow' + plane + 'N', (v) => { const s = stretch(); if (s) { live(() => setBow(app.spine, app.rig, s.top, s.bottom, plane, v)); curveSays(); } }));
  const twistDial = dial('twistR', 'twistN', (v) => { const s = stretch(); if (s) { live(() => setTwist(app.spine, app.rig, s.top, s.bottom, -v)); curveSays(); } });
  const offDial = dial('offR', 'offN', (v) => { const s = stretch(); if (s) { live(() => setOffset(app.spine, app.rig, s.top, s.bottom, 0, -v)); curveSays(); } });
  // the sliders in words
  function curveSays() {
    const s = stretch();
    if (!s) return;
    const side = (v, none, unit) => (Math.abs(v) < 1 ? none : Math.abs(v) + unit + ' to the ' + (v > 0 ? 'right' : 'left'));
    const b = Math.round(shown.bow(s, 0)), r = Math.round(shown.bow(s, 1));
    $('bow0Say').textContent = side(b, 'straight', '°');
    $('bow1Say').textContent = Math.abs(r) < 1 ? 'flat' : Math.abs(r) + '° ' + (r > 0 ? 'rounded' : 'hollow');
    $('twistSay').textContent = side(Math.round(shown.twist(s)), 'none', '°');
    $('offSay').textContent = side(Math.round(shown.offset(s)), 'none', ' mm');
    for (const k of ['bow0', 'bow1', 'twist', 'off']) $(k + 'R').setAttribute('aria-valuetext', $(k + 'Say').textContent);
  }
  const sorted = (a, b) => { const list = ids(); return list.indexOf(a) < list.indexOf(b) ? { kind: 'stretch', top: a, bottom: b } : { kind: 'stretch', top: b, bottom: a }; };
  const pickEnds = () => { const top = $('strTop').value, bottom = $('strBottom').value; app.pick(top && bottom && top !== bottom ? sorted(top, bottom) : { kind: 'stretch', top: top || bottom || null, bottom: null }); };
  $('strTop').addEventListener('change', pickEnds); $('strBottom').addEventListener('change', pickEnds);
  each('[data-region]', (b) => b.addEventListener('click', () => { const ends = regionEnds(b.dataset.region); if (ends) app.pick(ends); }));
  $('straighten').addEventListener('click', () => {
    app.change(() => straighten(app.spine, app.rig));
    const kept = (app.rig.blocks || []).length && levels().some((l) => Math.abs(l.tilt[0]) > 0.5 || Math.abs(l.turn) > 0.5);
    app.say(kept ? 'The fused part kept its shape.' : '');
  });
  // Which stretches are fused is said here, or with the hardware. A fused stretch keeps its shape while the rest is bent.
  const fuseRange = (top, bottom, on) => { const list = ids(), a = list.indexOf(top), b = list.indexOf(bottom); app.change(() => { for (let i = Math.min(a, b); i < Math.max(a, b); i++) setFusedBelow(app.spine, list[i], on); }, { ride: false }); };
  const fusedAll = (s) => { const list = ids(); return list.slice(list.indexOf(s.top), list.indexOf(s.bottom)).every((id) => fusedBelow(app.spine, id)); };
  $('curveFused').addEventListener('change', () => { const s = stretch(); if (s) fuseRange(s.top, s.bottom, $('curveFused').checked); });

  function curveBox() {
    const s = stretch(), p = app.picked && app.picked.kind === 'stretch' ? app.picked : {}, list = ids(), all = [['', 'choose'], ...list.map((id) => [id, id])];
    options($('strTop'), all, p.top || ''); options($('strBottom'), all, p.bottom || '');
    each('[data-region]', (b) => { const ends = regionEnds(b.dataset.region); b.hidden = !ends; b.setAttribute('aria-pressed', ends && s && ends.top === s.top && ends.bottom === s.bottom ? 'true' : 'false'); });
    // (while the ends are picked the sliders stay where they are, greyed out, so the card keeps its height and the model its place)
    $('stretchOn').classList.toggle('off', !s);
    each('#stretchOn input', (i) => { i.disabled = !s; });
    $('stretchHint').textContent = s ? s.top + ' to ' + s.bottom + '. ' + Press() + ' two vertebrae on the model for any other stretch.' : p.top ? p.top + ' is one end. Now ' + press() + ' the vertebra at the other end.' : Press() + ' the two vertebrae at the ends of the stretch, or pick a part above.';
    if (!s) return;
    const blocks = list.slice(list.indexOf(s.top), list.indexOf(s.bottom) + 1).map((id) => blockOf(app.spine, app.rig, id));
    const whole = blocks.every((b) => b && b.top === blocks[0].top), some = blocks.find((b) => b);
    $('stretchFused').hidden = !some;
    if (some) $('stretchFused').textContent = whole ? 'This lies inside the fused part from ' + some.top + ' to ' + some.bottom + ', which keeps its shape. To reshape it, untick the box below, bend it, and tick the box again.' : 'The fused part from ' + some.top + ' to ' + some.bottom + ' keeps its shape. The bend goes into the joints that are free.';
    bowDials[0](Math.round(shown.bow(s, 0))); bowDials[1](Math.round(shown.bow(s, 1))); twistDial(Math.round(shown.twist(s))); offDial(Math.round(shown.offset(s)));
    $('curveFused').checked = fusedAll(s);
    curveSays();
  }

  // ---------------------------------------------------------------- hardware: the selected parts
  $('hwClear').addEventListener('click', () => {
    // (frozen parts stay, with the rods that still have two parts to hold them)
    const kept = FREEZING.flatMap((k) => hw()[k]).filter((p) => p.locked).length;
    app.pick(null);
    app.change(() => { const h = hw(); app.spine.hardware = { ...(h.colors ? { colors: h.colors } : {}), ...Object.fromEntries(KINDS.map((k) => [k, FREEZING.includes(k) ? h[k].filter((p) => p.locked) : []])) }; fitRods(app.spine, true); }, { ride: false });
    app.say(kept ? 'The frozen parts were kept: ' + kept + '.' : '');
  });
  function removePicked() {
    const p = app.picked, list = p.kind === 'marks' ? app.spine.marks : hw()[p.kind];
    app.picked = null;
    app.change(() => { list.splice(p.index, 1); if (p.kind === 'screws' || p.kind === 'hooks') fitRods(app.spine); }, { ride: false });
  }
  // ---- the selection: one part, or several (with Shift)
  const same = (p, q) => p && q && p.kind === q.kind && p.index === q.index;
  const FROZEN = 'That part is frozen. Untick "Frozen" on its card to change it.';
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
      for (const kind of FREEZING) { const gone = new Set(go.filter((c) => c.kind === kind).map((c) => c.piece)); if (gone.size) hw()[kind] = hw()[kind].filter((p) => !gone.has(p)); }
      fitRods(app.spine);
    }, { ride: false });
    app.say(go.length < all.length ? 'The frozen parts were kept.' : '');
  }
  // "More" on a card shows the settings that are used less (on a wide screen they always show)
  each('[data-more]', (b) => b.addEventListener('click', () => { const on = !b.parentElement.classList.contains('more-on'); b.parentElement.classList.toggle('more-on', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); b.textContent = on ? 'Less' : 'More'; }));
  $('pieceRemove').addEventListener('click', removeChosen);
  $('pieceDone').addEventListener('click', () => app.pick(null));
  const again = (settle) => app.change(() => {}, { settle, ride: false });
  const thick = dial('pieceThick', 'pieceThickN', (v) => { const s = pieceOf(); if (s && app.picked.kind === 'screws') { resizeScrew(s, v, 0); again(false); } });
  const long = dial('pieceLong', 'pieceLongN', (v) => { const s = pieceOf(); if (s && app.picked.kind === 'screws') { resizeScrew(s, 0, v); again(false); } });
  const rodThick = dial('rodThick', 'rodThickN', (v) => { const r = pieceOf(); if (r && app.picked.kind === 'rods') { r.diameter = v; again(false); } });
  // ---- the catalogue: the categories, and the tiles of the open one
  // A tile does one of two things. While parts of its category are selected, they become
  // what the tile shows (None takes them off). Otherwise the tile is taken in hand, and a
  // press on the spine puts that part there. Pressing the tile in hand puts it down again.
  const CAT_OF_TOOL = { screw: 'side', hook: 'side', link: 'links', rod: 'rods', disc: 'discs', bone: 'bones' };
  const tileInHand = () => ({ screw: screwLook === 'standard' ? 'screw' : 'screw-' + screwLook, hook: 'hook-' + hookFace, link: 'link', rod: 'rod', erase: 'none', disc: 'disc-' + discState, bone: boneTile }[hand.parts] || '');
  const picked = () => { const all = chosen(); return all.length && all.every((c) => categoryOf(c.kind) === cat) ? all : []; };
  let tiles = null, drawing = false;
  const waiting = [];          // (the tiles whose pictures are still to be drawn, see picturesSoon)
  function retype(all, to) {
    const now = [];
    if (all.every((c) => c.piece.locked)) { app.say(FROZEN); return; }
    app.change(() => {
      for (const c of all) now.push(retypePiece(app.spine, c.kind, c.piece, to) || c);
      // (a part that changed kind is in another list now: the selection follows it there before the page is drawn again)
      const refs = now.map((c) => ({ kind: c.kind, index: hw()[c.kind].indexOf(c.piece) })).filter((r) => r.index >= 0);
      app.picked = refs[0] || null; app.also = refs.slice(1);
    }, { ride: false });
    app.say(all.some((c) => c.piece.locked) ? 'The frozen parts were kept as they were.' : '');
  }
  function tilePressed(id) {
    const tile = tilesOf(cat).find((t) => t.id === id), all = picked();
    if (!tile) return;
    if (cat === 'bones') {
      // the same for a vertebra
      const bone = bonePick(), down = hand.parts === 'bone' && tileInHand() === id;
      boneTile = id;
      if (bone) putOnBone(bone, tile); else pickTool(down ? 'turn' : 'bone');
      return;
    }
    if (cat === 'discs') {
      // a selected disc becomes what the tile shows. With none selected the tile is taken in hand, and each disc pressed becomes that.
      const key = discPick(), down = hand.parts === 'disc' && tileInHand() === id;
      discState = tile.state;
      if (key) changeDisc(key, { state: tile.state }); else pickTool(down ? 'turn' : 'disc');
      return;
    }
    if (all.length && cat !== 'rods') {
      if (id === 'none') { removeChosen(); return; }
      // the selected parts become this, and it is also what goes on the next spot that is pressed
      if (tile.tool === 'hook') hookFace = tile.face;
      if (tile.tool === 'screw') screwLook = tile.look;
      hand.parts = tile.tool; filling = false; arm();
      if (cat === 'side') retype(all, id); else sync();
      return;
    }
    if (all.length) return;
    const down = tileInHand() === id;
    if (tile.tool === 'hook') hookFace = tile.face;
    if (tile.tool === 'screw') screwLook = tile.look;
    pickTool(down ? 'turn' : tile.tool);
  }
  function showCategory() {
    tiles = catalogue($('catTiles'), CATEGORIES.find((c) => c.id === cat).groups, tilePressed);
    tiles.pictures(shots);
    picturesSoon();
  }
  for (const c of CATEGORIES) {
    const btn = document.createElement('button'), name = document.createElement('span');
    btn.type = 'button'; btn.dataset.cat = c.id; btn.dataset.tip = c.name; btn.setAttribute('aria-label', c.name); btn.setAttribute('aria-pressed', 'false');
    name.textContent = c.name; btn.append(icon(c.icon), name);
    // (opening a category takes its usual part in hand, so the next press on the spine already does something)
    btn.addEventListener('click', () => { cat = c.id; showCategory(); $('cats').classList.remove('named'); $('catsOpen').setAttribute('aria-expanded', 'false'); pickTool(c.tool); });
    $('cats').insertBefore(btn, $('catsOpen'));
  }
  $('catsOpen').addEventListener('click', () => { const on = !$('cats').classList.contains('named'); $('cats').classList.toggle('named', on); $('catsOpen').setAttribute('aria-expanded', on ? 'true' : 'false'); });
  showCategory();
  // The small pictures on the tiles are drawn from the real parts, each one once: the tiles of a category when it
  // is first opened, one picture at a time with a pause between, so a slow device does not stand still while they
  // are made. A tile shows its line drawing until its picture is there.
  function picturesSoon() {
    if (!app.partPictures) return;
    for (const t of tilesOf(cat)) if (t.shot && !(shots && shots[t.id]) && !waiting.includes(t.id)) waiting.push(t.id);
    if (!drawing) nextPicture();
  }
  function nextPicture() {
    drawing = waiting.length > 0;
    if (!drawing) return;
    setTimeout(() => {
      // (not now: the catalogue is not in view, or the model is showing something else. The next visit asks again.)
      if (tab !== 'parts' || !app.spine) { drawing = false; return; }
      const id = waiting.shift(), made = app.partPictures([id]);
      if (!made[id]) { waiting.push(id); drawing = false; return; }
      shots = { ...(shots || {}), [id]: made[id] };
      tiles.pictures(shots);
      nextPicture();
    }, 50);
  }
  function catalogBox() {
    // the open category follows what is selected, and else the tool in hand
    const all = chosen(), disc = discPick(), want = all.length ? categoryOf(all[0].kind) : disc ? 'discs' : CAT_OF_TOOL[hand.parts];
    if (want && want !== cat) { cat = want; showCategory(); }
    pressed('#cats [data-cat]', 'cat', cat);
    const mine = picked(), types = mine.map((c) => typeOf(c.kind, c.piece)), inHand = tilesOf(cat).find((t) => t.id === tileInHand());
    const bone = bonePick();
    const lit = bone ? ['bone-' + ((levelOf(bone).fracture || {}).kind || 'healthy'), wearTile(levelOf(bone).wear), 'arch-' + (levelOf(bone).arch || 'whole')] : disc ? 'disc-' + discAt(app.spine, disc).state : mine.length ? (cat === 'links' ? 'link' : cat === 'rods' ? 'rod' : types[0] && types.every((t) => t === types[0]) ? types[0].id : '') : inHand ? inHand.id : '';
    tiles.mark(lit);
    const p = mine.length ? mine[0] : null;
    $('catKind').textContent = CATEGORIES.find((c) => c.id === cat).name;
    $('catNow').textContent = bone ? bone + ': ' + fractureWords(levelOf(bone).fracture) + ', ' + wearWords(levelOf(bone).wear) + (levelOf(bone).arch ? ', ' + archWords(levelOf(bone).arch) : '') + '. ' + Press() + ' a picture to change it.'
      : cat === 'bones' && hand.parts !== 'bone' ? Press() + ' a vertebra on the spine, then a picture to change it.'
      : disc ? 'Disc ' + disc + ': ' + discWords(discAt(app.spine, disc)) + '. ' + Press() + ' a picture to change it.'
      : cat === 'discs' && hand.parts !== 'disc' ? Press() + ' a disc on the spine, then a picture to change it. Turn the model to see the discs from the front or the side.'
      : mine.length > 1 ? mine.length + ' parts selected. ' + Press() + ' a picture to change them all.'
      : p ? PART_NAMES[p.kind] + (p.piece.level ? ' at ' + p.piece.level : '') + (p.piece.side ? ', ' + p.piece.side + (p.kind === 'rods' ? ' side' : '') : '') + (cat === 'side' ? '. ' + Press() + ' a picture to change it.' : '')
        : inHand ? inHand.name + ': ' + inHand.say + '.'
          : 'Nothing in hand. ' + Press() + ' a picture to take it in hand, or a part on the spine to change it.';
    $('fineSelect').setAttribute('aria-pressed', hand.parts === 'turn' && !filling ? 'true' : 'false');
    $('fineRemove').classList.toggle('idle', !all.filter((c) => c.kind !== 'rods').length);
  }
  // ---- vertebrae: whole or broken
  const bonePick = () => (cat === 'bones' && app.picked && app.picked.kind === 'level' && levelOf(app.picked.id) ? app.picked.id : null);
  function changeBone(id, change, moving) {
    let now = null;
    app.change(() => { now = setFracture(app.spine, app.rig, id, change); }, moving ? { settle: false } : {});
    app.say(!now ? (id === 'S1' ? 'The sacrum is left as it is.' : id + ' has no body that breaks this way.') : now.kind === 'wedge' && !now.lean ? id + ' is in a fused stretch that is held stiff, so the spine above did not tip forward.' : '');
  }
  // The look of the bone: nothing moves, so nothing has to ride along.
  const changeWear = (ids, wear, moving) => app.change(() => { for (const id of ids) setWear(app.spine, id, wear); }, { ride: false, ...(moving ? { settle: false } : {}) });
  // (the tile of the Bone group nearest to a wear)
  const wearTile = (w) => (!w || w < 0.25 ? 'bone-clean' : w < 0.75 ? 'bone-aged' : 'bone-porous');
  // What a tile of the Vertebrae does to one vertebra: its shape, or the look of its bone.
  const changeArch = (id, arch) => { let now = null; app.change(() => { now = setArch(app.spine, id, arch); }, { ride: false }); app.say(now ? '' : id === 'S1' ? 'The sacrum is left as it is.' : 'The back of ' + id + ' is left as it is.'); };
  const putOnBone = (id, tile) => ('wear' in tile ? changeWear([id], tile.wear) : 'arch' in tile ? changeArch(id, tile.arch) : changeBone(id, { kind: tile.state }));
  const boneHas = (l, tile) => ('wear' in tile ? wearTile(l.wear) === tile.id : 'arch' in tile ? (l.arch || '') === tile.arch : ((l.fracture || {}).kind || 'healthy') === tile.state);
  // A press on the model while the Vertebrae are open. True if it was about a vertebra.
  function boneTap(e) {
    const hit = hitLevel(e), id = hit && hit.level.id, part = hitThing(e, false);
    // (a screw or a hook in front of the bone is what was pressed. One behind the bone is not.)
    if (part) { const ray = renderer.ray(e.clientX, e.clientY); if (!hit || rayPoint(ray.origin, ray.direction, part.at).along < hit.t + 4) return false; }
    if (!id) { if (hand.parts !== 'bone') return false; app.pick(null); return true; }
    app.flash(id, true);
    const tile = tilesOf('bones').find((t) => t.id === boneTile);
    if (hand.parts === 'bone' && !boneHas(hit.level, tile)) putOnBone(id, tile);
    app.pick({ kind: 'level', id });
    return true;
  }
  const BONE_SAYS = Object.fromEntries(tilesOf('bones').filter((t) => t.state).map((t) => [t.state, t.say]));
  const fracWear = dial('fracWear', 'fracWearN', (v) => { const id = bonePick(); if (id) changeWear([id], v / 100, true); });
  $('fracWearAll').addEventListener('click', () => { const id = bonePick(); if (id) { changeWear(ids(), levelOf(id).wear || 0); app.say('Every vertebra now has ' + wearWords(levelOf(id).wear) + '.'); } });
  const fracAmount = dial('fracAmount', 'fracAmountN', (v) => { const id = bonePick(); if (id) changeBone(id, { amount: v / 100 }, true); });
  function fracBox() {
    const id = bonePick(), f = id && levelOf(id).fracture;
    if (!id) return;
    $('fracName').textContent = id;
    $('fracHow').textContent = BONE_SAYS[f ? f.kind : 'healthy'].replace(/^./, (c) => c.toUpperCase()) + '.';
    $('fracReset').hidden = $('fracAmountRow').hidden = !f;
    fracAmount(Math.round(((f && f.amount) || 0.5) * 100));
    fracWear(Math.round((levelOf(id).wear || 0) * 100));
  }
  $('fracReset').addEventListener('click', () => { const id = bonePick(); if (id) changeBone(id, { kind: 'healthy' }); });
  // ---- discs
  const discPick = () => (app.picked && app.picked.kind === 'discs' && discKeys(app.spine).includes(app.picked.id) ? app.picked.id : null);
  // Change a disc, as one step for Undo (or "moving": while a slider is dragged). The hardware and the marks ride along.
  function changeDisc(key, change, moving) {
    let now = null;
    app.change(() => { now = setDisc(app.spine, app.rig, key, change); }, moving ? { settle: false } : {});
    app.say(now && now.state === 'thin' && !now.drop ? 'That disc is in a fused stretch that is held stiff, so its space did not close.' : '');
  }
  // The disc under the pointer, by name, or null. A bone in front of it hides it.
  function hitDisc(e) {
    const ray = renderer.ray(e.clientX, e.clientY), ls = levels(), bone = hitLevel(e);
    let best = null;
    for (let i = 0; i < ls.length - 1; i++) {
      if (ls[i].id === 'C1' || rayPoint(ray.origin, ray.direction, vLerp(ls[i].centre, ls[i + 1].centre, 0.5)).off > 70) continue;
      const key = ls[i].id + '/' + ls[i + 1].id, parts = discParts(ls[i], ls[i + 1], discAt(app.spine, key));
      for (const mesh of parts.length ? parts.map((p) => p.mesh) : [discMesh(ls[i], ls[i + 1])]) { const t = rayMesh(ray.origin, ray.direction, mesh); if (t !== null && (!best || t < best.t)) best = { key, t }; }
    }
    return best && !(bone && bone.t < best.t - 0.5) ? best.key : null;
  }
  // A press on the model while the Discs are open. True if it was about a disc.
  function discTap(e) {
    const key = hitDisc(e);
    if (!key) { if (hand.parts !== 'disc') return false; app.pick(null); return true; }
    if (hand.parts === 'disc' && discAt(app.spine, key).state !== discState) changeDisc(key, { state: discState });
    app.pick({ kind: 'discs', id: key });
    return true;
  }
  const DISC_SAYS = Object.fromEntries(tilesOf('discs').map((t) => [t.state, t.say]));
  const discAmount = dial('discAmount', 'discAmountN', (v) => { const key = discPick(); if (key) changeDisc(key, { amount: v / 100 }, true); });
  function discBox() {
    const key = discPick(), d = key && discAt(app.spine, key);
    if (!d) return;
    $('discName').textContent = 'Disc ' + key;
    $('discHow').textContent = DISC_SAYS[d.state].replace(/^./, (c) => c.toUpperCase()) + '.';
    $('discReset').hidden = d.state === 'standard';
    $('discAmountRow').hidden = !DISC_SIZED.includes(d.state);
    $('discSideRow').hidden = !DISC_AIMED.includes(d.state);
    discAmount(Math.round((d.amount || 0.5) * 100));
    pressed('[data-discside]', 'discside', d.toward || 'back');
  }
  each('[data-discside]', (b) => b.addEventListener('click', () => { const key = discPick(); if (key) changeDisc(key, { toward: b.dataset.discside }); }));
  $('discReset').addEventListener('click', () => { const key = discPick(); if (key) changeDisc(key, { state: 'standard' }); });
  $('fineSelect').addEventListener('click', () => pickTool('turn'));
  $('fineRemove').addEventListener('click', () => { if (chosen().some((c) => c.kind !== 'rods')) removeChosen(); else app.say('Select a part first. To take off several, pick None in the catalogue and ' + press() + ' them.'); });
  $('rodUnbend').addEventListener('click', () => { const r = pieceOf(); if (r && app.picked.kind === 'rods') app.change(() => unbendRod(app.spine, r), { ride: false }); });
  $('pieceLocked').addEventListener('change', () => { const all = chosen(); for (const c of all) { if ($('pieceLocked').checked) c.piece.locked = true; else delete c.piece.locked; } again(true); });

  function pieceBox() {
    const all = chosen(), p = pieceOf(), kind = p ? app.picked.kind : '', many = all.length > 1, lone = many ? null : p;
    const word = (k) => kindOf(k).word, plural = Object.fromEntries(PART_KINDS.map((p) => [p.kind, p.words]));
    if (!p) return;
    if (kind === 'rods' && !many) {
      const bends = (p.via || []).length;
      $('rodName').textContent = 'Rod, ' + p.side + ' side' + (!p.auto ? ', traced' : bends ? ', bent in ' + bends + (bends === 1 ? ' place' : ' places') : '');
      rodThick(p.diameter || 5.5);
      $('rodUnbend').disabled = !bends;
      return;
    }
    const frozen = all.some((c) => c.piece.locked);
    $('pieceName').textContent = many ? all.length + ' parts' : PART_NAMES[kind] + (p.level ? ' at ' + p.level : '') + (p.side ? ', ' + p.side : '');
    $('pieceHow').textContent = many ? 'What you set here goes for all of them. Drag one of the screws or hooks along the spine and the others move with it.' : frozen ? 'Frozen: it stays as it is until the box below is unticked.' : kind === 'crosslinks' ? 'It sits between the two rods.' : 'Drag it over the bone to move it.';
    $('pieceThickRow').hidden = $('pieceLongRow').hidden = !lone || kind !== 'screws';
    if (lone && kind === 'screws') { thick(p.diameter || 5); long(screwLength(p)); }
    const types = all.map((c) => typeOf(c.kind, c.piece)), type = types[0] && types.every((t) => t === types[0]) ? types[0] : null;
    $('pieceIcon').firstElementChild.setAttribute('href', '#' + (type ? type.icon : kind === 'crosslinks' && !many ? 'i-link' : 'i-screw'));
    $('pieceIcon').classList.toggle('flip', !!(type && type.flip));
    // (parts can be frozen in a spine file. The switch shows for those, so they can be let go.)
    $('pieceLockedRow').hidden = !frozen;
    $('pieceLocked').checked = all.every((c) => c.piece.locked); $('pieceLocked').indeterminate = frozen && !$('pieceLocked').checked;
  }

  // Dragging the selected screw or hook over the bone: it hops from one usual spot to the next.
  function dragPart(e) {
    const { kind, index } = drag.part, part = hw()[kind][index], hit = hitLevel({ clientX: e.clientX - drag.off[0], clientY: e.clientY - drag.off[1] });
    if (!part || !hit) return;
    if (part.locked) { app.say(FROZEN); return; }
    const frame = levelFrame(hit.level), side = toLocal(hit.point, hit.level.centre, frame)[0] >= 0 ? 'left' : 'right';
    // several screws and hooks are selected and one of them is dragged: they all move along the spine together, vertebra by vertebra
    const group = chosen().filter((c) => c.kind === 'screws' || c.kind === 'hooks').map((c) => c.piece);
    if (group.length > 1 && group.includes(part)) {
      const list = ids(), by = list.indexOf(hit.level.id) - list.indexOf(part.level);
      if (!by) return;
      let went = false;
      live(() => { went = shiftParts(app.spine, group, by); }, false);
      app.say(went ? '' : 'There is no room for all of them there: a part that is not selected is in the way, one of them is frozen, or the spine ends.');
      return;
    }
    if (hit.level.id === 'C1' || (part.level === hit.level.id && part.side === side) || [...hw().screws, ...hw().hooks].some((p) => p !== part && p.level === hit.level.id && p.side === side)) return;
    const spot = slot(hit.level, side, part.faces || 'down');
    const next = kind === 'screws' ? { level: hit.level.id, side, ...spot.screw, diameter: part.diameter } : { level: hit.level.id, side, ...spot.hook };
    app.picked = { kind, index };
    let went = true;
    live(() => { went = placePiece(app.spine, part, next, true); }, false);
    app.say(went ? '' : 'The rod could not follow it there.');
  }
  // Dragging the selected rod between two of its parts bends it there: the rod is made to
  // pass through the spot under the pointer.
  function dragRod(e) {
    const rod = hw().rods.find((r) => r.id === drag.rod);
    if (!rod) return;
    const ray = renderer.ray(e.clientX, e.clientY), t = vDot(vSub(drag.at, ray.origin), drag.facing) / vDot(ray.direction, drag.facing);
    if (!(t > 0)) return;
    const at = vAdd(ray.origin, vScale(ray.direction, t));
    let via = -1;
    live(() => { via = bendRod(app.spine, rod, at, drag.via, true); }, false);
    drag.via = via;
    const now = hw().rods.find((r) => r.id === drag.rod);
    app.picked = { kind: 'rods', index: hw().rods.indexOf(now) };
    app.say(via < 0 ? 'A rod can be bent between its two ends, not beyond them.' : vDist(now.via[via], at) > 1.5 ? 'That is as far as a rod bends there.' : '');
  }

  // ---------------------------------------------------------------- pain points and notes
  function addMark(e) {
    const hit = hitLevel(e);
    if (!hit) { app.say(Press() + ' on a vertebra.'); return; }
    addMarkAt(hit.point);
  }
  function addMarkAt(point) {
    const at = point.map(round1), mark = marking === 'pain' ? { kind: 'pain', text: 'Pain', at, radius: 14, strength: 5 } : { kind: 'note', text: 'Note', at };
    app.picked = { kind: 'marks', index: app.spine.marks.length };
    app.say('');
    app.change(() => app.spine.marks.push(mark), { ride: false });
    // (with a keyboard at hand the words can be typed at once. On a touch screen that would bring up the keyboard over the model.)
    if (!touch()) { $('markText').focus(); $('markText').select(); }
  }
  $('markText').addEventListener('input', () => { const m = markOf(); if (m) { m.text = $('markText').value; again(false); } });
  $('markText').addEventListener('change', () => app.settle());
  const markSays = () => { const m = markOf(); if (m && m.kind === 'pain') { $('markStrongSay').textContent = (m.strength || 5) + ' out of 10'; $('markSizeSay').textContent = Math.round(m.radius || 15) + ' mm'; } };
  const strong = dial('markStrong', 'markStrongN', (v) => { const m = markOf(); if (m) { m.strength = Math.max(1, Math.min(10, Math.round(v))); again(false); markSays(); } });
  const wideDial = dial('markSize', 'markSizeN', (v) => { const m = markOf(); if (m) { m.radius = v; again(false); markSays(); } });
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
    const m = markOf();
    if (!m) return;
    $('markName').textContent = m.kind === 'note' ? 'Note' : 'Pain point';
    $('markLabelBack').hidden = !m.label;
    if (document.activeElement !== $('markText')) $('markText').value = m.text || '';
    $('markStrongRow').hidden = $('markSizeRow').hidden = m.kind !== 'pain';
    if (m.kind === 'pain') { strong(m.strength || 5); wideDial(m.radius || 15); markSays(); }
  }

  // ---------------------------------------------------------------- what is on this spine
  // A list beside the model on a wide screen: its curves, what is fused, the hardware, the
  // pain points and notes. A line of it opens that thing.
  let listWas = '';
  let lastRows = [];
  function listBox() {
    const box = $('list');
    const m = measureSpine(app.spine), h = hw(), rows = [];
    lastRows = rows;
    const add = (head, text, go) => rows.push({ head, text, go });
    for (const c of m.curves) add('Curves', c.top + ' to ' + c.bottom + ': about ' + c.degrees + '° to the ' + c.bowsTo, () => workOn(c.top, c.bottom));
    if (m.kyphosis !== null) add('Curves', 'Rounding of the chest: about ' + m.kyphosis + '°', () => workOn('T5', 'T12'));
    if (m.lordosis !== null) add('Curves', 'Hollow of the low back: about ' + m.lordosis + '°', () => workOn('L1', 'L5'));
    for (const [top, bottom] of app.spine.fused || []) add('Fused', top + ' to ' + bottom, () => workOn(top, bottom));
    const count = (n, one, many) => (n ? [n + ' ' + (n === 1 ? one : many)] : []), parts = [...count(h.screws.length, 'screw', 'screws'), ...count(h.hooks.length, 'hook', 'hooks'), ...count(h.crosslinks.length, 'cross-link', 'cross-links')];
    if (parts.length) add('Hardware', parts.join(', '), () => { showTab('parts'); pickTool('turn'); });
    if (!h.norods) for (const [top, bottom] of rodSets(app.spine)) add('Hardware', 'Rods from ' + top + ' to ' + bottom, () => { showTab('parts'); pickTool('rod'); });
    const worn = levels().filter((l) => l.wear);
    if (worn.length) add('Vertebrae', (worn.length === levels().length ? 'The whole spine' : worn.length === 1 ? worn[0].id : worn.length + ' vertebrae') + ': ' + wearWords(Math.max(...worn.map((l) => l.wear))), () => { showTab('parts'); cat = 'bones'; showCategory(); app.pick({ kind: 'level', id: worn[0].id }); });
    for (const l of levels()) if (l.arch) add('Vertebrae', l.id + ': ' + archWords(l.arch), () => { showTab('parts'); cat = 'bones'; showCategory(); app.pick({ kind: 'level', id: l.id }); });
    for (const l of levels()) if (l.fracture) add('Vertebrae', l.id + ': ' + fractureWords(l.fracture), () => { showTab('parts'); cat = 'bones'; showCategory(); app.pick({ kind: 'level', id: l.id }); });
    for (const key of discKeys(app.spine)) if ((app.spine.discs || {})[key]) add('Discs', key + ': ' + discWords(discAt(app.spine, key)), () => { showTab('parts'); cat = 'discs'; showCategory(); app.pick({ kind: 'discs', id: key }); });
    app.spine.marks.forEach((mark, index) => add('Pain and notes', (mark.text || (mark.kind === 'note' ? 'Note' : 'Pain')) + (mark.kind === 'pain' ? ', ' + (mark.strength || 5) + ' out of 10' : ''), () => { if (tab !== 'marks') showTab('marks'); app.pick({ kind: 'marks', index }); }));
    // (the same list, as one line of words, is what describes the 3D picture to a screen reader)
    $('sketchSays').textContent = (app.spine.name || 'A spine') + '. ' + (rows.length ? rows.map((r) => r.head + ': ' + r.text).join('. ') : 'No curve of 10° or more, no hardware and no pain points yet') + '.';
    if (!$('listBox').offsetParent) { listWas = ''; return; }
    // The curves are listed only with the Curve tool in hand, where they can be worked on. The rest is always there.
    const curving = tab === 'shape' && hand.shape === 'curve', seen = rows.filter((r) => r.head !== 'Curves' || curving), key = curving + '|' + seen.map((r) => r.head + r.text).join('|');
    if (key === listWas) return;
    listWas = key; box.textContent = '';
    let head = '';
    for (const r of seen) {
      if (r.head !== head) { head = r.head; const h3 = document.createElement('h3'); h3.textContent = head; box.appendChild(h3); }
      const b = document.createElement('button'); b.textContent = r.text; b.addEventListener('click', r.go); box.appendChild(b);
    }
    if (curving && !seen.some((r) => r.head === 'Curves')) { const p = document.createElement('p'); p.className = 'small'; p.textContent = 'No curve of 10° or more yet.'; box.insertBefore(p, box.firstChild); }
  }
  // Open the Curve tool on a stretch (the list does this).
  function workOn(top, bottom) {
    const list = ids();
    if (!list.includes(top) || !list.includes(bottom)) return;
    if (tab !== 'shape') showTab('shape');
    hand.shape = 'curve'; app.picked = sorted(top, bottom);
    arm(); app.redraw(); sync();
  }

  // ---------------------------------------------------------------- handles on the model
  // The handles for what is selected, or null: { spec, active } (see view/gizmo.js).
  function handles() {
    if (!app.spine) return null;
    const set = (at, kinds) => ({ spec: { at, handles: Object.entries(kinds).map(([name, kind]) => ({ name, kind, axis: AXES[name] })) }, active: (drag && drag.name) || hot });
    const l = one(), s = stretch(), m = markOf();
    if (tab === 'shape' && hand.shape === 'one' && l) {
      // (no up arrow where there is no space to change: the bottom vertebra, and one fused to the one below)
      const block = blockOf(app.spine, app.rig, l.id), lift = ids().indexOf(l.id) < ids().length - 1 && !(block && block.bottom !== l.id);
      if (how.one === 'move') return set(l.centre, { left: 'double', back: 'double', ...(lift ? { up: 'arrow' } : {}) });
      if (how.one === 'turn') return set(l.centre, { left: 'ring', back: 'ring', up: 'ring' });
      const f = levelFrame(l);
      return { spec: { at: l.centre, handles: [{ name: 'left', kind: 'knob', axis: f.left }, { name: 'back', kind: 'knob', axis: f.back }, { name: 'up', kind: 'knob', axis: f.up }] }, active: (drag && drag.name) || hot };
    }
    if (tab === 'shape' && hand.shape === 'curve' && s) return set(middle(s).centre, { left: 'double', back: 'double' });
    if (tab === 'marks' && m) return set(markSpot(m), { left: 'double', back: 'double', up: 'double' });
    return null;
  }

  // What one step of a drag does. "name" is the handle (left, back, up), "by" how far along it
  // in millimetres, "turn" how far round it in degrees.
  function pull(name, by, turn) {
    const l = one(), s = stretch(), m = markOf(), spine = app.spine, rig = app.rig;
    if (tab === 'marks' && m) {
      const j = { left: 0, back: 1, up: 2 }[name];
      live(() => { for (const key of ['at', 'from', 'to']) if (m[key]) m[key][j] = round1(m[key][j] + by); }, false);
    } else if (tab !== 'shape') return;
    else if (l && how.one === 'move') {
      live(() => { if (name === 'up') liftLevel(spine, rig, l.id, by); else pullLevel(spine, rig, l.id, name === 'left' ? by : 0, name === 'back' ? by : 0); });
    } else if (l && how.one === 'turn') {
      live(() => turned(l, (x) => { if (name === 'up') x.turn += turn; else if (name === 'back') x.tilt[0] = Math.max(-80, Math.min(80, x.tilt[0] + turn)); else x.tilt[1] = Math.max(-80, Math.min(80, x.tilt[1] - turn)); }));
    } else if (l && how.one === 'size') {
      const j = { left: 0, back: 1, up: 2 }[name], typ = typicalSize(l.id);
      l.size[j] = Math.max(typ[j] * 0.5, Math.min(typ[j] * 1.8, l.size[j] + 2 * by));
      live(() => restack(spine, rig));
    } else if (s && how.stretch === 'bow') {
      // pulling the middle out by so many millimetres makes an arc of this many degrees
      const p = name === 'left' ? 0 : 1, deg = ((8 * by) / Math.max(40, vDist(levelOf(s.top).centre, levelOf(s.bottom).centre))) * DEG;
      live(() => setBow(spine, rig, s.top, s.bottom, p, bowOf(spine, s.top, s.bottom, p) + (p === 0 ? -deg : deg)));
    } else if (s && how.stretch === 'offset') {
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
      const f = levelFrame(l), d = ray.direction, t = rayMesh(toLocal(ray.origin, l.centre, f), [d[0] * f.left[0] + d[1] * f.left[1] + d[2] * f.left[2], d[0] * f.back[0] + d[1] * f.back[1] + d[2] * f.back[2], d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2]], vertebraShape(l.id, l.size, app.DETAIL, l.fracture));
      if (t !== null && (!best || t < best.t)) best = { level: l, t, point: vAdd(ray.origin, vScale(d, t)) };
    }
    return best;
  }
  function hitThing(e, marks) {
    const ray = renderer.ray(e.clientX, e.clientY), at = [], more = e.pointerType === 'touch' ? 3 : 0;
    if (marks) app.spine.marks.forEach((m, index) => at.push({ kind: 'marks', index, p: markSpot(m), r: m.kind === 'note' ? 8 + more : Math.min(m.radius || 15, 18) }));
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

  // A press on the model that was not a drag.
  let hovering = null, hoverFrame = null;
  function tap(e) {
    if (!app.spine) return;
    // (in the clean view, with the tools put away, a tap brings them back)
    if (document.body.classList.contains('clean')) { app.clean(false); return; }
    if (tab === 'look') { paintTap(e); return; }
    if (tab === 'story') return;          // (nothing is changed there: a drag turns the model)
    if (tab === 'marks') {
      // a tap on a pain point or a note selects it. Anywhere else, the tool in hand puts a new one there.
      const m = hitThing(e, true);
      if (m) app.pick({ kind: m.kind, index: m.index });
      else if (markOf()) app.pick(null);
      else if (marking) addMark(e);
      return;
    }
    if (tab === 'parts') {
      if (easy.picking()) { easy.tap(e); sync(); return; }
      if (cat === 'discs' && discTap(e)) return;
      if (cat === 'bones' && boneTap(e)) return;
      const t = hand.parts, what = hitThing(e, false), hit = what ? null : hitLevel(e);
      // with the rod tool in hand, a tap on a screw or a hook starts or ends a rod there, and a tap on a rod ends it there
      if (easy.rodTap(what)) return;
      // a tap on one of the soft marks puts the part of the tool in hand there (a rod that runs behind a mark does not get in the way)
      if (t !== 'turn' && (!what || what.kind === 'rods') && easy.putOnModel(null, e)) { app.pick(null); app.settle(); return; }
      if (what) {
        if (t !== 'erase') { pickPart(what, e.shiftKey); return; }
        if (what.kind === 'rods') { app.say('A rod goes when the parts that hold it go. The Rod tool can take all rods off.'); return; }
        app.pick({ kind: what.kind, index: what.index }); removeChosen();
        return;
      }
      // the tapped vertebra and its block on the map light up together, so it is clear which block is which bone
      if (hit) app.flash(hit.level.id, true);
      // with something selected, a tap beside it lets go of it
      if (app.picked && !(t === 'turn' && hit)) { app.pick(null); return; }
      if (t === 'turn') { app.pick(hit ? { kind: 'level', id: hit.level.id } : null); return; }
      // a tap on bone puts the part in hand on that side of the vertebra
      if (hit && easy.putOnModel(hit, e)) app.settle();
      return;
    }
    if (tab !== 'shape') return;
    const hit = hitLevel(e), id = hit && hit.level.id, p = app.picked || {}, t = hand.shape;
    if (t === 'lock') { if (id) chart.tapLock(id); return; }
    if (t === 'xray') { xray.tap(); return; }
    // the tapped vertebra and its block on the chart light up together
    if (id) app.flash(id, true);
    if (!id) return;
    if (t === 'one') app.pick({ kind: 'level', id });
    // the Curve tool: two taps pick the two ends of a stretch
    else if (t === 'curve') app.pick(p.kind === 'stretch' && p.top && !p.bottom && p.top !== id ? sorted(p.top, id) : { kind: 'stretch', top: id, bottom: null });
  }

  renderer.setTool({
    // A press on a handle grabs it. A press on the selected vertebra (or inside the selected
    // stretch) grabs that: it then follows the pointer. A press on the selected part grabs the part.
    down(e) {
      if (!app.spine) return false;
      if (easy.draw.on()) return easy.draw.down(e);
      // with the X-ray tool in hand and the picture over the model, a press traces on the picture or moves it
      if (xray.takes()) return xray.down(e);
      const h = handles(), box = renderer.canvas.getBoundingClientRect();
      const grabbed = h && gizmoHit(h.spec, renderer, e.clientX, e.clientY, e.pointerType === 'touch' ? 24 : 13);
      if (grabbed) { drag = { name: grabbed.handle.name, ring: grabbed.handle.kind === 'ring', grab: grabbed.grab, dx: 0, dy: 0, moved: false }; app.redraw(); return true; }
      if (tab === 'parts') {
        // only what is selected can be dragged, so that turning the model never moves a part by accident
        const what = hitThing(e, false), ray = renderer.ray(e.clientX, e.clientY), sel = chosen();
        if (easy.picking() || e.shiftKey || !what || !sel.some((c) => c.kind === what.kind && c.index === what.index)) return false;
        if (what.kind === 'screws' || what.kind === 'hooks') {
          // (the part keeps its place under the pointer: the spot where it meets the bone stays as far from the pointer as it was at the press)
          const part = hw()[what.kind][what.index], foot = renderer.project(part.entry || part.at);
          drag = { part: what, off: foot ? [e.clientX - foot[0] - box.left, e.clientY - foot[1] - box.top] : [0, 0], dx: 0, dy: 0, moved: false };
          return true;
        }
        if (what.kind === 'rods' && hw().rods[what.index].auto) {
          const rod = hw().rods[what.index], via = (rod.via || []).findIndex((p) => rayPoint(ray.origin, ray.direction, p).off < 6);
          drag = { rod: rod.id, via, at: via >= 0 ? rod.via[via] : what.at, facing: ray.direction, dx: 0, dy: 0, moved: false };
          return true;
        }
        return false;
      }
      if (tab !== 'shape') return false;
      const hit = hitLevel(e), l = hand.shape === 'one' ? one() : null, s = hand.shape === 'curve' ? stretch() : null, list = ids();
      if (!hit) return false;
      const i = list.indexOf(hit.level.id), body = l && how.one === 'move' && hit.level.id === l.id ? 'one' : s && i > list.indexOf(s.top) && i < list.indexOf(s.bottom) ? 'bow' : s && hit.level.id === s.top ? 'offset' : null;
      if (!body) return false;
      drag = { body, dx: 0, dy: 0, moved: false, at: hit.level.centre };
      return true;
    },
    move(e, dx, dy) {
      if (easy.draw.on()) { easy.draw.move(e); return; }
      if (xray.busy()) { xray.move(e); return; }
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
          const s = renderer.screenScale(drag.at), by = [0, 1].map((j) => (s.right[j] * dx2 - s.up[j] * dy2) * s.perPixel), was = how.stretch;
          if (drag.body !== 'one') how.stretch = drag.body;
          if (Math.abs(by[0]) > 0.01) pull('left', by[0], 0);
          if (Math.abs(by[1]) > 0.01) pull('back', by[1], 0);
          how.stretch = was;
        }
        // (the sliders of the card follow what is dragged on the model)
        if (tab === 'shape' && hand.shape === 'curve') curveBox(); else if (tab === 'shape' && hand.shape === 'one') oneBox();
      });
    },
    up(e) {
      if (easy.draw.on()) { easy.draw.up(e); return; }
      if (xray.busy()) { xray.up(e); return; }
      const was = drag; drag = null;
      if (was && was.moved) app.settle(); else { if (was && was.name) app.redraw(); if (e.type === 'pointerup' && !(was && was.name)) tap(e); }
    },
    tap,
    // a second finger came down, to zoom or to move the picture: what the first one held is let go
    cancel() {
      if (easy.draw.on()) { easy.draw.cancel(); return; }
      if (xray.busy()) { xray.cancel(); return; }
      const was = drag; drag = null;
      if (was && was.moved) app.settle(); else if (was && was.name) app.redraw();
    },
    // light up the handle under the pointer
    hover(e) {
      const h = handles(), over = h && gizmoHit(h.spec, renderer, e.clientX, e.clientY), name = over ? over.handle.name : null;
      if (name !== hot) { hot = name; $('view').style.cursor = name ? 'grab' : ''; app.redraw(); }
      // while the map or the chart of blocks is beside the model, the block of the bone under the pointer is marked there
      if (!app.spine || e.pointerType === 'touch' || $('strip').hidden) { app.peek(null); return; }
      hovering = e;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = null; const hit = hitLevel(hovering); app.peek(hit ? hit.level.id : null); });
    },
  });

  // ---------------------------------------------------------------- the keyboard on the model
  // With the 3D view in focus, the arrow keys move from vertebra to vertebra and from side to
  // side, and Enter or Space does there what a tap would do with the tool in hand. So every
  // tool that works by tapping also works without a pointer. Plus and minus zoom.
  let kb = null;        // where the keyboard is on the model: { id, side }
  const sidePart = (id, side) => { const p = easy.partAt(id, side); return p ? { kind: p.kind, index: p.index, piece: p.piece } : null; };
  const markNear = (l) => app.spine.marks.findIndex((m) => Math.abs(markSpot(m)[2] - l.centre[2]) <= l.size[2] / 2 + 4);
  function kbTell() {
    const l = levelOf(kb.id);
    if (tab === 'parts' || tab === 'look') { const p = sidePart(kb.id, kb.side); app.say(kb.id + ', ' + kb.side + ' side: ' + (p ? 'a ' + PART_NAMES[p.kind].toLowerCase() : 'nothing') + '.'); }
    else if (tab === 'marks') { const i = markNear(l); app.say(kb.id + (i >= 0 ? ': ' + (app.spine.marks[i].text || (app.spine.marks[i].kind === 'note' ? 'a note' : 'a pain point')) : '') + '.'); }
    else app.say(kb.id + (app.held.has(kb.id) ? ', locked.' : '.'));
  }
  function kbTap() {
    if (tab === 'story') return;
    const id = kb.id, side = kb.side, l = levelOf(id), p = app.picked || {};
    if (tab === 'look') {
      // With the brush, Enter paints the part on this side of the vertebra. Where there is none, or it has that colour already, it paints the vertebra.
      const part = sidePart(id, side), piece = part && hw()[part.kind][part.index];
      if (colorWhat !== 'one') { colorWhat = part ? part.kind : 'bone'; sync(); return; }
      const target = piece && (piece.color || '') !== brush ? piece : l;
      app.change(() => { if (brush) target.color = brush; else delete target.color; }, { ride: false });
      app.say((target === l ? id : PART_NAMES[part.kind] + ' at ' + id + ', ' + side) + (brush ? ' has a color of its own now.' : ' has the color of the rest again.'));
      return;
    }
    if (tab === 'shape') {
      const t = hand.shape;
      if (t === 'lock') chart.tapLock(id);
      else if (t === 'one') app.pick({ kind: 'level', id });
      else if (t === 'curve') app.pick(p.kind === 'stretch' && p.top && !p.bottom && p.top !== id ? sorted(p.top, id) : { kind: 'stretch', top: id, bottom: null });
      else { app.flash(id, true); if (t !== 'turn') { app.say((t === 'xray' ? 'Tracing' : 'Drawing') + ' needs a finger or a mouse. The Curve tool bends the spine with sliders.'); return; } }
    } else if (tab === 'parts') {
      const t = hand.parts, part = sidePart(id, side);
      if (t === 'rod') { if (!easy.rodPick(id, side)) app.say('A rod runs from part to part. There is no part here.'); return; }
      if (t === 'link') { if (easy.putGap(id)) app.settle(); else { app.say($('traySay').textContent || 'There is no room for a cross-link under ' + id + '.'); return; } }
      else if (t === 'erase') { if (part) { app.pick({ kind: part.kind, index: part.index }); removeChosen(); } }
      else if (t === 'turn') { if (part) pickPart(part, false); else app.pick({ kind: 'level', id }); }
      else if (part && ((t === 'screw') === (part.kind === 'screws'))) pickPart(part, false);
      else if (easy.put(id, side)) app.settle();
    } else if (tab === 'marks') {
      // a pain point or a note at this vertebra is selected. Where there is none, the tool in hand puts one on its back.
      const i = markNear(l);
      if (i >= 0) app.pick({ kind: 'marks', index: i });
      else if (marking) addMarkAt(slot(l, side).screw.head);
      else return;
      return;
    }
    kbTell();
  }
  $('view').addEventListener('keydown', (e) => {
    if (!app.spine || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = ids(), zoom = (k) => { const c = renderer.camera; c.distance = Math.max(80, Math.min(4000, c.distance * k)); renderer.requestDraw(); };
    if (e.key === '+' || e.key === '=') { zoom(0.85); return; }
    if (e.key === '-' || e.key === '_') { zoom(1 / 0.85); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    if (!kb || !list.includes(kb.id)) kb = { id: (one() || {}).id || list[Math.floor(list.length / 2)], side: 'left' };
    else if (e.key === 'ArrowUp') kb.id = list[Math.max(0, list.indexOf(kb.id) - 1)];
    else if (e.key === 'ArrowDown') kb.id = list[Math.min(list.length - 1, list.indexOf(kb.id) + 1)];
    else if (e.key === 'ArrowLeft') kb.side = 'left';
    else if (e.key === 'ArrowRight') kb.side = 'right';
    else { app.point(kb.id); kbTap(); return; }
    app.point(kb.id); kbTell();
  });
  $('view').addEventListener('blur', () => { if (kb) { kb = null; app.point(null); } });
  // (the number on a tool is its key: said as a shortcut, not as part of its name)
  each('#tray kbd', (k) => { k.setAttribute('aria-hidden', 'true'); k.parentElement.setAttribute('aria-keyshortcuts', k.textContent); });

  // ---------------------------------------------------------------- keys
  window.addEventListener('keydown', (e) => {
    if (!app.spine || document.querySelector('dialog[open]') || document.body.classList.contains('clean')) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (e.key === 'Escape') {
      // Escape lets go of what is held, one thing at a time: a rod that was started, the three questions, the selection, then the tool
      if (typing) { e.target.blur(); return; }
      if (easy.picking()) { easy.stopPicking(); app.say(''); }
      else if (filling) { filling = false; sync(); }
      else if (app.picked && !(tab === 'shape' && (hand.shape === 'curve' || hand.shape === 'one'))) app.pick(null);
      else if (tab in hand && hand[tab] !== 'turn') pickTool('turn');
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (pieceOf() || markOf())) { e.preventDefault(); if (markOf()) removePicked(); else removeChosen(); return; }
    // the number keys take the tools of the tray in hand, from left to right
    if (/^[1-9]$/.test(e.key) && tab in hand) { const b = document.querySelectorAll('#tray [data-tools="' + tab + '"] [data-t]')[Number(e.key) - 1]; if (b) { e.preventDefault(); pickTool(b.dataset.t); } }
  });

  // ---------------------------------------------------------------- the line of help
  // One line over the model that says what a press does right now, with the tool in hand.
  function coach() {
    if (!app.spine) return;
    const turnSays = touch() ? 'Drag to turn the model. Pinch to zoom, two fingers to move.' : 'Drag to turn the model. Scroll to zoom, right-drag to move.';
    let text = '';
    if (tab === 'shape') {
      const t = hand.shape, p = app.picked || {}, locked = chart.lockWords();
      text = t === 'turn' ? turnSays
        : t === 'draw' || t === 'points' ? $('drawSay').textContent
          : t === 'xray' ? xray.says()
          : t === 'curve' ? (stretch() ? 'Move the sliders, or drag that part of the model.' : p.top ? p.top + ' is one end. ' + Press() + ' the other end.' : Press() + ' the two ends of the stretch.')
            : t === 'one' ? (one() ? (how.one === 'size' ? 'Drag a knob to resize it.' : how.one === 'turn' ? 'Drag a ring to turn it.' : 'Drag an arrow, or the vertebra itself.') : Press() + ' a vertebra.')
              : (locked ? 'Locked: ' + locked + '. ' : '') + Press() + ' vertebrae to lock them. They stay put while the rest is shaped.';
    } else if (tab === 'parts') {
      const t = hand.parts, kind = app.picked && app.picked.kind;
      text = filling ? (easy.picking() ? '' : 'Three questions, and the hardware is put on.')
        : kind === 'rods' && chosen().length < 2 ? 'Drag the rod between two of its parts to bend it.'
          : kind === 'screws' || kind === 'hooks' ? 'Drag it over the bone to move it.'
            : kind === 'crosslinks' ? 'It sits between the two rods.'
              : kind === 'level' && cat === 'bones' ? 'Pick a picture to change this vertebra.'
              : t === 'bone' ? Press() + ' a vertebra to change it.'
              : kind === 'discs' ? 'Pick a picture to change this disc.'
              : t === 'disc' ? Press() + ' a disc to change it. Turn the model if a bone is in the way.'
              : kind === 'level' ? 'Choose what ' + app.picked.id + ' carries.'
                : t === 'turn' ? Press() + ' a part or a vertebra to change it. Drag to turn the model.'
                  : t === 'rod' ? $('rodSay').textContent : $('traySay').textContent;
    } else if (tab === 'story') {
      text = story ? story.says() : '';
    } else if (tab === 'look') {
      text = colorWhat === 'one' ? Press() + ' a part or a vertebra to ' + (brush ? 'give it this color.' : 'give it back the color of the rest.') : 'Pick what the color goes on, then the color. Drag to turn the model.';
    } else if (tab === 'marks') {
      text = markOf() ? 'Drag its arrows to move it, or its label to move the words.' : marking === 'pain' ? Press() + ' the spot that hurts.' : marking === 'note' ? Press() + ' the spot the note is about.' : app.spine.marks.length ? Press() + ' a pain point or a note to change it.' : turnSays;
    }
    $('coach').textContent = text;
  }
  // (what the tools say is written into three hidden lines by the code that runs them: show it when it changes)
  if (window.MutationObserver) new MutationObserver(coach).observe($('drawSay').parentElement, { childList: true, characterData: true, subtree: true });

  // ---------------------------------------------------------------- colours: all of them are set on the Look card
  // A colour goes on one kind of hardware, on the bone, on the discs, or on one part: with "One part", a tap on the
  // model paints what is under it. The last thing done is what shows: a set of colours, a colour for a kind and
  // "By level" take away the own colours of the parts they are about, so nothing set earlier stays behind unseen.
  const SAYS = { ...Object.fromEntries(PART_KINDS.map((p) => [p.kind, 'All ' + p.words])), bone: 'All vertebrae', disc: 'All discs', one: 'One part' };
  const KIND_KEYS = KINDS;
  let colorWhat = 'screws', brush = 'red';
  const hexOf = (name) => (FINISHES[name] ? '#' + FINISHES[name].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : name);
  const owned = () => KIND_KEYS.reduce((n, k) => n + hw()[k].filter((p) => p.color).length, 0) + app.spine.levels.filter((l) => l.color).length;
  const dropOwn = (kinds, bones = false) => { for (const k of kinds) for (const p of hw()[k]) delete p.color; if (bones) for (const l of app.spine.levels) delete l.color; };
  const hasOwn = (kinds, bones = false) => kinds.some((k) => hw()[k].some((p) => p.color)) || (bones && app.spine.levels.some((l) => l.color));
  function colorPicked(name) {
    const what = colorWhat;
    if (what === 'one') { brush = name; showColors(); coach(); return; }
    if (what === 'bone' || what === 'disc') {
      if (what === 'bone' && hasOwn([], true)) app.change(() => dropOwn([], true), { ride: false });
      app.setLook({ [what]: name ? hexOf(name) : '' });
      return;
    }
    if ((what === 'screws' || what === 'hooks') && app.look().byLevel) app.setLook({ byLevel: false });
    app.change(() => { dropOwn([what]); const c = { ...(hw().colors || {}) }; if (name) c[what] = name; else delete c[what]; hw().colors = c; }, { ride: false });
  }
  each('[data-palette]', (b) => b.addEventListener('click', () => {
    if (app.look().byLevel) app.setLook({ byLevel: false });
    app.change(() => { dropOwn(KIND_KEYS); hw().colors = { ...PALETTES[b.dataset.palette] }; }, { ride: false });
  }));
  $('byLevelBtn').addEventListener('click', () => {
    const on = !app.look().byLevel;
    if (on && hasOwn(['screws', 'hooks'])) app.change(() => dropOwn(['screws', 'hooks']), { ride: false });
    app.setLook({ byLevel: on });
  });
  each('#colorWhat [data-what]', (b) => b.addEventListener('click', () => { colorWhat = b.dataset.what; sync(); }));
  $('ownClear').addEventListener('click', () => app.change(() => dropOwn(KIND_KEYS, true), { ride: false }));
  // (from the card of a part: its colour is set on the Look card, with the brush)
  each('[data-tocolor]', (b) => b.addEventListener('click', () => { colorWhat = 'one'; showTab('look'); }));
  // A tap on the model with Look open. With "One part" it paints. Otherwise it shows the colour of that kind of thing.
  function paintTap(e) {
    const what = hitThing(e, false), hit = what ? null : hitLevel(e);
    if (!what && !hit) return;
    if (colorWhat !== 'one') { colorWhat = what ? what.kind : 'bone'; sync(); return; }
    const target = what ? hw()[what.kind][what.index] : hit.level;
    app.change(() => { if (brush) target.color = brush; else delete target.color; }, { ride: false });
    app.say((what ? PART_NAMES[what.kind] + (target.level ? ' at ' + target.level : '') : hit.level.id) + (brush ? ' has a color of its own now.' : ' has the color of the rest again.'));
  }
  function showColors() {
    const look = app.look(), what = colorWhat, n = owned();
    pressed('[data-palette]', 'palette', look.byLevel ? '' : easy.paletteNow());
    $('byLevelBtn').setAttribute('aria-pressed', look.byLevel ? 'true' : 'false');
    pressed('#colorWhat [data-what]', 'what', what);
    const now = what === 'one' ? brush : what === 'bone' || what === 'disc' ? (look[what] === app.usualLook[what] ? '' : look[what]) : easy.kindColor(what);
    swatches($('lookColors'), SAYS[what], now, colorPicked, what === 'one' ? 'like the rest' : what === 'bone' || what === 'disc' ? 'the usual' : false, true);
    $('colorSay').textContent = what === 'one' ? Press() + ' a part or a vertebra on the model to ' + (brush ? 'give it this color.' : 'give it back the color of the rest.')
      : (what === 'screws' || what === 'hooks') && look.byLevel ? 'By level is on, so each one has the color of its vertebra. A color picked here turns that off.'
        : SAYS[what] + ' take this color.';
    $('ownRow').hidden = !n;
    $('ownSay').textContent = n + (n === 1 ? ' part has' : ' parts have') + ' a color of ' + (n === 1 ? 'its' : 'their') + ' own.';
    // (on a small screen the card scrolls: with the brush in hand, keep the colours and the line about painted parts in view)
    if (what === 'one' && !wide() && !$('card').hidden) (n ? $('ownRow') : $('colorSay')).scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- everything on the page that depends on the state
  function cardNow() {
    const p = app.picked;
    if (tab === 'look') return 'look';
    if (tab === 'story') return 'story';
    if (tab === 'shape') return hand.shape === 'curve' ? 'curve' : hand.shape === 'one' ? 'one' : hand.shape === 'xray' ? 'xray' : null;
    if (tab === 'parts') return filling ? 'fill' : !p ? null : p.kind === 'rods' && chosen().length < 2 ? 'rod' : PART_NAMES[p.kind] ? 'piece' : p.kind === 'level' ? (cat === 'bones' ? 'frac' : 'bone') : p.kind === 'discs' ? 'disc' : null;
    return markOf() ? 'mark' : null;
  }
  function sync() {
    if (!app.spine) return;
    const card = cardNow(), t = hand[tab];
    // (a card that has just opened starts at its top)
    if (card !== cardWas) { cardWas = card; $('card').scrollTop = 0; $('side').scrollTop = 0; }
    $('card').hidden = !card;
    $('catalog').hidden = $('fine').hidden = tab !== 'parts';
    if (tab === 'parts') catalogBox();
    each('#card [data-card]', (s) => { s.hidden = s.dataset.card !== card; });
    document.body.classList.toggle('carded', !!card);
    each('#tray [data-t]', (b) => b.setAttribute('aria-pressed', b.dataset.t === hand[b.parentElement.dataset.tools] ? 'true' : 'false'));
    // the choices that go with the tool in hand
    let some = false;
    each('#opts [data-opts]', (el) => { el.hidden = !el.dataset.opts.split(' ').includes(tab + ':' + t); some = some || !el.hidden; });
    $('opts').hidden = !some;
    pressed('[data-hook]', 'hook', hookFace); $('bothBtn').setAttribute('aria-pressed', both ? 'true' : 'false');
    if (tab === 'look') showColors();
    // the flat view beside the model: the map with the hardware, and on a wide screen the blocks with the shape
    // (a picture of an X-ray that is shown side by side takes that place, except while the map of the hardware is open)
    const beside = xray.beside(), can = tab === 'parts' || (tab === 'shape' && wide() && !beside);
    const on = tab === 'parts' && stripOn.parts ? 'map' : beside ? 'xray' : can && stripOn[tab] ? 'blocks' : '';
    $('strip').hidden = !on; $('mapBox').hidden = on !== 'map'; $('blocksBox').hidden = on !== 'blocks'; $('xrayBox').hidden = on !== 'xray';
    $('stripBtn').hidden = !can; $('stripBtn').setAttribute('aria-pressed', on === 'map' || on === 'blocks' ? 'true' : 'false'); $('stripBtn').lastElementChild.textContent = tab === 'parts' ? 'Map' : 'Blocks';
    document.body.classList.toggle('stripped', !!on);
    // (the picture has a new shape: bring the whole spine into it again once the page has been laid out)
    if (on !== stripWas) { stripWas = on; requestAnimationFrame(() => { app.fit(); renderer.requestDraw(); }); }
    if (card === 'one') oneBox();
    if (card === 'curve') curveBox();
    if (card === 'piece' || card === 'rod') pieceBox();
    if (card === 'disc') discBox();
    if (card === 'frac') fracBox();
    if (card === 'mark') markBox();
    easy.sync(); chart.sync(); xray.sync(); listBox(); if (story) story.sync(); coach();
  }
  WIDE.addEventListener('change', () => { if (app.spine) sync(); });

  const easy = setupEasy(app, { $, each, pressed, options, ids, levelOf, hitLevel, hint: coach, chosen, pickPart, both: () => both, look: () => screwLook, touch,
    // the three questions were answered: the card closes, and a tap now selects, so the result can be looked at and changed
    filled(text) { filling = false; hand.parts = 'turn'; arm(); app.say(text); sync(); },
    held: () => chart.held(), stopLine: () => { chart.stopLine(); chart.stopPicking(); }, lineOn: () => chart.lineOn() });
  const chart = setupChart(app, { $, each, pressed, ids, levelOf, hint: coach, stopOthers: () => easy.stopDrawing(), drawing: () => easy.draw.on(), regionIds, touch });
  const xray = setupXray(app, { $, each, pressed, options, ids, hint: coach, touch, held: () => chart.held(), changed: () => sync() });
  let story = null;
  showTab('shape');
  return {
    sync, handles,
    // the steps of the sketch are looked after by ui/story.js, which is set up after the builder
    setStory(s) { story = s; sync(); },
    // another step of the sketch was opened: a trace on an X-ray belongs to the step it was fitted to
    stepped() { xray.loosen(); },
    // what is on the open spine, as lines of words under headings: [{ head, text }]
    rows: () => lastRows.map((r) => ({ head: r.head, text: r.text })),
    // the soft marks on the model that show where the tool in hand can be used (only with the hardware)
    hints: () => (tab === 'parts' && !filling ? easy.hints() : null),
    // a spine was opened: the tools start over for it
    opened() { easy.opened(); if (tab === 'shape' && hand.shape === 'curve') app.picked = firstStretch(); arm(); },
    // Undo went back, or a spine was opened: let go of what was being done to the spine as it was
    reset() { xray.recall(); easy.stopPicking(); hot = null; drag = null; if (tab === 'shape' && hand.shape === 'points' && chart.lineOn()) chart.startLine(); },
    // open one of the five by its name ('shape', 'parts', 'marks', 'story', 'look'), or take a tool of the open one in hand
    go(name) { showTab(name); },
    tool(name) { pickTool(name); },
    // where things stand (the checks in a browser use this)
    state: () => ({ tab, tool: hand[tab] || null, story: story ? story.state() : null, card: cardNow(), both, strip: !$('strip').hidden, xray: xray.state() }),
    // the X-ray tool: open a picture file, and where its spots are on the page (the checks in a browser use these)
    xray: { open: (file) => xray.open(file), pageOf: (px) => xray.pageOf(px), pixelOf: (x, y) => xray.pixelOf(x, y) },
    // the vertebra under a point of the page, if there is one (the checks in a browser use this)
    levelAt(clientX, clientY) { const hit = hitLevel({ clientX, clientY }); return hit ? hit.level.id : null; },
    discAt(clientX, clientY) { return hitDisc({ clientX, clientY }); },
    // is one of the soft marks under a point of the page?
    markAt(clientX, clientY) { return easy.markAt({ clientX, clientY }); },
    // the kind of part under a point of the page ('screws', 'hooks', 'crosslinks', 'rods'), if there is one
    thingAt(clientX, clientY) { const what = hitThing({ clientX, clientY }, false); return what ? what.kind : null; },
    // what the colour on the Look card goes on ('rods', 'screws', 'hooks', 'crosslinks', 'bone', 'disc', or 'one' for the brush), and the colour of the brush
    colorOn(what, color) { colorWhat = what; if (what === 'one' && color !== undefined) brush = color; sync(); },
    colors: () => ({ what: colorWhat, brush, own: owned() }),
    // what a tap at a point of the page does with the brush of the Look card, and with the tool for pain points or notes (the tour uses these)
    paintAt(clientX, clientY) { paintTap({ clientX, clientY }); },
    painAt(clientX, clientY) { addMark({ clientX, clientY }); },
    workOn,
  };
}
