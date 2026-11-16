// A small WebGL2 renderer: shaded meshes in a choice of shadings, a second pass for soft
// shadow and ink lines, an orbiting camera, mouse and touch control.
// It has no dependencies. If the project later moves to a 3D library, only this file and
// scene.js need to change.

import { computeNormals } from '../core/mesh.js';

const VERTEX = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uView, uProj, uModel;
out vec3 vNor; out vec3 vPos;
void main() { vec4 p = uView * uModel * vec4(aPos, 1.0); vPos = p.xyz; vNor = mat3(uView) * mat3(uModel) * aNor; gl_Position = uProj * p; }`;

// How a surface is lit. uKind says what it is made of (0 bone, 1 disc, 2 metal, 3 anything
// else) and uMode which of the shadings below is in use.
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vPos;
uniform vec3 uColor; uniform float uAlpha; uniform int uMode, uKind;
out vec4 outColor;
const vec3 KEY = vec3(0.404, 0.557, 0.725), FILL = vec3(-0.782, 0.112, 0.613), BACK = vec3(0.101, 0.556, -0.825);
float wrap(vec3 n, vec3 l, float w) { return max((dot(n, l) + w) / (1.0 + w), 0.0); }
// a made-up studio for metal to mirror: a bright ceiling, a soft box to one side, a dark floor
vec3 studio(vec3 r) {
  return vec3(0.05) + vec3(0.5, 0.55, 0.62) * smoothstep(-0.3, 0.8, r.y) + vec3(1.25) * smoothstep(0.55, 0.92, dot(r, vec3(0.71, 0.35, 0.61))) + vec3(0.8) * smoothstep(0.86, 0.97, r.y);
}
void main() {
  vec3 n = normalize(vNor); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(-vPos), h = normalize(KEY + v);
  float nv = max(dot(n, v), 0.0), rim = pow(1.0 - nv, 3.0);
  vec3 c;
  if (uMode == 4) {                                // plain: one light, quick
    c = uColor * (0.20 + 0.20 * (0.5 + 0.5 * n.y) + 0.66 * max(dot(n, KEY), 0.0)) + 0.05 * rim;
    outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha); return;
  }
  if (uMode == 3) {                                // X-ray: bone glows where it is seen edge on, metal is white
    if (uKind == 2) c = vec3(0.86, 0.9, 0.95) * (0.5 + 0.5 * nv);
    else if (uKind == 3) c = uColor * (0.5 + 0.5 * nv);
    else c = mix(vec3(0.8, 0.9, 1.0), uColor, 0.35) * (0.06 + (uKind == 1 ? 0.12 : 0.42) * pow(1.0 - nv, 2.5)) * uAlpha;
    outColor = vec4(c, uAlpha); return;
  }
  vec3 base = pow(uColor, vec3(2.2));
  if (uMode == 2) {                                // drawing: a few flat tones, the ink lines are added afterwards
    float d = wrap(n, KEY, 0.5), tone = d > 0.72 ? 1.0 : d > 0.4 ? 0.8 : 0.58;
    c = base * tone * 1.25 + (uKind == 2 ? step(0.93, dot(n, h)) * 0.35 : 0.0);
    outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha); return;
  }
  vec3 sky = mix(vec3(0.1, 0.09, 0.085), vec3(0.23, 0.245, 0.27), 0.5 + 0.5 * n.y);
  if (uMode == 1) {                                // clay: everything matte, like a model in grey clay
    if (uKind < 2) base = mix(base, vec3(0.52, 0.45, 0.38), 0.65);
    c = base * (sky * 1.3 + vec3(1.0, 0.97, 0.92) * 1.15 * wrap(n, KEY, 0.45) + vec3(0.8, 0.88, 1.0) * 0.22 * wrap(n, FILL, 0.5));
  } else if (uKind == 2) {                         // soft light, metal: mostly a mirror of the studio
    vec3 f = base + (1.0 - base) * pow(1.0 - nv, 5.0);
    c = studio(reflect(-v, n)) * f * 0.8 + base * (0.12 + 0.55 * wrap(n, KEY, 0.2)) + pow(max(dot(n, h), 0.0), 70.0) * 1.1;
  } else {                                         // soft light, bone and disc: three lights that wrap round the form
    float gloss = uKind == 1 ? 0.3 : uKind == 0 ? 0.1 : 0.05;
    c = base * (sky + vec3(1.0, 0.96, 0.9) * 1.3 * wrap(n, KEY, 0.22) + vec3(0.8, 0.88, 1.0) * 0.24 * wrap(n, FILL, 0.5) + 0.3 * max(dot(n, BACK), 0.0));
    c += gloss * pow(max(dot(n, h), 0.0), uKind == 1 ? 45.0 : 22.0) + 0.1 * rim * (base + 0.2);
  }
  c = c * 1.15 / (1.0 + 0.4 * c);                  // keep bright spots from burning out
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha);
}`;

