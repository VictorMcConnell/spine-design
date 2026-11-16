// The easy ways into the builder, for people who do not want to learn a 3D program:
//   - draw the curve of the spine as a line over the model,
//   - answer three questions and have the hardware put on, then change one vertebra at a time,
//   - pick colours for the hardware from swatches.
// The detailed tools are in build.js, which calls in here.

import { followLine } from '../core/shape.js';
import { fitOut, cellOf, hookFaces, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow } from '../core/place.js';
import { FINISHES, PALETTES, USUAL_FINISH, colorOf } from '../core/hardware.js';

const KINDS = [['rods', 'Rods'], ['screws', 'Screws'], ['hooks', 'Hooks'], ['crosslinks', 'Cross-links']];

// A row of round colour buttons.
//   chosen: the name of the colour that is on now      pick(name): called with the new one
//   usual:  true to add a button that goes back to the usual colour (pick is called with '')
export function swatches(box, label, chosen, pick, usual = false) {
  box.textContent = '';
  if (label) { const span = document.createElement('span'); span.textContent = label; box.appendChild(span); }
  for (const name of Object.keys(FINISHES)) {
    const b = document.createElement('button'), c = FINISHES[name].map((v) => Math.round(v * 255));
    b.className = 'swatch'; b.style.background = 'rgb(' + c.join(',') + ')'; b.title = name; b.dataset.color = name;
    b.setAttribute('aria-label', (label ? label + ': ' : '') + name); b.setAttribute('aria-pressed', chosen === name ? 'true' : 'false');
    b.addEventListener('click', () => pick(name));
    box.appendChild(b);
  }
  if (usual) {
    const b = document.createElement('button');
    b.className = 'swatch none'; b.textContent = 'the usual'; b.dataset.color = ''; b.setAttribute('aria-pressed', chosen ? 'false' : 'true');
    b.addEventListener('click', () => pick(''));
    box.appendChild(b);
  }
}

