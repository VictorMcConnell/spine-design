// The story of a sketch: its steps (before, after, and whatever lies between), each with a few
// words, and the ways to show them: one after the other, two side by side, or one blending
// into the other. Also the two ways to take a story out of the app: a moving picture and a
// page to print. The steps themselves are kept by core/story.js.

import { stepCount, stepHere, captionOf, stepSpine, addStep, goStep, removeStep, moveStep, setCaption, blend } from '../core/story.js';
import { MOST_STEPS } from '../core/spinefile.js';
import { gifOf } from '../io/gif.js';

export function setupStory(app, kit) {
  const { $ } = kit, renderer = app.renderer;
  const each = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  // compare: 'off', 'side' (two steps side by side) or 'blend' (one step blending into another)
  // from, to: the two steps that are compared.  mix: how far the blend is, from 0 to 1
  let compare = 'off', from = 0, to = 1, mix = 0;
  let moving = null;                   // what is in motion: { stop } (a step opening, the steps playing, the blend playing)
  let playing = false, listFor = '', making = false;
  const count = () => (app.spine ? stepCount(app.spine) : 1), here = () => stepHere(app.spine);
  const inTab = () => document.body.dataset.at === 'story';
  const ease = (x) => x * x * (3 - 2 * x);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const say = (text) => { $('storySay').textContent = text || ''; };

  // ---------------------------------------------------------------- what is drawn
  function show() {
    app.shown = null; app.pair = null;
    if (count() > 1 && inTab() && compare !== 'off') {
      from = Math.min(from, count() - 1); to = Math.min(to, count() - 1);
      const a = stepSpine(app.spine, from), b = stepSpine(app.spine, to);
      if (compare === 'side') app.pair = { a, b }; else app.shown = blend(a, b, mix);
    }
    app.redraw();
  }
  function stop() { if (moving) { const m = moving; moving = null; m.stop(); } }
  // Run something over a stretch of time: "draw" gets how far it is, from 0 to 1. Resolves to false if it was stopped.
  function run(ms, draw) {
    return new Promise((done) => {
      const start = performance.now();
      let live = true;
      moving = { stop: () => { live = false; done(false); } };
      const tick = (now) => {
        if (!live) return;
        const x = Math.min(1, (now - start) / ms);
        draw(x);
        if (x < 1) requestAnimationFrame(tick); else { moving = null; done(true); }
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------------------------------------------------------------- opening a step
  // The spine goes over into the other step, and then that step is the open one.
  async function open(to_, smooth = true) {
    if (!app.spine || to_ === here() || to_ < 0 || to_ >= count()) return false;
    stop(); say('');
    if (compare !== 'off') { compare = 'off'; }
    const a = app.spine, b = stepSpine(app.spine, to_);
    if (smooth && !calm.matches) {
      const ok = await run(650, (x) => { app.shown = blend(a, b, ease(x)); app.pair = null; app.redraw(); });
      if (!ok) { show(); return false; }
    }
    app.shown = null; app.pair = null;
    app.reopen(() => goStep(app.spine, to_));
    return true;
  }
  // Play the steps one after the other, from the open one to the last (from the first, when the last is open).
  async function play() {
    if (playing) { playing = false; stop(); sync(); return; }
    if (count() < 2) return;
    playing = true; sync();
    if (here() === count() - 1) { await open(0); if (playing) await hold(900); }
    while (playing && here() < count() - 1) {
      if (!(await open(here() + 1))) break;
      if (playing && here() < count() - 1) await hold(1500);
    }
    playing = false; sync();
  }
  const hold = (ms) => run(ms, () => {});

  // ---------------------------------------------------------------- the card
  function buildList() {
    const box = $('stepList'), n = count(), at = here();
    const key = n + '|' + at + '|' + (app.spine.steps || []).map((s) => s.caption).join('\u0001');
    if (key === listFor) return;
    listFor = key;
    box.textContent = '';
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const li = document.createElement('li'), go = document.createElement('button'), words = document.createElement('input');
      if (i === at) li.className = 'here';
      go.className = 'go'; go.textContent = i + 1; go.setAttribute('aria-label', 'Open step ' + (i + 1)); go.setAttribute('aria-pressed', i === at ? 'true' : 'false');
      go.addEventListener('click', () => open(i));
      words.type = 'text'; words.maxLength = 80; words.value = captionOf(app.spine, i); words.placeholder = 'A few words'; words.setAttribute('aria-label', 'Words for step ' + (i + 1));
      words.addEventListener('change', () => { listFor = ''; app.change(() => setCaption(app.spine, i, words.value.trim()), { ride: false }); });
      words.addEventListener('keydown', (e) => { if (e.key === 'Enter') words.blur(); });
      li.append(go, words);
      const small = (text, label, off, fn) => { const b = document.createElement('button'); b.className = 'icon'; b.textContent = text; b.setAttribute('aria-label', label); b.disabled = off; b.addEventListener('click', fn); li.appendChild(b); };
      small('↑', 'Move step ' + (i + 1) + ' earlier', i === 0, () => app.change(() => moveStep(app.spine, i, -1), { ride: false }));
      small('↓', 'Move step ' + (i + 1) + ' later', i === n - 1, () => app.change(() => moveStep(app.spine, i, 1), { ride: false }));
      small('×', 'Remove step ' + (i + 1), false, () => remove(i));
      box.appendChild(li);
    }
  }
  function add() {
    if (!app.spine) return;
    stop(); compare = 'off'; app.shown = null; app.pair = null;
    const first = count() < 2;
    if (count() >= MOST_STEPS) { say('A sketch holds up to ' + MOST_STEPS + ' steps.'); return; }
    app.change(() => {
      addStep(app.spine);
      // (the first two steps are most often a before and an after)
      if (first) { setCaption(app.spine, 0, 'Before'); setCaption(app.spine, 1, 'After'); }
    }, { ride: false });
    const n = here() + 1;
    say('Step ' + n + ' is open. It starts as a copy of step ' + (n - 1) + ': change its shape, its hardware or its notes with the other tools, and step ' + (n - 1) + ' stays as it was.');
  }
  function remove(i) {
    stop(); compare = 'off'; app.shown = null; app.pair = null;
    if (i === here()) app.reopen(() => removeStep(app.spine, i)); else app.change(() => removeStep(app.spine, i), { ride: false });
    say(count() < 2 ? 'One step is left, so this is a plain sketch again. Undo brings the step back.' : 'The step is gone. Undo brings it back.');
  }
  function setCompare(how) {
    stop(); say('');
    compare = how;
    if (how !== 'off') { if (from === to || from >= count() || to >= count()) { from = 0; to = count() - 1; } if (how === 'blend') mix = 0; }
    show(); sync();
    // (two spines need more room than one, and one less than two)
    requestAnimationFrame(() => app.fit());
  }
  async function playBlend() {
    if (moving) { stop(); sync(); return; }
    const back = mix >= 0.995, start = mix, end = back ? 0 : 1;
    $('blendPlay').textContent = 'Stop';
    await run(calm.matches ? 1 : 2200 * Math.abs(end - start), (x) => { mix = start + (end - start) * ease(x); $('blend').value = Math.round(mix * 100); show(); blendSays(); });
    sync();
  }
  const nameOf = (i) => (captionOf(app.spine, i) || 'Step ' + (i + 1));
  function blendSays() {
    $('blendSay').textContent = mix <= 0.005 ? nameOf(from) : mix >= 0.995 ? nameOf(to) : Math.round(mix * 100) + '%';
  }

  // The words under the model: which step is open and what it is called, or what is compared.
  function barSays() {
    const n = count(), at = here();
    $('storyBar').hidden = n < 2;
    if (n < 2) return;
    const blended = app.shown && compare === 'blend', paired = !!app.pair;
    $('stepNo').textContent = paired ? 'Side by side' : blended ? 'Blend' : (at + 1) + ' of ' + n;
    $('stepWords').textContent = paired ? nameOf(from) + ' and ' + nameOf(to) : blended ? nameOf(from) + ' to ' + nameOf(to) : captionOf(app.spine, at);
    $('stepPrev').disabled = at === 0 || paired || blended; $('stepNext').disabled = at === n - 1 || paired || blended;
    $('stepPlay').setAttribute('aria-label', playing ? 'Stop playing the steps' : 'Play the steps'); $('stepPlay').classList.toggle('on', playing);
    $('stepPlay').firstElementChild.firstElementChild.setAttribute('href', playing ? '#i-pause' : '#i-play');
  }
  // The two names over the two spines that stand side by side.
  function placeCaps() {
    const box = $('pairCaps');
    box.hidden = !app.pair;
    if (!app.pair) return;
    // (the names stay clear of the line of help at the top of the picture)
    const spots = app.pairSpots(), names = [nameOf(from), nameOf(to)], top = $('says').getBoundingClientRect().bottom - $('stage').getBoundingClientRect().top + 30;
    const at = spots.map((sp) => renderer.project(sp)), els = [...box.children], wide = $('stage').clientWidth;
    els.forEach((el, i) => { el.style.display = at[i] ? '' : 'none'; if (el.textContent !== names[i]) el.textContent = names[i]; });
    if (at[0] && at[1]) {
      // (on a narrow screen the two spines stand close: the names are moved apart until they clear each other, and kept on the picture)
      const w = els.map((el) => el.offsetWidth), need = (w[0] + w[1]) / 2 + 8, gap = at[1][0] - at[0][0];
      if (gap < need) { const mid = (at[0][0] + at[1][0]) / 2; at[0] = [mid - need / 2, at[0][1]]; at[1] = [mid + need / 2, at[1][1]]; }
      const off = Math.max(0, w[0] / 2 + 4 - at[0][0]) - Math.max(0, at[1][0] + w[1] / 2 + 4 - wide);
      at[0] = [at[0][0] + off, at[0][1]]; at[1] = [at[1][0] + off, at[1][1]];
    }
    els.forEach((el, i) => { if (at[i]) el.style.transform = 'translate(' + at[i][0].toFixed(1) + 'px,' + Math.max(top, at[i][1]).toFixed(1) + 'px) translate(-50%,-100%)'; });
  }
  app.frames.push(placeCaps);

  function sync() {
    if (!app.spine) return;
    const n = count();
    // (a compare that no longer has two steps to work with, or that was left behind in another place, is over)
    if ((compare !== 'off' && (n < 2 || !inTab())) && !moving) { compare = 'off'; app.shown = null; app.pair = null; app.redraw(); }
    buildList();
    $('storyNone').hidden = n > 1; $('stepList').hidden = n < 2; $('storyMore').hidden = n < 2;
    $('stepAdd').textContent = n < 2 ? 'Add a step' : 'Add a step after this one';
    each('[data-compare]', (b) => b.setAttribute('aria-pressed', b.dataset.compare === compare ? 'true' : 'false'));
    $('compareBox').hidden = compare === 'off'; $('blendBox').hidden = compare !== 'blend';
    if (n > 1) {
      for (const [id, v] of [['cmpFrom', from], ['cmpTo', to]]) {
        const sel = $(id), key = (app.spine.steps || []).map((s) => s.caption).join('\u0001');
        if (sel.dataset.key !== key) { sel.dataset.key = key; sel.textContent = ''; for (let i = 0; i < n; i++) { const o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '. ' + nameOf(i); sel.appendChild(o); } }
        sel.value = Math.min(v, n - 1);
      }
      $('blend').value = Math.round(mix * 100); blendSays();
      $('blendPlay').textContent = moving && compare === 'blend' ? 'Stop' : mix >= 0.995 ? 'Play it back' : 'Play';
    }
    $('clipSteps').disabled = n < 2; if (n < 2 && $('clipWhat').value === 'steps') $('clipWhat').value = 'turn';
    barSays();
  }
  // the line of help over the model
  function says() {
    const n = count();
    if (n < 2) return 'Add a step to show this spine at two moments, such as before and after.';
    if (compare === 'side') return 'Two steps side by side. Drag to turn them both.';
    if (compare === 'blend') return 'Move the slider, or press Play, to see one step go over into the other.';
    return 'Step ' + (here() + 1) + ' of ' + n + ' is open. The other tools change this step and leave the rest alone.';
  }

  // ---------------------------------------------------------------- a moving picture
  // The model turning once round, or the steps going over into one another, as a video or a GIF.
  // The pictures are taken from the view as it is: its size, its shading, its names and words.
  async function makeClip() {
    if (!app.spine || making) return;
    const what = $('clipWhat').value, kind = $('clipKind').value, tell = (text) => { $('clipSay').textContent = text; };
    const type = kind === 'video' && window.MediaRecorder ? ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) : '';
    if (kind === 'video' && !type) { tell('This browser cannot make a video here. Choose GIF.'); return; }
    stop(); playing = false;
    making = true; $('clipGo').disabled = true;
    const gl = renderer.canvas, long = kind === 'gif' ? 480 : 960, k = Math.min(1, long / Math.max(gl.width, gl.height)), even = (v) => Math.max(2, Math.round(v / 2) * 2);
    const out = document.createElement('canvas'), g = out.getContext('2d', { willReadFrequently: kind === 'gif' });
    out.width = even(gl.width * k); out.height = even(gl.height * k);
    const fps = kind === 'gif' ? 12 : 30, n = count(), camera = renderer.camera, around = camera.around, was = { compare, shown: app.shown, pair: app.pair };
    // what each picture shows: a list of { turn } or { a, b, t } and the words under it
    const shots = [];
    if (what === 'steps' && n > 1) {
      for (let i = 0; i < n; i++) {
        for (let f = 0; f < Math.round(fps * (i === n - 1 ? 1.8 : 1.2)); f++) shots.push({ a: i, b: i, t: 0, words: i });
        if (i < n - 1) { const m = Math.round(fps * 1.1); for (let f = 1; f < m; f++) shots.push({ a: i, b: i + 1, t: ease(f / m), words: f / m < 0.5 ? i : i + 1 }); }
      }
    } else { const m = fps * 4; for (let f = 0; f < m; f++) shots.push({ turn: (f / m) * Math.PI * 2 }); }
    const draw = (shot) => {
      if (shot.turn !== undefined) { camera.around = around + shot.turn; if (app.pair) app.redraw(); }
      else { app.pair = null; app.shown = shot.a === shot.b ? { spine: stepSpine(app.spine, shot.a), fade: 1 } : blend(stepSpine(app.spine, shot.a), stepSpine(app.spine, shot.b), shot.t); app.redraw(); }
      g.drawImage(app.picture(), 0, 0, out.width, out.height);
      if (shot.words !== undefined) {
        const text = (shot.words + 1) + ' of ' + n + (captionOf(app.spine, shot.words) ? '   ' + captionOf(app.spine, shot.words) : ''), size = Math.max(13, Math.round(out.height / 24));
        g.font = '650 ' + size + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const w = g.measureText(text).width + size * 1.6, h = size * 1.9, x = (out.width - w) / 2, y = out.height * 0.06;
        g.fillStyle = 'rgba(19, 20, 24, 0.86)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
        g.fillStyle = '#eceae5'; g.fillText(text, out.width / 2, y + h / 2 + 1);
      }
    };
    let blob = null, name = kit.fileNameFor(app.spine) + (what === 'steps' && n > 1 ? '-steps' : '-turning');
    try {
      if (kind === 'gif') {
        const frames = [];
        for (let i = 0; i < shots.length; i++) {
          draw(shots[i]); frames.push(g.getImageData(0, 0, out.width, out.height).data);
          if (i % 4 === 0) { tell('Taking the pictures: ' + Math.round((i / shots.length) * 100) + '%'); await frame(); }
        }
        tell('Putting them together'); await wait(30);
        blob = new Blob([gifOf(frames, out.width, out.height, Math.round(100 / fps))], { type: 'image/gif' }); name += '.gif';
      } else {
        draw(shots[0]);
        const stream = out.captureStream(fps), rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 }), parts = [];
        rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
        const ended = new Promise((r) => { rec.onstop = r; });
        rec.start();
        const start = performance.now();
        for (let i = 0; i < shots.length; i++) {
          draw(shots[i]);
          if (i % 6 === 0) tell('Recording: ' + Math.round((i / shots.length) * 100) + '%');
          // (a video is recorded as it plays: each picture waits for its moment)
          await wait(Math.max(0, start + ((i + 1) * 1000) / fps - performance.now())); await frame();
        }
        rec.stop(); await ended; stream.getTracks().forEach((t) => t.stop());
        blob = new Blob(parts, { type: type.split(';')[0] }); name += type.startsWith('video/mp4') ? '.mp4' : '.webm';
      }
    } catch (e) { blob = null; }
    camera.around = around; compare = was.compare; making = false; $('clipGo').disabled = false;
    show(); renderer.requestDraw();
    if (!blob || !blob.size) { tell('That did not work in this browser. Try the other kind.'); return; }
    kit.download(blob, name);
    tell('Saved ' + name + ' to your downloads, ' + (blob.size / 1e6).toFixed(1) + ' MB. It was made on this device and went nowhere else.');
  }

  // ---------------------------------------------------------------- a page to print
  // One sheet: the spine from the back and from the side (every step, if there are steps), what is on it, and the notes.
  function printPage() {
    if (!app.spine) return;
    stop(); playing = false;
    const page = $('printPage'), n = count(), camera = renderer.camera, was = { ...camera, target: camera.target.slice() }, keep = { compare, shown: app.shown, pair: app.pair };
    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
    page.textContent = '';
    page.appendChild(el('h1', app.spine.name || 'A spine'));
    if (app.spine.about) page.appendChild(el('p', app.spine.about, 'about'));
    page.appendChild(el('p', 'A sketch made with Spine-Design on ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + '. It shows what its maker wanted to show. It is not a medical image and not a measurement.', 'what'));
    // the pictures: on white, the middle of the view, from the back and from the side
    app.pair = null; app.setBack('white');
    const pale = $('stage').classList.contains('pale'); $('stage').classList.add('pale');
    const shot = (around) => {
      camera.around = around; camera.tilt = 0.05; app.fit();
      const full = app.picture(), cut = document.createElement('canvas'), w = Math.min(full.width, Math.round(full.height * 0.62));
      cut.width = w; cut.height = Math.round(full.height * 0.94);
      cut.getContext('2d').drawImage(full, Math.round((full.width - w) / 2), 0, w, cut.height, 0, 0, w, cut.height);
      const img = new Image(); img.src = cut.toDataURL('image/jpeg', 0.9); img.alt = '';
      return img;
    };
    const rows = el('div', '', 'views');
    for (let i = 0; i < n; i++) {
      app.shown = n > 1 ? { spine: stepSpine(app.spine, i), fade: 1 } : null; app.redraw();
      const fig = el('figure');
      for (const [around, label] of [[0, 'From the back'], [Math.PI / 2, 'From the side']]) { const d = el('div'); d.append(shot(around), el('span', label)); fig.appendChild(d); }
      if (n > 1) fig.appendChild(el('figcaption', (i + 1) + '. ' + nameOf(i)));
      rows.appendChild(fig);
    }
    page.appendChild(rows);
    page.classList.toggle('two', n === 2); page.classList.toggle('many', n > 2);
    // what is on the open step, in words
    app.shown = null;
    const list = kit.builder.rows();
    if (list.length) {
      page.appendChild(el('h2', n > 1 ? 'Step ' + (here() + 1) + ': ' + nameOf(here()) : 'On this spine'));
      let head = '', ul = null;
      for (const r of list) { if (r.head !== head) { head = r.head; page.appendChild(el('h3', head)); ul = el('ul'); page.appendChild(ul); } ul.appendChild(el('li', r.text)); }
    }
    page.appendChild(el('p', 'Angles are rough, read from the sketch and not from a person. ' + kit.credit(), 'foot'));
    // back to how the view was
    Object.assign(camera, was); compare = keep.compare; $('stage').classList.toggle('pale', pale); app.applyLook(); show();
    if ($('share').open) $('share').close();
    // (the pictures are data that is already here, but a browser may still need a moment to lay them out)
    const imgs = [...page.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))).then(() => window.print());
  }

  // ---------------------------------------------------------------- the buttons
  $('stepAdd').addEventListener('click', add);
  $('stepPrev').addEventListener('click', () => { playing = false; open(here() - 1); });
  $('stepNext').addEventListener('click', () => { playing = false; open(here() + 1); });
  $('stepPlay').addEventListener('click', play);
  each('[data-compare]', (b) => b.addEventListener('click', () => setCompare(b.dataset.compare)));
  $('cmpFrom').addEventListener('change', () => { stop(); from = Number($('cmpFrom').value); show(); sync(); });
  $('cmpTo').addEventListener('change', () => { stop(); to = Number($('cmpTo').value); show(); sync(); });
  $('blend').addEventListener('input', () => { stop(); mix = Number($('blend').value) / 100; show(); blendSays(); barSays(); });
  $('blend').addEventListener('change', sync);
  $('blendPlay').addEventListener('click', playBlend);
  $('noteGo').addEventListener('click', () => { kit.builder.go('marks'); kit.builder.tool('note'); });
  $('clipBtn').addEventListener('click', () => { const open_ = $('clipBox').hidden; $('clipBox').hidden = !open_; $('clipBtn').setAttribute('aria-expanded', open_ ? 'true' : 'false'); if (open_) $('clipBox').scrollIntoView({ block: 'nearest' }); });
  $('clipGo').addEventListener('click', makeClip);
  $('sheetBtn').addEventListener('click', printPage);
  window.addEventListener('keydown', (e) => {
    // (with the steps bar in focus, the arrow keys go from step to step)
    if (!e.target || !e.target.closest || !e.target.closest('#storyBar')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); open(here() - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); open(here() + 1); }
  });

  return {
    sync, says, show,
    // the place was left: what was compared there is over
    left() { if (compare !== 'off' || moving) { stop(); compare = 'off'; app.shown = null; app.pair = null; app.redraw(); } },
    // where things stand, and ways in for the checks in a browser
    state: () => ({ steps: count(), here: here(), compare, from, to, mix, playing, shown: !!app.shown, pair: !!app.pair, captions: Array.from({ length: count() }, (_, i) => captionOf(app.spine, i)) }),
    open, add, remove, setCompare, play, makeClip, printPage,
    setMix(v) { mix = v; show(); sync(); },
  };
}
