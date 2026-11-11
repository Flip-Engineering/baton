// THE IRON IS HOT (frontier3): the piece's own finishing passes, stateless in t (a still renders like the movie).
//
//   Burn    the frame sticks in the gate and melts (Bergman, Persona): a blister grows from a hot point (the
//           white-hot stream), the emulsion bubbles and slides toward it, a char ring with an amber lip, and the
//           projector's lamp shows white through the hole. open 0..1 blows the hole to white.
//   Poster  the 2036 half as a four-plate screen print: cream paper, arc blue, red, black, each plate cut from the
//           render by value AND temperature (the arc light prints blue, the metal and the fire print red, the
//           shadows print black, the white heat is the paper), each plate misregistered by its own offset (the
//           press snaps them into register on every STRIKE.), a mesh-woven edge, squeegee streaks, ink grain.
//
//   const burn = new Burn(1080, 1920); burn.apply(srcCanvas, { c: [x, y] (px), r (px), open, t }) -> burn.canvas
//   const poster = new Poster(1080, 1920); poster.apply(srcCanvas, { t, misreg (px), cuts }) -> poster.canvas

const VS = `#version 300 es
out vec2 v;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D S; uniform vec2 res; uniform float t;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return vn(p) * .5 + vn(p * 2.03 + 7.1) * .25 + vn(p * 4.1 + 3.3) * .125 + vn(p * 8.3 + 1.7) * .0625; }
vec2 vor(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y), q = g + h22(i + g) - f; float d = dot(q, q);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2)); }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
vec3 img(vec2 px){ return texture(S, vec2(px.x, px.y) / res).rgb; }
`;

