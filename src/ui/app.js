// The page: loads a spine file, draws it, keeps the history for Undo, and wires up the parts
// of the panel that are about files and viewing. The builder (shape, hardware, pain) is in
// build.js.

import { createRenderer } from '../view/renderer.js';
import { buildScene, boundsOf } from '../view/scene.js';
import { gizmoItems } from '../view/gizmo.js';
import { validateSpine, sortedLevels } from '../core/spinefile.js';
import { measureSpine } from '../core/measures.js';
import { readSpineFile, saveSpineFile, loadExample, listExamples, download, fileNameFor } from '../io/files.js';
import { packSpine, unpackSpine, linkFor, packedIn } from '../io/share.js';
import { stlOf } from '../io/print.js';
import { rigOf, carry, stiffen, blockOf } from '../core/shape.js';
import { fitRods } from '../core/place.js';
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
  stiff: true,                         // fused stretches move as blocks (the switch in the Shape tab)
  inLine: true,                        // a part stops where its rod could not follow (the switch under By hand)
  showStiff: true,                     // tint the stiff blocks (while the Shape tab is open)
  get spine() { return spine; },
  say(text) { $('status').textContent = text || ''; },

  // Draw the spine again after something changed.
  redraw() {
    if (!spine) return;
    // the vertebrae fused to the picked one are tinted too: they move with it
    const block = app.picked && app.picked.kind === 'level' && app.rig ? blockOf(spine, app.rig, app.picked.id) : null;
    // while the spine is being shaped, the stretches that are held stiff are drawn in a cooler colour
    const order = sortedLevels(spine).map((l) => l.id), stiff = [];
    if (app.showStiff && app.stiff && app.rig) for (const b of app.rig.blocks || []) stiff.push(...order.slice(b.from, b.to + 1));
    const items = buildScene(spine, DETAIL, { picked: block ? { ...app.picked, mates: block.ids } : app.picked, stiff, spots: app.spots, look: { bone: rgb(look.bone), disc: rgb(look.disc), hardware: look.hardware ? rgb(look.hardware) : null, byLevel: look.byLevel } });
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
    // (after the bones have moved, the rods are strung through their parts again, so they stay smooth)
    if (ride) { carry(spine, fn); if (((spine.hardware || {}).rods || []).some((r) => r.auto)) fitRods(spine); } else fn();
    if (settle) stiffen(spine, app.rig, app.stiff);   // before drawing, so a stretch that was just fused shows as stiff at once
    app.redraw();
    if (settle) app.settle();
  },

  // The change is finished: remember it for Undo and bring the panel up to date.
  settle() {
    stiffen(spine, app.rig, app.stiff);            // the fused stretches may have changed
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
  app.rig = rigOf(spine, app.stiff); app.picked = p && ((p.kind === 'level' && has(p.id)) || (p.kind === 'stretch' && has(p.top) && (!p.bottom || has(p.bottom)))) ? p : null; app.spots = [];
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
    app.rig = rigOf(spine, app.stiff); app.picked = null; app.spots = [];
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

// ---- the note shown when the app opens

// What this copy of the app is: filled in by the build (tools/build.mjs) from package.json
// and site.json. When the app runs straight from the source files there is nothing to fill in.
const BUILD = window.SPINE_BUILD || { version: '', source: '' };

function welcome(asked) {
  const box = $('welcome');
  let seen = false;
  try { seen = localStorage.getItem('spineBuilderWelcome') === 'seen'; } catch (e) { /* no storage here: the note shows every time */ }
  $('welcomeSkip').checked = seen;
  $('welcomeGo').textContent = asked ? 'Close' : 'Start building';
  $('welcomeHost').hidden = !/^https?:$/.test(location.protocol);
  const more = $('welcomeMore');
  more.textContent = 'Free and open source under the MIT licence. Bone shapes: ' + SHAPE_CREDIT + '.' + (BUILD.version ? ' Version ' + BUILD.version + '.' : '');
  if (BUILD.source) { const a = document.createElement('a'); a.href = BUILD.source; a.rel = 'noopener'; a.target = '_blank'; a.textContent = 'Source code and how it works'; more.append(' ', a, '.'); }
  if ((asked || !seen) && !box.open) { if (box.showModal) box.showModal(); else box.setAttribute('open', ''); }
}
function welcomeDone() {
  try { if ($('welcomeSkip').checked) localStorage.setItem('spineBuilderWelcome', 'seen'); else localStorage.removeItem('spineBuilderWelcome'); } catch (e) { /* not kept, that is all */ }
  const box = $('welcome');
  if (box.close) box.close(); else box.removeAttribute('open');
}

// ---- sharing: a link, a picture, a file for printing

// Open the spine packed into the address of the page, if there is one. Returns true if the
// address held a link, whether or not it could be read.
function openLink() {
  const packed = packedIn(location.hash);
  if (!packed) return false;
  unpackSpine(packed)
    .then((s) => { const problems = validateSpine(s); if (problems.length) throw new Error(problems[0]); show(s, []); })
    .catch(() => openExample(START).then(() => {
      const li = document.createElement('li');
      li.textContent = 'That link could not be read as a spine. It may have been cut short on the way.';
      $('problems').textContent = ''; $('problems').appendChild(li); $('problemBox').hidden = false;
    }));
  // the address goes back to plain, so a later change to the sketch is not mistaken for the link
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* stays as it is */ }
  return true;
}

