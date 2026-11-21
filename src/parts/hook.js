// A hook: a head on the rod and a curved blade that catches the bone. A plain shape of its
// kind: it does not copy any maker's product.

import { vSub, vAdd, vScale, vUnit, vLerp, vCross, vDot, vLen } from '../core/vec.js';
import { appendMesh, tube, arcThrough } from '../core/mesh.js';
import { HARDWARE } from './sizes.js';
import { headMesh, headPlaced } from './head.js';
import { rodDirectionNear } from './rod.js';

// A hook: a head on the rod and a curved blade that catches the bone.
export function hookMesh(hook, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return appendMesh(headMesh(hook.at, hookOut(hook, rodDirection), rodDirection, rodDiameter), hookBlade(hook, rodDirection));
}
// Which way the head of a hook opens: away from where its blade ends, square to the rod.
function hookOut(hook, rodDirection) {
  const away = vSub(hook.at, hook.tip), along = vUnit(rodDirection), flat = vSub(away, vScale(along, vDot(away, along)));
  return vLen(flat) > 1 ? flat : vSub(hook.at, hook.mid || vLerp(hook.at, hook.tip, 0.5));
}

// The same hook in two pieces for the screen: the blade, and the head as a placed shape.
export function hookParts(hook, rodDirection = [0, 0, 1], rodDiameter = HARDWARE.rodDiameter) {
  return { blade: hookBlade(hook, rodDirection), head: headPlaced(hook.at, hookOut(hook, rodDirection), rodDirection, rodDiameter) };
}

function hookBlade(hook, rodDirection) {
  const mid = hook.mid || vLerp(hook.at, hook.tip, 0.5), kind = HARDWARE.hooks[hook.kind] || HARDWARE.hooks.lamina;
  // the foot starts under the head, turns at the heel and runs to the toe: a flat shoe, as wide as the head
  const start = vAdd(hook.at, vScale(vUnit(vSub(mid, hook.at)), 2.5));
  let across = vCross(vSub(mid, hook.at), vSub(hook.tip, hook.at));
  across = vLen(across) > 1e-6 ? vUnit(across) : rodDirection;
  return tube(arcThrough(start, mid, hook.tip, 16), (t) => [kind.width / 2 + 0.6, kind.thick * (1.5 - 0.5 * t)], across, 14);
}

// What the scene draws for one hook: the blade, and the head as a shape that is drawn once
// and placed.
//   around: { rods, rodSize(id) } what the hook sits among
export function hookItems(hook, index, around) {
  const parts = hookParts(hook, rodDirectionNear(around.rods, hook.at), around.rodSize(hook.rod));
  const name = 'hook_' + (hook.level || index + 1) + '_' + (hook.side || '');
  return [{ mesh: parts.blade, name }, { mesh: parts.head.mesh, matrix: parts.head.matrix, name }];
}
