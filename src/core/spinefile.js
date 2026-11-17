// The spine file: one small JSON document that everything else reads.
// See docs/spine-file.md for the format in words.

export const SCHEMA_VERSION = 1;

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
// the names a colour of hardware can have in a file (the colours themselves are in hardware.js)
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
    if (l.source && !SOURCES.includes(l.source)) problems.push(name + ' has an unknown source: ' + l.source + '.');
  }
  for (const pair of spine.fused || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((id) => LEVEL_ORDER.includes(id))) problems.push('A fused stretch is not written as [top, bottom].');
  }
  const hw = spine.hardware || {};
  for (const r of hw.rods || []) {
    if (!Array.isArray(r.points) || r.points.length < 2 || !r.points.every(isPoint)) problems.push('A rod has no usable path.');
    if (r.via !== undefined && (!Array.isArray(r.via) || !r.via.every(isPoint))) problems.push('A rod has a bend the app cannot use.');
  }
  for (const s of hw.screws || []) if (!isPoint(s.head) || !isPoint(s.tip)) problems.push('A screw at ' + (s.level || '?') + ' has no usable position.');
  for (const h of hw.hooks || []) {
    if (!isPoint(h.at) || !isPoint(h.tip)) problems.push('A hook at ' + (h.level || '?') + ' has no usable position.');
    if (h.faces !== undefined && h.faces !== 'up' && h.faces !== 'down') problems.push('A hook at ' + (h.level || '?') + ' faces neither up nor down.');
  }
  for (const c of hw.crosslinks || []) if (!isPoint(c.from) || !isPoint(c.to)) problems.push('A cross-link has no usable position.');
  if (hw.norods !== undefined && typeof hw.norods !== 'boolean') problems.push('The file says whether the rods are on in a way the app cannot read.');
  for (const m of spine.marks || []) if (m && m.label !== undefined && !isPoint(m.label)) problems.push('A label of a pain point or a note has no usable position.');
  for (const kind of ['screws', 'hooks', 'crosslinks']) for (const piece of hw[kind] || []) if (piece.locked !== undefined && typeof piece.locked !== 'boolean') problems.push('A part says it is frozen in a way the app cannot read.');
  for (const [kind, color] of Object.entries(hw.colors || {})) if (!['rods', 'screws', 'hooks', 'crosslinks'].includes(kind) || !/^([a-z]+|#[0-9a-f]{6})$/i.test(color) || (color[0] !== '#' && !COLOR_NAMES.includes(color))) problems.push('The colour given for the ' + kind + ' is not one this app knows.');
  if (hw.splits !== undefined && (!Array.isArray(hw.splits) || hw.splits.some((x) => typeof x !== 'string' || !LEVEL_ORDER.includes(x.split(':')[0]) || !['', 'left', 'right'].includes(x.split(':')[1] || '') || x.split(':').length > 2))) problems.push('The list of places where the rods end names a vertebra that does not exist.');
  return problems;
}
