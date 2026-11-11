// WHO OWNS THE MACHINES? (machines): the world compositor. One WebGL2 context, two full-res passes:
//   1. WORLD: the sky of each world (A cold dusk with a cloud deck and a warm horizon band; B the orange-red sunset
//      with backlit cloud bands; C flat poster red; A-red poster red grading to blood-dark), the flat red dot with its
//      soft dark halo, the ring field (cream blue-noise stipple on poster red, 2x2 subsamples per pixel against a
//      void-and-cluster threshold map, so dots are anti-aliased and drawn finer than a pixel), the figure layer
//      (a 2D canvas: silhouettes, rim, details), and for A' the ACP red LUT with fine blue-noise grain before the map.
//   2. FX: the kick's whole-frame RGB split (px, horizontal), the clap's slice glitch (8 bands), the white flash
//      on impacts and the 1-frame lift on a slammed word.
// The skin (1080 scanlines, 4x4 grain, vignette) and the type layer are lib/fx/post.js on top of this canvas.
export const MAXD = 28;

const VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

const FS_LOW = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 res, lres; uniform float time, frame;
uniform int world;                 // 0 A cold | 1 B sunset | 2 A' (A through the red LUT) | 3 C field | 4 A-red | 5 flat red
uniform float expo, band, cloudAmt;
uniform vec2 skyA; uniform float skyZ;          // sky camera: anchor (px) and zoom
uniform vec3 dotP; uniform float dotHalo, dotOn, dotDark;
uniform vec4 D[${MAXD}]; uniform vec4 E[${MAXD}]; uniform int nD; uniform float ringGain, ringPulse, bnShift;
uniform sampler2D FIG, BN;
uniform float figOn, lutGrain, lutLift, redMix, sunK, lockRed;
uniform vec3 horizonCol;
uniform float hz, sunX, hRed;            // world H: horizon (fraction of height), the glow's x (fraction), the red turn

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 11.7; a *= .5; } return s; }
vec3 hexc(float r, float g, float b){ return vec3(r, g, b) / 255.; }

