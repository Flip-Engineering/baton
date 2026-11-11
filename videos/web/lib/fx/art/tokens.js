// ART kit / TOKENS: the PRESS & FURNACE house grammar as data (research/STYLE_BIBLE.md is the prose).
// A piece picks a DIALECT (its medium and light); the dialect picks at most four INKS from the palette, always
// including stock or ink. The heat ramp is the one place an unscreened gradient may appear (emissive matter only).
//
//   import { INK, HEAT, heat, DIALECTS, valueStats, inkCheck } from '../lib/fx/art/tokens.js';
//   heat(1600)            -> '#ffa23a'-ish css colour of metal at 1600 K (blackbody, display-referred, clipped warm)
//   valueStats(canvas)    -> { mean, dark, light, sat, ok, notes } against the value rules below
export const INK = {
  stock: '#EFE6CF',     // paper cream: grounds, high key
  ink: '#15110F',       // warm black; never #000
  red: '#D71920',       // press red: the one brand red, flat, never a gradient
  oxide: '#8E1B14',     // the dark of a red world
  cyan: '#2F8FD8',      // the cold plate (IRON's silkscreen): at most one piece per release pair
  steel: '#8C918F',     // engraving grey, machined metal
};
export const INK_RGB = Object.fromEntries(Object.entries(INK).map(([k, h]) => [k, hex(h)]));

// temperature stops (K -> sRGB) for glowing metal, hand-matched to foundry photographs' look on film: deep red is
// never pink, the yellow is a sodium-ish yellow, white is warm. Between stops: linear in sRGB.
export const HEAT = [[700, '#2a0602'], [800, '#7A0E00'], [1100, '#D23A00'], [1400, '#FF8A1A'], [1700, '#FFD27A'], [2000, '#FFF4DC']];
const HEAT_RGB = HEAT.map(([k, h]) => [k, hex(h)]);
export function heatRGB(T, out = [0, 0, 0]) {
  const S = HEAT_RGB; if (T <= S[0][0]) { out[0] = S[0][1][0]; out[1] = S[0][1][1]; out[2] = S[0][1][2]; return out; }
  for (let i = 1; i < S.length; i++) if (T <= S[i][0] || i === S.length - 1) {
    const u = Math.min(1, (T - S[i - 1][0]) / (S[i][0] - S[i - 1][0])), A = S[i - 1][1], B = S[i][1];
    for (let c = 0; c < 3; c++) out[c] = A[c] + (B[c] - A[c]) * u; return out;
  }
  return out;
}
export const heat = T => { const c = heatRGB(T); return `rgb(${c.map(Math.round).join(',')})`; };
// GLSL of the same ramp (for shaders): vec3 heatRamp(float T)
export const HEAT_GLSL = /* glsl */`
vec3 heatRamp(float T){
  ${HEAT_RGB.map(([k, c], i) => `const vec3 H${i} = vec3(${c.map(v => (v / 255).toFixed(4)).join(',')});`).join('\n  ')}
  if (T <= ${HEAT_RGB[0][0].toFixed(1)}) return H0 * clamp(T / ${HEAT_RGB[0][0].toFixed(1)}, 0.0, 1.0);
  ${HEAT_RGB.slice(1).map(([k], i) => `if (T <= ${k.toFixed(1)}) return mix(H${i}, H${i + 1}, (T - ${HEAT_RGB[i][0].toFixed(1)}) / ${(k - HEAT_RGB[i][0]).toFixed(1)});`).join('\n  ')}
  return H${HEAT_RGB.length - 1};
}`;

// DIALECTS: one per medium. inks: the piece's plates, in print order. light: where the key comes from.
// These are the defaults the kit's modules take; a piece may override but not add a fifth ink.
export const DIALECTS = {
  newsprint: { inks: ['stock', 'ink', 'red'], light: 'flat daylight; value from the screen', mark: 'halftone (world-anchored)', pieces: ['CIVILIZATION', 'ALL POWER'] },
  engraving: { inks: ['stock', 'ink', 'red'], light: 'raking key from the upper left', mark: 'engraved line, two families, swell with shade', pieces: ['PEOPLES BANK', '1776'] },
  silkscreen: { inks: ['stock', 'red', 'cyan', 'ink'], light: 'none; plates are values', mark: 'flat plates, misregistration settling to 0', pieces: ['IRON IS HOT (post-STRIKE)'] },
  furnace: { inks: ['ink', 'oxide', 'red', 'stock'], light: 'the pour / the arc is the key; blackbody heat ramp allowed', mark: 'crust, scale, sparks', pieces: ['IRON IS HOT (hook)', 'MECHA'] },
  storm: { inks: ['ink', 'steel', 'stock', 'red'], light: 'lightning and work lights; the red is the one lit thing', mark: 'rain streaks, cloud deck', pieces: ['COMMON WEALTH', 'ALL POWER'] },
  poster: { inks: ['red', 'ink', 'stock'], light: 'the disc (THE GIANT only)', mark: 'woodcut gouge, stencil bridge', pieces: ['THE GIANT'] },
  newsreel: { inks: ['ink', 'steel', 'stock'], light: 'hard sun, orthochromatic', mark: 'grain, gate weave', pieces: ['HORDE (crowd close-up)', 'IRON 1906'] },
};

// value rules (NOTES §3 change 1): per frame, and per slate of 8 signature frames
export const VALUE = { darkLuma: 0.15, maxDark: 0.60, highKey: 0.45, slateHighKeyMin: 3, groupMin: 0.15 };

// measure a canvas (downsampled to <= 270 px wide): mean luma, share below darkLuma, share above 0.8, mean sat,
// 3-value notan group shares, and the distance of every pixel to the nearest ink (how "printed" the frame is)
export function valueStats(src, { inks = null } = {}) {
  const w = 135, h = Math.round(w * src.height / src.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const D = g.getImageData(0, 0, w, h).data, n = w * h, P = (inks || Object.keys(INK)).map(k => INK_RGB[k] || hex(k));
  let sum = 0, dark = 0, light = 0, sat = 0, g0 = 0, g1 = 0, g2 = 0, off = 0;
  for (let i = 0; i < n; i++) {
    const r = D[i * 4] / 255, gg = D[i * 4 + 1] / 255, b = D[i * 4 + 2] / 255, L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    sum += L; if (L < VALUE.darkLuma) dark++; if (L > 0.8) light++;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); sat += mx > 0 ? (mx - mn) / mx : 0;
    if (L < 0.33) g0++; else if (L < 0.66) g1++; else g2++;
    let best = 1e9; for (const p of P) { const d = (p[0] / 255 - r) ** 2 + (p[1] / 255 - gg) ** 2 + (p[2] / 255 - b) ** 2; if (d < best) best = d; }
    off += Math.sqrt(best);
  }
  const s = { mean: sum / n, dark: dark / n, light: light / n, sat: sat / n, notan: [g0 / n, g1 / n, g2 / n], inkDist: off / n };
  s.notes = [];
  if (s.dark > VALUE.maxDark) s.notes.push(`${Math.round(s.dark * 100)}% near-black (max ${VALUE.maxDark * 100}%)`);
  if (Math.min(...s.notan) < VALUE.groupMin * 0.5) s.notes.push('a notan group under 7%: two-value frame');
  s.ok = s.notes.length === 0;
  for (const k of ['mean', 'dark', 'light', 'sat', 'inkDist']) s[k] = +s[k].toFixed(3); s.notan = s.notan.map(v => +v.toFixed(3));
  return s;
}

export function hex(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
export const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
