// DEVPLATE (Oct 2026, built for BY AUTHORITY): silver glass plates on a lightbox, developed by RULE; and the card that lies among them.
// research/capabilities/devplate.md has the account. The bake is videos/tools/devplate_bake.py; the node tests are
// web/labs/devplate/devplate_test.mjs (no GL); the lab is web/labs/devplate/lab_devplate.html?shot=frame0|develop|ring|card|crown.
//
//   import { Lightbox, DevPlate, DevCard, densityAt } from '../lib/fx/devplate.js';
//   const box = new Lightbox(THREE, scene, { size: [w_mm, h_mm], center: [x, y], cct: 6500, tint: [0.92, 1.0, 1.04], falloff: 0.10, grain: 0.004, rule: R });
//   const P = await DevPlate.load(THREE, box, 'bya_tracks_a', { at: [x, y], rot: 0.02, gammaScale: 1.0, region: 'water', state0: 'negative' });
//   const C = await DevCard.load(THREE, box, 'lac_e000008173', { at: [0, 0], daylight: { cct: 3300, elev: 12, az: 180 } });
//   per frame: box.update(t, camera, { exposure }); P.update(t, camera, { par }); C.update(t, camera, { transmit: k, daylight: w });
// Surface units are millimetres (the plates' and the card's own sizes come from their meta.json in mm). The camera looks straight down
// (an OrthographicCamera over z = 0; Lightbox.frame(camera, { cx, cy, k, roll }) places it: k = screen px per mm, roll in radians).
//
// The plate's physics (pure JS here, mirrored in GLSL below; the tests run the JS):
//   densityAt(logH, s, stock) -> D. s = RULE's state at the point: 0 = the developed negative, 1 = the positive.
//     D_neg = the stock's negative curve (printlab/data/film/nitrate_bw.json 'curves', base+fog 0.308 at logH -3, gamma about 0.65),
//             times gammaScale about the curve's speed point (the middle of its straight line): the dry plate's own contrast.
//     D_pos = the stock's print curve ('print_curve', logT -> D) through the negative developed at the stock's own gamma (printGamma 1),
//             at a printer light set so the negative's mid-grey (the speed point) prints to D 0.75: gammaScale sets how hard the
//             negative on the box looks (black skies, milky shadows, dark faces) without crushing the print the rule turns it into. A stock with no print curve (orwocolor: printlab keeps a colour stock's chain
//             to the print as its 'curves') takes those curves as D_pos and an EST negative: the positive mirrored about its speed point,
//             at gamma 0.65 / the positive's, on a 0.20 base with no integral mask (the stock's own provenance: Agfa-type negatives had none).
//             The print curve's toe is carried on below its table to the print base (D 0.06): Stock.printD.
//     D     = mix(D_neg, D_pos, smoothstep(0, 1, s)) + mackie(edge): +A on the passed side and -A on the other, A = 0.06 D, a dipole whose
//             lobes are Gaussian of sigma 2 px at the plate's native scale (the bromide border effect of development; each lobe's FWHM 3.5 px).
//   Transmitted light through the plate = lightbox L x 10^-D x (glass 0.92) + Fresnel reflection of an overhead reflector (n 1.52, F0 0.043);
//   the diffuser under the 2 mm glass is seen offset by the refraction parallax.
//   Grain is silver, in density, at the plate's real size: printlab's granularity (rms 20 at 48 um, at D 1, Selwyn scaling, the PCG3D hash
//   as in lib/printlab.js), over cells of max(the screen pixel, the stock's grain cloud) on the plate: sub-pixel at full view, it shows
//   only under magnification.
//   Colour plates (orwocolor) do the same per layer, with the stock's dye_matrix (the print) and neg_crosstalk (the negative).
//
// The card (DevCard): the LAC scan as albedo; relief from luminance (the bake: the letterpress deboss 0.05-0.1 mm, the centre fold a ridge,
// the paper's tooth); four tack holes as through-holes (traced polygons in card_holes.json) that transmit the lightbox; reflected mode (the
// room's fill, the bounce of the box off the room, + warm raking daylight + the box's own up-light through the paper) and transmitted mode
// (the box only: paper D 0.6-0.9 from a formation texture, black ink D about 1.4 (printlab's measured letterpress black, 1.33-1.38), the red
// form and the oval by their own colour). DevCard.uprightRoll('stamp') returns the camera roll (pi) at which the court form reads upright.
import { RULE_GLSL, vnoise } from './rule.js';

export const LOGH = { lo: -3, hi: 1 };
export const GLASS_T = 0.92, F0 = Math.pow((1.52 - 1) / (1.52 + 1), 2);
const LUTN = 1024;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
function interp(x, xp, fp) {
  const n = xp.length; if (x <= xp[0]) return fp[0]; if (x >= xp[n - 1]) return fp[n - 1];
  let i = 1; while (xp[i] < x) i++; const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1]); return fp[i - 1] + t * (fp[i] - fp[i - 1]);
}
const srgb2lin = x => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

