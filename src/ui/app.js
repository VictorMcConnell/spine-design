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
import { stlOf, objOf } from '../io/print.js';
import { zipOf } from '../io/zip.js';
import { standFor } from '../core/stand.js';
import { smoother } from '../core/smooth.js';
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
const USUAL = { back: 'dark', shade: 'soft', bone: '#c7ad85', disc: '#5485bd', hardware: '', byLevel: false, simple: false, level: 'easy', layout: 'auto' };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
let look = { ...USUAL };
try { look = { ...USUAL, ...JSON.parse(localStorage.getItem('spineBuilderLook') || '{}') }; } catch (e) { /* no storage here: use the usual look */ }
const keepLook = () => { try { localStorage.setItem('spineBuilderLook', JSON.stringify(look)); } catch (e) { /* not kept, that is all */ } };

// ---- the layout: the full workspace, or the one for phones and tablets
// The phone and tablet layout shows one step at a time with the simple tools: shape, hardware,
// pain, share. "Auto" picks it on a narrow screen and on a device that is worked by touch
// alone. The choice is kept with the look, so a person can always get the other one.
const NARROW = window.matchMedia('(max-width: 760px)'), TOUCH = window.matchMedia('(pointer: coarse) and (hover: none)');
const guidedNow = () => look.layout === 'guided' || (look.layout !== 'full' && (NARROW.matches || TOUCH.matches));

