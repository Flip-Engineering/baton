// WHITEOUT (WINTER SHIFT's engine, Oct 2026; built for ep.1 WHITEOUT): high-key winter weather that edits the picture. The snow is ONE
// thing at every distance: flakes are drawn one by one inside `near` and are the medium's extinction beyond it, both computed from the
// same snowfall rate and size distribution, so there is no seam at `near`. Everything is a pure function of t: flakes ride closed-form
// paths and the wind's travel is integrated analytically from its keys, so a still, a --from render and the movie agree.
// Capability note: research/capabilities/whiteout.md. Node checks: web/labs/whiteout/whiteout_test.mjs (no GL).
//
//   import { Whiteout } from '../lib/fx/whiteout.js';
//   const W = new Whiteout(THREE, scene, {
//     seed: 7, near: 15, count: 300000,                                   // flakes drawn individually within `near` m of the lens (the
//                                                                         // engine shortens `near` until `count` holds the density)
//     snow: { D50: 3.2, sigmaLn: 0.45, area: 0.4 },                       // log-normal maximum dimension (mm); `area` = projected area of
//                                                                         // an open aggregate / its circle
//     wind: { dir: [1, 0, 0.12], keys: [[0, 11], [2.9, 12], [3.5, 19], [4.4, 12], ...] },   // m/s at 10 m: a C1 curve through the keys
//     blow: { H: 3.0, k: 0.6, threshold: 7 },                             // blowing snow: sigma = k/1000 * (wind - threshold) * e^(-y/H) 1/m
//     vis: { keys: [[0, 150], [11, 220], [45, 600]] },                    // the designed MOR (m) between cuts; the snowfall is solved from it
//     drift: { count: 120000, depth: 0.25, far: 60 },                     // ground streamers ("snow snakes") over the ground plane
//     cuts: [{ at: 3.72, inF: 6, holdF: 6, outF: 16, dmin: 8 }, ...],     // whiteout cuts (frames at 30 fps); `at` = the swap time
//   });
//   W.shot({ ground: 0, colliders: [box3], L: [r, g, b], focus: 9, fstop: 4, lights: [...] })   // per shot (the scene's plan)
//   W.update(t, camera)            // per frame: the flakes' uniforms, the cut state
//   lr.render({ ..., fog: W.fogParams(t), overlay: W.overlay })         // light/'s opt-in medium and the flakes into the accumulator
//   W.white(t)        -> 0..1      // 1 - T(d_min): >= 0.995 means every pixel is within 1 % of the white level (the frame is the medium)
//   W.shotAt(t)       -> int       // which weather shot is up; changes only while white(t) >= 0.995
//   W.sigma(t, y=1.5) -> 1/m       // extinction at height y: falling snow + blowing snow + the cut
//   W.mor(t)          -> m         // 2.996 / sigma: the WMO meteorological optical range (5 % contrast)
//   W.windAt(t) -> m/s ; W.travel(t) -> m   // the wind's speed and its exact integral since 0 (what every flake rides)
//   W.flake(i, t)     -> { p: [x, y, z], v: [vx, vy, vz], D, drawn, culled }   // the closed form the vertex shader evaluates
//   W.cover(material, { depth, plaster, wind })    // snow on up-faces and plastered on windward verticals, for any lit material
//   W.enclosure({ size, at, lights, tau: 0.38 })   // a heated tarp: diffuse transmission tau, its outside luminance tau * E / pi
//   W.grade                        // the snow-blind grade: { apply(canvas) -> canvas, js(srgb) -> srgb, params }; type after it
//   W.events(t0, t1)  -> [{ t, kind: 'white' | 'swap' | 'clear', cut }]
//   W.stats           -> { drawn, culledInSolids, sigmaNear, sigmaFar, near, msUpdate }
//
// Physics (sources in the capability note):
//   fall speed   V = 0.8 D^0.16 m/s, mass M = 0.073 D^1.4 mg (D in mm): Locatelli and Hobbs 1974, Table 1, aggregates of unrimed dendrites;
//                +-8 % seeded scatter on V
//   motion       flakes ride the wind (relaxation time V/g ~ 0.1 s): x = x0 + dir * travel(t) + a closed-form curl-noise displacement
//                (divergence-free; frozen eddies the flake falls through, amplitude ~ the wind); y = y0 - V t; wrapped in a shot-aligned
//                box round the lens, so the near-field density is constant at any t
//   density      R = n E[M V] (mm/h water); sigma_snow = n E[2 area (pi/4) D^2] (extinction efficiency 2); MOR = 2.996 / sigma (Koschmieder,
//                the WMO 5 % threshold). vis.keys designs MOR(t) at 1.5 m, the snowfall n(t) is solved from it, and the drawn flakes are
//                kept with probability n(t) / n_ref, so the flakes inside `near` and the medium beyond it are the same snow
//   blowing      sigma_blow(y, t) = k/1000 (wind - threshold)+ e^(-y/H): gusts thicken the air low down first
//   the cut      sigma rises (a log-shaped ramp) over inF frames to sigma_hold = 5.3 / d_min (T(d_min) = 0.005), holds, clears over outF;
//                the swap happens only inside the hold
//   the medium   light/pipeline.js's opt-in `fog`: L = L_inf (1 - T) + C T per sub-frame in scene-linear light, T from the cut (from the
//                lens), the snowfall (from `near` out: inside it the flakes are the snow) and the blowing layer integrated along the ray
//   the flakes   camera-facing streaks from p(t - shutter) to p(t) (180 degrees at 30 fps), opened into discs by the lens's circle of
//                confusion with their energy kept; depth-tested against the prepass; drawn into the accumulator after the sub-frames
//                (light/pipeline.js's opt-in `overlay`), before bloom and the display transform; shaded by the shot's sky radiance and up
//                to four practicals with a forward-scattering phase (Henyey-Greenstein g = 0.8)
import { lin2oklab, oklab2lin, acpDisplay, lottesParams } from './light/display.js';
import { srgbToLinear, linearToSrgb } from './light/color.js';

export const WHITEOUT_VERSION = 1;
const FPS = 30;
const MOR_K = 2.996;                       // -ln(0.05): the WMO meteorological optical range
const T_WHITE = 0.005;                     // transmittance to the nearest surface at which the frame is the medium alone
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------ the snow's physics
export const SNOW = {
  V: D => 0.8 * D ** 0.16,                 // m/s (D mm)
  M: D => 0.073 * D ** 1.4,                // mg
  VSCAT: 0.08,                             // +-8 % seeded scatter on V
};
// E[f(D)] over the clamped log-normal the flakes sample (D = clamp(D50 e^(s z)), z standard normal): Simpson over z in [-6, 6]
export function sizeMoment(f, { D50 = 3.2, sigmaLn = 0.45, Dmin = 0.6, Dmax = 10 } = {}) {
  const n = 1200, a = -6, b = 6, h = (b - a) / n; let s = 0;
  for (let i = 0; i <= n; i++) { const z = a + i * h, w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2, D = clamp(D50 * Math.exp(sigmaLn * z), Dmin, Dmax);
    s += w * f(D) * Math.exp(-z * z / 2); }
  return s * h / 3 / Math.sqrt(2 * Math.PI);
}
// the ensemble: per-flake extinction cross-section (m^2) and mass flux (kg m/s), and the conversions rate <-> n <-> sigma
export function snowModel(snow = {}) {
  const S = { D50: 3.2, sigmaLn: 0.45, area: 0.4, Dmin: 0.6, Dmax: 10, ...snow };
  const ext = sizeMoment(D => 2 * S.area * Math.PI / 4 * (D * 1e-3) ** 2, S);          // m^2 per flake
  const mv = sizeMoment(D => SNOW.M(D) * 1e-6 * SNOW.V(D), S);                         // kg m / s per flake (the scatter averages to 1)
  const meanV = sizeMoment(D => SNOW.V(D), S);
  return { ...S, ext, mv, meanV,
    nFromRate: R => R / (3600 * mv), rateFromN: n => n * 3600 * mv,                    // R in mm/h water equivalent (1 kg/m^2 = 1 mm)
    sigmaFromN: n => n * ext, nFromSigma: s => s / ext };
}

