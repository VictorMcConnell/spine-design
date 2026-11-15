// Turns a spine file into the list of things the renderer draws.

import { sortedLevels, isFused } from '../core/spinefile.js';
import { vertebraMesh, discMesh } from '../core/bones.js';
import { rodMesh, screwMesh, hookMesh, crosslinkMesh } from '../core/hardware.js';
import { tube, ball } from '../core/mesh.js';

const COLORS = {
  bone: [0.83, 0.76, 0.62], disc: [0.33, 0.52, 0.74], fusedDisc: [0.62, 0.58, 0.5],
  rod: [0.16, 0.33, 0.72], screw: [0.72, 0.74, 0.78], hook: [0.5, 0.36, 0.78], crosslink: [0.16, 0.33, 0.72], pain: [0.95, 0.25, 0.2],
};

// Parts the person placed by guessing are drawn paler than parts taken from a scan or an X-ray.
const sourceOpacity = (source) => (source === 'guessed' ? 0.5 : 1);

export function buildScene(spine) {
  const items = [], levels = sortedLevels(spine), hw = spine.hardware || {};
  const add = (group, mesh, color, opacity = 1) => items.push({ group, mesh, color, opacity, baseOpacity: opacity, visible: true });
  for (const level of levels) add('vertebrae', vertebraMesh(level), COLORS.bone, sourceOpacity(level.source));
  for (let i = 0; i < levels.length - 1; i++) {
    const fused = isFused(spine, levels[i].id) && isFused(spine, levels[i + 1].id);
    add('discs', discMesh(levels[i], levels[i + 1]), fused ? COLORS.fusedDisc : COLORS.disc);
  }
  for (const rod of hw.rods || []) add('rods', rodMesh(rod), COLORS.rod, sourceOpacity(rod.source));
  for (const screw of hw.screws || []) add('screws', screwMesh(screw), COLORS.screw, sourceOpacity(screw.source));
  for (const hook of hw.hooks || []) add('hooks', hookMesh(hook), COLORS.hook, sourceOpacity(hook.source));
  for (const link of hw.crosslinks || []) add('crosslinks', crosslinkMesh(link), COLORS.crosslink, sourceOpacity(link.source));
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