// What the builder works with. "rig" is the spine as a chain (see core/shape.js). "picked" is
// what is selected, "spots" the dots shown while a part is being placed.
let glowTimer = null;
// Mark the blocks of the vertebra that glows (the map and the chart draw themselves again often, so they ask for this too).
function showGlow(scroll) {
  document.querySelectorAll('#map .glow, #blocks .glow, #map .peek, #blocks .peek').forEach((e) => { e.classList.remove('glow'); e.classList.remove('peek'); });
  // (the block of the bone the pointer is over on the model is marked more softly)
  if (app.peeked) document.querySelectorAll('#map [data-bone="' + app.peeked + '"], #blocks [data-block="' + app.peeked + '"]').forEach((e) => e.classList.add('peek'));
  if (!app.glow) return;
  document.querySelectorAll('#map [data-bone="' + app.glow + '"], #blocks [data-block="' + app.glow + '"]').forEach((e) => {
    e.classList.add('glow');
    // bring the block into view if the panel is scrolled away from it
    if (scroll && e.getBoundingClientRect().width) { const r = e.getBoundingClientRect(), box = $('panel').getBoundingClientRect(); if (r.top < box.top + 4 || r.bottom > Math.min(box.bottom, window.innerHeight) - 4) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
}
const app = {
  $, renderer, DETAIL, rig: null, picked: null, also: [], spots: [],
  frames: [],                          // things to do after every drawn frame (lines over the picture follow the view)
  held: new Set(),                     // the vertebrae locked in place while the curve is drawn or the blocks are slid
  glow: null,                          // the vertebra that was just clicked: its block on the map and the chart lights up for a moment
  lit: null,                           // the vertebra that lights up on the model for a moment: its block was tapped
  // Light up the block of a vertebra on the map and on the chart of blocks for a moment, so a
  // person can see which block goes with the bone that was clicked. With "model" the bone
  // on the model lights up too (the block was the thing that was tapped).
  flash(id, model = false) {
    clearTimeout(glowTimer);
    app.glow = id;
    showGlow(true);
    if (model && app.lit !== id) { app.lit = id; app.redraw(); }
    glowTimer = setTimeout(() => { app.glow = null; showGlow(false); if (model && app.lit === id) { app.lit = null; app.redraw(); } }, 1700);
  },
  showGlow: () => showGlow(false),
  peeked: null,                        // the vertebra the pointer is over on the model: its block is marked softly
  peek(id) { if (app.peeked !== id) { app.peeked = id; showGlow(false); } },
  // The pointer is over a block (id), or has left it (null): the bone on the model shows which one it is.
  pointed: null,
  point(id) { if (app.pointed !== id) { app.pointed = id; app.redraw(); } },
  // how much control the panel offers: 'easy', 'standard' or 'full' (kept with the look, on this device)
  // (the phone and tablet layout always works with the simple tools. The level that was chosen for the desktop layout is kept for it.)
  get level() { return app.guided ? 'easy' : ['easy', 'standard', 'full'].includes(look.level) ? look.level : 'easy'; },
  set level(name) { if (!app.guided && look.level !== name) { look.level = name; keepLook(); } },
  guided: guidedNow(),                 // the phone and tablet layout is on
  fit: () => fitView(),                // bring the whole spine into the picture
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
    const items = buildScene(spine, DETAIL, { picked: block ? { ...app.picked, mates: block.ids } : app.picked, also: app.also, stiff, locked: app.showStiff ? [...app.held] : [], spots: app.spots, lit: app.lit, pointed: app.pointed, hints: builder ? builder.hints() : null, look: { bone: rgb(look.bone), disc: rgb(look.disc), hardware: look.hardware ? rgb(look.hardware) : null, byLevel: look.byLevel } });
    // the stand chosen for printing is shown with the spine, so that what is saved is what is seen
    const stand = standNow();
    if (stand) for (const [list, name] of [[stand.onSpine, 'stand_fitting_on_spine'], [stand.stand, 'stand']]) for (const mesh of list) items.push({ group: 'stand', mesh, color: STAND_COLOR, opacity: 1, baseOpacity: 1, visible: true, name });
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

  // Select something. "also" lists more parts selected along with it.
  pick(what, also = []) {
    app.picked = what; app.also = what ? also : [];
    app.redraw();
    if (builder) builder.sync();
  },
};

function restore(text) {
  spine = JSON.parse(text);
  // a picked vertebra or stretch stays picked; a picked part may no longer exist
  const p = app.picked, has = (id) => spine.levels.some((l) => l.id === id);
  app.rig = rigOf(spine, app.stiff); app.picked = p && ((p.kind === 'level' && has(p.id)) || (p.kind === 'stretch' && has(p.top) && (!p.bottom || has(p.bottom)))) ? p : null; app.also = []; app.spots = [];
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
    app.rig = rigOf(spine, app.stiff); app.picked = null; app.also = []; app.spots = [];
    app.held.clear(); app.glow = app.lit = app.pointed = null;      // locks belong to the spine that was open before
    past = [JSON.stringify(spine)]; future = [];
    if (builder) { builder.reset(); builder.opened(); }
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
  $('tagLines').style.display = on.marks === false ? 'none' : '';
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
  $('tags').textContent = ''; $('tagLines').textContent = '';
  tags = [];
  spine.marks.forEach((m, index) => {
    if (!m.text) return;
    const el = document.createElement('span');
    el.textContent = m.text + (m.kind === 'pain' && m.strength ? ' ' + m.strength + '/10' : '');
    el.dataset.mark = index;
    $('tags').appendChild(el);
    // a label sits just above its mark, clear of the glow. One that was pulled away sits where it was put, joined by a line.
    const tag = { el, at: m.at || [0, 1, 2].map((j) => (m.from[j] + m.to[j]) / 2), to: m.label || null, clear: m.kind === 'pain' ? Math.min(m.radius || 14, 22) : 3.2, line: null };
    if (tag.to) { tag.line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); $('tagLines').appendChild(tag.line); }
    tags.push(tag);
  });
}
// Where the label of a mark is drawn, in the picture: [x, y] of the label and of the mark, or null when it is out of sight.
function tagSpots(t) {
  const p = renderer.project(t.at);
  if (!p) return null;
  if (t.to) { const q = renderer.project(t.to); return q ? { label: q, mark: p } : null; }
  return { label: [p[0], p[1] - t.clear / renderer.screenScale(t.at).perPixel - 13], mark: p };
}

// Keep the level names and the mark labels on their spots as the view turns.
function placeLabels() {
  const put = (el, p) => {
    el.style.display = p ? '' : 'none';
    if (p) el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) translate(-50%,-50%)';
  };
  if (!$('labels').hidden) for (const l of labels) put(l.el, renderer.project(l.at));
  if (!$('tags').hidden) for (const t of tags) {
    const spots = tagSpots(t);
    put(t.el, spots && spots.label);
    if (t.line) { t.line.style.display = spots ? '' : 'none'; if (spots) { t.line.setAttribute('x1', spots.label[0]); t.line.setAttribute('y1', spots.label[1]); t.line.setAttribute('x2', spots.mark[0]); t.line.setAttribute('y2', spots.mark[1]); } }
  }
  for (const fn of app.frames) fn();
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
// A small flat drawing of a spine for the gallery: seen from the back, or from the side
// (the back of the person to the right) for the shapes that only show from there.
function sketch(s, side = false) {
  const across = (p) => (side ? p[1] : -p[0]), j = side ? 1 : 0;
  const xs = s.levels.map((l) => across(l.centre)), zs = s.levels.map((l) => l.centre[2]), lowX = Math.min(...xs) - 30, highX = Math.max(...xs) + 30, lowZ = Math.min(...zs) - 25, highZ = Math.max(...zs) + 15;
  let body = '';
  for (const l of s.levels) body += '<rect x="' + (across(l.centre) - l.size[j] / 2).toFixed(1) + '" y="' + (-l.centre[2] - l.size[2] / 2).toFixed(1) + '" width="' + l.size[j] + '" height="' + l.size[2] + '" rx="3" transform="rotate(' + ((side ? 1 : -1) * l.tilt[j]).toFixed(1) + ' ' + across(l.centre).toFixed(1) + ' ' + (-l.centre[2]).toFixed(1) + ')" fill="#c7ad85"/>';
  for (const r of (s.hardware || {}).rods || []) body += '<polyline points="' + r.points.map((p) => across(p).toFixed(1) + ',' + (-p[2]).toFixed(1)).join(' ') + '" fill="none" stroke="#6f8fe0" stroke-width="5" stroke-linecap="round"/>';
  return '<svg viewBox="' + [lowX, -highZ, highX - lowX, highZ - lowZ].map((v) => v.toFixed(0)).join(' ') + '" aria-hidden="true">' + body + '</svg>';
}

function openGallery() {
  const box = $('galleryList');
  box.textContent = '';
  $('gallery').showModal();
  listExamples().then((list) => Promise.all(list.map((e) => loadExample(e.file).then((s) => ({ ...e, spine: s }))))).then((list) => {
    let group = '';
    for (const e of list) {
      // the presets come in groups, each under its own heading
      if (e.group && e.group !== group) { group = e.group; const h = document.createElement('h3'); h.textContent = group; box.appendChild(h); }
      const b = document.createElement('button');
      b.dataset.file = e.file;
      b.innerHTML = sketch(e.spine, e.group === 'Round and flat backs') + '<div><strong></strong><span></span></div>';
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

// (say: where to report it, when not in the Share menu. The box with the link is in that menu.)
function copyLink(say) {
  if (!spine) return;
  const told = say && say.nodeType ? say : $('linkSay'), inMenu = told === $('linkSay');
  packSpine(spine).then((packed) => {
    const link = linkFor(location.href, packed), box = $('linkText'), local = location.protocol === 'file:';
    box.value = link;
    if (inMenu) { box.hidden = false; box.focus(); box.select(); }
    const tail = (local ? ' This copy of the app was opened from a folder, so the link only works where the app sits in the same place. Put the app on the web to get links anyone can open.' : '') + (link.length > 6000 ? ' It is ' + link.length + ' characters long, which some sites cut short. A saved file is safer for this one.' : '');
    const done = (ok) => { told.textContent = (ok ? 'Copied. Paste it into a message.' : inMenu ? 'Copy it from the box above.' : 'This browser did not let the app copy. Press Share in the top bar and copy the link from the box there.') + tail; };
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
  const pillAt = (text, p, size, bold) => {
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = (bold ? '650 ' : '') + size * k + 'px system-ui, sans-serif';
    const w = g.measureText(text).width + 12 * k, h = (size + 6) * k, x = p[0] * k - w / 2, y = p[1] * k - h / 2;
    g.fillStyle = 'rgba(19, 20, 24, 0.8)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
    g.fillStyle = '#eceae5'; g.fillText(text, p[0] * k, p[1] * k + k * 0.5);
  };
  const pill = (text, at, lift, size, bold) => { const p = renderer.project(at); if (p) pillAt(text, [p[0], p[1] - lift], size, bold); };
  if (!$('labels').hidden) for (const l of labels) pill(l.el.textContent, l.at, 0, 11, true);
  if (!$('tags').hidden) for (const t of tags) {
    const spots = tagSpots(t);
    if (!spots) continue;
    if (t.to) { g.strokeStyle = pale ? 'rgba(30, 31, 36, 0.75)' : 'rgba(236, 234, 229, 0.8)'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(spots.label[0] * k, spots.label[1] * k); g.lineTo(spots.mark[0] * k, spots.mark[1] * k); g.stroke(); }
    pillAt(t.el.textContent, spots.label, 12, false);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = 11 * k + 'px system-ui, sans-serif'; g.fillStyle = pale ? 'rgba(30, 31, 36, 0.75)' : 'rgba(236, 234, 229, 0.7)';
  const lines = ['A sketch made with Spine Builder. Not a medical image.'].concat(look.simple ? [] : ['Bone shapes: ' + SHAPE_CREDIT]);
  lines.forEach((text, i) => g.fillText(text, 10 * k, out.height - (10 + (lines.length - 1 - i) * 15) * k));
  return out;
}

const PRINTED = ['vertebrae', 'discs', 'rods', 'screws', 'hooks', 'crosslinks'], STAND_COLOR = [0.56, 0.58, 0.63];
const CREDIT = 'Bones: BodyParts3D (c) DBCLS, CC BY 4.0';
const printScale = () => parseFloat($('stlScale').value) || 1;
// The stand for the spine as it is now, at the print size chosen, or null. Worked out again only when the spine has changed shape.
let standKept = { key: '', stand: null };
function standNow() {
  const kind = $('standKind').value;
  if (!kind || !spine) return null;
  const key = kind + printScale() + look.simple + JSON.stringify(spine.levels.map((l) => [l.id, l.centre, l.tilt, l.turn, l.size]));
  if (standKept.key !== key) standKept = { key, stand: standFor(kind, spine, printScale(), DETAIL) };
  return standKept.stand;
}
// Bring the whole model into view, with its stand if one is shown.
function fitView() {
  if (!spine) return;
  const b = boundsOf(spine), stand = standNow();
  if (stand) for (const mesh of stand.stand) for (let i = 0; i < mesh.positions.length; i += 3) for (let j = 0; j < 3; j++) { b.low[j] = Math.min(b.low[j], mesh.positions[i + j]); b.high[j] = Math.max(b.high[j], mesh.positions[i + j]); }
  renderer.frame(b.low, b.high);
}
function showStand() {
  const stand = standNow();
  let wide = 0;
  if (stand) { const p = stand.stand[0].positions; let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } wide = Math.round((hi - lo) * printScale()); }
  $('standSay').textContent = stand ? stand.says + ' The stand is a part of its own, with a base about ' + wide + ' mm across at this size. It is shown with the spine now.' : '';
  app.redraw();
  if (stand) fitView();
}
const READ_ME = (lines) => ['Made with Spine Builder. A sketch of a spine, not a medical image and not a measurement.', ''].concat(lines, look.simple ? [] : ['', 'The bone shapes are from BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International.', 'Pass this credit on with the files.']).join('\r\n') + '\r\n';
const shownParts = () => renderer.items().filter((it) => PRINTED.includes(it.group) && it.visible !== false);

// The bones and discs made smoother for a print: each round cuts every triangle into four. Kept, so a second save is quick.
const smoothed = new WeakMap();
function finer(mesh, rounds) {
  let out = mesh;
  for (let r = 1; r <= rounds; r++) {
    const known = smoothed.get(out);
    if (known) { out = known; continue; }
    const next = smoother(out);
    smoothed.set(out, next); out = next;
  }
  return out;
}
async function saveStl() {
  if (!spine) return;
  const scale = printScale(), rounds = parseInt($('stlFinish').value, 10) || 0, stand = standNow();
  const items = shownParts().map((it) => (rounds && (it.group === 'vertebrae' || it.group === 'discs') ? { ...it, mesh: finer(it.mesh, rounds) } : it));
  if (!items.length) { $('stlSay').textContent = 'Nothing is shown, so there is nothing to print. Tick some parts under Show.'; return; }
  const bytes = stlOf(items.concat(stand ? stand.onSpine.map((mesh) => ({ mesh })) : []), scale, 'Spine Builder sketch. ' + (look.simple ? '' : CREDIT)), view = new DataView(bytes.buffer);
  // how tall the print will be: the highest and the lowest corner in the file
  let low = Infinity, high = -Infinity;
  for (let at = 84; at < bytes.length; at += 50) for (const k of [20, 32, 44]) { const z = view.getFloat32(at + k, true); if (z < low) low = z; if (z > high) high = z; }
  const tall = Math.round(high - low), name = fileNameFor(spine) + (scale === 1 ? '' : '-' + Math.round(scale * 100) + 'pct');
  const told = 'about ' + tall + ' mm tall. Its parts are separate shapes that overlap, and slicers join them on their own.' + (look.simple ? '' : ' If you pass the file on, name BodyParts3D as the source of the bone shapes.');
  if (!stand) { download(new Blob([bytes], { type: 'model/stl' }), name + '.stl'); $('stlSay').textContent = 'Saved: ' + (bytes.length / 1e6).toFixed(1) + ' MB, ' + told; return; }
  const zip = await zipOf([
    { name: name + '.stl', bytes },
    { name: name + '-stand.stl', bytes: stlOf(stand.stand.map((mesh) => ({ mesh })), scale, 'Stand for a Spine Builder sketch') },
    { name: 'READ ME.txt', bytes: READ_ME([name + '.stl: the spine, about ' + tall + ' mm tall, in millimetres.', name + '-stand.stl: its stand. Print it as it is, with the round base on the bed.', stand.says, 'Each file holds separate shapes that overlap. Slicers join them on their own.', 'The fit between the two was worked out, not tried on a printer. If it is tight, sand the peg or the arm a little.']) },
  ]);
  download(new Blob([zip], { type: 'application/zip' }), name + '-print.zip');
  $('stlSay').textContent = 'Saved a zip with the spine and its stand as two STL files: ' + (zip.length / 1e6).toFixed(1) + ' MB, the spine ' + told;
}
async function saveObj() {
  if (!spine) return;
  const items = shownParts().concat(renderer.items().filter((it) => it.group === 'stand'));
  if (!items.length) { $('objSay').textContent = 'Nothing is shown, so there is nothing to save. Tick some parts under Show.'; return; }
  const name = fileNameFor(spine), files = objOf(items, 1, 'Spine Builder sketch. ' + (look.simple ? '' : CREDIT), name + '.mtl');
  const zip = await zipOf([{ name: name + '.obj', bytes: files.obj }, { name: name + '.mtl', bytes: files.mtl }, { name: 'READ ME.txt', bytes: READ_ME([name + '.obj: the model at full size, in millimetres, standing upright (y is up).', name + '.mtl: its colours. Keep the two files together.', 'Every vertebra, disc and part is an object of its own, named after what it is.']) }]);
  download(new Blob([zip], { type: 'application/zip' }), name + '-3d.zip');
  $('objSay').textContent = 'Saved a zip with the OBJ file and its colours: ' + items.length + ' objects, ' + (zip.length / 1e6).toFixed(1) + ' MB.';
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
  if (save) keepLook();
  app.redraw();
}

// An element that sits somewhere else in the phone and tablet layout. A marker stays where it came from, so it can go back.
function rehome(el, to) {
  if (!el.home) { el.home = document.createComment('home'); el.before(el.home); }
  if (to) to.appendChild(el); else el.home.after(el);
}
function applyLayout() {
  const guided = guidedNow();
  app.guided = guided;
  document.body.classList.toggle('guided', guided);
  // the less used buttons of the ribbon go into the More menu, and come back out of it
  for (const id of ['newBtn', 'openBtn', 'saveBtn', 'exportBtn']) rehome($(id), guided ? $('moreFile') : null);
  rehome(document.querySelector('#ribbon .group[aria-label="Look from"], #moreLook .group'), guided ? $('moreLook') : null);
  rehome(document.querySelector('#ribbon .group[aria-label="What is shown"], #moreShown .group'), guided ? $('moreShown') : null);
  rehome($('layoutBox'), guided ? $('moreLayout') : null);
  document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.layout === (look.layout || 'auto') ? 'true' : 'false'));
  $('layoutSay').textContent = (guided ? 'Phone and tablet: one step at a time, with the simple tools.' : 'Desktop: every tool at once, in a panel beside the model.') + (look.layout === 'guided' || look.layout === 'full' ? '' : ' Auto picked this for your screen.');
  if (builder) builder.layout();
  renderer.requestDraw();
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
  $('objBtn').addEventListener('click', saveObj);
  $('standKind').addEventListener('change', showStand); $('stlScale').addEventListener('change', showStand);
  window.addEventListener('hashchange', openLink);
  // New is a full reset: the average spine, and the look, what is shown and the print choices back to how they start.
  // (The level of control stays: it is how a person works, not how the model looks.)
  $('newBtn').addEventListener('click', () => {
    look = { ...USUAL, level: look.level, layout: look.layout };
    $('boneOpacity').value = 100; $('labelsOn').checked = false; $('standKind').value = ''; $('stlScale').value = '0.5'; $('stlFinish').value = '1'; $('standSay').textContent = '';
    document.querySelectorAll('#showMenu [data-group]').forEach((c) => { c.checked = true; });
    app.held.clear();
    applyLook();
    openExample(START);
  });
  $('galleryBtn').addEventListener('click', openGallery);
  $('galleryClose').addEventListener('click', () => $('gallery').close());
  $('fitBtn').addEventListener('click', fitView);
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
  $('lookReset').addEventListener('click', () => { look = { ...USUAL, level: look.level, layout: look.layout }; $('boneOpacity').value = 100; applyLook(); });
  // the menus of the ribbon: a button opens its menu, a click elsewhere or Esc closes it
  const closeMenus = (but) => document.querySelectorAll('[data-menu]').forEach((b) => { if (b !== but) { b.setAttribute('aria-expanded', 'false'); $(b.dataset.menu).hidden = true; } });
  document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
    // (a button that sits inside the More menu opens its own menu where More was: measured before More closes)
    const at = (b.closest('.menu') ? $('moreBtn') : b).getBoundingClientRect();
    e.stopPropagation(); closeMenus(b);
    const menu = $(b.dataset.menu), open = menu.hidden;
    menu.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      // the menu drops down under its button, kept inside the window
      const wide = menu.offsetWidth;
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
  // the layout: the buttons that choose it, and a screen that is turned or resized
  document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => { look.layout = b.dataset.layout; keepLook(); applyLayout(); closeMenus(null); }));
  NARROW.addEventListener('change', applyLayout); TOUCH.addEventListener('change', applyLayout);
  // a button of the More menu that does its work at once closes the menu
  for (const id of ['moreFile', 'moreLook']) $(id).addEventListener('click', (e) => { if (e.target.closest('button') && !e.target.closest('[data-menu]')) closeMenus(null); });
  // the last step of the phone and tablet layout: keep the sketch or pass it on
  const SHARE_SAYS = $('shSay').textContent;
  $('shPicture').addEventListener('click', () => { $('pictureBtn').click(); $('shSay').textContent = 'Saved a picture of the view as it is now to your downloads.'; });
  $('shLink').addEventListener('click', () => copyLink($('shSay')));
  $('shSave').addEventListener('click', () => { $('saveBtn').click(); $('shSay').textContent = 'Saved the file to your downloads. "Open" under More brings it back.'; });
  $('shAgain').addEventListener('click', () => { $('shSay').textContent = SHARE_SAYS; $('newBtn').click(); builder.go('shape'); });
  applyLayout();
  applyLook(false);
  if (!openLink()) openExample(START);
  welcome(false);
  // handy when trying things in the browser console
  window.spineBuilder = { renderer, app, builder, current: () => spine, show, openExample };
}
