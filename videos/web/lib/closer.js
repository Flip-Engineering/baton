// CLOSER studio (c1): the ACP mark as VECTOR geometry with separable parts, material passes that put the mark in a piece's own
// material, and four worked closers (flap board, hard-hat decal, stencilled beam, rubber stamp).  Notes and adoption list:
// research/capabilities/closer.md.  The kit's acpEmblem / sigil draw from the same vectors (kit.js), so old scenes get a crisp mark.
//
//   import { drawMark, drawLockup, inkStamp, flapMark, CLOSERS } from '../lib/closer.js';
//   drawMark(ctx, cx, cy, 520, { color: RED, stripes: [1, .6, 0, 0] });      // four stripes grow, the badge is there
//   CLOSERS.stamp(ctx, age)  /  CLOSERS.flaps(ctx, age)  /  CLOSERS.decal(ctx, age, world)  /  CLOSERS.beam(ctx, age, under)
import { BADGE_D, MARK_META as MM, LOCKUP as LK } from './closer_mark_paths.js';

const W = 1080, H = 1920;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const outExpo = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const outBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const RED = '#bf1f1f';                // the logo's own red (mean of the artwork)
export const PAPER = '#efe3cc', INK = '#a3141b';

// ---------------------------------------------------------------- the vector mark
// Frame: the emblem's own 380 x 235 source box (the same box kit.js's raster emblem had), so size/cx/cy mean what they always meant.
export const EMBLEM = { w: 380, h: 235 };
let _badge = null; const _stripes = [];
function paths() {
  if (!_badge) { _badge = new Path2D(BADGE_D); for (const s of MM.stripes) { const p = new Path2D(); p.rect(MM.xs, s.y0, MM.xr - MM.xs, s.y1 - s.y0); _stripes.push(p); } }
  return { badge: _badge, stripes: _stripes };
}
// Screen geometry of the mark placed at (cx, cy) with emblem height `size`: scale, origin, and each stripe's screen rect.
export function markBox(cx, cy, size) {
  const sc = size / EMBLEM.h, ox = cx - EMBLEM.w * sc / 2, oy = cy - size / 2;
  return { sc, ox, oy, box: { x0: ox + MM.bbox.x0 * sc, y0: oy + MM.bbox.y0 * sc, x1: ox + MM.bbox.x1 * sc, y1: oy + MM.bbox.y1 * sc },
    stripes: MM.stripes.map(s => ({ x0: ox + MM.xs * sc, x1: ox + MM.xr * sc, y0: oy + s.y0 * sc, y1: oy + s.y1 * sc })) };
}
// parts: badge (0..1 alpha), stripes [4] (0..1: each grows left to right out of the badge).  fill overrides color (pattern/gradient).
export function drawMark(ctx, cx, cy, size, { color = RED, fill = null, alpha = 1, badge = 1, stripes = [1, 1, 1, 1], tilt = 0 } = {}) {
  const P = paths(), g = markBox(cx, cy, size);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = fill || color;
  ctx.translate(g.ox, g.oy); ctx.scale(g.sc, g.sc);
  // The mark is always upright (the client, 1 Oct: rotated to a diagonal it "looks awful"). `tilt` is accepted for old callers and ignored.
  if (badge > 0) { ctx.globalAlpha *= badge; ctx.fill(P.badge); ctx.globalAlpha /= (badge || 1); }
  for (let k = 0; k < 4; k++) {
    const p = clamp(stripes[k] ?? 1); if (p <= 0) continue;
    if (p >= 1) ctx.fill(P.stripes[k]); else { const s = MM.stripes[k]; ctx.fillRect(MM.xs, s.y0, (MM.xr - MM.xs) * p, s.y1 - s.y0); }
  }
  ctx.restore(); return g;
}
export function markStroke(ctx, cx, cy, size, lineWidth, style) {      // an outline of the badge and stripes (ink squash, engraving, glow)
  const P = paths(), g = markBox(cx, cy, size);
  ctx.save(); ctx.translate(g.ox, g.oy); ctx.scale(g.sc, g.sc); ctx.lineWidth = lineWidth / g.sc; ctx.strokeStyle = style; ctx.lineJoin = 'round';
  ctx.stroke(P.badge); for (const p of P.stripes) ctx.stroke(p); ctx.restore();
}

