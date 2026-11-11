// ART kit / SHEET (cycle 2): the ladle wipe rebuilt as a real molten sheet (brief §4.2). transitions.js ladleWipe (c1,
// "a soft gradient curtain with a lace edge") stays for backward compatibility; this is the replacement.
//
//   import { moltenWipe } from '../lib/fx/art/sheet.js';
//   moltenWipe(ctx, A, B, t, { t0: pickup, hit: accent, seed: 3 });   // A the outgoing picture, B the next (canvases)
//
// The model follows the runner crust in Steel: Man's Servant 05:10-05:30 (review/studio_art_c2/before/ref/steel_0510):
//  - FRONT: a lobed, fingering front falls from the top edge (the lip enters on the pickup), blunt and bright with a
//    dark 2-3 px toe where the metal skins against the air.
//  - BODY: temperature from thickness and age. The thick centre clips white-yellow through the film curve (exposure.js),
//    the thin edges and the lobes are orange; age since the metal arrived darkens it through the heat ramp.
//  - CRUST: forms with age and is complete on the accent frame; where the sheet decelerates it wrinkles into ROPES
//    across the flow.
//  - CRACKS: open where the sheet stretches, over +2..+8 frames after the accent; they glow first, then the next shot
//    shows THROUGH them; from +8 the crust plates drop away on twos (each plate its own delay), revealing B.
// Everything is a pure function of t (no state), computed at half resolution in JS and scaled (0.2-0.5 s/frame).
import { wienRGB } from './molten.js';
import { filmCurve } from './exposure.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cache = new Map();
// value-noise fBm on a lattice (non-periodic at frame scale; anisotropic when sy != sx)
function fbmField(w, h, R, { oct = 5, base = 90, sx = 1, sy = 1, ridged = false } = {}) {
  const out = new Float32Array(w * h); let norm = 0;
  for (let o = 0; o < oct; o++) {
    const cell = base / (1 << o), amp = Math.pow(0.55, o); norm += amp;
    const gw = Math.ceil(w / cell / sx) + 2, gh = Math.ceil(h / cell / sy) + 2, g = new Float32Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = R();
    for (let y = 0; y < h; y++) { const fy = y / cell / sy, j = Math.floor(fy), v = fy - j, sv = v * v * (3 - 2 * v);
      for (let x = 0; x < w; x++) { const fx = x / cell / sx, i = Math.floor(fx), u = fx - i, su = u * u * (3 - 2 * u), k = j * gw + i;
        let n = (g[k] * (1 - su) + g[k + 1] * su) * (1 - sv) + (g[k + gw] * (1 - su) + g[k + gw + 1] * su) * sv;
        if (ridged) n = 1 - Math.abs(2 * n - 1);
        out[y * w + x] += amp * n; } } }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function setup(w, h, seed) {
  const key = `${w}x${h}:${seed}`; if (cache.has(key)) return cache.get(key);
  const R = mulberry(seed);
  // 1D lobe noise for the front (sum of sines with random phases: fingering)
  const lobes = Array.from({ length: 7 }, (_, i) => ({ f: (i + 1.3) * (1.6 + R()) * Math.PI * 2 / w, p: R() * 6.28, a: 1 / (1 + i * 0.7) }));
  const lobe = x => lobes.reduce((s, L) => s + L.a * Math.sin(x * L.f + L.p), 0) / 2.2;
  const F = fbmField(w, h, R, { base: 120 * w / 540 }), Fs = fbmField(w, h, R, { base: 60 * w / 540, sx: 0.25, sy: 2.4, oct: 4 }),   // Fs: slag streaks along the flow
    Fw = fbmField(w, h, R, { base: 70 * w / 540, oct: 3 }), Fr = fbmField(w, h, R, { base: 40 * w / 540, oct: 4, ridged: true });
  // crack network: jittered cells, stretched across the flow (plates wider than tall where the sheet slowed), edges
  // warped by the fBm so no plate is a polygon
  const nx = 5, ny = 9, pts = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([(i + 0.1 + 0.8 * R()) * w / nx, (j + 0.1 + 0.8 * R()) * h / ny, R()]);
  const edge = new Float32Array(w * h), id = new Int16Array(w * h), rope = new Float32Array(w * h), K = w / 540;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let f1 = 1e9, f2 = 1e9, k1 = 0; const wx = x + 38 * K * (Fw[i] - 0.5) * 2, wy = y + 30 * K * (F[i] - 0.5) * 2;
    const cj = Math.floor(wy / (h / ny)), ci = Math.floor(wx / (w / nx));
    for (let j = Math.max(0, cj - 1); j <= Math.min(ny - 1, cj + 1); j++) for (let ii = Math.max(0, ci - 1); ii <= Math.min(nx - 1, ci + 1); ii++) { const p = pts[j * nx + ii], dx = (p[0] - wx) * 0.8, dy = (p[1] - wy) * 1.25, d = Math.sqrt(dx * dx + dy * dy); if (d < f1) { f2 = f1; f1 = d; k1 = j * nx + ii; } else if (d < f2) f2 = d; }
    edge[i] = f2 - f1; id[i] = k1;
    // pahoehoe ropes: arcs bowed down-flow (the centre of a lobe runs ahead), period 9-16 px, warped
    const bow = 0.0009 / K * (x - w / 2) * (x - w / 2);
    rope[i] = Math.sin((y + bow + 90 * K * F[i] + 20 * K * Fw[i]) * (0.16 + 0.08 * Fw[i]) / K) * sstep(0.35, 0.7, Fw[i]);   // ropes come in bands, not everywhere
  }
  const drop = pts.map(() => ({ d: 8 + 2 * Math.floor(R() * 7), dx: (R() - 0.5) * 30 }));
  // the emission LUT: T (700..2000 K) x thickness gain (0..1) -> display rgb through the technicolor38 curve
  const lut = new Uint8ClampedArray(131 * 11 * 3), o = [0, 0, 0], e = [0, 0, 0];
  for (let ti = 0; ti <= 130; ti++) for (let gi = 0; gi <= 10; gi++) { wienRGB(700 + ti * 10, 1820, 3 + gi * 3.5, e); filmCurve(e, 'technicolor38', o); const k = (ti * 11 + gi) * 3; lut[k] = o[0] * 255; lut[k + 1] = o[1] * 255; lut[k + 2] = o[2] * 255; }
  const S = { lobe, F, Fs, Fw, Fr, rope, edge, id, drop, lut, w, h, K, layer: Object.assign(document.createElement('canvas'), { width: w, height: h }), mask: Object.assign(document.createElement('canvas'), { width: w, height: h }) };
  cache.set(key, S); return S;
}

