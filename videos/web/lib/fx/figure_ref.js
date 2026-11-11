// FIGURE REF: real workers from film, drawn three ways (HUMAN studio, cycle 4, change A).
//
// Why: on the slate every person the viewer believes in is REAL (a 1936-38 film worker, a silhouette traced from real
// motion) and every mannequin is a CG body seen at a size where its surface can be inspected. So the people pipeline
// takes the film as its SOURCE: scripts/roto.py cuts a clean matte (BiRefNet on a box crop, median over three frames,
// guided-filter refine in the edge band only, colour decontaminated, hand strokes, a 1:1 check) into
// web/assets/roto/<name>.png (RGBA, straight alpha) + <name>.json (source, licence, head, foot, contour), and this module
// renders the same man three ways:
//   silhouette(g, F, o)  the HORDE / GIANT family: the contour filled flat in ink, and a 1-3 px rim only where the edge
//                        faces the piece's light (coverage with no coverage toward the light: never an edge glow).
//                        o.notan = 0..1: the film's own lit planes above that (normalised) luma cut as a second value
//                        in the rim colour (a two-value Notan cut-out: a white-shirted tapper keeps his shirt).
//                        Posture, cap and tool carry the specific man.
//   engrave(g, F, o)     after Lynd Ward's white line (Wild Pilgrimage 1932, Vertigo 1937): the film's own tone split
//                        into 4-5 PLANES (k-means on the smoothed luma), each plane ruled at its own angle along the
//                        form (the plane's structure-tensor direction), cut by art/burin2d.js with tone carried by line
//                        width, dots in the deepest darks, the ground falling to paper. A face is a few planes of light.
//   print(g, F, o)       Klutsis at monument scale: the photograph as ink dots ANCHORED TO THE FIGURE (the screen moves
//                        with him), one red plate (the ground and the figure's darkest plane), and a paper margin of
//                        5-9 px dilated from the alpha, left in as the seam that proves the image was cut and pasted.
//
//   import { loadRef, silhouette, engrave, print } from '../lib/fx/figure_ref.js';
//   const F = await loadRef('tapper');                                   // { img, meta, w, h }
//   silhouette(ctx, F, { x: 540, y: 1800, h: 1500, light: [-1, -0.4], ink: '#0b0706', rim: '#ffb46a' });   // x, y = where his foot goes
//   engrave(ctx, F, { x, y, h, pitch: 5, planes: 5 });   print(ctx, F, { x, y, h, pitch: 9, red: '#c8201a' });
// Placement: { x, y } is the figure's foot point (meta.foot) on the canvas and h its full crop height in px; or
// { box: [x0, y0, x1, y1] } fits the crop into a box. flip mirrors. Each call returns { x0, y0, w, h, ms } (where it drew).
import { burin } from './art/burin2d.js';

const BASE = new URL('../../assets/roto/', import.meta.url).href;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const CACHE = new Map();

export async function loadRef(name, base = BASE) {
  if (CACHE.has(base + name)) return CACHE.get(base + name);
  const [meta, blob] = await Promise.all([fetch(base + name + '.json').then(r => r.json()), fetch(base + name + '.png').then(r => r.blob())]);
  const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const F = { name, meta, img, w: img.width, h: img.height };
  CACHE.set(base + name, F); return F;
}
// a sequence cut by roto.py seq (name_00 .. name_NN) -> { frames: [F], meta }
export async function loadRefSeq(name, base = BASE) {
  const meta = await fetch(base + name + '_seq.json').then(r => r.json());
  const frames = await Promise.all(Array.from({ length: meta.frames }, (_, k) => loadRef(`${name}_${String(k).padStart(2, '0')}`, base)));
  return { meta, frames };
}

