// Small 3D vector helpers. Vectors are plain arrays [x, y, z].
// Frame used everywhere: x = patient left, y = back, z = up, in millimetres.

export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vLerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vDist = (a, b) => vLen(vSub(a, b));

export function vUnit(a) {
  const l = vLen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Turn vector v about the unit axis k by an angle in radians.
export function vRotate(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), kxv = vCross(k, v), kv = vDot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));
}

const RAD = Math.PI / 180;

// The three axes of a vertebra from the numbers stored in a spine file.
//   tilt = [front, side] in degrees: how far the top of the vertebra leans to the left (front view)
//          and to the back (side view)
//   turn = degrees the vertebra is turned about its own axis; plus means its front faces left
// The tilt is applied first, the shortest way, and the turn afterwards. That keeps a strong tilt
// from being mistaken for a turn.
export function frameFromTilt(tilt, turn) {
  const up = vUnit([Math.tan(tilt[0] * RAD), Math.tan(tilt[1] * RAD), 1]);
  const z = [0, 0, 1];
  let left = [1, 0, 0];
  const axis = vCross(z, up), s = vLen(axis);
  if (s > 1e-9) left = vRotate(left, vScale(axis, 1 / s), Math.atan2(s, vDot(z, up)));
  left = vRotate(left, up, turn * RAD);
  return { left, back: vCross(up, left), up };
}

// The reverse of frameFromTilt: tilt and turn from the axes of a vertebra.
export function tiltFromFrame(frame) {
  const { left, up } = frame;
  const tilt = [Math.atan2(up[0], up[2]) / RAD, Math.atan2(up[1], up[2]) / RAD];
  const untwisted = frameFromTilt(tilt, 0).left;
  const turn = Math.atan2(vDot(vCross(untwisted, left), up), vDot(untwisted, left)) / RAD;
  return { tilt, turn };
}

// A point given in a vertebra's own axes (left, back, up) moved into the world.
export function toWorld(local, centre, frame) {
  return [0, 1, 2].map((i) => centre[i] + frame.left[i] * local[0] + frame.back[i] * local[1] + frame.up[i] * local[2]);
}
