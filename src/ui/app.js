// The page: loads a spine file, draws it, keeps the history for Undo, and wires up the parts
// of the panel that are about files and viewing. The builder (shape, hardware, pain) is in
// build.js.

import { createRenderer } from '../view/renderer.js';
import { buildScene, boundsOf } from '../view/scene.js';
import { gizmoItems } from '../view/gizmo.js';
import { validateSpine, sortedLevels } from '../core/spinefile.js';
import { measureSpine } from '../core/measures.js';
import { readSpineFile, saveSpineFile, loadExample, listExamples } from '../io/files.js';
import { rigOf, carry } from '../core/shape.js';
import { setBoneStyle } from '../core/bones.js';
import { SHAPE_CREDIT } from '../shapes/bodyparts3d.js';
import { setupBuilder } from './build.js';

const $ = (id) => document.getElementById(id);
// phones get a slightly coarser grid for the bones so they appear sooner
const DETAIL = window.matchMedia('(max-width: 760px)').matches ? 1.8 : 1.4;
const START = 'average.spine.json';
const renderer = createRenderer($('view'));
let spine = null, labels = [], tags = [], builder = null;
let past = [], future = [];          // spine files as text, for Undo and Redo

// ---- how things look (kept on this device between visits)
const BACKS = { dark: [0.075, 0.08, 0.1], grey: [0.43, 0.44, 0.47], light: [0.93, 0.92, 0.89], white: [1, 1, 1], black: [0, 0, 0] };
const USUAL = { back: 'dark', shade: 'soft', bone: '#c7ad85', disc: '#5485bd', hardware: '', byLevel: false, simple: false };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
let look = { ...USUAL };
try { look = { ...USUAL, ...JSON.parse(localStorage.getItem('spineBuilderLook') || '{}') }; } catch (e) { /* no storage here: use the usual look */ }

// What the builder works with. "rig" is the spine as a chain (see core/shape.js). "picked" is
// what is selected, "spots" the dots shown while a part is being placed.
const app = {
  $, renderer, DETAIL, rig: null, picked: null, spots: [],
  get spine() { return spine; },
  say(text) { $('status').textContent = text || ''; },

  // Draw the spine again after something changed.
  redraw() {
    if (!spine) return;
    const items = buildScene(spine, DETAIL, { picked: app.picked, spots: app.spots, look: { bone: rgb(look.bone), disc: rgb(look.disc), hardware: look.hardware ? rgb(look.hardware) : null, byLevel: look.byLevel } });
    const handles = builder && builder.handles();
    renderer.setItems(handles ? items.concat(gizmoItems(handles.spec, handles.active)) : items);
    applyToggles();
    const centre = {};
    for (const l of spine.levels) centre[l.id] = l.centre;
    for (const l of labels) l.at = centre[l.id];
    buildTags();
    showNumbers();
  },

  // Change the spine. The hardware and the marks ride along with their vertebrae.
  //   settle: false while a slider or a drag is still moving (no Undo step yet)
  //   ride:   false when the change is to the hardware or the marks themselves
  change(fn, { settle = true, ride = true } = {}) {
    if (!spine) return;
    if (ride) carry(spine, fn); else fn();
    app.redraw();
    if (settle) app.settle();
  },

  // The change is finished: remember it for Undo and bring the panel up to date.
  settle() {
    const text = JSON.stringify(spine);
    if (text !== past[past.length - 1]) { past.push(text); if (past.length > 80) past.shift(); future = []; }
    syncHistory();
    if (builder) builder.sync();
  },

  pick(what) {
    app.picked = what;
    app.redraw();
    if (builder) builder.sync();
  },
};

function restore(text) {
  spine = JSON.parse(text);
  // a picked vertebra or stretch stays picked; a picked part may no longer exist
  const p = app.picked, has = (id) => spine.levels.some((l) => l.id === id);
  app.rig = rigOf(spine); app.picked = p && ((p.kind === 'level' && has(p.id)) || (p.kind === 'stretch' && has(p.top) && (!p.bottom || has(p.bottom)))) ? p : null; app.spots = [];
  if (builder) builder.reset();
  buildLabels(); app.redraw(); syncHistory();
  if (builder) builder.sync();
}

function syncHistory() {
  $('undoBtn').disabled = past.length < 2;
  $('redoBtn').disabled = !future.length;
}

function undo() {
  if (past.length < 2) return;
  future.push(past.pop());
  restore(past[past.length - 1]);
}

function redo() {
  if (!future.length) return;
  past.push(future.pop());
  restore(past[past.length - 1]);
}

