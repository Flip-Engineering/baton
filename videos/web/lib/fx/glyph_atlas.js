// glyph_atlas.js: shared glyph-sheet renderer (TOOLING c4, 2026-09-28). Draw any number of letters, digits, flap
// tiles, stencil cells, ticker characters or icon cells from a few large sheets instead of one canvas per glyph.
//
// Why: MELTDOWN v11 cached a canvas per letter (thousands live). In a long headless render Chromium dropped their
// backing stores and whole tiles came out black: a black frame 0, "THANK YO" missing. Stills never showed it, because
// a still never makes enough canvases. tools/canvas_census.mjs finds the pattern in any scene before a full render.
//
//   import { glyphAtlas, paintText, paintFlap, atlasStats } from '../lib/fx/glyph_atlas.js';
//   const A = glyphAtlas({ w: 96, h: 210, key: 'cream', paint: paintFlap({ bg0: '#f6ead3', bg1: '#e4d5b8', fg: '#140c0c' }) });
//   A.draw(g, 'M', x, y);                        // the whole cell at its own size (or A.draw(g, ch, x, y, dw, dh))
//   A.draw(g, 'M', x, y, w, h / 2, { v0: 0, v1: 0.5 });   // part of a cell (a flap's top leaf)
//   A.text(g, 'THANK YOU,', cx, cy, { align: 'center', gap: 8 });   // a row of cells
//   const { img, sx, sy, w, h } = A.get('M');    // raw slot, for your own drawImage / WebGL upload
//
// One atlas per (cell size, key). The same call with the same size and key returns the same atlas, so a scene can call
// glyphAtlas() inside its draw loop. Keep the number of distinct sizes small: pass quant (px) to round a cell size that
// animates (a zoom) up to a step, and draw it scaled; every distinct size is a new atlas.
//
// Limits: a sheet is at most SHEET px square (2048); an atlas grows to maxSheets sheets (default 4), then recycles
// its oldest sheet (its glyphs repaint on demand). All atlases together keep at most MAX_SHEETS sheets (64); past
// that the least recently used atlas is dropped. atlasStats() reports sheets, glyphs, paints and evictions;
// window.__glyphAtlas exposes it to tools/canvas_census.mjs.

const SHEET = 2048, MAX_SHEETS = 64;
const REG = new Map();                 // `${w}x${h}|${key}` -> Atlas
let clock = 0, sheetsLive = 0;
const STATS = { atlases: 0, sheetsMade: 0, paints: 0, evictedSheets: 0, evictedAtlases: 0 };

function mkSheet(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' && !globalThis.__ATLAS_DOM ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  sheetsLive++; STATS.sheetsMade++;
  return { c, g: c.getContext('2d'), used: 0 };
}

class Atlas {
  constructor({ w, h, key = '', paint, pad = 1, maxSheets = 4 }) {
    this.w = w; this.h = h; this.key = key; this.paint = paint; this.pad = pad;
    this.cw = w + 2 * pad; this.ch = h + 2 * pad;
    this.cols = Math.max(1, Math.min(16, Math.floor(SHEET / this.cw))); this.rows = Math.max(1, Math.floor(SHEET / this.ch));
    this.per = this.cols * this.rows; this.maxSheets = maxSheets;
    this.sheets = []; this.map = new Map(); this.next = 0; this.used = clock;
  }
  _slot() {                                                         // -> [sheetIndex, cell]
    const n = this.next++, si = Math.floor(n / this.per) % this.maxSheets, cell = n % this.per;
    if (!this.sheets[si]) {
      if (sheetsLive >= MAX_SHEETS) evictLRU(this);
      // a sheet only as tall as it needs to be: grows by re-allocating when rows fill (cheap: few times per atlas)
      this.sheets[si] = mkSheet(this.cols * this.cw, this.ch * Math.min(this.rows, 4));
    } else if (cell === 0 && n >= this.per) {                       // wrapped round: recycle this sheet
      for (const [k, v] of this.map) if (v.si === si) this.map.delete(k);
      this.sheets[si].g.clearRect(0, 0, this.sheets[si].c.width, this.sheets[si].c.height);
      STATS.evictedSheets++;
    }
    const S = this.sheets[si], row = Math.floor(cell / this.cols), needH = (row + 1) * this.ch;
    if (needH > S.c.height) {                                       // grow the sheet (keep what is on it)
      const nh = Math.min(this.rows * this.ch, Math.max(needH, S.c.height * 2));
      const N = mkSheet(S.c.width, nh); sheetsLive--; STATS.sheetsMade--;   // a replacement, not a new sheet
      N.g.drawImage(S.c, 0, 0); S.c.width = 1; S.c.height = 1;              // release the old backing store now
      this.sheets[si] = N;
    }
    return [si, cell];
  }
  get(ch, variant = '') {
    this.used = ++clock;
    const k = variant ? ch + '\u0000' + variant : ch;
    let s = this.map.get(k);
    if (!s) {
      const [si, cell] = this._slot(), S = this.sheets[si];
      const x = (cell % this.cols) * this.cw + this.pad, y = Math.floor(cell / this.cols) * this.ch + this.pad, g = S.g;
      g.save(); g.clearRect(x - this.pad, y - this.pad, this.cw, this.ch);
      g.beginPath(); g.rect(x, y, this.w, this.h); g.clip(); g.translate(x, y);
      this.paint(g, ch, this.w, this.h, variant);
      g.restore(); STATS.paints++;
      s = { si, x, y }; this.map.set(k, s);
    }
    return { img: this.sheets[s.si].c, sx: s.x, sy: s.y, w: this.w, h: this.h };
  }
  // draw the cell (or its part u0..u1, v0..v1 in 0..1) into (x, y, dw, dh)
  draw(g, ch, x, y, dw = this.w, dh = this.h, o = {}) {
    const G = this.get(ch, o.variant), u0 = o.u0 ?? 0, u1 = o.u1 ?? 1, v0 = o.v0 ?? 0, v1 = o.v1 ?? 1;
    const sw = (u1 - u0) * G.w, sh = (v1 - v0) * G.h;
    if (sw <= 0 || sh <= 0 || dw === 0 || dh === 0) return;
    g.drawImage(G.img, G.sx + u0 * G.w, G.sy + v0 * G.h, sw, sh, x, y, dw, dh);
  }
  // a row of cells; returns [x0, y0, width, height]. o.align left|center|right (x is that edge/centre), o.gap px,
  // o.scale (draw size / cell size), o.variantAt(i, ch) per-cell variant, o.each(i, ch, x, y, w, h) instead of draw
  text(g, str, x, y, o = {}) {
    const k = o.scale ?? 1, w = this.w * k, h = this.h * k, gap = (o.gap ?? 0) * k, n = [...str].length;
    const tw = n * w + Math.max(0, n - 1) * gap;
    const x0 = o.align === 'center' ? x - tw / 2 : o.align === 'right' ? x - tw : x, y0 = o.middle ? y - h / 2 : y;
    let i = 0;
    for (const ch of str) {
      const cx = x0 + i * (w + gap);
      if (o.each) o.each(i, ch, cx, y0, w, h); else this.draw(g, ch, cx, y0, w, h, { variant: o.variantAt ? o.variantAt(i, ch) : undefined });
      i++;
    }
    return [x0, y0, tw, h];
  }
  precache(chars, variant = '') { for (const ch of chars) this.get(ch, variant); return this; }
  release() {
    for (const S of this.sheets) if (S) { S.c.width = 1; S.c.height = 1; sheetsLive--; }
    this.sheets = []; this.map.clear(); this.next = 0;
  }
}