// ---- A: green-grey dusk (hue ~140, sat < 10%), lightening behind the head, a thin warm band at the horizon
vec3 skyA_(vec2 q){
  float y = q.y / res.y;
  vec3 c = mix(hexc(36.,39.,38.), hexc(47.,56.,50.), smoothstep(0., .5, y));
  c = mix(c, hexc(98.,108.,101.), smoothstep(.45, .9, y));
  // cloud deck: long low-contrast bands below the dot, drifting
  vec2 cq = vec2(q.x / res.x * 1.6 + time * .006, y * 7.5);
  float n = fbm(cq * vec2(1.4, 1.) + vec2(0., 3.1)) , n2 = fbm(cq * vec2(3.3, 2.) + 7.);
  float deck = smoothstep(.2, .45, y) * smoothstep(.93, .6, y);
  c *= 1. + cloudAmt * deck * ((n - .5) * .16 + (n2 - .5) * .06);
  // the warm band and the dark ground under it
  float hz = .952, bw = .014 * band;
  c = mix(c, horizonCol, smoothstep(hz - bw * 2.2, hz, y) * (1. - smoothstep(hz, hz + .004, y)) * .85);
  c = mix(c, hexc(26.,26.,24.), smoothstep(hz + .001, hz + .006, y));
  return c * expo;
}
// ---- B: the orange-red sunset, the sun below frame right, bands of backlit cloud
vec3 skyB_(vec2 q){
  vec2 u = q / res;
  vec3 top = hexc(120.,20.,10.), mid = hexc(205.,58.,14.), hot = hexc(246.,112.,30.);
  vec3 c = mix(top, mid, smoothstep(.0, .55, u.y + (u.x - .5) * .25));
  vec2 sun = vec2(1.08, .66);
  float ds = length((u - sun) * vec2(1., 1.6));
  c = mix(c, hot, exp(-ds * ds * 5.) * .9);
  c += hexc(255.,200.,120.) * exp(-ds * ds * 60.) * .25;
  // clouds: stretched fbm; dark bodies, bright edges where they face the sun
  vec2 cq = vec2(u.x * 2.2 + time * .01, u.y * 11.);
  float n = fbm(cq + vec2(0., 1.7)), n3 = fbm(cq * 2.7 + 5.);
  float cov = smoothstep(.48, .7, n + (n3 - .5) * .35) * smoothstep(.02, .15, u.y) * smoothstep(.95, .6, u.y);
  float edge = smoothstep(.46, .58, n + (n3 - .5) * .35) - cov;
  vec3 body = hexc(110.,24.,12.) * (1.3 - .5 * ds);
  c = mix(c, body, cov * .75);
  c += hot * edge * (.55 * exp(-ds * 1.2)) * .8;
  return c * sunK;
}
// ---- H (cycle WM1): the machine on the horizon. B's sunset orange (not red), a low flat horizon with the glow under
// the dot, thin backlit cloud bands, the plain below near-black; hRed turns the whole sky toward poster red (drop II)
vec3 skyH_(vec2 q){
  vec2 u = q / res;
  float y = clamp(u.y / hz, 0., 1.);
  vec3 top = hexc(88.,17.,11.), mid = hexc(192.,58.,18.), low = hexc(248.,128.,42.);
  vec3 c = mix(top, mid, smoothstep(0., .72, y));
  c = mix(c, low, smoothstep(.6, 1., y));
  float dx = u.x - sunX, dy = (1. - y) * 2.6;
  c += hexc(255.,196.,120.) * exp(-(dx * dx * 7. + dy * dy)) * .42;
  vec2 cq = vec2(u.x * 2.1 + time * .01, u.y * 15.);
  float n = fbm(cq + vec2(0., 1.7)), n3 = fbm(cq * 2.7 + 5.);
  float cov = smoothstep(.5, .72, n + (n3 - .5) * .35) * smoothstep(.12, .42, y) * smoothstep(.96, .72, y);
  float edge = smoothstep(.47, .58, n + (n3 - .5) * .35) - cov;
  c = mix(c, hexc(104.,22.,12.) * (1.15 - .35 * y), cov * .62);
  c += low * edge * .22 * y;
  vec3 R = mix(hexc(96.,8.,14.), hexc(201.,31.,55.), smoothstep(0., .8, y)) + hexc(255.,120.,110.) * exp(-(dx * dx * 7. + dy * dy)) * .25;
  c = mix(c, R, hRed);
  if (u.y > hz) c = mix(mix(hexc(30.,12.,9.), hexc(40.,6.,10.), hRed), hexc(9.,5.,5.), smoothstep(hz, hz + .06, u.y));
  return c;
}
float bn(ivec2 p){ return texelFetch(BN, (p + ivec2(int(bnShift) * 37, int(bnShift) * 91)) & 127, 0).r; }
// ---- the ring field: per disc (cx, cy, R, amp) + (age, k, kind, grow)
float field(vec2 p){
  float acc = 1.;
  for (int i = 0; i < ${MAXD}; i++){
    if (i >= nD) break;
    vec4 d = D[i], e = E[i];
    float R = d.z, age = e.x;
    vec2 v = p - d.xy;
    if (e.z < 1.5 && dot(v, v) > R * R * 4.41) continue;
    float dist = length(v);
    float f = 0.;
    if (e.z < 1.5) {
      float r = R * mix(.3, 1., 1. - exp(-age / .09));
      float x = dist / r;
      if (x > 2.1) continue;
      float core = pow(max(1. - x, 0.), .45);
      float rings = mix(.18, 1., smoothstep(.44, .56, .5 + .5 * cos(x * e.y * 3.14159 - 4. * age)));
      if (e.z > .5) rings = mix(.95, rings, smoothstep(.55, .9, x));          // solid disc: rings only at the rim
      f = floor(core * rings * 6. + .5) / 6.;                                   // discrete stipple densities
      f += .22 * smoothstep(2.1, 1., x) * smoothstep(.95, 1.02, x) * step(.5, .5 + .5 * cos(x * e.y * 3.14159 - 4. * age)) * e.w;   // faint outer halo, banded
      float c0 = smoothstep(.035, .02, x) * step(.5, e.z);                        // the solid disc's tiny red centre
      f *= 1. - c0;
    } else {
      // an emitted wave: a ring front leaving the point at speed e.w px/s (or returning when e.w < 0)
      float rr = max(0., R + e.w * age);
      float w = 9. + .07 * rr;
      f = step(abs(dist - rr), w) * (.6 + .4 * step(0., cos(dist * .09 - age * 6.)));   // a hard-edged front
    }
    acc *= 1. - clamp(f * d.w, 0., 1.);
  }
  return 1. - acc;
}
vec3 lut(float l){
  vec3 c0 = hexc(8.,8.,8.), c1 = hexc(70.,6.,10.), c2 = hexc(189.,24.,24.), c3 = hexc(201.,31.,55.), c4 = hexc(246.,232.,212.);
  if (l < .35) return mix(c0, c1, l / .35);
  if (l < .6) return mix(c1, c2, (l - .35) / .25);
  if (l < .85) return mix(c2, c3, (l - .6) / .25);
  return mix(c3, c4, (l - .85) / .15);
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, lres.y - gl_FragCoord.y) * (res / lres);   // top-down full-res px at this texel's centre
  vec2 q = skyA + (p - skyA) / skyZ;
  vec3 c;
  vec3 red = hexc(201.,31.,55.);
  if (world == 0 || world == 2) c = skyA_(q);
  else if (world == 1) c = skyB_(q);
  else if (world == 6) c = skyH_(q);
  else if (world == 4) { float y = p.y / res.y; c = mix(red, hexc(70.,6.,10.), smoothstep(.55, 1., y) * .85); }
  else c = red;
  float F = ringGain > 0. ? field(p) * ringGain * (1. + ringPulse) : 0.;
  F = F / (1. + .35 * max(F - .7, 0.));
  o = vec4(c, clamp(F, 0., 1.));
}`;

const FS_WORLD = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 res; uniform float frame;
uniform int world;
uniform vec3 dotP; uniform float dotHalo, dotOn, dotDark;
uniform float bnShift, ringGain;
uniform sampler2D FIG, BN, LOW;
uniform float figOn, lutGrain, lutLift, lockRed;
vec3 hexc(float r, float g, float b){ return vec3(r, g, b) / 255.; }
float bn(ivec2 p){ return texelFetch(BN, (p + ivec2(int(bnShift) * 37, int(bnShift) * 91)) & 127, 0).r; }
vec3 lut(float l){
  vec3 c0 = hexc(8.,8.,8.), c1 = hexc(70.,6.,10.), c2 = hexc(189.,24.,24.), c3 = hexc(201.,31.,55.), c4 = hexc(246.,232.,212.);
  if (l < .35) return mix(c0, c1, l / .35);
  if (l < .6) return mix(c1, c2, (l - .35) / .25);
  if (l < .85) return mix(c2, c3, (l - .6) / .25);
  return mix(c3, c4, (l - .85) / .15);
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec4 L = texture(LOW, vec2(gl_FragCoord.x, gl_FragCoord.y) / res);
  vec3 c = L.rgb;
  vec3 red = hexc(201.,31.,55.);
  if (dotOn > 0.) {
    float d = length(p - dotP.xy), r = dotP.z;
    float hal = exp(-pow(max(d - r, 0.) / (r * 1.25), 2.)) * dotHalo;
    bool cold = world == 0 || world == 2 || world == 6;
    vec3 hcol = cold ? c * .8 + hexc(28.,12.,12.) * .5 : hexc(70.,6.,10.);
    if (dotDark > 0.) hcol = hexc(52.,4.,8.);
    c = mix(c, hcol, clamp(hal, 0., 1.) * (world == 6 ? .5 : cold ? .75 : .95));
    float a = clamp(r - d + .5, 0., 1.);
    c = mix(c, hexc(229.,50.,57.), a * dotOn);
  }
  float F = L.a;
  if (ringGain > 0. && F > .004) {
    // stipple: 1.6 px cells, each with its own blue-noise threshold; four subsamples per pixel anti-alias the dots
    const float CELL = 1.6;
    float cov = 0.;
    for (int k = 0; k < 4; k++) { vec2 o2 = vec2(float(k & 1), float(k >> 1)) * .5 - .25; cov += step(bn(ivec2(floor((p + o2) / CELL))), F); }
    c = mix(c, hexc(246.,232.,212.), cov * .25);
  }
  if (figOn > 0.) { vec4 f = texture(FIG, p / res); c = c * (1. - f.a) + f.rgb; }
  if (world == 2) {
    float l = dot(c, vec3(.2126, .7152, .0722));
    l = clamp(l * 1.25 + lutLift + (bn(ivec2(p) + ivec2(int(frame) * 17, int(frame) * 29)) - .5) * lutGrain, 0., 1.);
    c = lut(l);
  }
  if (lockRed > 0.) c = mix(c, red, lockRed);
  o = vec4(c, 1.);
}`;

