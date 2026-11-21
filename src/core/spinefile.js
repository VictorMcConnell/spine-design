// The spine file: one small JSON document that everything else reads.
// See docs/spine-file.md for the format in words.

import { KINDS, FREEZING } from '../parts/kinds.js';

export const SCHEMA_VERSION = 1;
// the looks the head of a screw can have in a file (their shapes are in parts/sizes.js)
const SCREW_HEADS = ['standard', 'tall', 'low'];
// What a disc can be, and which way a bulging or herniated one pushes. A disc the file says
// nothing about is 'standard'. The last two are implants in the place of the disc: an artificial
// disc and a fusion cage. Any disc can also carry "spacer": a block between the two back processes.
export const DISC_STATES = ['standard', 'thin', 'bulging', 'herniated', 'dried', 'none', 'replacement', 'cage', 'cage-screws'];
export const DISC_SIDES = ['back', 'back-left', 'back-right', 'left', 'front', 'right'];
// The looks a cross-link can have: the arched bar (nothing is written down), a flat strap or a straight bar.
export const LINK_STYLES = ['arch', 'plate', 'straight'];
// The ways the body of a vertebra can be broken. A vertebra the file says nothing about is whole.
export const FRACTURES = ['wedge', 'crush', 'burst', 'wedge-left', 'wedge-right', 'hairline', 'split', 'chip'];
// What else the bone of a vertebra can show ("bone" of a level): spurs at its rims, hardened bone, or sore end plates.
export const BONE_LOOKS = ['spurs', 'dense', 'sore'];
// What can be different about the back of a vertebra: the bone over the canal taken away, or one of its
// processes broken (the one at the back, or the one on the left or the right side).
export const ARCHES = ['laminectomy', 'spinous', 'tp-left', 'tp-right'];

// Order of the levels from the top down.
export const LEVEL_ORDER = [
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5', 'S1',
];

// Where a number came from. 'typical' is used by the ready-made average spine.
export const SOURCES = ['measured', 'traced', 'guessed', 'typical'];

export function regionOf(id) {
  return { C: 'neck', T: 'chest', L: 'lower back', S: 'sacrum' }[id[0]] || 'chest';
}

// Levels of a spine sorted from the top down.
export function sortedLevels(spine) {
  return [...spine.levels].sort((a, b) => LEVEL_ORDER.indexOf(a.id) - LEVEL_ORDER.indexOf(b.id));
}

// Is this level inside one of the fused stretches?
export function isFused(spine, id) {
  const i = LEVEL_ORDER.indexOf(id);
  return (spine.fused || []).some(([top, bottom]) => i >= LEVEL_ORDER.indexOf(top) && i <= LEVEL_ORDER.indexOf(bottom));
}

// Is this level held still, either by fusion or because it sits between the highest and the
// lowest piece of hardware? Angles measured between held levels do not change with posture.
export function isHeld(spine, id) {
  if (isFused(spine, id)) return true;
  const hw = spine.hardware || {}, at = [...(hw.screws || []), ...(hw.hooks || [])].map((h) => LEVEL_ORDER.indexOf(h.level)).filter((i) => i >= 0);
  const i = LEVEL_ORDER.indexOf(id);
  return at.length > 0 && i >= Math.min(...at) && i <= Math.max(...at);
}

const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && isFinite(v));

// Check a spine file. Returns a list of problems in plain words. An empty list means it is fine.
// the names a colour of hardware can have in a file (the colours themselves are in finish.js)
const COLOR_NAMES = ['titanium', 'steel', 'black', 'white', 'blue', 'sky', 'teal', 'green', 'lime', 'gold', 'orange', 'red', 'pink', 'purple'];