// ---------------------------------------------------------------- bytes (browser fetch, or node's fs for file: URLs)
const ASSETS = new URL('../../assets/devplate/', import.meta.url);
const FILM = new URL('../printlab/data/film/', import.meta.url);
export async function readBytes(url) {
  const u = url instanceof URL ? url : new URL(url, typeof location !== 'undefined' ? location.href : ASSETS);
  if (u.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises'); const b = await fs.readFile(u); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const r = await fetch(u.href); if (!r.ok) throw new Error(`devplate: ${r.status} ${u.href}`);
  return new Uint8Array(await r.arrayBuffer());
}
export async function readJSON(url) { return JSON.parse(new TextDecoder().decode(await readBytes(url))); }
export async function exists(url) { try { await readBytes(url); return true; } catch { return false; } }

// ---------------------------------------------------------------- PNG: 8/16-bit gray, gray+alpha, RGB, RGBA; filters 0-4; no interlace
async function inflate(z) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(z); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  const zlib = await import('node:zlib'); const b = zlib.inflateSync(z); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
export async function decodePNG(bytes) {
  const b = bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]; for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) throw new Error('devplate: not a PNG');
  let i = 8, w = 0, h = 0, depth = 8, ctype = 0; const parts = [];
  while (i < b.length) {
    const n = dv.getUint32(i), t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (t === 'IHDR') { w = dv.getUint32(i + 8); h = dv.getUint32(i + 12); depth = b[i + 16]; ctype = b[i + 17]; if (b[i + 20]) throw new Error('devplate: interlaced PNG'); }
    else if (t === 'IDAT') parts.push(b.subarray(i + 8, i + 8 + n));
    else if (t === 'IEND') break;
    i += 12 + n;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]; if (!ch || (depth !== 8 && depth !== 16)) throw new Error(`devplate: PNG type ${ctype}/${depth} not read`);
  const z = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { z.set(p, o); o += p.length; }
  const raw = await inflate(z), bpp = ch * depth / 8, stride = w * bpp, out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, u = y ? out[up + x] : 0, c = (x >= bpp && y) ? out[up + x - bpp] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c); }
      out[dst + x] = v & 255;
    }
  }
  let data = out;
  if (depth === 16) { data = new Uint16Array(w * h * ch); for (let k = 0; k < data.length; k++) data[k] = (out[2 * k] << 8) | out[2 * k + 1]; }
  return { width: w, height: h, channels: ch, depth, data };
}

// ---------------------------------------------------------------- the stock
export async function loadStock(name) { return new Stock(await readJSON(new URL(name + '.json', FILM))); }
export class Stock {
  constructor(st, { gammaScale = 1 } = {}) {
    this.st = st; this.id = st.id || st.name; this.colour = !!st.colour; this.gammaScale = gammaScale;
    this.lh = st.curves.logH; this.curves = ['R', 'G', 'B'].map(c => st.curves[c]);
    // the straight line: where the G curve's slope is at least 0.8 of its steepest (the bake's straight_line(), identically)
    const G = this.curves[1], n = this.lh.length, g = [];
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); g.push(Math.abs((G[b] - G[a]) / (this.lh[b] - this.lh[a]))); }
    // numpy.gradient: central differences inside, one-sided at the ends (as above), so the span matches the bake's
    const gm = Math.max(...g), ok = g.map((v, i) => (v >= 0.8 * gm ? i : -1)).filter(i => i >= 0);
    this.straight = [this.lh[ok[0]], this.lh[ok[ok.length - 1]]]; this.speed = (this.straight[0] + this.straight[1]) / 2;
    this.grain = st.grain || { rms48: 20, at_D: 1, D_exp: 0.5, cloud_um: 7, layer: [1, 1, 1] };
    this.dye = st.dye_matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; this.xneg = st.neg_crosstalk ?? 0;
    if (st.print_curve) {
      this.kind = 'neg-print'; const pc = st.print_curve;
      // the printer light: the speed point's negative density prints to D 0.75 (logT is the print's log exposure = P - D_neg)
      const target = 0.75, i = pc.D.findIndex(d => d >= target), lt = pc.logT[i - 1] + (target - pc.D[i - 1]) / (pc.D[i] - pc.D[i - 1]) * (pc.logT[i] - pc.logT[i - 1]);
      this.printer = lt + this.negRaw(this.speed, 1);
    } else {
      this.kind = 'collapsed';                                            // the curves are the chain to the print: they are D_pos
      const P = this.curves[1], gpos = Math.abs((interp(this.straight[1], this.lh, P) - interp(this.straight[0], this.lh, P)) / (this.straight[1] - this.straight[0]));
      this.gneg = 0.65 / gpos; this.base = 0.20;
      this.pmax = this.curves.map(c => Math.max(...c));
    }
  }
  negRaw(logH, c = 1) {
    if (this.kind === 'neg-print') return interp(logH, this.lh, this.curves[c]);
    return this.base + (this.pmax[c] - interp(logH, this.lh, this.curves[c])) * this.gneg;   // EST: the positive's complement, at negative gamma
  }
  // the print curve, with its toe continued below the table's first point (EST: the tabulated toe stops at D 0.344 while still steep;
  // it is carried on as an exponential to the print stock's base, D 0.06, so the brightest highlights keep their order instead of clipping)
  printD(logT) {
    const pc = this.st.print_curve, x0 = pc.logT[0], d0 = pc.D[0];
    if (logT >= x0) return interp(logT, pc.logT, pc.D);
    const sl = (pc.D[1] - pc.D[0]) / (pc.logT[1] - pc.logT[0]), base = 0.06;
    return base + (d0 - base) * Math.exp((logT - x0) * sl / (d0 - base));
  }
  // the negative's density, with gammaScale about the speed point
  neg(logH, c = 1, gs = this.gammaScale) { const d0 = this.negRaw(this.speed, c); return d0 + gs * (this.negRaw(logH, c) - d0); }
  // the positive: the print through the negative developed at the stock's own gamma (printGamma 1)
  pos(logH, c = 1, pg = this.printGamma ?? 1) {
    if (this.kind === 'neg-print') return this.printD(this.printer - this.neg(logH, c, pg));
    return interp(logH, this.lh, this.curves[c]);
  }
  // the GPU's table: rows negR negG negB posR posG posB over logH in LOGH.lo..hi, LUTN columns (Float32)
  lut(gs = this.gammaScale, pg = 1) {
    const a = new Float32Array(LUTN * 6);
    for (let i = 0; i < LUTN; i++) { const x = LOGH.lo + (LOGH.hi - LOGH.lo) * i / (LUTN - 1);
      for (let c = 0; c < 3; c++) { a[c * LUTN + i] = this.neg(x, c, gs); a[(3 + c) * LUTN + i] = this.pos(x, c, pg); } }
    return a;
  }
}

