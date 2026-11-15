// The page: loads a spine file, draws it, and wires up the panel.

import { createRenderer } from '../view/renderer.js';
import { buildScene, boundsOf } from '../view/scene.js';
import { validateSpine, sortedLevels } from '../core/spinefile.js';
import { measureSpine } from '../core/measures.js';
import { readSpineFile, saveSpineFile, loadExample } from '../io/files.js';

const $ = (id) => document.getElementById(id);
// phones get a slightly coarser grid for the bones so they appear sooner
const DETAIL = window.matchMedia('(max-width: 760px)').matches ? 1.8 : 1.4;
const renderer = createRenderer($('view'));
let spine = null, labels = [];

function say(text) {
  $('status').textContent = text || '';
}

// Show a spine: check it, build its shapes, fill in the panel.
function show(next, problems) {
  $('problems').textContent = '';
  for (const p of problems || []) { const li = document.createElement('li'); li.textContent = p; $('problems').appendChild(li); }
  $('problemBox').hidden = !(problems && problems.length);
  if (!next || !Array.isArray(next.levels) || !next.levels.length) return;
  spine = next;
  $('name').textContent = spine.name || 'A spine';
  $('about').textContent = spine.about || '';
  say('Drawing the bones');
  // give the notice a moment to appear before the shapes are worked out
  setTimeout(() => {
    renderer.setItems(buildScene(spine, DETAIL));
    applyToggles();
    const box = boundsOf(spine);
    renderer.frame(box.low, box.high);
    buildLabels();
    showNumbers();
    say('');
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
  renderer.requestDraw();
}

function buildLabels() {
  $('labels').textContent = '';
  labels = sortedLevels(spine).map((level) => {
    const el = document.createElement('span');
    el.textContent = level.id;
    $('labels').appendChild(el);
    return { el, at: level.centre };
  });
}

// Keep the level names on their vertebrae as the view turns.
function placeLabels() {
  if ($('labels').hidden) return;
  for (const l of labels) {
    const p = renderer.project(l.at);
    l.el.style.display = p ? '' : 'none';
    if (p) l.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) translate(-50%,-50%)';
  }
}

function showNumbers() {
  const m = measureSpine(spine), list = $('numbers');
  list.textContent = '';
  const line = (text) => { const li = document.createElement('li'); li.textContent = text; list.appendChild(li); };
  for (const c of m.curves) {
    line('Curve from ' + c.top + ' to ' + c.bottom + ': about ' + c.degrees + '°, bowing to the ' + c.bowsTo + ', furthest out at ' + c.apex + (c.held ? '' : ' (changes with posture)'));
  }
  if (m.kyphosis !== null) line('Rounding of the chest part, T5 to T12: about ' + m.kyphosis + '°');
  if (m.lordosis !== null) line('Hollow of the lower back, L1 to L5: about ' + m.lordosis + '°');
  if (!list.children.length) line('No curve of 10° or more.');
}

if (!renderer) {
  say('This browser cannot show 3D here. Try a current version of Chrome, Edge, Firefox or Safari.');
} else {
  renderer.afterDraw(placeLabels);
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
  const openExample = () => loadExample($('exampleSel').value).then((s) => show(s, validateSpine(s))).catch(() => say('That example could not be loaded. Use Open a spine file.'));
  $('exampleSel').addEventListener('change', openExample);
  $('fitBtn').addEventListener('click', () => { if (spine) { const b = boundsOf(spine); renderer.frame(b.low, b.high); } });
  openExample();
  // handy when trying things in the browser console
  window.spineBuilder = { renderer, current: () => spine, show };
}