// The ☭≡/acc lockup in vector, per part: mark (gear, hammer, sickle), eq (the ≡), slash, acc.  size = lockup height.
let _lock = null;
function lockPaths() { if (!_lock) { _lock = {}; for (const [k, v] of Object.entries(LK.parts)) _lock[k] = new Path2D(v.d); } return _lock; }
export function lockupBox(cx, cy, size) { const sc = size / LK.h; return { sc, ox: cx - LK.w * sc / 2, oy: cy - size / 2, w: LK.w * sc }; }
export function drawLockup(ctx, cx, cy, size, { color = '#F4E6D0', accent = null, alpha = 1, parts = {}, fill = null } = {}) {
  const P = lockPaths(), b = lockupBox(cx, cy, size), A0 = ctx.globalAlpha;
  ctx.save(); ctx.translate(b.ox, b.oy); ctx.scale(b.sc, b.sc);
  for (const k of ['mark', 'eq', 'slash', 'acc']) {
    const a = parts[k] ?? 1; if (a <= 0) continue;
    ctx.globalAlpha = A0 * alpha * a; ctx.fillStyle = (k === 'mark' && accent) ? accent : (fill || color);
    ctx.save(); ctx.translate(LK.parts[k].x0, 0); ctx.fill(P[k]); ctx.restore();
  }
  ctx.restore(); return b;
}

// ---------------------------------------------------------------- materials
function cv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
const _cache = new Map();
function cached(key, make) { if (!_cache.has(key)) _cache.set(key, make()); return _cache.get(key); }

// INK STAMP: rubber stamp on paper.  Dry edge breakup, voids where the ink did not take, an edge ridge where it squashed out, a faint
// misregistered ghost.  Returns a canvas (cached); draw it with multiply on a light ground.
export function inkCanvas(size, { color = INK, seed = 3, press = 1 } = {}) {
  return cached(`ink${size}${color}${seed}${press}`, () => {
    const g0 = markBox(0, 0, size), pad = 30, c = cv(EMBLEM.w * g0.sc + pad * 2, size + pad * 2), g = c.getContext('2d'), r = rng(seed);
    const cx = c.width / 2, cy = c.height / 2;
    drawMark(g, cx + 2.2, cy + 1.6, size, { color, alpha: 0.28 });                    // misregistered ghost
    drawMark(g, cx, cy, size, { color });
    g.globalCompositeOperation = 'source-atop'; markStroke(g, cx, cy, size, 2.2 * g0.sc / 1.4, 'rgba(60,0,6,0.45)'); // squash ridge
    g.globalCompositeOperation = 'destination-out';
    g.save(); g.setLineDash([2.5 * g0.sc / 1.4, 6 * g0.sc / 1.4]); markStroke(g, cx, cy, size, 3.4 * g0.sc / 1.4, 'rgba(0,0,0,0.85)'); g.restore();   // dry edge
    const n = Math.round(c.width * c.height / 260 * (1.6 - 0.6 * press));
    for (let i = 0; i < n; i++) { const x = r() * c.width, y = r() * c.height, s = 0.6 + r() * r() * 3.2; g.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.6})`; g.fillRect(x, y, s, s * (0.6 + r())); }
    for (let i = 0; i < 7; i++) {                                                                  // uneven inking: a few soft dry patches
      const x = r() * c.width, y = r() * c.height, rr = 10 + r() * 34, gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(0,0,0,${0.18 + r() * 0.3})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    return c;
  });
}
export function inkStamp(ctx, cx, cy, size, { color = INK, seed = 3, alpha = 1, press = 1, rot = 0, multiply = true } = {}) {
  const c = inkCanvas(size, { color, seed, press });
  ctx.save(); ctx.globalAlpha *= alpha; if (multiply) ctx.globalCompositeOperation = 'multiply';
  ctx.translate(cx, cy); ctx.rotate(rot); ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore();
}

// PAPER: cream stock with fibre, foxing and a crease; used under stamps and decals.
export function paperCanvas(w, h, { base = PAPER, seed = 5, crease = true } = {}) {
  return cached(`paper${w}${h}${base}${seed}${crease}`, () => {
    const c = cv(w, h), g = c.getContext('2d'), r = rng(seed); g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 90; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,90,50' : '255,255,255'},${0.02 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 1 + r() * 7, 0.6); }
    for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, rr = 14 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(150,110,60,${0.04 + r() * 0.06})`); gr.addColorStop(1, 'rgba(150,110,60,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    if (crease) { const gr = g.createLinearGradient(0, h * 0.5 - 14, 0, h * 0.5 + 14); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0.1)'); g.fillStyle = gr; g.fillRect(0, h * 0.5 - 14, w, 28); }
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,40,10,0.28)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return c;
  });
}