// ------------------------------------------------------------------ hashing (identical in JS and GLSL ES 3.0)
const U32 = x => x >>> 0;
export function whash(x) { x = U32(x); x ^= x >>> 16; x = U32(Math.imul(x, 0x7feb352d)); x ^= x >>> 15; x = U32(Math.imul(x, 0x846ca68b)); x ^= x >>> 16; return U32(x); }
export const wrand = (i, k, seed) => (whash(U32(U32(Math.imul(i, 0x9E3779B9)) + U32(Math.imul(k, 0x85EBCA6B)) + U32(seed))) >>> 8) / 16777216;
const HASH_GLSL = /* glsl */`
uint whash(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float wrand(uint i, uint k, uint s){ return float(whash(i * 0x9E3779B9u + k * 0x85EBCA6Bu + s) >> 8u) / 16777216.0; }`;

// ------------------------------------------------------------------ the wind: a C1 curve through the keys, integrated exactly
// Cubic Hermite with weighted finite-difference tangents and the Fritsch-Carlson limiter (no overshoot below 0), flat outside the keys.
export class WindCurve {
  constructor(keys = [[0, 8]]) {
    const K = this.k = keys.map(([t, v]) => [+t, +v]).sort((a, b) => a[0] - b[0]); const n = K.length;
    const m = this.m = new Array(n).fill(0), d = [];
    for (let i = 0; i < n - 1; i++) d.push((K[i + 1][1] - K[i][1]) / Math.max(1e-9, K[i + 1][0] - K[i][0]));
    for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
      const h0 = K[i][0] - K[i - 1][0], h1 = K[i + 1][0] - K[i][0]; m[i] = (d[i - 1] * h1 + d[i] * h0) / (h0 + h1);
      const lim = 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i])); if (Math.abs(m[i]) > lim) m[i] = Math.sign(m[i]) * lim; }
    // the integral at each key (from the first key)
    this.F = [0]; for (let i = 0; i < n - 1; i++) this.F.push(this.F[i] + this._seg(i, 1));
    this.F0 = this._F(0);
  }
  _locate(t) { const K = this.k; let lo = 0, hi = K.length - 1; if (t <= K[0][0]) return -1; if (t >= K[hi][0]) return hi; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (K[md][0] <= t) lo = md; else hi = md; } return lo; }
  _seg(i, u) { const K = this.k, h = K[i + 1][0] - K[i][0], p0 = K[i][1], p1 = K[i + 1][1], m0 = this.m[i], m1 = this.m[i + 1];
    const u2 = u * u, u3 = u2 * u, u4 = u3 * u;
    return h * (p0 * (u4 / 2 - u3 + u) + h * m0 * (u4 / 4 - 2 * u3 / 3 + u2 / 2) + p1 * (-u4 / 2 + u3) + h * m1 * (u4 / 4 - u3 / 3)); }
  at(t) { const K = this.k, i = this._locate(t); if (i < 0) return K[0][1]; if (i >= K.length - 1) return K[K.length - 1][1];
    const h = K[i + 1][0] - K[i][0], u = (t - K[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * K[i][1] + (u3 - 2 * u2 + u) * h * this.m[i] + (-2 * u3 + 3 * u2) * K[i + 1][1] + (u3 - u2) * h * this.m[i + 1]; }
  slope(t) { const K = this.k, i = this._locate(t); if (i < 0 || i >= K.length - 1) return 0;
    const h = K[i + 1][0] - K[i][0], u = (t - K[i][0]) / h, u2 = u * u;
    return ((6 * u2 - 6 * u) * K[i][1] + (3 * u2 - 4 * u + 1) * h * this.m[i] + (-6 * u2 + 6 * u) * K[i + 1][1] + (3 * u2 - 2 * u) * h * this.m[i + 1]) / h; }
  _F(t) { const K = this.k, i = this._locate(t); if (i < 0) return K[0][1] * (t - K[0][0]); const n = K.length;
    if (i >= n - 1) return this.F[n - 1] + K[n - 1][1] * (t - K[n - 1][0]); return this.F[i] + this._seg(i, (t - K[i][0]) / (K[i + 1][0] - K[i][0])); }
  travel(t) { return this._F(t) - this.F0; }            // metres the air has moved since t = 0
}

// ------------------------------------------------------------------ closed-form curl noise (divergence-free displacement)
// d(s, t) = sum_m a_m cos(k_m . s + phi_m + w_m t) (k_m x e_j(m)): each term is the curl of a_m sin(k_m . s + ...) e_j, so div d = 0.
export function curlTerms(seed, { scale = [2.2, 3.4, 5.1, 7.3], omega = [0.35, 0.5, 0.7, 0.9] } = {}) {
  const T = [];
  for (let m = 0; m < 4; m++) {
    const r = k => wrand(9000 + m, k, seed), th = 2 * Math.PI * r(1), ph = Math.acos(2 * r(2) - 1), kk = 2 * Math.PI / scale[m];
    const k = [Math.sin(ph) * Math.cos(th) * kk, Math.cos(ph) * kk * 0.7, Math.sin(ph) * Math.sin(th) * kk], j = m % 3;
    const e = [0, 0, 0]; e[j] = 1;
    const ax = [k[1] * e[2] - k[2] * e[1], k[2] * e[0] - k[0] * e[2], k[0] * e[1] - k[1] * e[0]], n = Math.hypot(...ax) || 1;
    T.push({ k, phi: 2 * Math.PI * r(3), w: omega[m], ax: ax.map(v => v / n), a: 1 / (m + 1) });
  }
  const s = Math.sqrt(T.reduce((q, x) => q + x.a * x.a, 0) / 2); for (const x of T) x.a /= s;   // RMS 1 per axis-ish
  return T;
}
export function curlAt(T, s, t) { const d = [0, 0, 0];
  for (const x of T) { const c = x.a * Math.cos(x.k[0] * s[0] + x.k[1] * s[1] + x.k[2] * s[2] + x.phi + x.w * t); d[0] += c * x.ax[0]; d[1] += c * x.ax[1]; d[2] += c * x.ax[2]; }
  return d; }

// ------------------------------------------------------------------ the snow-blind grade (display-referred, after light/display.js)
// A soft shoulder on Oklab L (mid grey kept, snow to 0.94-0.97), blacks lifted to a blue-slate, global chroma x 0.45 except inside the
// episode's accent windows (hue in degrees, half-width, minimum chroma), a local-contrast pass on L. Type and marks go on after it.
export const GRADE_DEFAULTS = {
  black: [0.33, -0.01, -0.035],            // Oklab of the lifted black
  midIn: 0.5646, white: 0.9745,            // Oklab L: sRGB 0.46 (0.18 linear) kept; L 1.0 -> 0.9745 (sRGB 0.967)
  slope0: 0.62, slopeMid: 1.0, slope1: 0.32,
  sat: 0.45,
  accents: [[255, 12, 0.08], [25, 10, 0.03], [55, 12, 0.03], [145, 20, 0.02]],   // blue H sign, red tail lights, orange tarps, fluorescent
  local: { radius: 24, amount: 0.22, limit: 0.12 },
};
function hermite(x, x0, x1, y0, y1, m0, m1) { const h = x1 - x0, u = (x - x0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1; }
export function gradeTone(L, P = GRADE_DEFAULTS) {
  const Lc = clamp(L, 0, 1.05);
  return Lc <= P.midIn ? hermite(Lc, 0, P.midIn, P.black[0], P.midIn, P.slope0, P.slopeMid) : hermite(Math.min(Lc, 1), P.midIn, 1, P.midIn, P.white, P.slopeMid, P.slope1);
}
const hueDist = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
export function accentWeight(h, C, P = GRADE_DEFAULTS) { let w = 0; for (const [hc, hw, cmin] of P.accents) w = Math.max(w, (1 - sstep(hw * 0.75, hw, hueDist(h, hc))) * sstep(cmin * 0.6, cmin, C)); return w; }
// one pixel (sRGB 0..1 in and out); `blurL` is the neighbourhood's graded L for the local-contrast pass (omit: no local contrast)
export function gradePixel(rgb, P = GRADE_DEFAULTS, blurL = null) {
  const lab = lin2oklab(rgb.map(srgbToLinear)); let [L, a, b] = lab;
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, w = accentWeight(h, C, P);
  let L2 = gradeTone(L, P);
  const k = (1 - sstep(0, 0.45, L)) ** 2 * (1 - w);                              // the blue-slate lift, dark neutrals only
  const s = P.sat + (1 - P.sat) * w;
  a = a * s + P.black[1] * k; b = b * s + P.black[2] * k;
  if (blurL != null) L2 += clamp(P.local.amount * (L2 - blurL), -P.local.limit, P.local.limit);
  // back to sRGB with a hue-preserving gamut clip toward the same L
  let o = oklab2lin([L2, a, b]); const g = oklab2lin([L2, 0, 0]); let sc = 1;
  for (let i = 0; i < 3; i++) { if (o[i] > 1) sc = Math.min(sc, (1 - g[i]) / Math.max(o[i] - g[i], 1e-6)); if (o[i] < 0) sc = Math.min(sc, g[i] / Math.max(g[i] - o[i], 1e-6)); }
  sc = clamp(sc); o = o.map((v, i) => clamp(g[i] + (v - g[i]) * sc));
  return o.map(linearToSrgb);
}
export const oklabHue = rgbSrgb => { const [, a, b] = lin2oklab(rgbSrgb.map(srgbToLinear)); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
export const contrastRatio = (c1, c2) => { const Y = c => { const l = c.map(srgbToLinear); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; }; const a = Y(c1), b = Y(c2); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

const GRADE_GLSL = /* glsl */`
uniform sampler2D tIn, tBlur; uniform vec2 uTexel; uniform float uLocalOn;
uniform vec4 uTone;      // midIn, white, slope0, slope1
uniform vec4 uBlack;     // L, a, b, sat
uniform vec4 uAcc[4];    // hue (rad), half-width (rad), min chroma, -
uniform vec3 uLocal;     // amount, limit, -
varying vec2 vUv;
float s2l(float v){ return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float l2s(float v){ return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
vec3 lin2lab(vec3 c){
  vec3 l = vec3(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b, 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b, 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b);
  l = sign(l) * pow(abs(l), vec3(1.0/3.0));
  return vec3(0.2104542553*l.x + 0.7936177850*l.y - 0.0040720468*l.z, 1.9779984951*l.x - 2.4285922050*l.y + 0.4505937099*l.z, 0.0259040371*l.x + 0.7827717662*l.y - 0.8086757660*l.z); }
vec3 lab2lin(vec3 c){
  vec3 l = vec3(c.x + 0.3963377774*c.y + 0.2158037573*c.z, c.x - 0.1055613458*c.y - 0.0638541728*c.z, c.x - 0.0894841775*c.y - 1.2914855480*c.z);
  l = l*l*l;
  return vec3(4.0767416621*l.x - 3.3077115913*l.y + 0.2309699292*l.z, -1.2684380046*l.x + 2.6097574011*l.y - 0.3413193965*l.z, -0.0041960863*l.x - 0.7034186147*l.y + 1.7076147010*l.z); }
float herm(float x, float x0, float x1, float y0, float y1, float m0, float m1){ float h = x1 - x0, u = (x - x0) / h, u2 = u * u, u3 = u2 * u;
  return (2.0*u3 - 3.0*u2 + 1.0) * y0 + (u3 - 2.0*u2 + u) * h * m0 + (-2.0*u3 + 3.0*u2) * y1 + (u3 - u2) * h * m1; }
float tone(float L){ float Lc = clamp(L, 0.0, 1.05);
  return Lc <= uTone.x ? herm(Lc, 0.0, uTone.x, uBlack.x, uTone.x, uTone.z, 1.0) : herm(min(Lc, 1.0), uTone.x, 1.0, uTone.x, uTone.y, 1.0, uTone.w); }
float accW(float h, float C){ float w = 0.0;
  for (int i = 0; i < 4; i++) { float d = abs(mod(h - uAcc[i].x + 9.42477796, 6.28318531) - 3.14159265);
    w = max(w, (1.0 - smoothstep(uAcc[i].y * 0.75, uAcc[i].y, d)) * smoothstep(uAcc[i].z * 0.6, uAcc[i].z, C)); }
  return w; }
vec3 gradeLab(vec3 srgb){
  vec3 lab = lin2lab(vec3(s2l(srgb.r), s2l(srgb.g), s2l(srgb.b)));
  float C = length(lab.yz), h = atan(lab.z, lab.y), w = accW(h, C);
  float k = pow(1.0 - smoothstep(0.0, 0.45, lab.x), 2.0) * (1.0 - w), s = uBlack.w + (1.0 - uBlack.w) * w;
  return vec3(tone(lab.x), lab.y * s + uBlack.y * k, lab.z * s + uBlack.z * k); }`;
const GRADE_L_FRAG = GRADE_GLSL + /* glsl */`
void main(){ vec3 g = gradeLab(texture2D(tIn, vUv).rgb); gl_FragColor = vec4(g.x, 0.0, 0.0, 1.0); }`;
const GRADE_BLUR_FRAG = /* glsl */`
uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
void main(){ float s = 0.0, w = 0.0; for (int i = -12; i <= 12; i++) { float k = exp(-float(i * i) / 72.0); s += texture2D(tIn, vUv + uDir * float(i)).r * k; w += k; } gl_FragColor = vec4(s / w, 0.0, 0.0, 1.0); }`;
const GRADE_FRAG = GRADE_GLSL + /* glsl */`
void main(){
  vec3 g = gradeLab(texture2D(tIn, vUv).rgb);
  if (uLocalOn > 0.5) g.x += clamp(uLocal.x * (g.x - texture2D(tBlur, vUv).r), -uLocal.y, uLocal.y);
  vec3 o = lab2lin(g), gr = lab2lin(vec3(g.x, 0.0, 0.0)); float sc = 1.0;
  for (int i = 0; i < 3; i++) { if (o[i] > 1.0) sc = min(sc, (1.0 - gr[i]) / max(o[i] - gr[i], 1e-6)); if (o[i] < 0.0) sc = min(sc, gr[i] / max(gr[i] - o[i], 1e-6)); }
  o = clamp(gr + (o - gr) * clamp(sc, 0.0, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(l2s(o.r), l2s(o.g), l2s(o.b), 1.0); }`;
const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class SnowGrade {
  constructor(THREE, { W = 1080, H = 1920, params = {} } = {}) { this.THREE = THREE; this.W = W; this.H = H; this.params = { ...GRADE_DEFAULTS, ...params }; this.r = null; }
  js(rgb, blurL = null) { return gradePixel(rgb, this.params, blurL); }
  // a 33^3 table of the grade without the local pass (for a CPU path or a chart)
  lut(n = 33) { const out = new Float32Array(n * n * n * 3); let k = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const o = gradePixel([r / (n - 1), g / (n - 1), b / (n - 1)], this.params); out[k++] = o[0]; out[k++] = o[1]; out[k++] = o[2]; }
    return out; }
  _init() {
    const T = this.THREE, P = this.params, W = this.W, H = this.H;
    this.canvas = (globalThis.document ? document.createElement('canvas') : null); this.canvas.width = W; this.canvas.height = H;
    const r = this.r = new T.WebGLRenderer({ canvas: this.canvas, antialias: false, preserveDrawingBuffer: true, alpha: false });
    r.setPixelRatio(1); r.setSize(W, H, false); r.outputColorSpace = T.LinearSRGBColorSpace; r.toneMapping = T.NoToneMapping; r.autoClear = true;
    this.tex = new T.Texture(); this.tex.colorSpace = T.NoColorSpace; this.tex.generateMipmaps = false; this.tex.minFilter = this.tex.magFilter = T.LinearFilter; this.tex.flipY = true;
    const hw = Math.round(W / 2), hh = Math.round(H / 2), o = { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
    this.rtL = new T.WebGLRenderTarget(hw, hh, o); this.rtB = new T.WebGLRenderTarget(hw, hh, o);
    const rad = Math.PI / 180, acc = P.accents.map(([h, w, c]) => new T.Vector4(h * rad, w * rad, c, 0)); while (acc.length < 4) acc.push(new T.Vector4(0, 0, 9, 0));
    const common = { uTone: { value: new T.Vector4(P.midIn, P.white, P.slope0, P.slope1) }, uBlack: { value: new T.Vector4(P.black[0], P.black[1], P.black[2], P.sat) }, uAcc: { value: acc },
      uLocal: { value: new T.Vector3(P.local.amount, P.local.limit, 0) }, uTexel: { value: new T.Vector2(1 / W, 1 / H) } };
    const quad = mat => { const m = new T.Mesh(new T.PlaneGeometry(2, 2), mat); m.frustumCulled = false; const s = new T.Scene(); s.add(m); return { s, m }; };
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.qL = quad(new T.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: GRADE_L_FRAG, uniforms: { ...common, tIn: { value: this.tex }, tBlur: { value: null }, uLocalOn: { value: 0 } } }));
    this.qB = quad(new T.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: GRADE_BLUR_FRAG, uniforms: { tIn: { value: null }, uDir: { value: new T.Vector2() } } }));
    this.qF = quad(new T.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: GRADE_FRAG, uniforms: { ...common, tIn: { value: this.tex }, tBlur: { value: this.rtL.texture }, uLocalOn: { value: 1 } } }));
  }
  // src: a canvas (the LitRenderer's output); returns this grade's canvas (draw it, then the type)
  apply(src, { local = true } = {}) {
    if (!this.r) this._init();
    const r = this.r, hw = this.rtL.width, hh = this.rtL.height; this.tex.image = src; this.tex.needsUpdate = true;
    if (local) {
      r.setRenderTarget(this.rtL); r.render(this.qL.s, this.cam);                                   // graded L at half resolution
      const R = this.params.local.radius / 24;                                                     // radius 24 px: a 12 px sigma (6 half-res taps)
      const bu = this.qB.m.material.uniforms;
      bu.tIn.value = this.rtL.texture; bu.uDir.value.set(R / hw, 0); r.setRenderTarget(this.rtB); r.render(this.qB.s, this.cam);
      bu.tIn.value = this.rtB.texture; bu.uDir.value.set(0, R / hh); r.setRenderTarget(this.rtL); r.render(this.qB.s, this.cam);
    }
    this.qF.m.material.uniforms.uLocalOn.value = local ? 1 : 0;
    r.setRenderTarget(null); r.render(this.qF.s, this.cam);
    return this.canvas;
  }
}

