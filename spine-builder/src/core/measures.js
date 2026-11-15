// Numbers read off a spine: curves seen from the front, the rounding of the chest part
// (kyphosis), the hollow of the lower back (lordosis) and the largest turn.
// They are taken between the axes of the vertebral bodies. A Cobb angle drawn on an X-ray uses
// the end plates and can differ by a few degrees.

import { sortedLevels, isHeld } from './spinefile.js';

export function measureSpine(spine) {
  const levels = sortedLevels(spine), front = levels.map((l) => l.tilt[0]), side = levels.map((l) => l.tilt[1]);
  const at = (id) => levels.findIndex((l) => l.id === id);

  // turning points of the front tilt, ignoring wiggles under 5 degrees
  let turns = [0];
  for (let i = 1; i < front.length - 1; i++) if ((front[i] - front[i - 1]) * (front[i + 1] - front[i]) < 0) turns.push(i);
  turns.push(front.length - 1);
  for (;;) {
    const steps = turns.slice(1).map((t, k) => Math.abs(front[t] - front[turns[k]]));
    const smallest = steps.indexOf(Math.min(...steps));
    if (turns.length <= 2 || steps[smallest] >= 5) break;
    if (smallest === 0) turns.splice(1, 1);
    else if (smallest === steps.length - 1) turns.splice(smallest, 1);
    else turns.splice(smallest, 2);
  }

  const curves = [];
  for (let k = 0; k < turns.length - 1; k++) {
    const a = turns[k], b = turns[k + 1], degrees = Math.abs(front[a] - front[b]);
    if (degrees < 10) continue;
    // the vertebra furthest from the straight line between the two ends, seen from the front
    const ca = levels[a].centre, cb = levels[b].centre;
    let apex = a, off = 0;
    for (let i = a; i <= b; i++) {
      const c = levels[i].centre, d = (c[0] - ca[0]) - ((c[2] - ca[2]) * (cb[0] - ca[0])) / (cb[2] - ca[2]);
      if (Math.abs(d) > Math.abs(off)) { off = d; apex = i; }
    }
    curves.push({
      top: levels[a].id, bottom: levels[b].id, degrees: Math.round(degrees), apex: levels[apex].id,
      bowsTo: off > 0 ? 'left' : 'right', offset: Math.round(Math.abs(off)),
      // true when both ends are held still by fusion or hardware, so the angle does not change with posture
      held: isHeld(spine, levels[a].id) && isHeld(spine, levels[b].id),
    });
  }

  const between = (upper, lower) => (at(upper) >= 0 && at(lower) >= 0 ? Math.round(side[at(lower)] - side[at(upper)]) : null);
  const lordosis = between('L1', 'L5');
  return { curves, kyphosis: between('T5', 'T12'), lordosis: lordosis === null ? null : -lordosis };
}
