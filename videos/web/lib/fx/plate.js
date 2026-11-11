// PLATE (PLATE studio, cycle 1): the photograph is the picture. A poster or a film shot, baked once by
// scripts/plate_bake.py into color / alpha / depth / clean, played back with a restrained 2.5D push and event light
// that lands on the surfaces in it.
//
// Why: the slate kept redrawing photographs (the client's trucker traced three ways across two pieces; the Steel tapper
// replaced by a CG mannequin with a cotton-wool blast). A copy keeps the outline and throws away the soft edge, the rim
// light, the surface and the specific face. Here the source stays the source; what the plate adds is small on purpose:
//   push    a dolly of a few percent: every texel scales about a focus by 1 + push*(k0 + n) where n is its nearness
//           (Depth Anything V2 disparity). Inverse-mapped per pixel (fixed-point on the depth), in two layers: the
//           subject over the clean plate, so the edge reveals background instead of tearing ("The Kid Stays in the
//           Picture": clean plate behind, small moves, no glow on the cut).
//   light   event light as superposition (relight.js's idea on a photograph): each light is a point or a far key with a
//           colour, weight, falloff and a Lambert term on normals taken from the depth; a rim term for back light. The
//           light multiplies the plate's own lifted value (skin, cloth, floor): it LANDS, it is not a wash over the frame.
//   film    a shot is a frame sequence at its own cadence (24 fps held on 30: no invented in-betweens); the clean plate
//           is the temporal median of where the man is not, and the live frame shows through wherever he is not, so
//           sparks and smoke stay the film's own.
//   grain   a shaped ~2 px midtone grain after the upscale (the grain_ab.py finding), never a 1 px finish.
//
//   import { Plate, onsetLight } from '../lib/fx/plate.js';
//   const P = await Plate.load('trucker');                        // web/assets/plate/trucker/
//   P.draw(ctx, t, { view: { cx: .5, cy: .5, zoom: 1 }, push: .03 * u, focus: [.6, .8],
//                    lights: [{ x: .88, y: .13, z: -.6, color: [1, .25, .2], w: 1.2, rim: 1, receive: 'subject' }],
//                    lift: .8, grain: .05 });
//   const aux = P.aux();                                           // depth + class for looks.js Looks.source({ color, aux })
//   P.subject(t)                                                   // the subject's bbox / head in OUTPUT px (type slots)
//
// It returns layers to the scene's compositor and never owns the frame. A photographic plate is display-referred; post.js's
// tone curve is off unless a scene asks for it (since STUDIO FINISH c1, 1 Oct; before, any film: key capped whites at 229).
// Backward compatible: a new module; nothing else changes.

const VS = `#version 300 es
in vec2 a; out vec2 vUv; void main(){ vUv = a * .5 + .5; vUv.y = 1. - vUv.y; gl_Position = vec4(a, 0, 1); }`;