// ------------------------------------------------------------------ snow cover and plaster (any lit MeshStandardMaterial)
// cover: faces with n.up above cos 35 deg (smooth to cos 60 deg), depth growing with the accumulated snowfall; plaster: vertical faces with
// n.(-wind) above 0.3, broken by noise; snow albedo 0.9, roughness 0.85. JS mirror (coverAt) for the node checks.
const COVER_NOISE_GLSL = /* glsl */`
float wo_h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wo_vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wo_h3(i), wo_h3(i + vec3(1,0,0)), f.x), mix(wo_h3(i + vec3(0,1,0)), wo_h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wo_h3(i + vec3(0,0,1)), wo_h3(i + vec3(1,0,1)), f.x), mix(wo_h3(i + vec3(0,1,1)), wo_h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
const fract = x => x - Math.floor(x);
function h3(p) { let x = fract(p[0] * 0.3183099 + 0.1) * 17, y = fract(p[1] * 0.3183099 + 0.1) * 17, z = fract(p[2] * 0.3183099 + 0.1) * 17; return fract(x * y * z * (x + y + z)); }
export function vnoise3(p) { const i = p.map(Math.floor), f = p.map((v, k) => { const u = v - i[k]; return u * u * (3 - 2 * u); });
  const c = (a, b, d) => h3([i[0] + a, i[1] + b, i[2] + d]), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(c(0, 0, 0), c(1, 0, 0), f[0]), L(c(0, 1, 0), c(1, 1, 0), f[0]), f[1]), L(L(c(0, 0, 1), c(1, 0, 1), f[0]), L(c(0, 1, 1), c(1, 1, 1), f[0]), f[1]), f[2]); }
export const COVER_DEFAULTS = { depth: 1, plaster: 1, wind: [1, 0, 0.12], albedo: 0.9, rough: 0.85, up0: Math.cos(60 * Math.PI / 180), up1: Math.cos(35 * Math.PI / 180), w0: 0.3, w1: 0.45, scale: 2.2 };
// n: the world normal (unit), p: the world position -> { cover, plaster, snow } in 0..1
export function coverAt(n, p, o = {}) {
  const P = { ...COVER_DEFAULTS, ...o }, wl = Math.hypot(...P.wind) || 1, w = P.wind.map(v => v / wl);
  const nz = vnoise3(p.map(v => v * P.scale)), nz2 = vnoise3(p.map(v => v * P.scale * 3.7 + 11));
  const cover = sstep(P.up0, P.up1, n[1]) * clamp(P.depth) * (0.85 + 0.15 * nz);
  const into = -(n[0] * w[0] + n[1] * w[1] + n[2] * w[2]), vert = 1 - sstep(0.55, 0.8, Math.abs(n[1]));
  const plaster = into > P.w0 ? sstep(P.w0, P.w1, into) * vert * clamp(P.plaster) * sstep(0.35, 0.6, 0.6 * nz + 0.4 * nz2 + 0.25 * into) : 0;
  return { cover, plaster, snow: Math.max(cover, plaster) };
}
let _coverKey = 0;
export function coverMaterial(THREE, m, o = {}) {
  if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || m.userData.whiteoutCover) return m;
  const P = { ...COVER_DEFAULTS, ...o }, wl = Math.hypot(...P.wind) || 1;
  const U = m.userData.whiteoutCover = { uWoCover: { value: new THREE.Vector4(P.depth, P.plaster, P.albedo, P.rough) }, uWoWind: { value: new THREE.Vector3(...P.wind.map(v => v / wl)) },
    uWoK: { value: new THREE.Vector4(P.up0, P.up1, P.w0, P.w1) }, uWoScale: { value: P.scale } };
  const prev = m.onBeforeCompile?.bind(m), prevKey = m.customProgramCacheKey?.bind(m), key = ++_coverKey;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWoP; varying vec3 vWoN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWoP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWoN = normalize(mat3(modelMatrix) * objectNormal);');
    // after every other layer has set the colour, roughness and metalness (surface.js and the kit's wear overwrite after their anchors)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWoP; varying vec3 vWoN; uniform vec4 uWoCover; uniform vec3 uWoWind; uniform vec4 uWoK; uniform float uWoScale;
${COVER_NOISE_GLSL}`)
      .replace('#include <normal_fragment_begin>', `{ vec3 n_ = normalize(vWoN); float nz_ = wo_vn(vWoP * uWoScale), nz2_ = wo_vn(vWoP * uWoScale * 3.7 + 11.0);
  float cov_ = smoothstep(uWoK.x, uWoK.y, n_.y) * clamp(uWoCover.x, 0.0, 1.0) * (0.85 + 0.15 * nz_);
  float into_ = -dot(n_, uWoWind), vert_ = 1.0 - smoothstep(0.55, 0.8, abs(n_.y));
  float pl_ = into_ > uWoK.z ? smoothstep(uWoK.z, uWoK.w, into_) * vert_ * clamp(uWoCover.y, 0.0, 1.0) * smoothstep(0.35, 0.6, 0.6 * nz_ + 0.4 * nz2_ + 0.25 * into_) : 0.0;
  float s_ = max(cov_, pl_);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(uWoCover.z), s_); roughnessFactor = mix(roughnessFactor, uWoCover.w, s_); metalnessFactor = mix(metalnessFactor, 0.0, s_); }
#include <normal_fragment_begin>`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|woc' + key;
  m.needsUpdate = true;
  return m;
}

