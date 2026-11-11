// LIGHT / display: ONE display transform for the whole 3D stack (LIGHTING c1).
//
// The critique (W7) charted the five tone curves in use: the per-channel ACES fit turns the house red magenta at +4 stops
// and sodium / furnace light lemon yellow ("the notorious six"); Hill ACES keeps red but fire goes cream; AgX holds hue
// but greys the house red at 0; Khronos Neutral keeps red but fire goes salmon-pink. This one is built to the chart:
//
//   1. white balance (a camera's Kelvin setting: Bradford CAT, light/color.js whiteBalance)
//   2. a filmic curve on the max-RGB norm (Lottes 2016, "Advanced Techniques and Optimization of HDR Color Pipelines"):
//      rgb * curve(max) / max keeps every hue AND its saturation through the curve; contrast a, shoulder d, mid grey
//      0.18 -> 0.18, white at +6.5 stops (so a lamp core and a furnace mouth keep gradation instead of a flat plateau)
//   3. a path to white in Oklab (Ottosson 2020): chroma falls with scene energy above +2.5 stops, hue constant, except
//      that hot warm hues (red..orange) drift toward yellow the way a colour negative's overexposed reds do. So the
//      house red at 0 stops is still the house red, red-hot steel at +4 goes orange (never pink), a sodium lamp core goes
//      pale gold, a furnace mouth white-gold at its hottest.
//   4. a hue-preserving gamut clip (toward the same Oklab lightness), then the sRGB OETF.
// Type and brand marks are composited AFTER this (they are display-referred: no curve may touch the brand red).
// GLSL for the page and the same maths in JS (for charts, tests and the CPU path). Keep the two in step.

export const DISPLAY_DEFAULTS = { contrast: 1.32, shoulder: 0.972, mid: 0.18, midOut: 0.18, whiteStops: 6.5, pathStart: 2.5, pathRange: 5.5, warmDrift: 1.0, sat: 1.0 };

export function lottesParams(o = {}) {
  const p = { ...DISPLAY_DEFAULTS, ...o };
  const a = p.contrast, d = p.shoulder, mi = p.mid, mo = p.midOut, hm = p.mid * 2 ** p.whiteStops;
  const b = (-(mi ** a) + (hm ** a) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo);
  const c = ((hm ** (a * d)) * (mi ** a) - (hm ** a) * (mi ** (a * d)) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo);
  return { a, d, b, c, mid: mi, ps: p.pathStart, pr: p.pathRange, wd: p.warmDrift, sat: p.sat };
}

export const DISPLAY_GLSL = /* glsl */`
uniform mat3 uWB;
uniform vec4 uCurve;     // a, d, b, c (Lottes)
uniform vec4 uPath;      // mid, pathStart (stops), pathRange (stops), warmDrift
uniform float uSatLook;
vec3 lin2oklab(vec3 c){
  vec3 l = vec3(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b, 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b, 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b);
  l = sign(l) * pow(abs(l), vec3(1.0/3.0));
  return vec3(0.2104542553*l.x + 0.7936177850*l.y - 0.0040720468*l.z, 1.9779984951*l.x - 2.4285922050*l.y + 0.4505937099*l.z, 0.0259040371*l.x + 0.7827717662*l.y - 0.8086757660*l.z);
}
vec3 oklab2lin(vec3 c){
  vec3 l = vec3(c.x + 0.3963377774*c.y + 0.2158037573*c.z, c.x - 0.1055613458*c.y - 0.0638541728*c.z, c.x - 0.0894841775*c.y - 1.2914855480*c.z);
  l = l*l*l;
  return vec3(4.0767416621*l.x - 3.3077115913*l.y + 0.2309699292*l.z, -1.2684380046*l.x + 2.6097574011*l.y - 0.3413193965*l.z, -0.0041960863*l.x - 0.7034186147*l.y + 1.7076147010*l.z);
}
float lottes(float x){ float xa = pow(x, uCurve.x); return xa / (pow(xa, uCurve.y) * uCurve.z + uCurve.w); }
vec3 acpDisplayLinear(vec3 c){
  c = uWB * c;
  // negatives (out-of-gamut lamps such as low-pressure sodium): pull toward their own luminance until non-negative
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722)), mn = min(c.r, min(c.g, c.b));
  if (mn < 0.0) c = mix(vec3(max(Y, 0.0)), c, max(Y, 0.0) / max(Y - mn, 1e-6));
  float n = max(c.r, max(c.g, c.b));
  if (n <= 1e-7) return vec3(0.0);
  vec3 rgb = c * (lottes(n) / n);
  // path to white in Oklab
  float k = clamp((log2(n / uPath.x) - uPath.y) / uPath.z, 0.0, 1.0); k = k * k * (3.0 - 2.0 * k);
  vec3 lab = lin2oklab(rgb);
  float C = length(lab.yz), h = atan(lab.z, lab.y);
  // warm hues (Oklab hue ~ -0.6 .. 1.4 rad: magenta-red .. orange-yellow) drift toward yellow (h ~ 1.5) as they burn out
  float warm = smoothstep(-0.9, -0.2, h) * (1.0 - smoothstep(1.3, 1.9, h));
  h = mix(h, 1.7, warm * uPath.w * sqrt(k));
  C *= (1.0 - k * k) * uSatLook;
  lab.x = mix(lab.x, 1.0, k);
  rgb = oklab2lin(vec3(lab.x, C * cos(h), C * sin(h)));
  // gamut clip toward the same lightness (hue kept)
  vec3 g = oklab2lin(vec3(lab.x, 0.0, 0.0));
  float s = 1.0;
  for (int i = 0; i < 3; i++) { float v = rgb[i], gv = g[i];
    if (v > 1.0) s = min(s, (1.0 - gv) / max(v - gv, 1e-6));
    if (v < 0.0) s = min(s, gv / max(gv - v, 1e-6)); }
  rgb = g + (rgb - g) * clamp(s, 0.0, 1.0);
  return clamp(rgb, 0.0, 1.0);
}
vec3 srgbOETF(vec3 c){ return mix(12.92 * c, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
vec3 acpDisplay(vec3 c){ return srgbOETF(acpDisplayLinear(c)); }
`;