// the plate's density at a point: logH (a number, or [r, g, b] for colour), s (0 negative .. 1 positive), the stock;
// edgePx: the signed distance to RULE's front in px at the plate's native scale (negative = passed), or null away from a front
export function mackie(dPx, { A = 0.06, sigma = 2.0 } = {}) { const x = dPx / sigma; return -A * x * Math.exp(0.5 - 0.5 * x * x); }
export function densityAt(logH, s, stock, { gammaScale = stock.gammaScale ?? 1, printGamma = 1, channel = 1, edgePx = null, A = 0.06, sigma = 2.0 } = {}) {
  const L = Array.isArray(logH) ? logH[channel] : logH, k = sstep(0, 1, s);
  const D = stock.neg(L, channel, gammaScale) * (1 - k) + stock.pos(L, channel, printGamma) * k;
  return edgePx == null ? D : D + mackie(edgePx, { A, sigma });
}
export function transmit(D, L = 1, { glass = GLASS_T } = {}) { return L * Math.pow(10, -D) * glass; }
// the grain's sigma in density for a pixel of `umPx` micrometres on the plate (Selwyn: sigma ~ 1/sqrt(area))
export function grainSigma(D, umPx, stock) {
  const g = stock.grain, cell = Math.max(umPx, g.cloud_um || 7);
  return (g.rms48 / 1000) * Math.pow(Math.max(D / (g.at_D || 1), 0), g.D_exp ?? 0.5) * Math.sqrt(Math.PI * 24 * 24 / (cell * cell));
}
// the bake's placement, for pictures made at run time (a canvas): lin (Float32Array RGB, n pixels) -> logH Float32Array RGB
export function placeLogH(lin, stock, { pLo = 2, pHi = 98 } = {}) {
  const S = stock.st.sens_matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], n = lin.length / 3, E = new Float32Array(n * 3), G = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    const e = S[c][0] * lin[3 * i] + S[c][1] * lin[3 * i + 1] + S[c][2] * lin[3 * i + 2]; E[3 * i + c] = Math.log10(Math.max(e, 1e-5)); if (c === 1) G[i] = E[3 * i + 1];
  }
  const sorted = Float32Array.from(G).sort(), q = p => sorted[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p / 100)))];
  const a = q(pLo), b = q(pHi), [lo, hi] = stock.straight, k = (hi - lo) / Math.max(1e-6, b - a);
  for (let j = 0; j < E.length; j++) E[j] = clamp(lo + (E[j] - a) * k, LOGH.lo, LOGH.hi);
  return { logH: E, placement: { logE: [a, b], straight: [lo, hi], gain: k } };
}

// ---------------------------------------------------------------- plate and card data (no THREE: the tests use these)
export async function loadPlateData(name, base = ASSETS) {
  const dir = new URL(name + '/', base);
  const meta = await readJSON(new URL('meta.json', dir));
  const [lp, mp, dp] = await Promise.all(['logH.png', 'mask.png', 'depth.png'].map(f => readBytes(new URL(f, dir)).then(decodePNG)));
  const n = lp.width * lp.height, ch = lp.channels, logH = new Float32Array(n * 4), lo = meta.logH?.lo ?? LOGH.lo, hi = meta.logH?.hi ?? LOGH.hi;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) logH[4 * i + c] = lo + (hi - lo) * lp.data[i * ch + (ch === 1 ? 0 : c)] / 65535;
  return { name, meta, logH, w: lp.width, h: lp.height, mask: toRGBA8(mp), depth: toRGBA8(dp) };
}
function toRGBA8(p) {
  const n = p.width * p.height, out = new Uint8Array(n * 4), ch = p.channels, sh = p.depth === 16 ? 257 : 1;
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) out[4 * i + c] = Math.round(p.data[i * ch + (ch >= 3 ? c : 0)] / sh); out[4 * i + 3] = ch === 4 ? Math.round(p.data[i * ch + 3] / sh) : 255; }
  return { w: p.width, h: p.height, data: out };
}
export async function loadCardData(name, base = ASSETS) {
  const dir = new URL(name + '/', base);
  const meta = await readJSON(new URL('meta.json', dir));
  const [np, dp] = await Promise.all(['normal.png', 'dt.png'].map(f => readBytes(new URL(f, dir)).then(decodePNG)));
  return { name, meta, normal: toRGBA8(np), dt: toRGBA8(dp), albedoURL: new URL('albedo.jpg', dir).href };
}
// paper density in transmitted light at a point on the card (mm from its lower-left corner): the formation (flocs of 2-5 mm and fibre
// bundles under 1 mm) and the fold (a thin bright line: the paper is broken down there). The same function is in CARD_GLSL.
export function paperD(xmm, ymm, foldDist) {
  const f = 0.6 * vnoise(xmm / 3.2, ymm / 3.2, 41) + 0.4 * vnoise(xmm / 0.9, ymm / 0.9, 42);
  return 0.75 + 0.13 * f - 0.28 * Math.exp(-((foldDist / 0.35) ** 2));
}
// transmission of the card at paper uv (u right, v up) per channel, the CPU mirror of the shader's transmitted mode
export function cardTransmit(card, u, v) {
  const { normal, dt, meta } = card, x = Math.min(normal.w - 1, Math.max(0, Math.floor(u * normal.w))), y = Math.min(normal.h - 1, Math.max(0, Math.floor((1 - v) * normal.h)));
  const k = 4 * (y * normal.w + x), paper = normal.data[k + 2] / 255;
  if (paper < 0.5) return [1, 1, 1];                                    // a hole (or off the paper): the box itself
  const [pw, ph] = meta.paper_mm, xm = u * pw, ym = v * ph, F = meta.fold_uv;
  const fx = (F[0][0] + (v - F[0][1]) / (F[1][1] - F[0][1]) * (F[1][0] - F[0][0])) * pw, Dp = paperD(xm, ym, Math.abs(xm - fx));
  return [0, 1, 2].map(c => Math.pow(10, -(Dp + dt.data[k + c] / 255 * (meta.dt?.scale ?? 2))));
}