export function validateSpine(spine) {
  const problems = [];
  if (!spine || typeof spine !== 'object') return ['This is not a spine file.'];
  if (spine.schema !== SCHEMA_VERSION) problems.push('The file says it is format ' + spine.schema + '. This app reads format ' + SCHEMA_VERSION + '.');
  if (!Array.isArray(spine.levels) || !spine.levels.length) return problems.concat('The file has no vertebrae in it.');
  const seen = new Set();
  for (const l of spine.levels) {
    const name = l && l.id ? l.id : '(no name)';
    if (!l || !LEVEL_ORDER.includes(l.id)) { problems.push('Unknown vertebra name: ' + name + '.'); continue; }
    if (seen.has(l.id)) problems.push(name + ' is in the file twice.');
    seen.add(l.id);
    if (!isPoint(l.centre)) problems.push(name + ' has no usable position.');
    if (l.color !== undefined && (typeof l.color !== 'string' || !/^([a-z]+|#[0-9a-f]{6})$/i.test(l.color) || (l.color[0] !== '#' && !COLOR_NAMES.includes(l.color)))) problems.push(name + ' has a colour the app does not know.');
    if (!Array.isArray(l.tilt) || l.tilt.length !== 2 || l.tilt.some((v) => typeof v !== 'number' || Math.abs(v) > 85)) problems.push(name + ' has a tilt the app cannot use.');
    if (typeof l.turn !== 'number' || !isFinite(l.turn)) problems.push(name + ' has no turn.');
    if (!isPoint(l.size) || l.size.some((v) => v <= 0)) problems.push(name + ' has no usable size.');
    if (l.arch !== undefined && !ARCHES.includes(l.arch)) problems.push(name + ' has something at its back the app does not know: ' + l.arch + '.');
    if (l.wear !== undefined && !(l.wear >= 0 && l.wear <= 1)) problems.push(name + ' has a wear the app cannot use.');
    if (l.bone !== undefined && !BONE_LOOKS.includes(l.bone)) problems.push(name + ' has a bone look the app does not know: ' + l.bone + '.');
    if (l.fracture !== undefined) { const f = l.fracture; if (!f || !FRACTURES.includes(f.kind) || !(f.amount > 0 && f.amount <= 1) || !(f.was > 0 && f.was < 80) || (f.lean !== undefined && !(Math.abs(f.lean) <= 45))) problems.push(name + ' has a fracture the app cannot use.'); }
    if (l.source && !SOURCES.includes(l.source)) problems.push(name + ' has an unknown source: ' + l.source + '.');
  }
  for (const pair of spine.fused || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((id) => LEVEL_ORDER.includes(id))) problems.push('A fused stretch is not written as [top, bottom].');
  }
  if (spine.discs !== undefined && (!spine.discs || typeof spine.discs !== 'object' || Array.isArray(spine.discs))) problems.push('The discs are not written as a list by name.');
  else for (const [key, d] of Object.entries(spine.discs || {})) {
    const [up, low] = key.split('/'), i = LEVEL_ORDER.indexOf(up);
    if (i < 1 || LEVEL_ORDER[i + 1] !== low) { problems.push('There is no disc named ' + key + '.'); continue; }
    if (!d || !DISC_STATES.includes(d.state)) problems.push('The disc ' + key + ' has a state the app does not know.');
    else if ((d.amount !== undefined && !(d.amount >= 0 && d.amount <= 1)) || (d.toward !== undefined && !DISC_SIDES.includes(d.toward)) || (d.drop !== undefined && !(d.drop >= 0 && d.drop < 30)) || (d.spacer !== undefined && d.spacer !== true) || (d.plate !== undefined && d.plate !== true)) problems.push('The disc ' + key + ' has a number or a side the app cannot use.');
  }
  const hw = spine.hardware || {};
  for (const r of hw.rods || []) {
    if (!Array.isArray(r.points) || r.points.length < 2 || !r.points.every(isPoint)) problems.push('A rod has no usable path.');
    if (r.via !== undefined && (!Array.isArray(r.via) || !r.via.every(isPoint))) problems.push('A rod has a bend the app cannot use.');
  }
  for (const s of hw.screws || []) {
    if (!isPoint(s.head) || !isPoint(s.tip)) problems.push('A screw at ' + (s.level || '?') + ' has no usable position.');
    if (s.look !== undefined && !SCREW_HEADS.includes(s.look)) problems.push('A screw at ' + (s.level || '?') + ' has a look the app does not know: ' + s.look + '.');
  }
  for (const h of hw.hooks || []) {
    if (!isPoint(h.at) || !isPoint(h.tip)) problems.push('A hook at ' + (h.level || '?') + ' has no usable position.');
    if (h.faces !== undefined && h.faces !== 'up' && h.faces !== 'down') problems.push('A hook at ' + (h.level || '?') + ' faces neither up nor down.');
  }
  for (const c of hw.crosslinks || []) {
    if (!isPoint(c.from) || !isPoint(c.to)) problems.push('A cross-link has no usable position.');
    if (c.style !== undefined && !LINK_STYLES.includes(c.style)) problems.push('A cross-link has a look the app does not know: ' + c.style + '.');
  }
  if (hw.rodSize !== undefined && !(hw.rodSize >= 3 && hw.rodSize <= 8)) problems.push('The thickness for new rods is not one the app can use.');
  if (hw.norods !== undefined && typeof hw.norods !== 'boolean') problems.push('The file says whether the rods are on in a way the app cannot read.');
  for (const m of spine.marks || []) if (m && m.label !== undefined && !isPoint(m.label)) problems.push('A label of a pain point or a note has no usable position.');
  for (const kind of FREEZING) for (const piece of hw[kind] || []) if (piece.locked !== undefined && typeof piece.locked !== 'boolean') problems.push('A part says it is frozen in a way the app cannot read.');
  for (const [kind, color] of Object.entries(hw.colors || {})) if (!KINDS.includes(kind) || !/^([a-z]+|#[0-9a-f]{6})$/i.test(color) || (color[0] !== '#' && !COLOR_NAMES.includes(color))) problems.push('The colour given for the ' + kind + ' is not one this app knows.');
  if (hw.splits !== undefined && (!Array.isArray(hw.splits) || hw.splits.some((x) => typeof x !== 'string' || !LEVEL_ORDER.includes(x.split(':')[0]) || !['', 'left', 'right'].includes(x.split(':')[1] || '') || x.split(':').length > 2))) problems.push('The list of places where the rods end names a vertebra that does not exist.');
  return problems.concat(validateSteps(spine, validateSpine));
}

// the most steps a sketch can hold
export const MOST_STEPS = 12;
// The steps of a file, checked. Each step is put through the check of a whole
// spine (check), as if it were a file of its own. See core/story.js for what steps are. Returns problems in plain words.
function validateSteps(spine, check) {
  const steps = spine.steps;
  if (steps === undefined) return [];
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > MOST_STEPS) return ['The steps of this sketch are not written in a way the app can read.'];
  const problems = [];
  if (steps.filter((s) => s && s.here).length !== 1) problems.push('The file does not say which one of its steps is open.');
  steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') { problems.push('Step ' + (i + 1) + ' is empty.'); return; }
    if (s.caption !== undefined && (typeof s.caption !== 'string' || s.caption.length > 200)) problems.push('Step ' + (i + 1) + ' has words the app cannot use.');
    if (s.here) return;
    for (const p of check({ schema: spine.schema, levels: s.levels, fused: s.fused, hardware: s.hardware, marks: s.marks })) problems.push('Step ' + (i + 1) + ': ' + p);
  });
  return problems;
}
