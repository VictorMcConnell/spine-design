// A sketch with steps: the same spine at several moments, such as before and after an
// operation, each with a few words to go with it.
//
// In the file the spine that is open stays where it always was, at the top level, so a
// reader that knows nothing of steps still shows a spine. The other steps are kept in
// "steps", in their order, each with the four things that make a spine what it is. The
// place of the open one is held by an entry that says "here":
//
//   "steps": [ { "caption": "Before", "levels": [...], "fused": [...], "hardware": {...}, "marks": [...] },
//              { "caption": "After", "here": true } ]

import { carry } from './shape.js';
import { fitRods } from './place.js';
import { MOST_STEPS, LEVEL_ORDER } from './spinefile.js';

// what differs from step to step
const BODY = ['levels', 'fused', 'hardware', 'marks'];
const copy = (x) => JSON.parse(JSON.stringify(x));
const round2 = (v) => Math.round(v * 100) / 100;

// How many steps a sketch has (one when it has none written down), and which is open.
export const stepCount = (spine) => (Array.isArray(spine.steps) && spine.steps.length ? spine.steps.length : 1);
export const stepHere = (spine) => (Array.isArray(spine.steps) ? Math.max(0, spine.steps.findIndex((s) => s.here)) : 0);
export const captionOf = (spine, i) => (Array.isArray(spine.steps) && spine.steps[i] ? spine.steps[i].caption || '' : '');

// A step as a spine of its own, to draw or to compare. The open step is the sketch itself.
export function stepSpine(spine, i) {
  if (i === stepHere(spine)) return spine;
  const s = spine.steps[i], out = { schema: spine.schema, name: spine.name, about: spine.about };
  for (const key of BODY) out[key] = s[key];
  out.fused = out.fused || []; out.marks = out.marks || [];
  out.hardware = out.hardware || {};
  for (const key of ['rods', 'screws', 'hooks', 'crosslinks']) out.hardware[key] = out.hardware[key] || [];
  return out;
}

// Add a step after the open one. It starts as a copy of the open one and becomes the open one.
// Returns false when the sketch is full.
export function addStep(spine, caption) {
  if (stepCount(spine) >= MOST_STEPS) return false;
  if (!Array.isArray(spine.steps) || !spine.steps.length) spine.steps = [{ caption: 'Step 1', here: true }];
  const i = stepHere(spine), was = { caption: spine.steps[i].caption || '' };
  for (const key of BODY) was[key] = copy(spine[key] === undefined ? (key === 'hardware' ? {} : []) : spine[key]);
  spine.steps[i] = was;
  spine.steps.splice(i + 1, 0, { caption: caption || 'Step ' + (spine.steps.length + 1), here: true });
  return true;
}

// Open another step: the open one is put away in its place and the other is taken out.
export function goStep(spine, to) {
  const i = stepHere(spine);
  if (!Array.isArray(spine.steps) || to === i || to < 0 || to >= spine.steps.length) return false;
  const away = { caption: spine.steps[i].caption || '' }, next = spine.steps[to];
  for (const key of BODY) away[key] = spine[key];
  for (const key of BODY) spine[key] = next[key] === undefined ? (key === 'hardware' ? {} : []) : next[key];
  spine.steps[i] = away;
  spine.steps[to] = { caption: next.caption || '', here: true };
  return true;
}

// Take a step out. The open one cannot go while it is open: the one before it (or after it) is opened first.
// With one step left the sketch is a plain sketch again.
export function removeStep(spine, i) {
  if (stepCount(spine) < 2 || i < 0 || i >= spine.steps.length) return false;
  if (i === stepHere(spine)) goStep(spine, i > 0 ? i - 1 : 1);
  spine.steps.splice(i, 1);
  if (spine.steps.length < 2) delete spine.steps;
  return true;
}