// Show a spine: check it, build its shapes, fill in the panel.
function show(next, problems) {
  $('problems').textContent = '';
  for (const p of problems || []) { const li = document.createElement('li'); li.textContent = p; $('problems').appendChild(li); }
  $('problemBox').hidden = !(problems && problems.length);
  if (!next || !Array.isArray(next.levels) || !next.levels.length) return;
  spine = next;
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) { spine.hardware = spine.hardware || {}; spine.hardware[key] = spine.hardware[key] || []; }
  spine.marks = spine.marks || [];
  $('name').textContent = spine.name || 'A spine';
  $('about').textContent = spine.about || '';
  app.say('Drawing the bones');
  // give the notice a moment to appear before the shapes are worked out
  setTimeout(() => {
    app.rig = rigOf(spine); app.picked = null; app.spots = [];
    past = [JSON.stringify(spine)]; future = [];
    if (builder) builder.reset();
    buildLabels();
    app.redraw();
    const box = boundsOf(spine);
    renderer.frame(box.low, box.high);
    syncHistory();
    if (builder) builder.sync();
    app.say('');
  }, 30);
}

function applyToggles() {
  const on = {};
  document.querySelectorAll('[data-group]').forEach((c) => { on[c.dataset.group] = c.checked; });
  const boneOpacity = $('boneOpacity').value / 100;
  for (const it of renderer.items()) {
    it.visible = on[it.group] !== false;
    it.opacity = it.group === 'vertebrae' || it.group === 'discs' ? it.baseOpacity * boneOpacity : it.baseOpacity;
  }
  $('labels').hidden = !$('labelsOn').checked;
  $('tags').hidden = on.marks === false;
  renderer.requestDraw();
}

function buildLabels() {
  $('labels').textContent = '';
  labels = sortedLevels(spine).map((level) => {
    const el = document.createElement('span');
    el.textContent = level.id;
    $('labels').appendChild(el);
    return { el, id: level.id, at: level.centre };
  });
}

// The words that go with the pain points and the notes, shown next to them on the model.
function buildTags() {
  $('tags').textContent = '';
  tags = [];
  for (const m of spine.marks) {
    if (!m.text) continue;
    const el = document.createElement('span');
    el.textContent = m.text + (m.kind === 'pain' && m.strength ? ' ' + m.strength + '/10' : '');
    $('tags').appendChild(el);
    tags.push({ el, at: m.at || [0, 1, 2].map((j) => (m.from[j] + m.to[j]) / 2), lift: m.kind === 'pain' ? 0 : 16 });
  }
}

// Keep the level names and the mark labels on their spots as the view turns.
function placeLabels() {
  const put = (l, dy) => {
    const p = renderer.project(l.at);
    l.el.style.display = p ? '' : 'none';
    if (p) l.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + (p[1] - dy).toFixed(1) + 'px) translate(-50%,-50%)';
  };
  if (!$('labels').hidden) for (const l of labels) put(l, 0);
  if (!$('tags').hidden) for (const t of tags) put(t, t.lift);
}

// The curves of the spine as a list. Clicking one selects that stretch in the Shape tab.
function showNumbers() {
  const m = measureSpine(spine), list = $('numbers');
  list.textContent = '';
  const line = (text, top, bottom, plane) => {
    const li = document.createElement('li'), b = document.createElement(top ? 'button' : 'span');
    b.textContent = text;
    if (top) b.addEventListener('click', () => builder.workOn(top, bottom, plane));
    li.appendChild(b); list.appendChild(li);
  };
  for (const c of m.curves) {
    line('Curve from ' + c.top + ' to ' + c.bottom + ': about ' + c.degrees + '°, bowing to the ' + c.bowsTo + ', furthest out at ' + c.apex + (c.held ? '' : ' (changes with posture)'), c.top, c.bottom, 0);
  }
  if (m.kyphosis !== null) line('Rounding of the chest part, T5 to T12: about ' + m.kyphosis + '°', 'T5', 'T12', 1);
  if (m.lordosis !== null) line('Hollow of the lower back, L1 to L5: about ' + m.lordosis + '°', 'L1', 'L5', 1);
  if (!list.children.length) line('No curve of 10° or more.');
}

// ---- the gallery of examples

// A small picture of a spine seen from behind, drawn from its file.
function sketch(s) {
  const xs = s.levels.map((l) => -l.centre[0]), zs = s.levels.map((l) => l.centre[2]), lowX = Math.min(...xs) - 30, highX = Math.max(...xs) + 30, lowZ = Math.min(...zs) - 25, highZ = Math.max(...zs) + 15;
  let body = '';
  for (const l of s.levels) body += '<rect x="' + (-l.centre[0] - l.size[0] / 2).toFixed(1) + '" y="' + (-l.centre[2] - l.size[2] / 2).toFixed(1) + '" width="' + l.size[0] + '" height="' + l.size[2] + '" rx="3" transform="rotate(' + l.tilt[0].toFixed(1) + ' ' + (-l.centre[0]).toFixed(1) + ' ' + (-l.centre[2]).toFixed(1) + ')" fill="#c7ad85"/>';
  for (const r of (s.hardware || {}).rods || []) body += '<polyline points="' + r.points.map((p) => (-p[0]).toFixed(1) + ',' + (-p[2]).toFixed(1)).join(' ') + '" fill="none" stroke="#6f8fe0" stroke-width="5" stroke-linecap="round"/>';
  return '<svg viewBox="' + [lowX, -highZ, highX - lowX, highZ - lowZ].map((v) => v.toFixed(0)).join(' ') + '" aria-hidden="true">' + body + '</svg>';
}