function copyLink() {
  if (!spine) return;
  packSpine(spine).then((packed) => {
    const link = linkFor(location.href, packed), box = $('linkText'), local = location.protocol === 'file:';
    box.hidden = false; box.value = link; box.focus(); box.select();
    const tail = (local ? ' This copy of the app was opened from a folder, so the link only works where the app sits in the same place. Put the app on the web to get links anyone can open.' : '') + (link.length > 6000 ? ' It is ' + link.length + ' characters long, which some sites cut short. A saved file is safer for this one.' : '');
    const done = (ok) => { $('linkSay').textContent = (ok ? 'Copied.' : 'Copy it from the box above.') + tail; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => done(true), () => done(false)); else done(false);
  });
}

// The view as a picture: the model, the level names and tags that are showing, and a line
// that says what it is and where the bone shapes come from.
function pictureOf() {
  const gl = renderer.picture(), out = document.createElement('canvas'), k = gl.width / gl.clientWidth;
  out.width = gl.width; out.height = gl.height;
  const g = out.getContext('2d'), pale = $('stage').classList.contains('pale');
  g.drawImage(gl, 0, 0);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const pill = (text, at, lift, size, bold) => {
    const p = renderer.project(at);
    if (!p) return;
    g.font = (bold ? '650 ' : '') + size * k + 'px system-ui, sans-serif';
    const w = g.measureText(text).width + 12 * k, h = (size + 6) * k, x = p[0] * k - w / 2, y = (p[1] - lift) * k - h / 2;
    g.fillStyle = 'rgba(19, 20, 24, 0.8)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
    g.fillStyle = '#eceae5'; g.fillText(text, p[0] * k, (p[1] - lift) * k + k * 0.5);
  };
  if (!$('labels').hidden) for (const l of labels) pill(l.el.textContent, l.at, 0, 11, true);
  if (!$('tags').hidden) for (const t of tags) pill(t.el.textContent, t.at, t.lift, 12, false);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = 11 * k + 'px system-ui, sans-serif'; g.fillStyle = pale ? 'rgba(30, 31, 36, 0.75)' : 'rgba(236, 234, 229, 0.7)';
  const lines = ['A sketch made with Spine Builder. Not a medical image.'].concat(look.simple ? [] : ['Bone shapes: ' + SHAPE_CREDIT]);
  lines.forEach((text, i) => g.fillText(text, 10 * k, out.height - (10 + (lines.length - 1 - i) * 15) * k));
  return out;
}