// Move a step one place up the order (by -1) or down it (by 1).
export function moveStep(spine, i, by) {
  const j = i + by;
  if (stepCount(spine) < 2 || i < 0 || j < 0 || i >= spine.steps.length || j >= spine.steps.length) return false;
  const s = spine.steps;
  [s[i], s[j]] = [s[j], s[i]];
  return true;
}

export function setCaption(spine, i, text) {
  if (!Array.isArray(spine.steps) || !spine.steps[i]) return false;
  spine.steps[i].caption = String(text || '').slice(0, 80);
  return true;
}

// A spine part of the way from one step to another: t is 0 at "a" and 1 at "b".
// Every vertebra the two share goes evenly from where it is in one to where it is in the other. The
// hardware and the marks of one of the two ride along with the bones: those of the step
// that has hardware when only one has it, and else those of the nearer step.
// Returns { spine, fade }: fade is how solid the hardware is drawn, so that hardware
// that only one step has comes in softly and does not jump onto the bones.
export function blend(a, b, t) {
  if (t <= 0) return { spine: a, fade: 1 };
  if (t >= 1) return { spine: b, fade: 1 };
  const parts = (s) => { const h = s.hardware || {}; return (h.screws || []).length + (h.hooks || []).length + (h.norods ? 0 : (h.rods || []).length); };
  const pa = parts(a), pb = parts(b), fromB = pa && pb ? t >= 0.5 : pb > 0 || (!pa && t >= 0.5);
  const base = copy(fromB ? b : a), other = fromB ? a : b, k = fromB ? 1 - t : t, there = {}, here = {};
  for (const l of other.levels) there[l.id] = l;
  for (const l of base.levels) here[l.id] = l;
  // Two steps need not have the same vertebrae (one may be drawn without its neck). The ones they share are
  // blended. One that only a single step has goes along with the nearest shared vertebra, and is drawn while
  // the blend is nearer to its own step.
  const order = (id) => LEVEL_ORDER.indexOf(id), shared = base.levels.filter((l) => there[l.id]).map((l) => l.id);
  if (shared.length < 2) return { spine: t < 0.5 ? a : b, fade: 1 };
  const near = (id) => shared.reduce((best, x) => (Math.abs(order(x) - order(id)) < Math.abs(order(best) - order(id)) ? x : best), shared[0]);
  const lone = (l, from, to, much) => {
    // (where a vertebra of one step would be, moved the way its nearest shared vertebra moves: "much" of the way)
    const n = near(l.id), p = from[n], q = to[n];
    return { ...copy(l), centre: l.centre.map((v, j) => round2(v + (q.centre[j] - p.centre[j]) * much)), tilt: l.tilt.map((v, j) => round2(Math.max(-80, Math.min(80, v + (q.tilt[j] - p.tilt[j]) * much)))), turn: round2(l.turn + (q.turn - p.turn) * much) };
  };
  const mix = (x, y) => round2(x + (y - x) * k), was = {};
  for (const l of base.levels) was[l.id] = copy(l);
  carry(base, () => {
    for (const l of base.levels) {
      const o = there[l.id] || lone(l, was, there, 1);
      l.centre = l.centre.map((v, j) => mix(v, o.centre[j])); l.tilt = l.tilt.map((v, j) => mix(v, o.tilt[j]));
      l.turn = mix(l.turn, o.turn);     // (each vertebra keeps its own size: a shape for every size on the way would have to be made anew for every picture)
    }
  });
  if (k > 0.5) {
    base.levels = base.levels.filter((l) => there[l.id]);
    for (const l of other.levels) if (!here[l.id]) base.levels.push(lone(l, there, was, 1 - k));
  }
  if (((base.hardware || {}).rods || []).some((r) => r.auto)) fitRods(base);
  const ease = (x) => Math.max(0, Math.min(1, x));
  return { spine: base, fade: pa && pb ? 1 : pb ? ease((t - 0.3) / 0.5) : pa ? ease((0.7 - t) / 0.5) : 1 };
}
