// MARKS (PLATE studio, cycle 1): marks drawn at the size they are seen, anchored to the thing they describe.
//
// Why: 1-1.6 px marks die in 4:2:0 at 8 Mbit/s (the share encode), and marks re-seeded every frame boil (MACHINES v1's
// ring field: 1.6 px square cells re-thresholded at 10 Hz, then an RGB tear on the kick). Bénard, Bousseau and Thollot's
// temporal-coherence report names the two failures: marks fixed to the screen ("shower door") or re-seeded (boiling).
// The fix is marks that live in the OBJECT's own coordinates: a fixed point set (a jittered grid, one seed forever) in
// mark space; the picture moves by moving mark space (scale, pan, radial waves), never by re-drawing the points.
//
//   tone     from an image (the client's red_ripples.png, a plate, any canvas) or the built-in ring generator
//   screen   'fm'   fixed-size dots whose DENSITY carries tone (the client's stipple is FM: stochastic 1 px dots)
//            'am'   one dot per cell whose AREA carries tone (grows and merges into solid; gfx review's B)
//            'hybrid' FM below the minimum dot, AM above it (the classic hybrid screen): tone is never lost to the floor
//   size     pitch and dot diameter in OUTPUT px, with a floor (min 2 px diameter by default: see research/capabilities/plate.md)
//   drawn    at 2x internally, analytic anti-aliasing, then a 2x2 box down (drawImage at exactly 0.5)
//
//   import { Marks, RING_PRESETS } from '../lib/fx/marks.js';
//   const M = await Marks.fromImage('../../../sources/red_ripples.png', { paper: [201,31,55], ink: [242,226,206] });
//   M.draw(ctx, t, { scale: 2.4, origin: [x0, y0], screen: 'fm', dot: 2.4, discs: [...], wave: { t0, speed } });
//   const R = new Marks({ rings: RING_PRESETS.ripples });  // generated ring field (born / grow / merge)
//
// Backward compatible: a new module; nothing else changes.

