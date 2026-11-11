// ART kit / TRANSITIONS: every change of shot is a physical act that ends on a hit. 2D canvas; A, B are canvases.
//
//   import { ladleWipe, platePull, platen, shimmer, TRANSITIONS } from '../lib/fx/art/transitions.js';
//   ladleWipe(ctx, A, B, t, { t0, hit })   // THE HOUSE SIGNATURE: a sheet of molten metal pours down across A, its front
//                                          // white-hot, cooling behind to orange, red, then a black crust that cracks and
//                                          // falls away to reveal B, exactly on the hit
//   platePull(ctx, A, B, t, { t0, hit })   // a squeegee drags ink down through a screen: B is printed behind the blade
//   platen(ctx, A, B, t, { t0, hit })      // the press closes on A (2 frames dark with the forme), opens on B (fresh print)
//   shimmer(ctx, A, B, t, { t0, hit })     // heat refraction ramps to max, the shot changes inside it (thermal/heat only)
// Each returns true while it owns the frame. t0 = start, hit = the frame the new shot must be fully there.
import { M } from './motion.js';
import { INK, heatRGB, hex } from './tokens.js';

const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const S = {};
const buf = (k, w, h) => (S[k] && S[k].width === w && S[k].height === h ? S[k] : (S[k] = mk(w, h)));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
function vnoise(seed = 3, n = 512) { const k = 'vn' + seed; if (S[k]) return S[k]; const a = new Float32Array(n); let x = seed * 7919 + 1;
  const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  const g = Array.from({ length: 33 }, r); for (let i = 0; i < n; i++) { const u = i / n * 32, j = Math.floor(u), f = u - j, s = f * f * (3 - 2 * f); a[i] = g[j] + (g[j + 1] - g[j]) * s; }
  return (S[k] = a); }
// a 2D value-noise field at quarter res (baked once): crust cells and cracks
function crackField(w, h, seed = 7) {
  const k = 'cf' + w + seed; if (S[k]) return S[k];
  const F = new Float32Array(w * h), pts = []; let x = seed * 104729 + 3; const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  const C = 26; for (let i = 0; i < C * 46; i++) pts.push([((i % C) + r()) / C * w, (Math.floor(i / C) + r()) / 46 * h]);
  const cw = w / C, ch = h / 46;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let f1 = 1e9, f2 = 1e9; const ci = Math.floor(xx / cw), cj = Math.floor(y / ch);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= C || jj >= 46) continue; const p = pts[jj * C + ii], d = Math.hypot(p[0] - xx, p[1] - y); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d; }
    F[y * w + xx] = clamp((f2 - f1) / (cw * 0.5)); }
  return (S[k] = F);
}

// ---------------------------------------------------------------- the ladle wipe
export function ladleWipe(ctx, A, B, t, { t0, hit, seed = 3, cool = 0.28 } = {}) {
  if (t < t0 || M.rel(t, hit) > 8) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height, w = W / 2, h = H / 2;       // half res pass, upscaled (the sheet is soft-edged matter)
  const tw = M.twos(t);
  const u = clamp((tw - t0) / (hit - t0)), post = Math.max(0, M.rel(t, hit)) / 8;
  const a = buf('lwA', w, h), ag = a.getContext('2d', { willReadFrequently: true }); ag.drawImage(A, 0, 0, w, h);
  const b = buf('lwB', w, h), bg = b.getContext('2d', { willReadFrequently: true }); bg.drawImage(B, 0, 0, w, h);
  const DA = ag.getImageData(0, 0, w, h).data, DB = bg.getImageData(0, 0, w, h).data;
  const o = buf('lwO', w, h), og = o.getContext('2d'), im = og.createImageData(w, h), D = im.data;
  const nz = vnoise(seed), nz2 = vnoise(seed + 5), CF = crackField(w, h, seed), c = [0, 0, 0];
  // the front: falls with g (accelerating), lobed by the lip's pour (tongues run ahead), overshoots the bottom by 30%
  const front = M.curve.pour(u) * h * 1.35;
  const crustAt = cool * h;                       // distance behind the front where it has cooled to crust
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, lobe = 34 * Math.sin(x * 0.011 + 1.3) + 22 * Math.sin(x * 0.029 + tw * 2.1) + 9 * Math.sin(x * 0.071 - tw * 3.3) + 40;   // a few rounded tongues
    const d = front - lobe * Math.min(1, u * 3) - y;          // > 0: under the sheet
    if (d < 0 && post === 0) { D[i] = DA[i]; D[i + 1] = DA[i + 1]; D[i + 2] = DA[i + 2]; D[i + 3] = 255; continue; }
    const streak = 0.35 * Math.sin(d * 0.09 + nz[Math.floor(x * 0.2) % 512] * 6) * Math.min(1, d / 40);   // flow ripples across the sheet, not stripes
    let T = 2000 - Math.pow(Math.max(0, d) / crustAt, 2.2) * 1100 + streak * 120 - post * 900;
    const cr = CF[y * w + x];
    if (T > 880) { heatRGB(T, c); const k = clamp((T - 800) / 500); D[i] = c[0] * k + 21 * (1 - k); D[i + 1] = c[1] * k + 17 * (1 - k); D[i + 2] = c[2] * k + 15 * (1 - k); D[i + 3] = 255; continue; }
    // crust: warm-black plates; cracks glow while hot, then the plates fall away (reveal B) from the top down
    const age = clamp((900 - T) / 700);                      // 0 just crusted -> 1 cold
    const reveal = clamp((age - 0.25 - (1 - cr) * 0.5) * 3 + post * 2);
    const crack = cr < 0.12 ? clamp(1 - age * 1.6) : 0;
    heatRGB(1250 - age * 400, c);
    const kr = 21 + (1 - cr) * 10, kg = 17 + (1 - cr) * 7, kb = 15 + (1 - cr) * 5;
    const r0 = kr + (c[0] - kr) * crack, g0 = kg + (c[1] - kg) * crack, b0 = kb + (c[2] - kb) * crack;
    D[i] = r0 + (DB[i] - r0) * reveal; D[i + 1] = g0 + (DB[i + 1] - g0) * reveal; D[i + 2] = b0 + (DB[i + 2] - b0) * reveal; D[i + 3] = 255;
  }
  og.putImageData(im, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(o, 0, 0, W, H); ctx.restore();
  return true;
}

