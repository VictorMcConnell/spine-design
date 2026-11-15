// A small WebGL2 renderer: shaded meshes, an orbiting camera, mouse and touch control.
// It has no dependencies. If the project later moves to a 3D library, only this file and
// scene.js need to change.

import { computeNormals } from '../core/mesh.js';

const VERTEX = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uView, uProj;
out vec3 vNor; out vec3 vPos;
void main() { vec4 p = uView * vec4(aPos, 1.0); vPos = p.xyz; vNor = mat3(uView) * aNor; gl_Position = uProj * p; }`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vPos;
uniform vec3 uColor; uniform float uAlpha;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNor); if (!gl_FrontFacing) n = -n;
  float key = max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  float rim = pow(1.0 - max(dot(n, normalize(-vPos)), 0.0), 3.0);
  vec3 c = uColor * (0.20 + 0.20 * sky + 0.66 * key) + 0.05 * rim;
  outColor = vec4(pow(c, vec3(1.0 / 2.2)) , uAlpha);
}`;

function matMul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function matPerspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = (2 * far * near) / (near - far);
  return o;
}

function matView(eye, target, up) {
  const z = norm3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]), x = norm3(cross3(up, z)), y = cross3(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1]);
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return null;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  const loc = { pos: gl.getAttribLocation(program, 'aPos'), nor: gl.getAttribLocation(program, 'aNor') };
  for (const name of ['uView', 'uProj', 'uColor', 'uAlpha']) loc[name] = gl.getUniformLocation(program, name);

  // the camera looks at "target" from a direction (around, tilt) and a distance
  const camera = { around: 0.5, tilt: 0.12, distance: 900, target: [0, 0, 250] };
  let items = [], matrix = null, pending = false, onDraw = null;

  function setItems(list) {
    for (const it of items) { gl.deleteVertexArray(it.vao); it.buffers.forEach((b) => gl.deleteBuffer(b)); }
    items = list.map((it) => {
      const vao = gl.createVertexArray(), buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(it.mesh.positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[1]); gl.bufferData(gl.ARRAY_BUFFER, computeNormals(it.mesh), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc.nor); gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers[2]); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(it.mesh.indices), gl.STATIC_DRAW);
      return { ...it, vao, buffers, count: it.mesh.indices.length };
    });
    gl.bindVertexArray(null);
    requestDraw();
  }

  function draw() {
    pending = false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(2, Math.round(canvas.clientWidth * ratio)), h = Math.max(2, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = camera, ct = Math.cos(c.tilt);
    const eye = [c.target[0] + c.distance * Math.sin(c.around) * ct, c.target[1] + c.distance * Math.cos(c.around) * ct, c.target[2] + c.distance * Math.sin(c.tilt)];
    const view = matView(eye, c.target, [0, 0, 1]), proj = matPerspective(0.5, w / h, c.distance * 0.05, c.distance * 6);
    matrix = matMul(proj, view);
    gl.viewport(0, 0, w, h); gl.clearColor(0.075, 0.08, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(program);
    gl.uniformMatrix4fv(loc.uView, false, view); gl.uniformMatrix4fv(loc.uProj, false, proj);
    const shown = items.filter((it) => it.visible !== false && it.opacity > 0.01);
    // solid things first, see-through things after them without writing depth
    for (const pass of ['solid', 'clear']) {
      const clear = pass === 'clear';
      gl.depthMask(!clear);
      if (clear) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
      for (const it of shown) {
        if ((it.opacity < 0.995) !== clear) continue;
        gl.uniform3fv(loc.uColor, it.color); gl.uniform1f(loc.uAlpha, it.opacity);
        gl.bindVertexArray(it.vao); gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
      }
    }
    gl.depthMask(true); gl.bindVertexArray(null);
    if (onDraw) onDraw();
  }

  function requestDraw() {
    if (!pending) { pending = true; requestAnimationFrame(draw); }
  }

  // Where a point in the model lands on the screen, in CSS pixels. Null when it is behind the camera.
  function project(point) {
    if (!matrix) return null;
    const m = matrix, x = point[0], y = point[1], z = point[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * canvas.clientWidth, (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5 + 0.5)) * canvas.clientHeight];
  }

  // ---- mouse and touch: drag turns, wheel or pinch zooms, right-drag or two fingers moves
  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY, e.button]); pinch = 0; });
  const release = (e) => { pointers.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    p[0] = e.clientX; p[1] = e.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) camera.distance = Math.max(80, Math.min(4000, camera.distance * pinch / gap));
      pinch = gap; pan(dx / 2, dy / 2);
    } else if (p[2] === 2 || e.shiftKey) pan(dx, dy);
    else { camera.around -= dx * 0.008; camera.tilt = Math.max(-1.45, Math.min(1.45, camera.tilt + dy * 0.008)); }
    requestDraw();
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camera.distance = Math.max(80, Math.min(4000, camera.distance * Math.exp(e.deltaY * 0.0012))); requestDraw(); }, { passive: false });

  function pan(dx, dy) {
    const k = camera.distance * 0.0011, right = [Math.cos(camera.around), -Math.sin(camera.around), 0];
    camera.target = [camera.target[0] - right[0] * dx * k, camera.target[1] - right[1] * dx * k, camera.target[2] + dy * k];
  }

  // Point the camera so that everything between two corners fits on screen.
  function frame(low, high) {
    camera.target = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
    const size = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
    camera.distance = size * (canvas.clientHeight > canvas.clientWidth ? 2.6 : 2.1);
    requestDraw();
  }

  window.addEventListener('resize', requestDraw);
  return { camera, setItems, requestDraw, project, frame, items: () => items, afterDraw: (fn) => { onDraw = fn; } };
}
