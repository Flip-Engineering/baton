// LIGHT / camera7 (CAMERA7, round 7): PHOTOGRAPHIC image formation. Nothing imports this unless it asks; display.js, the '@5' stages and every render that
// does not name a camera are untouched (pipeline.js gates it behind rig.camera7 / the render option `camera7`, a uniform that is 0 otherwise).
//
// What physically differs between our plates and the c3 photographs (tools/c7stats.py, review/studio_human_c8/after/camera7/NOTES.md):
//   1. EXPOSURE PLACEMENT. The studio meters the lit side of a face so it reads its own reflectance (zone rule: deep skin a stop or two under mid
//      grey). Photographs do not: face-priority metering and the tone curve place every skin in a narrow band. skinBias() is that metering rule.
//   2. THE CURVE. display.js is a hue-preserving curve on the max-RGB norm with its white at +6.5 stops (right for a lamp or a furnace, wrong for a
//      portrait): a camera acts on each channel (that is what saturates the mid tones and sends bright colours to white) and clips at about +3.5 stops
//      over the 18 % card. display7().
//   3. THE LENS AND THE SENSOR: portrait focal length and aperture (the engine's thin-lens accumulation takes them), output sharpening for the Cycles
//      plates, and an optional signal-dependent sensor noise.
// THE COLOUR RENDERING KNOWS NO HUE (c3 iteration 1, after CHECK F1: the earlier chroma ceiling and skin vibrance were weighted by a Gaussian of the Oklab hue round
// the skin hue and turned a scarlet banner into brick): the camera has one global chroma gain and one hue-agnostic path to white; the colour of a skin is the
// albedo's and the light's (SKIN7), the camera never sees "skin". The numpy twin is videos/blender/camera7_display.py; the node test (labs/human8/camera7_test.mjs)
// writes the table both must reproduce.
import { lin2oklab, oklab2lin, srgbOETF } from './display.js';

export const CAMERA7_DISPLAY = {
  contrast: 1.32, shoulder: 0.96, mid: 0.18, midOut: 0.18, whiteStops: 3.6,   // Lottes's family (display.js lottesParams), white at +3.6 stops
  perChannel: 0.6,                                                            // 0 = display.js's max-RGB norm (hue kept), 1 = a camera's per-channel curve
  sat: 1.04,                                                                  // one global chroma gain in Oklab (no hue band)
  black: 0.014,                                                               // a soft toe on the luminance (scene units, after the exposure): Y' = Y - black (1 - exp(-Y / black)); 0 = off
  ped: 0.0022,                                                                // a pedestal, the black level of a camera's JPEG (the photographs' darkest pixels are L* 1.4-4.8, never 0): y' = ped + (1 - ped) y on the display-linear value, after the curve (0.0022 = L* 2.0)
  pathStart: 3.0, pathRange: 2.0,                                             // the path to white (stops over mid), later than display.js's 2.5: chroma fades and lightness rises to 1, for every hue alike
  expo: 0.0,                                                                  // exposure compensation, stops (skinBias() per person)
};
export const CAMERA7_SKIN = { a: -0.22, b: -0.5, lo: 0.0, hi: 2.2 };         // bias = a + b * log2(skinY), fitted to 12 cast faces x the c3 photographs' lit-side L* by background
export const CAMERA7_LENS = {
  portrait: { focal: 85, fstop: 2.8 },       // an 85 mm at f/2.8 on full frame (the face camera's 24 degree field IS an 85 mm on 36 mm): eyes sharp, ears and hair soft
  portrait4: { focal: 85, fstop: 4 },        // (iteration 1's default: the cheek 2 cm off the focal plane lost 0.17 of lc_fine)
  portrait56: { focal: 85, fstop: 5.6 },     // studio@7's default from iteration 2: a studio headshot is shot at f/5.6-f/8 (strobes), the skin plane sharp from brow to chin
  environmental: { focal: 35, fstop: 5.6 },
};
// output sharpening on the display-referred plate: an unsharp mask with a THRESHOLD (the fine variation, pores and lashes, is boosted, strong edges are left alone: the
// engine's edges are already as sharp as the photographs'; it is the skin's fine contrast the lens takes back). sigma in px for a 1350 px tall plate (scaled by height
// in the engine; Cycles scales it by the head's size), amount, thr (display units: the mask is 1 - smoothstep(thr / 2, thr, max |plate - blur|))
export const CAMERA7_SHARPEN = { sigma: 1.5, amount: 1.2 };                  // Cycles (iteration 1): classic mask (rev 3: blender/camera7_display.py CAMERA7_SHARPEN, the threshold mask at 0.9, sigma by the head's size); the engine's `sharpen` is below
export const CAMERA7_SHARPEN_ENGINE = { sigma: 1.5, amount: 1.0, thr: 0.04 };
// the backdrop tracks the exposure compensation (a photographer lights the background apart from the face; metering the face must not turn a mid-grey paper to white):
// stops added to the paper's tint = -(track * bias + offset) where `bias` is the skin-zone compensation applied (fitted: the paper's display L* stays ~50 over bias 0.4-1.6)
export const CAMERA7_BG = { track: 1.385, offset: 0.578 };   // c2 refit on the 12 engine plates (corners L* 59 -> 50); it2 / it3: 1.15, 0.3
export function bgStops(bias, B = CAMERA7_BG) { return -(B.track * Math.max(0, bias) + B.offset); }
export const CAMERA7_SENSOR = { shot: 0.0, read: 0.0 };                       // signal-dependent noise sigma^2 = shot * Y + read^2 (linear, exposed): off by default

