// The shader programs of the renderer, as text. renderer.js compiles them and feeds them.
// What a surface looks like is decided here: the shadings, the soft shadow and the ink lines.

export const VERTEX = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uView, uProj, uModel;
out vec3 vNor; out vec3 vPos; out vec3 vLocal;
void main() { vec4 p = uView * uModel * vec4(aPos, 1.0); vPos = p.xyz; vLocal = aPos; vNor = mat3(uView) * mat3(uModel) * aNor; gl_Position = uProj * p; }`;

// How a surface is lit. Bone can also be worn (uWear, 0 to 1) and broken (uCrack: the kind of break, 1 wedge,
// 2 crush, 3 burst, then half the depth, half the width and half the height of its body, in millimetres). Both
// are drawn from where a point sits in the bone itself (vLocal), so they stay put when the spine is bent.
// A part of a bone can be left out (uCut: 1, then half the width of a slot down the middle of the back and how
// far back it starts: everything in it is not drawn, and the inside of the bone shows as a flat cut face). And a
// process can show a break (uSnap: 1 for the one at the back, then how far back the line is and half its width.
// 2 or 3 for the one on the left or the right, then how far out the line is and from where to where it runs).
// uKind says what it is made of (0 bone, 1 disc, 2 metal, 3 anything
// else) and uMode which of the shadings below is in use (the numbers are in SHADINGS).
export const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vPos; in vec3 vLocal;
uniform vec3 uColor; uniform float uAlpha; uniform int uMode, uKind;
uniform float uWear; uniform vec4 uCrack, uCut, uSnap;
// a number between 0 and 1 for a point of a grid, and the same smoothed between the points
float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// pits: in a grid of cells of a size, "much" of the cells hold one small round pit somewhere inside
float pits(vec3 p, float size, float much) {
  vec3 g = p / size, i = floor(g), f = fract(g) - 0.5;
  vec3 o = (vec3(hash(i), hash(i + 7.3), hash(i + 13.7)) - 0.5) * 0.45;
  float r = 0.14 + 0.24 * hash(i + 3.1);
  return step(1.0 - much, hash(i + 21.4)) * (1.0 - smoothstep(r * 0.55, r, length(f - o)));
}
out vec4 outColor;
const vec3 KEY = vec3(0.404, 0.557, 0.725), FILL = vec3(-0.782, 0.112, 0.613), BACK = vec3(0.101, 0.556, -0.825);
float wrap(vec3 n, vec3 l, float w) { return max((dot(n, l) + w) / (1.0 + w), 0.0); }
// a made-up studio for metal to mirror: a bright ceiling, a soft box to one side, a dark floor
vec3 studio(vec3 r) {
  return vec3(0.05) + vec3(0.5, 0.55, 0.62) * smoothstep(-0.3, 0.8, r.y) + vec3(1.25) * smoothstep(0.55, 0.92, dot(r, vec3(0.71, 0.35, 0.61))) + vec3(0.8) * smoothstep(0.86, 0.97, r.y);
}
// a colour made stronger: further from grey, and as bright as it can be
vec3 strong(vec3 c, float much) {
  vec3 s = clamp(mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, much), 0.0, 1.0);
  return s / max(max(s.r, max(s.g, s.b)), 0.2);
}
void main() {
  if (uKind == 0 && uCut.x > 0.5 && abs(vLocal.x) < uCut.y && vLocal.y > uCut.z) discard;
  vec3 n = normalize(vNor); if (!gl_FrontFacing) n = -n;
  // "col" is the colour of the thing, and "mark" how much of it is left where bone is pitted or cracked (1 = untouched)
  vec3 col = uColor; float mark = 1.0;
  if (uKind == 0 && (uWear > 0.01 || uCrack.x > 0.5 || uSnap.x > 0.5)) {
    vec3 p = vLocal;
    if (uWear > 0.01) {
      // worn bone: duller and patchy, with pits that grow in number and size
      float blotch = noise(p * 0.17), fine = noise(p * 0.9);
      col = mix(col, col * vec3(0.8, 0.73, 0.6) + vec3(0.02, 0.015, 0.0), clamp(uWear * (0.45 + 0.75 * blotch), 0.0, 0.9));
      col *= 1.0 - 0.16 * uWear * fine;
      float pit = max(pits(p, 2.4, uWear * 0.8), pits(p + 31.7, 1.35, max(uWear - 0.3, 0.0) * 0.9));
      mark *= 1.0 - 0.66 * pit;
    }
    if (uCrack.x > 0.5) {
      // a break in the body: a dark, ragged line through it (and on a burst a second one, upright)
      float body = 1.0 - smoothstep(uCrack.y + 1.0, uCrack.y + 4.0, p.y);
      float across = (uCrack.x < 1.5 ? -0.3 * uCrack.w * p.y / uCrack.y : 0.0) + (noise(vec3(p.x * 0.28, p.y * 0.28, 3.0)) - 0.5) * 0.36 * uCrack.w + (noise(vec3(p.x * 1.1, p.y * 1.1, 8.0)) - 0.5) * 0.9;
      float line = 1.0 - smoothstep(0.35, 0.95, abs(p.z - across));
      if (uCrack.x > 2.5) { float upright = (noise(vec3(p.z * 0.3, p.y * 0.3, 15.0)) - 0.5) * 0.5 * uCrack.z; line = max(line, 1.0 - smoothstep(0.3, 0.85, abs(p.x - upright))); }
      mark *= 1.0 - 0.78 * line * body;
    }
    if (uSnap.x > 0.5) {
      // a broken process: a dark line across it
      float wander = (noise(vec3(p.x * 0.5, p.z * 0.5, 21.0)) - 0.5) * 2.4 + (noise(vec3(p.y * 0.5, p.z * 1.3, 4.0)) - 0.5) * 1.2, snap;
      if (uSnap.x < 1.5) snap = (1.0 - smoothstep(0.4, 1.0, abs(p.y - uSnap.y - wander))) * step(abs(p.x), uSnap.z);
      else snap = (1.0 - smoothstep(0.4, 1.0, abs(abs(p.x) - uSnap.y - wander))) * step(0.0, p.x * (uSnap.x < 2.5 ? 1.0 : -1.0)) * step(uSnap.z, p.y) * step(p.y, uSnap.w);
      mark *= 1.0 - 0.8 * snap;
    }
    col *= mark;
  }
  vec3 v = normalize(-vPos), h = normalize(KEY + v);
  float nv = max(dot(n, v), 0.0), rim = pow(1.0 - nv, 3.0);
  // the inside of a bone that has been cut open: one flat, raw colour, so the cut reads as solid bone
  if (uKind == 0 && uCut.x > 0.5 && !gl_FrontFacing && uMode != 3 && uMode != 9) { outColor = vec4(vec3(0.66, 0.4, 0.34) * (0.8 + 0.2 * nv), uAlpha); return; }
  vec3 c;
  if (uMode == 4) {                                // plain: one light, quick
    c = col * (0.20 + 0.20 * (0.5 + 0.5 * n.y) + 0.66 * max(dot(n, KEY), 0.0)) + 0.05 * rim;
    outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha); return;
  }
  if (uMode == 3) {                                // X-ray: bone glows where it is seen edge on, metal is white
    if (uKind == 2) c = vec3(0.86, 0.9, 0.95) * (0.5 + 0.5 * nv);
    else if (uKind == 3) c = col * (0.5 + 0.5 * nv);
    else c = mix(vec3(0.8, 0.9, 1.0), col, 0.35) * (0.06 + (uKind == 1 ? 0.12 : 0.42) * pow(1.0 - nv, 2.5)) * uAlpha;
    if (uKind == 0) c *= 1.0 - 0.45 * uWear;      // (thin bone stops less of the beam)
    outColor = vec4(c, uAlpha); return;
  }
  if (uMode == 9) {                                // neon: dark, with an edge that glows like a tube sign
    vec3 tube = uKind == 0 ? vec3(0.15, 1.0, 0.92) : uKind == 1 ? vec3(1.0, 0.2, 0.78) : uKind == 2 ? vec3(1.0, 0.86, 0.2) : strong(col, 2.2);
    float edge = pow(1.0 - nv, 2.2);
    c = (tube * (0.05 + 0.1 * wrap(n, KEY, 0.6) + 1.25 * edge) + vec3(1.0) * 0.55 * pow(1.0 - nv, 7.0)) * mark;
    outColor = vec4(c, uAlpha); return;
  }
  vec3 base = pow(col, vec3(2.2));
  if (uMode == 2) {                                // drawing: a few flat tones, the ink lines are added afterwards
    float d = wrap(n, KEY, 0.5), tone = d > 0.72 ? 1.0 : d > 0.4 ? 0.8 : 0.58;
    c = base * tone * 1.25 + (uKind == 2 ? step(0.93, dot(n, h)) * 0.35 : 0.0);
    outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha); return;
  }
  vec3 sky = mix(vec3(0.1, 0.09, 0.085), vec3(0.23, 0.245, 0.27), 0.5 + 0.5 * n.y);
  if (uMode == 5 || uMode == 6) {                  // chrome and gold: the whole model is polished metal
    vec3 metal = uMode == 5
      ? (uKind == 0 ? vec3(0.9, 0.91, 0.93) : uKind == 1 ? mix(base, vec3(0.3, 0.33, 0.4), 0.5) : mix(base, vec3(0.9), 0.35))
      : (uKind == 0 ? vec3(1.0, 0.69, 0.27) : uKind == 1 ? vec3(0.62, 0.3, 0.13) : mix(base, vec3(1.0, 0.82, 0.55), 0.4));
    vec3 f = metal + (1.0 - metal) * pow(1.0 - nv, 5.0);
    vec3 room = studio(reflect(-v, n));
    room = room * room * 0.9 + 0.02;               // (a harder mirror than the hardware has: darker darks, brighter lights)
    c = room * f * 1.25 + metal * (0.03 + 0.14 * wrap(n, KEY, 0.25)) + pow(max(dot(n, h), 0.0), 90.0) * 1.2;
  } else if (uMode == 7) {                         // matte: chalk, no shine anywhere, the colours a little paler
    vec3 chalk = mix(base, vec3(0.85), 0.42);
    c = chalk * (sky * 1.7 + vec3(1.0, 0.97, 0.93) * 0.95 * wrap(n, KEY, 0.75) + vec3(0.8, 0.88, 1.0) * 0.3 * wrap(n, FILL, 0.75));
  } else if (uMode == 8) {                         // candy: strong colour under a hard clear glaze
    vec3 sweet = pow(strong(col, 1.9), vec3(2.2));
    c = sweet * (sky * 1.2 + vec3(1.0, 0.97, 0.92) * 1.2 * wrap(n, KEY, 0.5) + vec3(0.8, 0.88, 1.0) * 0.25 * wrap(n, FILL, 0.5)) + sweet * 0.5 * rim;
    c += studio(reflect(-v, n)) * (0.05 + 0.95 * pow(1.0 - nv, 5.0)) * 0.7 + pow(max(dot(n, h), 0.0), 140.0) * 1.6;
  } else if (uMode == 10) {                        // rainbow: the colour runs round the form like oil on water
    float t = nv * 1.15 + n.y * 0.22 + n.x * 0.1 + (uKind == 1 ? 0.5 : uKind == 2 ? 0.25 : 0.0);
    vec3 oil = 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67)));
    oil = mix(oil, vec3(0.9, 0.88, 0.95), 0.25);
    c = oil * (sky + vec3(1.0, 0.97, 0.92) * 1.05 * wrap(n, KEY, 0.4) + vec3(0.8, 0.88, 1.0) * 0.25 * wrap(n, FILL, 0.5));
    c += studio(reflect(-v, n)) * (0.06 + 0.5 * pow(1.0 - nv, 4.0)) + pow(max(dot(n, h), 0.0), 60.0) * 0.8;
  } else if (uMode == 1) {                                // clay: everything matte, like a model in grey clay
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
  if (uMode == 5 || uMode == 6 || uMode == 10) c *= mark;
  c = c * 1.15 / (1.0 + 0.4 * c);                  // keep bright spots from burning out
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha);
}`;

// The second pass. After the picture is drawn, the scene is drawn once more, this time
// keeping only how far away each pixel is and which way its surface faces. From those two
// this shader works out, for every pixel, how closed in the surface is by what is around it
// (corners and gaps get darker) and where an edge runs (for ink lines).
export const FACING = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vLocal;
uniform vec4 uCut;
out vec4 outColor;
// (bone that is left out of the picture is left out here too, so it casts no shadow and draws no ink line)
void main() { if (uCut.x > 0.5 && abs(vLocal.x) < uCut.y && vLocal.y > uCut.z) discard; vec3 n = normalize(vNor); if (!gl_FrontFacing) n = -n; outColor = vec4(n * 0.5 + 0.5, 1.0); }`;
export const SCREEN = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
export const SHADE = `#version 300 es
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
export const MIX = `#version 300 es
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
