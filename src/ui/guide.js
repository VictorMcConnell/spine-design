// The guide: what every tool does, part by part, and a tour that builds a small example with the
// person, one step at a time.
//
// A step of the tour opens the place it is about, says in a line or two what to do there and
// shows where. "Do it for me" does the step, so the tour can be watched or done by hand, and
// either way the sketch on screen is a real one that can be kept.
//
// The guide itself is a sheet with the same parts as the app. A tool in it is a button: it
// closes the sheet, takes that tool in hand and shows where it is. Each part can also be walked
// through on its own, with the sketch that is open.

export function setupGuide(app, host) {
  const { $, renderer } = app;
  const B = () => host.builder();
  const touch = () => window.matchMedia('(pointer: coarse)').matches;
  const Press = () => (touch() ? 'Tap' : 'Click');
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const quick = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const click = (selector) => { const el = document.querySelector(selector); if (el) el.click(); };
  const go = (tab, tool) => { B().go(tab); if (tool) B().tool(tool); };
  // where a point of the model is on the page
  const onPage = (point) => { const p = renderer.project(point), box = renderer.canvas.getBoundingClientRect(); return [p[0] + box.left, p[1] + box.top]; };
  const level = (id) => app.spine.levels.find((l) => l.id === id) || app.spine.levels[Math.floor(app.spine.levels.length / 2)];
  // move a slider to a value the way a hand would, so the model is seen to follow. It takes the same time on a slow
  // device as on a fast one: a slow one draws fewer steps on the way.
  async function slide(id, to, ms = 550) {
    const el = $(id), from = parseFloat(el.value) || 0, t0 = performance.now(), say = (type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    while (!quick()) {
      const u = (performance.now() - t0) / ms;
      if (u >= 1) break;
      el.value = from + (to - from) * u; say('input'); await wait(16);
    }
    el.value = to; say('input'); say('change');
  }

  // ---------------------------------------------------------------- what the tools do
  // [name, where it is (a tool as 'place:tool', or a selector), what it does]
  const PARTS = [
    { id: 'shape', name: 'Shape', says: 'Give the spine its curve. Every tool here bends the same model, so use the one that feels easiest.', tools: [
      ['Turn', 'shape:turn', 'Drag to turn the model without changing it.'],
      ['Draw', 'shape:draw', 'Draw a line up the spine, seen from the back or from the side, and the spine follows it.'],
      ['Curve', 'shape:curve', 'Pick a part of the spine and set its bend by the degree: sideways, front to back, twist and lean.'],
      ['Points', 'shape:points', 'A line with a few points lies over the spine. Drag a point and the spine follows.'],
      ['One bone', 'shape:one', 'Pick one vertebra and move it, turn it or resize it on its own.'],
      ['Lock', 'shape:lock', 'Pick vertebrae that stay where they are while the rest is shaped.'],
      ['X-ray', 'shape:xray', 'Lay a picture of an X-ray over the model or beside it, trace the spine on it and the model takes that shape. Do it from the back and from the side for both directions. The picture stays on this device.'],
    ] },
    { id: 'parts', name: 'Hardware', says: 'Put screws, hooks, rods and cross-links on the spine. The map beside the model has a row for every vertebra.', tools: [
      ['Select', 'parts:turn', 'With nothing in hand, pick a part to change it: drag a screw to another vertebra, set its length and thickness, or pick another picture in the catalogue to make it a hook. Adjust by hand on its card opens sliders for its angle and its place on the bone, with a button that puts it back.'],
      ['Screw', 'parts:screw', 'A picture in the catalogue beside the model. Take it in hand and put a screw on a dot of the model or of the map. Drag down the map to place several.'],
      ['Hook', 'parts:hook', 'The same for hooks, pointing down or up.'],
      ['Cross-link', 'parts:link', 'In the Cross-links category: a cross-link between the two rods, in the gap below a vertebra. There are three looks: arched, flat and straight. Select one that is on and pick another picture to change it.'],
      ['Rod', 'parts:rod', 'Rods run through all the parts of a side. Pick two parts to run a rod between only those. Drag a rod to bend it. The pictures set how thick: of the selected rod, or of all of them.'],
      ['Discs', 'parts:disc', 'The Discs category of the catalogue. Press the spine between two vertebrae to select the disc there (it works from the back too), then pick what it is: thin, bulging, herniated, dried out or gone, or an implant: an artificial disc, a cage, a cage with its own screws, a plate on the front or a spacer at the back. Plates on discs next to each other join into one long plate. A bulge can point to the back, a side or the front. Turn the model to see the discs from the front or the side.'],
      ['Vertebrae', 'parts:bone', 'The Vertebrae category of the catalogue. Select a vertebra, then pick how it is broken: a wedge, crush or burst fracture, squashed on one side, a hairline crack, a split or a chipped corner. A slider sets how much. Further down are the looks of the bone: aged or porous, with bone spurs, hardened or sore, and what was done to the back of it.'],
      ['Move, Rotate, Size', 'parts:bone', 'Three buttons beside the model. They put handles on a selected vertebra: arrows to move it, rings to turn it, knobs to resize it. Select takes the handles away.'],
      ['None', 'parts:erase', 'Take single parts off: in hand, each part pressed goes. Pressed while a part is selected, it takes that part off.'],
      ['Fill it in for me', '#fillBtn', 'Three questions (from where, to where, which parts) and a whole set is put on at once.'],
    ] },
    { id: 'marks', name: 'Pain', says: 'Mark where it hurts and write short notes on the model.', tools: [
      ['Pain point', 'marks:pain', 'Mark the spot that hurts. Its card sets how large and how strong it is.'],
      ['Note', 'marks:note', 'Point at a spot and write a few words about it.'],
      ['Turn', 'marks:turn', 'Pick a pain point or a note to change it or remove it.'],
    ] },
    { id: 'story', name: 'Story', says: 'The same spine at several moments, such as before and after an operation, and ways to show them.', tools: [
      ['Add a step', '#stepAdd', 'A step starts as a copy of the spine as it is. Change it with the other tools and the steps before it stay as they were.'],
      ['The steps', '#stepList', 'Give each step a few words, open it, move it up or down the order, or take it out.'],
      ['Compare', '[data-compare="side"]', 'Two steps side by side, or Blend: a slider that takes one step over into the other.'],
      ['The steps bar', '#storyBar', 'Under the model once there are two steps: the step before, the next one, and Play.'],
    ] },
    { id: 'look', name: 'Look', says: 'How the sketch is drawn. Nothing here changes its shape.', tools: [
      ['Shading', '#shades', 'Soft, clay, a line drawing, an X-ray look or plain color. Then six for fun: matte, chrome, gold, candy, rainbow and neon.'],
      ['Sets of colors', '#paletteRow', 'One press colors all the hardware. By level gives the parts of each vertebra a color of their own.'],
      ['A color for one kind', '#colorWhat', 'Pick Rods, Screws, Hooks, Links, Bone or Discs, then a color.'],
      ['A color for one part', 'parts:turn', 'In the Hardware place, select a screw, a hook, a cross-link or a rod: its card has a row of colors. More has a button that gives every part of that kind the same color.'],
      ['One part', '#colorWhat [data-what="one"]', 'Pick a color, then paint single parts or vertebrae with it.'],
      ['Background', '#backs', 'Dark, grey or light. Below it, bone can be made see-through so the screws show inside.'],
      ['Clean view', '#cleanBtn', 'Puts the tools away so the model stands alone, for a picture of the screen.'],
    ] },
    { id: 'share', name: 'Share and the top bar', says: 'Keep the sketch or pass it on. Nothing leaves your device unless you send it yourself.', tools: [
      ['Bone names', '#namesBox', 'Tick it to put the name of each vertebra beside it. It is in the top bar whatever you are working on.'],
      ['Share', '#shareBtn', 'Save a picture or a moving picture, copy a link that holds the whole sketch with its steps, print a page, get code that shows the sketch on your own web page, save the file or export it for a 3D printer.'],
      ['Stand', '[data-stand]', 'Puts the model on a stand, the way it is printed. On a small screen it is under View.'],
      ['Reset', '[data-reset]', 'Reset the view puts colors, shading and background back. Reset the model gives a straight normal spine. On a small screen both are under View.'],
      ['New', '#newBtn', 'Start from one of the made-up shapes, or open a sketch you saved.'],
      ['Undo and Redo', '#undoBtn', 'Every change can be taken back.'],
    ] },
  ];

  // ---------------------------------------------------------------- showing where something is
  let lit = null, litTimer = null;
  function unlight() { clearTimeout(litTimer); if (lit) lit.classList.remove('here'); lit = null; }
  // the first match that can be seen. Things of the top bar that a small screen keeps under View point at View.
  function seen(selector) {
    for (const el of document.querySelectorAll(selector)) if (el.offsetParent !== null && !el.closest('[hidden]') && !el.closest('.menu')) return el;
    return selector.startsWith('[data-stand]') || selector.startsWith('[data-reset]') || selector === '#guideBtn' ? $('viewBtn') : null;
  }
  function light(selector, forMs = 0) {
    unlight();
    const el = selector && seen(selector);
    if (!el) return;
    lit = el; el.classList.add('here');
    if (el.scrollIntoView && el.closest('#card, #side')) el.scrollIntoView({ block: 'nearest' });
    if (forMs) litTimer = setTimeout(unlight, forMs);
  }
  // (the tools of the hardware are the pictures of the catalogue, and Select beside the model)
  const PART_TARGET = { turn: '#fineSelect', screw: '#catTiles [data-tile="screw"]', hook: '#catTiles [data-tile="hook-down"]', link: '#catTiles [data-tile="link"]', rod: '#catTiles [data-tile="rod"]', erase: '#catTiles [data-tile="none"]', disc: '#cats [data-cat="discs"]', bone: '#cats [data-cat="bones"]' };
  // open the place a tool is in, take it in hand and show it
  function showTool(part, where) {
    if (/^[a-z]+:[a-z]+$/.test(where)) { const [tab, tool] = where.split(':'); go(tab, tool); return tab === 'parts' ? PART_TARGET[tool] : '#tray [data-tools="' + tab + '"] [data-t="' + tool + '"]'; }
    if (part.id === 'look') go('look'); else if (part.id === 'story') go('story'); else if (part.id === 'parts') go('parts', 'turn');
    return where;
  }

  // ---------------------------------------------------------------- the tour
  const STEPS = [
    { part: 'shape', title: 'Turn it around', target: '#viewBtn', at: () => go('shape', 'turn'),
      text: () => 'Drag on the model to turn it. ' + (touch() ? 'Pinch to zoom.' : 'Scroll to zoom.') + ' View has the set views and Fit.',
      doIt: async () => { renderer.look(Math.PI / 2); await wait(quick() ? 100 : 1100); renderer.look(0); await wait(quick() ? 100 : 700); } },
    { part: 'shape', title: 'Bend the spine', target: '#bow0R', at: () => go('shape', 'curve'),
      text: () => 'Shape gives the spine its curve. With Curve, pick a part of the spine and drag Sideways. Draw does the same with a line drawn over the model.',
      doIt: async () => { click('[data-region="chest"]'); await wait(250); await slide('bow0R', 36); await wait(300); click('[data-region="low"]'); await wait(250); await slide('bow0R', -24); await wait(200); click('[data-region="chest"]'); } },
    { part: 'parts', title: 'Add the hardware', target: '#fillBtn', at: () => go('parts', 'screw'),
      text: () => 'Hardware goes on from the back. Screw puts one screw where you ' + Press().toLowerCase() + '. Fill it in for me puts on a whole set: screws on both sides, rods through them and a cross-link.',
      doIt: async () => {
        click('#fillBtn'); await wait(500);
        const ids = app.spine.levels.map((l) => l.id), pick = (id, list) => { if (ids.includes(list)) $(id).value = list; };
        pick('gTop', 'T4'); pick('gBottom', 'L1'); click('[data-gkind="screws"]'); click('[data-glinks="1"]'); await wait(500);
        click('#gBuild'); await wait(400);
      } },
    { part: 'parts', title: 'Change one part', target: '#fineSelect', at: () => go('parts', 'turn'),
      text: () => 'With Select, ' + Press().toLowerCase() + ' any part to change it. A screw can be dragged to another vertebra, made longer or thicker, or changed into a hook with the pictures of the catalogue. None takes it off.',
      doIt: async () => {
        const screws = app.spine.hardware.screws;
        if (!screws.length) { app.say('There is no screw to change yet. Add the hardware first.'); return; }
        app.pick({ kind: 'screws', index: Math.floor(screws.length / 2) }); await wait(400);
        const more = document.querySelector('[data-card="piece"] [data-more]');
        if (more && more.offsetParent !== null && more.getAttribute('aria-expanded') !== 'true') more.click();
        await wait(250); await slide('pieceLong', 54); await wait(300); await slide('pieceLong', 38);
      },
      leave: () => app.pick(null) },
    { part: 'marks', title: 'Mark where it hurts', target: '#tray [data-tools="marks"] [data-t="pain"]', at: () => go('marks', 'pain'),
      text: () => 'With Pain point in hand, ' + Press().toLowerCase() + ' the spot that hurts. Note adds a few words to a spot.',
      doIt: async () => { const p = onPage(level('T7').centre); B().painAt(p[0], p[1]); await wait(300); },
      leave: () => app.pick(null) },
    { part: 'look', title: 'Choose the look', target: '#paletteRow', at: () => go('look'),
      text: () => 'Look sets how the sketch is drawn. Pick a set of colors, or a color for one kind of part. With One part, pick a color and paint a single screw or vertebra.',
      doIt: async () => {
        click('[data-palette="bright"]'); await wait(700);
        B().colorOn('one', 'red'); await wait(500);
        const p = onPage(level('L3').centre); B().paintAt(p[0], p[1]); await wait(300);
      } },
    { part: 'share', title: 'Share it or print it', target: '#shareBtn',
      text: () => 'Share saves a picture, copies a link that holds the whole sketch, saves the file or exports it for a 3D printer. Stand puts the model on its stand.',
      doIt: async () => { host.setStand(true); await wait(300); } },
    { part: 'share', title: 'That is the whole tool', target: '[data-reset]',
      text: () => 'This sketch is yours to keep changing. Reset the model gives a straight normal spine again, and Undo takes any step back. The Guide explains every tool.' },
  ];

  let run = null;         // the tour that is on: its steps, which one is up, which ones were done for the person
  function showStep() {
    const s = run.steps[run.i];
    if (s.at) s.at();
    $('tour').hidden = false; document.body.classList.add('touring');
    $('tourCount').textContent = 'Step ' + (run.i + 1) + ' of ' + run.steps.length;
    $('tourTitle').textContent = s.title; $('tourText').textContent = s.text();
    $('tourBack').hidden = run.i === 0;
    $('tourDo').hidden = !s.doIt; $('tourDo').disabled = run.did.has(run.i); $('tourDo').textContent = run.did.has(run.i) ? 'Done for you' : 'Do it for me';
    $('tourNext').textContent = run.i === run.steps.length - 1 ? 'Finish' : s.start ? 'Start' : 'Next';
    setTimeout(() => { if (run && run.steps[run.i] === s) light(s.target); }, 150);
  }
  function end(said = '') {
    if (!run) return;
    const s = run.steps[run.i]; if (s && s.leave) s.leave();
    run = null; unlight();
    $('tour').hidden = true; document.body.classList.remove('touring');
    if (said) app.say(said);
  }
  async function move(by) {
    if (!run || run.busy) return;
    const s = run.steps[run.i];
    if (s.leave) s.leave();
    if (by > 0 && s.next) { run.busy = true; await s.next(); if (!run) return; run.busy = false; }
    if (run.i + by >= run.steps.length) { end('That was the tour. Guide has it again, and every tool one by one.'); return; }
    run.i = Math.max(0, run.i + by); showStep();
  }
  async function doIt() {
    if (!run || run.busy) return;
    const i = run.i, s = run.steps[i];
    run.busy = true; run.did.add(i); $('tourDo').disabled = $('tourNext').disabled = $('tourBack').disabled = true;
    try { await s.doIt(); } finally {
      $('tourNext').disabled = $('tourBack').disabled = false;
      if (run) { run.busy = false; if (run.i === i) { $('tourDo').textContent = 'Done for you'; light(s.target); $('tourNext').focus(); } }
    }
  }
  // The whole tour builds its example on a new normal spine. One part is walked through with the sketch that is open.
  function tour(partId = '') {
    for (const id of ['guide', 'start']) if ($(id).open) $(id).close();
    end();
    const steps = STEPS.filter((s) => !partId || s.part === partId);
    const fresh = async () => { await host.fresh(); await wait(140); host.setStand(false); };
    if (!partId && host.changed()) steps.unshift({ part: '', title: 'A new sketch for the tour', start: true, next: fresh,
      text: () => 'The tour builds a small example on a new normal spine. Your sketch is kept: Undo brings it back afterwards.' });
    run = { steps, i: 0, did: new Set(), busy: false };
    if (!partId && !steps[0].start) { run.busy = true; fresh().then(() => { if (run) { run.busy = false; showStep(); $('tourNext').focus(); } }); return; }
    showStep(); $('tourNext').focus();
  }
  $('tourNext').addEventListener('click', () => move(1));
  $('tourBack').addEventListener('click', () => move(-1));
  $('tourDo').addEventListener('click', doIt);
  $('tourEnd').addEventListener('click', () => end('The tour is closed. Guide has it again.'));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && run && !document.querySelector('dialog[open]')) end('The tour is closed. Guide has it again.'); });

  // ---------------------------------------------------------------- the sheet
  const list = $('guideList');
  PARTS.forEach((part, p) => {
    const box = document.createElement('details'), head = document.createElement('summary'), says = document.createElement('p'), walk = document.createElement('button');
    box.className = 'fold'; box.name = 'guide'; head.textContent = part.name; says.className = 'small'; says.textContent = part.says;
    box.appendChild(head); box.appendChild(says);
    part.tools.forEach(([name, where, text], t) => {
      const b = document.createElement('button'), strong = document.createElement('strong'), em = document.createElement('em');
      b.className = 'toolrow'; b.dataset.show = p + ':' + t; strong.textContent = name; em.textContent = text;
      b.appendChild(strong); b.appendChild(em); box.appendChild(b);
    });
    walk.className = 'walk'; walk.dataset.walk = part.id; walk.textContent = 'Walk me through ' + part.name.toLowerCase().replace(' and the top bar', ' and print');
    box.appendChild(walk); list.appendChild(box);
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-show]'), walk = e.target.closest('[data-walk]');
    if (walk) { tour(walk.dataset.walk); return; }
    if (!row) return;
    const [p, t] = row.dataset.show.split(':').map(Number), part = PARTS[p], tool = part.tools[t];
    $('guide').close(); end();
    const target = showTool(part, tool[1]);
    setTimeout(() => { light(target, 6000); app.say(tool[0] + ': ' + tool[2]); }, 200);
  });
  $('tourAll').addEventListener('click', () => tour());

  return {
    open() { end(); if (!$('guide').open) $('guide').showModal(); },
    tour, end,
    // where the tour stands (the checks in a browser use this)
    state: () => (run ? { step: run.i, of: run.steps.length, title: run.steps[run.i].title } : null),
  };
}