export function params7(o = {}) {
  const p = { ...CAMERA7_DISPLAY, ...o }, a = p.contrast, d = p.shoulder, mi = p.mid, mo = p.midOut, hm = p.mid * 2 ** p.whiteStops;
  const den = ((hm ** (a * d)) - (mi ** (a * d))) * mo;
  p.toeG = p.black > 0 ? mi / (mi - p.black * (1 - Math.exp(-mi / p.black))) : 1;   // the toe keeps 18 % grey where it was
  p.a = a; p.d = d; p.b = (-(mi ** a) + (hm ** a) * mo) / den; p.c = ((hm ** (a * d)) * (mi ** a) - (hm ** a) * (mi ** (a * d)) * mo) / den;
  return p;
}

// the photographer's skin-zone rule: exposure compensation (stops) for a person whose lit-side skin reads its reflectance skinY (the meter's target)
export function skinBias(skinY, S = CAMERA7_SKIN) { return Math.min(S.hi, Math.max(S.lo, S.a + S.b * Math.log2(Math.max(skinY, 1e-3)))); }

export const DISPLAY7_GLSL = /* glsl */`
uniform vec4 uC7a;   // Lottes a, d, b, c
uniform vec4 uC7b;   // perChannel, sat, pathStart (stops), pathRange (stops)
uniform vec4 uC7c;   // ped (the black level), 0, 0, 0
uniform vec4 uC7d;   // exposure compensation (stops), mid, black (toe), toe gain (18 % grey stays put)
float c7curve(float x){ float xa = pow(max(x, 0.0), uC7a.x); return xa / (pow(xa, uC7a.y) * uC7a.z + uC7a.w); }
vec3 c7tone(vec3 c){   // the curve on the max channel (hue kept) mixed with the curve per channel (a camera's)
  float n = max(max(c.r, max(c.g, c.b)), 1e-7);
  vec3 A = c * (c7curve(n) / n), B = vec3(c7curve(c.r), c7curve(c.g), c7curve(c.b));
  return mix(A, B, uC7b.x); }
vec3 acpDisplay7Linear(vec3 c){
  c = uWB * c;
  c *= exp2(uC7d.x);
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722)), mn = min(c.r, min(c.g, c.b));
  if (mn < 0.0) c = mix(vec3(max(Y, 0.0)), c, max(Y, 0.0) / max(Y - mn, 1e-6));
  if (uC7d.z > 0.0) { float Yc = dot(c, vec3(0.2126, 0.7152, 0.0722)); c *= Yc > 1e-9 ? uC7d.w * (Yc - uC7d.z * (1.0 - exp(-max(Yc, 0.0) / uC7d.z))) / Yc : 0.0; }
  float n = max(max(c.r, max(c.g, c.b)), 1e-7);
  vec3 rgb = c7tone(c);
  vec3 lab = lin2oklab(rgb);
  float C = length(lab.yz), h = atan(lab.z, lab.y);
  float k = clamp((log2(n / uC7d.y) - uC7b.z) / uC7b.w, 0.0, 1.0); k = k * k * (3.0 - 2.0 * k);
  C *= uC7b.y * (1.0 - k * k);
  lab.x = mix(lab.x, 1.0, k);
  rgb = oklab2lin(vec3(lab.x, C * cos(h), C * sin(h)));
  vec3 g = oklab2lin(vec3(lab.x, 0.0, 0.0));
  float s = 1.0;
  for (int i = 0; i < 3; i++) { float v = rgb[i], gv = g[i];
    if (v > 1.0) s = min(s, (1.0 - gv) / max(v - gv, 1e-6));
    if (v < 0.0) s = min(s, gv / max(gv - v, 1e-6)); }
  rgb = g + (rgb - g) * clamp(s, 0.0, 1.0);
  rgb = clamp(rgb, 0.0, 1.0);
  return rgb * (1.0 - uC7c.x) + uC7c.x;
}
vec3 acpDisplay7(vec3 c){ return srgbOETF(acpDisplay7Linear(c)); }
`;