// SPRAY STENCIL: a mark sprayed through a stencil: crisp core, soft overspray, speckle, bridges (the gear's counters held by ties), a drip.
export function sprayCanvas(size, { color = RED, seed = 2, bridges = true } = {}) {
  return cached(`spray${size}${color}${seed}${bridges}`, () => {
    const g0 = markBox(0, 0, size), pad = 60, c = cv(EMBLEM.w * g0.sc + pad * 2, size + pad * 2), g = c.getContext('2d'), r = rng(seed);
    const cx = c.width / 2, cy = c.height / 2;
    g.filter = `blur(${Math.max(3, size * 0.02)}px)`; drawMark(g, cx, cy, size, { color, alpha: 0.55 }); g.filter = 'none';        // overspray halo
    drawMark(g, cx, cy, size, { color });
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 900; i++) {                                                                                                  // speckle outside the edge
      const a = r() * 6.283, d = Math.abs(r() + r() - 1) * size * 0.06, bx = cx + (r() - 0.5) * EMBLEM.w * g0.sc * 0.9, by = cy + (r() - 0.5) * size * 0.8;
      g.fillStyle = color; g.globalAlpha = 0.15 + r() * 0.5; g.fillRect(bx + Math.cos(a) * d, by + Math.sin(a) * d, 1 + r() * 2, 1 + r() * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-out';
    if (bridges) { g.fillStyle = '#000'; const b = markBox(cx, cy, size); for (const f of [0.3, 0.55, 0.78]) g.fillRect(b.ox + (MM.bbox.x0 + 6) * b.sc, b.oy + (MM.bbox.y0 + (MM.bbox.y1 - MM.bbox.y0) * f) * b.sc, 112 * b.sc, 1.6 * b.sc / 1.4); }
    g.fillStyle = 'rgba(0,0,0,0.8)'; for (let i = 0; i < 160; i++) g.fillRect(r() * c.width, r() * c.height, 0.8 + r() * 1.6, 0.8 + r() * 1.6);   // primer showing through
    g.globalCompositeOperation = 'source-over'; g.fillStyle = color;
    const bx = markBox(cx, cy, size).stripes[2]; for (let k = 0; k < 2; k++) { const x = bx.x0 + (0.2 + r() * 0.7) * (bx.x1 - bx.x0), y0 = bx.y1, L = 14 + r() * 40; g.globalAlpha = 0.85; g.fillRect(x, y0 - 2, 2.2, L); g.beginPath(); g.arc(x + 1.1, y0 + L, 2.2, 0, 6.3); g.fill(); }
    return c;
  });
}

// DECAL: a printed vinyl label with wear: white stock, rounded corners, the mark in red, scuffs, a lifted corner, a hard edge shadow.
export function decalCanvas(w, h, { seed = 4, mark = true, wear = 1 } = {}) {
  return cached(`decal${w}${h}${seed}${mark}${wear}`, () => {
    const c = cv(w + 24, h + 24), g = c.getContext('2d'), r = rng(seed), rr = 22;
    g.translate(12, 12); g.fillStyle = 'rgba(0,0,0,0.38)'; g.beginPath(); g.roundRect(3, 5, w, h, rr); g.fill();       // drop shadow on the surface
    g.save(); g.beginPath(); g.roundRect(0, 0, w, h, rr); g.clip();
    g.fillStyle = '#f1efe8'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0.07)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (mark) drawMark(g, w / 2, h / 2 - 6, h * 0.78, { color: RED });
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 70 * wear; i++) { g.strokeStyle = `rgba(${r() < 0.6 ? '60,50,40' : '255,255,255'},${0.08 + r() * 0.25})`; g.lineWidth = 0.6 + r() * 1.4; const x = r() * w, y = r() * h, a = -0.5 + r() * 1.0; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (6 + r() * 36), y + Math.sin(a) * (6 + r() * 36)); g.stroke(); }
    g.fillStyle = 'rgba(40,30,20,0.35)'; for (let i = 0; i < 90 * wear; i++) g.fillRect(r() * w, r() * h, 1 + r(), 1 + r());   // grit
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.9)'; for (let i = 0; i < 60 * wear; i++) { const x = r() < 0.5 ? r() * 8 : w - r() * 8, y = r() * h; g.fillRect(x, y, 1 + r() * 3, 1 + r() * 3); }   // edge chips
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(w - 34, h); g.lineTo(w, h - 34); g.lineTo(w, h); g.fill();                         // lifted corner
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(w - 34, h); g.lineTo(w - 26, h - 8); g.lineTo(w, h - 34); g.lineTo(w, h - 26); g.fill();
    return c;
  });
}