const FS_FX = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D S; uniform vec2 res;
uniform float split, slice, sliceSeed, flash, lift;
float h(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / res;
  float yTop = res.y - gl_FragCoord.y;
  if (slice > 0.) for (int k = 0; k < 8; k++) {
    float y0 = h(sliceSeed + float(k) * 3.1) * res.y, hh = 4. + h(sliceSeed + float(k) * 7.7) * 56.;
    if (yTop > y0 && yTop < y0 + hh) uv.x += (h(sliceSeed + float(k) * 1.3) - .5) * 140. * slice / res.x;
  }
  vec3 c;
  if (split > .05) { float s = split / res.x; c = vec3(texture(S, uv + vec2(s, 0)).r, texture(S, uv).g, texture(S, uv - vec2(s, 0)).b); }
  else c = texture(S, uv).rgb;
  c = c * (1. - lift * .2) + lift * .2;
  c = mix(c, vec3(1.), flash);
  o = vec4(c, 1.);
}`;

export class Compositor {
  constructor(W, H, bnImg) {
    this.W = W; this.H = H;
    const c = this.canvas = document.createElement('canvas'); c.width = W; c.height = H;
    const gl = this.gl = c.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('machines: no WebGL2');
    this.vao = gl.createVertexArray();
    this.pw = this._prog(FS_WORLD); this.pf = this._prog(FS_FX); this.pl = this._prog(FS_LOW);
    this.LW = Math.round(W / 2); this.LH = Math.round(H / 2);          // the sky and the field are smooth at 1/3 (ring period >= 25 px)
    // figure layer texture, blue noise, world FBO
    this.fig = this._tex(W, H, gl.LINEAR);
    this.bn = this._tex(128, 128, gl.NEAREST, gl.R8, gl.RED);
    { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'); g.drawImage(bnImg, 0, 0);
      const d = g.getImageData(0, 0, 128, 128).data, r = new Uint8Array(128 * 128); for (let i = 0; i < r.length; i++) r[i] = d[i * 4];
      gl.bindTexture(gl.TEXTURE_2D, this.bn); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 128, gl.RED, gl.UNSIGNED_BYTE, r); }
    this.wt = this._tex(W, H, gl.LINEAR);
    this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wt, 0);
    this.lt = this._tex(this.LW, this.LH, gl.LINEAR);
    this.lfb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.lfb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lt, 0);
    this.loc = new Map();
  }
  _prog(fs) {
    const gl = this.gl, sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('machines shader: ' + gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('machines link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  _tex(w, h, filt, ifmt = null, fmt = null) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt || gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _u(p, name) { const k = p + name; if (!this.loc.has(k)) this.loc.set(k, this.gl.getUniformLocation(p === 'w' ? this.pw : p === 'l' ? this.pl : this.pf, name)); return this.loc.get(k); }
  upload(figCanvas) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.fig);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, figCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  // u: uniforms for the world pass; fx: { split, slice, sliceSeed, flash, lift }
  render(u, fx) {
    const gl = this.gl, W = this.W, H = this.H;
    gl.bindVertexArray(this.vao);
    // low: the sky and the ring field at half res
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lfb); gl.viewport(0, 0, this.LW, this.LH); gl.useProgram(this.pl);
    { const f1 = (n, v) => gl.uniform1f(this._u('l', n), v);
      gl.uniform2f(this._u('l', 'res'), W, H); gl.uniform2f(this._u('l', 'lres'), this.LW, this.LH);
      f1('time', u.time); f1('frame', u.frame); gl.uniform1i(this._u('l', 'world'), u.world);
      f1('expo', u.expo ?? 1); f1('band', u.band ?? 1); f1('cloudAmt', u.cloudAmt ?? 1);
      gl.uniform2f(this._u('l', 'skyA'), ...(u.skyA || [W / 2, H / 2])); f1('skyZ', u.skyZ ?? 1);
      const disc = u.discs || [], n = Math.min(disc.length, MAXD);
      const Da = new Float32Array(MAXD * 4), Ea = new Float32Array(MAXD * 4);
      for (let i = 0; i < n; i++) { Da.set(disc[i].slice(0, 4), i * 4); Ea.set(disc[i].slice(4, 8), i * 4); }
      gl.uniform4fv(this._u('l', 'D'), Da); gl.uniform4fv(this._u('l', 'E'), Ea); gl.uniform1i(this._u('l', 'nD'), n);
      f1('ringGain', n ? (u.ringGain ?? 1) : 0); f1('ringPulse', u.ringPulse ?? 0); f1('sunK', u.sunK ?? 1);
      gl.uniform3f(this._u('l', 'horizonCol'), ...(u.horizonCol || [0.45, 0.36, 0.28]));
      f1('hz', u.hz ?? 0.7); f1('sunX', u.sunX ?? 0.7); f1('hRed', u.hRed ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); }
    const P = window.__prof; const sync = () => { if (P) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } };
    let tt = performance.now(); sync(); if (P) P.low = performance.now() - tt; tt = performance.now();
    // world (straight to the canvas when the frame has no kick / clap / flash fx)
    const fxOn = (fx.split || 0) > 1 || fx.slice || fx.flash || fx.lift;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fxOn ? this.fb : null); gl.viewport(0, 0, W, H); gl.useProgram(this.pw);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fig); gl.uniform1i(this._u('w', 'FIG'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bn); gl.uniform1i(this._u('w', 'BN'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lt); gl.uniform1i(this._u('w', 'LOW'), 2);
    const f1 = (n, v) => gl.uniform1f(this._u('w', n), v);
    gl.uniform2f(this._u('w', 'res'), W, H); f1('frame', u.frame); gl.uniform1i(this._u('w', 'world'), u.world);
    gl.uniform3f(this._u('w', 'dotP'), ...(u.dotP || [0, 0, 0])); f1('dotHalo', u.dotHalo ?? 1); f1('dotOn', u.dotOn ?? 0); f1('dotDark', u.dotDark ?? 0);
    f1('ringGain', (u.discs || []).length ? 1 : 0); f1('bnShift', u.bnShift ?? 0);
    f1('figOn', u.figOn ?? 1); f1('lutGrain', u.lutGrain ?? 0.1); f1('lutLift', u.lutLift ?? 0); f1('lockRed', u.lockRed ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sync(); if (P) P.world = performance.now() - tt; tt = performance.now();
    if (!fxOn) return this.canvas;
    // fx
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(this.pf);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.wt); gl.uniform1i(this._u('f', 'S'), 0);
    gl.uniform2f(this._u('f', 'res'), W, H);
    for (const k of ['split', 'slice', 'sliceSeed', 'flash', 'lift']) gl.uniform1f(this._u('f', k), fx[k] || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sync(); if (P) P.fx = performance.now() - tt;
    return this.canvas;
  }
}