// the uniform values for a params7() result: [uC7a, uC7b, uC7c, uC7d] as 4-arrays
export function uniforms7(P) {
  return { a: [P.a, P.d, P.b, P.c], b: [P.perChannel, P.sat, P.pathStart, P.pathRange], c: [P.ped, 0, 0, 0], d: [P.expo, P.mid, P.black, P.toeG] };
}

// ---------------------------------------------------------------- the same in JS (scene-linear Rec.709 -> display sRGB 0..1), for tests, charts and the numpy twin's table
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function curve7(x, P) { const xa = Math.max(x, 0) ** P.a; return xa / ((xa ** P.d) * P.b + P.c); }
function tone7(c, P) {   // the curve on the max channel (hue kept) mixed with the curve per channel
  const n = Math.max(c[0], c[1], c[2], 1e-7), fn = curve7(n, P) / n, A = c.map(v => v * fn), B = c.map(v => curve7(v, P));
  return A.map((v, i) => v + (B[i] - v) * P.perChannel);
}
export function display7(c, P = params7(), wb = null) {
  if (wb) c = [wb[0] * c[0] + wb[1] * c[1] + wb[2] * c[2], wb[3] * c[0] + wb[4] * c[1] + wb[5] * c[2], wb[6] * c[0] + wb[7] * c[1] + wb[8] * c[2]];
  const e = 2 ** P.expo; c = c.map(v => v * e);
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], mn = Math.min(...c);
  if (mn < 0) { const Y0 = Math.max(Y, 0), t = Y0 / Math.max(Y - mn, 1e-6); c = c.map(v => Y0 + (v - Y0) * t); }
  if (P.black > 0) { const Yc = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], f = Yc > 1e-9 ? P.toeG * (Yc - P.black * (1 - Math.exp(-Math.max(Yc, 0) / P.black))) / Yc : 0; c = c.map(v => v * f); }
  const n = Math.max(c[0], c[1], c[2], 1e-7);
  const rgb = tone7(c, P);
  const lab = lin2oklab(rgb); let C = Math.hypot(lab[1], lab[2]); const h = Math.atan2(lab[2], lab[1]);
  const k = sstep(0, 1, (Math.log2(n / P.mid) - P.pathStart) / P.pathRange);
  C *= P.sat * (1 - k * k); const L = lab[0] + (1 - lab[0]) * k;
  const out = oklab2lin([L, C * Math.cos(h), C * Math.sin(h)]), g = oklab2lin([L, 0, 0]); let s = 1;
  for (let i = 0; i < 3; i++) { const v = out[i], gv = g[i]; if (v > 1) s = Math.min(s, (1 - gv) / Math.max(v - gv, 1e-6)); if (v < 0) s = Math.min(s, gv / Math.max(gv - v, 1e-6)); }
  s = Math.min(1, Math.max(0, s));
  return out.map((v, i) => srgbOETF(Math.min(1, Math.max(0, g[i] + (v - g[i]) * s)) * (1 - P.ped) + P.ped));
}

// camera7 as the pipeline takes it: `rig.camera7` or the render option `camera7`: { display: {..params7 fields..}, expo (stops, on top of display.expo), lens: 'portrait' | {focal, fstop},
// sensor: {shot, read} }. resolve7 returns the numbers the final pass needs (null: off).
export function resolve7(c7) {
  if (!c7) return null;
  const o = c7 === true ? {} : c7, P = params7({ ...(o.display || {}), expo: (o.display?.expo ?? 0) + (o.expo ?? 0) });
  const lens = typeof o.lens === 'string' ? CAMERA7_LENS[o.lens] : o.lens || null;
  const sharpen = o.sharpen === false || o.sharpen == null ? null : { ...CAMERA7_SHARPEN_ENGINE, ...(o.sharpen === true ? {} : o.sharpen) };
  return { P, U: uniforms7(P), lens, sensor: { ...CAMERA7_SENSOR, ...(o.sensor || {}) }, sharpen };
}