// ---------------------------------------------------------------- split-flap tiles
// A tile flips from colour `a` to colour `b`: the old top half folds down (u 0..0.5), the new bottom half unfolds (u 0.5..1).
export function flapTile(g, x, y, w, h, a, b, u, { seam = true, gap = 1.5, glyph = null, gfont = null, gcol = '#ece3cf' } = {}) {
  const m = y + h / 2, ix = x + gap / 2, iw = w - gap, hh = h / 2;
  const fillHalf = (col, yy, hgt, shade) => { g.fillStyle = col; g.fillRect(ix, yy, iw, hgt); if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(ix, yy, iw, hgt); } };
  const gly = (yy0, yy1, sy, ty) => { if (!glyph) return; g.save(); g.beginPath(); g.rect(ix, yy0, iw, yy1 - yy0); g.clip(); g.translate(0, ty); g.scale(1, sy); g.fillStyle = gcol; g.font = gfont; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, x + w / 2, m / sy - (ty ? 0 : 0)); g.restore(); };
  const A = a, B = b;
  if (u <= 0 || u >= 1) { const c = u >= 1 ? B : A; fillHalf(c, y, h, 0); }
  else {
    fillHalf(B, y, hh, 0); fillHalf(A, m, hh, 0);                                           // new top, old bottom, resting
    if (u < 0.5) { const k = 1 - u * 2; fillHalf(A, m - hh * k, hh * k, 0.35 * (1 - k)); }  // old top folding down
    else { const k = (u - 0.5) * 2; fillHalf(B, m, hh * k, 0.35 * (1 - k)); }               // new bottom unfolding
  }
  if (seam) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(ix, m - 1, iw, 2); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(ix, m + 1, iw, 1); }
}