// ---------------------------------------------------------------- GLSL
// The shared chunk: the lightbox's own luminance, the display (exposure, a gentle shoulder over 0.8, sRGB), the grain hash (rule_pcg3d).
export const BOX_GLSL = /* glsl */`
uniform vec3 uBoxL;        // the box's colour at its brightest (display-linear)
uniform vec4 uBoxRect;     // centre xy, half size xy (mm)
uniform vec2 uBoxFall;     // falloff (share), grain (share)
uniform float uExposure;
uniform vec3 uCam;         // the lens's position (mm): over the camera centre, at its working height
uniform vec4 uSoft;        // the overhead reflector: centre xy, half size xy (mm)
uniform vec2 uSoftHL;      // its height (mm), its luminance (share of the box)
uniform vec4 uDay;         // the daylight's direction (towards the light) xyz, weight
uniform vec3 uDayC;        // its colour x intensity
uniform vec3 uFillC;       // the room's fill on the surface (the box's bounce), colour x intensity
uniform float uUmPx;       // one screen pixel on the surface, micrometres
float boxL1(vec2 p) {
  vec2 q = abs(p - uBoxRect.xy) / uBoxRect.zw;
  float e = max(q.x, q.y); if (e > 1.0) return 0.0;
  float fall = 1.0 - uBoxFall.x * pow(e, 4.0);
  float g = 1.0 + uBoxFall.y * (0.7 * rule_vnoise(p / 0.35, 7) + 0.3 * rule_vnoise(p / 2.5, 8));
  return fall * g;
}
vec3 boxL(vec2 p) { return uBoxL * boxL1(p); }
vec3 display(vec3 c) {
  c *= uExposure;
  vec3 s = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2));
  c = mix(c, s, step(0.8, c));
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float dp_gauss(ivec2 i, int seed) {
  uvec3 h = rule_pcg3d(uvec3(uint(i.x), uint(i.y), uint(seed)));
  float a = (float(h.x >> 8u) + 0.5) / 16777216.0, b = (float(h.y >> 8u) + 0.5) / 16777216.0;
  return sqrt(-2.0 * log(a)) * cos(6.2831853 * b);
}
// the overhead reflector in the glass: the reflected view ray from the lens through p, at the reflector's height
float softAt(vec2 p) {
  vec2 y = p + (p - uCam.xy) * (uSoftHL.x / uCam.z);
  vec2 q = abs(y - uSoft.xy) / uSoft.zw;
  return (1.0 - smoothstep(0.75, 1.0, max(q.x, q.y))) * uSoftHL.y;
}
`;

