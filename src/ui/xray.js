// The X-ray tool: lay a picture of an X-ray over the model, or beside it, trace the line of
// the spine on it, and have the model take that shape. After that every other tool works as
// before, with the picture still there to check against.
//
// The picture is read by the browser from a file the person picks. It is kept in memory
// only: it is not part of the sketch, so it is not in a saved file, not in a link and not
// in a saved picture. Nothing here looks for anything in the picture. The person traces,
// the model follows.
//
// One picture can be open for each of the two flat views: seen from the back and seen from
// the side. All the working out is in core/trace.js. build.js decides when this tool is in
// hand and passes the presses on the model in here.

import { sheetOf, pictureOf, inSpace, depthOf, cornersOf, firstPlace, placeAbout, ordered, lineOfTrace, fitTrace, followTrace, spotsAlong, tonePicture, quadMatrix, USUAL_TONE } from '../core/trace.js';

// the longest side of the picture as it is kept, in pixels: enough to trace on, quick to repaint
const MOST = 1600;
// how a picture starts out: a little see-through and with the darkest black let go, so the model shows through it
const FIRST_TONE = { ...USUAL_TONE, cut: 12, solid: 70 };
const NS = 'http://www.w3.org/2000/svg';

// kit: the helpers of build.js that are needed here ($, each, pressed, options, ids, hint, touch, held(): the locked vertebrae, changed(): bring the page up to date)
export function setupXray(app, kit) {
  const { $, each, pressed, options, ids, hint, touch } = kit, { renderer } = app;
  const shots = [null, null];          // the picture of each flat view, or null
  // the picture starts beside the model: that is where it is traced most easily. Over the model is for lining the two up.
  let plane = 0, inHand = false, show = 'side', mode = 'trace';
  let stroke = null, grabbed = null, moving = null, picked = -1, busy = false, paintSoon = null, told = '';
  const shot = () => shots[plane];
  const Press = () => (touch() ? 'Tap' : 'Click');
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  // ---------------------------------------------------------------- opening a picture
  function open(file) {
    if (!file) return;
    const url = URL.createObjectURL(file), img = new Image();
    const fail = () => { URL.revokeObjectURL(url); say('That file could not be read as a picture. Save the X-ray as a JPG or PNG, or take a photo of it.'); };
    img.onload = () => { URL.revokeObjectURL(url); if (img.naturalWidth > 1 && img.naturalHeight > 1) take(img); else fail(); };
    img.onerror = fail;
    img.src = url;
  }
  // Keep the picture as shades of grey, no larger than it has to be.
  function take(img) {
    const k = Math.min(1, MOST / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(2, Math.round(img.naturalWidth * k)), h = Math.max(2, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h), grey = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < grey.length; i++, j += 4) grey[i] = (data.data[j] * 77 + data.data[j + 1] * 150 + data.data[j + 2] * 29) >> 8;
    // A film on a light box has a dark edge and a print on paper a light one. With a light edge the bone is most
    // likely dark, and the picture starts with light and dark swapped. The box in the card swaps them back.
    let edge = 0, n = 0;
    for (let x = 0; x < w; x += 4) { edge += grey[x] + grey[(h - 1) * w + x]; n += 2; }
    for (let y = 0; y < h; y += 4) { edge += grey[y * w] + grey[y * w + w - 1]; n += 2; }
    const place = firstPlace(app.spine, plane, [w, h]), list = ids();
    shots[plane] = { size: [w, h], grey, canvas, g, data, tone: { ...FIRST_TONE, invert: edge / n > 150 }, place, base: place.k, points: [], fitted: false,
      top: list.includes('T1') ? 'T1' : list[0], bottom: list.includes('L5') ? 'L5' : list[list.length - 1] };
    picked = -1; mode = 'trace'; if (show === 'off') show = 'side';
    paint();
    renderer.look(plane === 0 ? 0 : Math.PI / 2);
    say('');
    kit.changed();
  }
  // Paint the picture again with its settings (at most once for every frame that is drawn).
  function paint() {
    if (paintSoon) return;
    paintSoon = requestAnimationFrame(() => {
      paintSoon = null;
      for (const s of shots) if (s && s.stale !== false) { tonePicture(s.grey, s.data.data, s.tone); s.g.putImageData(s.data, 0, 0); s.stale = false; }
    });
  }
  const repaint = () => { const s = shot(); if (s) { s.stale = true; paint(); } };

  // ---------------------------------------------------------------- where things are on screen
  const beside = () => show === 'side' && !!shot();
  const over = () => show === 'over' && !!shot();
  // the spot of the sheet under the pointer: [across, up] in mm
  function sheetAt(e) {
    const ray = renderer.ray(e.clientX, e.clientY), j = plane === 0 ? 1 : 0, a = plane === 0 ? 0 : 1;
    if (Math.abs(ray.direction[j]) < 0.08) return null;
    const t = (depthOf(app.spine, plane) - ray.origin[j]) / ray.direction[j];
    return t > 0 ? [ray.origin[a] + ray.direction[a] * t, ray.origin[2] + ray.direction[2] * t] : null;
  }
  // The picture beside the model fills its box as far as it can without being cut: where it lies in the box.
  function fitBox() {
    const s = shot(), box = $('xrayWrap').getBoundingClientRect(), k = Math.min(box.width / s.size[0], box.height / s.size[1]);
    return { left: box.left + (box.width - s.size[0] * k) / 2, top: box.top + (box.height - s.size[1] * k) / 2, k, box };
  }
  // the spot of the picture under the pointer, in its pixels (null when the pointer is not over the sheet)
  function pixelAt(e) {
    const s = shot();
    // (beside the model a picture whose left and right are swapped is shown the other way round, so that it faces the way the model does)
    if (beside()) { const f = fitBox(), u = (e.clientX - f.left) / f.k; return [s.place.flip ? s.size[0] - u : u, (e.clientY - f.top) / f.k]; }
    const at = sheetAt(e);
    return at ? pictureOf(s.place, s.size, at) : null;
  }
  const inPicture = (px, s) => px && px[0] >= 0 && px[1] >= 0 && px[0] <= s.size[0] && px[1] <= s.size[1];
  // where a spot of the picture is drawn, in pixels of the box its marks are drawn in
  function onScreen(px) {
    const s = shot();
    if (beside()) { const f = fitBox(); return [f.left - f.box.left + (s.place.flip ? s.size[0] - px[0] : px[0]) * f.k, f.top - f.box.top + px[1] * f.k]; }
    return renderer.project(inSpace(plane, depthOf(app.spine, plane), sheetOf(s.place, s.size, px)));
  }

  // Lay the picture over the model and draw the trace. This runs after every frame, so the picture turns with the model.
  function lay() {
    const s = shot(), sheet = $('xrayOver'), marks = $('xrayMarks'), sideMarks = $('xraySvg');
    const home = beside() ? $('xrayWrap') : over() ? sheet : null;
    // the one picture that is open sits in the box it is shown in
    for (const other of shots) if (other && other !== s && other.canvas.parentElement) other.canvas.remove();
    if (s && home && s.canvas.parentElement !== home) home.insertBefore(s.canvas, home.firstChild);
    if (s && !home && s.canvas.parentElement) s.canvas.remove();
    if (s) s.canvas.style.transform = beside() && s.place.flip ? 'scaleX(-1)' : '';
    let matrix = null;
    if (over()) {
      const quad = cornersOf(s.place, s.size, depthOf(app.spine, plane)).map((p) => renderer.project(p));
      matrix = quad.every(Boolean) ? quadMatrix(s.size[0], s.size[1], quad) : null;
      if (matrix) { sheet.style.width = s.size[0] + 'px'; sheet.style.height = s.size[1] + 'px'; sheet.style.transform = 'matrix3d(' + matrix.map((v) => +v.toFixed(8)).join(',') + ')'; }
    }
    sheet.hidden = !matrix;
    // (the marks are drawings, which have no "hidden" of their own to set: the word is put on them and taken off)
    // the trace shows while the tool is in hand
    const live = inHand && !!s && (beside() || !!matrix);
    marks.toggleAttribute('hidden', !(live && over())); sideMarks.style.visibility = live && beside() ? '' : 'hidden';
    if (!live) return;
    const svg = beside() ? sideMarks : marks, at = (px) => { const p = onScreen(px); return p ? p[0].toFixed(1) + ',' + p[1].toFixed(1) : null; };
    const line = s.points.length > 1 ? lineOfTrace(s.place, s.size, s.points).map((spot) => at(pictureOf(s.place, s.size, spot))).filter(Boolean).join(' ') : '';
    svg.querySelector('.xpath').setAttribute('points', line);
    svg.querySelector('.xstroke').setAttribute('points', stroke ? stroke.px.map(at).filter(Boolean).join(' ') : '');
    const dots = svg.querySelector('.xdots');
    while (dots.childNodes.length > s.points.length) dots.lastChild.remove();
    s.points.forEach((px, i) => {
      const c = dots.childNodes[i] || el('circle', { r: 11 }, dots), q = onScreen(px);
      c.dataset.spot = i; c.setAttribute('class', i === picked ? 'picked' : '');
      c.style.display = q ? '' : 'none';
      if (q) { c.setAttribute('cx', q[0].toFixed(1)); c.setAttribute('cy', q[1].toFixed(1)); }
    });
  }
  app.frames.push(lay);
  const redraw = () => { lay(); renderer.requestDraw(); };

  // ---------------------------------------------------------------- the trace
  const held = () => kit.held();
  // the spine takes the shape of the trace where the picture lies now (once it was fitted)
  function follow(settle) {
    const s = shot();
    if (!s || !s.fitted || s.points.length < 2) { redraw(); return; }
    app.change(() => followTrace(app.spine, app.rig, s.place, s.size, s.points, { held: held() }), { settle });
  }
  // The trace is new or longer: after a fit the spine follows it at once.
  function traced() {
    const s = shot();
    if (s.fitted && s.points.length > 1) follow(true); else redraw();
    kit.changed();
  }
  function fit() {
    const s = shot();
    if (!s) return;
    if (s.points.length < 2) { say('Trace the spine on the picture first: drag a line up it, or ' + Press().toLowerCase() + ' a few spots along it.'); return; }
    const list = ids(), a = list.indexOf(s.top), b = list.indexOf(s.bottom);
    if (a < 0 || b < 0 || a === b) { say('Choose two different vertebrae for the two ends of the trace.'); return; }
    // (the two ends in either order: the higher one is the top)
    const top = list[Math.min(a, b)], bottom = list[Math.max(a, b)];
    let got = null;
    app.change(() => { got = fitTrace(app.spine, app.rig, s.place, s.size, s.points, top, bottom, { held: held() }); });
    if (!got) { say('That trace is too short to fit. Trace a longer stretch of the spine.'); return; }
    s.place = got.place; s.base = s.place.k; s.fitted = true; s.top = top; s.bottom = bottom;
    renderer.look(plane === 0 ? 0 : Math.PI / 2);
    say('The spine lies along your trace from ' + bottom + ' up to ' + top + '.' + (got.miss > 12 ? ' The top of the trace ends a little away from ' + top + '. Check the two vertebrae, or drag the spots.' : ' Drag a spot to change it, or shape it by hand with any other tool.'));
    kit.changed();
  }
  function removeSpot(i) {
    const s = shot();
    if (!s || i < 0 || i >= s.points.length) return;
    s.points.splice(i, 1); picked = -1;
    if (s.points.length < 2) s.fitted = false;
    traced();
  }
  function clear() { const s = shot(); if (!s) return; s.points = []; s.fitted = false; picked = -1; say(''); redraw(); kit.changed(); }

  // What a press does while the tool is in hand. The model passes its presses in here (see build.js), and the picture
  // beside the model has listeners of its own below. A press that hardly moves is a tap: it puts one more spot down.
  const begin = (e) => {
    const s = shot(), px = pixelAt(e);
    if (mode === 'move' && over()) { const at = sheetAt(e); if (!at) return false; moving = { at }; busy = true; return true; }
    if (!px) return false;
    stroke = { px: [px], far: 0, x: e.clientX, y: e.clientY, inside: inPicture(px, s) };
    busy = true;
    return true;
  };
  const drag = (e) => {
    const s = shot();
    if (!s) return;
    if (moving) {
      const at = sheetAt(e);
      if (!at) return;
      s.place = { ...s.place, at: [s.place.at[0] + at[0] - moving.at[0], s.place.at[1] + at[1] - moving.at[1]] };
      moving.at = at;
      redraw(); return;
    }
    if (!stroke) return;
    const px = pixelAt(e);
    stroke.far = Math.max(stroke.far, Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y));
    if (px) stroke.px.push(px);
    redraw();
  };
  const end = () => {
    const s = shot(), was = stroke, moved = moving;
    stroke = null; moving = null; busy = false;
    if (moved) { if (s) s.place.at = s.place.at.map((v) => Math.round(v * 100) / 100); redraw(); return; }
    if (!was || !s) { redraw(); return; }
    if (was.far < 6) {
      // a tap: one more spot, where it was tapped
      if (!was.inside) { say(Press() + ' on the picture.'); redraw(); return; }
      s.points.push(was.px[0]); picked = s.points.length - 1;
    } else {
      const inside = was.px.filter((px) => inPicture(px, s));
      if (inside.length < 4) { redraw(); return; }
      // a line drawn by hand takes the place of the trace that was there
      s.points = spotsAlong(inside, 8); picked = -1;
    }
    say(s.fitted ? '' : s.points.length > 1 ? 'Now say which vertebrae the trace runs between, and fit the spine to it.' : 'One spot is down. ' + Press() + ' more spots up the spine, or drag a line.');
    traced();
  };
  const cancel = () => { stroke = null; moving = null; busy = false; redraw(); };

  // Dragging a spot of the trace, on the model or on the picture beside it.
  for (const id of ['xrayMarks', 'xraySvg']) {
    $(id).addEventListener('pointerdown', (e) => {
      const s = shot(), i = e.target.dataset && e.target.dataset.spot !== undefined ? Number(e.target.dataset.spot) : -1;
      if (!s || !inHand) return;
      if (i >= 0) { e.preventDefault(); e.stopPropagation(); picked = i; grabbed = { i, moved: false }; redraw(); kit.changed(); return; }
      // (beside the model the picture takes its own presses: a drag draws, a tap puts a spot down)
      if (id === 'xraySvg' && e.button === 0) { e.preventDefault(); begin(e); }
    });
    $(id).addEventListener('dblclick', (e) => { if (e.target.dataset && e.target.dataset.spot !== undefined) removeSpot(Number(e.target.dataset.spot)); });
  }
  window.addEventListener('pointermove', (e) => {
    const s = shot();
    if (grabbed && s) {
      const px = pixelAt(e);
      if (!px) return;
      s.points[grabbed.i] = [Math.max(0, Math.min(s.size[0], px[0])), Math.max(0, Math.min(s.size[1], px[1]))];
      grabbed.moved = true;
      follow(false); lay();
    } else if (busy && beside()) drag(e);
  });
  const letGo = () => {
    if (grabbed) { const moved = grabbed.moved; grabbed = null; if (moved && shot() && shot().fitted) app.settle(); redraw(); kit.changed(); }
    else if (busy && beside()) end();
  };
  window.addEventListener('pointerup', letGo); window.addEventListener('pointercancel', () => { if (grabbed) letGo(); else if (busy && beside()) cancel(); });

  // ---------------------------------------------------------------- the card
  function say(text) { told = text || ''; $('xraySay').textContent = told; hint(); }
  $('xrayPick').addEventListener('click', () => $('xrayFile').click());
  $('xrayFile').addEventListener('change', () => { open($('xrayFile').files[0]); $('xrayFile').value = ''; });
  each('[data-xplane]', (b) => b.addEventListener('click', () => { plane = Number(b.dataset.xplane); picked = -1; renderer.look(plane === 0 ? 0 : Math.PI / 2); say(''); kit.changed(); }));
  each('[data-xshow]', (b) => b.addEventListener('click', () => { show = b.dataset.xshow; if (show !== 'over') mode = 'trace'; kit.changed(); }));
  // (the picture is moved where it lies over the model: Move X-ray brings it there)
  each('[data-xmode]', (b) => b.addEventListener('click', () => { mode = b.dataset.xmode; if (mode === 'move' && show !== 'over') { show = 'over'; renderer.look(plane === 0 ? 0 : Math.PI / 2); } kit.changed(); }));
  $('xrayTop').addEventListener('change', () => { const s = shot(); if (s) s.top = $('xrayTop').value; });
  $('xrayBottom').addEventListener('change', () => { const s = shot(); if (s) s.bottom = $('xrayBottom').value; });
  $('xrayFit').addEventListener('click', fit);
  $('xrayClear').addEventListener('click', clear);
  $('xrayPointGone').addEventListener('click', () => removeSpot(picked));
  // how the picture is shown
  const TONES = [['xBright', 'bright'], ['xContrast', 'contrast'], ['xCut', 'cut'], ['xSolid', 'solid']];
  for (const [id, key] of TONES) $(id).addEventListener('input', () => { const s = shot(); if (s) { s.tone[key] = Number($(id).value); repaint(); } });
  $('xInvert').addEventListener('change', () => { const s = shot(); if (s) { s.tone.invert = $('xInvert').checked; repaint(); } });
  $('xToneReset').addEventListener('click', () => { const s = shot(); if (s) { s.tone = { ...USUAL_TONE, invert: s.tone.invert }; repaint(); sync(); } });
  // The size and the turn of the picture are changed about the bottom of the trace, which stays where it is. With no trace it is the middle of the picture.
  const anchor = (s) => (s.points.length ? ordered(s.place, s.size, s.points)[0].px : [s.size[0] / 2, s.size[1] / 2]);
  $('xSize').addEventListener('input', () => { const s = shot(); if (s) { s.place = placeAbout(s.place, s.size, anchor(s), { k: (s.base * Number($('xSize').value)) / 100 }); placeSays(); redraw(); } });
  $('xTurn').addEventListener('input', () => { const s = shot(); if (s) { s.place = placeAbout(s.place, s.size, anchor(s), { turn: Number($('xTurn').value) }); placeSays(); redraw(); } });
  // Flipped left to right: the picture is turned over about the bottom of the trace, and the trace with it. After a fit the spine follows.
  $('xFlip').addEventListener('click', () => { const s = shot(); if (!s) return; s.place = placeAbout(s.place, s.size, anchor(s), { flip: !s.place.flip }); say(s.place.flip ? 'Flipped: the left of the picture is now on the right.' : 'The picture is the way round it was opened.'); if (s.fitted) follow(true); kit.changed(); redraw(); });
  // Back on the spine: the bottom of the trace on its vertebra, or with no trace the picture upright over the whole spine.
  $('xrayBack').addEventListener('click', () => {
    const s = shot();
    if (!s) return;
    if (s.points.length) {
      const l = app.spine.levels.find((x) => x.id === s.bottom) || app.spine.levels[app.spine.levels.length - 1], low = ordered(s.place, s.size, s.points)[0].at, a = plane === 0 ? 0 : 1;
      s.place = { ...s.place, at: [s.place.at[0] + l.centre[a] - low[0], s.place.at[1] + l.centre[2] - low[1]] };
    } else { const first = firstPlace(app.spine, plane, s.size); s.place = { ...first, flip: s.place.flip }; s.base = first.k; }
    renderer.look(plane === 0 ? 0 : Math.PI / 2);
    sync(); redraw();
  });
  $('xrayRemove').addEventListener('click', () => { const s = shot(); if (!s) return; if (s.canvas.parentElement) s.canvas.remove(); shots[plane] = null; picked = -1; say(''); kit.changed(); redraw(); });
  function placeSays() {
    const s = shot();
    if (!s) return;
    const size = Math.round((s.place.k / s.base) * 100), turn = s.place.turn;
    $('xSizeSay').textContent = size + '%'; $('xTurnSay').textContent = Math.abs(turn) < 0.25 ? 'upright' : Math.abs(turn) + '° ' + (turn > 0 ? 'clockwise' : 'the other way');
    $('xSize').setAttribute('aria-valuetext', $('xSizeSay').textContent); $('xTurn').setAttribute('aria-valuetext', $('xTurnSay').textContent);
  }

  // The line of help over the model while this tool is in hand.
  function says() {
    const s = shot();
    if (!s) return 'Choose a picture of an X-ray to trace over. It stays on this device.';
    // (what was just done is said in the card, under its buttons. This line says what a press does next.)
    if (show === 'off') return 'The picture is hidden. Show it over the model or beside it to trace on it.';
    if (mode === 'move') return 'Drag to move the picture. Its turn is under X-ray position, its size under X-ray adjustment.';
    if (s.fitted) return 'Drag a spot and the spine follows. Any other tool shapes it by hand.';
    if (s.points.length > 1) return 'Say which vertebrae the trace runs between, then fit the spine to it.';
    return 'Drag a line up the spine on the picture' + (beside() ? ' beside the model' : '') + ', or ' + Press().toLowerCase() + ' spots along it.';
  }

  // on a wide screen the two groups of settings stand open, on a phone they open when asked for
  if (window.matchMedia('(min-width: 900px) and (min-height: 560px)').matches) { $('xrayPlace').open = true; $('xrayTone').open = true; }
  function sync() {
    const s = shot(), list = ids();
    pressed('[data-xplane]', 'xplane', plane);
    $('xrayPick').textContent = s ? 'Another picture' : 'Choose a picture';
    $('xrayPick').classList.toggle('main', !s); $('xrayRemove').hidden = !s;
    // the two tools float over the model while the X-ray tool is in hand and a picture is to be seen
    $('xrayBar').hidden = !(inHand && s && show !== 'off');
    $('xrayNone').hidden = !!s; $('xrayOn').hidden = !s;
    // with a picture open, the choice of picture sits at the foot of the card, under "Picture", so the buttons used while tracing stay in view
    const which = $('xrayWhich'), under = !!s;
    if (under !== (which.parentElement === $('xrayPicHome'))) { if (under) $('xrayPicHome').appendChild(which); else $('xrayFile').before(which); }
    $('stage').classList.toggle('tracing', inHand && over() && mode === 'trace');
    $('stage').classList.toggle('moving', inHand && over() && mode === 'move');
    if (!s) { lay(); return; }
    // (a spine that was opened since may not have the vertebrae that were chosen)
    if (!list.includes(s.top)) s.top = list[0];
    if (!list.includes(s.bottom)) s.bottom = list[list.length - 1];
    pressed('[data-xshow]', 'xshow', show); pressed('[data-xmode]', 'xmode', mode);
    $('xrayEnds').hidden = $('xrayFit').parentElement.hidden = show === 'off';
    options($('xrayTop'), list.map((id) => [id, id]), s.top); options($('xrayBottom'), list.map((id) => [id, id]), s.bottom);
    $('xrayFit').disabled = s.points.length < 2; $('xrayFit').textContent = s.fitted ? 'Fit it again' : 'Fit the spine to the trace';
    $('xrayClear').disabled = !s.points.length;
    $('xrayPointGone').hidden = picked < 0 || picked >= s.points.length;
    $('xraySay').textContent = told;
    for (const [id, key] of TONES) $(id).value = s.tone[key];
    $('xInvert').checked = !!s.tone.invert; $('xFlip').setAttribute('aria-pressed', s.place.flip ? 'true' : 'false');
    $('xSize').value = Math.max(30, Math.min(300, Math.round((s.place.k / s.base) * 100))); $('xTurn').value = s.place.turn;
    placeSays();
    lay();
  }

  return {
    sync, says, open,
    // the tool is taken in hand, or put down. The picture stays where it is either way.
    start() { inHand = true; if (shot()) renderer.look(plane === 0 ? 0 : Math.PI / 2); },
    stop() { if (!inHand) return; inHand = false; stroke = null; moving = null; grabbed = null; busy = false; told = ''; $('xraySay').textContent = ''; },
    // is the picture shown beside the model (in the flat view next to it)?
    beside,
    // does a press on the model belong to this tool right now?
    takes: () => inHand && over(),
    busy: () => busy,
    down: begin, move: drag, up: end, cancel,
    // a tap on the model that the tool did not take
    tap() { say(shot() ? (show === 'side' ? 'Trace on the picture beside the model.' : 'The picture is hidden. Show it to trace on it.') : 'Choose a picture of an X-ray first.'); },
    // the spine on screen is another one, or was changed from outside: the picture lies where it lay
    refresh: redraw,
    // where things stand (the checks in a browser use this)
    state: () => { const s = shot(); return { inHand, plane, show, mode, has: shots.map(Boolean), spots: s ? s.points.map((p) => p.slice()) : [], fitted: !!(s && s.fitted), place: s ? { ...s.place } : null, tone: s ? { ...s.tone } : null, size: s ? s.size.slice() : null, picked }; },
    // where a spot of the picture is on the page, and the other way round (the checks in a browser use these)
    pageOf(px) { const p = shot() && onScreen(px), box = (beside() ? $('xrayWrap') : renderer.canvas).getBoundingClientRect(); return p ? [p[0] + box.left, p[1] + box.top] : null; },
    pixelOf(clientX, clientY) { return shot() ? pixelAt({ clientX, clientY }) : null; },
  };
}