const PRINTED = ['vertebrae', 'discs', 'rods', 'screws', 'hooks', 'crosslinks'];
function saveStl() {
  if (!spine) return;
  const scale = parseFloat($('stlScale').value) || 1, items = renderer.items().filter((it) => PRINTED.includes(it.group) && it.visible !== false);
  if (!items.length) { $('stlSay').textContent = 'Nothing is shown, so there is nothing to print. Tick some parts under Show.'; return; }
  const bytes = stlOf(items, scale, 'Spine Builder sketch. Bones: BodyParts3D (c) DBCLS, CC BY 4.0'), view = new DataView(bytes.buffer);
  // how tall the print will be: the highest and the lowest corner in the file
  let low = Infinity, high = -Infinity;
  for (let at = 84; at < bytes.length; at += 50) for (const k of [20, 32, 44]) { const z = view.getFloat32(at + k, true); if (z < low) low = z; if (z > high) high = z; }
  const tall = Math.round(high - low);
  download(new Blob([bytes], { type: 'model/stl' }), fileNameFor(spine) + (scale === 1 ? '' : '-' + Math.round(scale * 100) + 'pct') + '.stl');
  $('stlSay').textContent = 'Saved: about ' + tall + ' mm tall, ' + (bytes.length / 1e6).toFixed(1) + ' MB. Its parts are separate shapes that overlap, and slicers join them on their own. If you pass the file on, name BodyParts3D as the source of the bone shapes.';
}

// ---- the look

function applyLook(save = true) {
  renderer.setBackground(BACKS[look.back] || BACKS.dark);
  $('stage').classList.toggle('pale', look.shade !== 'xray' && (look.back === 'light' || look.back === 'white' || look.back === 'grey'));
  document.querySelectorAll('[data-back]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.back === look.back ? 'true' : 'false'));
  renderer.setShading(look.shade);
  document.querySelectorAll('[data-shade]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.shade === look.shade ? 'true' : 'false'));
  $('colBone').value = look.bone; $('colDisc').value = look.disc; $('hwByLevel').checked = !!look.byLevel;
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
  $('welcomeGo').addEventListener('click', welcomeDone);
  $('welcome').addEventListener('cancel', (e) => { e.preventDefault(); welcomeDone(); });      // Esc
  $('aboutBtn').addEventListener('click', () => welcome(true));
  $('linkBtn').addEventListener('click', copyLink);
  $('pictureBtn').addEventListener('click', () => { if (spine) pictureOf().toBlob((blob) => download(blob, fileNameFor(spine) + '.png'), 'image/png'); });
  $('stlBtn').addEventListener('click', saveStl);
  window.addEventListener('hashchange', openLink);
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
  $('hwByLevel').addEventListener('change', () => { look.byLevel = $('hwByLevel').checked; applyLook(); });
  $('simpleBones').addEventListener('change', () => { look.simple = $('simpleBones').checked; applyLook(); });
  // the bone shapes come from an open anatomy collection that asks to be named
  $('credit').textContent = 'Bone shapes: ' + SHAPE_CREDIT + '. Resized and placed for this app.';
  $('lookReset').addEventListener('click', () => { look = { ...USUAL }; $('boneOpacity').value = 100; applyLook(); });
  // the menus of the ribbon: a button opens its menu, a click elsewhere or Esc closes it
  const closeMenus = (but) => document.querySelectorAll('[data-menu]').forEach((b) => { if (b !== but) { b.setAttribute('aria-expanded', 'false'); $(b.dataset.menu).hidden = true; } });
  document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); closeMenus(b);
    const menu = $(b.dataset.menu), open = menu.hidden;
    menu.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      // the menu drops down under its button, kept inside the window
      const at = b.getBoundingClientRect(), wide = menu.offsetWidth;
      menu.style.right = 'auto'; menu.style.top = Math.round(at.bottom + 6) + 'px';
      menu.style.left = Math.round(Math.max(8, Math.min(at.left, window.innerWidth - wide - 8))) + 'px';
      if (menu.id === 'shareMenu') { $('linkText').hidden = true; $('linkSay').textContent = ''; }
    }
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
  if (!openLink()) openExample(START);
  welcome(false);
  // handy when trying things in the browser console
  window.spineBuilder = { renderer, app, builder, current: () => spine, show, openExample };
}