// The mark built of flap tiles.  t = seconds on the board's clock.  Tiles in the mark shuffle through colours and settle red; stripe k
// settles at times.stripes[k], the badge at times.badge.  surround: how much of the dark board shows around the mark (0..1).
const _mask = new Map();
function markMask(size, cell) {
  return cached(`mm${size}${cell}`, () => {
    const g0 = markBox(0, 0, size), cols = Math.ceil(EMBLEM.w * g0.sc * (MM.bbox.x1 - MM.bbox.x0) / EMBLEM.w / cell) + 4, rows = Math.ceil((MM.bbox.y1 - MM.bbox.y0) * g0.sc / cell) + 4;
    const c = cv(cols * cell, rows * cell), g = c.getContext('2d'); const bx = (MM.bbox.x0 + MM.bbox.x1) / 2, by = (MM.bbox.y0 + MM.bbox.y1) / 2;
    drawMark(g, c.width / 2 - (bx - EMBLEM.w / 2) * g0.sc, c.height / 2 - (by - EMBLEM.h / 2) * g0.sc, size, { color: '#fff' });
    const id = g.getImageData(0, 0, c.width, c.height), cov = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { let s = 0, n = 0; for (let y = 0; y < cell; y += 2) for (let x = 0; x < cell; x += 2) { s += id.data[((j * cell + y) * c.width + i * cell + x) * 4 + 3]; n++; } cov[j * cols + i] = s / n / 255; }
    return { cols, rows, cov, bx, by, g0 };
  });
}
export function flapMark(ctx, cx, cy, size, t, { cell = 17, times = {}, surround = 1, dark = '#150a0b', red = RED, seed = 7, flip = 0.07 } = {}) {
  // the vector mark stays crisp: tiles flip inside it (clipped to the mark), so the shape never goes to pixels
  const g0 = markBox(cx, cy, size), bb = g0.box, pad = cell * 2;
  const x0 = Math.floor((bb.x0 - pad) / cell) * cell, y0 = Math.floor((bb.y0 - pad) / cell) * cell;
  const cols = Math.ceil((bb.x1 + pad - x0) / cell), rows = Math.ceil((bb.y1 + pad - y0) / cell);
  const key = `fm${cols}x${rows}`, lay = cached(key, () => { const c = cv(cols * cell, rows * cell); return { c, cl: cv(cols * cell, rows * cell), mk: cv(cols * cell, rows * cell) }; });
  const g = lay.c.getContext('2d'); g.clearRect(0, 0, lay.c.width, lay.c.height);
  const r = rng(seed), sTimes = times.stripes || [0, 0, 0, 0], bT = times.badge ?? 0, palette = [dark, red, '#5a1014', '#e9dcc4', '#2a0d10'];
  const mk = markBox(cx - x0, cy - y0, size);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const rnd = r(), rnd2 = r(), rnd3 = r(), x = i * cell, y = j * cell, px = x + cell / 2, py = y + cell / 2;
    let inStripe = -1; for (let k = 0; k < 4; k++) if (px > mk.stripes[k].x0 && py >= mk.stripes[k].y0 - 4 && py <= mk.stripes[k].y1 + 4) inStripe = k;
    const when = inStripe >= 0 ? sTimes[inStripe] : bT, nflip = 3 + Math.floor(rnd2 * 4), start = when - nflip * flip - rnd * 0.08;
    let from, to, u = 0;
    if (t >= when + rnd * 0.05) { from = to = red; u = 1; }
    else if (t < start) { from = to = red; u = 0; }
    else { const q = (t - start) / flip, idx = Math.floor(q); u = q - idx; const seq = k => (k >= nflip - 1 ? red : palette[(Math.floor(rnd3 * 97) + k * 3) % palette.length]); from = idx === 0 ? red : seq(idx - 1); to = seq(idx); }
    flapTile(g, x, y, cell, cell, from, to, u, { gap: 1.6 });
  }
  const gc = lay.cl.getContext('2d'); gc.globalCompositeOperation = 'source-over'; gc.clearRect(0, 0, lay.cl.width, lay.cl.height); gc.drawImage(lay.c, 0, 0);
  const gm = lay.mk.getContext('2d'); gm.clearRect(0, 0, lay.mk.width, lay.mk.height); drawMark(gm, cx - x0, cy - y0, size, { color: '#fff' });
  gc.globalCompositeOperation = 'destination-in'; gc.drawImage(lay.mk, 0, 0); gc.globalCompositeOperation = 'source-over';
  // the dark board around the mark (tiles with seams), then the clipped red tiles on top
  if (surround > 0) {
    ctx.save(); ctx.globalAlpha = surround; ctx.fillStyle = dark; ctx.fillRect(x0, y0, cols * cell, rows * cell);
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; for (let j = 0; j <= rows; j++) ctx.fillRect(x0, y0 + j * cell - 1, cols * cell, 2);
    for (let i = 0; i <= cols; i++) ctx.fillRect(x0 + i * cell - 1, y0, 2, rows * cell);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let j = 0; j < rows; j++) ctx.fillRect(x0, y0 + j * cell + cell / 2 + 1, cols * cell, 1);
    ctx.restore();
  }
  ctx.drawImage(lay.cl, x0, y0);
  return { x0, y0, w: cols * cell, h: rows * cell };
}
// A word on letter flaps: each tile cycles through letters and settles.  cell = tile width.
export function flapWord(ctx, word, cx, cy, cell, t, { start = 0, stagger = 0.05, flip = 0.06, tile = '#17100f', col = '#ece3cf', font = 'Archivo Black', seed = 3 } = {}) {
  const r = rng(seed), n = word.length, h = cell * 1.4, x0 = cx - n * cell / 2, A = 'ACPUS.≡/ABCDEFGHIJKLMNOPRSTUVWXYZ';
  ctx.save(); ctx.font = `${cell * 1.0}px "${font}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const ch = word[i], x = x0 + i * cell, y = cy - h / 2, st = start + i * stagger, nf = 4 + Math.floor(r() * 4), q = (t - st) / flip;
    let u = 0, glyph = ch;
    if (t < st) { glyph = ' '; } else if (q < nf) { glyph = A[Math.floor(r() * 97 + Math.floor(q) * 7) % A.length]; u = q - Math.floor(q); } else { u = 1; }
    flapTile(ctx, x, y, cell, h, tile, tile, t < st ? 0 : u, { gap: 3 });
    if (t >= st && glyph !== ' ') {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 1.5, y, cell - 3, h); ctx.clip();
      const kf = (t - st) < nf * flip ? (Math.abs(Math.cos(Math.PI * clamp(q - Math.floor(q)))) * 0.9 + 0.1) : 1;          // the flap's apparent height while it turns
      ctx.translate(0, y + h / 2); ctx.scale(1, kf); ctx.fillStyle = col; ctx.fillText(glyph, x + cell / 2, 0); ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- four closers (each owns the whole frame from its lock)
// age = seconds since the lock (the lockup beat).  All draw the piece's own material; none is a black card.

// MELTDOWN: the formed red mark (the fist's bars burst into it) becomes split-flap tiles on the board; the lockup and ACP.US flip in.
// The mark is at (540, 960) 520 px, red, exactly where gearWorld leaves it, so the cut is picture into picture.
export function closerFlaps(ctx, age, { cx = 540, cy = 960, size = 520 } = {}) {
  ctx.fillStyle = '#0a0102'; ctx.fillRect(0, 0, W, H);
  const surround = smooth(0.05, 0.5, age);
  flapMark(ctx, cx, cy, size, age, { cell: 17, surround, times: { badge: 0.34, stripes: [0.12, 0.2, 0.28, 0.36] } });
  // the lockup as small cream flaps below, then ACP.US on letter flaps
  const a = smooth(0.35, 0.65, age);
  if (a > 0) { ctx.save(); ctx.globalAlpha = a; drawLockup(ctx, W / 2, 1330, 150, { color: '#ece3cf', accent: RED }); ctx.restore(); }
  flapWord(ctx, 'ACP.US', W / 2, 1530, 62, age, { start: 0.45, stagger: 0.06 });
}

// RED WEDGE: the last stamp.  Cream paper slaps onto the red poster, the mark lands in stamp ink; the red wedge is the "/" of /acc;
// ACP.US is typed.  age 0 = the downbeat's thud.
export function closerStamp(ctx, age, { ground = '#b01820', cx = 540, cy = 860 } = {}) {
  if (ground) { ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H); }
  const pw = 760, ph = 1000, k = Math.exp(-age * 14), slap = outBack(clamp(age / 0.14)), sc = lerp(1.12, 1, slap);
  const paper = paperCanvas(pw, ph, { seed: 11 });
  ctx.save(); ctx.translate(cx, cy + 40); ctx.rotate(-0.025); ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-pw / 2 + 8, -ph / 2 + 14, pw, ph); ctx.drawImage(paper, -pw / 2, -ph / 2); ctx.restore();
  const press = clamp(age / 0.05);
  ctx.save(); ctx.translate(cx, cy + 40); ctx.rotate(-0.025);
  // the lockup in ink: mark, ≡, wedge (for the slash), acc.  Part positions come from the traced lockup.
  const size = 190, b = lockupBox(0, -60, size);
  const ink = { color: INK, alpha: 0.94 * press };
  drawLockup(ctx, 0, -60, size, { color: INK, alpha: 0.0 });               // (layout only)
  ctx.globalCompositeOperation = 'multiply';
  inkStamp(ctx, 0, -240, 330, { color: INK, seed: 5, alpha: press });          // the emblem: four red stripes at full size
  // the wordmark, inked: reuse the lockup parts but inked through a mask canvas
  const lc = cached('rwlock', () => { const c = cv(1156 * 0.62 + 40, 190 + 40), g = c.getContext('2d'); drawLockup(g, c.width / 2, c.height / 2, 190, { color: INK, parts: { slash: 0 } });
    g.fillStyle = INK; const sx = c.width / 2 - 1156 * 190 / 291 / 2 + (520 + 119 / 2) * 190 / 291; g.save(); g.translate(sx, c.height / 2); g.transform(1, 0, -0.42, 1, 0, 0); g.beginPath(); g.moveTo(-9, 90); g.lineTo(11, 90); g.lineTo(7, -90); g.lineTo(-6, -90); g.fill(); g.restore();   // the wedge as "/"
    g.globalCompositeOperation = 'destination-out'; const r = rng(9); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; g.fillRect(r() * c.width, r() * c.height, 0.8 + r() * 2.6, 0.8 + r() * 2); } return c; });
  ctx.globalAlpha = press * smooth(0.03, 0.12, age); ctx.drawImage(lc, -lc.width / 2, 60); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = '48px "Plex Mono"'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(30,12,10,0.88)';
  const word = 'ACP.US', n = Math.floor(clamp((age - 0.12) / 0.05) * word.length);
  for (let i = 0; i < n; i++) ctx.fillText(word[i], -word.length * 22 + i * 44 + 22, 372 + (i % 2) * 1.2);
  ctx.restore();
  if (k > 0.02) { ctx.fillStyle = `rgba(255,240,220,${0.28 * k})`; ctx.fillRect(0, 0, W, H); }              // the thud's flash
}

// READY: the helmet's own decal.  A worn vinyl label (the hat's sticker, scaled up) drops onto the last frame, with the lockup printed
// on its lower strip in ink; no card, no RGB split.  `over` (optional) darkens the frame under it.
export function closerDecal(ctx, age, { cx = 540, cy = 900, w = 700, h = 880, dim = 0.55 } = {}) {
  const a = outExpo(clamp(age / 0.2)), drop = outBack(clamp(age / 0.22)), sc = lerp(1.35, 1, drop);
  ctx.save(); ctx.fillStyle = `rgba(6,10,24,${dim * a})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  const label = cached(`rdy${w}${h}`, () => {
    const c = decalCanvas(w, h, { seed: 8, mark: false, wear: 1 }), L = cv(c.width, c.height), g = L.getContext('2d');
    g.drawImage(c, 0, 0);
    g.save(); g.translate(12, 12); g.beginPath(); g.roundRect(0, 0, w, h, 22); g.clip();
    drawMark(g, w / 2, h * 0.34, 380, { color: RED });
    drawLockup(g, w / 2, h * 0.78, 128, { color: '#1b1a1c', accent: RED });
    g.fillStyle = '#1b1a1c'; g.font = '700 46px "Archivo Black"'; g.textAlign = 'center'; g.fillText('ACP.US', w / 2, h * 0.93);
    g.globalCompositeOperation = 'destination-out'; const r = rng(14); g.fillStyle = 'rgba(0,0,0,0.8)'; for (let i = 0; i < 160; i++) g.fillRect(r() * w, r() * h, 0.8 + r() * 1.8, 0.8 + r() * 1.8);
    g.restore(); return L;
  });
  ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.rotate(-0.04 + 0.03 * (1 - drop)); ctx.scale(sc, sc);
  ctx.drawImage(label, -label.width / 2, -label.height / 2); ctx.restore();
}

