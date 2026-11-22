// The tools that work by drawing and tapping:
//   - draw the curve of the spine as a line over the model,
//   - a flat map of the spine beside the model: tap or paint its spots with the tool in hand,
//     or tap the soft marks on the model itself,
//   - rods from part to part,
//   - answer three questions and have the hardware put on, then change one vertebra at a time,
//   - pick colours for the hardware from swatches.
// build.js decides which tool is in hand and calls in here.

import { followLine, toLocal } from '../core/shape.js';
import { levelFrame } from '../core/bones.js';
import { slot, fitOut, fitRods, cellOf, hookFaces, setCell, fusedBelow, setFusedBelow, linkBelow, setLinkBelow, linkSpot, linkGap, gapsOf, setRodCut, drawRod, cutAll, rodsThroughAll, cutRodAt, rodSets } from '../core/place.js';
import { FINISHES, PALETTES, colorOf } from '../core/finish.js';
import { PART_KINDS, USUAL_FINISH } from '../parts/kinds.js';

const KINDS = PART_KINDS.map((p) => [p.kind, p.names]);

// A row of round colour buttons.
//   chosen: the name of the colour that is on now      pick(name): called with the new one
//   usual:  true to add a button that goes back to the usual colour (pick is called with '')
//   usual: true adds "the usual" (it gives ''), or a word of its own for that button
//   other: true adds a well for any colour at all (it gives '#rrggbb')
export function swatches(box, label, chosen, pick, usual = false, other = false) {
  const hex = (name) => '#' + FINISHES[name].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const named = Object.keys(FINISHES).find((name) => name === chosen || hex(name) === String(chosen).toLowerCase());
  box.textContent = '';
  if (label) { const span = document.createElement('span'); span.textContent = label; box.appendChild(span); }
  for (const name of Object.keys(FINISHES)) {
    const b = document.createElement('button'), c = FINISHES[name].map((v) => Math.round(v * 255));
    b.className = 'swatch'; b.style.background = 'rgb(' + c.join(',') + ')'; b.title = name; b.dataset.color = name;
    b.setAttribute('aria-label', (label ? label + ': ' : '') + name); b.setAttribute('aria-pressed', named === name ? 'true' : 'false');
    b.addEventListener('click', () => pick(name));
    box.appendChild(b);
  }
  if (usual) {
    const b = document.createElement('button');
    b.className = 'swatch none'; b.textContent = usual === true ? 'the usual' : usual; b.dataset.color = ''; b.setAttribute('aria-pressed', chosen ? 'false' : 'true');
    b.addEventListener('click', () => pick(''));
    box.appendChild(b);
  }
  if (other) {
    const wrap = document.createElement('label'), well = document.createElement('input'), mine = /^#[0-9a-f]{6}$/i.test(chosen || '') && !named;
    wrap.className = 'swatch any'; wrap.title = 'another color'; if (mine) wrap.classList.add('on');
    well.type = 'color'; well.value = mine ? chosen : '#888888'; well.setAttribute('aria-label', (label ? label + ': ' : '') + 'another color');
    well.addEventListener('change', () => pick(well.value));
    wrap.appendChild(well); box.appendChild(wrap);
  }
}