const VS = `#version 300 es
in vec2 a; out vec2 vUv; void main(){ vUv = a * .5 + .5; vUv.y = 1. - vUv.y; gl_Position = vec4(a, 0, 1); }`;
const ND = 12;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTone; uniform int uHasTex; uniform vec2 uToneSz, uToneOrg; uniform int uPass;
uniform vec2 uOut;          // internal px size (2x)
uniform float uSS;          // supersample factor
uniform vec2 uOrigin;       // mark-space coordinate at the output's top-left
uniform float uScale;       // output px per mark cell (the pitch)
uniform int uScreen;        // 0 fm, 1 am, 2 hybrid
uniform float uDot, uMinDot, uJit, uGamma, uToneGain, uToneLift;
uniform vec3 uPaper, uInk;
uniform vec4 uDisc[${ND}];  // x, y (mark space), R (mark units), rings
uniform vec4 uDisc2[${ND}]; // age, solid, grow (0..1 radius scale), weight
uniform int uND;
uniform vec4 uWave;         // wave radius (mark units, from each disc centre), width, gain, displacement
uniform float uBreath;      // radial breathing of mark space (fraction)
uniform float uSeed;
// integer hash (pcg2d, Jarzynski and Olano 2020): float hashes stripe at cell indices in the thousands
uvec2 pcg2d(uvec2 v){ v = v * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; return v; }
float h21(vec2 p){ uvec2 h = pcg2d(uvec2(ivec2(floor(p * 4.)) + 65536) + uint(uSeed * 1000.)); return float(h.x) / 4294967295.; }
vec2 h22(vec2 p){ uvec2 h = pcg2d(uvec2(ivec2(floor(p * 4.)) + 65536) + uint(uSeed * 1000.) + 7u); return vec2(h) / 4294967295.; }
// the generated ring field (soft bands with grain, after red_ripples.png; not the hard stripes of the gfx review's B)
float rings(vec2 m){
  float F = 0.;
  for (int i = 0; i < ${ND}; i++){
    if (i >= uND) break;
    vec4 d = uDisc[i], e = uDisc2[i];
    float r = d.z * e.z; if (r <= 0.) continue;
    float x = length(m - d.xy) / r;
    float core = pow(clamp(1. - x, 0., 1.), .5);
    float band = .5 + .5 * cos(x * d.w * 6.2831 - 2. * e.x);
    band = mix(.45, 1., band);                       // soft: the trough keeps half the tone (the source's grainy bands)
    float v = core * band;
    if (e.y > .5) v = mix(v, .96, smoothstep(.86, .78, x));
    float halo = .16 * smoothstep(2.1, 1., x) * smoothstep(.9, 1.02, x) * (.6 + .4 * band);
    F = max(F, (v + halo) * e.w);
  }
  return clamp(F, 0., 1.);
}
float tone(vec2 m){
  if (uHasTex == 1){
    vec2 uv = m / uToneSz; if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) return 0.;
    vec3 c = texture(uTone, uv).rgb;
    return clamp(dot(c - uPaper, uInk - uPaper) / dot(uInk - uPaper, uInk - uPaper), 0., 1.);
  }
  if (uHasTex == 2) return texture(uTone, (m - uToneOrg) / uToneSz).r;   // the generated field, baked per frame, 1 texel a cell
  return rings(m);
}
// mark-space displacement: breathing about each disc and the travelling wave (the kick), both smooth, so marks move as one
vec2 warp(vec2 m, out float wg){
  wg = 0.;
  vec2 dm = vec2(0);
  for (int i = 0; i < ${ND}; i++){
    if (i >= uND) break;
    vec2 c = uDisc[i].xy; vec2 v = m - c; float r = length(v); float R = uDisc[i].z;
    float infl = exp(-r * r / (R * R * 4.));
    dm -= v * uBreath * infl;
    float w = exp(-pow((r - uWave.x) / max(1., uWave.y), 2.)) * infl;
    wg = max(wg, w);
    dm -= normalize(v + 1e-4) * uWave.w * w;
  }
  return m + dm;
}
void main(){
  if (uPass == 1){ o = vec4(vec3(rings(uToneOrg + floor(vUv * uToneSz) + .5)), 1); return; }
  vec2 p = vUv * uOut / uSS;                       // output px (fractional; internal px is 1/uSS)
  vec2 m0 = uOrigin + p / uScale;
  float wg; vec2 m = warp(m0, wg);
  vec2 cell = floor(m);
  float cov = 0.;
  float aa = .75 / uSS;                            // half a 1x pixel of AA, in output px
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 c = cell + vec2(i, j);
    vec2 ctr = c + .5 + (h22(c) - .5) * uJit;       // anchored: one seed per cell, forever
    float tn = tone(ctr);
    tn = clamp((tn + uToneLift) * uToneGain * (1. + uWave.z * wg), 0., 1.);
    tn = pow(tn, uGamma);
    float rpx;                                      // dot radius in output px
    if (uScreen == 0){ rpx = h21(c + 3.7) < tn ? uDot * .5 : 0.; }
    else if (uScreen == 1){ rpx = uScale * .5 * 1.25 * sqrt(tn); if (rpx < uMinDot * .5) rpx = h21(c + 3.7) < pow(rpx / (uMinDot * .5), 2.) ? uMinDot * .5 : 0.; }
    else { float amr = uScale * .5 * 1.25 * sqrt(tn); rpx = amr >= uDot * .5 ? amr : (h21(c + 3.7) < pow(amr / (uDot * .5), 2.) ? uDot * .5 : 0.); }
    if (rpx <= 0.) continue;
    float d = length(m - ctr) * uScale;
    cov = max(cov, smoothstep(rpx + aa, rpx - aa, d));
  }
  o = vec4(mix(uPaper, uInk, cov), 1);
}`;

const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('marks.js: cannot load ' + src)); i.src = src; });

// disc sets in mark space. ripples: the generated field, laid out after the client's red_ripples.png (native px /2.5)
export const RING_PRESETS = {
  ripples: [
    { x: 216, y: 440, R: 72, rings: 7 }, { x: 150, y: 350, R: 60, rings: 6 }, { x: 208, y: 560, R: 64, rings: 7 },
    { x: 152, y: 590, R: 52, rings: 6 }, { x: 178, y: 690, R: 36, rings: 5 }, { x: 222, y: 700, R: 44, rings: 6 },
    { x: 262, y: 262, R: 30, solid: 1, rings: 5 }, { x: 312, y: 226, R: 36, solid: 1, rings: 5 },
  ],
};

export class Marks {
  static async fromImage(src, o = {}) { const im = typeof src === 'string' ? await img(src) : src; return new Marks({ ...o, image: im }); }
  constructor({ image = null, width = 1080, height = 1920, ss = 2, paper = [201, 31, 55], ink = [242, 226, 206] } = {}) {
    this.W = width; this.H = height; this.ss = ss; this.paper = paper.map(v => v / 255); this.ink = ink.map(v => v / 255);
    const cv = this.gl_cv = document.createElement('canvas'); cv.width = width * ss; cv.height = height * ss;
    const gl = this.gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('marks.js needs WebGL2');
    const sh = (type, s) => { const x = gl.createShader(type); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('marks.js: ' + gl.getShaderInfoLog(x)); return x; };
    const pr = this.pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('marks.js: ' + gl.getProgramInfoLog(pr));
    this.u = {}; const nu = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const a = gl.getActiveUniform(pr, i); this.u[a.name.replace('[0]', '')] = gl.getUniformLocation(pr, a.name); }
    gl.bindVertexArray(gl.createVertexArray()); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); this.hasTex = 0;
    this.gtex = gl.createTexture(); this.gfb = gl.createFramebuffer(); this.gsz = [0, 0];
    if (image) this.setTone(image);
    this.canvas = document.createElement('canvas'); this.canvas.width = width; this.canvas.height = height;
  }
  // tone source: an image or canvas (re-call per frame for a live canvas). Sampled NEAREST: one source texel per mark cell
  setTone(im) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    this.hasTex = 1; this.toneSz = [im.naturalWidth || im.width, im.naturalHeight || im.height];
  }
  // o: scale (output px per mark cell = pitch), origin [mx, my] (mark space at the top-left), screen 'fm'|'am'|'hybrid',
  //    dot (FM dot diameter px), minDot, jitter (0..1 of a cell), gamma, toneGain, toneLift, discs [{x,y,R,rings,age,solid,grow,w}],
  //    wave { r, width, gain, disp } (mark units), breath (fraction), useTone (false: the ring generator even with an image)
  render(t = 0, o = {}) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.pr);
    const useImg = this.hasTex && o.useTone !== false, sc = o.scale ?? 2.5, org = o.origin || [0, 0];
    gl.uniform2f(u.uOut, this.W * this.ss, this.H * this.ss); gl.uniform1f(u.uSS, this.ss);
    gl.uniform2f(u.uOrigin, ...(o.origin || [0, 0])); gl.uniform1f(u.uScale, o.scale ?? 2.5);
    gl.uniform1i(u.uScreen, { fm: 0, am: 1, hybrid: 2 }[o.screen || 'fm']);
    gl.uniform1f(u.uDot, o.dot ?? 2.4); gl.uniform1f(u.uMinDot, o.minDot ?? 2.0); gl.uniform1f(u.uJit, o.jitter ?? 0.8);
    gl.uniform1f(u.uGamma, o.gamma ?? 1); gl.uniform1f(u.uToneGain, o.toneGain ?? 1); gl.uniform1f(u.uToneLift, o.toneLift ?? 0);
    gl.uniform3f(u.uPaper, ...(o.paper ? o.paper.map(v => v / 255) : this.paper)); gl.uniform3f(u.uInk, ...(o.ink ? o.ink.map(v => v / 255) : this.ink));
    const D = (o.discs || []).slice(0, ND), A = new Float32Array(ND * 4), B = new Float32Array(ND * 4);
    D.forEach((d, i) => { A.set([d.x, d.y, d.R, d.rings ?? 6], i * 4); B.set([d.age ?? t, d.solid ? 1 : 0, d.grow ?? 1, d.w ?? 1], i * 4); });
    gl.uniform4fv(u.uDisc, A); gl.uniform4fv(u.uDisc2, B); gl.uniform1i(u.uND, D.length);
    const w = o.wave || {}; gl.uniform4f(u.uWave, w.r ?? -1e4, w.width ?? 10, w.gain ?? 0, w.disp ?? 0);
    gl.uniform1f(u.uBreath, o.breath ?? 0); gl.uniform1f(u.uSeed, o.seed ?? 0.137);
    if (!useImg) {   // pass 1: the ring field at one texel per mark cell (the per-pixel 9-cell loop then only samples it)
      const gw = Math.ceil(this.W / sc) + 24, gh = Math.ceil(this.H / sc) + 24, g0 = [Math.floor(org[0]) - 12, Math.floor(org[1]) - 12];
      gl.bindTexture(gl.TEXTURE_2D, this.gtex);
      if (this.gsz[0] !== gw || this.gsz[1] !== gh) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); this.gsz = [gw, gh];
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.gfb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gtex, 0);
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);   // not the target: no feedback loop
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.gfb); gl.viewport(0, 0, gw, gh);
      gl.uniform1i(u.uPass, 1); gl.uniform2f(u.uToneOrg, g0[0], g0[1]); gl.uniform2f(u.uToneSz, gw, gh); gl.uniform1i(u.uHasTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gtex); gl.uniform1i(u.uTone, 0); gl.uniform1i(u.uHasTex, 2);
    } else {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.uTone, 0); gl.uniform1i(u.uHasTex, 1);
      gl.uniform2f(u.uToneSz, ...this.toneSz); gl.uniform2f(u.uToneOrg, 0, 0);
    }
    gl.uniform1i(u.uPass, 0); gl.viewport(0, 0, this.W * this.ss, this.H * this.ss);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const g = this.canvas.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    g.drawImage(this.gl_cv, 0, 0, this.W, this.H);   // exactly 0.5: bilinear = a 2x2 box
    return this.canvas;
  }
  draw(ctx, t = 0, o = {}) { this.render(t, o); ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height); return this; }
}

// find the discs of a stipple image (the bright cores), in the image's own px: for waves and breathing about each one
export function findDiscs(im, { step = 8, thr = 0.5, minR = 20 } = {}) {
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, sw = Math.ceil(w / step), sh = Math.ceil(h / step);
  const c = Object.assign(document.createElement('canvas'), { width: sw, height: sh }), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, sw, sh); const D = g.getImageData(0, 0, sw, sh).data, L = new Float32Array(sw * sh);
  let lo = 1e9, hi = -1e9; for (let i = 0; i < sw * sh; i++) { L[i] = D[i * 4] * .3 + D[i * 4 + 1] * .59 + D[i * 4 + 2] * .11; lo = Math.min(lo, L[i]); hi = Math.max(hi, L[i]); }
  const out = [];
  for (let y = 2; y < sh - 2; y++) for (let x = 2; x < sw - 2; x++) {
    const v = (L[y * sw + x] - lo) / (hi - lo); if (v < thr) continue;
    let mx = true; for (let j = -3; j <= 3 && mx; j++) for (let i = -3; i <= 3; i++) { const yy = y + j, xx = x + i; if (yy < 0 || xx < 0 || yy >= sh || xx >= sw) continue; if (L[yy * sw + xx] > L[y * sw + x]) { mx = false; break; } }
    if (!mx) continue;
    let r = 1; while (r < 80 && x + r < sw && (L[y * sw + x + r] - lo) / (hi - lo) > 0.08) r++;
    if (r * step >= minR) out.push({ x: x * step + step / 2, y: y * step + step / 2, R: r * step });
  }
  return out;
}