// (c2) the same transform as CONSTANTS, for renderers that are not three.js (sdf.js): no uniforms to feed. wb: 9 numbers or null.
export function displayGLSLConst(o = {}, wb = null) {
  const P = lottesParams(o), f = v => Number(v).toFixed(7), m = wb || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return DISPLAY_GLSL.replace('uniform mat3 uWB;', `const mat3 uWB = mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(f).join(',')});`)
    .replace(/uniform vec4 uCurve;[^\n]*/, `const vec4 uCurve = vec4(${[P.a, P.d, P.b, P.c].map(f).join(',')});`)
    .replace(/uniform vec4 uPath;[^\n]*/, `const vec4 uPath = vec4(${[P.mid, P.ps, P.pr, P.wd].map(f).join(',')});`)
    .replace('uniform float uSatLook;', `const float uSatLook = ${f(P.sat)};`);
}

// ---------------------------------------------------------------- the same in JS (scene-linear Rec.709 -> display sRGB 0..1)
const cbrt = Math.cbrt;
export function lin2oklab([r, g, b]) {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
export function oklab2lin([L, a, b]) {
  let l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.2914855480 * b;
  l = l ** 3; m = m ** 3; s = s ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const srgbOETF = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
export function acpDisplay(c, P = lottesParams(), wb = null) {
  if (wb) c = [wb[0] * c[0] + wb[1] * c[1] + wb[2] * c[2], wb[3] * c[0] + wb[4] * c[1] + wb[5] * c[2], wb[6] * c[0] + wb[7] * c[1] + wb[8] * c[2]];
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], mn = Math.min(...c);
  if (mn < 0) { const t = Math.max(Y, 0) / Math.max(Y - mn, 1e-6); c = c.map(v => Math.max(Y, 0) + (v - Math.max(Y, 0)) * t); }
  const n = Math.max(...c); if (n <= 1e-7) return [0, 0, 0];
  const xa = n ** P.a, y = xa / ((xa ** P.d) * P.b + P.c);
  let rgb = c.map(v => v * y / n);
  const k = sstep(0, 1, (Math.log2(n / P.mid) - P.ps) / P.pr);
  const lab = lin2oklab(rgb); let C = Math.hypot(lab[1], lab[2]), h = Math.atan2(lab[2], lab[1]);
  const warm = sstep(-0.9, -0.2, h) * (1 - sstep(1.3, 1.9, h));
  h = h + (1.7 - h) * warm * P.wd * Math.sqrt(k); C *= (1 - k * k) * P.sat;
  const L = lab[0] + (1 - lab[0]) * k;
  rgb = oklab2lin([L, C * Math.cos(h), C * Math.sin(h)]);
  const g = oklab2lin([L, 0, 0]); let s = 1;
  for (let i = 0; i < 3; i++) { const v = rgb[i], gv = g[i]; if (v > 1) s = Math.min(s, (1 - gv) / Math.max(v - gv, 1e-6)); if (v < 0) s = Math.min(s, gv / Math.max(gv - v, 1e-6)); }
  s = Math.min(1, Math.max(0, s));
  return rgb.map((v, i) => srgbOETF(Math.min(1, Math.max(0, g[i] + (v - g[i]) * s))));
}

// the other curves in the stack, for the chart (scene-linear -> display sRGB 0..1)
const cl = v => Math.min(1, Math.max(0, v));
export const CURVES = {
  aces_fit: c => c.map(x => srgbOETF(cl((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)))),      // Narkowicz, sdf.js / post.js
  aces_hill: c => {                                                                                      // three ACESFilmicToneMapping
    const x = c.map(v => v / 0.6);
    const m1 = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];   // three's column-major as rows of M^T
    const m2 = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
    const a = [m1[0] * x[0] + m1[3] * x[1] + m1[6] * x[2], m1[1] * x[0] + m1[4] * x[1] + m1[7] * x[2], m1[2] * x[0] + m1[5] * x[1] + m1[8] * x[2]];
    const r = a.map(v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
    const o = [m2[0] * r[0] + m2[3] * r[1] + m2[6] * r[2], m2[1] * r[0] + m2[4] * r[1] + m2[7] * r[2], m2[2] * r[0] + m2[5] * r[1] + m2[8] * r[2]];
    return o.map(v => srgbOETF(cl(v)));
  },
  neutral: c0 => {                                                                                       // Khronos PBR Neutral
    let c = c0.slice(); const s = 0.8 - 0.04, D = 0.15, x = Math.min(...c), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c = c.map(v => v - off); const p = Math.max(...c); if (p < s) return c.map(v => srgbOETF(cl(v)));
    const d = 1 - s, np = 1 - d * d / (p + d - s); c = c.map(v => v * np / p); const g = 1 - 1 / (D * (p - np) + 1);
    return c.map(v => srgbOETF(cl(v * (1 - g) + np * g)));
  },
  acp: c => acpDisplay(c),
};
