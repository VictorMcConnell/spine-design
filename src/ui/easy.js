// The easy ways into the builder, for people who do not want to learn a 3D program:
//   - draw the curve of the spine as a line over the model,
//   - a flat map of the spine with a tray of parts: tap or paint spots on the map, or drag
//     a part from the tray onto the map or onto the model,
//   - answer three questions and have the hardware put on, then change one vertebra at a time,
//   - pick colours for the hardware from swatches.
// The detailed tools are in build.js, which calls in here.

import { followLine, toLocal } from '../core/shape.js';
import { levelFrame } from '../core/bones.js';
import { fitOut, fitRods, cellOf, hookFaces, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow } from '../core/place.js';
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
  const { $, each, pressed, options, ids, levelOf, hitLevel, hint, chosen, pickPart } = kit, { renderer } = app;
  const hw = () => app.spine.hardware;

  // ---------------------------------------------------------------- drawing the curve
  // "drawing" is the plane being drawn in (0: seen from the back, 1: seen from the side) or
  // null. While it is on, a drag over the view draws a line and does not turn the model.
  let drawing = null, stroke = null;
  function setDrawing(plane) {
    drawing = plane; stroke = null;
    pressed('[data-draw]', 'draw', drawing === null ? 'none' : drawing);
    $('drawPad').hidden = drawing === null && !kit.lineOn(); $('drawDone').hidden = drawing === null && !kit.lineOn(); $('drawLine').setAttribute('points', '');
    $('stage').classList.toggle('drawing', drawing !== null);
    if (drawing !== null) {
      kit.stopLine();
      renderer.look(drawing === 0 ? 0 : Math.PI / 2);
      $('drawSay').textContent = 'Now drag a line over the spine, ' + (drawing === 0 ? 'the way it curves to the left and right' : 'the way it rounds and hollows') + '. Start at the pelvis or at the neck. Draw again to change it.';
    } else if (!kit.lineOn()) $('drawSay').textContent = 'Press one of the buttons. Then drag a line over the spine, from the pelvis up or from the neck down.';
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
      const stiff = (app.rig.blocks || []).length > 0, held = kit.held();
      app.change(() => { took = followLine(app.spine, app.rig, drawing, line, { held }); });
      $('drawSay').textContent = took ? 'The spine follows your line' + (held.length ? ', and the locked vertebrae stayed where they were' : stiff ? ', and the fused part kept its shape' : '') + '. Draw again to change it, or press Undo.' : held.length ? 'Nothing moved. The line was too short, or it ran over locked vertebrae only.' : 'That line was too short to follow. Drag a longer line along the spine.';
      setTimeout(() => { if (!stroke) $('drawLine').setAttribute('points', ''); }, 500);
    },
  };

  // ---------------------------------------------------------------- hardware in three questions
  const NEEDS_RODS = 'A cross-link needs a rod on both sides of that gap. Put a screw or a hook on both sides, above and below it, first.';
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
    app.change(() => { done = fitOut(app.spine, top, bottom, guide.kind, guide.links); delete hw().norods; }, { ride: false });
    setStep(4);
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
    app.say(fits ? '' : NEEDS_RODS);
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

  // ---------------------------------------------------------------- the flat map and the tray
  // The map shows the spine from the back as a column of blocks, one for each vertebra, with
  // a round spot on its left and its right for a screw or a hook, and the gap to the next
  // vertebra for a cross-link or for "fused". The tool picked in the tray is what a tap puts
  // there. The model follows every tap.
  const NS = 'http://www.w3.org/2000/svg', ROW = 26, WIDE = 300, REACH = 62;
  const TOOL_SAYS = {
    screw: 'Tap a round spot to put a screw there. Drag over several to fill them.',
    'hook-down': 'Tap a round spot for a hook whose blade points down.',
    'hook-up': 'Tap a round spot for a hook whose blade points up.',
    link: 'Tap between two vertebrae to put a cross-link there. It needs a rod on both sides.',
    fused: 'Tap between two vertebrae to mark them as fused to each other, or to undo that.',
    erase: 'Tap a part or a cross-link on the map to take it off.',
  };
  let mapTool = 'screw', painting = null, carrying = null;
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const css = (c) => 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')';
  const tint = (kind, piece) => css(colorOf(piece && piece.color) || colorOf((hw().colors || {})[kind]) || colorOf(USUAL_FINISH[kind]));
  const partAt = (id, side) => { for (const kind of ['screws', 'hooks']) { const index = hw()[kind].findIndex((p) => p.level === id && p.side === side); if (index >= 0) return { kind, index, piece: hw()[kind][index] }; } return null; };
  function mapRows() {
    const neck = $('mapNeck').checked || [...hw().screws, ...hw().hooks].some((p) => /^C/.test(p.level));
    return ids().filter((id) => (neck ? id !== 'C1' : !/^C/.test(id)));
  }
  // the gap a cross-link sits in: the one it was put in, or the one at its height
  function gapOf(link, rows) {
    if (link.below) return rows.indexOf(link.below);
    const z = (link.from[2] + link.to[2]) / 2;
    for (let i = 0; i < rows.length - 1; i++) if (z <= levelOf(rows[i]).centre[2] && z >= levelOf(rows[i + 1]).centre[2]) return i;
    return -1;
  }
  function drawMap() {
    const svg = $('map');
    if (!$('mapWrap').offsetParent && svg.childNodes.length) return;      // not on screen: it is drawn when it is next shown
    const rows = mapRows(), list = ids(), n = rows.length, last = levelOf(rows[n - 1]).centre[0];
    const X = (i) => WIDE / 2 - Math.max(-48, Math.min(48, (levelOf(rows[i]).centre[0] - last) * 0.55)), Y = (i) => 24 + i * ROW + ROW / 2, slotX = (i, side) => X(i) + (side === 'left' ? -REACH : REACH);
    const stiff = new Set(), picked = app.picked || {}, sel = chosen();
    if (app.stiff) for (const b of app.rig.blocks || []) list.slice(b.from, b.to + 1).forEach((id) => stiff.add(id));
    svg.setAttribute('viewBox', '0 0 ' + WIDE + ' ' + (n * ROW + 34)); svg.textContent = '';
    el('text', { x: WIDE / 2 - REACH, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = 'Left';
    el('text', { x: WIDE / 2 + REACH, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = 'Right';
    // fused gaps join their two blocks
    rows.forEach((id, i) => { if (i < n - 1 && fusedBelow(app.spine, id)) el('rect', { x: (X(i) + X(i + 1)) / 2 - 27, y: Y(i) + 7, width: 54, height: ROW - 14, class: 'bridge' }, svg); });
    // rods: a line down each side through the spots of its parts
    for (const rod of hw().norods ? [] : hw().rods) {
      const at = [...hw().screws, ...hw().hooks].filter((p) => p.rod === rod.id).map((p) => rows.indexOf(p.level)).filter((i) => i >= 0);
      if (at.length < 2) continue;
      const points = [];
      for (let i = Math.min(...at); i <= Math.max(...at); i++) points.push(slotX(i, rod.side) + ',' + Y(i));
      el('polyline', { points: points.join(' '), fill: 'none', stroke: tint('rods', rod), 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    }
    rows.forEach((id, i) => {
      el('rect', { x: X(i) - 40, y: Y(i) - 10, width: 80, height: 20, rx: 6, class: 'bone' + (stiff.has(id) ? ' stiff' : '') + (picked.kind === 'level' && picked.id === id ? ' picked' : '') }, svg);
      el('text', { x: X(i), y: Y(i) + 4, 'text-anchor': 'middle' }, svg).textContent = id;
    });
    // the gaps: a place to tap, and the cross-link if one is there
    for (let i = 0; i < n - 1; i++) {
      const g = el('g', { 'data-gap': rows[i] }, svg), x = (X(i) + X(i + 1)) / 2, y = Y(i) + ROW / 2;
      el('rect', { x: x - REACH - 4, y: y - 6, width: 2 * REACH + 8, height: 12, class: 'hit' }, g);
      el('line', { x1: x - 30, y1: y, x2: x + 30, y2: y, class: 'gapline' }, g);
    }
    hw().crosslinks.forEach((link, index) => {
      const i = gapOf(link, rows);
      if (i < 0) return;
      const x = (X(i) + X(i + 1)) / 2, y = Y(i) + ROW / 2, on = sel.some((c) => c.kind === 'crosslinks' && c.index === index);
      el('line', { x1: x - REACH, y1: y, x2: x + REACH, y2: y, stroke: tint('crosslinks', link), 'stroke-width': 5, 'stroke-linecap': 'round', 'pointer-events': 'none' }, svg);
      if (on) el('rect', { x: x - REACH - 5, y: y - 6, width: 2 * REACH + 10, height: 12, rx: 6, class: 'ring', 'pointer-events': 'none' }, svg);
    });
    // the spots beside each vertebra
    rows.forEach((id, i) => {
      for (const side of ['left', 'right']) {
        const g = el('g', { 'data-slot': id + ':' + side }, svg), x = slotX(i, side), y = Y(i), part = partAt(id, side);
        el('circle', { cx: x, cy: y, r: 13, class: 'hit' }, g);
        if (!part) { el('circle', { cx: x, cy: y, r: 8.5, class: 'empty' }, g); continue; }
        if (part.kind === 'screws') { el('circle', { cx: x, cy: y, r: 9, fill: tint('screws', part.piece) }, g); el('circle', { cx: x, cy: y, r: 3, fill: '#22242b' }, g); }
        else {
          const up = part.piece.faces === 'up', k = up ? -1 : 1;
          el('rect', { x: x - 9, y: y - 9, width: 18, height: 18, rx: 4, fill: tint('hooks', part.piece) }, g);
          el('path', { d: 'M' + (x - 5) + ' ' + (y - 2.5 * k) + ' L' + (x + 5) + ' ' + (y - 2.5 * k) + ' L' + x + ' ' + (y + 4.5 * k) + ' Z', fill: '#fff' }, g);
        }
        if (part.piece.locked) el('circle', { cx: x, cy: y, r: 11.5, class: 'lock' }, g);
        if (sel.some((c) => c.piece === part.piece)) el('circle', { cx: x, cy: y, r: 12.5, class: 'ring' }, g);
      }
    });
  }
  // what one tap, or one step of a drag over the map, does. "run" remembers what the first
  // gap of a drag was switched to, so the rest of the drag does the same.
  const live = (fn) => app.change(fn, { settle: false, ride: false });
  // At the Easy level the rods wait for their own step: the first part put on a bare spine says so in the file.
  const rodsWait = () => { if (app.level === 'easy' && !hw().screws.length && !hw().hooks.length && !hw().rods.length) hw().norods = true; };
  function putOnSlot(id, side) {
    if (mapTool === 'none') return false;
    if (mapTool === 'link' || mapTool === 'fused') { $('traySay').textContent = 'That goes between two vertebrae: tap the gap.'; return false; }
    const want = mapTool === 'erase' ? '' : mapTool, [kind, faces] = want.split('-');
    if (id === 'C1' || carried(id, side) === want) return false;
    let done = true;
    live(() => { rodsWait(); done = setCell(app.spine, id, side, kind, faces || 'down'); });
    if (!done) $('traySay').textContent = 'That part is frozen. Untick "Frozen" under Full control to change it.';
    return done;
  }
  function putOnGap(id, run) {
    const list = ids();
    if (mapTool === 'none' || list.indexOf(id) < 0 || list.indexOf(id) >= list.length - 1) return false;
    if (mapTool === 'fused') {
      if (run.on === undefined) run.on = !fusedBelow(app.spine, id);
      if (fusedBelow(app.spine, id) === run.on) return false;
      live(() => setFusedBelow(app.spine, id, run.on));
      return true;
    }
    if (mapTool === 'link' || mapTool === 'erase') {
      if (run.on === undefined) run.on = mapTool === 'link' && !linkBelow(app.spine, id);
      if (linkBelow(app.spine, id) === run.on) return false;
      let fits = true;
      live(() => { fits = setLinkBelow(app.spine, id, run.on); });
      if (!fits) $('traySay').textContent = NEEDS_RODS;
      return fits;
    }
    $('traySay').textContent = 'That goes on a round spot beside a vertebra.';
    return false;
  }
  const spotUnder = (x, y) => { const e = document.elementFromPoint(x, y), g = e && e.closest ? e.closest('[data-slot],[data-gap]') : null; return g && $('map').contains(g) ? g : null; };
  function putOn(g, run) {
    const key = g.dataset.slot || 'gap ' + g.dataset.gap;
    if (run.last === key) return;
    run.last = key;
    const did = g.dataset.slot ? putOnSlot(...g.dataset.slot.split(':')) : putOnGap(g.dataset.gap, run);
    if (did) { run.changed = true; drawMap(); }
  }
  // The part of the tray goes on the side of the vertebra that was clicked or dropped on, or into the gap nearest to that spot.
  function putOnModel(hit) {
    const id = hit.level.id, side = toLocal(hit.point, hit.level.centre, levelFrame(hit.level))[0] >= 0 ? 'left' : 'right', run = {};
    if (mapTool !== 'fused' && mapTool !== 'link') return putOnSlot(id, side);
    const list = ids(), i = list.indexOf(id), up = hit.point[2] > hit.level.centre[2] && i > 0;
    return putOnGap(up ? list[i - 1] : id, run) || (mapTool === 'link' && i > 0 && putOnGap(up ? id : list[i - 1], run));
  }
  function setTool(name) { mapTool = name; pressed('[data-tray]', 'tray', name); pressed('[data-steptool]', 'steptool', name); $('traySay').textContent = app.level === 'easy' ? '' : TOOL_SAYS[name] || ''; }

  // ---- the Easy level: one kind of part at a time, the rods last
  const STEPS = {
    1: { tool: 'screw', say: 'Step 1. Tap every spot that has a screw, on the map or on the model. Drag down the map to fill several.', next: 'Next: hooks' },
    2: { tool: 'hook-down', say: 'Step 2. Any hooks? Choose which way they point, then tap their spots. If there are none, go on.', next: 'Next: cross-links' },
    3: { tool: 'link', say: 'Step 3. Any cross-links? Tap between two vertebrae where one joins the two sides. If there are none, go on.', next: 'Next: rods' },
    4: { tool: 'none', say: 'Step 4. Put the rods on. They run through the screws and hooks of each side.', next: '' },
  };
  let stage = 1;
  const parts = () => [...hw().screws, ...hw().hooks];
  // the stretch the rods span: from the highest vertebra with a part to the lowest
  function spanOf() { const list = ids(), at = parts().map((p) => list.indexOf(p.level)).filter((i) => i >= 0); return at.length > 1 ? [Math.min(...at), Math.max(...at)] : null; }
  function showSteps() {
    const rodsOn = !hw().norods, span = spanOf(), list = ids();
    pressed('[data-step]', 'step', stage);
    $('stepSay').textContent = stage === 4 && rodsOn && hw().rods.length ? 'The rods are on. Click a part to change its colour, or go back a step to change the parts.' : stage === 4 && parts().length < 2 ? 'Step 4. A rod needs two parts on one side to hold it. Go back and put on screws or hooks first.' : STEPS[stage].say;
    each('[data-steptool]', (b) => { b.hidden = b.dataset.steptool === 'erase' ? stage === 4 : stage !== 2; });
    $('rodStep').hidden = stage !== 4;
    $('rodsPut').hidden = rodsOn; $('rodsOff').hidden = !rodsOn || !hw().rods.length;
    $('stepFusedRow').hidden = !span; $('stepFused').checked = !!span && list.slice(span[0], span[1]).every((id) => fusedBelow(app.spine, id));
    $('stepBack').disabled = stage === 1; $('stepNext').hidden = stage === 4; $('stepNext').textContent = STEPS[stage].next;
    $('rodsOn').checked = rodsOn;
    pressed('[data-steptool]', 'steptool', mapTool);
  }
  function setStep(n) { stage = Math.max(1, Math.min(4, n)); setTool(STEPS[stage].tool); showSteps(); if (app.spine) drawMap(); }
  each('[data-step]', (b) => b.addEventListener('click', () => setStep(Number(b.dataset.step))));
  $('stepBack').addEventListener('click', () => setStep(stage - 1)); $('stepNext').addEventListener('click', () => setStep(stage + 1));
  each('[data-steptool]', (b) => b.addEventListener('click', () => { setTool(mapTool === b.dataset.steptool && b.dataset.steptool === 'erase' ? STEPS[stage].tool : b.dataset.steptool); }));
  const setRods = (on) => app.change(() => { if (on) delete hw().norods; else hw().norods = true; fitRods(app.spine); }, { ride: false });
  $('rodsPut').addEventListener('click', () => setRods(true)); $('rodsOff').addEventListener('click', () => setRods(false));
  $('rodsOn').addEventListener('change', () => setRods($('rodsOn').checked));
  $('stepFused').addEventListener('change', () => { const span = spanOf(), list = ids(); if (span) app.change(() => { for (let i = span[0]; i < span[1]; i++) setFusedBelow(app.spine, list[i], $('stepFused').checked); }, { ride: false }); });
  $('map').addEventListener('pointerdown', (e) => {
    const g = spotUnder(e.clientX, e.clientY);
    if (!g || !app.spine) return;
    e.preventDefault(); app.say('');
    $('traySay').textContent = TOOL_SAYS[mapTool];
    painting = { first: g };
    putOn(g, painting);
  });
  window.addEventListener('pointermove', (e) => {
    if (painting) { const g = spotUnder(e.clientX, e.clientY); if (g) putOn(g, painting); }
    if (carrying) {
      if (!carrying.ghost && Math.hypot(e.clientX - carrying.x, e.clientY - carrying.y) > 8) { carrying.ghost = document.createElement('div'); carrying.ghost.id = 'ghost'; carrying.ghost.textContent = carrying.label; document.body.appendChild(carrying.ghost); }
      if (carrying.ghost) { carrying.ghost.style.left = e.clientX + 'px'; carrying.ghost.style.top = e.clientY + 'px'; }
    }
  });
  const letGo = (e) => {
    if (painting) {
      const run = painting, slot = run.first.dataset.slot;
      painting = null;
      if (run.changed) app.settle();
      // a tap on a part that was not changed selects that part
      else if (slot && run.last === slot && e.type === 'pointerup') { const part = partAt(...slot.split(':')); if (part) pickPart(part, false); }
    }
    if (carrying) {
      const c = carrying;
      carrying = null;
      if (!c.ghost) return;
      c.ghost.remove();
      if (e.type !== 'pointerup' || !app.spine) return;
      // dropped on the map, or on the model: on the side of the vertebra under the pointer
      const run = {}, g = spotUnder(e.clientX, e.clientY), over = document.elementFromPoint(e.clientX, e.clientY);
      if (g) putOn(g, run);
      else if (over === $('view')) {
        const hit = hitLevel(e);
        if (!hit) { $('traySay').textContent = 'Drop it on a vertebra.'; return; }
        run.changed = putOnModel(hit);
      }
      if (run.changed) app.settle();
    }
  };
  window.addEventListener('pointerup', letGo); window.addEventListener('pointercancel', letGo);
  each('[data-tray]', (b) => {
    b.addEventListener('pointerdown', (e) => { setTool(b.dataset.tray); carrying = { x: e.clientX, y: e.clientY, label: b.textContent, ghost: null }; });
    b.addEventListener('click', () => setTool(b.dataset.tray));
  });
  $('mapNeck').addEventListener('change', drawMap);
  setTool('screw');

  // ---------------------------------------------------------------- colours
  // The colour of each kind of part is kept in the spine file, so it travels with a saved
  // file and with a link.
  const colorNow = (kind) => (hw().colors || {})[kind] || USUAL_FINISH[kind];
  function setColors(colors) { app.change(() => { hw().colors = { ...(hw().colors || {}), ...colors }; }, { ride: false }); }
  const kindColor = (kind) => (colorOf(colorNow(kind)) ? colorNow(kind) : '');
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
      // a spine that comes with hardware is past the steps, a bare one starts at the first
      stage = parts().length ? 4 : 1; mapTool = app.level === 'easy' ? STEPS[stage].tool : mapTool === 'none' ? 'screw' : mapTool;
      pressed('[data-tray]', 'tray', mapTool);
    }
    // (the steps are for the Easy level: elsewhere the tray always has a part picked)
    if (app.level !== 'easy' && mapTool === 'none') setTool('screw');
    if (app.level === 'easy' && mapTool !== 'erase' && !(stage === 2 && mapTool === 'hook-up') && mapTool !== STEPS[stage].tool) setTool(STEPS[stage].tool);
    showSteps();
    pressed('[data-gkind]', 'gkind', guide.kind); pressed('[data-glinks]', 'glinks', guide.links);
    const id = app.picked && app.picked.kind === 'level' ? app.picked.id : null, last = id === list[list.length - 1];
    $('gCard').hidden = !id;
    if (id && id !== cardFor && $('gCard').offsetParent) {
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
    drawMap();
  }

  return { sync, tap, draw, putOnModel, kindColor, setKindColor: (kind, name) => setColors({ [kind]: name }), picking: () => !!guide.picking, stopDrawing: () => { if (drawing !== null) setDrawing(null); }, stopPicking: () => { if (guide.picking) setPicking(0); } };
}