// GIANT: the beam.  A primed steel I-beam hangs across the sky, the lockup is sprayed through a stencil on its web (the mark red on
// grey primer), then the beam rises toward the sun.  `under` = the frame beneath (already drawn); age 0 = the lock.
export function closerBeam(ctx, age, { cy = 930 } = {}) {
  const rise = smooth(0.9, 1.4, age) * 260, sway = Math.sin(age * 5) * 0.012 * Math.exp(-age * 2.5);
  const bh = 520, y = cy - rise, a = outExpo(clamp(age / 0.25));
  ctx.save(); ctx.fillStyle = `rgba(30,6,6,${0.55 * a})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save(); ctx.translate(W / 2, y); ctx.rotate(sway); ctx.translate(0, (1 - a) * -400);
  const web = bh * 0.62;
  // flanges and web
  const grd = (y0, y1, c0, c1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
  ctx.fillStyle = grd(-bh / 2, -web / 2, '#8b9096', '#5c6168'); ctx.fillRect(-W / 2 - 40, -bh / 2, W + 80, bh * 0.19);
  ctx.fillStyle = grd(web / 2, bh / 2, '#4a4f55', '#2f3338'); ctx.fillRect(-W / 2 - 40, web / 2, W + 80, bh * 0.19);
  ctx.fillStyle = grd(-web / 2, web / 2, '#767b81', '#585d63'); ctx.fillRect(-W / 2 - 40, -web / 2, W + 80, web);
  const r = rng(21); ctx.fillStyle = 'rgba(30,20,16,0.18)'; for (let i = 0; i < 700; i++) ctx.fillRect(-W / 2 + r() * W, -bh / 2 + r() * bh, 1 + r() * 3, 1 + r() * 2);   // mill scale
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (const yy of [-bh / 2 + 30, bh / 2 - 30]) for (let x = -W / 2 + 40; x < W / 2; x += 90) { ctx.beginPath(); ctx.arc(x, yy, 7, 0, 6.3); ctx.fill(); }   // rivet heads
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (const yy of [-bh / 2 + 24, bh / 2 - 36]) for (let x = -W / 2 + 38; x < W / 2; x += 90) { ctx.beginPath(); ctx.arc(x - 2, yy - 2, 3, 0, 6.3); ctx.fill(); }
  // sprayed mark: the stencil, revealed by a wipe (the can passing left to right)
  const reveal = clamp((age - 0.1) / 0.4), sp = sprayCanvas(300, { color: RED, seed: 4 });
  ctx.save(); ctx.beginPath(); ctx.rect(-W / 2, -web / 2, W * reveal * 0.6, web); ctx.clip();
  ctx.drawImage(sp, -sp.width / 2 - 215, -sp.height / 2 + 2);
  ctx.restore();
  const wm = cached('beamword', () => { const c = cv(760, 150), g = c.getContext('2d'); drawLockup(g, 380, 75, 120, { color: '#d7cfc0', accent: RED }); g.globalCompositeOperation = 'destination-out'; const rr = rng(33); for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + rr() * 0.6})`; g.fillRect(rr() * 760, rr() * 150, 0.8 + rr() * 2, 0.8 + rr() * 2); } return c; });
  ctx.save(); ctx.beginPath(); ctx.rect(-60, -web / 2, 600 * clamp((age - 0.3) / 0.4), web); ctx.clip(); ctx.drawImage(wm, -100, -wm.height / 2 - 2); ctx.restore();
  ctx.restore();
}

export const CLOSERS = { flaps: closerFlaps, stamp: closerStamp, decal: closerDecal, beam: closerBeam };