// kit: the helpers of build.js that are needed here ($, each, pressed, options, ids, levelOf, hitLevel, hint)
export function setupEasy(app, kit) {
  const { $, each, pressed, options, ids, levelOf, hitLevel, hint } = kit, { renderer } = app;
  const hw = () => app.spine.hardware;

  // ---------------------------------------------------------------- drawing the curve
  // "drawing" is the plane being drawn in (0: seen from the back, 1: seen from the side) or
  // null. While it is on, a drag over the view draws a line and does not turn the model.
  let drawing = null, stroke = null;
  function setDrawing(plane) {
    drawing = plane; stroke = null;
    pressed('[data-draw]', 'draw', drawing === null ? 'none' : drawing);
    $('drawPad').hidden = drawing === null; $('drawDone').hidden = drawing === null; $('drawLine').setAttribute('points', '');
    $('stage').classList.toggle('drawing', drawing !== null);
    if (drawing !== null) {
      renderer.look(drawing === 0 ? 0 : Math.PI / 2);
      $('drawSay').textContent = 'Now drag a line over the spine, ' + (drawing === 0 ? 'the way it curves to the left and right' : 'the way it rounds and hollows') + '. Start at the pelvis or at the neck. Draw again to change it.';
    } else $('drawSay').textContent = 'Press one of the two buttons. Then drag a line over the spine, from the pelvis up or from the neck down.';
    hint();
  }
  each('[data-draw]', (b) => b.addEventListener('click', () => setDrawing(drawing === Number(b.dataset.draw) ? null : Number(b.dataset.draw))));
  $('drawDone').addEventListener('click', () => setDrawing(null));
  // the view buttons of the ribbon keep working while drawing: the plane follows the view
  each('[data-look]', (b) => b.addEventListener('click', () => { if (drawing !== null) { drawing = b.dataset.look === 'left' || b.dataset.look === 'right' ? 1 : 0; pressed('[data-draw]', 'draw', drawing); } }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawing !== null) setDrawing(null); });

  // The spot under the pointer on the flat sheet the spine is drawn on: [across, up] in mm.
  function onSheet(e) {
    const ray = renderer.ray(e.clientX, e.clientY), axis = drawing === 0 ? 1 : 0, levels = app.spine.levels;
    const depth = levels.reduce((sum, l) => sum + l.centre[axis], 0) / levels.length;
    if (Math.abs(ray.direction[axis]) < 0.08) return null;
    const t = (depth - ray.origin[axis]) / ray.direction[axis];
    return t > 0 ? [ray.origin[drawing === 0 ? 0 : 1] + ray.direction[drawing === 0 ? 0 : 1] * t, ray.origin[2] + ray.direction[2] * t] : null;
  }
  const draw = {
    on: () => drawing !== null,
    down(e) { stroke = { screen: [], sheet: [] }; draw.move(e); return true; },
    move(e) {
      if (!stroke) return;
      const box = $('stage').getBoundingClientRect(), p = onSheet(e);
      stroke.screen.push((e.clientX - box.left).toFixed(1) + ',' + (e.clientY - box.top).toFixed(1));
      if (p) stroke.sheet.push(p);
      $('drawLine').setAttribute('points', stroke.screen.join(' '));
    },
    up() {
      const line = stroke ? stroke.sheet : [];
      stroke = null;
      if (line.length < 4) { $('drawLine').setAttribute('points', ''); return; }
      let took = false;
      const stiff = (app.rig.blocks || []).length > 0;
      app.change(() => { took = followLine(app.spine, app.rig, drawing, line); });
      $('drawSay').textContent = took ? 'The spine follows your line' + (stiff ? ', and the fused part kept its shape' : '') + '. Draw again to change it, or press Undo.' : 'That line was too short to follow. Drag a longer line along the spine.';
      setTimeout(() => { if (!stroke) $('drawLine').setAttribute('points', ''); }, 500);
    },
  };

  // ---------------------------------------------------------------- hardware in three questions
  const guide = { kind: 'screws', links: 1, picking: 0 };
  let guideFor = '', cardFor = null;
  each('[data-gkind]', (b) => b.addEventListener('click', () => { guide.kind = b.dataset.gkind; sync(); }));
  each('[data-glinks]', (b) => b.addEventListener('click', () => { guide.links = Number(b.dataset.glinks); sync(); }));
  function setPicking(step) {
    guide.picking = step;
    $('gPick').setAttribute('aria-pressed', step ? 'true' : 'false');
    $('stage').classList.toggle('placing', !!step);
    if (step) app.say(step === 1 ? 'Click the highest vertebra of the fusion on the model.' : 'Now click the lowest one.');
  }
  $('gPick').addEventListener('click', () => { setPicking(guide.picking ? 0 : 1); if (!guide.picking) app.say(''); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && guide.picking) { setPicking(0); app.say(''); } });
  $('gBuild').addEventListener('click', () => {
    const top = $('gTop').value, bottom = $('gBottom').value;
    if (top === bottom) { $('gSay').textContent = 'Choose two different vertebrae for the two ends of the fusion.'; return; }
    let done = false;
    app.picked = null;
    app.change(() => { done = fitOut(app.spine, top, bottom, guide.kind, guide.links); }, { ride: false });
    const list = ids(), a = Math.min(list.indexOf(top), list.indexOf(bottom)), b = Math.max(list.indexOf(top), list.indexOf(bottom)), links = (hw().crosslinks || []).filter((c) => c.below && list.indexOf(c.below) >= a && list.indexOf(c.below) < b).length;
    $('gSay').textContent = !done ? 'That did not work. Choose two different vertebrae.' : 'Done: ' + list[a] + ' to ' + list[b] + ' is fused and fitted out' + (links < guide.links ? ', with ' + (links || 'no') + ' cross-link' + (links === 1 ? '' : 's') + ' because there was no room for more' : '') + '. To change one vertebra, click it on the model.';
  });

  // one vertebra at a time: what it carries on each side, and what is in the gap below it
  const carried = (id, side) => { const kind = cellOf(app.spine, id, side); return kind === 'hook' ? 'hook-' + hookFaces(app.spine, id, side) : kind; };
  each('[data-gput]', (b) => b.addEventListener('click', () => {
    const id = app.picked && app.picked.kind === 'level' ? app.picked.id : null, side = b.parentElement.dataset.gside, [kind, faces] = b.dataset.gput.split('-');
    if (id) app.change(() => setCell(app.spine, id, side, kind, faces || 'down'), { ride: false });
  }));
  $('gFused').addEventListener('change', () => { const id = app.picked && app.picked.id; if (id) app.change(() => setFusedBelow(app.spine, id, $('gFused').checked), { ride: false }); });
  $('gLink').addEventListener('change', () => {
    const id = app.picked && app.picked.id;
    if (!id) return;
    let fits = true;
    app.change(() => { fits = setLinkBelow(app.spine, id, $('gLink').checked); }, { ride: false });
    $('gSay').textContent = fits ? '' : 'A cross-link needs a rod on both sides of that gap. Put a screw or a hook on both sides, above and below it, first.';
  });
  const step = (by) => () => { const list = ids(), i = list.indexOf(app.picked && app.picked.id) + by; if (i >= 0 && i < list.length) app.pick({ kind: 'level', id: list[i] }); };
  $('gUp').addEventListener('click', step(-1)); $('gDown').addEventListener('click', step(1));

  // A click on the model while the easy hardware pane is open.
  function tap(e) {
    const hit = hitLevel(e), id = hit && hit.level.id;
    if (guide.picking && id) {
      if (guide.picking === 1) { $('gTop').value = id; setPicking(2); }
      else { const list = ids(), other = $('gTop').value, a = list.indexOf(other), b = list.indexOf(id); $('gTop').value = list[Math.min(a, b)]; $('gBottom').value = list[Math.max(a, b)]; setPicking(0); app.say(list[Math.min(a, b)] + ' to ' + list[Math.max(a, b)] + '. Now choose what holds it and press "Put it on the spine".'); }
      return;
    }
    app.pick(id ? { kind: 'level', id } : null);
  }

  // ---------------------------------------------------------------- colours
  // The colour of each kind of part is kept in the spine file, so it travels with a saved
  // file and with a link.
  const colorNow = (kind) => (hw().colors || {})[kind] || USUAL_FINISH[kind];
  function setColors(colors) { app.change(() => { hw().colors = { ...(hw().colors || {}), ...colors }; }, { ride: false }); }
  each('[data-palette]', (b) => b.addEventListener('click', () => setColors(PALETTES[b.dataset.palette])));
  function colorRows() {
    const box = $('kindColors');
    if (!box.children.length) for (const [kind] of KINDS) { const row = document.createElement('div'); row.className = 'swatches'; row.dataset.kind = kind; box.appendChild(row); }
    for (const [kind, label] of KINDS) swatches(box.querySelector('[data-kind="' + kind + '"]'), label, colorOf(colorNow(kind)) ? colorNow(kind) : '', (name) => setColors({ [kind]: name }));
    each('[data-palette]', (b) => b.setAttribute('aria-pressed', KINDS.every(([kind]) => colorNow(kind) === PALETTES[b.dataset.palette][kind]) ? 'true' : 'false'));
  }

  function sync() {
    const list = ids();
    if (guideFor !== list.join()) {
      // a new spine: offer its fused stretch as the place for the hardware, or the usual T4 to L2
      guideFor = list.join();
      const fused = (app.spine.fused || [])[0], all = list.filter((id) => id !== 'C1').map((id) => [id, id]);
      options($('gTop'), all, fused ? fused[0] : list.includes('T4') ? 'T4' : all[0][0]);
      options($('gBottom'), all, fused ? fused[1] : list.includes('L2') ? 'L2' : all[all.length - 1][0]);
    }
    pressed('[data-gkind]', 'gkind', guide.kind); pressed('[data-glinks]', 'glinks', guide.links);
    const id = app.picked && app.picked.kind === 'level' ? app.picked.id : null, last = id === list[list.length - 1];
    $('gCard').hidden = !id;
    if (id && id !== cardFor && !$('easyBox').hidden && $('easyBox').offsetParent) {
      // a vertebra was just picked: bring its card into view in the panel (the picture stays where it is)
      const panel = $('panel'), box = $('gCard').getBoundingClientRect(), frame = panel.getBoundingClientRect();
      if (box.bottom > frame.bottom) panel.scrollTop += Math.min(box.bottom - frame.bottom + 10, box.top - frame.top - 10); else if (box.top < frame.top) panel.scrollTop -= frame.top - box.top + 10;
    }
    cardFor = id;
    if (id) {
      $('gName').textContent = id;
      each('[data-gside]', (row) => { row.hidden = id === 'C1'; row.querySelectorAll('[data-gput]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gput === carried(id, row.dataset.gside) ? 'true' : 'false')); });
      $('gFusedRow').hidden = $('gLinkRow').hidden = last;
      $('gFused').checked = fusedBelow(app.spine, id); $('gLink').checked = linkBelow(app.spine, id);
    }
    colorRows();
  }

  return { sync, tap, draw, stopDrawing: () => { if (drawing !== null) setDrawing(null); }, stopPicking: () => { if (guide.picking) setPicking(0); } };
}