// frames relative to the hit (twos-aware where the brief says so)
export function moltenWipe(ctx, A, B, t, { t0, hit, seed = 3, fps = 30, scale = 0.5, end = null } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height, w = Math.round(W * scale), h = Math.round(H * scale);
  const S = setup(w, h, seed), fr = (t - hit) * fps, prog = clamp((t - t0) / (hit - t0)), K = S.K;
  const tEnd = end ?? hit + 22 / fps;
  if (t < t0) { ctx.drawImage(A, 0, 0, W, H); return { phase: 'A' }; }
  if (t >= tEnd) { ctx.drawImage(B, 0, 0, W, H); return { phase: 'B' }; }
  // the front: accelerating fall (g), reaching past the bottom at the hit; lobes lead and lag
  const fall = Math.pow(prog, 1.7) * (h * 1.18);
  const g = S.layer.getContext('2d'), im = g.createImageData(w, h), D = im.data, mg = S.mask.getContext('2d'), mim = mg.createImageData(w, h), M = mim.data;
  // crust LEVEL: before the accent only skins far up the sheet (oldest metal) and slag rafts; on the accent frame the
  // skin SNAPS over (a picture act, not a fade), then keeps thickening
  const level = fr < 0 ? 0.16 * sstep(0.5, 1.0, prog) : 0.5 + 0.32 * clamp(fr / 10);
  const crackOpen = fr < 2 ? 0 : clamp((fr - 2) / 6);   // +2..+8
  const decel = sstep(0.55, 1, prog);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, lobeX = S.lobe(x) * h * 0.09 * (1 - 0.5 * prog), front = fall + lobeX - 0.02 * h;
    const behind = front - y; if (behind < 0) continue;
    // thickness: a rounded front (sqrt), thickest in the middle of the lobes, thin at the lobe gaps
    const thick = clamp(Math.sqrt(behind / (h * 0.05))) * (0.55 + 0.45 * clamp(0.5 + S.lobe(x) * 0.8));
    const age = clamp(behind / (h * 0.4));
    // crust coverage: an irregular field thresholded by the level; older metal crusts first; the ropes fold where it slows
    const cf = 0.62 * S.F[i] + 0.38 * S.Fr[i] + 0.35 * age - 0.2 + 0.08 * decel * S.rope[i];
    const cov = sstep(1 - level - 0.05, 1 - level + 0.07, cf);            // 0 = liquid, 1 = skinned
    const margin = Math.abs(cf - (1 - level));                            // near the skin edge: the glow line
    // plates drop away after +8, each on its own delay, on twos
    const pd = S.drop[S.id[i]];
    const ed = S.edge[i];
    const crackW = (crackOpen * (1.0 + 7 * S.Fw[i] * S.Fw[i] * 2) + (fr >= pd.d ? 1e3 : 0)) * K;
    const inCrack = ed < crackW;
    if (inCrack && (crackW - ed > 1.4 * K || fr >= pd.d)) { M[i * 4 + 3] = 255; continue; }     // B shows through
    // liquid: clipped white-yellow where thick, orange at thin edges; slag streaks run with the flow
    const slag = sstep(0.62, 0.8, S.Fs[i]) * (0.3 + 0.7 * age);
    let T = 1860 - 480 * (1 - thick) - 260 * slag - 120 * age;
    if (behind < 2.2 * K) T = Math.min(T, 1050);            // the dark toe
    if (inCrack) T = 1800 - 260 * (ed / Math.max(crackW, 1e-3));
    const ti = clamp(Math.round((T - 700) / 10), 0, 130), gi = clamp(Math.round(thick * 10), 0, 10), k = (ti * 11 + gi) * 3;
    let r = S.lut[k], gg = S.lut[k + 1], b = S.lut[k + 2];
    if (cov > 0 && !inCrack) {
      // the skin: grey-brown scale, relief from the ropes lit by the metal glowing in the seams (from below-left)
      const hL = S.rope[(y) * w + Math.max(0, x - 1)], hU = S.rope[Math.max(0, y - 1) * w + x], rel = (S.rope[i] - hU) * 0.9 + (S.rope[i] - hL) * 0.3;
      const rim = ed < 7 * K ? 0.55 + 0.45 * ed / (7 * K) : 1;   // plate edges curl down: darker rim
      const base = (16 + 30 * S.F[i] + 22 * S.Fr[i]) * rim, lit = clamp(0.5 + rel * 2.2) * decel + 0.5 * (1 - decel);
      const hot = clamp(1 - margin / 0.05) * (1 - 0.6 * clamp(fr / 14));     // skin still thin: glows through at the edges
      const cr = base * (0.55 + 0.9 * lit) * 1.08 + 230 * hot, cg = base * (0.55 + 0.9 * lit) * 0.96 + 90 * hot, cb = base * (0.55 + 0.9 * lit) * 0.86 + 10 * hot;
      // fresh skin is still dull red, darkening over +0..+10 frames
      const fresh = fr < 0 ? 1 : clamp(1 - fr / 10) * 0.6;
      const sr = cr + 55 * fresh, sg = cg + 8 * fresh, sb = cb;
      r = r * (1 - cov) + sr * cov; gg = gg * (1 - cov) + sg * cov; b = b * (1 - cov) + sb * cov;
    }
    // before the plates drop they sag: the crack lips pre-glow a frame or two early
    if (!inCrack && fr >= pd.d - 3 && fr < pd.d && ed < 4 * K) { r = Math.max(r, 240); gg = Math.max(gg, 150); b = Math.max(b, 40); }
    D[i * 4] = r; D[i * 4 + 1] = gg; D[i * 4 + 2] = b; D[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0); mg.putImageData(mim, 0, 0);
  ctx.drawImage(A, 0, 0, W, H);
  // the lip's heat lights the outgoing shot before it arrives (the work is the light)
  if (fr < 0) { const gl = ctx.createLinearGradient(0, 0, 0, H); const yF = clamp(fall / h) ; gl.addColorStop(0, `rgba(255,170,60,${0.35 * prog})`); gl.addColorStop(Math.min(1, yF + 0.25), `rgba(255,120,30,${0.25 * prog})`); gl.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
  // B through the opened cracks and fallen plates
  if (crackOpen > 0 || fr >= 0) { const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const tg = tmp.getContext('2d'); tg.drawImage(B, 0, 0, W, H); tg.globalCompositeOperation = 'destination-in'; tg.imageSmoothingEnabled = true; tg.drawImage(S.mask, 0, 0, W, H); ctx.drawImage(tmp, 0, 0); }
  ctx.imageSmoothingEnabled = true; ctx.drawImage(S.layer, 0, 0, W, H);
  return { phase: fr < 0 ? 'pour' : fr < 2 ? 'crust' : fr < 8 ? 'crack' : 'drop', prog: +prog.toFixed(3), crackOpen: +crackOpen.toFixed(2) };
}
