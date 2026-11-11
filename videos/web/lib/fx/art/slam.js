// ART kit / SLAM: the chant slam, the four-stripe rule and the closer that grows out of it. 2D canvas.
//
//   import { loadArtFonts, FACES, slam, stripeRule, closerFromRule } from '../lib/fx/art/slam.js';
//   await loadArtFonts();
//   slam(ctx, t, { lines: ['RED', 'HOT.'], hit: 12.0, out: 13.4, x: 80, y: 520, size: 300, face: FACES.furnace, plate: 'stock', red: 1 })
//   stripeRule(ctx, t, { hit, x, y, w })            // the payoff underline: the flag's FOUR stripes, struck in
//   closerFromRule(ctx, t, { hit, from: {x, y, w} })  // the rule becomes the red band the ☭≡/acc lockup is struck onto
//
// The grammar (STYLE_BIBLE §motion): a word is a PRINTED OBJECT. It strikes (3 frames in from 116%), lands (contact
// frame: ink squash + spatter), its red plate lands 6-10 px off register and is pulled in over 3 frames, it holds on
// twos with a drift of 1-2 px, and it leaves by a PLATE LIFT (2 frames: the ink tears away patchy), never a fade.
// No shadow, no glow, no keyline, no bevel: value comes from the ink against the ground.
import { M } from './motion.js';
import { INK } from './tokens.js';
import { BRAND, tinted, sigil } from '../../kit.js';

const FD = '../node_modules/@fontsource';
export const FACES = {
  furnace: { family: 'Big Shoulders Display', weight: 900, track: 0.0 },   // Chicago industrial signage: IRON, MECHA
  press: { family: 'Archivo Black', weight: 400, track: -0.01 },          // newsprint grotesque: CIVILIZATION, ALL POWER
  bank: { family: 'Playfair Display', weight: 900, track: 0.0 },           // the note: BANK, 1776
  stencil: { family: 'Big Shoulders Stencil Display', weight: 900, track: 0.02 },   // RED WEDGE stamped steel
  poster: { family: 'Anton', weight: 400, track: 0.0 },                    // THE GIANT only (condensed caps budget)
};
export async function loadArtFonts() {
  const list = [['Big Shoulders Display', `${FD}/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2`, 900],
    ['Big Shoulders Stencil Display', `${FD}/big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-900-normal.woff2`, 900],
    ['Playfair Display', `${FD}/playfair-display/files/playfair-display-latin-900-normal.woff2`, 900],
    ['Archivo Black', `${FD}/archivo-black/files/archivo-black-latin-400-normal.woff2`, 400]];
  await Promise.all(list.map(async ([n, u, w]) => { try { const f = new FontFace(n, `url(${u})`, { weight: String(w) }); document.fonts.add(await f.load()); } catch (e) { console.warn('font', n, e.message); } }));
}
const col = k => INK[k] || k;
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
let NOISE = null;
function noiseMask(w = 540, h = 960, seed = 9) {        // blotchy mask for ink texture and tearing
  if (NOISE) return NOISE; const c = mk(w, h), g = c.getContext('2d'); let x = seed * 7919 + 1;
  const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const s = 1 + r() * r() * 14; g.fillStyle = `rgba(255,255,255,${0.2 + 0.6 * r()})`; g.beginPath(); g.ellipse(r() * w, r() * h, s, s * (0.5 + r()), r() * 3, 0, 7); g.fill(); }
  NOISE = c; return c;
}
const font = (F, size) => `${F.weight} ${Math.round(size)}px "${F.family}"`;
function fitSize(ctx, lines, F, size, maxW) { let s = size; ctx.font = font(F, s); while (s > 40 && Math.max(...lines.map(l => ctx.measureText(l).width)) > maxW) { s -= 4; ctx.font = font(F, s); } return s; }