// ------------------------------------------------------------------ the heated tarp enclosure
// Interior lights (pos, cd, rgb) light the inside of a translucent shell (white reinforced poly, diffuse transmission tau ~ 0.38). The
// outside luminance of each face is tau * E_in / pi, E_in the irradiance on the inside of that face, so the glow is energy-consistent with
// the lamps. Returns per face { centre, normal, area, E, L } and the shell's area-weighted L.
// tint: the shell's spectral transmission relative to tau (white reinforced poly warms what it passes: its scrim and its UV-aged film)
export const TARP_TINT = [1.0, 0.8, 0.6];
export function enclosureLuminance({ size = [12, 4, 10], at = [0, 0, 0], yaw = 0, lights = [], tau = 0.38, tint = TARP_TINT, n = 12 } = {}) {
  const [X, Y, Z] = size, c = Math.cos(yaw), s = Math.sin(yaw);
  const toW = (x, y, z) => [at[0] + c * x + s * z, at[1] + y, at[2] - s * x + c * z], rot = v => [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  // faces: +x, -x, +z, -z, roof (+y); a pitched roof is treated as flat
  const F = [[[X / 2, Y / 2, 0], [1, 0, 0], [Z, Y], 'z'], [[-X / 2, Y / 2, 0], [-1, 0, 0], [Z, Y], 'z'], [[0, Y / 2, Z / 2], [0, 0, 1], [X, Y], 'x'], [[0, Y / 2, -Z / 2], [0, 0, -1], [X, Y], 'x'], [[0, Y, 0], [0, 1, 0], [X, Z], 'y']];
  const faces = F.map(([cc, nn, [a, b], ax]) => {
    let E = [0, 0, 0]; const N = rot(nn);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const u = (i + 0.5) / n - 0.5, v = (j + 0.5) / n - 0.5;
      const lp = ax === 'z' ? [cc[0], cc[1] + v * b, u * a] : ax === 'x' ? [u * a, cc[1] + v * b, cc[2]] : [u * a, cc[1], v * b];
      const p = toW(...lp);
      for (const L of lights) { const d = [p[0] - L.pos[0], p[1] - L.pos[1], p[2] - L.pos[2]], r2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, r = Math.sqrt(r2);
        const cosi = (d[0] * N[0] + d[1] * N[1] + d[2] * N[2]) / r; if (cosi <= 0) continue;
        const I = L.cd * (L.dir ? Math.max(0, (d[0] * L.dir[0] + d[1] * L.dir[1] + d[2] * L.dir[2]) / r) ** (L.exp ?? 0) : 1);
        for (let k = 0; k < 3; k++) E[k] += I * (L.rgb?.[k] ?? 1) * cosi / r2 / (n * n); } }
    const Ey = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2];
    const L = E.map((e, k) => tau * tint[k] * e / Math.PI);
    return { centre: toW(...cc), normal: N, area: a * b, E, Ey, L, Ly: 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2] };
  });
  const A = faces.reduce((q, f) => q + f.area, 0), Ly = faces.reduce((q, f) => q + f.Ly * f.area, 0) / A;
  return { faces, Ly, tau };
}