const NL = 4;   // lights per pass
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCol, uAlp, uDep, uCln, uCDp, uNrm, uCNr;
uniform vec2 uTex;           // plate texel size
uniform vec2 uOutPx;         // output size px
uniform vec4 uView;          // plate uv of the output's top-left (xy) and the uv extent of the output (zw)
uniform float uPush, uK0;    // dolly amount, far-plane share
uniform vec2 uFocus, uPar;   // dolly centre (plate uv), parallax shift for n = 1 (plate uv)
uniform float uRelief;       // normal strength from depth
uniform float uInset;        // inset of subject light from the cut edge (texels)
uniform vec4 uLp[${NL}];     // light pos (plate uv x, y, z in depth units: + toward camera), falloff radius (uv)
uniform vec4 uLc[${NL}];     // light colour rgb, weight
uniform vec4 uLx[${NL}];     // sharpness (lambert exponent: a raking light lands only where the surface turns to it), -
uniform vec4 uLo[${NL}];     // wrap, rim, receive (0 all, 1 subject, 2 not subject), directional (1 = far key)
uniform float uLift, uLiftPivot, uAlb;
uniform float uGain, uSat, uGrain, uSeed, uEdge;
uniform vec3 uShadowTint;
uniform int uLayers;         // 2: subject over the clean plate; 1: one layer warped by its own depth (film: no matte edge ever shows)
uniform int uMode;           // 0 colour, 1 aux (depth hi, depth lo, class), 2 debug depth, 3 alpha
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
// Catmull-Rom bicubic from 9 bilinear taps (the plate is upscaled 1.1-1.8x: bilinear would go soft and stair)
vec4 bicubic(sampler2D s, vec2 uv){
  vec2 sz = 1. / uTex, p = uv * sz - .5, f = fract(p), i = floor(p);
  vec2 w0 = f * (-.5 + f * (1. - .5 * f)), w1 = 1. + f * f * (-2.5 + 1.5 * f), w2 = f * (.5 + f * (2. - 1.5 * f)), w3 = f * f * (-.5 + .5 * f);
  vec2 w12 = w1 + w2, o12 = w2 / w12;
  vec2 t0 = (i - .5) * uTex, t3 = (i + 2.5) * uTex, t12 = (i + .5 + o12) * uTex;
  vec4 r = vec4(0);
  r += texture(s, vec2(t0.x, t0.y)) * w0.x * w0.y + texture(s, vec2(t12.x, t0.y)) * w12.x * w0.y + texture(s, vec2(t3.x, t0.y)) * w3.x * w0.y;
  r += texture(s, vec2(t0.x, t12.y)) * w0.x * w12.y + texture(s, vec2(t12.x, t12.y)) * w12.x * w12.y + texture(s, vec2(t3.x, t12.y)) * w3.x * w12.y;
  r += texture(s, vec2(t0.x, t3.y)) * w0.x * w3.y + texture(s, vec2(t12.x, t3.y)) * w12.x * w3.y + texture(s, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return r;
}
// inverse dolly: the source uv q whose forward image is b, with the scale depending on q's own depth
vec2 unproject(sampler2D D, vec2 b){
  vec2 q = b;
  for (int k = 0; k < 6; k++){ float n = texture(D, q).r; float s = 1. + uPush * (uK0 + (1. - uK0) * n); q = uFocus + (b - uFocus) / s - uPar * n; }
  return q;
}
// normals are baked from the float depth (scripts/plate_bake.py normal_map): xy scaled by the relief here
vec3 normalAt(sampler2D Nm, vec2 q){ vec3 n = texture(Nm, q).rgb * 2. - 1.; return normalize(vec3(n.xy * uRelief, max(n.z, .05))); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.), f.x), f.y); }
vec3 light(vec3 c, vec3 N, vec2 q, float n, int layer, float inner){
  float asp = uTex.y / uTex.x;
  vec3 P = vec3(q.x * asp, q.y, n * .35);
  vec3 alb = uAlb * (.06 + sqrt(max(c, 0.)));   // the value of the thing lit: skin stays skin, a white shirt takes most
  vec3 add = vec3(0);
  for (int i = 0; i < ${NL}; i++){
    if (uLc[i].w <= 0.) continue;
    int rcv = int(uLo[i].z + .5);                // 0 all, 1 subject only, 2 ground only
    if (rcv != 0 && rcv != layer) continue;
    vec3 Lp = vec3(uLp[i].x * asp, uLp[i].y, uLp[i].z * .35);
    vec3 d = Lp - P; float dist = length(d.xy); vec3 Ld = uLo[i].w > .5 ? normalize(vec3(uLp[i].x - .5, uLp[i].y - .5, uLp[i].z)) : normalize(d);
    float lam = pow(max(0., (dot(N, Ld) + uLo[i].x) / (1. + uLo[i].x)), max(1., uLx[i].x));
    float rim = uLo[i].y * pow(clamp(1. - N.z, 0., 1.), 1.3) * max(0., dot(normalize(N.xy + 1e-5), normalize(Ld.xy + 1e-5)));
    float fall = uLo[i].w > .5 ? 1. : 1. / (1. + pow(dist / max(1e-3, uLp[i].w), 2.));
    add += uLc[i].rgb * uLc[i].w * (lam + rim * 4.) * fall * (layer == 1 ? inner : 1.);
  }
  return add * alb;
}
void main(){
  vec2 b = uView.xy + vUv * uView.zw;
  vec2 qf = unproject(uDep, b), qb = unproject(uCDp, b);
  // background: the live frame wherever the subject is not (sparks, smoke, flicker stay the film's), else the clean plate
  float near = 0.;
  for (int k = 0; k < 8; k++){ float an = 6.2831 * float(k) / 8.; near = max(near, texture(uAlp, qb + uTex * 7. * vec2(cos(an), sin(an))).r); }
  near = max(near, texture(uAlp, qb).r);
  vec3 bg = mix(bicubic(uCol, qb).rgb, bicubic(uCln, qb).rgb, smoothstep(.02, .3, near));
  vec3 fg = bicubic(uCol, qf).rgb;
  float a = texture(uAlp, qf).r;
  a = smoothstep(.5 - uEdge, .5 + uEdge, a);
  bool outside = any(lessThan(qf, vec2(0))) || any(greaterThan(qf, vec2(1)));
  if (outside) a = 0.;
  float nf = texture(uDep, qf).r, nb = texture(uCDp, qb).r, n = a > .5 ? nf : nb;
  if (uMode == 1){ float d = clamp(1. - n, 0., 1.); float l = floor(d * 65534.); o = vec4(floor(l / 256.) / 255., mod(l, 256.) / 255., a > .5 ? 1. : 0., 1.); return; }
  if (uMode == 2){ o = vec4(vec3(n), 1); return; }
  if (uMode == 3){ o = vec4(vec3(a), 1); return; }
  // each layer is lifted and lit BEFORE the composite, so the matte edge blends lit subject into lit ground (lifting or
  // lighting after the composite leaves the half-alpha edge darker than both: a black line round the man)
  float inner = 1.;
  if (uInset > 0.) for (int k = 0; k < 8; k++){ float an = 6.2831 * (float(k) + .5) / 8.; inner = min(inner, texture(uAlp, qf + uTex * uInset * vec2(cos(an), sin(an))).r); }
  inner = mix(1., smoothstep(.15, .95, inner), step(.5, uInset));
  // shadow lift on the subject: raise the low values (a fraction of a stop to 2 stops) so the face reads at feed size
  float lift = uLift * (1. - smoothstep(0., uLiftPivot, lum(fg)));
  fg *= exp2(lift); fg = mix(fg, fg * uShadowTint, min(1., lift));
  fg += light(fg, normalAt(uNrm, qf), qf, nf, 1, inner);
  bg += light(bg, normalAt(uCNr, qb), qb, nb, 2, 1.);
  vec3 c = mix(bg, fg, a);
  if (uLayers == 1){   // one layer: the frame displaced by its own depth; the matte only masks light and lift
    vec3 f1 = bicubic(uCol, qf).rgb; float a1 = texture(uAlp, qf).r;
    float l1 = uLift * a1 * (1. - smoothstep(0., uLiftPivot, lum(f1)));
    f1 *= exp2(l1); f1 = mix(f1, f1 * uShadowTint, min(1., l1));
    vec3 N1 = normalAt(uNrm, qf);
    c = f1 + mix(light(f1, N1, qf, nf, 2, 1.), light(f1, N1, qf, nf, 1, 1.), a1);
    a = a1;
  }
  c *= uGain;
  float Lc = lum(c); c = mix(vec3(Lc), c, uSat);
  // shaped grain: ~2 px, midtone-weighted, new every frame (film grain moves; marks do not)
  if (uGrain > 0.){ vec2 px = vUv * uOutPx; float g = vnoise(px / 1.9) + vnoise(px / 1.3 + 17.) - 1.; float m = 4. * clamp(Lc, 0., 1.) * (1. - clamp(Lc, 0., 1.)); c += g * uGrain * (.35 + m); }
  o = vec4(clamp(c, 0., 1.), 1);
}`;

const BASE = new URL('../../assets/plate/', import.meta.url).href;
const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('plate.js: cannot load ' + src)); i.src = src; });

export class Plate {
  static async load(name, { base = BASE, width = 1080, height = 1920 } = {}) {
    const dir = `${base}${name}/`;
    const meta = await (await fetch(dir + 'meta.json')).json();
    let subj = []; try { subj = await (await fetch(dir + 'subj.json')).json(); } catch (e) { /* optional */ }
    const n = meta.frames || 1, nm = (k, i, ext) => meta.still ? `${dir}${k}.${ext}` : `${dir}${k}_${String(i).padStart(3, '0')}.${ext}`;
    const load = k => Promise.all(Array.from({ length: n }, (_, i) => img(nm(k, i, k === 'color' ? 'jpg' : 'png'))));
    const [color, alpha, depth, normal, clean, cdep, cnrm] = await Promise.all([load('color'), load('alpha'), load('depth'), load('normal'), img(dir + 'clean.jpg'), img(dir + 'clean_depth.png'), img(dir + 'clean_normal.png')]);
    return new Plate({ name, meta, subj, color, alpha, depth, normal, clean, cdep, cnrm, width, height });
  }
  constructor({ name, meta, subj, color, alpha, depth, normal, clean, cdep, cnrm, width, height }) {
    Object.assign(this, { name, meta, subj, color, alpha, depth, normal, W: width, H: height });
    this.pw = meta.size[0]; this.ph = meta.size[1]; this.n = color.length;
    const cv = this.canvas = document.createElement('canvas'); cv.width = width; cv.height = height;
    const gl = this.gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('plate.js needs WebGL2');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('plate.js: ' + gl.getShaderInfoLog(s)); return s; };
    const pr = this.pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('plate.js: ' + gl.getProgramInfoLog(pr));
    this.u = {}; const nu = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const a = gl.getActiveUniform(pr, i); this.u[a.name.replace('[0]', '')] = gl.getUniformLocation(pr, a.name); }
    gl.bindVertexArray(gl.createVertexArray()); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = {}; this.cur = -1;
    for (const k of ['col', 'alp', 'dep', 'nrm', 'cln', 'cdp', 'cnr']) this.tex[k] = gl.createTexture();
    this._up('cln', clean); this._up('cdp', cdep); this._up('cnr', cnrm);
    this._frame(0);
  }
  _up(k, im) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex[k]);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  }
  _frame(i) {
    i = Math.max(0, Math.min(this.n - 1, i | 0)); if (i === this.cur) return;
    this._up('col', this.color[i]); this._up('alp', this.alpha[i]); this._up('dep', this.depth[i]); this._up('nrm', this.normal[i]); this.cur = i;
  }
  // film cadence: the source frame for scene time t, the shot starting at t0 (held frames on 30 fps, no in-betweens)
  frameAt(t, { t0 = 0, rate = 1, offset = 0 } = {}) {
    if (this.n === 1) return 0;
    return Math.max(0, Math.min(this.n - 1, Math.floor((t - t0) * (this.meta.fps || 24) * rate + 1e-6) + offset));
  }
  // the output window in plate uv: cover-fit, then zoom about (cx, cy) in plate uv
  viewRect({ cx = .5, cy = .5, zoom = 1 } = {}) {
    const pa = this.pw / this.ph, oa = this.W / this.H;
    let w = 1, h = 1; if (pa > oa) w = oa / pa; else h = pa / oa;
    w /= zoom; h /= zoom;
    const x = Math.max(0, Math.min(1 - w, cx - w / 2)), y = Math.max(0, Math.min(1 - h, cy - h / 2));
    return [x, y, w, h];
  }
  render(t = 0, o = {}) {
    const gl = this.gl, u = this.u;
    this._frame(o.frame ?? this.frameAt(t, o.film || {}));
    gl.viewport(0, 0, this.W, this.H); gl.useProgram(this.pr);
    [['uCol', 'col'], ['uAlp', 'alp'], ['uDep', 'dep'], ['uCln', 'cln'], ['uCDp', 'cdp'], ['uNrm', 'nrm'], ['uCNr', 'cnr']].forEach(([n, k], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[k]); gl.uniform1i(u[n], i); });
    const V = this._view = this.viewRect(o.view);
    gl.uniform2f(u.uTex, 1 / this.pw, 1 / this.ph); gl.uniform2f(u.uOutPx, this.W, this.H);
    gl.uniform4f(u.uView, ...V);
    gl.uniform1f(u.uPush, o.push ?? 0); gl.uniform1f(u.uK0, o.k0 ?? 0.25);
    const f = o.focus || [V[0] + V[2] / 2, V[1] + V[3] / 2]; gl.uniform2f(u.uFocus, f[0], f[1]);
    gl.uniform2f(u.uPar, ...(o.parallax || [0, 0])); gl.uniform1f(u.uRelief, o.relief ?? 1);
    gl.uniform1f(u.uInset, o.inset ?? 6);
    const L = (o.lights || []).slice(0, NL), P = new Float32Array(NL * 4), Cc = new Float32Array(NL * 4), Oo = new Float32Array(NL * 4), Xx = new Float32Array(NL * 4);
    L.forEach((l, i) => {
      P.set([l.x, l.y, l.z ?? .5, l.radius ?? .35], i * 4);
      Cc.set([...(l.color || [1, 1, 1]), l.w ?? 1], i * 4);
      Xx.set([l.sharp ?? 1, 0, 0, 0], i * 4);
      Oo.set([l.wrap ?? .2, l.rim ?? 0, { all: 0, subject: 1, ground: 2 }[l.receive || 'all'], l.directional ? 1 : 0], i * 4);
    });
    gl.uniform4fv(u.uLp, P); gl.uniform4fv(u.uLc, Cc); gl.uniform4fv(u.uLo, Oo); gl.uniform4fv(u.uLx, Xx);
    gl.uniform1f(u.uLift, o.lift ?? 0); gl.uniform1f(u.uLiftPivot, o.liftPivot ?? .35); gl.uniform1f(u.uAlb, o.albedo ?? 1);
    gl.uniform3f(u.uShadowTint, ...(o.shadowTint || [1, 1, 1]));
    gl.uniform1f(u.uGain, o.gain ?? 1); gl.uniform1f(u.uSat, o.sat ?? 1);
    gl.uniform1f(u.uGrain, o.grain ?? 0.035); gl.uniform1f(u.uSeed, (o.seed ?? Math.floor(t * 30)) % 97);
    gl.uniform1f(u.uEdge, o.edge ?? 0.35);
    gl.uniform1i(u.uLayers, o.layers ?? (this.n > 1 ? 1 : 2));
    gl.uniform1i(u.uMode, { color: 0, aux: 1, depth: 2, alpha: 3 }[o.mode || 'color']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
  draw(ctx, t = 0, o = {}) {
    this.render(t, o);
    ctx.drawImage(this.canvas, o.x ?? 0, o.y ?? 0, o.w ?? ctx.canvas.width, o.h ?? ctx.canvas.height);
    return this;
  }
  // depth (0 near .. 1 far, 16-bit in R,G) and class (B: 255 subject) for looks.js, at the same view/push
  aux(t = 0, o = {}, { w = 540, h = 960 } = {}) {
    this.render(t, { ...o, mode: 'aux', grain: 0 });
    const c = this._aux && this._aux.width === w ? this._aux : (this._aux = Object.assign(document.createElement('canvas'), { width: w, height: h }));
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(this.canvas, 0, 0, w, h);
    this.render(t, o);   // leave the colour frame in the canvas
    return c;
  }
  // the subject's box and head in OUTPUT px for the current view (no push): for type slots and focus points
  subject(t = 0, o = {}) {
    const s = this.subj[this.frameAt(t, o.film || {})]; if (!s) return null;
    const [x, y, w, h] = this.viewRect(o.view), X = u => (u / this.pw - x) / w * this.W, Y = v => (v / this.ph - y) / h * this.H;
    return { bbox: [X(s.bbox[0]), Y(s.bbox[1]), X(s.bbox[2]), Y(s.bbox[3])], head: [X(s.head[0]), Y(s.head[1])], depth: s.depth };
  }
  // plate px -> plate uv (for light positions given in source px)
  uv(px, py) { return [px / this.pw, py / this.ph]; }
}

// Event light from the song's MEASURED onsets (scripts/looks_onsets.py or plate_onsets output), not the beat grid.
// onsets: [[t, flux], ...]. shape: an envelope per onset in frames (default: relight.js STRIKE-like). Returns 0..~1.
export const FLARE = [1, .55, .72, .5, .34, .24, .16, .1, .06, .03];
export function onsetLight(t, onsets, { shape = FLARE, fps = 30, min = 0, gain = 1, pre = 0 } = {}) {
  let v = 0;
  for (const [ot, fl] of onsets) {
    if (fl < min) continue;
    const f = Math.round((t - ot) * fps) + pre;
    if (f >= 0 && f < shape.length) v = Math.max(v, shape[f] * fl * gain);
  }
  return v;
}
// a light that rises into a state and holds (a hit that stays, not a flash that reverts)
export function holdLight(t, t0, { attack = 0.06, level = 1, flare = 1.6, decay = 0.35 } = {}) {
  if (t < t0) return 0;
  const a = Math.min(1, (t - t0) / attack);
  return level * a + (flare - level) * Math.exp(-(t - t0) / decay) * a;
}