// kit: the helpers of build.js that are needed here ($, each, pressed, options, ids, levelOf, hitLevel, hint, chosen, pickPart,
//      both(): parts go on both sides at once, touch(): the screen is worked by touch, filled(text): the three questions were answered)
export function setupEasy(app, kit) {
  const { $, each, pressed, options, ids, levelOf, hitLevel, hint, chosen, pickPart } = kit, { renderer } = app;
  const hw = () => app.spine.hardware;

  // ---------------------------------------------------------------- drawing the curve
  // "drawing" is the plane being drawn in (0: seen from the back, 1: seen from the side) or
  // null. While it is on, a drag over the view draws a line and does not turn the model.
  let drawing = null, stroke = null, lastPlane = 0;
  const START_SAYS = ['Drag a line up the spine, the way it curves to the left and right.', 'Drag a line up the spine, the way it rounds and hollows.'];
  function setDrawing(plane) {
    drawing = plane; stroke = null;
    pressed('[data-draw]', 'draw', drawing === null ? 'none' : drawing);
    $('drawPad').hidden = drawing === null && !kit.lineOn(); $('drawLine').setAttribute('points', '');
    $('stage').classList.toggle('drawing', drawing !== null);
    if (drawing !== null) {
      lastPlane = drawing;
      kit.stopLine();
      renderer.look(drawing === 0 ? 0 : Math.PI / 2);
      $('drawSay').textContent = START_SAYS[drawing];
    } else if (!kit.lineOn()) $('drawSay').textContent = '';
    hint();
  }
  each('[data-draw]', (b) => b.addEventListener('click', () => setDrawing(Number(b.dataset.draw))));
  // the view buttons keep working while drawing: the plane follows the view
  each('[data-look]', (b) => b.addEventListener('click', () => { if (drawing !== null) { drawing = lastPlane = b.dataset.look === 'left' || b.dataset.look === 'right' ? 1 : 0; pressed('[data-draw]', 'draw', drawing); $('drawSay').textContent = START_SAYS[drawing]; } }));

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
    // (a second finger came down to zoom: the line that was begun is dropped)
    cancel() { stroke = null; $('drawLine').setAttribute('points', ''); },
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
      $('drawSay').textContent = took ? 'The spine follows your line' + (held.length ? ', and the locked vertebrae stayed where they were' : stiff ? ', and the fused part kept its shape' : '') + '. Draw again to change it.' : held.length ? 'Nothing moved. The line was too short, or it ran over locked vertebrae only.' : 'That line was too short to follow. Drag a longer line along the spine.';
      setTimeout(() => { if (!stroke) $('drawLine').setAttribute('points', ''); }, 500);
    },
  };

  // ---------------------------------------------------------------- hardware in three questions
  const NEEDS_RODS = 'A cross-link needs a rod on both sides of that gap. Put a screw or a hook on both sides, above and below it, first.';
  const guide = { kind: 'screws', links: 1, picking: 0 };
  let guideFor = '';
  each('[data-gkind]', (b) => b.addEventListener('click', () => { guide.kind = b.dataset.gkind; sync(); }));
  each('[data-glinks]', (b) => b.addEventListener('click', () => { guide.links = Number(b.dataset.glinks); sync(); }));
  function setPicking(step) {
    guide.picking = step;
    $('gPick').setAttribute('aria-pressed', step ? 'true' : 'false');
    $('stage').classList.toggle('placing', !!step);
    if (step) app.say(step === 1 ? 'Click the highest vertebra of the fusion on the model.' : 'Now click the lowest one.');
  }
  $('gPick').addEventListener('click', () => { setPicking(guide.picking ? 0 : 1); if (!guide.picking) app.say(''); });
  $('gBuild').addEventListener('click', () => {
    const top = $('gTop').value, bottom = $('gBottom').value;
    if (top === bottom) { $('gSay').textContent = 'Choose two different vertebrae for the two ends of the fusion.'; return; }
    let done = false;
    app.picked = null;
    app.change(() => { done = fitOut(app.spine, top, bottom, guide.kind, guide.links); delete hw().norods; }, { ride: false });
    const list = ids(), a = Math.min(list.indexOf(top), list.indexOf(bottom)), b = Math.max(list.indexOf(top), list.indexOf(bottom)), links = (hw().crosslinks || []).filter((c) => c.below && list.indexOf(c.below) >= a && list.indexOf(c.below) < b).length;
    if (!done) { $('gSay').textContent = 'That did not work. Choose two different vertebrae.'; return; }
    $('gSay').textContent = '';
    // (the card closes and the result is told over the model)
    kit.filled(list[a] + ' to ' + list[b] + ' is fused and fitted out' + (links < guide.links ? ', with ' + (links || 'no') + ' cross-link' + (links === 1 ? '' : 's') + ' because there was no room for more' : '') + '. ' + (kit.touch() ? 'Tap' : 'Click') + ' a part to change it.');
  });

  // one vertebra at a time: what it carries on each side, and what is in the gap below it
  const carried = (id, side) => { const kind = cellOf(app.spine, id, side); return kind === 'hook' ? 'hook-' + hookFaces(app.spine, id, side) : kind; };
  each('[data-gput]', (b) => b.addEventListener('click', () => {
    const id = app.picked && app.picked.kind === 'level' ? app.picked.id : null, side = b.parentElement.dataset.gside, [kind, faces] = b.dataset.gput.split('-');
    if (id) app.change(() => setCell(app.spine, id, side, kind, faces || 'down', kit.look()), { ride: false });
  }));
  $('gFused').addEventListener('change', () => { const id = app.picked && app.picked.id; if (id) app.change(() => setFusedBelow(app.spine, id, $('gFused').checked), { ride: false }); });
  $('gLink').addEventListener('change', () => {
    const id = app.picked && app.picked.id;
    if (!id) return;
    let fits = true;
    app.change(() => { fits = setLinkBelow(app.spine, id, $('gLink').checked, kit.linkLook()); }, { ride: false });
    app.say(fits ? '' : NEEDS_RODS);
  });
  const step = (by) => () => { const list = ids(), i = list.indexOf(app.picked && app.picked.id) + by; if (i >= 0 && i < list.length) app.pick({ kind: 'level', id: list[i] }); };
  $('gUp').addEventListener('click', step(-1)); $('gDown').addEventListener('click', step(1));

  // A click on the model while the easy hardware pane is open.
  function tap(e) {
    const hit = hitLevel(e), id = hit && hit.level.id;
    if (guide.picking && id) {
      if (guide.picking === 1) { $('gTop').value = id; setPicking(2); }
      else { const list = ids(), other = $('gTop').value, a = list.indexOf(other), b = list.indexOf(id); $('gTop').value = list[Math.min(a, b)]; $('gBottom').value = list[Math.max(a, b)]; setPicking(0); app.say(list[Math.min(a, b)] + ' to ' + list[Math.max(a, b)] + '. Now choose what holds it.'); }
      return;
    }
    app.pick(id ? { kind: 'level', id } : null);
  }

  // ---------------------------------------------------------------- the flat map
  // The map shows the spine from the back as a column of blocks, one for each vertebra, with
  // a round spot on its left and its right for a screw or a hook, and the gap to the next
  // vertebra for a cross-link. The tool in hand is what a tap puts there. The model follows
  // every tap. With no tool in hand ('none', the Turn tool) a tap selects.
  const NS = 'http://www.w3.org/2000/svg', ROW = 26, WIDE = 300;
  const press = () => (kit.touch() ? 'tap' : 'click'), Press = () => (kit.touch() ? 'Tap' : 'Click');
  const toolSays = (name) => ({
    screw: Press() + ' a dot to put a screw there. Drag down the map to fill several.',
    'hook-down': Press() + ' a dot to put a hook there. Its blade points down.',
    'hook-up': Press() + ' a dot to put a hook there. Its blade points up.',
    link: hw().screws.length + hw().hooks.length < 4 ? 'A cross-link joins the two sides. Put screws or hooks on both sides first.' : Press() + ' a dotted line between two vertebrae for a cross-link.',
    erase: Press() + ' a part to take it off.',
  }[name] || '');
  let mapTool = 'screw', painting = null;
  // the rod tool: the part a rod is being drawn from ({ id, side }), and the last thing it did, in words
  let rodFrom = null, rodNote = '';
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const css = (c) => 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')';
  const tint = (kind, piece) => css(colorOf(piece && piece.color) || colorOf((hw().colors || {})[kind]) || colorOf(USUAL_FINISH[kind]));
  const partAt = (id, side) => { for (const kind of ['screws', 'hooks']) { const index = hw()[kind].findIndex((p) => p.level === id && p.side === side); if (index >= 0) return { kind, index, piece: hw()[kind][index] }; } return null; };
  const onRod = (id, side) => { const p = partAt(id, side); return !!p && hw().rods.some((r) => r.id === p.piece.rod); };
  function mapRows() {
    const neck = $('mapNeck').checked || [...hw().screws, ...hw().hooks].some((p) => /^C/.test(p.level));
    return ids().filter((id) => (neck ? id !== 'C1' : !/^C/.test(id)));
  }
  // the gap a cross-link sits in, as a row of the map (-1 if that part of the spine is not on the map)
  const gapOf = (link, rows) => rows.indexOf(linkGap(app.spine, link));
  function drawMap() {
    const svg = $('map');
    if (!$('mapWrap').offsetParent && svg.childNodes.length) return;      // not on screen: it is drawn when it is next shown
    const rows = mapRows(), list = ids(), n = rows.length, last = levelOf(rows[n - 1]).centre[0];
    // (the map stands beside the model and is kept narrow: it sways a little with the curve, and its spots sit close in)
    const sway = 14, R = 46, half = 28;
    const X = (i) => WIDE / 2 - Math.max(-sway, Math.min(sway, (levelOf(rows[i]).centre[0] - last) * 0.25)), Y = (i) => 24 + i * ROW + ROW / 2, slotX = (i, sd) => X(i) + (sd === 'left' ? -R : R);
    const stiff = new Set(), picked = app.picked || {}, sel = chosen();
    if (app.stiff) for (const b of app.rig.blocks || []) list.slice(b.from, b.to + 1).forEach((id) => stiff.add(id));
    // The map is cut to what is on it and made as tall as its place, so the whole spine shows
    // at once. A row is never less than 18 px tall (on a very short screen the map scrolls
    // instead) and never more than 34 px (on a tall screen it would grow wide and push the model aside).
    const tall = n * ROW + 34;
    const lo = Math.min(...rows.map((id, i) => slotX(i, 'left'))) - 19, hi = Math.max(...rows.map((id, i) => slotX(i, 'right'))) + 19;
    svg.setAttribute('viewBox', lo + ' 0 ' + (hi - lo) + ' ' + tall); svg.textContent = '';
    const room = $('strip').clientHeight - 16 - $('mapNeckRow').offsetHeight, k = Math.max(Math.min(room / tall, 34 / ROW), 18 / ROW);
    svg.style.height = Math.round(tall * k) + 'px'; svg.style.width = Math.round((hi - lo) * k) + 'px';
    // (the tool in hand is written on the map, so the places it can be used can be shown softly: see style.css)
    svg.dataset.tool = mapTool; svg.classList.toggle('arming', !!rodFrom);
    el('text', { x: WIDE / 2 - R, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = 'Left';
    el('text', { x: WIDE / 2 + R, y: 14, class: 'side', 'text-anchor': 'middle' }, svg).textContent = 'Right';
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
    // where a rod ends between two parts: a dotted line where it could run, and a small bar across it
    const cutting = mapTool === 'rod' && !hw().norods;
    if (!hw().norods) for (const side of ['left', 'right']) for (const g of gapsOf(app.spine, side)) {
      const a = rows.indexOf(g.upper), b = rows.indexOf(g.lower);
      // (only where a rod really ends: between two parts that have no rod at all there is nothing to show)
      if (!g.cut || a < 0 || b < 0 || !(onRod(g.upper, side) || onRod(g.lower, side))) continue;
      const points = [];
      for (let i = a; i <= b; i++) points.push(slotX(i, side) + ',' + Y(i));
      el('polyline', { points: points.join(' '), class: 'cut' }, svg);
      const x = (slotX(a, side) + slotX(b, side)) / 2, y = (Y(a) + Y(b)) / 2;
      el('line', { x1: x - 6, y1: y, x2: x + 6, y2: y, class: 'snip' }, svg);
    }
    rows.forEach((id, i) => {
      el('rect', { x: X(i) - half, y: Y(i) - 10, width: 2 * half, height: 20, rx: 6, 'data-bone': id, class: 'bone' + (stiff.has(id) ? ' stiff' : '') + (picked.kind === 'level' && picked.id === id ? ' picked' : '') }, svg);
      el('text', { x: X(i), y: Y(i) + 4, 'text-anchor': 'middle' }, svg).textContent = id;
    });
    // the gaps: a place to tap, and the cross-link if one is there
    for (let i = 0; i < n - 1; i++) {
      // (with the cross-link tool, a gap that has a rod on both sides can take one: it is marked so it shows as a place to tap)
      const linked = linkBelow(app.spine, rows[i]), open = mapTool === 'link' && !linked && !!linkSpot(app.spine, rows[i]);
      const g = el('g', { 'data-gap': rows[i], ...(open ? { class: 'can' } : linked ? { class: 'linked' } : {}) }, svg), x = (X(i) + X(i + 1)) / 2, y = Y(i) + ROW / 2;
      el('rect', { x: x - R - 4, y: y - 6, width: 2 * R + 8, height: 12, class: 'hit' }, g);
      el('line', { x1: x - 30, y1: y, x2: x + 30, y2: y, class: 'gapline' }, g);
      if (open) el('line', { x1: x - R, y1: y, x2: x + R, y2: y, class: 'ghost' }, g);
    }
    hw().crosslinks.forEach((link, index) => {
      const i = gapOf(link, rows);
      if (i < 0) return;
      const x = (X(i) + X(i + 1)) / 2, y = Y(i) + ROW / 2, on = sel.some((c) => c.kind === 'crosslinks' && c.index === index);
      el('line', { x1: x - R, y1: y, x2: x + R, y2: y, stroke: tint('crosslinks', link), 'stroke-width': 5, 'stroke-linecap': 'round', 'pointer-events': 'none' }, svg);
      if (on) el('rect', { x: x - R - 5, y: y - 6, width: 2 * R + 10, height: 12, rx: 6, class: 'ring', 'pointer-events': 'none' }, svg);
    });
    // the spots beside each vertebra
    rows.forEach((id, i) => {
      for (const side of ['left', 'right']) {
        const x = slotX(i, side), y = Y(i), part = partAt(id, side), from = rodFrom && rodFrom.side === side;
        // (a spot with a part is "full". While a rod is drawn, the part it starts from is "armed" and the parts it could run to are "mates".)
        const g = el('g', { 'data-slot': id + ':' + side, class: (part ? 'full' : 'bare') + (part && from ? (rodFrom.id === id ? ' armed' : ' mate') : '') }, svg);
        el('circle', { cx: x, cy: y, r: 13, class: 'hit' }, g);
        if (part) el('circle', { cx: x, cy: y, r: 13.5, class: 'halo' }, g);
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
    // with the rod tool, two parts that sit next to each other have a place between them to end the rod
    if (cutting) for (const side of ['left', 'right']) for (const g of gapsOf(app.spine, side)) {
      const a = rows.indexOf(g.upper), b = rows.indexOf(g.lower);
      if (g.bare || a < 0 || b < 0) continue;
      el('rect', { x: (slotX(a, side) + slotX(b, side)) / 2 - 10, y: (Y(a) + Y(b)) / 2 - 5, width: 20, height: 10, class: 'hit' }, el('g', { 'data-rodgap': side + ':' + g.upper + ':' + g.lower }, svg));
    }
    app.showGlow();
  }
  // what one tap, or one step of a drag over the map, does. "run" remembers what the first
  // gap of a drag was switched to, so the rest of the drag does the same.
  const live = (fn) => app.change(fn, { settle: false, ride: false });
  // A remark under the steps. While the pointer is down on the map it waits, so the map does not jump under the finger.
  let waiting = null;
  const usualSay = () => toolSays(mapTool);
  const tell = (text) => { if (painting) waiting = text; else $('traySay').textContent = text; };
  // The rods wait for the Rod tool: the first part put on a bare spine says so in the file.
  const rodsWait = () => { if (!hw().screws.length && !hw().hooks.length && !hw().rods.length) hw().norods = true; };
  //   run: the drag this belongs to, if it comes from the map (a remark is for a tap, not for a drag that passes by)
  function putOnSlot(id, side, run = null) {
    if (mapTool === 'none') return false;
    if (mapTool === 'rod') {
      // (a tap on a part starts or ends a rod there: that is done when the pointer lets go, see letGo)
      if (partAt(id, side)) return false;
      // a tap on a bare spot between two parts ends the rod in that stretch, or joins it again
      const list = ids(), i = list.indexOf(id), g = hw().norods ? null : gapsOf(app.spine, side).find((x) => list.indexOf(x.upper) < i && i < list.indexOf(x.lower));
      if (!g) { rodSays('A rod runs from part to part. Tap a screw or a hook.'); return false; }
      live(() => setRodCut(app.spine, side, g.upper, g.lower, !g.cut));
      rodSays(g.cut ? 'Joined: one rod runs from ' + g.upper + ' to ' + g.lower + ' again.' : 'The rod on the ' + side + ' side now ends between ' + g.upper + ' and ' + g.lower + '.');
      return true;
    }
    if (mapTool === 'link') { if (!(run && run.changed)) tell('A cross-link goes between two vertebrae: ' + press() + ' a dotted line.'); return false; }
    const want = mapTool === 'erase' ? '' : mapTool, [kind, faces] = want.split('-'), other = side === 'left' ? 'right' : 'left';
    if (id === 'C1') return false;
    // with "Both sides" on, the other side of the vertebra gets the same
    const sides = [side, ...(kit.both() && mapTool !== 'erase' ? [other] : [])].filter((sd) => carried(id, sd) !== want);
    if (!sides.length) return false;
    let done = false;
    live(() => { rodsWait(); for (const sd of sides) done = setCell(app.spine, id, sd, kind, faces || 'down', kit.look()) || done; });
    if (!done) tell('That part is frozen. Select it and untick "Frozen" to change it.');
    return done;
  }
  function putOnGap(id, run) {
    const list = ids();
    if (mapTool === 'none' || list.indexOf(id) < 0 || list.indexOf(id) >= list.length - 1) return false;
    if (mapTool === 'link' || mapTool === 'erase') {
      if (run.on === undefined) run.on = mapTool === 'link' && !linkBelow(app.spine, id);
      if (linkBelow(app.spine, id) === run.on) return false;
      let fits = true;
      live(() => { fits = setLinkBelow(app.spine, id, run.on, kit.linkLook()); });
      if (!fits) tell(NEEDS_RODS);
      return fits;
    }
    // (a drag down a curved map crosses the gaps between the round spots: it has said what it is for by then)
    if (!run.changed) tell('That goes on a dot beside a vertebra.');
    return false;
  }
  const spotUnder = (x, y) => { const e = document.elementFromPoint(x, y), g = e && e.closest ? e.closest('[data-slot],[data-gap],[data-rodgap]') : null; return g && $('map').contains(g) ? g : null; };
  function putOn(g, run) {
    const key = g.dataset.slot || g.dataset.rodgap || 'gap ' + g.dataset.gap;
    if (run.last === key) return;
    run.last = key;
    // (the rod tool acts once for each press: a drag over a bare stretch must not cut and join it again and again)
    if (mapTool === 'rod' && run.acted) return;
    run.acted = true;
    let did;
    if (g.dataset.rodgap) {
      const [side, upper, lower] = g.dataset.rodgap.split(':'), gap = gapsOf(app.spine, side).find((x) => x.upper === upper && x.lower === lower);
      did = !!gap;
      if (gap) { live(() => setRodCut(app.spine, side, upper, lower, !gap.cut)); rodSays(gap.cut ? 'Joined: one rod runs from ' + upper + ' to ' + lower + ' again.' : 'The rod on the ' + side + ' side now ends between ' + upper + ' and ' + lower + '.'); }
    }
    else did = g.dataset.slot ? putOnSlot(...g.dataset.slot.split(':'), run) : putOnGap(g.dataset.gap, run);
    if (did) { run.changed = true; drawMap(); }
  }
  // The part of the tray goes on the soft mark that was clicked, or on the side of the
  // vertebra that was clicked or dropped on, or into the gap nearest to that spot.
  //   hit: the vertebra under the pointer and the point on it (or null)    e: the pointer
  function putOnModel(hit, e) {
    const mark = e ? hintAt(e) : null, run = {};
    $('traySay').textContent = usualSay();
    if (mark && mark.slot) return putOnSlot(...mark.slot);
    if (mark && mark.gap) return putOnGap(mark.gap, run);
    if (!hit) return false;
    const id = hit.level.id, side = toLocal(hit.point, hit.level.centre, levelFrame(hit.level))[0] >= 0 ? 'left' : 'right';
    if (mapTool === 'rod') return false;
    if (mapTool !== 'link') return putOnSlot(id, side);
    const list = ids(), i = list.indexOf(id), up = hit.point[2] > hit.level.centre[2] && i > 0;
    return putOnGap(up ? list[i - 1] : id, run) || (mapTool === 'link' && i > 0 && putOnGap(up ? id : list[i - 1], run));
  }

  // ---- soft marks on the model: where a click puts the part of the tool in hand
  const STEP_COLORS = { screw: [0.78, 0.82, 0.9], 'hook-down': [0.72, 0.6, 0.95], 'hook-up': [0.72, 0.6, 0.95], link: [0.95, 0.76, 0.34], rod: [0.66, 0.84, 1] };
  let marks = [];                 // the marks that are shown now, each with the spot or gap it stands for
  function hints() {
    marks = [];
    if (!app.spine || (app.picked && app.picked.kind !== 'level')) return null;
    const dots = [], links = [], color = STEP_COLORS[mapTool], rows = mapRows();
    if (mapTool === 'screw' || mapTool === 'hook-down' || mapTool === 'hook-up') {
      const faces = mapTool === 'hook-up' ? 'up' : 'down';
      for (const id of rows) for (const side of ['left', 'right']) {
        if (id === 'C1' || partAt(id, side)) continue;
        const spot = slot(levelOf(id), side, faces), at = mapTool === 'screw' ? spot.screw.head : spot.hook.at;
        dots.push({ at, color, size: 1.25, opacity: 0.42 }); marks.push({ at, slot: [id, side] });
      }
    } else if (mapTool === 'link') {
      for (let i = 0; i < rows.length - 1; i++) {
        const link = linkBelow(app.spine, rows[i]) ? null : linkSpot(app.spine, rows[i]);
        if (!link) continue;
        links.push({ ...link, color, opacity: 0.5 }); marks.push({ from: link.from, to: link.to, gap: rows[i] });
      }
    } else if (mapTool === 'rod') {
      // every screw and hook can start a rod. Once one is picked, it glows and the parts of its side are the places to go.
      for (const p of [...hw().screws, ...hw().hooks]) {
        const at = p.head || p.at, armed = rodFrom && rodFrom.id === p.level && rodFrom.side === p.side;
        if (rodFrom && rodFrom.side !== p.side) continue;
        dots.push({ at, color: armed ? [1, 0.82, 0.3] : color, size: armed ? 3.3 : rodFrom ? 2.9 : 2.6, opacity: armed ? 0.8 : rodFrom ? 0.5 : 0.26 });
      }
    }
    return dots.length || links.length ? { dots, links } : null;
  }
  // The mark under the pointer, if the pointer is on one. A mark is as large as it is drawn,
  // with a little to spare: from far away the marks of neighbouring vertebrae are close
  // together, and a click on bone between them must go by the bone, not by a mark beside it.
  function hintAt(e) {
    const box = renderer.canvas.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top, least = e.pointerType === 'touch' ? 9 : 6;
    let best = null;
    for (const m of marks) {
      const reach = Math.max(least, Math.min(16, (m.at ? 4 : 3) / renderer.screenScale(m.at || m.from).perPixel + 2));
      let d;
      if (m.at) { const p = renderer.project(m.at); if (!p) continue; d = Math.hypot(p[0] - x, p[1] - y); }
      else {
        // (a cross-link that could be there: how far the pointer is from the line between its two ends)
        const a = renderer.project(m.from), b = renderer.project(m.to);
        if (!a || !b) continue;
        const len = Math.max(1, (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2), t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / len));
        d = Math.hypot(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - y);
      }
      if (d <= reach && (!best || d < best.d)) best = { ...m, d };
    }
    return best;
  }

  // ---- the rod tool: click two parts of one side and a rod runs between them
  const rodsOn = () => !hw().norods && hw().rods.length > 0;
  function rodSays(note) {
    if (note !== undefined) rodNote = note;
    const text = rodFrom ? rodFrom.id + ' on the ' + rodFrom.side + ' is one end. Now ' + press() + ' the part where the rod ends.' : rodNote || (parts().length < 2 ? 'A rod needs two parts on one side. Put on screws or hooks first.' : Press() + ' two parts on one side and a rod runs between them.');
    $('rodSay').textContent = text;
  }
  const again = () => { rodSays(); drawMap(); app.redraw(); };
  // A rod from one part to another. With "Both sides" on, the other side gets the same rod, between its own parts in that stretch.
  function connect(side, from, to) {
    const other = side === 'left' ? 'right' : 'left', list = ids(), a = Math.min(list.indexOf(from), list.indexOf(to)), b = Math.max(list.indexOf(from), list.indexOf(to));
    let both = false, traced = false;
    rodFrom = null;
    app.change(() => {
      // (rods that were traced from a scan are drawn again through the parts, so that they can be changed)
      if (hw().rods.some((r) => !r.auto)) { fitRods(app.spine, true); traced = true; }
      // the first rod drawn by hand: the other parts stay without one until theirs is drawn
      if (hw().norods) { cutAll(app.spine); delete hw().norods; }
      drawRod(app.spine, side, list[a], list[b]);
      const mates = kit.both() ? list.slice(a, b + 1).filter((id) => partAt(id, other)) : [];
      if (mates.length > 1) { drawRod(app.spine, other, mates[0], mates[mates.length - 1]); both = true; }
    }, { ride: false });
    rodSays('A rod now runs from ' + list[a] + ' to ' + list[b] + (both ? ' on both sides.' : ' on the ' + side + ' side.') + (traced ? ' The traced rods were drawn again through the parts.' : ''));
  }
  // A part was tapped with the rod tool: it starts a rod, or ends the one that was started.
  function rodPick(id, side) {
    if (!partAt(id, side)) return false;
    if (rodFrom && rodFrom.id === id && rodFrom.side === side) { rodFrom = null; again(); return true; }
    if (rodFrom && rodFrom.side === side) { connect(side, rodFrom.id, id); return true; }
    const crossed = !!rodFrom;
    rodFrom = { id, side }; rodNote = '';
    again();
    if (crossed) $('rodSay').textContent = 'A rod stays on one side. ' + $('rodSay').textContent;
    return true;
  }
  // A click on the model while the rod tool is in hand. True if the tool took the click.
  //   what: the part under the pointer ({ kind, index, at }) or null
  function rodTap(what) {
    if (mapTool !== 'rod' || !what) return false;
    if (what.kind === 'screws' || what.kind === 'hooks') { const p = hw()[what.kind][what.index]; return rodPick(p.level, p.side); }
    if (what.kind !== 'rods') return false;
    const rod = hw().rods[what.index];
    let cut = null;
    rodFrom = null;
    if (!rod.auto) { rodSays('This rod was traced from a scan. Click two parts to draw it again, or press "Rods through all parts".'); drawMap(); return true; }
    app.change(() => { cut = cutRodAt(app.spine, rod.side, what.at[2]); }, { ride: false });
    rodSays(cut ? 'The rod on the ' + rod.side + ' side now ends between ' + cut[0] + ' and ' + cut[1] + '. ' + Press() + ' those two parts to join it again.' : 'A rod can end between two of its parts: ' + press() + ' it there.');
    return true;
  }
  // Take a tool in hand: 'screw', 'hook-down', 'hook-up', 'link', 'rod', 'erase', or 'none' (a tap then selects).
  function setTool(name) {
    const was = mapTool;
    mapTool = name; rodFrom = null; if (name !== was) rodNote = '';
    if (app.spine) { $('traySay').textContent = toolSays(name); rodSays(); if (name !== was) { drawMap(); app.redraw(); } hint(); }
  }
  const parts = () => [...hw().screws, ...hw().hooks];
  const words = (sets) => sets.map(([a, b]) => a + ' to ' + b).join(sets.length === 2 ? ' and ' : ', ');
  // "Rods through all parts": a rod down each side through everything, the way most fusions are. Parts that are far apart get rods of their own.
  $('rodsPut').addEventListener('click', () => {
    if (parts().length < 2) { rodSays('A rod needs two parts on one side. Put on screws or hooks first.'); return; }
    rodFrom = null;
    app.change(() => rodsThroughAll(app.spine), { ride: false });
    const sets = rodSets(app.spine);
    rodSays(!hw().rods.length ? 'No side has two parts to hold a rod yet.' : sets.length > 1 ? 'Parts that are far apart got rods of their own: ' + words(sets) + '.' : 'The rods are on: one through all the parts of each side.');
  });
  $('rodsOff').addEventListener('click', () => {
    rodFrom = null;
    app.change(() => { hw().norods = true; delete hw().splits; fitRods(app.spine); }, { ride: false });
    rodSays('The rods are off. The screws and hooks stay.');
  });
  // the stretches the rods span are fused, so they keep their shape: one switch for all of them
  const allFused = (sets) => { const list = ids(); return sets.length > 0 && sets.every(([a, b]) => list.slice(list.indexOf(a), list.indexOf(b)).every((id) => fusedBelow(app.spine, id))); };
  $('rodFused').addEventListener('click', () => {
    const sets = rodSets(app.spine), list = ids(), on = !allFused(sets);
    if (sets.length) app.change(() => { for (const [a, b] of sets) for (let i = list.indexOf(a); i < list.indexOf(b); i++) setFusedBelow(app.spine, list[i], on); }, { ride: false });
    rodSays(on ? 'The part the rods span is fused now: it keeps its shape when the rest is bent.' : 'Not fused: the rods bend with the spine.');
  });
  $('map').addEventListener('pointerdown', (e) => {
    const g = spotUnder(e.clientX, e.clientY);
    // (a press on a block of the map lights up that vertebra on the model. With no tool in hand it also selects it.)
    if (!g && app.spine && e.target.dataset && e.target.dataset.bone) { app.flash(e.target.dataset.bone, true); if (mapTool === 'none') app.pick({ kind: 'level', id: e.target.dataset.bone }); }
    if (!g || !app.spine) return;
    e.preventDefault(); app.say('');
    painting = { first: g }; waiting = null;
    putOn(g, painting);
  });
  window.addEventListener('pointermove', (e) => { if (painting) { const g = spotUnder(e.clientX, e.clientY); if (g) putOn(g, painting); } });
  const letGo = (e) => {
    if (painting) {
      const run = painting, slot = run.first.dataset.slot;
      painting = null;
      $('traySay').textContent = waiting !== null ? waiting : usualSay(); waiting = null;
      // the rod tool: a tap on a part starts a rod there or ends it there, and a drag from one part to another of the same side draws the rod in one go
      const end = mapTool === 'rod' && slot && e.type === 'pointerup' && partAt(...slot.split(':')) ? spotUnder(e.clientX, e.clientY) : null, to = end && end.dataset.slot;
      if (to === slot) { rodPick(...slot.split(':')); return; }
      if (to && to.split(':')[1] === slot.split(':')[1] && partAt(...to.split(':'))) { connect(slot.split(':')[1], slot.split(':')[0], to.split(':')[0]); return; }
      if (run.changed) app.settle();
      // a tap on a part that was not changed selects that part
      else if (slot && run.last === slot && e.type === 'pointerup' && mapTool !== 'rod') { const part = partAt(...slot.split(':')); if (part) pickPart(part, false); }
    }
  };
  window.addEventListener('pointerup', letGo); window.addEventListener('pointercancel', letGo);
  $('mapNeck').addEventListener('change', () => { drawMap(); app.redraw(); });
  // (the map is sized to its place beside the model: draw it again when that place changes)
  if (window.ResizeObserver) new ResizeObserver(() => { if (app.spine && !$('strip').hidden) drawMap(); }).observe($('strip'));
  // pointing at a block or a spot of the map shows which bone it is on the model
  $('map').addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' || painting) return; const g = e.target.closest ? e.target.closest('[data-slot]') : null; app.point((e.target.dataset && e.target.dataset.bone) || (g ? g.dataset.slot.split(':')[0] : null)); });
  $('map').addEventListener('pointerleave', () => app.point(null));

  // ---------------------------------------------------------------- colours
  // The colour of each kind of part is kept in the spine file, so it travels with a saved
  // file and with a link.
  const colorNow = (kind) => (hw().colors || {})[kind] || USUAL_FINISH[kind];
  function setColors(colors) { app.change(() => { hw().colors = { ...(hw().colors || {}), ...colors }; }, { ride: false }); }
  const kindColor = (kind) => (colorOf(colorNow(kind)) ? colorNow(kind) : '');
  // (the sets of colours are picked on the Look card: build.js. This says which set is on, if one is.)
  const paletteNow = () => Object.keys(PALETTES).find((name) => KINDS.every(([kind]) => colorNow(kind) === PALETTES[name][kind])) || '';

  function sync() {
    const list = ids();
    if (guideFor !== list.join()) {
      // a new spine: offer its fused stretch as the place for the hardware, or the usual T4 to L2
      guideFor = list.join(); rodFrom = null; rodNote = '';
      const fused = (app.spine.fused || [])[0], all = list.filter((id) => id !== 'C1').map((id) => [id, id]);
      options($('gTop'), all, fused ? fused[0] : list.includes('T4') ? 'T4' : all[0][0]);
      options($('gBottom'), all, fused ? fused[1] : list.includes('L2') ? 'L2' : all[all.length - 1][0]);
    }
    // (a rod that was being drawn is dropped if its first part is gone)
    if (rodFrom && !partAt(rodFrom.id, rodFrom.side)) rodFrom = null;
    const on = rodsOn(), sets = on ? rodSets(app.spine) : [];
    $('rodsOff').hidden = !on; $('rodsPut').classList.toggle('main', !on); $('rodsPut').textContent = on ? 'Through all parts' : 'Rods through all parts';
    $('rodFused').hidden = !sets.length; $('rodFused').setAttribute('aria-pressed', allFused(sets) ? 'true' : 'false');
    $('traySay').textContent = toolSays(mapTool); rodSays();
    pressed('[data-gkind]', 'gkind', guide.kind); pressed('[data-glinks]', 'glinks', guide.links);
    // the card of one vertebra: what it carries on each side, and what is in the gap below it
    const id = app.picked && app.picked.kind === 'level' ? app.picked.id : null, last = id === list[list.length - 1];
    if (id) {
      $('gName').textContent = id;
      each('[data-gside]', (row) => { row.parentElement.hidden = id === 'C1'; row.querySelectorAll('[data-gput]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gput === carried(id, row.dataset.gside) ? 'true' : 'false')); });
      $('gFusedRow').hidden = $('gLinkRow').hidden = last;
      $('gFused').checked = fusedBelow(app.spine, id); $('gLink').checked = linkBelow(app.spine, id);
    }
    drawMap();
  }

  return { sync, tap, draw, putOnModel, hints, rodTap, setTool,
    // for the keyboard: the part on one side of a vertebra, the tool in hand used on that side or on the gap below, a rod started or ended there
    partAt, rodPick, put: (id, side) => { $('traySay').textContent = usualSay(); return putOnSlot(id, side); }, putGap: (id) => putOnGap(id, {}), markAt: (e) => !!hintAt(e), rodding: () => mapTool === 'rod', opened: () => { guideFor = ''; }, tool: () => mapTool, kindColor, setKindColor: (kind, name) => setColors({ [kind]: name }), paletteNow, picking: () => !!guide.picking, startDrawing: (plane = lastPlane) => setDrawing(plane), stopDrawing: () => { if (drawing !== null) setDrawing(null); }, stopPicking: () => { if (guide.picking) setPicking(0); } };
}
