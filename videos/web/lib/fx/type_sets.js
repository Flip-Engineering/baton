// TYPE SETS: the set pieces and the beat choreography that make kinetic type look finished.
// Lifted out of scenes/lab_type.js so bank, intelligence, ownfuture, red_wedge (and the rest) can
// reuse them. Every piece takes an options object and a seed and is deterministic in its inputs.
//
//   import { seq, guilloche, drawingBoard, construction, printerMarks, debris, shockRing, sparks,
//            paperStock, inkPattern, printGrain, diagonalGrid, wedge, scanlines } from '../lib/fx/type_sets.js';
//
// seq() is the beat layer: it turns hits.json beats into per-word age / tau / impact / tf / readable,
// so scenes stop re-deriving (a - start) * B.spb by hand.
import { W, H, C, clamp, lerp, ease, rng, line } from '../kit.js';
import { readable, canvas2d } from './type.js';

// ================================================================ choreography
// seq(words, B, o) -> S
//   words   Word[] (from shape/shapeLines)
//   B       kit Beats (loadBeats)
//   o.start beat where this block starts (absolute)
//   o.onBeat  [b0, b1, ...]  beats relative to start, one per word
//           | number         step: word i lands at i * step
//           | 'kick'/'snare'/any hit name: word i lands on the (i * every)-th such hit at/after start
//   o.every   hits to skip between words for a hit-name onBeat (default 1)
//   o.hold    beats each word holds before its out point (null: until o.end)
//   o.end     beats (relative to start) the block lasts (default: last onBeat + 2)
//   o.effect  (age, i, cue) => tf         the per-word transform (springs, slam, timed(...))
//   o.read    (cue) => 0..1               custom legibility (Shatter.readable, drawOn progress, 3D)
//   o.lead    s the word's clock starts before its beat (slam: lead = fall, so the landing hits the beat)
//   o.land    s of word clock when the word is 'down' (impact starts), default = lead
//   o.rate    impact decay per s (default 10)
// S.at(t) -> [{ word, i, beat, t0, age, tau, u, impact, live, tf }]
//   age: s since the word's beat (<0 = not yet); tau: s since its out point (<0 = still holding);
//   u: age / hold in 0..1; impact: exp(-rate * (age - land)) once landed, else 0; live: started, not yet out, block begun.
// S.readable(t) -> max legibility over live words (0 if none); S.impact(t) -> max impact.
export function seq(words, B, o = {}) {
  const { start = 0, onBeat = 1, every = 1, hold = null, effect = null, read = null, lead = 0, rate = 10 } = o, land = o.land ?? lead;
  const spb = B.spb;
  let beats;
  if (Array.isArray(onBeat)) beats = onBeat.map(b => start + b);
  else if (typeof onBeat === 'number') beats = words.map((_, i) => start + i * onBeat);
  else {
    const hs = (B.hits && B.hits[onBeat]) || [], t0 = start * spb - 1e-3;
    const after = hs.filter(h => h >= t0);
    beats = words.map((_, i) => (after[i * every] ?? (t0 + i * spb)) / spb);
  }
  const end = start + (o.end ?? (Math.max(...beats) - start + 2));
  const S = {
    words, beats, start, end,
    at(t) {
      const beat = t / spb;
      return words.map((word, i) => {
        const t0 = beats[i] * spb - lead, age = t - t0;
        const outB = hold == null ? end : Math.min(end, beats[i] + hold);
        const tau = t - outB * spb;
        const cue = { word, i, beat: beats[i], t0, age, tau, u: clamp(age / ((outB - beats[i]) * spb + lead)), live: age >= 0 && tau < 0 && beat >= start,
          impact: age >= land ? Math.exp(-(age - land) * rate) : 0 };
        cue.tf = effect && age >= 0 ? effect(age, i, cue) : null;
        return cue;
      });
    },
    readable(t, cues = S.at(t)) {
      let best = 0;
      for (const c of cues) if (c.live) best = Math.max(best, read ? read(c) : c.tf ? readable(c.word, c.tf) : 1);
      return best;
    },
    impact(t) { return S.at(t).reduce((m, c) => Math.max(m, c.impact), 0); },
  };
  return S;
}

