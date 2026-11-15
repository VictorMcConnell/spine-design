// Turns a spine file into the list of things the renderer draws.

import { sortedLevels, isFused } from '../core/spinefile.js';
import { vertebraMesh, discMesh } from '../core/bones.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh, rodDirectionNear, FINISHES, HARDWARE } from '../core/hardware.js';
import { tube, ball } from '../core/mesh.js';

const COLORS = { bone: [0.78, 0.68, 0.52], disc: [0.33, 0.52, 0.74], fusedDisc: [0.6, 0.56, 0.48], pain: [0.95, 0.25, 0.2] };
const DEFAULT_FINISH = { rods: 'blue', screws: 'titanium', hooks: 'purple', crosslinks: 'blue' };

// Parts the person placed by guessing are drawn paler than parts taken from a scan or an X-ray.
const sourceOpacity = (source) => (source === 'guessed' ? 0.5 : 1);

//   detail: size of the grid the bones are sampled on, in millimetres (smaller = smoother, slower)
export function buildScene(spine, detail) {
  const items = [], levels = sortedLevels(spine), hw = spine.hardware || {};
  const add = (group, mesh, color, opacity = 1) => items.push({ group, mesh, color, opacity, baseOpacity: opacity, visible: true });
  const finish = (group, piece) => FINISHES[piece.color] || FINISHES[DEFAULT_FINISH[group]];
  for (const level of levels) add('vertebrae', vertebraMesh(level, detail), COLORS.bone, sourceOpacity(level.source));
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i].id === 'C1') continue;          // the atlas sits on the axis without a disc
    const fused = isFused(spine, levels[i].id) && isFused(spine, levels[i + 1].id);
    add('discs', discMesh(levels[i], levels[i + 1]), fused ? COLORS.fusedDisc : COLORS.disc);
  }
  const rodSize = (id) => ((hw.rods || []).find((r) => r.id === id) || {}).diameter || HARDWARE.rodDiameter;
  for (const rod of hw.rods || []) add('rods', rodMesh(rod), finish('rods', rod), sourceOpacity(rod.source));
  for (const screw of hw.screws || []) add('screws', screwMesh(screw, rodDirectionNear(hw.rods, screw.head), rodSize(screw.rod)), finish('screws', screw), sourceOpacity(screw.source));
  for (const hook of hw.hooks || []) add('hooks', hookMesh(hook, rodDirectionNear(hw.rods, hook.at), rodSize(hook.rod)), finish('hooks', hook), sourceOpacity(hook.source));
  for (const link of hw.crosslinks || []) add('crosslinks', crosslinkMesh(link), finish('crosslinks', link), sourceOpacity(link.source));
  for (const mark of spine.marks || []) {
    if (mark.kind !== 'pain') continue;
    const r = mark.radius || 15;
    if (mark.at) add('marks', ball(mark.at, r), COLORS.pain, 0.3);
    else if (mark.from && mark.to) add('marks', tube([mark.from, mark.to], () => [r, r], [1, 0, 0], 18), COLORS.pain, 0.22);
  }
  return items;
}

// The two corners of the box that holds every vertebra.
export function boundsOf(spine) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const l of spine.levels) for (let i = 0; i < 3; i++) { low[i] = Math.min(low[i], l.centre[i] - 40); high[i] = Math.max(high[i], l.centre[i] + 40); }
  return { low, high };
}
