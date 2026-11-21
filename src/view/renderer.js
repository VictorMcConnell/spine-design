// A small WebGL2 renderer: shaded meshes in a choice of shadings, a second pass for soft
// shadow and ink lines, an orbiting camera, mouse and touch control.
// It has no dependencies. If the project later moves to a 3D library, only this file and
// scene.js need to change.

import { computeNormals } from '../core/mesh.js';
import { KINDS } from '../parts/kinds.js';
import { VERTEX, FRAGMENT, FACING, SCREEN, SHADE, MIX } from './shaders.js';

// The shadings a person can choose from.
//   mode: which branch of the surface shader, shadow: how dark closed-in places get, ink: edge lines,
//   night: drawn on black whatever background is chosen, because it is made of light
// The last six are for fun.
export const SHADINGS = {
  soft: { mode: 0, shadow: 1, ink: 0 },
  clay: { mode: 1, shadow: 1.25, ink: 0 },
  drawing: { mode: 2, shadow: 0.5, ink: 1 },
  xray: { mode: 3, shadow: 0, ink: 0, night: true },
  plain: { mode: 4, shadow: 0, ink: 0 },
  matte: { mode: 7, shadow: 1.35, ink: 0 },
  chrome: { mode: 5, shadow: 0.7, ink: 0 },
  gold: { mode: 6, shadow: 0.7, ink: 0 },
  candy: { mode: 8, shadow: 0.8, ink: 0 },
  rainbow: { mode: 10, shadow: 0.8, ink: 0 },
  neon: { mode: 9, shadow: 0, ink: 0, night: true },
};
// What a thing is made of, for the surface shader: bone, disc or metal (every kind of part). Anything else is 3.
const MADE_OF = { vertebrae: 0, discs: 1, ...Object.fromEntries(KINDS.map((k) => [k, 2])) };

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