function openGallery() {
  const box = $('galleryList');
  box.textContent = '';
  $('gallery').showModal();
  listExamples().then((list) => Promise.all(list.map((e) => loadExample(e.file).then((s) => ({ ...e, spine: s }))))).then((list) => {
    for (const e of list) {
      const b = document.createElement('button');
      b.dataset.file = e.file;
      b.innerHTML = sketch(e.spine) + '<div><strong></strong><span></span></div>';
      b.querySelector('strong').textContent = e.name; b.querySelector('span').textContent = e.about;
      b.addEventListener('click', () => { $('gallery').close(); openExample(e.file); });
      box.appendChild(b);
    }
  }).catch(() => { box.textContent = 'The examples could not be loaded.'; });
}

function openExample(file) {
  return loadExample(file).then((s) => show(JSON.parse(JSON.stringify(s)), validateSpine(s))).catch(() => app.say('That example could not be loaded. Use Open a file.'));
}

// ---- the look

function applyLook(save = true) {
  renderer.setBackground(BACKS[look.back] || BACKS.dark);
  $('stage').classList.toggle('pale', look.shade !== 'xray' && (look.back === 'light' || look.back === 'white' || look.back === 'grey'));
  document.querySelectorAll('[data-back]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.back === look.back ? 'true' : 'false'));
  renderer.setShading(look.shade);
  document.querySelectorAll('[data-shade]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.shade === look.shade ? 'true' : 'false'));
  $('colBone').value = look.bone; $('colDisc').value = look.disc; $('colHw').value = look.hardware || '#9a9ea8'; $('hwByLevel').checked = !!look.byLevel;
  $('simpleBones').checked = !!look.simple; setBoneStyle(look.simple ? 'drawn' : 'real');
  if (save) { try { localStorage.setItem('spineBuilderLook', JSON.stringify(look)); } catch (e) { /* not kept, that is all */ } }
  app.redraw();
}

if (!renderer) {
  app.say('This browser cannot show 3D here. Try a current version of Chrome, Edge, Firefox or Safari.');
} else {
  renderer.afterDraw(placeLabels);
  builder = setupBuilder(app);
  document.querySelectorAll('[data-group]').forEach((c) => c.addEventListener('change', applyToggles));
  $('labelsOn').addEventListener('change', applyToggles);
  $('boneOpacity').addEventListener('input', applyToggles);
  $('openBtn').addEventListener('click', () => $('openFile').click());
  $('openFile').addEventListener('change', () => {
    const file = $('openFile').files[0];
    if (file) readSpineFile(file).then((r) => show(r.spine, r.problems));
    $('openFile').value = '';
  });
  $('saveBtn').addEventListener('click', () => { if (spine) saveSpineFile(spine); });
  $('newBtn').addEventListener('click', () => openExample(START));
  $('galleryBtn').addEventListener('click', openGallery);
  $('galleryClose').addEventListener('click', () => $('gallery').close());
  $('fitBtn').addEventListener('click', () => { if (spine) { const b = boundsOf(spine); renderer.frame(b.low, b.high); } });
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { look.back = b.dataset.back; applyLook(); }));
  document.querySelectorAll('[data-shade]').forEach((b) => b.addEventListener('click', () => { look.shade = b.dataset.shade; applyLook(); }));
  $('colBone').addEventListener('input', () => { look.bone = $('colBone').value; applyLook(); });
  $('colDisc').addEventListener('input', () => { look.disc = $('colDisc').value; applyLook(); });
  $('colHw').addEventListener('input', () => { look.hardware = $('colHw').value; applyLook(); });
  $('hwByLevel').addEventListener('change', () => { look.byLevel = $('hwByLevel').checked; applyLook(); });
  $('simpleBones').addEventListener('change', () => { look.simple = $('simpleBones').checked; applyLook(); });
  // the bone shapes come from an open anatomy collection that asks to be named
  $('credit').textContent = 'Bone shapes: ' + SHAPE_CREDIT + '. Resized and placed for this app.';
  $('lookReset').addEventListener('click', () => { look = { ...USUAL }; $('boneOpacity').value = 100; applyLook(); });
  // the menus of the ribbon: a button opens its menu, a click elsewhere or Esc closes it
  const closeMenus = (but) => document.querySelectorAll('[data-menu]').forEach((b) => { if (b !== but) { b.setAttribute('aria-expanded', 'false'); $(b.dataset.menu).hidden = true; } });
  document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); closeMenus(b);
    const open = $(b.dataset.menu).hidden;
    $(b.dataset.menu).hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }));
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('[data-menu]')) closeMenus(null); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(null); });
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); }
  });
  applyLook(false);
  openExample(START);
  // handy when trying things in the browser console
  window.spineBuilder = { renderer, app, builder, current: () => spine, show, openExample };
}
