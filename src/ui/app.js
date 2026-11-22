// The page: loads a spine file, draws it, keeps the history for Undo, and wires up what is
// about files, sharing, viewing and the look. The builder (shape, hardware, pain) is in
// build.js.

import { createRenderer, SHADINGS } from '../view/renderer.js';
import { buildScene, boundsOf } from '../view/scene.js';
import { gizmoItems } from '../view/gizmo.js';
import { validateSpine, sortedLevels } from '../core/spinefile.js';
import { readSpineFile, saveSpineFile, loadExample, listExamples, download, fileNameFor } from '../io/files.js';
import { packSpine, unpackSpine, linkFor, packedIn, viewOptionsIn, viewLinkFor } from '../io/share.js';
import { stlOf, objOf } from '../io/print.js';
import { zipOf } from '../io/zip.js';
import { standFor } from '../core/stand.js';
import { setupGuide } from './guide.js';
import { smoother } from '../core/smooth.js';
import { rigOf, carry, stiffen, blockOf } from '../core/shape.js';
import { fitRods } from '../core/place.js';
import { KINDS, allKinds } from '../parts/kinds.js';
import { sampleOf } from '../parts/catalogue.js';
import { setBoneStyle } from '../core/bones.js';
import { SHAPE_CREDIT } from '../shapes/bodyparts3d.js';
import { setupBuilder } from './build.js';
import { setupStory } from './story.js';

const $ = (id) => document.getElementById(id);
// phones get a slightly coarser grid for the bones so they appear sooner
const DETAIL = window.matchMedia('(max-width: 760px)').matches ? 1.8 : 1.4;
const START = 'average.spine.json';
const renderer = createRenderer($('view'));
let spine = null, labels = [], tags = [], builder = null, story = null;
let past = [], future = [];          // spine files as text, for Undo and Redo

// ---- how things look (kept on this device between visits)
const BACKS = { dark: [0.075, 0.08, 0.1], grey: [0.43, 0.44, 0.47], light: [0.93, 0.92, 0.89], white: [1, 1, 1], black: [0, 0, 0] };
const USUAL = { back: 'dark', shade: 'soft', bone: '#c7ad85', disc: '#5485bd', hardware: '', byLevel: false, simple: false };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
// The viewer is the page that only shows a sketch, made to sit inside other pages (view.html, the same app with
// one mark on it). It keeps nothing on the device and takes how things look from its own address.
const VIEWER = document.documentElement.hasAttribute('data-viewer');
let look = { ...USUAL };
if (!VIEWER) try { look = { ...USUAL, ...JSON.parse(localStorage.getItem('spineBuilderLook') || '{}') }; } catch (e) { /* no storage here: use the usual look */ }
// (earlier versions kept a level of control and a layout with the look: both are gone)
delete look.level; delete look.layout;
const keepLook = () => { if (VIEWER) return; try { localStorage.setItem('spineBuilderLook', JSON.stringify(look)); } catch (e) { /* not kept, that is all */ } };

