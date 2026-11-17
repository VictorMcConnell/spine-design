// The handles drawn on the model for the thing that is selected: arrows to move it, rings to
// turn it, knobs to resize it. They are drawn on top of everything, stay the same size on
// screen, and are found by how close the pointer is to them on screen.
//
// A set of handles is { at: [x, y, z], handles: [{ name, kind, axis }] } where kind is
// 'arrow' (one way), 'double' (both ways), 'ring' (turn about the axis) or 'knob' (resize).

import { tube, ball, appendMesh } from '../core/mesh.js';
import { vCross, vUnit } from '../core/vec.js';

export const GIZMO_PX = 92;          // length of a handle on screen, in pixels
const COLORS = { left: [0.96, 0.33, 0.33], back: [0.36, 0.85, 0.42], up: [0.38, 0.55, 1] };

// The shapes, one unit long, pointing along z. Made once.
const line = (from, to, steps) => Array.from({ length: steps + 1 }, (_, i) => [0, 0, from + ((to - from) * i) / steps]);
const SHAFT = 0.02, HEAD = 0.075, NECK = 0.76;
const SHAPES = {
  arrow: tube(line(0.16, 1, 42), (t) => { const z = 0.16 + 0.84 * t; return z < NECK ? [SHAFT, SHAFT] : [(HEAD * (1 - z)) / (1 - NECK), (HEAD * (1 - z)) / (1 - NECK)]; }, [1, 0, 0], 12),
  double: tube(line(-1, 1, 100), (t) => { const z = Math.abs(2 * t - 1); const r = z < NECK ? SHAFT : (HEAD * (1 - z)) / (1 - NECK); return [r, r]; }, [1, 0, 0], 12),
  ring: tube(Array.from({ length: 73 }, (_, i) => [Math.cos((i / 72) * 2 * Math.PI), Math.sin((i / 72) * 2 * Math.PI), 0]), () => [0.016, 0.016], [0, 0, 1], 8),
  knob: appendMesh(tube(line(0.16, 0.9, 8), () => [SHAFT, SHAFT], [1, 0, 0], 10), ball([0, 0, 0.95], 0.075)),
};

// The things to draw for a set of handles. The renderer sizes them (see "pinned" there).
export function gizmoItems(spec, active) {
  return spec.handles.map((h) => {
    const z = vUnit(h.axis), x = vUnit(vCross(Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], z)), y = vCross(z, x);
    const color = active === h.name ? [1, 0.9, 0.35] : COLORS[h.name] || [1, 1, 1];
    return { group: 'gizmo', mesh: SHAPES[h.kind], color, opacity: 1, baseOpacity: 1, visible: true, overlay: true, pinned: { at: spec.at, px: GIZMO_PX, basis: [x, y, z] } };
  });
}

// The points along a handle that the pointer can grab, in units of its length. The middle is
// left free, so the thing itself can still be clicked and dragged there.
function grabPoints(h) {
  const z = vUnit(h.axis), out = [];
  if (h.kind === 'ring') {
    const x = vUnit(vCross(Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], z)), y = vCross(z, x);
    for (let i = 0; i < 60; i++) { const a = (i / 60) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); out.push([x[0] * c + y[0] * s, x[1] * c + y[1] * s, x[2] * c + y[2] * s]); }
  } else {
    for (let t = h.kind === 'double' ? -1 : 0.3; t <= 1.001; t += 0.1) if (Math.abs(t) > 0.29) out.push([z[0] * t, z[1] * t, z[2] * t]);
  }
  return out;
}

// Which handle is under the pointer, if any: { handle, grab } where grab is the point of the
// handle that was caught (in units of its length, from the middle). "reach" is how close
// counts, in pixels. An arrow that points straight at the eye cannot be grabbed.
export function gizmoHit(spec, renderer, clientX, clientY, reach = 13) {
  const box = renderer.canvas.getBoundingClientRect(), size = renderer.screenScale(spec.at).perPixel * GIZMO_PX, c = renderer.project(spec.at);
  let best = null;
  if (!c) return null;
  for (const h of spec.handles) {
    if (h.kind !== 'ring') {
      const z = vUnit(h.axis), tip = renderer.project([spec.at[0] + z[0] * size, spec.at[1] + z[1] * size, spec.at[2] + z[2] * size]);
      if (!tip || Math.hypot(tip[0] - c[0], tip[1] - c[1]) < GIZMO_PX * 0.3) continue;
    }
    for (const g of grabPoints(h)) {
      const p = renderer.project([spec.at[0] + g[0] * size, spec.at[1] + g[1] * size, spec.at[2] + g[2] * size]);
      if (!p) continue;
      const d = Math.hypot(p[0] + box.left - clientX, p[1] + box.top - clientY);
      if (d <= reach && (!best || d < best.d)) best = { handle: h, grab: g, d };
    }
  }
  return best && { handle: best.handle, grab: best.grab };
}

// How far a drag on screen (dx, dy in pixels) moves along a handle's axis, in millimetres.
export function dragAlong(spec, handle, renderer, dx, dy) {
  const s = renderer.screenScale(spec.at), axis = vUnit(handle.axis);
  return [0, 1, 2].reduce((sum, j) => sum + (s.right[j] * dx - s.up[j] * dy) * s.perPixel * axis[j], 0);
}

// How far a drag on screen turns a ring about its axis, in degrees (right-hand rule). The
// ring was caught at "grab". Turning moves that point along the ring, so the drag is read
// along the direction the point would travel on screen. That works from any side, also when
// the ring is seen edge-on.
export function dragAround(spec, handle, renderer, grab, dx, dy) {
  const size = renderer.screenScale(spec.at).perPixel * GIZMO_PX, along = vCross(vUnit(handle.axis), grab);
  const here = renderer.project([0, 1, 2].map((j) => spec.at[j] + grab[j] * size)), there = renderer.project([0, 1, 2].map((j) => spec.at[j] + (grab[j] + along[j] * 0.25) * size));
  if (!here || !there) return 0;
  const way = [there[0] - here[0], there[1] - here[1]], perRadian = Math.max(24, Math.hypot(way[0], way[1]) * 4), n = Math.hypot(way[0], way[1]) || 1;
  return (((dx * way[0] + dy * way[1]) / n / perRadian) * 180) / Math.PI;
}