// the word block drawn once into its own canvas (ink colour c), letter-spaced; returns {canvas, w, h, lineH}
function block(lines, F, size, c, lead = 0.9) {
  const g0 = mk(4, 4).getContext('2d'); g0.font = font(F, size);
  const ws = lines.map(l => g0.measureText(l).width), w = Math.ceil(Math.max(...ws)) + 20, lh = size * lead, h = Math.ceil(lh * lines.length + size * 0.3);
  const cv = mk(w, h), g = cv.getContext('2d'); g.font = font(F, size); g.fillStyle = c; g.textBaseline = 'alphabetic';
  lines.forEach((l, i) => g.fillText(l, 10, size * 0.92 + i * lh)); return { canvas: cv, w, h, lineH: lh, widths: ws };
}
const cache = new Map();
function blockC(lines, F, size, c) { const k = lines.join('|') + F.family + size + c; if (!cache.has(k)) { if (cache.size > 60) cache.clear(); cache.set(k, block(lines, F, size, c)); } return cache.get(k); }

// ink texture on a block: slightly uneven coverage (the plate's inking), keeps edges
function inked(src, t, k = 0.22) {
  const c = mk(src.width, src.height), g = c.getContext('2d'); g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = k; const N = noiseMask();
  g.drawImage(N, (Math.floor(M.twos(t) * 15) % 7) * 11, 0, src.width, src.height, 0, 0, src.width, src.height); return c;
}

export function slam(ctx, t, o) {
  const { lines, hit, out = Infinity, x = 80, y = 400, size = 280, face = FACES.press, plate = 'ink', red = null, redPlate = 'red',
    maxW = ctx.canvas.width - 2 * x, misreg = [9, -6], spatter = true, anchor = 'left', seed = 1 } = o;
  const f = M.rel(t, hit), fOut = M.rel(t, out);
  if (f < -3 || fOut >= 2) return null;
  const s = fitSize(ctx, lines, face, size, maxW);
  const isRed = i => red === true || (Array.isArray(red) && red.includes(i));
  const B = blockC(lines.map((l, i) => (Array.isArray(red) && isRed(i) ? '' : l)), face, s, col(plate));
  const Bfull = blockC(lines, face, s, col(plate));
  const en = M.enter(t, hit, { from: 1.16, n: 3 }), ld = M.land(t, hit, { squash: 0.06, settle: 8, over: 0.02 });
  const [dx, dy] = f > 10 ? M.drift(t, seed, 1.5) : [0, 0];
  let sx = en.s * (1 + ld.squash * 0.7 + ld.overshoot), sy = en.s * (1 - ld.squash + ld.overshoot);
  const X = anchor === 'center' ? x + (maxW - Bfull.w) / 2 : x, cx = X + Bfull.w / 2 + dx, cy = y + Bfull.h / 2 + dy;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-Bfull.w / 2, -Bfull.h / 2);
  // entering frames: the word is in flight -> a smear (two ghost prints along the approach), no blur filter
  if (f < 0) { ctx.globalAlpha = 0.35; ctx.drawImage(B.canvas, 0, -26 * (f + 4)); ctx.globalAlpha = 1; }
  let src = inked(B.canvas, t, red !== null ? 0.07 : 0.2);
  if (fOut >= 0) { const c2 = src.getContext('2d'); c2.globalCompositeOperation = 'destination-out'; c2.globalAlpha = 1;
    const N = noiseMask(); c2.filter = `contrast(${fOut === 0 ? 3 : 8}) brightness(${fOut === 0 ? 0.9 : 1.4})`; c2.drawImage(N, 30, 50, src.width, src.height, 0, 0, src.width, src.height); c2.filter = 'none';
    ctx.translate(0, -8 - 10 * fOut); }
  // the red plate: whole block (red: true) or listed words' lines (red: [lineIndex]) printed under, off register first
  if (red !== null) {
    const R = blockC(lines.map((l, i) => (isRed(i) ? l : '')), face, s, col(redPlate));
    const k = f < 0 ? 1 : Math.max(0, 1 - f / 3), ox = misreg[0] * k, oy = misreg[1] * k;
    if (fOut < 1) { ctx.globalAlpha = fOut === 0 ? 0.55 : 1; ctx.drawImage(inked(R.canvas, t + 0.5, fOut === 0 ? 0.6 : 0.15), ox, oy); ctx.globalAlpha = 1; }   // the red plate tears off with the lift
    if (red === true) { ctx.restore(); return { w: Bfull.w * sx, h: Bfull.h * sy, size: s, x: X, y }; }       // the red plate IS the word
  }
  // dot gain on contact: the ink spreads (draw the block again offset a pixel each way)
  if (f === 0 || f === 1) { const gpx = f === 0 ? 3 : 1.5; for (const [a, b] of [[gpx, 0], [-gpx, 0], [0, gpx], [0, -gpx]]) ctx.drawImage(src, a, b); }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  // spatter: ink squeezed out on contact, flung along the strike (frames 0-5, on twos)
  if (spatter && f >= 0 && f <= 5) {
    const k2 = Math.floor(f / 2) * 2; let q = seed * 97 + 13; const r = () => { q = (q * 16807) % 2147483647; return q / 2147483647; };
    ctx.fillStyle = col(plate);
    for (let i = 0; i < 26; i++) { const ex = X + r() * Bfull.w, ey = y + (r() < 0.5 ? Bfull.h * 0.12 : Bfull.h * 0.92), a = (r() - 0.5) * 2.4 + (ey > y + Bfull.h / 2 ? Math.PI / 2 : -Math.PI / 2),
      d = (8 + r() * 36) * (1 + k2 * 0.35), rr = (1 + r() * 4) * (1 - k2 / 7);
      if (rr > 0.3) { ctx.beginPath(); ctx.ellipse(ex + Math.cos(a) * d, ey + Math.sin(a) * d, rr, rr * 0.7, a, 0, 7); ctx.fill(); } }
  }
  return { w: Bfull.w * sx, h: Bfull.h * sy, size: s, x: X, y };
}