// What the builder works with. "rig" is the spine as a chain (see core/shape.js). "picked" is
// what is selected, "spots" the dots shown while a part is being placed.
let glowTimer = null, sayTimer = null, calm = 0, calmTimer = null;
// Mark the blocks of the vertebra that glows (the map and the chart draw themselves again often, so they ask for this too).
function showGlow(scroll) {
  document.querySelectorAll('#map .glow, #blocks .glow, #map .peek, #blocks .peek').forEach((e) => { e.classList.remove('glow'); e.classList.remove('peek'); });
  // (the block of the bone the pointer is over on the model is marked more softly)
  if (app.peeked) document.querySelectorAll('#map [data-bone="' + app.peeked + '"], #blocks [data-block="' + app.peeked + '"]').forEach((e) => e.classList.add('peek'));
  if (!app.glow) return;
  document.querySelectorAll('#map [data-bone="' + app.glow + '"], #blocks [data-block="' + app.glow + '"]').forEach((e) => {
    e.classList.add('glow');
    // bring the block into view if the strip is scrolled away from it
    if (scroll && e.getBoundingClientRect().width) { const r = e.getBoundingClientRect(), box = $('strip').getBoundingClientRect(); if (r.top < box.top + 4 || r.bottom > Math.min(box.bottom, window.innerHeight) - 4) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  });
}
const app = {
  $, renderer, DETAIL, rig: null, picked: null, also: [], spots: [],
  // the look as it is now, what it is when nothing is chosen, and a way to change it ('' for a colour gives the usual one)
  look: () => look, usualLook: USUAL,
  setLook(patch) { look = { ...look, ...patch }; for (const k of ['bone', 'disc']) if (!look[k]) look[k] = USUAL[k]; applyLook(); if (builder) builder.sync(); },
  frames: [],                          // things to do after every drawn frame (lines over the picture follow the view)
  held: new Set(),                     // the vertebrae locked in place while the curve is drawn or the blocks are slid
  // Draw what is selected without its highlight for a moment, so that a new color on it can be seen.
  calm(ms = 1400) { calm = performance.now() + ms; app.redraw(); clearTimeout(calmTimer); calmTimer = setTimeout(() => { calm = 0; app.redraw(); }, ms + 30); },
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
  fit: () => fitView(),                // bring the whole spine into the picture
  picture: () => pictureOf(),          // the view as a picture, with the names and words that are showing
  setBack: (name) => renderer.setBackground(BACKS[name] || BACKS.dark),   // the background for one picture (applyLook puts the chosen one back)
  applyLook: () => applyLook(false),
  partPictures: (ids) => partPictures(ids),   // small pictures of single parts, for the catalogue
  thumbs: () => thumbsSoon(),          // draw the small pictures of the shadings again
  clean: (on) => setClean(on),         // put the tools away for a clear picture, or bring them back
  stiff: true,                         // fused stretches move as blocks
  inLine: true,                        // a part stops where its rod could not follow
  showStiff: true,                     // tint the stiff blocks (while the shape is worked on)
  // What is drawn in place of the sketch for a while, when steps are played or compared:
  //   shown: { spine, fade } one spine (a step, or a blend of two; fade is how solid its hardware is drawn)
  //   pair:  { a, b } two spines side by side
  shown: null, pair: null,
  get spine() { return spine; },
  now: () => past[past.length - 1] || '',   // the sketch as it was last remembered for Undo, as text
  // A remark over the model. It goes away by itself after a while.
  say(text) { $('status').textContent = text || ''; clearTimeout(sayTimer); if (text) sayTimer = setTimeout(() => { $('status').textContent = ''; }, 9000); },

  // Draw the spine again after something changed.
  redraw() {
    if (!spine) return;
    // the vertebrae fused to the picked one are tinted too: they move with it
    const block = app.picked && app.picked.kind === 'level' && app.rig ? blockOf(spine, app.rig, app.picked.id) : null;
    // while the spine is being shaped, the stretches that are held stiff are drawn in a cooler colour
    const order = sortedLevels(spine).map((l) => l.id), stiff = [];
    if (app.showStiff && app.stiff && app.rig) for (const b of app.rig.blocks || []) stiff.push(...order.slice(b.from, b.to + 1));
    const lookNow = { bone: rgb(look.bone), disc: rgb(look.disc), hardware: look.hardware ? rgb(look.hardware) : null, byLevel: look.byLevel };
    const seen = app.shown ? app.shown.spine : spine;
    let items;
    if (app.pair) items = pairItems(lookNow);
    else if (app.shown) {
      // (a step that is only shown: nothing on it is selected, and its hardware may be on its way in or out)
      items = buildScene(seen, DETAIL, { look: lookNow });
      const fade = app.shown.fade;
      if (fade < 1) items = items.filter((it) => !KINDS.includes(it.group) || fade > 0.02).map((it) => (KINDS.includes(it.group) ? { ...it, opacity: fade, baseOpacity: fade } : it));
    } else items = buildScene(spine, DETAIL, { picked: calm > performance.now() ? null : block ? { ...app.picked, mates: block.ids } : app.picked, also: calm > performance.now() ? [] : app.also, stiff, locked: app.showStiff ? [...app.held] : [], spots: app.spots, lit: app.lit, pointed: app.pointed, hints: builder ? builder.hints() : null, look: lookNow });
    // the stand chosen for printing is shown with the spine, so that what is saved is what is seen
    const stand = app.shown || app.pair ? null : standNow();
    if (stand) for (const [list, name] of [[stand.onSpine, 'stand_fitting_on_spine'], [stand.stand, 'stand']]) for (const mesh of list) items.push({ group: 'stand', mesh, color: STAND_COLOR, opacity: 1, baseOpacity: 1, visible: true, name });
    const handles = !app.shown && !app.pair && builder && builder.handles();
    renderer.setItems(handles ? items.concat(gizmoItems(handles.spec, handles.active)) : items);
    applyToggles();
    const centre = {};
    for (const l of seen.levels) centre[l.id] = l.centre;
    // (the names and the words of the marks go with the spine that is drawn. With two side by side there are none.)
    for (const l of labels) l.at = app.pair ? null : centre[l.id] || null;
    buildTags(app.pair ? null : seen);
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

  // Make another spine the open one in place (another step of the same sketch). The tools start over for it, and
  // the change is one step of the history, so Undo goes back to the step that was open.
  reopen(fn) {
    if (!spine) return;
    fn();
    allKinds(spine);
    spine.marks = spine.marks || []; spine.fused = spine.fused || [];
    app.rig = rigOf(spine, app.stiff); app.picked = null; app.also = []; app.spots = []; app.held.clear();
    if (builder) { builder.reset(); builder.stepped(); }
    buildLabels(); app.redraw(); app.settle();
  },
  // where the names of two spines that stand side by side go: a point over the top of each
  pairSpots() {
    const shift = pairShift();
    return [app.pair.a, app.pair.b].map((s, i) => { const b = boundsOf(s); return [(b.low[0] + b.high[0]) / 2 + shift[i][0], (b.low[1] + b.high[1]) / 2 + shift[i][1], b.high[2] + 6]; });
  },

  // Select something. "also" lists more parts selected along with it.
  pick(what, also = []) {
    app.picked = what; app.also = what ? also : [];
    app.redraw();
    if (builder) builder.sync();
  },
};

// Two spines side by side, as the eye sees them: each is moved half the gap along the line that runs across the screen.
// (The picture is put together again when the view has turned, so that they stay side by side.)
let pairAround = null;
function pairShift() {
  const a = renderer.camera.around, right = [-Math.cos(a), Math.sin(a), 0], wide = (s) => { const b = boundsOf(s); return Math.hypot(b.high[0] - b.low[0], b.high[1] - b.low[1]) / 2; };
  const half = Math.max(70, (wide(app.pair.a) + wide(app.pair.b)) / 2 * 0.62 + 20);
  return [right.map((v) => -v * half), right.map((v) => v * half)];
}
function pairItems(lookNow) {
  const shift = pairShift(), items = [];
  pairAround = renderer.camera.around;
  [app.pair.a, app.pair.b].forEach((s, i) => {
    const d = shift[i];
    for (const it of buildScene(s, DETAIL, { look: lookNow })) {
      const m = it.matrix ? new Float32Array(it.matrix) : new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      m[12] += d[0]; m[13] += d[1]; m[14] += d[2];
      items.push({ ...it, matrix: m });
    }
  });
  return items;
}
// The box that holds what is drawn: the sketch, the step that is shown, or the two side by side.
function boundsNow() {
  if (!app.pair) return boundsOf(app.shown ? app.shown.spine : spine);
  const shift = pairShift(), low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  [app.pair.a, app.pair.b].forEach((s, i) => { const b = boundsOf(s); for (let j = 0; j < 3; j++) { low[j] = Math.min(low[j], b.low[j] + shift[i][j]); high[j] = Math.max(high[j], b.high[j] + shift[i][j]); } });
  return { low, high };
}

// the name of the sketch and the line about it, on the page and on the tab of the browser
function named() {
  $('name').textContent = spine.name || 'A spine'; $('about').textContent = spine.about || '';
  document.title = (spine.name ? spine.name + ' | ' : '') + 'Spine-Design';
  if ($('shName') && document.activeElement !== $('shName')) $('shName').value = spine.name || '';
  if ($('shAbout') && document.activeElement !== $('shAbout')) $('shAbout').value = spine.about || '';
}
function restore(text) {
  spine = JSON.parse(text);
  app.shown = null; app.pair = null;
  named();
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
  app.say('');      // (a remark about the change that was just undone would be stale)
}

function redo() {
  if (!future.length) return;
  past.push(future.pop());
  restore(past[past.length - 1]);
  app.say('');
}

// Show a spine: check it, build its shapes, bring the page up to date.
//   keep: the sketch that was open stays in the history, so that Undo brings it back
function show(next, problems, keep = false) {
  $('problems').textContent = '';
  for (const p of problems || []) { const li = document.createElement('li'); li.textContent = p; $('problems').appendChild(li); }
  $('problemBox').hidden = !(problems && problems.length);
  if (!next || !Array.isArray(next.levels) || !next.levels.length) return;
  const before = keep && spine ? past.slice(-60) : [];
  spine = next; app.shown = null; app.pair = null;
  allKinds(spine);
  spine.marks = spine.marks || [];
  named();
  app.say('Drawing the bones');
  // give the notice a moment to appear before the shapes are worked out
  setTimeout(() => {
    app.rig = rigOf(spine, app.stiff); app.picked = null; app.also = []; app.spots = [];
    app.held.clear(); app.glow = app.lit = app.pointed = null;      // locks belong to the spine that was open before
    past = before.concat([JSON.stringify(spine)]); future = [];
    if (builder) { builder.reset(); builder.opened(); }
    buildLabels();
    app.redraw();
    const box = boundsOf(spine);
    renderer.frame(box.low, box.high);
    syncHistory();
    if (builder) builder.sync();
    app.say(before.length ? 'Undo brings back the sketch you had.' : '');
    if (VIEWER) viewerShown();
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
function buildTags(of = spine) {
  $('tags').textContent = ''; $('tagLines').textContent = '';
  tags = [];
  ((of && of.marks) || []).forEach((m, index) => {
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
  if (!$('labels').hidden) for (const l of labels) put(l.el, l.at && renderer.project(l.at));
  if (!$('tags').hidden) for (const t of tags) {
    const spots = tagSpots(t);
    put(t.el, spots && spots.label);
    if (t.line) { t.line.style.display = spots ? '' : 'none'; if (spots) { t.line.setAttribute('x1', spots.label[0]); t.line.setAttribute('y1', spots.label[1]); t.line.setAttribute('x2', spots.mark[0]); t.line.setAttribute('y2', spots.mark[1]); } }
  }
  for (const fn of app.frames) fn();
  if (app.pair && pairAround !== renderer.camera.around) app.redraw();
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

// The sheet a sketch starts from: the shapes to pick from, each with a small drawing.
function openStart() {
  const box = $('galleryList');
  box.textContent = '';
  if (!$('start').open) $('start').showModal();
  listExamples().then((list) => Promise.all(list.map((e) => loadExample(e.file).then((s) => ({ ...e, spine: s }))))).then((list) => {
    let group = '';
    for (const e of list) {
      // the presets come in groups, each under its own heading
      if (e.group && e.group !== group) { group = e.group; const h = document.createElement('h3'); h.textContent = group; box.appendChild(h); }
      const b = document.createElement('button');
      b.dataset.file = e.file;
      b.innerHTML = sketch(e.spine, e.group === 'Round and flat backs') + '<div><strong></strong><span></span></div>';
      b.querySelector('strong').textContent = e.name; b.querySelector('span').textContent = e.about;
      b.addEventListener('click', () => { $('start').close(); app.held.clear(); openExample(e.file); });
      box.appendChild(b);
    }
  }).catch(() => { box.textContent = 'The examples could not be loaded.'; });
}

// (a sketch that was changed stays in the history when another one is opened over it)
const changed = () => past.length > 1;
function openExample(file) {
  return loadExample(file).then((s) => show(JSON.parse(JSON.stringify(s)), validateSpine(s), changed())).catch(() => app.say('That example could not be loaded. Use Open a file.'));
}

// ---- the note shown when the app opens

// What this copy of the app is: filled in by the build (tools/build.mjs) from package.json
// and site.json. When the app runs straight from the source files there is nothing to fill in.
const BUILD = window.SPINE_BUILD || { version: '', source: '', address: '' };

// The links to the pages of the site (privacy, terms, accessibility). They sit next to the app
// on a hosted copy and in the repository. A copy of the app that was saved as one file has
// no pages beside it: it links to the hosted ones, or shows no links if no site is set.
function siteLinks() {
  const hosted = /^https?:$/.test(location.protocol), from = location.pathname.includes('/src/') ? '../' : '';
  document.querySelectorAll('.sitelinks').forEach((box) => {
    box.hidden = !hosted && !BUILD.address;
    box.querySelectorAll('a[data-page]').forEach((a) => { a.href = hosted ? from + a.dataset.page : BUILD.address + '/' + a.dataset.page; if (!hosted) { a.target = '_blank'; a.rel = 'noopener'; } });
  });
}

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
let startNext = false;                 // the sheet with the shapes to start from opens once the note is closed
function welcomeDone() {
  try { if ($('welcomeSkip').checked) localStorage.setItem('spineBuilderWelcome', 'seen'); else localStorage.removeItem('spineBuilderWelcome'); } catch (e) { /* not kept, that is all */ }
  const box = $('welcome');
  if (box.close) box.close(); else box.removeAttribute('open');
  if (startNext) { startNext = false; openStart(); }
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

// ---- the viewer (view.html): a sketch to look at, inside another page or on its own
let viewerHow = {}, turning = 0;
const stopTurning = () => { if (turning) cancelAnimationFrame(turning); turning = 0; };
function startViewer() {
  document.body.classList.add('viewer', 'clean');
  $('viewer').hidden = false;
  const packed = packedIn(location.hash), nothing = (text) => { $('viewerNone').textContent = text; $('viewerNone').hidden = false; openExample(START); };
  viewerHow = viewOptionsIn(location.hash);
  if (SHADINGS[viewerHow.shade]) look.shade = viewerHow.shade;
  if (BACKS[viewerHow.back]) look.back = viewerHow.back;
  $('labelsOn').checked = $('viewerNames').checked = !!viewerHow.names;
  applyLook(false);
  // the way to the whole app, with this sketch in it
  $('viewerOpen').href = (location.protocol === 'file:' ? './index.html' : './') + (packed ? '#spine=' + packed : '');
  if (!packed) { nothing('This viewer shows a sketch made with Spine-Design. Its address holds no sketch.'); return; }
  unpackSpine(packed)
    .then((s) => { const problems = validateSpine(s); if (problems.length) throw new Error(problems[0]); show(s, []); })
    .catch(() => nothing('The sketch in this address could not be read. It may have been cut short on the way.'));
}
// the sketch is drawn: its name, where it is seen from, and the slow turn if that was asked for
function viewerShown() {
  const c = renderer.camera;
  if (builder) builder.go('story');
  $('viewerName').textContent = spine.name || 'A spine';
  document.title = (spine.name || 'A spine') + ' | Spine-Design';
  $('labels').hidden = !$('labelsOn').checked;
  if (viewerHow.around !== undefined) { c.around = viewerHow.around; c.tilt = viewerHow.tilt; }
  fitView();
  stopTurning();
  if (viewerHow.turn && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const step = () => { c.around += 0.0035; renderer.requestDraw(); turning = requestAnimationFrame(step); };
    turning = requestAnimationFrame(step);
  }
}
function viewerControls() {
  const c = renderer.camera, view = $('view');
  // (inside another page the wheel scrolls that page, until the model has been pressed. A press elsewhere gives it back.)
  let mine = window.top === window;
  renderer.wheelIf(() => mine);
  $('stage').addEventListener('pointerdown', () => { mine = true; stopTurning(); }, true);
  window.addEventListener('blur', () => { mine = window.top === window; });
  window.addEventListener('wheel', stopTurning, { passive: true });
  $('viewerNames').addEventListener('change', () => { $('labelsOn').checked = $('viewerNames').checked; $('labels').hidden = !$('labelsOn').checked; app.redraw(); });
  $('viewerFit').addEventListener('click', () => fitView());
  const full = $('viewerFull'), can = document.fullscreenEnabled && document.documentElement.requestFullscreen;
  full.hidden = !can;
  full.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); });
  // the keys turn the model: there is nothing here to pick or to change
  view.setAttribute('aria-label', '3D view of the spine. Arrow keys turn it, plus and minus zoom.');
  view.addEventListener('keydown', (e) => {
    const turn = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key], zoom = { '+': 0.85, '=': 0.85, '-': 1.18 }[e.key];
    if (!turn && !zoom) return;
    e.preventDefault(); e.stopImmediatePropagation(); stopTurning();
    if (turn) { c.around += turn[0]; c.tilt = Math.max(-1.4, Math.min(1.4, c.tilt + turn[1])); } else c.distance = Math.max(80, Math.min(4000, c.distance * zoom));
    renderer.requestDraw();
  }, true);
  window.addEventListener('hashchange', () => location.reload());
}

// The lines to paste into a web page to show this sketch there, in the viewer.
function embedCode() {
  if (!spine) return;
  packSpine(spine).then((packed) => {
    const c = renderer.camera, hosted = /^https?:$/.test(location.protocol);
    const base = hosted ? new URL('view.html', location.href).href.split(/[?#]/)[0] : BUILD.address ? BUILD.address + '/view.html' : 'view.html';
    const link = viewLinkFor(base, packed, { shade: look.shade, back: look.back, names: $('embedNames').checked, turn: $('embedTurn').checked, around: c.around, tilt: c.tilt });
    const title = (spine.name || 'A spine').replace(/["<>&]/g, '');
    $('embedText').value = '<iframe src="' + link + '" title="' + title + ', a 3D sketch of a spine" width="100%" height="' + $('embedTall').value + '" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allowfullscreen></iframe>';
    $('embedSee').href = link;
    $('embedSay').textContent = (hosted || BUILD.address ? '' : 'This copy of the app has no address on the web, so the code only works where the app sits beside the page. ') + 'The sketch is inside the code, so anyone who can see the page can see the sketch.' + (link.length > 8000 ? ' The code is long (' + link.length + ' characters). Some site builders cut long code short.' : '');
  });
}

// A link that holds the whole sketch: copied, and shown in a box to copy from where the browser does not allow that.
function copyLink() {
  if (!spine) return;
  const told = $('shSay');
  packSpine(spine).then((packed) => {
    const link = linkFor(location.href, packed), box = $('linkText'), local = location.protocol === 'file:';
    box.value = link; box.hidden = false;
    const tail = (local ? ' This copy of the app was opened from a folder, so the link only works where the app sits in the same place. Put the app on the web to get links anyone can open.' : '') + (link.length > 6000 ? ' It is ' + link.length + ' characters long, which some sites cut short. A saved file is safer for this one.' : '');
    const done = (ok) => { told.textContent = (ok ? 'Copied. Paste it into a message.' : 'Copy it from the box above.') + tail; if (!ok) { box.focus(); box.select(); } };
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
  if (!$('labels').hidden) for (const l of labels) if (l.at) pill(l.el.textContent, l.at, 0, 11, true);
  if (!$('tags').hidden) for (const t of tags) {
    const spots = tagSpots(t);
    if (!spots) continue;
    if (t.to) { g.strokeStyle = pale ? 'rgba(30, 31, 36, 0.75)' : 'rgba(236, 234, 229, 0.8)'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(spots.label[0] * k, spots.label[1] * k); g.lineTo(spots.mark[0] * k, spots.mark[1] * k); g.stroke(); }
    pillAt(t.el.textContent, spots.label, 12, false);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = 11 * k + 'px system-ui, sans-serif'; g.fillStyle = pale ? 'rgba(30, 31, 36, 0.75)' : 'rgba(236, 234, 229, 0.7)';
  const lines = ['A sketch made with Spine-Design. Not a medical image.'].concat(look.simple ? [] : ['Bone shapes: ' + SHAPE_CREDIT]);
  // (a narrow picture, as from a phone held upright: the words go on as many lines as they need)
  const room = out.width - 20 * k, rows = [];
  for (const text of lines) { let row = ''; for (const word of text.split(' ')) { const more = row ? row + ' ' + word : word; if (row && g.measureText(more).width > room) { rows.push(row); row = word; } else row = more; } rows.push(row); }
  rows.forEach((text, i) => g.fillText(text, 10 * k, out.height - (10 + (rows.length - 1 - i) * 15) * k));
  return out;
}

const PRINTED = ['vertebrae', 'discs', ...KINDS], STAND_COLOR = [0.56, 0.58, 0.63];
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
  const b = boundsNow(), stand = app.shown || app.pair ? null : standNow();
  if (stand) for (const mesh of stand.stand) for (let i = 0; i < mesh.positions.length; i += 3) for (let j = 0; j < 3; j++) { b.low[j] = Math.min(b.low[j], mesh.positions[i + j]); b.high[j] = Math.max(b.high[j], mesh.positions[i + j]); }
  renderer.frame(b.low, b.high);
}
function showStand() {
  const stand = standNow();
  let wide = 0;
  if (stand) { const p = stand.stand[0].positions; let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } wide = Math.round((hi - lo) * printScale()); }
  $('standSay').textContent = stand ? stand.says + ' The stand is a part of its own, with a base about ' + wide + ' mm across at this size. It is shown with the spine now.' : '';
  document.querySelectorAll('[data-stand]').forEach((b) => b.setAttribute('aria-pressed', stand ? 'true' : 'false'));
  app.redraw();
  if (stand) fitView();
}
const READ_ME = (lines) => ['Made with Spine-Design. A sketch of a spine, not a medical image and not a measurement.', ''].concat(lines, look.simple ? [] : ['', 'The bone shapes are from BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International.', 'Pass this credit on with the files.']).join('\r\n') + '\r\n';
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
  if (!items.length) { $('stlSay').textContent = 'Nothing is shown, so there is nothing to print. Tick some parts under Look, More.'; return; }
  const bytes = stlOf(items.concat(stand ? stand.onSpine.map((mesh) => ({ mesh })) : []), scale, 'Spine-Design sketch. ' + (look.simple ? '' : CREDIT)), view = new DataView(bytes.buffer);
  // how tall the print will be: the highest and the lowest corner in the file
  let low = Infinity, high = -Infinity;
  for (let at = 84; at < bytes.length; at += 50) for (const k of [20, 32, 44]) { const z = view.getFloat32(at + k, true); if (z < low) low = z; if (z > high) high = z; }
  const tall = Math.round(high - low), name = fileNameFor(spine) + (scale === 1 ? '' : '-' + Math.round(scale * 100) + 'pct');
  const told = 'about ' + tall + ' mm tall. Its parts are separate shapes that overlap, and slicers join them on their own.' + (look.simple ? '' : ' If you pass the file on, name BodyParts3D as the source of the bone shapes.');
  if (!stand) { download(new Blob([bytes], { type: 'model/stl' }), name + '.stl'); $('stlSay').textContent = 'Saved: ' + (bytes.length / 1e6).toFixed(1) + ' MB, ' + told; return; }
  const zip = await zipOf([
    { name: name + '.stl', bytes },
    { name: name + '-stand.stl', bytes: stlOf(stand.stand.map((mesh) => ({ mesh })), scale, 'Stand for a Spine-Design sketch') },
    { name: 'READ ME.txt', bytes: READ_ME([name + '.stl: the spine, about ' + tall + ' mm tall, in millimetres.', name + '-stand.stl: its stand. Print it as it is, with the round base on the bed.', stand.says, 'Each file holds separate shapes that overlap. Slicers join them on their own.', 'The fit between the two was worked out, not tried on a printer. If it is tight, sand the peg or the arm a little.']) },
  ]);
  download(new Blob([zip], { type: 'application/zip' }), name + '-print.zip');
  $('stlSay').textContent = 'Saved a zip with the spine and its stand as two STL files: ' + (zip.length / 1e6).toFixed(1) + ' MB, the spine ' + told;
}
async function saveObj() {
  if (!spine) return;
  const items = shownParts().concat(renderer.items().filter((it) => it.group === 'stand'));
  if (!items.length) { $('objSay').textContent = 'Nothing is shown, so there is nothing to save. Tick some parts under Look, More.'; return; }
  const name = fileNameFor(spine), files = objOf(items, 1, 'Spine-Design sketch. ' + (look.simple ? '' : CREDIT), name + '.mtl');
  const zip = await zipOf([{ name: name + '.obj', bytes: files.obj }, { name: name + '.mtl', bytes: files.mtl }, { name: 'READ ME.txt', bytes: READ_ME([name + '.obj: the model at full size, in millimetres, standing upright (y is up).', name + '.mtl: its colours. Keep the two files together.', 'Every vertebra, disc and part is an object of its own, named after what it is.']) }]);
  download(new Blob([zip], { type: 'application/zip' }), name + '-3d.zip');
  $('objSay').textContent = 'Saved a zip with the OBJ file and its colours: ' + items.length + ' objects, ' + (zip.length / 1e6).toFixed(1) + ' MB.';
}

// ---- the look

function applyLook(save = true) {
  renderer.setBackground(BACKS[look.back] || BACKS.dark);
  $('stage').classList.toggle('pale', !(SHADINGS[look.shade] || {}).night && (look.back === 'light' || look.back === 'white' || look.back === 'grey'));
  document.querySelectorAll('[data-back]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.back === look.back ? 'true' : 'false'));
  renderer.setShading(look.shade);
  document.querySelectorAll('[data-shade]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.shade === look.shade ? 'true' : 'false'));
  $('simpleBones').checked = !!look.simple; setBoneStyle(look.simple ? 'drawn' : 'real');
  if (save) keepLook();
  app.redraw();
  if (document.body.dataset.at === 'look') thumbsSoon();
}

// The small pictures on the shading buttons: the middle of the model as it is now, drawn
// once in each shading. They are made again only when something they show has changed.
let thumbsFor = '', thumbsTimer = null;
function thumbsSoon() { clearTimeout(thumbsTimer); thumbsTimer = setTimeout(makeThumbs, 80); }
function makeThumbs() {
  if (!spine || !renderer) return;
  // (the piece that is shown lies round the vertebra in the middle of the spine, wherever a curve has carried it)
  const levels = sortedLevels(spine), mid = levels[Math.floor(levels.length / 2)].centre, at = renderer.project(mid) || [renderer.canvas.clientWidth / 2, renderer.canvas.clientHeight / 2];
  const c = renderer.camera, key = [look.bone, look.disc, look.back, look.simple, look.byLevel, $('boneOpacity').value, c.around.toFixed(2), c.tilt.toFixed(2), Math.round(c.distance), Math.round(at[0]), Math.round(at[1]), past.length, (past[past.length - 1] || '').length].join();
  if (key === thumbsFor) return;
  thumbsFor = key;
  const small = document.createElement('canvas'), g = small.getContext('2d');
  small.width = 132; small.height = 156;
  // (Only the piece that goes on the button is drawn, with a little round it for the soft shadow to reach into. That is
  // a small part of the canvas, so all eleven together cost less than one whole frame. The view is drawn again after.)
  const full = renderer.canvas, k = full.width / full.clientWidth, tall = Math.min(full.height, (120 / renderer.screenScale(mid).perPixel) * k), across = tall * small.width / small.height;
  const x = Math.max(0, Math.min(full.width - across, at[0] * k - across / 2)), y = Math.max(0, Math.min(full.height - tall, at[1] * k - tall / 2));
  document.querySelectorAll('#shades [data-shade]').forEach((b) => {
    renderer.setShading(b.dataset.shade);
    renderer.picture([x - 24, y - 24, across + 48, tall + 48]);
    g.fillStyle = '#131419'; g.fillRect(0, 0, small.width, small.height);
    g.drawImage(full, x, y, across, tall, 0, 0, small.width, small.height);
    b.querySelector('img').src = small.toDataURL('image/jpeg', 0.82);
  });
  renderer.setShading(look.shade);
}

// Small pictures of single parts for the tiles of the catalogue: { id: an address an <img> can show }.
// Each part is drawn on its own with the renderer of the model, small and in the middle of the
// canvas, so only that corner of the picture has to be worked out. The view of the spine is put
// back after. Nothing comes back while the model cannot be drawn or is showing something else.
function partPictures(ids) {
  const out = {}, full = renderer && renderer.canvas;
  if (!spine || !full || full.width < 120 || full.height < 120 || app.shown || app.pair) return out;
  const c = renderer.camera, was = { around: c.around, tilt: c.tilt, distance: c.distance, target: c.target };
  const small = document.createElement('canvas'), g = small.getContext('2d'), side = Math.min(full.width, full.height, 200);
  small.width = small.height = 128;
  try {
    renderer.setShading('soft');
    for (const id of ids) {
      const items = sampleOf(id);
      if (!items) continue;
      // (a sample can say what box to fit in the picture, so that samples of one kind are drawn at one scale)
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity], box = items[0].box;
      if (box) { low.splice(0, 3, ...box[0]); high.splice(0, 3, ...box[1]); }
      else for (const it of items) for (let i = 0; i < it.mesh.positions.length; i += 3) for (let j = 0; j < 3; j++) { low[j] = Math.min(low[j], it.mesh.positions[i + j]); high[j] = Math.max(high[j], it.mesh.positions[i + j]); }
      renderer.setItems(items.map((it) => ({ ...it, opacity: 1, baseOpacity: 1, visible: true })));
      // seen from behind and a little from the side and from above, far enough away to fit the square
      // (a sample can ask for a view of its own)
      const view = items[0].view || [0.95, 0.4];
      c.target = low.map((v, j) => (v + high[j]) / 2); c.around = view[0]; c.tilt = view[1];
      c.distance = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) * full.height / (0.86 * side * 2 * Math.tan(0.25));
      const x = (full.width - side) / 2, y = (full.height - side) / 2;
      renderer.picture([x - 20, y - 20, side + 40, side + 40]);
      g.drawImage(full, x, y, side, side, 0, 0, small.width, small.height);
      out[id] = small.toDataURL('image/jpeg', 0.86);
    }
  } catch (e) { for (const k of Object.keys(out)) delete out[k]; }
  Object.assign(c, was);
  renderer.setShading(look.shade);
  app.redraw();
  return out;
}

// Reset the view: everything about how the sketch is drawn goes back to how it starts. The shading, the background,
// what is shown, every colour (the ones kept in the sketch too, so Undo brings those back) and the whole spine in view.
function resetView() {
  if (!spine) return;
  const hw = spine.hardware, colored = !!hw.colors || KINDS.some((k) => hw[k].some((p) => p.color)) || spine.levels.some((l) => l.color);
  look = { ...USUAL }; $('boneOpacity').value = 100; $('labelsOn').checked = false;
  document.querySelectorAll('#showChecks [data-group]').forEach((c) => { c.checked = true; });
  setClean(false);
  if (colored) app.change(() => { delete hw.colors; for (const k of KINDS) for (const p of hw[k]) delete p.color; for (const l of spine.levels) delete l.color; }, { ride: false });
  applyLook(); if (builder) builder.sync();
  renderer.look(0); fitView();
  app.say('The view is back to how it starts.' + (colored ? ' Undo brings the colors back.' : ''));
}
// Reset the model: a straight normal spine with nothing on it. The sketch that was open stays in the history.
function resetModel() {
  if (!spine) return;
  const had = changed();
  openExample(START).then(() => setTimeout(() => app.say(had ? 'A straight normal spine. Undo brings back the sketch you had.' : 'A straight normal spine.'), 60));
}
// The stand under the model, on or off. Which stand it is, and its size, are set with the print in the Share sheet.
let standWas = 'post';
function setStand(on) {
  if ($('standKind').value) standWas = $('standKind').value;
  $('standKind').value = on ? standWas : '';
  showStand(); if (!on) fitView();
  app.say(on ? 'The model stands on its stand. Share has the settings for printing it.' : 'The stand is off.');
}

// The clean view: the tools are put away so that the model stands alone, for a picture of the screen.
function setClean(on) {
  if (VIEWER) on = true;                // (the viewer has no tools to bring back)
  document.body.classList.toggle('clean', on);
  $('cleanOff').hidden = !on;
  renderer.requestDraw();
}

// A sheet (a dialog) closes with its own button, with Esc, and with a press beside it.
function sheet(id, closeId) {
  const box = $(id);
  $(closeId).addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
}

if (!renderer) {
  app.say('This browser cannot show 3D here. Try a current version of Chrome, Edge, Firefox or Safari.');
} else {
  renderer.afterDraw(placeLabels);
  builder = setupBuilder(app);
  story = setupStory(app, { $, builder, download, fileNameFor, credit: () => (look.simple ? '' : 'Bone shapes: ' + SHAPE_CREDIT) });
  builder.setStory(story);
  document.querySelectorAll('[data-group]').forEach((c) => c.addEventListener('change', applyToggles));
  $('labelsOn').addEventListener('change', applyToggles);
  $('boneOpacity').addEventListener('input', applyToggles);
  $('boneOpacity').addEventListener('change', () => { if (document.body.dataset.at === 'look') thumbsSoon(); });
  $('openBtn').addEventListener('click', () => $('openFile').click());
  $('startOpen').addEventListener('click', () => { $('start').close(); $('openFile').click(); });
  $('openFile').addEventListener('change', () => {
    const file = $('openFile').files[0];
    if (file) readSpineFile(file).then((r) => show(r.spine, r.problems, changed()));
    $('openFile').value = '';
  });
  $('saveBtn').addEventListener('click', () => { if (spine) saveSpineFile(spine); });
  $('shSave').addEventListener('click', () => { if (spine) { saveSpineFile(spine); $('shSay').textContent = 'Saved the file to your downloads. Open brings it back, on this device or another.'; } });
  $('welcomeGo').addEventListener('click', welcomeDone);
  $('welcome').addEventListener('cancel', (e) => { e.preventDefault(); welcomeDone(); });      // Esc
  $('aboutBtn').addEventListener('click', () => { $('start').close(); welcome(true); });
  $('linkBtn').addEventListener('click', copyLink);
  $('embedBtn').addEventListener('click', () => { const open = $('embedBox').hidden; $('embedBox').hidden = !open; $('embedBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { embedCode(); $('embedBox').scrollIntoView({ block: 'nearest' }); } });
  for (const id of ['embedNames', 'embedTurn', 'embedTall']) $(id).addEventListener('change', embedCode);
  $('embedCopy').addEventListener('click', () => {
    const box = $('embedText'), done = (ok) => { $('embedSay').textContent = ok ? 'Copied. Paste it where the page takes HTML.' : 'Copy it from the box above.'; if (!ok) { box.focus(); box.select(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(() => done(true), () => done(false)); else done(false);
  });
  $('pictureBtn').addEventListener('click', () => { if (spine) { pictureOf().toBlob((blob) => download(blob, fileNameFor(spine) + '.png'), 'image/png'); $('shSay').textContent = 'Saved a picture of the view as it is now to your downloads.'; } });
  $('stlBtn').addEventListener('click', saveStl);
  $('objBtn').addEventListener('click', saveObj);
  $('standKind').addEventListener('change', showStand); $('stlScale').addEventListener('change', showStand);
  if (!VIEWER) window.addEventListener('hashchange', openLink);
  // New opens the sheet with the shapes to start from. Share opens the sheet with the ways to keep a sketch or pass it on.
  const SHARE_SAYS = $('shSay').textContent;
  sheet('start', 'startClose'); sheet('share', 'shareClose');
  $('newBtn').addEventListener('click', openStart);
  // The name of the sketch and a line about it: they head the printed page and name the saved files. A sketch that
  // was started from one of the shapes keeps that shape's name and words until they are changed here.
  for (const [id, key] of [['shName', 'name'], ['shAbout', 'about']]) $(id).addEventListener('change', () => {
    const text = $(id).value.trim();
    if (!spine || (spine[key] || '') === text) return;
    app.change(() => { if (text) spine[key] = text; else delete spine[key]; }, { ride: false });
    named();
  });
  $('shareBtn').addEventListener('click', () => {
    $('shName').value = (spine && spine.name) || ''; $('shAbout').value = (spine && spine.about) || '';
    $('linkText').hidden = true; $('shSay').textContent = SHARE_SAYS;
    $('clipBox').hidden = true; $('clipBtn').setAttribute('aria-expanded', 'false'); $('clipSay').textContent = '';
    $('embedBox').hidden = true; $('embedBtn').setAttribute('aria-expanded', 'false');
    $('printBox').hidden = true; $('printBtn').setAttribute('aria-expanded', 'false');
    if (!$('share').open) $('share').showModal();
  });
  $('printBtn').addEventListener('click', () => { const open = $('printBox').hidden; $('printBox').hidden = !open; $('printBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) $('printBox').scrollIntoView({ block: 'nearest' }); });
  document.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', fitView));
  $('problemsOk').addEventListener('click', () => { $('problemBox').hidden = true; });
  $('cleanBtn').addEventListener('click', () => setClean(true));
  $('cleanOff').addEventListener('click', () => setClean(false));
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { look.back = b.dataset.back; applyLook(); }));
  document.querySelectorAll('[data-shade]').forEach((b) => b.addEventListener('click', () => { look.shade = b.dataset.shade; applyLook(); }));
  $('simpleBones').addEventListener('change', () => { look.simple = $('simpleBones').checked; applyLook(); });
  // the bone shapes come from an open anatomy collection that asks to be named
  $('credit').textContent = 'Bone shapes: ' + SHAPE_CREDIT + '. Resized and placed for this app.';
  document.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => (b.dataset.reset === 'view' ? resetView() : resetModel())));
  document.querySelectorAll('[data-stand]').forEach((b) => b.addEventListener('click', () => setStand(!$('standKind').value)));
  // A small menu under a button of the top bar (View, and Reset on a wide screen): its button opens it, a press on one
  // of its lines or beside it closes it, and so does Esc. It hangs from the right edge of its button.
  const menus = [];
  function menu(btnId, boxId) {
    const btn = $(btnId), box = $(boxId);
    const set = (open) => {
      box.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) box.style.right = Math.max(8, Math.min(window.innerWidth - btn.getBoundingClientRect().right, window.innerWidth - 8 - box.offsetWidth)) + 'px';
    };
    // (opened from the keyboard, the menu takes the focus, and gives it back to its button when it closes)
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = box.hidden; menus.forEach((m) => m(false)); set(open); if (open && e.detail === 0) box.querySelector('button').focus(); });
    box.addEventListener('click', (e) => { if (!e.target.closest('[data-zoom],[data-move]')) { const had = box.contains(document.activeElement); set(false); if (had) btn.focus(); } });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); set(false); btn.focus(); } });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#' + boxId) && !e.target.closest('#' + btnId)) set(false); });
    menus.push(set);
  }
  menu('viewBtn', 'viewMenu'); menu('resetBtn', 'resetMenu');
  const viewMenu = (open) => menus.forEach((m) => m(open));
  // the guide: what the tools do, and the tour
  const guide = setupGuide(app, { builder: () => builder, fresh: () => openExample(START), changed, setStand });
  $('guideBtn').addEventListener('click', () => guide.open());
  document.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', () => guide.open()));
  $('startTour').addEventListener('click', () => { $('start').close(); guide.tour(); });
  sheet('guide', 'guideClose');
  // Zooming and moving the picture with one finger or one key: the same as a pinch and a drag with two fingers.
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => { const c = renderer.camera; c.distance = Math.max(80, Math.min(4000, c.distance * (b.dataset.zoom === 'in' ? 0.8 : 1.25))); renderer.requestDraw(); }));
  document.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => { const c = renderer.camera; c.target = [c.target[0], c.target[1], c.target[2] + (b.dataset.move === 'up' ? -1 : 1) * c.distance * 0.1]; renderer.requestDraw(); }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !VIEWER) { viewMenu(false); if (document.body.classList.contains('clean')) setClean(false); } });
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); }
  });
  // the picture is drawn again when its place on the page changes size (a card opens, the map comes in beside it)
  if (window.ResizeObserver) new ResizeObserver(() => renderer.requestDraw()).observe($('stage'));
  applyLook(false); siteLinks();
  // a link opens the sketch it holds. Without one the page starts with the average spine and the sheet of shapes to pick from.
  if (VIEWER) { viewerControls(); startViewer(); }
  else {
    if (!openLink()) { openExample(START); startNext = true; }
    welcome(false);
    if (startNext && !$('welcome').open) { startNext = false; openStart(); }
  }
  // handy when trying things in the browser console
  window.spineBuilder = { renderer, app, builder, guide, story, current: () => spine, show, openExample };
}