// ---------------------------------------------------------------- the plate pull (silkscreen)
export function platePull(ctx, A, B, t, { t0, hit, ink = 'red', mesh = 7, angle = -0.06 } = {}) {
  const f = M.rel(t, hit); if (t < t0 || f > 6) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height, u = clamp((t - t0) / (hit - t0));
  const yb = M.curve.press(u) * (H + 80) - 40;         // the blade
  ctx.drawImage(A, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, yb + W * angle); ctx.lineTo(0, yb); ctx.closePath(); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
  if (f < 0) {
    // the screen mesh over the not-yet-printed part (a faint grid of the stretched screen), the ink bead at the blade
    ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = INK.ink; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += mesh) { ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = INK[ink] || ink; ctx.beginPath(); ctx.moveTo(0, yb - 4); for (let x = 0; x <= W; x += 30) ctx.lineTo(x, yb + x * angle - 8 - 7 * Math.sin(x * 0.05 + t * 20)); ctx.lineTo(W, yb + W * angle + 6); ctx.lineTo(0, yb + 10); ctx.fill();
    ctx.fillStyle = INK.ink; ctx.fillRect(0, yb + 10, W, 14);                     // the blade's rubber, then its holder
    ctx.fillStyle = '#6a5a48'; ctx.fillRect(0, yb + 24, W, 30);
  }
  return true;
}

// ---------------------------------------------------------------- the platen press
export function platen(ctx, A, B, t, { t0, hit, forme = null } = {}) {
  const f = M.rel(t, hit); if (t < t0 || f > 8) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (f < -2) { const u = clamp((t - t0) / (hit - 2 / 30 - t0)), c = M.curve.press(u);
    ctx.drawImage(A, 0, 0); const top = c * H / 2, bot = H - c * H / 2;
    ctx.fillStyle = INK.ink; ctx.fillRect(0, 0, W, top); ctx.fillRect(0, bot, W, H - bot);
    ctx.fillStyle = '#3a312a'; ctx.fillRect(0, top - 18, W, 18); ctx.fillRect(0, bot, W, 18); return true; }
  if (f < 0) { ctx.fillStyle = INK.ink; ctx.fillRect(0, 0, W, H); if (forme) ctx.drawImage(forme, 0, 0); return true; }     // closed: the impression
  const u = M.curve.lift(clamp((f + 1) / 5)); ctx.drawImage(B, 0, 0);          // opens ON the hit: 36% on frame 0
  const gap = u * H / 2; ctx.fillStyle = INK.ink; ctx.fillRect(0, 0, W, H / 2 - gap); ctx.fillRect(0, H / 2 + gap, W, H / 2 - gap);
  return true;
}

// ---------------------------------------------------------------- heat shimmer
export function shimmer(ctx, A, B, t, { t0, hit, amp = 26, band = 6 } = {}) {
  const f = M.rel(t, hit); if (t < t0 || f > 10) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height, u = f < 0 ? clamp((t - t0) / (hit - t0)) : 1 - clamp(f / 10);
  const src = f < 0 ? A : B, k = u * u * amp, tt = M.twos(t);
  for (let y = 0; y < H; y += band) { const dx = k * (Math.sin(y * 0.021 + tt * 9) * 0.6 + Math.sin(y * 0.057 - tt * 13) * 0.4); ctx.drawImage(src, 0, y, W, band, dx, y, W, band); }
  return true;
}
export const TRANSITIONS = { ladleWipe, platePull, platen, shimmer };