// the payoff rule: four stripes (the ACP flag's), struck from the left in 3 frames with a hard stop
export function stripeRule(ctx, t, { hit, x = 80, y = 1000, w = 920, h = 60, ink = 'red', gap = 0.55, from = 'left' } = {}) {
  const f = M.rel(t, hit); if (f < 0) return null;
  const u = f >= 3 ? 1 : M.curve.lift((f + 1) / 4), ov = f >= 3 && f < 9 ? 0.02 * Math.sin((f - 3) / 6 * Math.PI) : 0;
  const bh = h / (4 + 3 * gap), W = w * (u + ov);
  ctx.fillStyle = col(ink);
  for (let i = 0; i < 4; i++) { const yy = y + i * bh * (1 + gap), lag = i * 0.06, ww = Math.max(0, W - w * lag * (f < 5 ? 1 : 0));
    ctx.fillRect(from === 'left' ? x : x + w - ww, yy, ww, bh); }
  return { x, y, w, h };
}

// the closer: the rule's stripes widen into a red band over 5 frames (press curve), the ☭≡/acc lockup is struck onto
// the band on frame 6, ACP.US printed under it on frame 10. Total 1.2 s. bg: what is behind (left untouched).
export function closerFromRule(ctx, t, { hit, from = { x: 80, y: 1000, w: 920, h: 60 }, band = 'red', ink = 'stock', H = 1920, W = 1080 } = {}) {
  const f = M.rel(t, hit); if (f < 0) return false;
  const u = M.curve.press(Math.min(1, f / 6));
  const y0 = from.y + (0 - from.y) * u, y1 = from.y + from.h + (H - from.y - from.h) * u, x0 = from.x * (1 - u), x1 = from.x + from.w + (W - from.x - from.w) * u;
  // the four stripes spread apart as the band grows: the gaps stay as stock lines until they close (f >= 6)
  ctx.fillStyle = col(band); const bh = (y1 - y0) / 4;
  for (let i = 0; i < 4; i++) { const gapK = f >= 6 ? 0 : (1 - u) * 0.35 + 0.04; ctx.fillRect(x0, y0 + i * bh, x1 - x0, bh * (1 - gapK)); }
  if (f >= 6) {
    const L = BRAND.acc_lockup; if (L) {
      const sz = 180, g = M.enter(t, hit + 6 / 30, { from: 1.14, n: 0 }), ld = M.land(t, hit + 6 / 30);
      ctx.save(); ctx.translate(W / 2, H * 0.46); ctx.scale(g.s * (1 + ld.squash * 0.6), g.s * (1 - ld.squash)); sigil(ctx, 0, 0, sz, { color: col(ink) }); ctx.restore();
    }
    if (f >= 10) { const F = FACES.press; ctx.font = font(F, 64); ctx.fillStyle = col(ink); ctx.textAlign = 'center'; ctx.fillText('ACP.US', W / 2, H * 0.46 + 190); ctx.textAlign = 'left'; }
  }
  return true;
}