// ================================================================ materials
// Paper stock: base colour + per-pixel tooth + fibres + a warm edge burn. Returns a canvas (bake once).
export function paperStock({ w = W, h = H, seed = 21, base = [241, 228, 205], tooth = 14, fibres = 2200, burn = 0.28 } = {}) {
  const L = canvas2d(w, h), g = L.g, id = g.createImageData(w, h), r = rng(seed);
  for (let i = 0; i < w * h; i++) { const v = (r() - 0.5) * tooth; id.data[i * 4] = base[0] + v; id.data[i * 4 + 1] = base[1] + v; id.data[i * 4 + 2] = base[2] + v; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  for (let k = 0; k < fibres; k++) {
    g.strokeStyle = `rgba(${r() < 0.5 ? '120,90,60' : '255,255,245'},${0.05 + r() * 0.08})`; g.lineWidth = 0.6 + r();
    const x = r() * w, y = r() * h, a = r() * 7, l = 6 + r() * 30;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.4, x + Math.cos(a + 0.4) * l * 1.6, y + Math.sin(a + 0.4) * l); g.stroke();
  }
  if (burn) { const v = g.createRadialGradient(w * 0.42, h * 0.46, 400, w / 2, h / 2, 1300); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(90,50,20,${burn})`); g.fillStyle = v; g.fillRect(0, 0, w, h); }
  g.getImageData(0, 0, 1, 1);
  return L.cv;
}
// Speckled ink as a repeating pattern (for look.letterpress / look.inkSpread / plates).
export function inkPattern(ctx, { seed = 5, color = '#b3141f', size = 256, n = 1400, light = '240,200,180', dark = '60,0,5' } = {}) {
  const L = canvas2d(size, size), g = L.g, r = rng(seed);
  g.fillStyle = color; g.fillRect(0, 0, size, size);
  for (let k = 0; k < n; k++) { g.fillStyle = r() < 0.6 ? `rgba(${light},${r() * 0.28})` : `rgba(${dark},${r() * 0.3})`; g.beginPath(); g.arc(r() * size, r() * size, 0.5 + r() * 1.8, 0, 7); g.fill(); }
  return ctx.createPattern(L.cv, 'repeat');
}
// Print grain overlay for a whole frame: 'paper' (fibres + tooth, multiply), 'ink' (mottled solid ink,
// soft-light), 'halftone' (rotated dot screen, multiply). Tiles are baked once per kind+seed; one fillRect per call.
const grainTiles = new Map();
function grainTile(kind, seed) {
  const key = kind + seed; if (grainTiles.has(key)) return grainTiles.get(key);
  const S = 256, L = canvas2d(S, S), g = L.g, r = rng(seed);
  if (kind === 'halftone') {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#000';
    for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { g.beginPath(); g.arc(x + 4, y + 4, 1.1 + r() * 0.6, 0, 7); g.fill(); }
  } else {
    const id = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = kind === 'ink' ? 128 + (r() - 0.5) * 70 : 235 + (r() - 0.5) * 40; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
    for (let k = 0; k < (kind === 'ink' ? 90 : 160); k++) {
      g.strokeStyle = kind === 'ink' ? `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 + r() * 0.12})` : `rgba(90,70,50,${0.1 + r() * 0.15})`;
      g.lineWidth = 0.6 + r() * 1.4; const x = r() * S, y = r() * S, a = r() * 7, l = 5 + r() * 26;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.4, x + Math.cos(a + 0.5) * l * 1.5, y + Math.sin(a + 0.5) * l); g.stroke();
    }
  }
  const e = { cv: L.cv }; grainTiles.set(key, e); return e;
}
export function printGrain(ctx, { kind = 'paper', alpha = 0.5, seed = 1, frame = 0, drift = true, angle = 0 } = {}) {
  const tl = grainTile(kind, seed);
  if (!tl.pat) tl.pat = ctx.createPattern(tl.cv, 'repeat');
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = kind === 'ink' ? 'soft-light' : 'multiply';
  ctx.fillStyle = tl.pat;
  ctx.translate(drift ? (frame * 53) % 256 : 0, drift ? (frame * 29) % 256 : 0); if (angle) ctx.rotate(angle);
  ctx.fillRect(-512, -512, W + 1024, H + 1024); ctx.restore();
}
// Scanline pattern (screen-space), one fillRect
const scanPats = new Map();
export function scanlines(ctx, { color = 'rgba(201,31,55,0.10)', period = 6, th = 2 } = {}) {
  const key = color + period + th;
  if (!scanPats.has(key)) { const L = canvas2d(4, period); L.g.fillStyle = color; L.g.fillRect(0, 0, 4, th); scanPats.set(key, ctx.createPattern(L.cv, 'repeat')); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = scanPats.get(key); ctx.fillRect(0, 0, W, H); ctx.restore();
}

// ================================================================ staging grammars
// Constructivist diagonal grid: parallel rules at `angle` (and optionally its perpendicular), major every `major`.
export function diagonalGrid(ctx, { angle = -0.35, gap = 60, major = 5, color = 'rgba(244,230,208,0.07)', majorColor = 'rgba(201,31,55,0.3)', cross = true, lw = 1, ox = 0 } = {}) {
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(angle);
  const R = Math.hypot(W, H) / 2 + gap;
  for (const pass of cross ? [0, 1] : [0]) {
    if (pass) ctx.rotate(Math.PI / 2);
    for (let k = -Math.ceil(R / gap); k <= Math.ceil(R / gap); k++) {
      const x = k * gap + (ox % gap); ctx.strokeStyle = k % major ? color : majorColor; ctx.lineWidth = k % major ? lw : lw * 2;
      ctx.beginPath(); ctx.moveTo(x, -R); ctx.lineTo(x, R); ctx.stroke();
    }
  }
  ctx.restore();
}
// Hard wedge/band: a quad across the frame from edge to edge at `angle`, thickness th, through (cx, cy).
export function wedge(ctx, { cx = W / 2, cy = H / 2, angle = -0.35, th = 300, taper = 0, fill = C.red2, len = 2600 } = {}) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(-len / 2, -th / 2); ctx.lineTo(len / 2, -th / 2 * (1 - taper)); ctx.lineTo(len / 2, th / 2 * (1 - taper)); ctx.lineTo(-len / 2, th / 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}
export function wedgePath({ cx = W / 2, cy = H / 2, angle = -0.35, th = 300, taper = 0, len = 2600 } = {}) {
  const p = new Path2D(), c = Math.cos(angle), s = Math.sin(angle);
  const pt = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  [[-len / 2, -th / 2], [len / 2, -th / 2 * (1 - taper)], [len / 2, th / 2 * (1 - taper)], [-len / 2, th / 2]].forEach(([x, y], k) => { const [X, Y] = pt(x, y); k ? p.lineTo(X, Y) : p.moveTo(X, Y); });
  p.closePath(); return p;
}

// ================================================================ set pieces
// Guilloche banknote plate: rosettes (rose curves), wavy borders, microtext, serial. Returns a canvas.
// o.rosettes: [{ x, y, R, r0, k1, k2, n, color, lw }], defaults are off-centre (a rosette hard-cropped at the right).
export function guilloche({ w = W, h = H, seed = 1, bg = '#0c0203', rosettes = null, border = true, text = 'THIS NOTE IS LEGAL TENDER FOR ALL DEBTS, PUBLIC AND PRIVATE', serial = 'NO. 000 000 001', micro = 14, angle = 0 } = {}) {
  const L = canvas2d(w, h), g = L.g, r = rng(seed);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.save(); g.translate(w / 2, h / 2); g.rotate(angle); g.translate(-w / 2, -h / 2);
  const rose = ({ x, y, R, r0, k1, k2, n, color, lw = 1 }) => {
    g.strokeStyle = color; g.lineWidth = lw;
    for (let j = 0; j < n; j++) {
      g.beginPath(); const ph = j / n * Math.PI * 2;
      for (let i = 0; i <= 900; i++) { const a = i / 900 * Math.PI * 2; const rr = r0 + (R - r0) * (0.5 + 0.5 * Math.sin(a * k1 + ph)) * (0.8 + 0.2 * Math.cos(a * k2 - ph * 2));
        const X = x + Math.cos(a) * rr, Y = y + Math.sin(a) * rr; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
    }
  };
  (rosettes || [
    { x: w * 0.88, y: h * 0.7, R: 760, r0: 460, k1: 18, k2: 5, n: 44, color: 'rgba(201,31,55,0.34)', lw: 1.1 },
    { x: w * 0.88, y: h * 0.7, R: 430, r0: 180, k1: 12, k2: 3, n: 36, color: 'rgba(244,230,208,0.15)' },
    { x: w * 0.1, y: h * 0.12, R: 300, r0: 170, k1: 24, k2: 4, n: 26, color: 'rgba(244,230,208,0.12)' },
  ]).forEach(rose);
  // micro-text bands (engraved lines of repeated text)
  for (let k = 0; k < micro; k++) {
    const y = h * 0.2 + k * 11;
    line(g, (text + ' · ').repeat(4), -r() * 400, y, { family: 'Plex Mono', size: 9, align: 'left', color: 'rgba(244,230,208,0.13)', maxW: 9e3 });
  }
  if (border) for (let j = 0; j < 14; j++) {
    g.strokeStyle = j % 2 ? 'rgba(201,31,55,0.3)' : 'rgba(244,230,208,0.12)'; g.lineWidth = 1;
    for (const side of [0, 1]) { g.beginPath();
      for (let y = 0; y <= h; y += 4) { const x0 = side ? w - 46 - j * 3 : 46 + j * 3, X = x0 + Math.sin(y * 0.05 + j * 0.6) * 12; y ? g.lineTo(X, y) : g.moveTo(X, y); }
      g.stroke(); }
  }
  g.restore();
  if (text) line(g, text, w / 2, 170, { family: 'Plex Mono', size: 22, color: 'rgba(244,230,208,0.4)' });
  if (serial) line(g, serial, w - 90, h - 140, { family: 'Plex Mono', size: 34, align: 'right', color: 'rgba(201,31,55,0.85)' });
  g.getImageData(0, 0, 1, 1);
  return L.cv;
}

// Type-designer drawing board: fine grid with majors, an off-axis drafting-lamp pool, a set square,
// title block and header. o.lamp {x, y, r}: the light pool (never centred by default).
const boards = new Map();
export function drawingBoard(ctx, { beat = 0, pulse = 0, face = 'BIG SHOULDERS 900', sheet = 'SHEET 01 / 08', header = 'SPECIMEN · DRAWING OFFICE', bg = '#120304',
  lamp = { x: W * 0.18, y: H * 0.12, r: 1500 }, grid = 30, major = 150, square = true } = {}) {
  // the static board (stock, lamp pool, ~130 grid rules, set square, title block) is baked once per option set
  const key = JSON.stringify([bg, lamp, grid, major, square]);
  if (!boards.has(key)) {
    const L = canvas2d(), g = L.g;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const gr = g.createRadialGradient(lamp.x, lamp.y, 60, lamp.x, lamp.y, lamp.r);
    gr.addColorStop(0, 'rgba(150,20,28,0.6)'); gr.addColorStop(0.5, 'rgba(90,8,14,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += grid) { g.strokeStyle = x % major ? 'rgba(244,230,208,0.045)' : 'rgba(244,230,208,0.12)'; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y <= H; y += grid) { g.strokeStyle = y % major ? 'rgba(244,230,208,0.045)' : 'rgba(244,230,208,0.12)'; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    if (square) {   // 30/60 set square, hard-cropped at the right edge
      g.save(); g.translate(W + 120, H * 0.62); g.rotate(-0.52);
      const p = new Path2D(); p.moveTo(0, 0); p.lineTo(-900, 0); p.lineTo(0, -520); p.closePath();
      const q = new Path2D(); q.moveTo(-120, -40); q.lineTo(-640, -40); q.lineTo(-120, -340); q.closePath();
      g.fillStyle = 'rgba(201,31,55,0.10)'; g.fill(p); g.fillStyle = bg; g.globalAlpha = 0.6; g.fill(q); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(244,230,208,0.35)'; g.lineWidth = 2; g.stroke(p); g.stroke(q);
      for (let k = 0; k <= 60; k++) { g.beginPath(); g.moveTo(-k * 15, 0); g.lineTo(-k * 15, k % 5 ? -10 : -22); g.stroke(); }
      g.restore();
    }
    g.strokeStyle = 'rgba(244,230,208,0.5)'; g.lineWidth = 2; g.strokeRect(40, H - 250, 440, 190);
    g.getImageData(0, 0, 1, 1); boards.set(key, L.cv);
  }
  ctx.drawImage(boards.get(key), 0, 0);
  for (const [i, s] of [sheet, `FACE  ${face}`, `BEAT  ${beat.toFixed(2)}`, 'SCALE 1:1  PX'].entries())
    line(ctx, s, 60, H - 205 + i * 42, { family: 'Plex Mono', size: 26, align: 'left', color: 'rgba(244,230,208,0.7)' });
  line(ctx, header, W - 50, 90, { family: 'Plex Mono', size: 26, align: 'right', color: `rgba(244,230,208,${0.5 + 0.4 * pulse})` });
}

// Construction overlay for a word: guide lines, cap-height dimension, glyph boxes, bézier handles, U+ codes.
// cache (default true): the overlay is static per word, so it is baked once into a full-frame sprite and
// drawn with alpha (one drawImage instead of ~1000 path ops for a 10-glyph word).
const constrCache = new WeakMap();
export function construction(ctx, w, o = {}) {
  const { alpha = 1, cache = true } = o;
  if (alpha <= 0) return;
  if (cache) {
    let m = constrCache.get(w); if (!m) constrCache.set(w, m = new Map());
    const key = JSON.stringify({ ...o, alpha: 1 });
    if (!m.has(key)) { const L = canvas2d(); constructionDraw(L.g, w, { ...o, alpha: 1 }); L.g.getImageData(0, 0, 1, 1); m.set(key, L.cv); }
    const y1 = Math.max(0, Math.floor(w.bbox.y1 - 60)), y2 = Math.min(H, Math.ceil(w.bbox.y2 + 60));   // only the band it occupies
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(m.get(key), 0, y1, W, y2 - y1, 0, y1, W, y2 - y1); ctx.restore();
    return;
  }
  constructionDraw(ctx, w, o);
}
function constructionDraw(ctx, w, { alpha = 1, label = '', guides = 'rgba(201,31,55,0.8)', ink = 'rgba(244,230,208,0.8)', handles = true, codes = true, boxes = true } = {}) {
  ctx.save(); ctx.globalAlpha *= alpha;
  const { y1, y2 } = w.bbox;
  ctx.strokeStyle = guides; ctx.lineWidth = 1.5; ctx.setLineDash([10, 8]);
  for (const y of [y1, y2]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(26, y1); ctx.lineTo(26, y2); ctx.moveTo(16, y1); ctx.lineTo(36, y1); ctx.moveTo(16, y2); ctx.lineTo(36, y2); ctx.stroke();
  line(ctx, `${Math.round(y2 - y1)}`, 44, (y1 + y2) / 2 + 9, { family: 'Plex Mono', size: 24, align: 'left', color: ink });
  if (label) line(ctx, label, W - 30, y1 - 12, { family: 'Plex Mono', size: 22, align: 'right', color: guides });
  for (const gl of w.glyphs) {
    ctx.save(); ctx.translate(gl.ox, gl.oy);
    if (boxes) { ctx.strokeStyle = 'rgba(244,230,208,0.28)'; ctx.setLineDash([4, 6]); ctx.strokeRect(gl.bb.x1, gl.bb.y1, gl.bb.w, gl.bb.h); ctx.setLineDash([]); }
    if (handles) {
      let px = 0, py = 0;
      const hp = new Path2D(), dots = new Path2D(), nodes = new Path2D();
      for (const c of gl.cmds) {
        if (c.type === 'Q' || c.type === 'C') {
          hp.moveTo(px, py); hp.lineTo(c.x1, c.y1); if (c.type === 'C') hp.moveTo(c.x2, c.y2); hp.lineTo(c.x, c.y);
          dots.moveTo(c.x1 + 3.5, c.y1); dots.arc(c.x1, c.y1, 3.5, 0, 7); if (c.type === 'C') { dots.moveTo(c.x2 + 3.5, c.y2); dots.arc(c.x2, c.y2, 3.5, 0, 7); }
        }
        if (c.x !== undefined) { nodes.rect(c.x - 3.5, c.y - 3.5, 7, 7); px = c.x; py = c.y; }
      }
      ctx.strokeStyle = 'rgba(201,31,55,0.7)'; ctx.lineWidth = 1; ctx.stroke(hp);
      ctx.fillStyle = '#ff5a4a'; ctx.fill(dots); ctx.fillStyle = C.cream; ctx.fill(nodes);
    }
    if (codes) line(ctx, `U+${gl.ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`, 0, gl.bb.y2 + 30, { family: 'Plex Mono', size: 18, color: 'rgba(244,230,208,0.55)' });
    ctx.restore();
  }
  ctx.restore();
}

// Printer's furniture: crop marks, registration targets, colour bars, slug line.
export function printerMarks(ctx, { color = '#1a0a0a', inset = 60, top = 120, bars = ['#BD1818', '#C91F37', '#0B0B0B', '#F4E6D0', '#7a1010', '#3A3434'],
  slug = 'AMERICAN COMMUNIST PARTY · PRESS RUN 01 · SHEET 5/8', reg = [[W / 2, 70], [W / 2, H - 70]], slugColor = 'rgba(30,10,10,0.7)' } = {}) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  for (const [x, y, sx, sy] of [[inset, top, 1, 1], [W - inset, top, -1, 1], [inset, H - top, 1, -1], [W - inset, H - top, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x - 50 * sx, y); ctx.lineTo(x - 10 * sx, y); ctx.moveTo(x, y - 50 * sy); ctx.lineTo(x, y - 10 * sy); ctx.stroke(); }
  for (const [x, y] of reg) { ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.moveTo(x - 30, y); ctx.lineTo(x + 30, y); ctx.moveTo(x, y - 30); ctx.lineTo(x, y + 30); ctx.stroke(); }
  bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(W - 330 + i * 44, H - 96, 40, 30); });
  if (slug) line(ctx, slug, 120, H - 72, { family: 'Plex Mono', size: 20, align: 'left', color: slugColor });
  ctx.restore();
}

// Landing debris: chips thrown up from each glyph's baseline, ballistic, fading over `life` s.
export function debris(ctx, w, landAge, { seed = 1, n = 7, colors = ['#f4e6d0', '#f4e6d0', '#ff6a3a'], gravity = 1400, life = 1.1, vx = 900, vy = [300, 1000], size = [4, 16] } = {}) {
  if (landAge < 0 || landAge > life) return;
  const r = rng(seed), tt = landAge;
  ctx.save();
  for (const gl of w.glyphs) for (let k = 0; k < n; k++) {
    const ux = (r() - 0.5) * vx, uy = -lerp(vy[0], vy[1], r()), s = lerp(size[0], size[1], r()), rot = r() * 6, ox = (r() - 0.5) * gl.bb.w;
    const x = gl.ox + ox + ux * tt, y = gl.oy + gl.bb.y2 + uy * tt + 0.5 * gravity * tt * tt;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot + tt * 9); ctx.globalAlpha = clamp(1 - tt / life);
    ctx.fillStyle = colors[k % colors.length]; ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.restore();
  }
  ctx.restore();
}

// Shock ring: a flattened ellipse expanding from an impact point. rot tilts it with the staging grammar.
export function shockRing(ctx, x, y, age, { max = 900, color = '244,230,208', w = 18, life = 0.6, squash = 0.32, rot = 0 } = {}) {
  if (age < 0 || age > life) return;
  const u = ease.outCubic(age / life);
  ctx.save(); ctx.strokeStyle = `rgba(${color},${(1 - u) * 0.8})`; ctx.lineWidth = w * (1 - u) + 1;
  ctx.beginPath(); ctx.ellipse(x, y, max * u, max * u * squash, rot, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}

// Sparks off pen tips / impacts: short additive streaks, reseeded per frame.
export function sparks(ctx, pts, { seed = 0, n = 5, len = 38, color = '255,190,120', fall = 0.3 } = {}) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  pts.forEach((p, k) => {
    const r = rng(seed * 977 + k * 31);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, l = len * (0.3 + r()), d = r() * 14;
      ctx.strokeStyle = `rgba(${color},${0.35 + r() * 0.6})`; ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); ctx.lineTo(p.x + Math.cos(a) * (d + l), p.y + Math.sin(a) * (d + l) + l * fall); ctx.stroke();
    }
  });
  ctx.restore();
}

// Per-glyph reveal progress of drawOn (same maths), for legibility: fraction of glyphs whose outline is >= at.
export function drawOnReadable(word, u, { overlap = 0.55, at = 0.8 } = {}) {
  const n = word.glyphs.length, span = 1 / (1 + (n - 1) * (1 - overlap));
  let ok = 0; for (const g of word.glyphs) if (clamp((u - g.i * span * (1 - overlap)) / span) >= at) ok++;
  return ok / n;
}

// Halftone ramp: a printed dot screen whose dots grow along the ramp (0 at the top edge -> full at the bottom).
// Bake once, draw as a plate (a print texture that fills empty stock or empty black without murk).
export function halftoneRamp({ w = W, h = 600, color = '#b3141f', cell = 14, angle = 0.26, seed = 1, max = 0.62, jitter = 0.08 } = {}) {
  const L = canvas2d(w, h), g = L.g, r = rng(seed);
  g.fillStyle = color; g.translate(w / 2, h / 2); g.rotate(angle);
  const R = Math.hypot(w, h) / 2 + cell;
  for (let y = -R; y < R; y += cell) for (let x = -R; x < R; x += cell) {
    const wy = x * Math.sin(angle) + y * Math.cos(angle) + h / 2;          // world y of this dot
    const u = clamp(wy / h + (r() - 0.5) * jitter);
    const rad = cell * max * Math.pow(u, 1.4);
    if (rad < 0.4) continue;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  g.getImageData(0, 0, 1, 1);
  return L.cv;
}

// ---------------------------------------------------------------- finish plate (cheap kit Finish)
// kit Finish.apply = a full-frame vignette drawImage + a full-frame 'overlay' grain pattern fill (the overlay blend
// is the slow part on a software canvas). finishPlate bakes vignette + signed grain (white/black specks at alpha
// |v-128|/128 * grain * k) into `frames` full-frame plates per (grain, vignette) pair, so a frame costs ONE
// source-over drawImage. Grain cycles every `frames` frames (3 = 10 Hz at 30 fps, reads as film grain).
// Plates bake lazily; prewarm them with plate.warm([[grain, vignette], ...]). Memory: W*H*4 bytes per plate.
export function finishPlate({ seed = 11, frames = 3, k = 0.7 } = {}) {
  const cache = new Map();
  const bake = (grain, vignette) => {
    const key = grain + '|' + vignette; if (cache.has(key)) return cache.get(key);
    const r = rng(seed * 31 + Math.round(grain * 1000)), plates = [];
    for (let f = 0; f < frames; f++) {
      const P = canvas2d(), g = P.g;
      const T = canvas2d(256, 256), id = T.g.createImageData(256, 256), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (r() - 0.5) * 2; const c = v > 0 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = Math.round(Math.abs(v) * grain * k * 255);
      }
      T.g.putImageData(id, 0, 0);
      if (vignette) {
        const grd = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${0.65 * vignette})`);
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
      }
      if (grain) { g.save(); g.translate((f * 97) % 256, (f * 53) % 256); g.fillStyle = g.createPattern(T.cv, 'repeat'); g.fillRect(-256, -256, W + 512, H + 512); g.restore(); }
      plates.push(P.cv);
    }
    cache.set(key, plates); return plates;
  };
  return {
    apply(ctx, frame, { grain = 0.07, vignette = 1, flash = 0 } = {}) {
      const plates = bake(grain, vignette);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(plates[((frame % frames) + frames) % frames], 0, 0);
      if (flash > 0) { ctx.fillStyle = `rgba(244,230,208,${clamp(flash)})`; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    },
    warm(pairs) { for (const [gr, v] of pairs) bake(gr, v).forEach(p => p.getContext('2d').getImageData(0, 0, 1, 1)); },
  };
}