function evictLRU(except) {
  let worst = null;
  for (const A of REG.values()) if (A !== except && A.sheets.length && (!worst || A.used < worst.used)) worst = A;
  if (!worst) return;
  for (const [k, v] of REG) if (v === worst) REG.delete(k);
  worst.release(); STATS.evictedAtlases++;
}

// glyphAtlas({ w, h, key, paint(g, ch, w, h, variant), quant, pad, maxSheets }) -> the shared Atlas for that size+key.
// The paint function is taken from the first call for a (size, key): give each look its own key.
export function glyphAtlas(o) {
  const q = o.quant || 1, w = Math.max(1, Math.ceil(Math.round(o.w) / q) * q), h = Math.max(1, Math.ceil(Math.round(o.h) / q) * q);
  const id = `${w}x${h}|${o.key ?? ''}`;
  let A = REG.get(id);
  if (!A) { A = new Atlas({ ...o, w, h }); REG.set(id, A); STATS.atlases++; }
  return A;
}

// ---------------------------------------------------------------- painters
// paintText({ font: 'Anton', size: 0.86 (x cell h), fill, stroke, strokeW, fit: 0.84 (max width share), bg, y: 0.5 })
export function paintText(o = {}) {
  return (g, ch, w, h) => {
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
    if (!ch || ch === ' ') return;
    const fs = Math.round(h * (o.size ?? 0.86));
    g.font = `${o.weight ?? ''} ${fs}px "${o.font ?? 'Anton'}"`.trim(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const mw = g.measureText(ch).width, kx = Math.min(1, (w * (o.fit ?? 0.84)) / Math.max(1, mw));
    g.translate(w / 2, h * (o.y ?? 0.5) + fs * 0.36); g.scale(kx, 1);
    if (o.stroke) { g.lineWidth = (o.strokeW ?? 0.06) * fs; g.lineJoin = 'round'; g.strokeStyle = o.stroke; g.strokeText(ch, 0, 0); }
    g.fillStyle = o.fill ?? '#f4e6d0'; g.fillText(ch, 0, 0);
  };
}
// paintFlap({ bg0, bg1, fg, edge, font }): a split-flap tile (two-leaf gradient, the letter, the lower leaf in shadow)
export function paintFlap(p = {}) {
  const text = paintText({ font: p.font ?? 'Anton', fill: p.fg ?? '#efe2c8', size: p.size ?? 0.86, fit: p.fit ?? 0.84 });
  return (g, ch, w, h, v) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, p.bg0 ?? '#1d1818'); gr.addColorStop(0.5, p.bg1 ?? '#141011'); gr.addColorStop(0.5, p.bg0 ?? '#1d1818'); gr.addColorStop(1, p.bg1 ?? '#141011');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.save(); text(g, ch, w, h, v); g.restore();
    g.fillStyle = p.edge ?? 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, w, Math.max(1, h * 0.02));
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h * 0.5, w, h * 0.5);
  };
}

export function atlasStats() {
  let glyphs = 0, px = 0;
  for (const A of REG.values()) { glyphs += A.map.size; for (const S of A.sheets) if (S) px += S.c.width * S.c.height; }
  return { ...STATS, atlasesLive: REG.size, sheetsLive, glyphs, megapixels: +(px / 1e6).toFixed(2) };
}
export function clearAtlases() { for (const A of REG.values()) A.release(); REG.clear(); }
if (typeof window !== 'undefined') window.__glyphAtlas = atlasStats;