// ------------------------------------------------------------------ the flakes' vertex and fragment shaders (GLSL ES 3.0 through three)
export const FLAKE_VERT = /* glsl */`
${HASH_GLSL}
uniform vec3 uCam;          // the lens (world)
uniform vec2 uYaw;          // cos, sin of the box frame's yaw (box -> world: x' = c x + s z, z' = -s x + c z)
uniform vec4 uBox;          // Lx, Ly, Lz, z0 (the box runs from -z0 - Lz to -z0 in front of the lens, box frame)
uniform float uYLo;         // the box's lower face relative to the lens (box frame y)
uniform vec4 uTime;         // t, shutter, travel(t), travel(t - shutter)
uniform vec4 uWind;         // dir.xyz (box frame), wind(t)
uniform float uWind0;       // wind(t - shutter)
uniform vec4 uD;            // D50 (mm), sigmaLn, Dmin, Dmax
uniform vec4 uPop;          // seed, keep = n(t) / n_ref, mode (0 snow, 1 drift), turb (m per m/s)
uniform vec4 uDrift;        // ground y (world), layer depth (m), streamer gate (0..1), wind fraction at the ground
uniform vec4 uTk[4];        // curl terms: k.xyz, phase
uniform vec4 uTa[4];        // curl terms: axis.xyz * a, omega
uniform vec4 uLens;         // px per metre at 1 m (0.5 H P11), aperture diameter (m), focus (m), focal (m)
uniform vec4 uNear;         // near (m), fade start (m), occlusion (projected area / circle), opacity
uniform vec2 uRes;
uniform vec4 uBoxMin[8]; uniform vec4 uBoxMax[8]; uniform int uNBox;
uniform vec3 uL;            // the flake's base radiance (pre-exposed): the shot's sky-lit snow
uniform vec4 uLP[4]; uniform vec4 uLC[4];   // practicals: pos.xyz + on; colour * candela (pre-exposed) + -
uniform vec4 uFogF;         // the medium in front of a flake: sigma from the lens (the cut + blowing), L_inf.rgb in uFogL
uniform vec3 uFogL;
varying vec2 vQ;            // the fragment in the streak's frame (px): along, across
flat varying vec4 vS;       // length (px), radius (px), opacity, view depth (m)
flat varying vec3 vC;       // radiance (pre-exposed)
vec3 curl(vec3 s, float t){ vec3 d = vec3(0.0); for (int m = 0; m < 4; m++) d += cos(dot(uTk[m].xyz, s) + uTk[m].w + uTa[m].w * t) * uTa[m].xyz; return d; }
vec3 toWorld(vec3 q){ return vec3(uYaw.x * q.x + uYaw.y * q.z, q.y, -uYaw.y * q.x + uYaw.x * q.z); }
vec3 toBox(vec3 p){ return vec3(uYaw.x * p.x - uYaw.y * p.z, p.y, uYaw.y * p.x + uYaw.x * p.z); }
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void cull(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vS = vec4(0.0); vC = vec3(0.0); vQ = vec2(0.0); }
void main(){
  uint i = uint(gl_InstanceID), sd = uint(uPop.x);
  float r1 = wrand(i, 1u, sd), r2 = wrand(i, 2u, sd), r3 = wrand(i, 3u, sd), r4 = wrand(i, 4u, sd);
  float r5 = wrand(i, 5u, sd), r6 = wrand(i, 6u, sd), r7 = wrand(i, 7u, sd), r8 = wrand(i, 8u, sd);
  float z = sqrt(-2.0 * log(max(r1, 1e-7))) * cos(6.2831853 * r2);
  float D = clamp(uD.x * exp(uD.y * z), uD.z, uD.w);
  float V = 0.8 * pow(D, 0.16) * (1.0 + 0.08 * (2.0 * r3 - 1.0));
  bool drift = uPop.z > 0.5;
  float keep = uPop.y;
  vec3 Q0 = vec3(r5, r6, r7) * uBox.xyz;
  float t = uTime.x, t0 = t - uTime.y;
  vec3 q1, q0;
  if (!drift) {
    vec3 s1 = Q0 + vec3(0.0, -V * t, 0.0), s0 = Q0 + vec3(0.0, -V * t0, 0.0);
    q1 = s1 + uWind.xyz * uTime.z + uPop.w * uWind.w * curl(s1, t);
    q0 = s0 + uWind.xyz * uTime.w + uPop.w * uWind0 * curl(s0, t0);
  } else {
    // ground streamers: grains saltating in a thin layer, carried at a fraction of the wind, gathered into bands by the frozen eddies
    vec3 s1 = Q0, s0 = Q0;
    float hop = uDrift.y * (0.15 + 0.85 * r8 * r8) * (0.55 + 0.45 * sin(6.2831853 * (r4 * 7.0 + t * (1.3 + r3))));
    float hop0 = uDrift.y * (0.15 + 0.85 * r8 * r8) * (0.55 + 0.45 * sin(6.2831853 * (r4 * 7.0 + t0 * (1.3 + r3))));
    q1 = s1 + uWind.xyz * uTime.z * uDrift.w + uPop.w * uWind.w * curl(s1 * 0.7, t) * vec3(1.0, 0.0, 1.0);
    q0 = s0 + uWind.xyz * uTime.w * uDrift.w + uPop.w * uWind0 * curl(s0 * 0.7, t0) * vec3(1.0, 0.0, 1.0);
    float band = 0.5 + 0.5 * sin(dot(vec2(-uWind.z, uWind.x), q1.xz) * 2.4 + 1.7 * sin(dot(uWind.xz, q1.xz) * 0.21 + t * 0.4));
    keep *= smoothstep(0.35, 0.85, band) * uDrift.z;
    // the height above the ground (set in world space below), so the box wraps x and z only
    q1.y = hop; q0.y = hop0;
  }
  if (r4 > keep) { cull(); return; }
  // wrap into the cell round the lens (box frame), the same lattice offset for both ends of the streak
  vec3 cB = toBox(uCam), lo = cB + vec3(-0.5 * uBox.x, uYLo, -uBox.w - uBox.z);
  if (drift) lo.y = 0.0;
  vec3 kq = floor((q1 - lo) / uBox.xyz); if (drift) kq.y = 0.0;
  q1 -= kq * uBox.xyz; q0 -= kq * uBox.xyz;
  vec3 p1 = toWorld(q1), p0 = toWorld(q0);
  if (drift) { p1.y = uDrift.x + q1.y; p0.y = uDrift.x + q0.y; }
  for (int b = 0; b < 8; b++) { if (b >= uNBox) break; if (all(greaterThan(p1, uBoxMin[b].xyz)) && all(lessThan(p1, uBoxMax[b].xyz))) { cull(); return; } }
  vec4 v1 = viewMatrix * vec4(p1, 1.0), v0 = viewMatrix * vec4(p0, 1.0);
  float d1 = -v1.z;
  if (d1 < 0.12 || d1 > uNear.x || -v0.z < 0.05) { cull(); return; }
  vec4 c1 = projectionMatrix * v1, c0 = projectionMatrix * v0;
  vec2 S1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes, S0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  // size: the flake, the lens's circle of confusion, a floor of half a pixel
  float rpx = 0.5 * D * 1e-3 * uLens.x / d1;
  float coc = uLens.y / max(uLens.z - uLens.w, 1e-3) * abs(d1 - uLens.z) / d1 * uLens.x;
  float R = sqrt(rpx * rpx + 0.25 * coc * coc + 0.25);
  vec2 dv = S1 - S0; float len = length(dv); vec2 ax = len > 1e-3 ? dv / len : vec2(1.0, 0.0), nx = vec2(-ax.y, ax.x);
  if (len > 0.6 * uRes.y) { cull(); return; }
  // energy kept: the flake's own area spread over the streak and the disc (a gaussian profile across, round ends)
  float A = 3.14159265 * rpx * rpx * uNear.z, cap = len * 1.2533 * R + 1.5708 * R * R;
  float alpha = min(uNear.z, A / cap) * uNear.w;
  alpha *= smoothstep(uNear.x, uNear.y, d1) * smoothstep(0.12, 0.45, d1);
  // shading: the shot's sky-lit snow, and the practicals scattered forward toward the lens
  vec3 Lf = uL * (0.78 + 0.22 * r8);
  vec3 vd = normalize(uCam - p1);
  for (int k = 0; k < 4; k++) { if (uLP[k].w <= 0.0) continue; vec3 l = uLP[k].xyz - p1; float dd = max(dot(l, l), 0.25); l *= inversesqrt(dd);
    Lf += uLC[k].rgb / dd * hg(dot(-l, vd), 0.8) * 3.14159265 * 0.9; }
  float Tf = exp(-uFogF.x * d1); Lf = mix(uFogL, Lf, Tf);
  vec2 corner = position.xy;
  float ext = len * 0.5 + 2.0 * R;
  vec2 mid = 0.5 * (S0 + S1), P = mid + ax * corner.x * ext + nx * corner.y * 2.0 * R;
  vQ = vec2(corner.x * ext + 0.5 * len, corner.y * 2.0 * R);
  vS = vec4(len, R, alpha, d1); vC = Lf;
  gl_Position = vec4(P / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;
export const FLAKE_FRAG = /* glsl */`
uniform sampler2D tPre; uniform vec2 uRes;
varying vec2 vQ; flat varying vec4 vS; flat varying vec3 vC;
void main(){
  if (vS.z <= 0.0) discard;
  float u = vQ.x, dd = length(vec2(max(0.0, max(-u, u - vS.x)), vQ.y));
  float a = vS.z * exp(-2.0 * dd * dd / (vS.y * vS.y));
  if (a < 0.0015) discard;
  // the scene in front of the flake hides it (the prepass holds 1 / depth); a soft edge over 25 cm
  float iz = texture2D(tPre, gl_FragCoord.xy / uRes).a;
  if (iz > 0.0) { float zs = 1.0 / iz; a *= clamp((zs - vS.w) / 0.25, 0.0, 1.0); if (a <= 0.0) discard; }
  gl_FragColor = vec4(vC * a, a);
}`;

// ------------------------------------------------------------------ the engine
const DEF = {
  seed: 7, near: 15, count: 300000, shutter: 1 / 60,
  snow: { D50: 3.2, sigmaLn: 0.45, area: 0.4, Dmin: 0.6, Dmax: 10 },
  wind: { dir: [1, 0, 0.12], keys: [[0, 8]] }, turb: 0.03,
  blow: { H: 3.0, k: 0.6, threshold: 7 }, vis: { keys: [[0, 200]] }, yRef: 1.5,
  drift: { count: 0, depth: 0.25, far: 50, wind: 0.6, D50: 0.35, sigmaLn: 0.4, Dmin: 0.15, Dmax: 1.0 },
  cuts: [], colliders: [],
};

export class Whiteout {
  constructor(THREE, scene, o = {}) {
    this.THREE = THREE; this.scene = scene;
    const P = this.o = { ...DEF, ...o, snow: { ...DEF.snow, ...(o.snow || {}) }, wind: { ...DEF.wind, ...(o.wind || {}) }, blow: { ...DEF.blow, ...(o.blow || {}) },
      vis: { ...DEF.vis, ...(o.vis || {}) }, drift: { ...DEF.drift, ...(o.drift || {}) } };
    this.model = snowModel(P.snow);
    this.windC = new WindCurve(P.wind.keys);
    const wl = Math.hypot(...P.wind.dir) || 1; this.windDir = P.wind.dir.map(v => v / wl);
    this.terms = curlTerms(P.seed);
    this.cuts = (P.cuts || []).map((c, i) => this._cut(c, i)).sort((a, b) => a.t0 - b.t0);
    this.shotCfg = { ground: 0, colliders: P.colliders || [], L: [1, 1, 1], lights: [], focus: 10, fstop: 4, focal: 0.085, enabled: true, dmin: 8, drift: true, count: null, near: null };
    this.stats = { drawn: 0, culledInSolids: 0, sigmaNear: 0, sigmaFar: 0, near: P.near, msUpdate: 0 };
    this.grade = new SnowGrade(THREE, o.grade || {});
    this.overlay = (r, lr) => this._overlay(r, lr);
    this._t = 0; this.camera = null;
    if (THREE && scene !== null) this._build();
  }
  // ---------------------------------------------------------------- the weather as functions of t
  windAt(t) { return this.windC.at(t); }
  travel(t) { return this.windC.travel(t); }
  morDesign(t) { const K = this.o.vis.keys; if (t <= K[0][0]) return K[0][1]; if (t >= K[K.length - 1][0]) return K[K.length - 1][1];
    let i = 0; while (i < K.length - 2 && K[i + 1][0] <= t) i++; const u = sstep(K[i][0], K[i + 1][0], t); return Math.exp(Math.log(K[i][1]) * (1 - u) + Math.log(K[i + 1][1]) * u); }
  sigmaBlow(t, y = this.o.yRef) { const B = this.o.blow; return B.k * 1e-3 * Math.max(0, this.windAt(t) - B.threshold) * Math.exp(-Math.max(0, y) / B.H); }
  sigmaSnow(t) { const sd = MOR_K / this.morDesign(t); return Math.max(0.25 * sd, sd - this.sigmaBlow(t)); }
  nSnow(t) { return this.model.nFromSigma(this.sigmaSnow(t)); }
  rate(t) { return this.model.rateFromN(this.nSnow(t)); }
  _cut(c, i) {
    const at = c.at, inF = c.inF ?? 6, holdF = c.holdF ?? 6, outF = c.outF ?? 16, f = 1 / FPS;
    const t1 = c.hold0 ?? (at - holdF * f / 2), t0 = t1 - inF * f, t2 = c.toEnd ? 1e9 : t1 + holdF * f, t3 = c.toEnd ? 1e9 : t2 + outF * f;
    const dmin = c.dmin ?? 8, hold = (-Math.log(T_WHITE) / dmin) * 1.02;
    return { i, at, inF, holdF, outF, t0, t1, t2, t3, dmin, hold, swap: c.swap !== false && !c.toEnd, toEnd: !!c.toEnd, name: c.name || 'w' + (i + 1) };
  }
  _cutAt(t) { for (const c of this.cuts) if (t >= c.t0 && t <= c.t3) return c; return null; }
  cutLevel(t) { const c = this._cutAt(t); if (!c) return 0; return t < c.t1 ? sstep(c.t0, c.t1, t) : t <= c.t2 ? 1 : 1 - sstep(c.t2, c.t3, t); }
  sigmaCut(t) { const c = this._cutAt(t); if (!c) return 0; const s = this.cutLevel(t); if (s <= 0) return 0;
    const b = Math.max(1e-4, this.sigmaSnow(t)), q = c.hold / b; return c.hold * (Math.exp(s * Math.log(q)) - 1) / (q - 1); }
  sigma(t, y = this.o.yRef) { return this.sigmaSnow(t) + this.sigmaBlow(t, y) + this.sigmaCut(t); }
  mor(t) { return MOR_K / this.sigma(t); }
  // the nearest surface's depth at t (the active cut's, else the shot's)
  dmin(t) { const c = this._cutAt(t); return c ? c.dmin : this.shotCfg.dmin; }
  // transmittance to depth d along a level ray at the lens's height, as the renderer's medium computes it (snow from `near` out)
  T(t, d, yCam = this.o.yRef, near = this.nearEff()) { const B = this.o.blow;
    const tau = this.sigmaCut(t) * d + this.sigmaSnow(t) * Math.max(0, d - near) + B.k * 1e-3 * Math.max(0, this.windAt(t) - B.threshold) * Math.exp(-Math.max(0, yCam - this.shotCfg.ground) / B.H) * d;
    return Math.exp(-tau); }
  white(t) { return 1 - this.T(t, this.dmin(t)); }
  shotAt(t) { let k = 0; for (const c of this.cuts) if (c.swap && t >= c.at) k++; return k; }
  events(t0 = 0, t1 = 1e9) { const ev = [];
    for (const c of this.cuts) { if (c.t1 >= t0 && c.t1 < t1) ev.push({ t: c.t1, kind: 'white', cut: c.name }); if (c.swap && c.at >= t0 && c.at < t1) ev.push({ t: c.at, kind: 'swap', cut: c.name });
      if (!c.toEnd && c.t2 >= t0 && c.t2 < t1) ev.push({ t: c.t2, kind: 'clear', cut: c.name }); }
    return ev.sort((a, b) => a.t - b.t); }
  // ---------------------------------------------------------------- the near field: how much box `count` flakes can fill at the density
  // the densest snowfall the box must hold: over the shot's span when the plan gives one (W.shot({ span: [t0, t1] })), else the whole piece
  nRef() { const K = this.o.vis.keys, sp = this.shotCfg?.span, a = sp ? sp[0] : K[0][0] - 1, b = sp ? sp[1] : K[K.length - 1][0] + 1; let n = 0;
    for (let t = a; t <= b + 1e-9; t += 0.05) n = Math.max(n, this.nSnow(t)); return Math.max(n, 1e-6); }
  lensGeom(cam = this.camera) {
    const fovy = cam ? cam.fov * Math.PI / 180 : 23.9 * Math.PI / 180, asp = cam ? cam.aspect : 1080 / 1920, ty = Math.tan(fovy / 2), tx = ty * asp;
    const pitch = cam ? Math.asin(clamp(new this.THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).y, -1, 1)) : 0;
    return { ty, tx, pitch, fovy };
  }
  // the near field's depth: the box round the frustum (half-extents at its far face, 4 % margin) holds exactly `count` flakes at the
  // densest snowfall of the shot, so the drawn density is the medium's density (no seam); never deeper than o.near
  nearEff(cam = this.camera) {
    if (this.shotCfg.near) return this.shotCfg.near;
    const N = this.shotCfg.count ?? this.o.count, n = this._nRef ?? (this._nRef = this.nRef()), target = N / n;
    if (this._boxVol(this.o.near, cam) <= target) return this.o.near;
    let lo = 0.5, hi = this.o.near; for (let k = 0; k < 48; k++) { const m = (lo + hi) / 2; if (this._boxVol(m, cam) > target) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  _boxDims(near, cam = this.camera) { const g = this.lensGeom(cam), z0 = 0.12, hy = (g.ty + Math.abs(Math.sin(g.pitch))) * near * 1.04;
    return { Lx: 2 * g.tx * near * 1.04, Ly: 2 * hy, Lz: near - z0, z0, yLo: -hy, near }; }
  _boxVol(near, cam) { const b = this._boxDims(near, cam); return b.Lx * b.Ly * b.Lz; }
  box(cam = this.camera) { return this._boxDims(this.nearEff(cam), cam); }
  // ---------------------------------------------------------------- one flake, the closed form (as the vertex shader)
  _yawOf(cam) { if (!cam) return 0; const f = new this.THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); return Math.atan2(-f.x, -f.z); }
  flake(i, t, { cam = this.camera, drift = false } = {}) {
    const P = this.o, sd = drift ? P.seed + 101 : P.seed, r = k => wrand(i, k, sd);
    const Dp = drift ? P.drift : P.snow, z = Math.sqrt(-2 * Math.log(Math.max(r(1), 1e-7))) * Math.cos(2 * Math.PI * r(2));
    const D = clamp(Dp.D50 * Math.exp(Dp.sigmaLn * z), Dp.Dmin, Dp.Dmax), V = SNOW.V(D) * (1 + SNOW.VSCAT * (2 * r(3) - 1));
    const bx = drift ? this.driftBox(cam) : this.box(cam), Q0 = [r(5) * bx.Lx, r(6) * bx.Ly, r(7) * bx.Lz];
    const yaw = this._yawOf(cam), c = Math.cos(yaw), s = Math.sin(yaw);
    const wd = this.windDir, wb = [c * wd[0] - s * wd[2], wd[1], s * wd[0] + c * wd[2]];
    const pos = tt => {
      if (!drift) { const sp = [Q0[0], Q0[1] - V * tt, Q0[2]], cu = curlAt(this.terms, sp, tt), A = P.turb * this.windAt(tt), tr = this.travel(tt);
        return [sp[0] + wb[0] * tr + A * cu[0], sp[1] + wb[1] * tr + A * cu[1], sp[2] + wb[2] * tr + A * cu[2]]; }
      const cu = curlAt(this.terms, Q0.map(v => v * 0.7), tt), A = P.turb * 2.5 * this.windAt(tt), tr = this.travel(tt) * P.drift.wind;
      const hop = P.drift.depth * (0.15 + 0.85 * r(8) ** 2) * (0.55 + 0.45 * Math.sin(2 * Math.PI * (r(4) * 7 + tt * (1.3 + r(3)))));
      return [Q0[0] + wb[0] * tr + A * cu[0], hop, Q0[2] + wb[2] * tr + A * cu[2]];
    };
    const cp = cam ? cam.position : { x: 0, y: this.o.yRef, z: 0 }, cB = [c * cp.x - s * cp.z, cp.y, s * cp.x + c * cp.z];
    const lo = [cB[0] - bx.Lx / 2, drift ? 0 : cB[1] + bx.yLo, cB[2] - bx.z0 - bx.Lz], L = [bx.Lx, bx.Ly, bx.Lz];
    const q1 = pos(t), q0 = pos(t - 1e-3), q2 = pos(t + 1e-3);
    const kq = q1.map((v, k) => (drift && k === 1) ? 0 : Math.floor((v - lo[k]) / L[k]));
    const w = q => { const qq = q.map((v, k) => v - kq[k] * L[k]); const p = [c * qq[0] + s * qq[2], qq[1], -s * qq[0] + c * qq[2]]; if (drift) p[1] = this.shotCfg.ground + qq[1]; return p; };
    const p = w(q1), pa = w(q0), pb = w(q2), v = [0, 1, 2].map(k => (pb[k] - pa[k]) / 2e-3);
    let keep = drift ? 1 : this.nSnow(t) / (this._nRef ?? (this._nRef = this.nRef()));
    if (drift) { const cross = -wb[2] * q1[0] + wb[0] * q1[2], along = wb[0] * q1[0] + wb[2] * q1[2], band = 0.5 + 0.5 * Math.sin(cross * 2.4 + 1.7 * Math.sin(along * 0.21 + t * 0.4)); keep *= sstep(0.35, 0.85, band) * this.driftGate(t); }
    const drawn = r(4) <= keep;
    let culled = false; for (const b of this.shotCfg.colliders || []) { if (p[0] > b.min.x && p[0] < b.max.x && p[1] > b.min.y && p[1] < b.max.y && p[2] > b.min.z && p[2] < b.max.z) { culled = true; break; } }
    return { p, v, D, V, drawn, culled };
  }
  driftGate(t) { const B = this.o.blow; return clamp(0.35 + (this.windAt(t) - B.threshold) / 10); }
  driftBox(cam = this.camera) { const g = this.lensGeom(cam), far = this.o.drift.far; return { Lx: 2 * g.tx * far * 1.04, Ly: 1, Lz: far - 0.5, z0: 0.5, yLo: 0, near: far }; }
  // the flakes' own extinction inside `near` (Monte Carlo over n flakes): the no-seam check
  sigmaFromFlakes(t, n = 20000, cam = this.camera) {
    const bx = this.box(cam), V = bx.Lx * bx.Ly * bx.Lz, N = this.shotCfg.count ?? this.o.count; let s = 0, k = 0;
    for (let i = 0; i < n; i++) { const f = this.flake(i, t, { cam }); if (f.drawn) { k++; s += 2 * this.o.snow.area * Math.PI / 4 * (f.D * 1e-3) ** 2; } }
    return { sigma: s / n * N / V, drawn: k / n * N };
  }
  // ---------------------------------------------------------------- per shot, per frame
  shot(cfg = {}) { Object.assign(this.shotCfg, cfg); this._nRef = null; return this; }
  fogParams(t = this._t) {
    const s = this.shotCfg, B = this.o.blow;
    if (!s.enabled) return null;
    return { sigma: this.sigmaSnow(t), near: this.nearEff(), cut: this.sigmaCut(t), blowK: B.k * 1e-3 * Math.max(0, this.windAt(t) - B.threshold), blowH: B.H, base: s.ground, far: s.far ?? 6000, L: s.L };
  }
  update(t, camera) {
    const t0 = globalThis.performance ? performance.now() : Date.now();
    this._t = t; this.camera = camera; const s = this.shotCfg, P = this.o;
    if (this.mats) {
      const near = this.nearEff(camera), bx = this.box(camera), yaw = this._yawOf(camera), c = Math.cos(yaw), sn = Math.sin(yaw), wd = this.windDir;
      const wb = [c * wd[0] - sn * wd[2], wd[1], sn * wd[0] + c * wd[2]], sh = P.shutter;
      const pxs = 0.5 * (this._res?.[1] ?? 1920) / Math.tan(camera.fov * Math.PI / 360);
      const nref = this._nRef ?? (this._nRef = this.nRef());
      const fogNear = this.sigmaCut(t) + this.sigmaBlow(t, camera.position.y - s.ground) * 0.6;
      const whiteFade = 1 - sstep(0.97, 0.995, this.white(t));
      for (const [k, m] of Object.entries(this.mats)) {
        const u = m.uniforms, drift = k === 'drift', dbx = drift ? this.driftBox(camera) : bx;
        u.uCam.value.copy(camera.position); u.uYaw.value.set(c, sn);
        u.uBox.value.set(dbx.Lx, dbx.Ly, dbx.Lz, dbx.z0); u.uYLo.value = dbx.yLo;
        u.uTime.value.set(t, sh, this.travel(t), this.travel(t - sh)); u.uWind.value.set(wb[0], wb[1], wb[2], this.windAt(t)); u.uWind0.value = this.windAt(t - sh);
        const Dp = drift ? P.drift : P.snow; u.uD.value.set(Dp.D50, Dp.sigmaLn, Dp.Dmin, Dp.Dmax);
        u.uPop.value.set(drift ? P.seed + 101 : P.seed, drift ? 1 : this.nSnow(t) / nref, drift ? 1 : 0, P.turb * (drift ? 2.5 : 1));
        u.uDrift.value.set(s.ground, P.drift.depth, this.driftGate(t), P.drift.wind);
        u.uLens.value.set(pxs, s.focal / Math.max(s.fstop, 0.5), s.focus, s.focal);
        u.uNear.value.set(drift ? dbx.near : near, (drift ? dbx.near : near) * 0.85, P.snow.area * (drift ? 1.2 : 1), (s.opacity ?? 1) * whiteFade * (drift ? (s.driftK ?? 0.7) : 1));
        u.uL.value.set(...s.L.map(v => v * (s.flakeK ?? 0.85)));
        const cols = s.colliders || []; u.uNBox.value = Math.min(8, cols.length);
        cols.slice(0, 8).forEach((b, i) => { u.uBoxMin.value[i].set(b.min.x, b.min.y, b.min.z, 0); u.uBoxMax.value[i].set(b.max.x, b.max.y, b.max.z, 0); });
        for (let i = 0; i < 4; i++) { const L = s.lights?.[i]; if (L) { u.uLP.value[i].set(L.pos[0], L.pos[1], L.pos[2], 1); u.uLC.value[i].set(L.rgb[0] * L.cd, L.rgb[1] * L.cd, L.rgb[2] * L.cd, 0); } else u.uLP.value[i].w = 0; }
        u.uFogF.value.set(fogNear, 0, 0, 0); u.uFogL.value.set(...s.L);
        const on = s.enabled && (drift ? (s.drift && P.drift.count > 0) : true);
        this.meshes[k].visible = on; this.meshes[k].geometry.instanceCount = drift ? P.drift.count : (s.count ?? P.count);
      }
      this.stats.near = near;
    }
    this.stats.sigmaFar = this.sigmaSnow(t); this.stats.msUpdate = (globalThis.performance ? performance.now() : Date.now()) - t0;
    return this;
  }
  _build() {
    const T = this.THREE, P = this.o;
    const geo = () => { const g = new T.InstancedBufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.instanceCount = 0; g.boundingSphere = new T.Sphere(new T.Vector3(), 1e9); return g; };
    const v4 = () => new T.Vector4();
    const mk = () => new T.ShaderMaterial({ vertexShader: FLAKE_VERT, fragmentShader: FLAKE_FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
      uniforms: { uCam: { value: new T.Vector3() }, uYaw: { value: new T.Vector2(1, 0) }, uBox: { value: v4() }, uYLo: { value: 0 }, uTime: { value: v4() }, uWind: { value: v4() }, uWind0: { value: 0 },
        uD: { value: v4() }, uPop: { value: v4() }, uDrift: { value: v4() },
        uTk: { value: this.terms.map(x => new T.Vector4(x.k[0], x.k[1], x.k[2], x.phi)) }, uTa: { value: this.terms.map(x => new T.Vector4(x.ax[0] * x.a, x.ax[1] * x.a, x.ax[2] * x.a, x.w)) },
        uLens: { value: v4() }, uNear: { value: v4() }, uRes: { value: new T.Vector2(1080, 1920) },
        uBoxMin: { value: Array.from({ length: 8 }, v4) }, uBoxMax: { value: Array.from({ length: 8 }, v4) }, uNBox: { value: 0 },
        uL: { value: new T.Vector3(1, 1, 1) }, uLP: { value: Array.from({ length: 4 }, v4) }, uLC: { value: Array.from({ length: 4 }, v4) },
        uFogF: { value: v4() }, uFogL: { value: new T.Vector3() }, tPre: { value: null } } });
    this.mats = { snow: mk(), drift: mk() };
    this.meshes = {}; this.flakeScene = new T.Scene();
    for (const k of ['snow', 'drift']) { const m = this.meshes[k] = new T.Mesh(geo(), this.mats[k]); m.frustumCulled = false; m.renderOrder = k === 'drift' ? 0 : 1; this.flakeScene.add(m); }
  }
  // light/pipeline.js's opt-in overlay: the flakes into the accumulator (scene-linear, pre-exposed), depth-tested against the prepass
  _overlay(r, lr) {
    if (!this.mats || !this.camera || !this.shotCfg.enabled) return;
    this._res = [lr.W, lr.H];
    for (const m of Object.values(this.mats)) { m.uniforms.tPre.value = lr.pre.texture; m.uniforms.uRes.value.set(lr.W, lr.H); m.uniforms.uLens.value.x = 0.5 * lr.H / Math.tan(this.camera.fov * Math.PI / 360); }
    r.setRenderTarget(lr.acc); r.render(this.flakeScene, this.camera);
  }
  cover(material, o = {}) { return coverMaterial(this.THREE, material, { wind: this.windDir, ...o }); }
  // a heated tarp: { size, at, yaw, lights: [{ pos, cd, rgb }], tau } -> { L (cd/m2 luminance per face), shellMat (emissive, pre-exposed by `exposure`) }
  enclosure(o = {}, exposure = 1) {
    const T = this.THREE, E = enclosureLuminance(o);
    const L = E.faces.reduce((q, f) => q.map((v, k) => v + f.L[k] * f.area), [0, 0, 0]).map(v => v / E.faces.reduce((q, f) => q + f.area, 0));
    const mx = Math.max(...L, 1e-9), col = new T.Color(L[0] / mx, L[1] / mx, L[2] / mx);
    const mat = new T.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.9, metalness: 0, emissive: col, emissiveIntensity: mx * exposure, side: T.DoubleSide });
    mat.userData.whiteoutTarp = { L, Ly: E.Ly, tau: E.tau, faces: E.faces };
    return { L, Ly: E.Ly, faces: E.faces, mat, col: L.map(v => v / mx), intensity: mx };
  }
  // the medium's own radiance in display terms (for a design value per shot): the scene-linear L whose display value is `v`
  static airL(v, wb = null, P = lottesParams()) { let lo = 1e-4, hi = 64; for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi), d = acpDisplay([m, m, m], P, wb)[1]; if (d < v) lo = m; else hi = m; } return Math.sqrt(lo * hi); }
}
