// The discs: what each one is (standard, thin, bulging, herniated, dried out or gone). These
// are general pictures of their kind for a sketch, not a reading of anyone's scan.
// A disc is named by the two vertebrae it sits between, upper first: 'L4/L5'. The spine file
// keeps only the discs that are not standard, under "discs".

import { sortedLevels, DISC_STATES, DISC_SIDES } from './spinefile.js';
import { liftLevel, gapUnder } from './shape.js';

export const discKey = (upper, lower) => upper + '/' + lower;
// The states that come in a size ("amount", 0.1 to 1) and the ones that push to a side ("toward").
export const DISC_SIZED = ['thin', 'bulging', 'herniated'];
export const DISC_AIMED = ['bulging', 'herniated'];
// How much of its height a thin disc has lost at the most.
const MOST_LOST = 0.75;
const round3 = (v) => Math.round(v * 1000) / 1000;   // (fine enough that the space opens again to where it was)

// The names of the discs of a spine, from the top down. The atlas sits on the axis without one.
export function discKeys(spine) {
  const levels = sortedLevels(spine), out = [];
  for (let i = 0; i < levels.length - 1; i++) if (levels[i].id !== 'C1') out.push(discKey(levels[i].id, levels[i + 1].id));
  return out;
}
// Can a spacer sit at the back of this disc? Between two vertebrae of the low back, where these are
// used. Not above the sacrum, which has no process for it to rest on. (One that a file already has
// somewhere else is kept and drawn.)
export const canSpace = (key) => /^L\d\/L\d$/.test(key);
// Where a plate on the front can go: in the neck from C2/C3 down to C7/T1, and from T11/T12 down to
// the sacrum. Higher in the chest the heart and the large vessels lie in front of the spine.
const PLATED = ['C2/C3', 'C3/C4', 'C4/C5', 'C5/C6', 'C6/C7', 'C7/T1', 'T11/T12', 'T12/L1', 'L1/L2', 'L2/L3', 'L3/L4', 'L4/L5', 'L5/S1'];
export const canPlate = (key) => PLATED.includes(key);
// The rule for each of the two in words, for the person who presses somewhere else.
export const WHERE = { plate: 'A plate on the front goes in the neck (C2 to T1) or the low back (T11 to the sacrum).', spacer: 'A spacer at the back goes between two vertebrae of the low back (L1 to L5).' };
// What the file says of a disc, or { state: 'standard' }.
export const discAt = (spine, key) => (spine.discs && spine.discs[key]) || { state: 'standard' };

// Change a disc. "change" holds what is new: { state, amount, toward, spacer }, any of them.
// "spacer" (true or false) puts a block between the two back processes or takes it away, and
// "plate" a plate on the front of the two bones. Both go with any state of the disc.
// A thin disc closes the space it sits in, and the spine above comes down with it. The disc
// remembers by how much ("drop", in millimetres), so the space opens again when the disc is
// made something else. A space inside a fused stretch that is held stiff does not move.
// Run this inside carry (shape.js) so the hardware and the marks come along.
// Returns the disc as it is now, or null if the spine has no such disc.
export function setDisc(spine, rig, key, change) {
  if (!discKeys(spine).includes(key)) return null;
  const upper = key.split('/')[0], was = discAt(spine, key), next = { ...was, ...change };
  if (!DISC_STATES.includes(next.state)) return null;
  const amount = Math.max(0.1, Math.min(1, typeof next.amount === 'number' ? next.amount : 0.5));
  const before = gapUnder(spine, rig, upper), natural = before + (was.drop || 0);
  const want = next.state === 'thin' ? Math.max(0.5, natural * (1 - MOST_LOST * amount)) : natural;
  if (Math.abs(want - before) > 0.01) liftLevel(spine, rig, upper, want - before);
  const drop = round3(natural - gapUnder(spine, rig, upper));
  const now = { state: next.state, ...(DISC_SIZED.includes(next.state) ? { amount } : {}), ...(DISC_AIMED.includes(next.state) ? { toward: DISC_SIDES.includes(next.toward) ? next.toward : 'back' } : {}), ...(drop > 0.04 ? { drop } : {}), ...(next.spacer && (canSpace(key) || was.spacer) ? { spacer: true } : {}), ...(next.plate && (canPlate(key) || was.plate) ? { plate: true } : {}) };
  spine.discs = { ...(spine.discs || {}) };
  if (now.state === 'standard' && !now.drop && !now.spacer && !now.plate) delete spine.discs[key]; else spine.discs[key] = now;
  if (!Object.keys(spine.discs).length) delete spine.discs;
  return now;
}

// A disc in a few words: 'bulging to the back left'.
const WORDS = { standard: 'standard', thin: 'thin', bulging: 'bulging', herniated: 'herniated', dried: 'dried out', none: 'gone', replacement: 'replaced by an artificial disc', cage: 'replaced by a fusion cage', 'cage-screws': 'replaced by a fusion cage with its own screws' };
export function discWords(disc) {
  return WORDS[disc.state] + (DISC_AIMED.includes(disc.state) ? ' to the ' + (disc.toward || 'back').replace('-', ' ') : '') + (disc.plate ? ', with a plate on the front' : '') + (disc.spacer ? ', with a spacer at the back' : '');
}