const NO_CRACK = new Float32Array(4);
const FOV = 0.5;          // how wide the view is, top to bottom, in radians

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return null;
  // A shader program and the places of its settings. Every program reads the points of a
  // shape from slot 0 and their facing from slot 1.
  function programOf(vertex, fragment, names) {
    const made = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(made, shader);
    }
    gl.bindAttribLocation(made, 0, 'aPos'); gl.bindAttribLocation(made, 1, 'aNor');
    gl.linkProgram(made);
    if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made));
    const at = { program: made };
    for (const name of names) at[name] = gl.getUniformLocation(made, name);
    return at;
  }
  const loc = { pos: 0, nor: 1, ...programOf(VERTEX, FRAGMENT, ['uView', 'uProj', 'uModel', 'uColor', 'uAlpha', 'uMode', 'uKind', 'uWear', 'uCrack', 'uCut', 'uSnap', 'uBone']) }, program = loc.program;

  // The second pass needs two pictures to draw into: the depth of the scene and the shading
  // worked out from it. If this device cannot provide them, the second pass is left out.
  let shading = SHADINGS.soft, second = null, secondFails = false, bare = false;
  function secondPass(w, h) {
    if (secondFails) return null;
    if (second && second.w === w && second.h === h) return second;
    try {
      if (second) { gl.deleteTexture(second.depth); gl.deleteTexture(second.facing); gl.deleteTexture(second.shade); gl.deleteFramebuffer(second.depthTo); gl.deleteFramebuffer(second.shadeTo); }
      else second = { only: programOf(VERTEX, FACING, ['uView', 'uProj', 'uModel', 'uCut']), work: programOf(SCREEN, SHADE, ['uDepth', 'uFacing', 'uLens', 'uTexel', 'uReach']), lay: programOf(SCREEN, MIX, ['uShade', 'uTexel', 'uShadow', 'uInk']) };
      const picture = (inner, format, type, smooth) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, inner, w, h, 0, format, type, null);
        for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, smooth], [gl.TEXTURE_MAG_FILTER, smooth], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
        return t;
      };
      second.depth = picture(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      second.facing = picture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      second.shade = picture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
      second.depthTo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, second.depthTo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, second.depth, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, second.facing, 0);
      const first = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      second.shadeTo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, second.shadeTo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, second.shade, 0);
      if (first !== gl.FRAMEBUFFER_COMPLETE || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('no place to draw the second pass into');
      second.w = w; second.h = h;
    } catch (e) { secondFails = true; second = null; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    return second;
  }

  // the camera looks at "target" from a direction (around, tilt) and a distance
  const camera = { around: 0.5, tilt: 0.12, distance: 900, target: [0, 0, 250] };
  let items = [], matrix = null, pending = false, only = null, onDraw = null, tool = null, back = [0.075, 0.08, 0.1];
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Shapes already sent to the graphics card, kept by mesh. A mesh that shows up again in the
  // next list (a vertebra that only moved) is not sent twice. An item can carry a "matrix"
  // that places its mesh in the world.
  let sent = new Map();

  function setItems(list) {
    const next = new Map();
    items = list.map((it) => {
      let g = sent.get(it.mesh) || next.get(it.mesh);
      if (!g) {
        const vao = gl.createVertexArray(), buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(it.mesh.positions), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[1]); gl.bufferData(gl.ARRAY_BUFFER, computeNormals(it.mesh), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc.nor); gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers[2]); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(it.mesh.indices), gl.STATIC_DRAW);
        g = { vao, buffers, count: it.mesh.indices.length };
      }
      next.set(it.mesh, g);
      return { ...it, vao: g.vao, count: g.count };
    });
    for (const [mesh, g] of sent) if (!next.has(mesh)) { gl.deleteVertexArray(g.vao); g.buffers.forEach((b) => gl.deleteBuffer(b)); }
    sent = next;
    gl.bindVertexArray(null);
    requestDraw();
  }

  // Where the eye is and which way the screen's axes point, in the world.
  function eyeAxes() {
    const c = camera, ct = Math.cos(c.tilt);
    const eye = [c.target[0] + c.distance * Math.sin(c.around) * ct, c.target[1] + c.distance * Math.cos(c.around) * ct, c.target[2] + c.distance * Math.sin(c.tilt)];
    const forward = norm3([c.target[0] - eye[0], c.target[1] - eye[1], c.target[2] - eye[2]]), right = norm3(cross3(forward, [0, 0, 1])), up = cross3(right, forward);
    return { eye, forward, right, up };
  }

  function draw() {
    pending = false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(2, Math.round(canvas.clientWidth * ratio)), h = Math.max(2, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = camera, eye = eyeAxes().eye;
    const view = matView(eye, c.target, [0, 0, 1]), proj = matPerspective(FOV, w / h, c.distance * 0.05, c.distance * 6);
    matrix = matMul(proj, view);
    const xray = shading.mode === 3, night = !!shading.night, near = c.distance * 0.05, far = c.distance * 6;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // (a picture of one piece only: nothing outside the piece is touched, in this pass or the second)
    if (only) { gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.floor(only[0]), Math.floor(h - only[1] - only[3]), Math.ceil(only[2]) + 1, Math.ceil(only[3]) + 1); }
    gl.viewport(0, 0, w, h); gl.clearColor(night ? 0 : back[0], night ? 0 : back[1], night ? 0.01 : back[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(program);
    gl.uniformMatrix4fv(loc.uView, false, view); gl.uniformMatrix4fv(loc.uProj, false, proj); gl.uniform1i(loc.uMode, shading.mode);
    const shown = items.filter((it) => it.visible !== false && it.opacity > 0.01 && !(bare && it.hint));
    // (a thing can say it is metal whatever group it is in: an implant among the discs)
    const kind = (it) => (it.metal ? 2 : it.group in MADE_OF ? MADE_OF[it.group] : 3);
    // on an X-ray, bone and disc are a glow that adds up; everywhere else they are solid unless made see-through
    const glows = (it) => xray && kind(it) < 2, solid = (it) => !it.overlay && !glows(it) && it.opacity >= 0.995;
    // solid things first, see-through things after them without writing depth
    for (const pass of ['solid', 'clear']) {
      const clear = pass === 'clear';
      gl.depthMask(!clear);
      if (clear) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      for (const it of shown) {
        if (it.overlay || solid(it) === clear) continue;
        if (clear) gl.blendFunc(glows(it) ? gl.ONE : gl.SRC_ALPHA, glows(it) ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform3fv(loc.uColor, it.color); gl.uniform1f(loc.uAlpha, it.opacity); gl.uniform1i(loc.uKind, kind(it)); gl.uniformMatrix4fv(loc.uModel, false, it.matrix || IDENTITY);
        gl.uniform1f(loc.uWear, it.wear || 0); gl.uniform4fv(loc.uCrack, it.crack || NO_CRACK); gl.uniform4fv(loc.uBone, it.bone || NO_CRACK); gl.uniform4fv(loc.uCut, it.cut || NO_CRACK); gl.uniform4fv(loc.uSnap, it.snap || NO_CRACK);
        gl.bindVertexArray(it.vao); gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
      }
    }
    // The second pass: soft shadow in corners and gaps, and ink lines, laid over the picture.
    const extra = shading.shadow > 0 || shading.ink > 0 ? secondPass(w, h) : null;
    if (extra) {
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, extra.depthTo); gl.clearColor(0.5, 0.5, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(extra.only.program); gl.uniformMatrix4fv(extra.only.uView, false, view); gl.uniformMatrix4fv(extra.only.uProj, false, proj);
      for (const it of shown) {
        if (!solid(it)) continue;
        gl.uniformMatrix4fv(extra.only.uModel, false, it.matrix || IDENTITY); gl.uniform4fv(extra.only.uCut, it.cut || NO_CRACK);
        gl.bindVertexArray(it.vao); gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST); gl.activeTexture(gl.TEXTURE0);
      const half = Math.tan(FOV / 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, extra.shadeTo); gl.useProgram(extra.work.program); gl.bindTexture(gl.TEXTURE_2D, extra.depth);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, extra.facing); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(extra.work.uDepth, 0); gl.uniform1i(extra.work.uFacing, 1); gl.uniform4f(extra.work.uLens, near, far, half * (w / h), half); gl.uniform2f(extra.work.uTexel, 1 / w, 1 / h); gl.uniform1f(extra.work.uReach, 14);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(extra.lay.program); gl.bindTexture(gl.TEXTURE_2D, extra.shade);
      gl.uniform1i(extra.lay.uShade, 0); gl.uniform2f(extra.lay.uTexel, 1 / w, 1 / h); gl.uniform1f(extra.lay.uShadow, shading.shadow); gl.uniform1f(extra.lay.uInk, shading.ink);
      gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, null); gl.useProgram(program);
    }
    // Handles last, on top of everything. A "pinned" item keeps its size on screen: it is drawn
    // at a point of the world, scaled by how many millimetres a pixel covers there.
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.uniform1i(loc.uMode, 4); gl.uniform1i(loc.uKind, 3);
    for (const it of shown) {
      if (!it.overlay || bare) continue;
      let m = it.matrix || IDENTITY;
      if (it.pinned) {
        const k = screenScale(it.pinned.at).perPixel * it.pinned.px, [x, y, z] = it.pinned.basis, at = it.pinned.at;
        m = new Float32Array([x[0] * k, x[1] * k, x[2] * k, 0, y[0] * k, y[1] * k, y[2] * k, 0, z[0] * k, z[1] * k, z[2] * k, 0, at[0], at[1], at[2], 1]);
      }
      gl.uniform3fv(loc.uColor, it.color); gl.uniform1f(loc.uAlpha, 1); gl.uniformMatrix4fv(loc.uModel, false, m);
      gl.bindVertexArray(it.vao); gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
    }
    gl.enable(gl.DEPTH_TEST); gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST);
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

  // The line of sight through a point of the screen (in page pixels): where it starts and
  // which way it goes, in the world.
  function ray(clientX, clientY) {
    const box = canvas.getBoundingClientRect(), { eye, forward, right, up } = eyeAxes(), half = Math.tan(FOV / 2);
    const x = ((clientX - box.left) / box.width * 2 - 1) * half * (box.width / box.height), y = (1 - (clientY - box.top) / box.height * 2) * half;
    return { origin: eye, direction: norm3([forward[0] + right[0] * x + up[0] * y, forward[1] + right[1] * x + up[1] * y, forward[2] + right[2] * x + up[2] * y]) };
  }

  // How many millimetres one screen pixel covers at a point in the world, and the screen's
  // right and up directions there. Used to turn a drag on screen into a move in the world.
  function screenScale(point) {
    const { eye, forward, right, up } = eyeAxes(), depth = dot3([point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]], forward);
    return { perPixel: (2 * depth * Math.tan(FOV / 2)) / canvas.clientHeight, right, up };
  }

  // ---- mouse and touch: drag turns, wheel or pinch zooms, right-drag or two fingers moves.
  // A "tool" can step in: tool.down(e) returning true takes the drag for itself (tool.move,
  // tool.up), tool.tap(e) hears about a click that did not move, tool.hover(e) about the
  // pointer moving with no button held.
  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    // a second finger takes the picture over, to zoom and to move it: the tool lets go of what the first one held, and neither counts as a tap
    for (const first of pointers.values()) { if (first[3]) { first[3] = false; if (tool && tool.cancel) tool.cancel(); } first[4] = 99; }
    const two = pointers.size > 0;
    const held = pointers.size === 0 && e.button === 0 && !e.shiftKey && tool && tool.down ? tool.down(e) === true : false;
    pointers.set(e.pointerId, [e.clientX, e.clientY, e.button, held, two ? 99 : 0]); pinch = 0;
  });
  const release = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId); pinch = 0;
    if (!p || !tool) return;
    if (p[3]) { if (tool.up) tool.up(e); } else if (p[4] < 6 && p[2] === 0 && e.type === 'pointerup' && tool.tap) tool.tap(e);
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { if (tool && tool.hover) tool.hover(e); return; }
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    p[0] = e.clientX; p[1] = e.clientY; p[4] += Math.abs(dx) + Math.abs(dy);
    if (p[3] && pointers.size === 1) { if (tool.move) tool.move(e, dx, dy); return; }
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) camera.distance = Math.max(80, Math.min(4000, camera.distance * pinch / gap));
      pinch = gap; pan(dx / 2, dy / 2);
    } else if (p[2] === 2 || e.shiftKey) pan(dx, dy);
    else { camera.around -= dx * 0.008; camera.tilt = Math.max(-1.45, Math.min(1.45, camera.tilt + dy * 0.008)); }
    requestDraw();
  });
  // (inside another page the wheel belongs to that page until the model has been pressed: see wheelIf)
  let wheelOk = () => true;
  canvas.addEventListener('wheel', (e) => { if (!wheelOk()) return; e.preventDefault(); camera.distance = Math.max(80, Math.min(4000, camera.distance * Math.exp(e.deltaY * 0.0012))); requestDraw(); }, { passive: false });

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
  // Turn the camera to look from a given side.
  function look(around, tilt = 0.05) {
    camera.around = around; camera.tilt = tilt; requestDraw();
  }

  return { canvas, camera, setItems, requestDraw, project, frame, look, ray, screenScale, eye: () => eyeAxes().eye, items: () => items, afterDraw: (fn) => { onDraw = fn; }, setTool: (t) => { tool = t; }, setBackground: (rgb) => { back = rgb; requestDraw(); }, setShading: (name) => { shading = SHADINGS[name] || SHADINGS.soft; requestDraw(); }, secondPassOn: () => !!second,
    // draw now, without the handles, and hand back the canvas: right after this call the
    // picture can be copied off it
    // say when the wheel zooms: fn returns true when it may
    wheelIf: (fn) => { wheelOk = fn; },
    // piece: [left, top, width, height] in pixels of the canvas. Only that piece is drawn, which costs far less
    // than the whole picture when the piece is small. The rest of the canvas is not to be used.
    picture: (piece) => { bare = true; only = piece || null; draw(); bare = false; only = null; requestDraw(); return canvas; } };
}