// where the crop lands: scale k and top-left (x0, y0) on the target (exported: a scene can put its light where his tool is)
export function place(F, o) {
  if (o.box) { const [a, b, c, d] = o.box, k = Math.min((c - a) / F.w, (d - b) / F.h); return { k, x0: (a + c) / 2 - F.w * k / 2, y0: d - F.h * k }; }
  const k = (o.h || F.h) / F.h, ft = F.meta.foot || [F.w / 2, F.h];
  const fx = o.flip ? F.w - ft[0] : ft[0];
  return { k, x0: (o.x ?? 540) - fx * k, y0: (o.y ?? 1900) - ft[1] * k };
}
// rasterise the crop at output scale; returns { c, w, h, A (alpha 0..1), L (luma 0..1), x0, y0, k }
function raster(F, o, pad = 0) {
  const P = place(F, o), w = Math.ceil(F.w * P.k) + pad * 2, h = Math.ceil(F.h * P.k) + pad * 2, c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  if (o.flip) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(F.img, pad, pad, F.w * P.k, F.h * P.k);
  const D = g.getImageData(0, 0, w, h).data, A = new Float32Array(w * h), L = new Float32Array(w * h);
  // the canvas stores premultiplied colour: un-premultiply for the luma (soft edges keep their decontaminated tone)
  for (let i = 0; i < w * h; i++) { const a = D[i * 4 + 3] / 255; A[i] = a; L[i] = a > 0.004 ? clamp((0.2126 * D[i * 4] + 0.7152 * D[i * 4 + 1] + 0.0722 * D[i * 4 + 2]) / 255) : 0; }
  // the figure's own tonal range stretched to paper..ink (p2..p98 inside the matte): film faces in a dark shop sit at
  // 15 % luma, and an engraver chooses his values from the man, not from the exposure
  if (o.norm !== false) { const v = []; for (let i = 0; i < w * h; i += 2) if (A[i] > 0.6) v.push(L[i]); v.sort((a, b) => a - b);
    if (v.length > 50) { const lo = v[Math.floor(v.length * (o.normLo ?? 0.02))], hi = v[Math.floor(v.length * (o.normHi ?? 0.985))], sp = Math.max(0.05, hi - lo);
      for (let i = 0; i < w * h; i++) if (A[i] > 0.004) L[i] = clamp((L[i] - lo) / sp); } }
  return { c, w, h, A, L, x0: P.x0 - pad, y0: P.y0 - pad, k: P.k };
}
function blur(a, w, h, r) {
  if (r < 1) return a.slice(); const tmp = new Float32Array(w * h), out = a.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += out[o + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[o + x] = s / (2 * r + 1); s += out[o + Math.min(w - 1, x + r + 1)] - out[o + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  }
  return out;
}
// masked blur: a normalised blur of v under mask m (so the ground's black does not bleed into the figure's tone)
const mblur = (v, m, w, h, r) => { const vm = new Float32Array(w * h); for (let i = 0; i < w * h; i++) vm[i] = v[i] * m[i]; const a = blur(vm, w, h, r), b = blur(m, w, h, r); for (let i = 0; i < w * h; i++) a[i] = b[i] > 1e-3 ? a[i] / b[i] : 0; return a; };

// ---------------------------------------------------------------- silhouette
export function silhouette(g, F, o = {}) {
  const t0 = performance.now(), R = raster(F, { ...o, norm: o.notan != null }, 4), { w, h, A, L } = R, Ln = o.notan != null ? mblur(L, A, w, h, 1) : null;
  const [lx, ly] = (() => { const l = o.light || [-1, -0.5], n = Math.hypot(l[0], l[1]) || 1; return [l[0] / n, l[1] / n]; })();
  const rimW = o.rimW ?? Math.max(1.2, Math.min(4, R.k * F.h / 700)), ink = hex(o.ink || '#0b0706'), rim = hex(o.rim || '#ffb46a'), rimAmt = o.rimAmt ?? 1;
  // the rim: coverage here, none toward the light (averaged over 1..rimW px), soft by a 1 px blur of the alpha
  const As = blur(A, w, h, 1), c = mk(w, h), cg = c.getContext('2d'), im = cg.createImageData(w, h), D = im.data;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : As[(y | 0) * w + (x | 0)];
  const n = Math.max(1, Math.ceil(rimW));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = A[i]; if (a <= 0.003) continue;
    let s = 0; for (let k = 1; k <= n; k++) s += at(x + lx * k, y + ly * k); let r = clamp((As[i] - s / n) * 1.8) * rimAmt * (o.rimMask ? o.rimMask(x + R.x0, y + R.y0) : 1);
    if (Ln) { const q = clamp((Ln[i] - o.notan + 0.035) / 0.07); r = Math.max(r, q * q * (3 - 2 * q)); }   // NOTAN: the film's own lit planes cut as the second value
    D[i * 4] = ink[0] + (rim[0] - ink[0]) * r; D[i * 4 + 1] = ink[1] + (rim[1] - ink[1]) * r; D[i * 4 + 2] = ink[2] + (rim[2] - ink[2]) * r; D[i * 4 + 3] = Math.round(clamp(a * 1.15) * 255);
  }
  cg.putImageData(im, 0, 0); g.drawImage(c, R.x0, R.y0);
  return { x0: R.x0, y0: R.y0, w, h, k: R.k, ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- planes (Ward): k-means on the smoothed luma
export function planes(L, A, w, h, { k = 5, r = 3, iters = 12 } = {}) {
  const S = mblur(L, A, w, h, r), vals = []; for (let i = 0; i < w * h; i += 3) if (A[i] > 0.5) vals.push(S[i]);
  vals.sort((a, b) => a - b); const C = Array.from({ length: k }, (_, j) => vals[Math.floor((j + 0.5) / k * (vals.length - 1))] ?? j / k);
  for (let it = 0; it < iters; it++) { const s = new Float64Array(k), n = new Float64Array(k);
    for (const v of vals) { let b = 0; for (let j = 1; j < k; j++) if (Math.abs(v - C[j]) < Math.abs(v - C[b])) b = j; s[b] += v; n[b]++; }
    for (let j = 0; j < k; j++) if (n[j]) C[j] = s[j] / n[j]; }
  C.sort((a, b) => a - b);
  const lab = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) if (A[i] > 0.02) { let b = 0; for (let j = 1; j < k; j++) if (Math.abs(S[i] - C[j]) < Math.abs(S[i] - C[b])) b = j; lab[i] = b; }
  return { lab, C, S };
}

// ---------------------------------------------------------------- engraving
export function engrave(g, F, o = {}) {
  const t0 = performance.now(), R = raster(F, o, 0), { w, h, A, L } = R;
  const k = o.planes ?? 5, pitch = o.pitch ?? Math.max(3.2, Math.min(7, R.k * F.h / 260)), base = o.base ?? -0.6;
  // tone: the film's luma through a curve, local contrast against a wide masked blur (the engraver's choice of values)
  const Lm = mblur(L, A, w, h, Math.max(2, Math.round(w / 40))), D = new Float32Array(w * h), gam = o.gamma ?? 0.85, clar = o.clarity ?? 0.7;
  for (let i = 0; i < w * h; i++) { if (A[i] <= 0.01) continue; let d = 1 - Math.pow(L[i], gam); d = d + clar * ((1 - Lm[i]) - (1 - L[i])) * -1; D[i] = clamp((d * (o.gain ?? 1.08) + (o.lift ?? 0.02))) * clamp(A[i] * 1.4 - 0.2); }
  // planes and their ruling angles: the mean structure-tensor direction of each plane (lines run ALONG the form)
  const { lab } = planes(L, A, w, h, { k, r: Math.max(2, Math.round(pitch * 0.8)) });
  const Sd = blur(D, w, h, Math.max(2, Math.round(pitch))), J = Array.from({ length: k }, () => [0, 0, 0]);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, p = lab[i]; if (p < 0) continue; const gx = Sd[i + 1] - Sd[i - 1], gy = Sd[i + w] - Sd[i - w]; J[p][0] += gx * gx; J[p][1] += gx * gy; J[p][2] += gy * gy; }
  const ang = J.map(([a, b, c], j) => { const coh = Math.hypot(a - c, 2 * b) / Math.max(1e-9, a + c), gA = 0.5 * Math.atan2(2 * b, a - c);   // gradient angle
    // burin's phase runs along (cos t, sin t): lines are perpendicular to it. Lines along the isophotes = perpendicular to
    // the gradient, so t = the gradient angle. Incoherent planes take the plate's base plus a step per plane.
    return coh > 0.12 ? gA : base + j * 0.55; });
  for (let j = 1; j < k; j++) for (let q = 0; q < j; q++) { let d = Math.abs(((ang[j] - ang[q]) % Math.PI + Math.PI) % Math.PI); d = Math.min(d, Math.PI - d); if (d < 0.35) ang[j] += 0.5; }  // neighbours differ by >= 20 deg
  const AN = new Float32Array(w * h).fill(NaN); for (let i = 0; i < w * h; i++) if (lab[i] >= 0) AN[i] = ang[lab[i]];
  const c = mk(w, h), cg = c.getContext('2d', { willReadFrequently: true });
  burin(cg, { w, h, D, red: null, ang: AN }, { pitch, ink: o.ink || '#15110F', paper: o.paper || '#EFE6CF', base, warp: o.warp ?? 1.4, warpBlur: 4, dotFrom: 0.86, crossFrom: 0.62, maxA: 0.86 });
  // the ground falls to paper: keep the figure (alpha), feather 1 px
  const im = cg.getImageData(0, 0, w, h), P = im.data;
  if (o.ground === 'transparent' || o.ground == null) for (let i = 0; i < w * h; i++) P[i * 4 + 3] = Math.round(clamp(A[i] * 1.3 - 0.15) * 255);
  cg.putImageData(im, 0, 0); g.drawImage(c, R.x0, R.y0);
  return { x0: R.x0, y0: R.y0, w, h, k: R.k, pitch, angles: ang.map(a => Math.round(a * 180 / Math.PI)), ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- Klutsis print
export function print(g, F, o = {}) {
  const t0 = performance.now(), margin = o.margin ?? 7, R = raster(F, o, margin + 2), { w, h, A, L } = R;
  const pitch = o.pitch ?? Math.max(5, Math.min(14, R.k * F.h / 150)), th = (o.screen ?? 15) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const ink = hex(o.ink || '#141010'), paper = hex(o.paper || '#efe6d2'), red = hex(o.red || '#c8201a');
  // the paper margin: the alpha dilated by `margin` px (a disc), the seam of the cut-and-pasted photograph
  const Ab = blur(A, w, h, Math.max(1, Math.round(margin * 0.55))), Lm = mblur(L, A, w, h, Math.max(2, Math.round(w / 45)));
  const c = mk(w, h), cg = c.getContext('2d'), im = cg.createImageData(w, h), P = im.data, redPlane = o.redPlane ?? 0.78;
  const ax = R.x0, ay = R.y0;   // the screen is anchored to the figure's crop, not the frame
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = A[i], seam = clamp((Ab[i] - 0.04) * 8);
    if (a <= 0.01 && seam <= 0) continue;
    let r = paper[0], gg = paper[1], b = paper[2];
    if (a > 0.01) {
      // tone with local contrast (a print pushes the photograph's values)
      let d = clamp((1 - Math.pow(L[i], o.gamma ?? 0.9)) * 1.1 + 0.9 * ((L[i] < Lm[i]) ? (Lm[i] - L[i]) : -(L[i] - Lm[i]) * 0.6));
      const u = ((x * cs + y * sn) / pitch), v = ((-x * sn + y * cs) / pitch), fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const rad = Math.sqrt(d) * 0.62, e = Math.hypot(fu, fv), cov = clamp((rad - e) * pitch + 0.5);
      // the red plate: the darkest plane prints red under the ink (Klutsis' red shadow), elsewhere paper
      const rp = clamp((d - redPlane) * 6) * (o.redInFigure ?? 1);
      const br = paper[0] + (red[0] - paper[0]) * rp, bgc = paper[1] + (red[1] - paper[1]) * rp, bb = paper[2] + (red[2] - paper[2]) * rp;
      r = br + (ink[0] - br) * cov; gg = bgc + (ink[1] - bgc) * cov; b = bb + (ink[2] - bb) * cov;
      const m = clamp(a * 1.3 - 0.1); r = paper[0] + (r - paper[0]) * m; gg = paper[1] + (gg - paper[1]) * m; b = paper[2] + (b - paper[2]) * m;
    }
    P[i * 4] = r; P[i * 4 + 1] = gg; P[i * 4 + 2] = b; P[i * 4 + 3] = Math.round(Math.max(seam, clamp(a * 1.3)) * 255);
  }
  cg.putImageData(im, 0, 0); g.drawImage(c, ax, ay);
  return { x0: ax, y0: ay, w, h, k: R.k, pitch, ms: Math.round(performance.now() - t0) };
}

// the film frame itself (graded to the piece): for the demo's "beside the source" cells and for inserts
export function source(g, F, o = {}) { const P = place(F, o); g.drawImage(F.img, P.x0, P.y0, F.w * P.k, F.h * P.k); return P; }