const VERT = /* glsl */`
out vec2 vUv; out vec2 vP;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const BOX_FRAG = /* glsl */`
in vec2 vUv; in vec2 vP;
void main() {
  vec3 c = boxL(vP);
  c += vec3(0.80) * uDayC * uDay.w * max(0.0, uDay.z);                 // the acrylic's own white catches the daylight
  gl_FragColor = vec4(display(c), 1.0);
}`;

export const PLATE_FRAG = /* glsl */`
in vec2 vUv; in vec2 vP;
uniform sampler2D uLogH;   // RGBA32F: logH per channel (NEAREST; bilinear here)
uniform sampler2D uMask;   // R emulsion, G chip / scratch, B bevel
uniform sampler2D uDepth;
uniform sampler2D uLUT;    // R32F 1024 x 6: negR negG negB posR posG posB over logH -3..1
uniform vec4 uImg;         // the image rect in glass uv
uniform vec2 uGlass;       // glass size (mm)
uniform int uRegion;       // RULE region (-1: none)
uniform float uState0;     // the state where no rule acts (0 negative, 1 positive)
uniform vec3 uMackie;      // A (D), sigma (px at native), native px per mm
uniform vec2 uPar;         // parallax: uv offset per unit of (depth - 0.5)
uniform float uColour;
uniform mat3 uDyeNeg;
uniform mat3 uDyePos;
uniform vec4 uGrain;       // rms48 (D), at_D, D_exp, cloud (um)
uniform vec3 uGrainLayer;
uniform int uSeed;
uniform float uThick;      // glass (mm)
float lutD(float logH, int row) {
  float x = clamp((logH + 3.0) / 4.0, 0.0, 1.0) * 1023.0; int i0 = int(floor(x)); int i1 = min(i0 + 1, 1023);
  return mix(texelFetch(uLUT, ivec2(i0, row), 0).r, texelFetch(uLUT, ivec2(i1, row), 0).r, x - float(i0));
}
vec3 logHAt(vec2 uv) {
  ivec2 sz = textureSize(uLogH, 0); vec2 f = clamp(uv, 0.0, 1.0) * vec2(sz) - 0.5; vec2 f0 = floor(f); vec2 w = f - f0; ivec2 i = ivec2(f0);
  ivec2 m = sz - 1;
  vec3 a = texelFetch(uLogH, clamp(i, ivec2(0), m), 0).rgb, b = texelFetch(uLogH, clamp(i + ivec2(1, 0), ivec2(0), m), 0).rgb;
  vec3 c = texelFetch(uLogH, clamp(i + ivec2(0, 1), ivec2(0), m), 0).rgb, d = texelFetch(uLogH, clamp(i + ivec2(1, 1), ivec2(0), m), 0).rgb;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
void main() {
  vec4 M = texture(uMask, vUv);
  // the box under the glass, seen through 2 mm of it (the refraction parallax)
  vec2 pb = vP - (vP - uCam.xy) * (uThick / uCam.z) / 1.52;
  vec3 L = boxL(pb);
  if (M.g > 0.75) { gl_FragColor = vec4(display(boxL(vP) * (1.0 - 0.35 * M.b)), 1.0); return; }   // a chip: the glass is gone; its fracture face
  float s = uState0, dpx = 1e9;
  if (uRegion >= 0) { s = ruleU(uRegion, vP); dpx = ruleEdge(uRegion, vP) * uRuleB[uRegion].z * uMackie.z; }
  vec2 iuv = (vUv - uImg.xy) / (uImg.zw - uImg.xy);
  float dep = texture(uDepth, iuv).r;
  iuv += (dep - 0.5) * uPar;
  vec3 lh = logHAt(iuv);
  float k = smoothstep(0.0, 1.0, s);
  vec3 Dn = vec3(lutD(lh.r, 0), lutD(lh.g, 1), lutD(lh.b, 2)), Dp = vec3(lutD(lh.r, 3), lutD(lh.g, 4), lutD(lh.b, 5));
  vec3 D = mix(Dn, Dp, k);
  if (abs(dpx) < 8.0 * uMackie.y) { float x = dpx / uMackie.y; D += -uMackie.x * x * exp(0.5 - 0.5 * x * x); }
  if (uColour > 0.5) D = mix(uDyeNeg * D, uDyePos * D, k);
  float scratch = M.g * 2.0;                                             // 1..127 / 255: the emulsion lifted along a hairline
  D *= M.r * (1.0 - clamp(scratch, 0.0, 1.0));
  // silver grain at the plate's real size (Selwyn): cells of max(pixel, cloud) micrometres, anchored on the plate
  float cell = max(uUmPx, uGrain.w);
  vec2 pc = vUv * uGlass * 1000.0 / cell;
  float sel = sqrt(3.14159265 * 576.0) / cell;
  ivec2 gi = ivec2(floor(pc));
  for (int c = 0; c < 3; c++) {
    float sg = uGrain.x * pow(max(D[c] / uGrain.y, 0.0), uGrain.z) * sel * uGrainLayer[c];
    D[c] += sg * dp_gauss(gi, uSeed * 3 + (uColour > 0.5 ? c : 0));
  }
  vec3 T = pow(vec3(10.0), -max(D, 0.0)) * 0.92;
  T *= mix(vec3(1.0), vec3(0.62, 0.80, 0.70), M.b);                    // the ground edge: soda-lime green in section
  vec3 c = L * T + vec3(${F0.toFixed(4)}) * softAt(vP) * uBoxL;
  gl_FragColor = vec4(display(c), 1.0);
}`;

export const CARD_FRAG = /* glsl */`
in vec2 vUv; in vec2 vP;
uniform sampler2D uAlbedo;  // the scan (sRGB texture: sampled linear)
uniform sampler2D uNormal;  // xy relief, B the paper (0: off the paper or a hole)
uniform sampler2D uDT;      // the ink's extra density in transmission (x 2.0)
uniform vec2 uPaper;        // paper size (mm)
uniform vec4 uFold;         // the fold, paper uv: (u0, v0, u1, v1)
uniform float uTransmit;    // 0 reflected .. 1 transmitted only
uniform float uRot;         // the card's own rotation on the box (rad)
uniform float uThickC;
void main() {
  vec4 N = texture(uNormal, vUv);
  if (N.b < 0.5) { gl_FragColor = vec4(display(boxL(vP)), 1.0); return; }   // through a tack hole (or past the ragged edge): the box
  vec3 a = texture(uAlbedo, vUv).rgb;
  vec2 xy = N.xy * 2.0 - 1.0; vec3 n = normalize(vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))));
  float cr = cos(uRot), sr = sin(uRot); n.xy = mat2(cr, sr, -sr, cr) * n.xy;
  vec2 pm = vUv * uPaper;
  float fu = mix(uFold.x, uFold.z, (vUv.y - uFold.y) / (uFold.w - uFold.y)) * uPaper.x;
  float fd = abs(pm.x - fu);
  float Dp = 0.75 + 0.13 * (0.6 * rule_vnoise(pm / 3.2, 41) + 0.4 * rule_vnoise(pm / 0.9, 42)) - 0.28 * exp(-pow(fd / 0.35, 2.0));
  vec3 D = Dp + texture(uDT, vUv).rgb * 2.0;
  vec3 T = pow(vec3(10.0), -D);
  vec3 trans = boxL(vP) * T;
  float lam = max(0.0, dot(n, uDay.xyz));
  vec3 refl = a * (uFillC * (1.0 - uTransmit) + uDayC * uDay.w * lam * (1.0 - uTransmit));
  gl_FragColor = vec4(display(refl + trans), 1.0);
}`;

// ---------------------------------------------------------------- colour of light
// a blackbody's colour, normalised to its brightest channel (Tanner Helland's fit, adequate for a lamp's tint), as display-linear RGB
export function cctRGB(K) {
  const t = K / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const c = [r, g, b].map(v => srgb2lin(clamp(v / 255))); const m = Math.max(...c); return c.map(v => v / m);
}

// ---------------------------------------------------------------- THREE: the box, the plates, the card
// GLSL3 (#version 300 es): three declares no fragment output for it, so gl_FragColor is ours to declare (15 Oct: every program
// failed to compile on the farm's ANGLE/NVIDIA with "'gl_FragColor' : undeclared identifier").
const FRAG_OUT = 'layout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n';
function shaderMat(THREE, frag, uniforms) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG_OUT + RULE_GLSL + BOX_GLSL + frag, uniforms, depthTest: true, depthWrite: true });
}
export class Lightbox {
  constructor(THREE, scene, { size = [1200, 2000], center = [0, 0], cct = 6500, tint = [0.92, 1.0, 1.04], peak = '#EAF6F8', falloff = 0.10, grain = 0.004,
    rule = null, reflector = { at: [120, 300], size: [700, 500], height: 1300, L: 0.30 }, camH = 700 } = {}) {
    this.THREE = THREE; this.scene = scene; this.rule = rule; this.camH = camH; this.size = size; this.center = center;
    const hex = parseInt(peak.slice(1), 16), pk = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => srgb2lin(v / 255));
    this.Lpeak = pk;                                                      // the brightest point of the box, display-linear (#EAF6F8)
    const R = rule ? rule.uniforms(0) : null, F = n => new Float32Array(n);
    this.env = {
      uBoxL: { value: new THREE.Vector3(...pk) }, uBoxRect: { value: new THREE.Vector4(center[0], center[1], size[0] / 2, size[1] / 2) },
      uBoxFall: { value: new THREE.Vector2(falloff, grain) }, uExposure: { value: 1 }, uCam: { value: new THREE.Vector3(center[0], center[1], camH) },
      uSoft: { value: new THREE.Vector4(reflector.at[0], reflector.at[1], reflector.size[0] / 2, reflector.size[1] / 2) },
      uSoftHL: { value: new THREE.Vector2(reflector.height, reflector.L) }, uDay: { value: new THREE.Vector4(0, 0, 1, 0) },
      uDayC: { value: new THREE.Vector3(1, 1, 1) }, uFillC: { value: new THREE.Vector3(0.8, 0.8, 0.8) }, uUmPx: { value: 300 },
      uRuleA: { value: R ? R.A : F(128) }, uRuleB: { value: R ? R.B : F(128) }, uRuleC: { value: R ? R.C : F(128) }, uRuleD: { value: R ? R.D : F(128) },
      uRuleE: { value: R ? R.E : F(128) }, uRulePoly: { value: R ? R.P : F(128) },
    };
    this.cct = cct; this.tint = tint;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), shaderMat(THREE, BOX_FRAG, { ...this.env }));
    this.mesh.position.set(center[0], center[1], 0); this.mesh.name = 'lightbox'; scene.add(this.mesh);
    this.items = [];
  }
  // the box's luminance at a surface point (share of its peak): the CPU mirror of boxL1()
  luminanceAt(x, y) {
    const qx = Math.abs(x - this.center[0]) / (this.size[0] / 2), qy = Math.abs(y - this.center[1]) / (this.size[1] / 2), e = Math.max(qx, qy);
    if (e > 1) return 0; const g = this.env.uBoxFall.value;
    return (1 - g.x * e ** 4) * (1 + g.y * (0.7 * vnoise(x / 0.35, y / 0.35, 7) + 0.3 * vnoise(x / 2.5, y / 2.5, 8)));
  }
  // place an orthographic camera over the box: centre (mm), k (screen px per mm), roll (rad); W x H the frame in px
  frame(camera, { cx = 0, cy = 0, k = 1, roll = 0 }, W = 1080, H = 1920) {
    const hw = W / 2 / k, hh = H / 2 / k;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh; camera.near = 1; camera.far = 4000;
    camera.position.set(cx, cy, 2000); camera.up.set(-Math.sin(roll), Math.cos(roll), 0); camera.lookAt(cx, cy, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    this.view = { cx, cy, k, roll };
    return camera;
  }
  // per frame: the rule's state, the lens, the exposure, the daylight and the fill
  update(t, camera, { exposure = 1, daylight = 0, day = null, fill = 0.8 } = {}) {
    const E = this.env;
    if (this.rule) { const U = this.rule.uniforms(t, { A: E.uRuleA.value, B: E.uRuleB.value, C: E.uRuleC.value, D: E.uRuleD.value, E: E.uRuleE.value, P: E.uRulePoly.value }); this.ruleN = U.n; }
    const v = this.view || { cx: 0, cy: 0, k: 1 };
    E.uCam.value.set(v.cx, v.cy, this.camH); E.uUmPx.value = 1000 / v.k; E.uExposure.value = exposure;
    const d = day || { cct: 3300, elev: 12, az: 180 }, el = d.elev * Math.PI / 180, az = d.az * Math.PI / 180;
    E.uDay.value.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el), daylight);   // az 180: the light is on the left
    const dc = cctRGB(d.cct), I = d.I ?? 2.9; E.uDayC.value.set(dc[0] * I, dc[1] * I, dc[2] * I);
    const fc = cctRGB(this.cct); E.uFillC.value.set(fc[0] * this.tint[0] * fill, fc[1] * this.tint[1] * fill, fc[2] * this.tint[2] * fill);
  }
}

function dataTex(THREE, data, w, h, fmt, type, filter) {
  const t = new THREE.DataTexture(data, w, h, fmt, type); t.minFilter = t.magFilter = filter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
// image rows: the PNG's first row is the picture's top, a texture's v = 1 is its top: flip rows once on upload
function flipRows(a, w, h, ch) { const o = new a.constructor(a.length), r = w * ch; for (let y = 0; y < h; y++) o.set(a.subarray((h - 1 - y) * r, (h - y) * r), y * r); return o; }

export class DevPlate {
  // name: a baked plate under assets/devplate/<name>/ (or opts.data: { meta, logH, w, h, mask, depth } made at run time, e.g. fromCanvas)
  static async load(THREE, box, name, opts = {}) {
    const data = opts.data || await loadPlateData(name, opts.base);
    const stock = opts.stockObj || await loadStock(data.meta.stock);
    return new DevPlate(THREE, box, data, stock, opts);
  }
  constructor(THREE, box, data, stock, { at = [0, 0], rot = 0, gammaScale = 1, printGamma = 1, region = null, state0 = 'negative', z = 2, mackie = 0.06, sigma = 2.0, seed = null } = {}) {
    this.THREE = THREE; this.box = box; this.data = data; this.stock = stock; this.meta = data.meta; this.name = data.meta.name || data.name;
    this.at = at; this.rot = rot; this.gammaScale = gammaScale; this.region = region;
    const [gw, gh] = this.meta.glass_mm; this.glass = [gw, gh];
    const lut = stock.lut(gammaScale, printGamma), g = stock.grain, M = stock.dye, xn = stock.xneg;
    const mneg = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) * (1 - xn) + M[i][j] * xn));
    const m3 = a => new THREE.Matrix3().set(a[0][0], a[0][1], a[0][2], a[1][0], a[1][1], a[1][2], a[2][0], a[2][1], a[2][2]);
    const U = {
      ...box.env,
      uLogH: { value: dataTex(THREE, flipRows(data.logH, data.w, data.h, 4), data.w, data.h, THREE.RGBAFormat, THREE.FloatType, THREE.NearestFilter) },
      uMask: { value: dataTex(THREE, flipRows(data.mask.data, data.mask.w, data.mask.h, 4), data.mask.w, data.mask.h, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter) },
      uDepth: { value: dataTex(THREE, flipRows(data.depth.data, data.depth.w, data.depth.h, 4), data.depth.w, data.depth.h, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter) },
      uLUT: { value: dataTex(THREE, lut, LUTN, 6, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter) },
      uImg: { value: new THREE.Vector4(...this.meta.img_uv) }, uGlass: { value: new THREE.Vector2(gw, gh) },
      uRegion: { value: region != null && box.rule ? box.rule.indexOf(region) : -1 }, uState0: { value: state0 === 'positive' ? 1 : 0 },
      uMackie: { value: new THREE.Vector3(mackie, sigma, this.meta.px_per_mm) }, uPar: { value: new THREE.Vector2(0, 0) },
      uColour: { value: this.meta.colour ? 1 : 0 }, uDyeNeg: { value: m3(mneg) }, uDyePos: { value: m3(M) },
      uGrain: { value: new THREE.Vector4(g.rms48 / 1000, g.at_D || 1, g.D_exp ?? 0.5, g.cloud_um || 7) },
      uGrainLayer: { value: new THREE.Vector3(...(g.layer || [1, 1, 1])) }, uSeed: { value: (seed ?? this.meta.seed ?? 1) | 0 }, uThick: { value: this.meta.thick_mm || 2 },
    };
    this.U = U;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), shaderMat(THREE, PLATE_FRAG, U));
    this.mesh.position.set(at[0], at[1], z); this.mesh.rotation.z = rot; this.mesh.name = 'plate:' + this.name;
    box.scene.add(this.mesh); box.items.push(this);
  }
  // corners of the glass on the surface (mm), for layout checks
  corners() { const [w, h] = this.glass, c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [this.at[0] + c * x - s * y, this.at[1] + s * x + c * y]); }
  // a point given in the picture's own uv (0..1, v up) -> the surface (mm)
  pictureToSurface(u, v) { const I = this.meta.img_uv, [w, h] = this.glass, gu = I[0] + u * (I[2] - I[0]), gv = I[1] + v * (I[3] - I[1]);
    const x = (gu - 0.5) * w, y = (gv - 0.5) * h, c = Math.cos(this.rot), s = Math.sin(this.rot); return [this.at[0] + c * x - s * y, this.at[1] + s * x + c * y]; }
  // the largest on-screen size of one picture pixel at camera scale k (px per mm): > 1.5 enlarges a film frame past the brief's cap
  magnification(k) { return k / this.meta.px_per_mm; }
  update(t, camera, { par = [0, 0], visible = true } = {}) { this.U.uPar.value.set(par[0], par[1]); this.mesh.visible = visible; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); for (const k of ['uLogH', 'uMask', 'uDepth', 'uLUT']) this.U[k].value.dispose(); }
}
// a plate made at run time from a canvas (a picture rendered in the page, e.g. a person): the bake's placement and mask, done here
export async function plateFromPixels(THREE, box, name, rgba8, w, h, { stock = 'orwocolor', plate = [203.2, 254.0], seed = 1, sourceGamma = 1.0, maskFrom = null, ...opts } = {}) {
  const st = typeof stock === 'string' ? await loadStock(stock) : stock, n = w * h, lin = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) lin[3 * i + c] = Math.pow(srgb2lin(rgba8[4 * i + c] / 255), 1 / sourceGamma);
  const { logH, placement } = placeLogH(lin, st), L4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { L4[4 * i] = logH[3 * i]; L4[4 * i + 1] = logH[3 * i + 1]; L4[4 * i + 2] = logH[3 * i + 2]; L4[4 * i + 3] = 1; }
  const [gw, gh] = plate, inset = 2.0, ppm = w / (gw - 2 * inset);
  const mask = maskFrom ? maskFrom.mask : runtimeMask(gw, gh, Math.min(4, ppm), seed);
  const depth = { w: 2, h: 2, data: new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]) };
  const meta = { name, stock: st.id, colour: !!st.colour, glass_mm: [gw, gh], thick_mm: 2, px_per_mm: ppm, image_px: [w, h], img_uv: [inset / gw, inset / gh, 1 - inset / gw, 1 - inset / gh],
    placement, seed, made: 'at run time (plateFromPixels)' };
  // the image rows come top-first from a canvas: logH rows as the PNG's (DevPlate flips them once)
  return new DevPlate(THREE, box, { name, meta, logH: L4, w, h, mask, depth }, st, opts);
}
// the glass for a run-time plate: the bake's margin (2-4 mm, seeded), no chips, the bevel (a small, honest subset of make_mask)
export function runtimeMask(gw, gh, ppm, seed) {
  const W = Math.max(8, Math.round(gw * ppm)), H = Math.max(8, Math.round(gh * ppm)), out = new Uint8Array(W * H * 4);
  const m = (s, k) => 3 + 0.85 * vnoise(s / 30, k * 7.3, seed * 31 + k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = (x + 0.5) / ppm, Y = (y + 0.5) / ppm, d = Math.min(Y - m(X, 1), (gh - m(X, 2)) - Y, X - m(Y, 3), (gw - m(Y, 4)) - X);
    const de = Math.min(X, gw - X, Y, gh - Y), i = 4 * (y * W + x);
    out[i] = Math.round(clamp(d / 0.25 + 0.5) * 255); out[i + 1] = 0; out[i + 2] = Math.round(clamp(1 - de / 0.8) * 255); out[i + 3] = 255;
  }
  return { w: W, h: H, data: out };
}

export class DevCard {
  static async load(THREE, box, name, opts = {}) {
    const data = await loadCardData(name, opts.base);
    const albedo = opts.albedo || await new Promise((res, rej) => new THREE.TextureLoader().load(data.albedoURL, res, undefined, rej));
    return new DevCard(THREE, box, data, albedo, opts);
  }
  constructor(THREE, box, data, albedo, { at = [0, 0], rot = 0, z = 0.6 } = {}) {
    this.THREE = THREE; this.box = box; this.data = data; this.meta = data.meta; this.at = at; this.rot = rot;
    albedo.colorSpace = THREE.SRGBColorSpace; albedo.anisotropy = 8; albedo.needsUpdate = true;
    const [pw, ph] = this.meta.paper_mm, F = this.meta.fold_uv; this.paper = [pw, ph];
    const N = data.normal, D = data.dt;
    this.U = { ...box.env, uAlbedo: { value: albedo },
      uNormal: { value: dataTex(THREE, flipRows(N.data, N.w, N.h, 4), N.w, N.h, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter) },
      uDT: { value: dataTex(THREE, flipRows(D.data, D.w, D.h, 4), D.w, D.h, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter) },
      uPaper: { value: new THREE.Vector2(pw, ph) }, uFold: { value: new THREE.Vector4(F[0][0], F[0][1], F[1][0], F[1][1]) },
      uTransmit: { value: 0 }, uRot: { value: rot }, uThickC: { value: 0.3 } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), shaderMat(THREE, CARD_FRAG, this.U));
    this.mesh.position.set(at[0], at[1], z); this.mesh.rotation.z = rot; this.mesh.name = 'card:' + this.meta.name;
    box.scene.add(this.mesh); box.items.push(this);
  }
  // paper uv (u right, v up) -> the surface (mm)
  toSurface(u, v) { const [w, h] = this.paper, x = (u - 0.5) * w, y = (v - 0.5) * h, c = Math.cos(this.rot), s = Math.sin(this.rot); return [this.at[0] + c * x - s * y, this.at[1] + s * x + c * y]; }
  feature(name) { const f = this.meta.features[name]; if (!f) throw new Error(`devcard: no feature ${name}`); const [u0, v0, u1, v1] = f.uv;
    const [x0, y0] = this.toSurface(u0, v0), [x1, y1] = this.toSurface(u1, v1); return { ...f, box: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], centre: this.toSurface((u0 + u1) / 2, (v0 + v1) / 2) }; }
  holes() { return this.meta.holes_uv.map(P => P.map(([u, v]) => this.toSurface(u, v))); }
  holeCentres() { return this.holes().map(P => [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length]); }
  corners() { const [w, h] = this.paper, c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [this.at[0] + c * x - s * y, this.at[1] + s * x + c * y]); }
  // the camera roll at which a part of the card reads upright (the court form was stamped upside down: pi), plus the card's own rotation
  uprightRoll(name) { const r = ((this.meta.features[name]?.rot_deg ?? 0) * Math.PI / 180 + this.rot) % (2 * Math.PI); return r < 0 ? r + 2 * Math.PI : r; }
  transmitAt(u, v) { return cardTransmit(this.data, u, v); }
  magnification(k) { return k / (this.meta.px[0] / this.paper[0]); }
  update(t, camera, { transmit = 0 } = {}) { this.U.uTransmit.value = transmit; }
}
// node: the card's data without THREE (tests)
DevCard.data = loadCardData;
DevCard.uprightRollOf = (meta, name, rot = 0) => { const r = ((meta.features[name]?.rot_deg ?? 0) * Math.PI / 180 + rot) % (2 * Math.PI); return r < 0 ? r + 2 * Math.PI : r; };