// The second pass. After the picture is drawn, the scene is drawn once more, this time
// keeping only how far away each pixel is and which way its surface faces. From those two
// this shader works out, for every pixel, how closed in the surface is by what is around it
// (corners and gaps get darker) and where an edge runs (for ink lines).
const FACING = `#version 300 es
precision highp float;
in vec3 vNor;
out vec4 outColor;
void main() { vec3 n = normalize(vNor); if (!gl_FrontFacing) n = -n; outColor = vec4(n * 0.5 + 0.5, 1.0); }`;
const SCREEN = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const SHADE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth, uFacing;
uniform vec4 uLens;                                // near, far, half the view across and up (as tangents)
uniform vec2 uTexel; uniform float uReach;
out vec4 outColor;
float deep(vec2 uv) { float d = texture(uDepth, uv).r * 2.0 - 1.0; return 2.0 * uLens.x * uLens.y / (uLens.y + uLens.x - d * (uLens.y - uLens.x)); }
vec3 place(vec2 uv) { float z = deep(uv); return vec3((uv * 2.0 - 1.0) * uLens.zw * z, -z); }
vec3 facing(vec2 uv) { return normalize(texture(uFacing, uv).xyz * 2.0 - 1.0); }
void main() {
  vec2 steps[4] = vec2[4](vec2(uTexel.x, 0.0), vec2(-uTexel.x, 0.0), vec2(0.0, uTexel.y), vec2(0.0, -uTexel.y));
  if (texture(uDepth, vUv).r >= 1.0) {
    // empty background: only an ink line where it borders something
    float edge = 0.0;
    for (int i = 0; i < 4; i++) if (texture(uDepth, vUv + steps[i]).r < 1.0) edge = 1.0;
    outColor = vec4(1.0, edge, 0.0, 1.0); return;
  }
  vec3 p = place(vUv), n = facing(vUv);
  float z = -p.z, turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832, shut = 0.0;
  vec2 across = uReach / (2.0 * z * uLens.zw);
  for (int i = 0; i < 14; i++) {
    float a = turn + float(i) * 2.39996, k = sqrt((float(i) + 0.5) / 14.0);
    vec3 q = place(vUv + across * k * vec2(cos(a), sin(a))) - p;
    float qq = dot(q, q), f = max(uReach * uReach - qq, 0.0);
    shut += f * f * f * max((dot(q, n) - 0.35) / (qq + 0.6), 0.0);
  }
  shut = max(0.0, 1.0 - shut * 2.6 / pow(uReach, 6.0));
  // an edge: a neighbouring pixel lies off this surface, or faces quite another way
  float pixel = 2.0 * z * uLens.w * uTexel.y, off = 0.0, bend = 1.0;
  for (int i = 0; i < 4; i++) { off = max(off, abs(dot(place(vUv + steps[i]) - p, n))); bend = min(bend, dot(facing(vUv + steps[i]), n)); }
  float edge = max(smoothstep(1.6, 4.0, off / pixel), smoothstep(0.35, 0.75, 1.0 - bend));
  outColor = vec4(shut, edge, 0.0, 1.0);
}`;
// Lays the result over the picture: darker where closed in, an ink line along the edges.
const MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uShade; uniform vec2 uTexel; uniform float uShadow, uInk;
out vec4 outColor;
void main() {
  float shut = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) shut += texture(uShade, vUv + (vec2(float(i), float(j)) - 1.5) * uTexel).r;
  float k = mix(1.0, shut / 16.0, uShadow) * (1.0 - uInk * texture(uShade, vUv).g * 0.85);
  outColor = vec4(vec3(clamp(k, 0.0, 1.0)), 1.0);
}`;