const FS_BURN = HEAD + `
uniform vec2 C; uniform float R, open;
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * res;                         // top-down px
  vec2 q = px - C;
  float d = length(q);
  vec2 dir = q / max(d, 1.);
  float ang = atan(q.y, q.x);
  // the front: a ragged blister, lobed by angular noise that grows as the hole grows
  float lob = (fbm(vec2(ang * 1.6 + 3., R * .004)) - .5) * .55 + (fbm(px * .012 + 11.) - .5) * .35;
  float e = R * (1. + lob) - d;                                 // > 0 inside the hole
  float W = 26. + R * .06;                                      // width of the scorched band
  // ahead of the front the emulsion bubbles: cells that swell, refract and brown
  vec2 cell = vor(px / (14. + R * .015) + vec2(0., t * .15));
  float ahead = smoothstep(-W * 2.4, 0., e) * (1. - smoothstep(0., 2., e));
  float bub = smoothstep(.55, .0, cell.x) * ahead;
  vec2 slide = -dir * ahead * ahead * (10. + R * .05) + (h22(floor(px / 9.)) - .5) * 5. * ahead;   // toward the hole
  vec2 rp = px + slide + (cell.y - cell.x) * bub * vec2(8., 6.);
  vec3 c = img(rp);
  float L = luma(c);
  c = mix(c, vec3(L) * vec3(1.05, .82, .55), ahead * .6);                                          // the emulsion browns
  c *= 1. - .45 * bub * (1. - smoothstep(.0, .25, cell.y - cell.x));                              // cell walls darken
  c += vec3(1., .62, .25) * pow(ahead, 3.) * .5 * (.5 + .5 * sin(cell.x * 30.));                  // heat shimmer on the blisters
  // the char ring, its glowing lip, and the lamp through the hole
  float charB = smoothstep(-W * .9, -W * .15, e) * (1. - smoothstep(-2., 0., e));
  c = mix(c, vec3(.05, .025, .01) + vec3(.35, .1, .02) * vn(px * .08), charB * .92);
  float lip = exp(-abs(e + 1.5) * .22);
  c += vec3(1., .5, .12) * lip * 1.3 + vec3(1., .92, .7) * exp(-abs(e) * .6) * .9;
  vec3 lamp = vec3(1., .97, .9) * (.9 + .1 * vn(px * .01 + t * 3.)) + vec3(.2, .1, 0.) * (1. - smoothstep(0., W * 3., e));
  float inside = smoothstep(0., 3., e);
  c = mix(c, lamp, inside);
  c = mix(c, vec3(1., .98, .94), open);
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

const FS_POSTER = HEAD + `
uniform vec3 I0, I1, I2, I3, cuts; uniform vec2 M1, M2, M3; uniform float mesh, warmBias;
// plates: 1 arc blue (cool light and cool mids), 2 red (warm mids, fire, metal), 3 black (shadow); paper = the white heat
vec4 plates(vec2 px){
  vec2 uv = px / res;
  vec3 s = textureLod(S, uv, 1.6).rgb;
  float L = luma(s), warm = (s.r - s.b) + warmBias;
  return vec4(L, warm, 0., 0.);
}
float cut(float x, float c, float w){ return smoothstep(c + w, c - w, x); }
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * res;
  vec2 m = abs(fract(px / mesh) - .5); float thread = (max(m.x, m.y) - .25) * .03;
  vec4 a = plates(px - M1), b = plates(px - M2), k = plates(px - M3);
  float w = .018;
  // blue: everything under the paper cut that is cool; red: everything under the red cut that is warm, and every
  // mid under cuts.y whatever its temperature (the red is the poster's body); black: the shadows
  float pB = cut(a.x + thread, cuts.x, w) * smoothstep(.02, -.06, a.y);
  float pR = max(cut(b.x + thread, cuts.x, w) * smoothstep(-.04, .05, b.y), cut(b.x + thread, cuts.y, w) * smoothstep(-.02, .03, b.y + .02));
  float pK = cut(k.x + thread, cuts.z, w);
  float sq = 1. - smoothstep(.65, 1., vn(vec2(px.x * .08, px.y * .0025) + t * .0)) * .18;
  float grid = .96 + .04 * smoothstep(.35, .5, max(m.x, m.y));
  vec3 c = I0 * (.96 + .06 * fbm(px * .012));
  c = mix(c, I1 * grid, pB * sq);
  c = mix(c, I2 * grid, pR * sq);
  c = mix(c, I1 * I2 * 1.4 * grid, pB * pR * .0);
  c = mix(c, I3 * grid, pK * min(1., sq + .25));
  c *= .97 + .05 * vn(px * .9);                                  // ink grain
  o = vec4(c, 1.);
}`;

const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };

class Pass {
  constructor(W, H, fs) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('frontier3.post: ' + gl.getShaderInfoLog(s)); return s; };
    const p = this.p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('frontier3.post link: ' + gl.getProgramInfoLog(p));
    this.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); this.u[a.name] = gl.getUniformLocation(p, a.name); }
    this.vao = gl.createVertexArray();
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  run(src, set) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
    gl.viewport(0, 0, this.W, this.H); gl.useProgram(this.p); gl.bindVertexArray(this.vao);
    gl.uniform1i(this.u.S, 0); gl.uniform2f(this.u.res, this.W, this.H);
    set(gl, this.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}

export class Burn extends Pass {
  constructor(W, H) { super(W, H, FS_BURN); }
  apply(src, { c = [540, 960], r = 0, open = 0, t = 0 } = {}) {
    return this.run(src, (gl, u) => { gl.uniform2f(u.C, c[0], c[1]); gl.uniform1f(u.R, r); gl.uniform1f(u.open, open); gl.uniform1f(u.t, t); });
  }
}

export class Poster extends Pass {
  constructor(W, H) { super(W, H, FS_POSTER); }
  apply(src, { t = 0, misreg = 0, cuts = [0.74, 0.42, 0.13], inks = ['#efe3c8', '#2f86cc', '#c3161c', '#15110e'], mesh = 3.2, warmBias = 0, seed = 1 } = {}) {
    const I = inks.map(hex), j = k => [Math.sin(seed * 3.1 + k * 2.3) * misreg, Math.cos(seed * 1.7 + k * 1.9) * misreg];
    return this.run(src, (gl, u) => {
      gl.uniform3fv(u.I0, I[0]); gl.uniform3fv(u.I1, I[1]); gl.uniform3fv(u.I2, I[2]); gl.uniform3fv(u.I3, I[3]);
      gl.uniform3fv(u.cuts, cuts); gl.uniform2fv(u.M1, j(1)); gl.uniform2fv(u.M2, j(2)); gl.uniform2fv(u.M3, j(3));
      gl.uniform1f(u.mesh, mesh); gl.uniform1f(u.warmBias, warmBias); gl.uniform1f(u.t, t);
    });
  }
}
