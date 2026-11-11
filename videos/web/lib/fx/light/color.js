// LIGHT / color: physical colour and units for the lighting pipeline (LIGHTING c1).
//
// Everything a light, a sky or a camera needs to agree on a number:
//   - CIE 1931 observer (Wyman, Sloan and Shirley 2013 multi-lobe fit) -> XYZ -> linear Rec.709 (the working space)
//   - Planck blackbody: chromaticity AND luminance (cd/m2) for a temperature, so a furnace mouth at 1550 K has the
//     radiance it really has, not a hand-picked orange
//   - lamp chromaticities from published xy (HPS / LPS sodium, clear mercury, metal halide, LED, arc)
//   - camera exposure from EV100 (Lagarde and de Rousiers, "Moving Frostbite to PBR", 2014):
//       EV100 = log2(N^2 / t * 100 / ISO);  exposure = 1 / (1.2 * 2^EV100)   (scene luminance -> pre-exposed value)
//   - white balance by a Bradford chromatic adaptation (a camera set to 3200 K, 5600 K, ...)
// Pure functions, no three.js: usable in Node (tests, charts) and in a page.

// ---------------------------------------------------------------- CIE 1931 2-degree observer, analytic fit
const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function cie(l) {
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
}
export const XYZ_TO_709 = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];
export const M709_TO_XYZ = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505];
const mul3 = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
export const xyzTo709 = v => mul3(XYZ_TO_709, v);
export const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// xy chromaticity -> linear Rec.709 with luminance 1 (out-of-gamut channels are kept: a low-pressure sodium lamp is
// outside sRGB and the display transform decides how to show it)
export function xyToRGB(x, y) { return xyzTo709([x / y, 1, (1 - x - y) / y]); }

// ---------------------------------------------------------------- Planck
const h = 6.62607015e-34, c0 = 2.99792458e8, kB = 1.380649e-23;
export function planck(lnm, T) { const l = lnm * 1e-9; return 2 * h * c0 * c0 / (l ** 5) / (Math.exp(h * c0 / (l * kB * T)) - 1); }   // W / (sr m^2 m)
const cacheBB = new Map();
// { rgb (luminance 1), Y (cd/m2 of a perfect blackbody surface at T), xy }
export function blackbody(T) {
  const k = Math.round(T);
  if (cacheBB.has(k)) return cacheBB.get(k);
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 2) { const p = planck(l, T) * 2e-9, o = cie(l); X += p * o[0]; Y += p * o[1]; Z += p * o[2]; }
  const r = { rgb: xyzTo709([X / Y, 1, Z / Y]), Y: 683 * Y, xy: [X / (X + Y + Z), Y / (X + Y + Z)] };
  cacheBB.set(k, r); return r;
}
export const kelvin = T => blackbody(T).rgb;

// ---------------------------------------------------------------- lamp colours (published chromaticities; CCT in comments)
//   HPS: 250-400 W high-pressure sodium, CCT ~2000-2100 K, sits above the locus (orange-pink-free, the "sodium" look)
//   LPS: low-pressure sodium, the 589 nm D-line: monochromatic, outside sRGB
//   mercury (clear): lines at 436, 546, 577 nm, no red: blue-green white (the 1950s-80s yard and gantry light)
//   metal halide ~4000 K, cool-white fluorescent ~4100 K, LED work light ~5000 K, welding arc (steel, argon mix) ~7000 K+
export const LAMP_XY = {
  hps: [0.519, 0.418], lps: [0.5752, 0.4242], mercury: [0.326, 0.390], metalHalide: [0.380, 0.380], fluorescent: [0.372, 0.375],
  led: [0.3447, 0.3553], arc: [0.290, 0.300], tungsten: null, daylight: [0.3127, 0.3290],
};
export function lampRGB(kind) {
  if (typeof kind === 'number') return kelvin(kind);
  if (kind === 'tungsten') return kelvin(3200);
  const xy = LAMP_XY[kind]; if (!xy) throw new Error('light/color: unknown lamp ' + kind);
  return xyToRGB(xy[0], xy[1]);
}

// ---------------------------------------------------------------- camera
// EV100 from aperture N, shutter t (s), ISO; exposure compensation ec (stops) brightens
export const ev100 = (N, t, iso = 100) => Math.log2(N * N / t * 100 / iso);
export const exposureFromEV100 = (ev, ec = 0) => 1 / (1.2 * 2 ** (ev - ec));
// the EV100 a scene of average luminance Lavg (cd/m2) wants (reflected-light meter, K = 12.5)
export const ev100FromLuminance = L => Math.log2(L * 100 / 12.5);

// ---------------------------------------------------------------- white balance (Bradford CAT, in linear Rec.709)
const BFD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BFDi = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
const mm = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
// a 3x3 (row-major) that maps a scene lit by `from` (kelvin or lamp name) so that its white reads as D65 white
export function whiteBalance(from = 6504, strength = 1) {
  const src = mul3(M709_TO_XYZ, typeof from === 'number' ? kelvin(from) : lampRGB(from)), dst = mul3(M709_TO_XYZ, [1, 1, 1]);
  const s = mul3(BFD, src), d = mul3(BFD, dst);
  const k = [0, 1, 2].map(i => 1 + strength * (d[i] / s[i] - 1));
  const D = [k[0], 0, 0, 0, k[1], 0, 0, 0, k[2]];
  const M = mm(XYZ_TO_709, mm(BFDi, mm(D, mm(BFD, M709_TO_XYZ))));
  const w = mul3(M, [1, 1, 1]), n = luminance(w);           // keep luminance of white
  return M.map(v => v / n);
}

// ---------------------------------------------------------------- photometry helpers
// a lamp of luminous flux `lm` spread evenly into a cone of half-angle a -> candela
export const candelaFromLumens = (lm, halfAngle = Math.PI) => lm / (2 * Math.PI * (1 - Math.cos(halfAngle)));
// sRGB hex <-> linear
export const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
export const hexLinear = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => srgbToLinear(v / 255));