// The shadings a person can choose from.
//   mode: which branch of the surface shader, shadow: how dark closed-in places get, ink: edge lines
export const SHADINGS = {
  soft: { mode: 0, shadow: 1, ink: 0 },
  clay: { mode: 1, shadow: 1.25, ink: 0 },
  drawing: { mode: 2, shadow: 0.5, ink: 1 },
  xray: { mode: 3, shadow: 0, ink: 0 },
  plain: { mode: 4, shadow: 0, ink: 0 },
};
const KINDS = { vertebrae: 0, discs: 1, rods: 2, screws: 2, hooks: 2, crosslinks: 2 };

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
  const loc = { pos: 0, nor: 1, ...programOf(VERTEX, FRAGMENT, ['uView', 'uProj', 'uModel', 'uColor', 'uAlpha', 'uMode', 'uKind']) }, program = loc.program;

  // The second pass needs two pictures to draw into: the depth of the scene and the shading
  // worked out from it. If this device cannot provide them, the second pass is left out.
  let shading = SHADINGS.soft, second = null, secondFails = false, bare = false;
  function secondPass(w, h) {
    if (secondFails) return null;
    if (second && second.w === w && second.h === h) return second;
    try {
      if (second) { gl.deleteTexture(second.depth); gl.deleteTexture(second.facing); gl.deleteTexture(second.shade); gl.deleteFramebuffer(second.depthTo); gl.deleteFramebuffer(second.shadeTo); }
      else second = { only: programOf(VERTEX, FACING, ['uView', 'uProj', 'uModel']), work: programOf(SCREEN, SHADE, ['uDepth', 'uFacing', 'uLens', 'uTexel', 'uReach']), lay: programOf(SCREEN, MIX, ['uShade', 'uTexel', 'uShadow', 'uInk']) };
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
  let items = [], matrix = null, pending = false, onDraw = null, tool = null, back = [0.075, 0.08, 0.1];
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
    const xray = shading.mode === 3, near = c.distance * 0.05, far = c.distance * 6;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h); gl.clearColor(xray ? 0 : back[0], xray ? 0 : back[1], xray ? 0.01 : back[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(program);
    gl.uniformMatrix4fv(loc.uView, false, view); gl.uniformMatrix4fv(loc.uProj, false, proj); gl.uniform1i(loc.uMode, shading.mode);
    const shown = items.filter((it) => it.visible !== false && it.opacity > 0.01);
    const kind = (it) => (it.group in KINDS ? KINDS[it.group] : 3);
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
        gl.uniformMatrix4fv(extra.only.uModel, false, it.matrix || IDENTITY);
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
    gl.enable(gl.DEPTH_TEST); gl.bindVertexArray(null);
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
    const held = pointers.size === 0 && e.button === 0 && !e.shiftKey && tool && tool.down ? tool.down(e) === true : false;
    pointers.set(e.pointerId, [e.clientX, e.clientY, e.button, held, 0]); pinch = 0;
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
  // Turn the camera to look from a given side.
  function look(around, tilt = 0.05) {
    camera.around = around; camera.tilt = tilt; requestDraw();
  }

  return { canvas, camera, setItems, requestDraw, project, frame, look, ray, screenScale, eye: () => eyeAxes().eye, items: () => items, afterDraw: (fn) => { onDraw = fn; }, setTool: (t) => { tool = t; }, setBackground: (rgb) => { back = rgb; requestDraw(); }, setShading: (name) => { shading = SHADINGS[name] || SHADINGS.soft; requestDraw(); }, secondPassOn: () => !!second,
    // draw now, without the handles, and hand back the canvas: right after this call the
    // picture can be copied off it
    picture: () => { bare = true; draw(); bare = false; requestDraw(); return canvas; } };
}
