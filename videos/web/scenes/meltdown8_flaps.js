// MELTDOWN v11: the split-flap board as the piece's one physical object (brief P1-P3, cycle 4m). Every "diagram" in
// the piece is this board or a thing in its world: the hook is spelled in its flaps, the merger tree is its rows
// slamming together, the mechanism is its COST / PRICE / PROFIT / RATE rows flipping to zero, the cost curve is a
// wax-pencil line on its glass (Kentridge: erased and redrawn lower on each kick, the ghosts kept).
//   tile()        one split-flap tile with a real flip (top leaf falls, bottom leaf lands), glyphs from one atlas per size and palette
//   flapText()    a line spelled in big flaps on the board's own housing (the board-section type face)
//   Board         a grid of tiles with a housing, rows of goods and prices, clatter, pings, per-cell overrides
//   halftone()    a tonal canvas -> a printed halftone plate (the machine plates)
//   machinePlates()  twelve halftone machine plates (real plant plates + drawn machines), for EVERY MACHINE.
//   lattice       the thinking lattice (3D nodes/edges, projected in 2D, pulses racing along the edges)
//   meter()       the electric meter: glass dome, dial, disc, the needle that drops off its scale
//   charcoal()    the cost curve on the glass with its erased ghosts
import { W, H, C, clamp, lerp, ease, rng } from '../lib/kit.js';

const TAU = Math.PI * 2;
export const hsh = (a, b = 0) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e37, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; };
export const sm = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// ================================================================ the tile
// palette keys: dark (the board), cream (the hook), red (hot), ice, gold
export const TILE = {
  dark: { bg0: '#1d1818', bg1: '#141011', fg: '#efe2c8', edge: 'rgba(255,255,255,0.07)' },
  dim: { bg0: '#151112', bg1: '#0e0b0c', fg: '#8f8272', edge: 'rgba(255,255,255,0.05)' },
  hot: { bg0: '#2a0d10', bg1: '#1c0709', fg: '#ff3a44', edge: 'rgba(255,120,120,0.12)' },
  cream: { bg0: '#f6ead3', bg1: '#e4d5b8', fg: '#140c0c', edge: 'rgba(255,255,255,0.6)' },
  creamRed: { bg0: '#f6ead3', bg1: '#e4d5b8', fg: '#c4101f', edge: 'rgba(255,255,255,0.6)' },
  red: { bg0: '#c8141f', bg1: '#a30d17', fg: '#f6ead3', edge: 'rgba(255,200,200,0.3)' },
  gold: { bg0: '#2a1a06', bg1: '#1a0f03', fg: '#ffc65a', edge: 'rgba(255,200,120,0.14)' },
  ice: { bg0: '#b9d8ee', bg1: '#86b2d4', fg: '#0b2742', edge: 'rgba(255,255,255,0.6)' },
  loss: { bg0: '#1a0506', bg1: '#110203', fg: '#ff2a30', edge: 'rgba(255,90,90,0.15)' },
};
// glyph atlases (v11 render fix): ONE canvas per tile size and palette, 8 x 8 glyph slots filled on demand. The v11 draft
// cached two canvases per glyph (up to 6000 live canvases): in a long headless render Chromium dropped their backing
// stores and whole tiles came out black (frame 0 black, THANK YO missing). Stills never showed it.
const ATLAS = new Map();
function glyph(ch, w, h, pal) {                                        // -> [atlas canvas, sx, sy] of the full tile
  const key = w + '|' + h + '|' + pal.fg + pal.bg0 + pal.bg1 + pal.edge;
  let A = ATLAS.get(key);
  if (!A) { if (ATLAS.size > 240) ATLAS.clear(); const c = mk(w * 8, h * 8); A = { c, g: c.getContext('2d'), map: new Map(), n: 0 }; ATLAS.set(key, A); }
  let sl = A.map.get(ch);
  if (sl) return [A.c, sl[0], sl[1]];
  const i = A.n < 64 ? A.n++ : 63;                                     // more than 64 distinct glyphs: reuse the last slot
  if (i === 63) for (const [k, v] of A.map) if (v[2] === 63) A.map.delete(k);
  const sx = (i % 8) * w, sy = Math.floor(i / 8) * h, g = A.g;
  g.save(); g.beginPath(); g.rect(sx, sy, w, h); g.clip(); g.translate(sx, sy); g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, pal.bg0); gr.addColorStop(0.5, pal.bg1); gr.addColorStop(0.5, pal.bg0); gr.addColorStop(1, pal.bg1);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  if (ch && ch !== ' ') {
    const fs = Math.round(h * 0.86);
    g.font = `${fs}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const mw = g.measureText(ch).width, kx = Math.min(1, (w * 0.84) / Math.max(1, mw));
    g.save(); g.translate(w / 2, h * 0.5 + fs * 0.36); g.scale(kx, 1); g.fillStyle = pal.fg; g.fillText(ch, 0, 0); g.restore();
  }
  g.fillStyle = pal.edge; g.fillRect(0, 0, w, Math.max(1, h * 0.02));
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h * 0.5, w, h * 0.5);          // the lower leaf sits in shadow
  g.restore();
  A.map.set(ch, [sx, sy, i]);
  return [A.c, sx, sy];
}
// draw the top (half 0) or bottom (half 1) leaf of a glyph at (dx, dy) in the current transform
function leaf(g, G, half, dx, dy, w, h) { const hh = h / 2; g.drawImage(G[0], G[1], G[2] + half * hh, w, hh, dx, dy, w, hh); }
// tile(g, x, y, w, h, ch, pal, o): o.flip 0..1 (a flip in progress from o.prev to ch), o.lit (0..1 red heat)
export function tile(g, x, y, w, h, ch, pal = TILE.dark, o = {}) {
  w = Math.round(w); h = Math.round(h) & ~1; x = Math.round(x); y = Math.round(y);
  if (w < 1 || h < 2) return;
  const N = glyph(ch, w, h, pal), f = o.flip ?? -1;
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x + 2, y + 3, w, h);                // the tile's shadow on the housing
  if (f < 0 || f >= 1) { leaf(g, N, 0, x, y, w, h); leaf(g, N, 1, x, y + h / 2, w, h); }
  else {
    const P = glyph(o.prev ?? ' ', w, h, o.prevPal || pal);
    leaf(g, N, 0, x, y, w, h); leaf(g, P, 1, x, y + h / 2, w, h);                 // static: new top, old bottom
    if (f < 0.5) { const s = Math.cos(f * Math.PI); g.save(); g.translate(x, y + h / 2); g.scale(1, s); leaf(g, P, 0, 0, -h / 2, w, h); g.restore();
      g.fillStyle = `rgba(0,0,0,${0.5 * (1 - s)})`; g.fillRect(x, y + h / 2 - h / 2 * s, w, h / 2 * s); }
    else { const s = -Math.cos(f * Math.PI); g.save(); g.translate(x, y + h / 2); g.scale(1, s); leaf(g, N, 1, 0, 0, w, h); g.restore();
      g.fillStyle = `rgba(255,255,255,${0.12 * (1 - s)})`; g.fillRect(x, y + h / 2, w, h / 2 * s); }
  }
  if (o.lit > 0) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,40,40,${0.35 * o.lit})`; g.fillRect(x, y, w, h); g.restore(); }
  const light = pal === TILE.cream || pal === TILE.creamRed;                      // the hook flaps: a fine split, so the letters read whole (OCR, thumbnails)
  g.fillStyle = light ? 'rgba(0,0,0,0.3)' : '#000'; g.fillRect(x, y + h / 2 - (light ? 0.5 : 1), w, light ? 1 : 2);   // the split
  g.fillStyle = 'rgba(160,150,140,0.5)'; g.fillRect(x - 1, y + h / 2 - 3, 3, 6); g.fillRect(x + w - 2, y + h / 2 - 3, 3, 6);   // hinge pins
}

// a flap line: chars spread over tiles centred at (cx, cy) with tile width tw, height th; returns the box
// o.pal, o.pals (per char), o.t0 (the hit: tiles flip in over o.stagger s each, from random flap chars), o.t
export const FLAPCH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.,%';
export function flapRow(g, s, cx, cy, tw, th, o = {}) {
  const gap = o.gap ?? Math.round(tw * 0.08), n = s.length, wAll = n * tw + (n - 1) * gap, x0 = cx - wAll / 2;
  for (let i = 0; i < n; i++) {
    const pal = (o.pals && o.pals[i]) || o.pal || TILE.dark;
    let flip = -1, prev = ' ';
    if (o.t != null && o.t0 != null) {
      const a = o.t - o.t0 - i * (o.stagger ?? 0.012);
      const dur = o.dur ?? 0.1;
      if (a < 0) { if (o.hideBefore) continue; }
      else if (a < dur) { flip = 0.35 + 0.65 * a / dur; prev = FLAPCH[Math.floor(hsh(i, 7 + Math.floor(o.t * 30)) * FLAPCH.length)]; }
    }
    tile(g, x0 + i * (tw + gap), cy - th / 2, tw, th, s[i], pal, { flip, prev, lit: o.lit ? o.lit(i) : 0 });
  }
  return [x0, cy - th / 2, wAll, th];
}
// the board-section type face: the line spelled in big flaps on a housing strip (solid backing, never on busy digits)
export function flapText(g, text, cy, t, t0, o = {}) {
  t0 -= o.preroll ?? (0.05 + 0.005 * text.length);                                            // the flaps start just before the hit so the word reads ON it
  const rows = o.rows || (text.length > (o.maxRow ?? 13) ? splitRows(text) : [text]);
  const maxN = Math.max(...rows.map(r => r.length));
  const tw = Math.min(o.tw ?? 118, Math.floor((W - 70) / maxN * 0.93)), th = Math.max(o.th ?? 0, Math.round(tw * (o.aspect ?? 2.2)));
  const gap = Math.round(tw * 0.08), lh = th + Math.round(th * 0.12), hh = rows.length * lh - Math.round(th * 0.12);
  const k = o.punch ? 1 + 0.06 * Math.exp(-(t - t0) * 14) : 1;
  g.save(); g.translate(W / 2, cy); g.scale(k, k); g.translate(-W / 2, -cy);
  if (o.housing !== false) {                                          // the housing strip: black steel, rivets
    const bw = maxN * (tw + gap) + 50, bx = W / 2 - bw / 2, by = cy - hh / 2 - 24;
    g.fillStyle = o.housingCol || '#0b0909'; g.fillRect(bx, by, bw, hh + 48);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(bx + 6, by + 6, bw - 12, hh + 36);
    g.fillStyle = 'rgba(200,190,170,0.35)'; for (const [rx, ry] of [[bx + 14, by + 14], [bx + bw - 14, by + 14], [bx + 14, by + hh + 34], [bx + bw - 14, by + hh + 34]]) { g.beginPath(); g.arc(rx, ry, 4, 0, TAU); g.fill(); }
  }
  rows.forEach((r, i) => flapRow(g, r, W / 2, cy - hh / 2 + th / 2 + i * lh, tw, th, { pal: o.pal, pals: o.palsFor ? o.palsFor(i, r) : null, t, t0: t0 + i * 0.03, stagger: 0.008, dur: 0.07 }));
  g.restore();
  return th;
}
export function splitRows(text) {                    // two rows at the space nearest the middle
  const sp = [...text].map((c, i) => c === ' ' ? i : -1).filter(i => i > 0);
  if (!sp.length) return [text];
  const m = sp.reduce((a, b) => Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a);
  return [text.slice(0, m), text.slice(m + 1)];
}

// ================================================================ the board
const GOODS = ['STEEL', 'WHEAT', 'CHIPS', 'POWER', 'RENT', 'OIL', 'CORN', 'COPPER', 'FREIGHT', 'INSULIN', 'LUMBER', 'CEMENT', 'COTTON', 'NICKEL', 'SUGAR', 'GAS', 'RICE', 'TIN', 'SOY', 'COAL'];
export function priceStr(r, k) {                     // '$1,412.60' (9 chars, right aligned) and ' +2.1' (5)
  const R = rng(r * 131 + k * 7 + 3), v = Math.pow(10, 1 + R() * 2.6) * (0.6 + R());
  const p = '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ch = ((R() - 0.45) * 9).toFixed(1); const cs = (ch[0] === '-' ? '' : '+') + ch;
  return [p.padStart(9).slice(-9), cs.padStart(5).slice(-5)];
}
export function goodsRow(r, k, n = 22) {             // 'STEEL   $1,412.60  +2.1' fitted to n chars
  const i = ((Math.floor(r) % GOODS.length) + GOODS.length) % GOODS.length;   // the board scrolls past row 0: wrap negative row indices
  const [p, c] = priceStr(r, k), lab = GOODS[i].padEnd(7);
  return (lab + ' ' + p + ' ' + c).slice(0, n).padEnd(n);
}
// A board: rows x cols tiles at (x0, y0) with pitch; rowText(r, t) -> string; o.cell(r, c, t, ch) -> {ch, pal, flip, prev, lit, hide}
export class Board {
  constructor({ rows, cols, x0, y0, tw, th, gx = 5, gy = 10, seed = 1 }) {
    Object.assign(this, { rows, cols, x0, y0, tw, th, gx, gy, seed });
    this.w = cols * tw + (cols - 1) * gx; this.h = rows * th + (rows - 1) * gy;
  }
  static fit({ rows, cols, cx = W / 2, top, width = W - 90, aspect = 1.55, gx = 5, gy = 10 }) {
    const tw = Math.floor((width - (cols - 1) * gx) / cols), th = Math.round(tw * aspect) & ~1;
    const w = cols * tw + (cols - 1) * gx;
    return new Board({ rows, cols, x0: Math.round(cx - w / 2), y0: top, tw, th, gx, gy });
  }
  cx(c) { return this.x0 + c * (this.tw + this.gx); }
  cy(r) { return this.y0 + r * (this.th + this.gy); }
  housing(g, pad = 26, col = '#0a0808') {
    const x = this.x0 - pad, y = this.y0 - pad, w = this.w + pad * 2, h = this.h + pad * 2;
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#15110f'); gr.addColorStop(1, col);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(255,240,220,0.1)'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    g.fillStyle = 'rgba(200,190,170,0.3)';
    for (let i = 0; i <= 6; i++) for (const yy of [y + 12, y + h - 12]) { g.beginPath(); g.arc(x + 12 + i * (w - 24) / 6, yy, 3.5, 0, TAU); g.fill(); }
  }
  // clatter: every cell flips on its own clock (every 0.6-2.6 s, a 0.1 s flip), rowText gives the target string
  draw(g, t, rowText, o = {}) {
    for (let r = 0; r < this.rows; r++) {
      const s0 = rowText(r, t), s1 = o.clatter ? rowText(r, t - 0.6) : s0;   // a clattering flap flips from what the cell showed a moment ago, never through random letters
      for (let c = 0; c < this.cols; c++) {
        const i = r * 97 + c * 13 + this.seed * 7;
        let ch = s0[c] ?? ' ', pal = o.pal || TILE.dark, flip = -1, prev = ' ', lit = 0;
        if (o.clatter) {
          const per = 0.6 + hsh(i, 1) * 2.0, ph = hsh(i, 2) * per, u = ((t + ph) % per);
          if (u < 0.1 && !(o.still && o.still(r, c))) { flip = u / 0.1; prev = s1[c] ?? ' '; }
        }
        if (o.cell) { const v = o.cell(r, c, t, ch); if (v === null) continue; if (v) ({ ch = ch, pal = pal, flip = flip, prev = prev, lit = lit } = { ch, pal, flip, prev, lit, ...v }); }
        tile(g, this.cx(c), this.cy(r), this.tw, this.th, ch, pal, { flip, prev, lit });
      }
    }
  }
}

// ================================================================ halftone plates
export function halftone(src, { cell = 6, ang = 0.785, ink = '#141010', paper = '#efe3cc', gamma = 1, red = null, redAmt = 0 } = {}) {
  const w = src.width, h = src.height, out = mk(w, h), g = out.getContext('2d');
  const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  g.fillStyle = paper; g.fillRect(0, 0, w, h);
  const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.hypot(w, h);
  g.fillStyle = ink;
  for (let v = -R; v < R; v += cell) for (let u = -R; u < R; u += cell) {
    const x = w / 2 + u * ca - v * sa, y = h / 2 + u * sa + v * ca;
    if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
    const xi = clamp(Math.round(x), 0, w - 1), yi = clamp(Math.round(y), 0, h - 1), o = (yi * w + xi) * 4;
    const l = Math.pow((d[o] * 0.2126 + d[o + 1] * 0.7152 + d[o + 2] * 0.0722) / 255, gamma);
    const r = cell * 0.62 * Math.sqrt(clamp(1 - l));
    if (r < 0.35) continue;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  if (red) {                                         // a second, red screen on the warmest parts (a two-colour print)
    g.globalCompositeOperation = 'multiply'; g.fillStyle = red;
    for (let v = -R; v < R; v += cell * 1.2) for (let u = -R; u < R; u += cell * 1.2) {
      const x = w / 2 + u * Math.cos(0.26) - v * Math.sin(0.26), y = h / 2 + u * Math.sin(0.26) + v * Math.cos(0.26);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = (Math.floor(y) * w + Math.floor(x)) * 4, warm = clamp((d[o] - d[o + 2]) / 255 * 2.2) * redAmt;
      if (warm < 0.08) continue; g.beginPath(); g.arc(x, y, cell * 0.6 * Math.sqrt(warm), 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  return out;
}
// tonal drawing helpers
const lg = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const grey = v => { const k = Math.round(clamp(v) * 255); return `rgb(${k},${k},${k})`; };
function sky(g, w, h, a = 0.85, b = 0.55) { g.fillStyle = lg(g, 0, 0, 0, h, [[0, grey(a)], [1, grey(b)]]); g.fillRect(0, 0, w, h); }
// the drawn machines: each fn(g, w, h) paints a tonal picture (white = paper)
const DRAWN = {
  turbines(g, w, h) { sky(g, w, h, 0.92, 0.7); const R = rng(3);
    for (let k = 0; k < 4; k++) { const x = w * (0.2 + k * 0.24), s = 1 - k * 0.2, base = h * (0.95 - k * 0.08), top = base - h * 0.7 * s;
      g.fillStyle = grey(0.25 + k * 0.15); g.beginPath(); g.moveTo(x - 6 * s, base); g.lineTo(x - 3 * s, top); g.lineTo(x + 3 * s, top); g.lineTo(x + 6 * s, base); g.fill();
      for (let b = 0; b < 3; b++) { g.save(); g.translate(x, top); g.rotate(b * TAU / 3 + R() * 2); g.beginPath(); g.moveTo(-3 * s, 0); g.quadraticCurveTo(-10 * s, -h * 0.2 * s, 0, -h * 0.33 * s); g.lineTo(4 * s, 0); g.fill(); g.restore(); }
      g.beginPath(); g.arc(x, top, 6 * s, 0, TAU); g.fill(); }
    g.fillStyle = grey(0.35); g.fillRect(0, h * 0.93, w, h * 0.07); },
  crane(g, w, h) { sky(g, w, h, 0.9, 0.62);
    g.strokeStyle = grey(0.12); g.lineWidth = 3; const mx = w * 0.3;
    for (let y = h * 0.15; y < h; y += 16) { g.beginPath(); g.moveTo(mx - 12, y); g.lineTo(mx + 12, y + 16); g.moveTo(mx + 12, y); g.lineTo(mx - 12, y + 16); g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(mx - 12, h * 0.15); g.lineTo(mx - 12, h); g.moveTo(mx + 12, h * 0.15); g.lineTo(mx + 12, h); g.stroke();
    g.lineWidth = 3; for (let x = mx - 90; x < w - 10; x += 18) { g.beginPath(); g.moveTo(x, h * 0.15); g.lineTo(x + 9, h * 0.15 + 16); g.lineTo(x + 18, h * 0.15); g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(mx - 90, h * 0.15); g.lineTo(w - 10, h * 0.15); g.moveTo(mx - 90, h * 0.15 + 16); g.lineTo(w - 10, h * 0.15 + 16); g.stroke();
    g.beginPath(); g.moveTo(mx, h * 0.15); g.lineTo(mx, h * 0.03); g.lineTo(w - 10, h * 0.15); g.moveTo(mx, h * 0.03); g.lineTo(mx - 90, h * 0.15); g.lineWidth = 2; g.stroke();
    g.fillStyle = grey(0.15); g.fillRect(mx - 110, h * 0.13, 30, 30); g.fillRect(w * 0.72, h * 0.18, 3, h * 0.36); g.fillRect(w * 0.66, h * 0.54, w * 0.14, h * 0.1);
    g.fillStyle = grey(0.4); for (let k = 0; k < 5; k++) g.fillRect(w * 0.45 + k * 30, h * (0.72 - k * 0.03), 26, h); },
  arm(g, w, h) { g.fillStyle = lg(g, 0, 0, 0, h, [[0, grey(0.3)], [1, grey(0.08)]]); g.fillRect(0, 0, w, h);
    g.fillStyle = lg(g, 0, h * 0.8, 0, h, [[0, grey(0.45)], [1, grey(0.2)]]); g.fillRect(0, h * 0.8, w, h * 0.2);
    const seg = (x0, y0, x1, y1, r, c) => { g.strokeStyle = c; g.lineWidth = r; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    seg(w * 0.45, h * 0.85, w * 0.45, h * 0.7, 60, grey(0.75)); seg(w * 0.45, h * 0.7, w * 0.25, h * 0.35, 34, grey(0.85)); seg(w * 0.25, h * 0.35, w * 0.62, h * 0.22, 26, grey(0.9));
    seg(w * 0.45, h * 0.7, w * 0.25, h * 0.35, 12, grey(0.55)); seg(w * 0.25, h * 0.35, w * 0.62, h * 0.22, 8, grey(0.6));
    g.fillStyle = grey(0.95); for (const [x, y, r] of [[0.45, 0.7, 26], [0.25, 0.35, 20], [0.62, 0.22, 14]]) { g.beginPath(); g.arc(w * x, h * y, r, 0, TAU); g.fill(); }
    g.fillStyle = grey(0.7); g.fillRect(w * 0.6, h * 0.24, 10, 34); g.fillRect(w * 0.66, h * 0.24, 10, 34);
    g.fillStyle = grey(1); g.beginPath(); g.arc(w * 0.66, h * 0.36, 7, 0, TAU); g.fill();       // the weld spark
    g.fillStyle = grey(0.5); g.fillRect(w * 0.55, h * 0.56, w * 0.4, h * 0.12); },
  press(g, w, h) { g.fillStyle = grey(0.18); g.fillRect(0, 0, w, h);
    g.fillStyle = lg(g, w * 0.15, 0, w * 0.85, 0, [[0, grey(0.4)], [0.3, grey(0.85)], [1, grey(0.3)]]);
    g.fillRect(w * 0.12, h * 0.06, w * 0.76, h * 0.18); g.fillRect(w * 0.14, h * 0.24, w * 0.12, h * 0.66); g.fillRect(w * 0.74, h * 0.24, w * 0.12, h * 0.66);
    g.fillStyle = lg(g, w * 0.3, 0, w * 0.7, 0, [[0, grey(0.5)], [0.5, grey(0.95)], [1, grey(0.45)]]); g.fillRect(w * 0.33, h * 0.24, w * 0.34, h * 0.28);
    g.fillStyle = grey(0.3); g.fillRect(w * 0.3, h * 0.52, w * 0.4, h * 0.05);
    g.fillStyle = grey(0.9); g.fillRect(w * 0.28, h * 0.74, w * 0.44, h * 0.06); g.fillStyle = grey(0.55); g.fillRect(w * 0.08, h * 0.9, w * 0.84, h * 0.1);
    g.fillStyle = grey(0.1); for (let k = 0; k < 6; k++) g.fillRect(w * (0.16 + k * 0.12), h * 0.12, 8, 8); },
  racks(g, w, h) { g.fillStyle = grey(0.06); g.fillRect(0, 0, w, h); const vx = w * 0.5, vy = h * 0.42;
    for (const s of [-1, 1]) for (let k = 0; k < 9; k++) { const u0 = k / 9, u1 = (k + 0.85) / 9, xa = vx + s * w * 0.6 * Math.pow(1 - u0, 1.6), xb = vx + s * w * 0.6 * Math.pow(1 - u1, 1.6);
      const ya = h * 0.9 * Math.pow(1 - u0, 1.6), yb = h * 0.9 * Math.pow(1 - u1, 1.6);
      g.fillStyle = grey(0.25 + 0.2 * (1 - u0)); g.beginPath(); g.moveTo(xa, vy - (vy - 0) * (1 - u0) * 0.95); g.lineTo(xb, vy - vy * (1 - u1) * 0.95); g.lineTo(xb, vy + yb * 0.5); g.lineTo(xa, vy + ya * 0.5); g.fill();
      g.fillStyle = grey(0.95); for (let j = 0; j < 8; j++) { const yy = lerp(vy - vy * (1 - u0) * 0.9, vy + ya * 0.45, j / 8); g.fillRect(Math.min(xa, xb) + 3, yy, 3, 2); } }
    g.fillStyle = lg(g, 0, 0, 0, h * 0.4, [[0, grey(0.9)], [1, grey(0.1)]]); g.fillRect(w * 0.42, 0, w * 0.16, h * 0.08); },
  ladle(g, w, h) { g.fillStyle = grey(0.05); g.fillRect(0, 0, w, h);
    const gl = g.createRadialGradient(w * 0.45, h * 0.62, 5, w * 0.45, h * 0.62, w * 0.7); gl.addColorStop(0, grey(1)); gl.addColorStop(0.3, grey(0.65)); gl.addColorStop(1, grey(0.04));
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
    g.fillStyle = grey(0.1); g.beginPath(); g.moveTo(w * 0.05, h * 0.12); g.lineTo(w * 0.6, h * 0.08); g.lineTo(w * 0.55, h * 0.45); g.lineTo(w * 0.12, h * 0.5); g.fill();
    g.fillStyle = grey(0.98); g.beginPath(); g.moveTo(w * 0.52, h * 0.4); g.quadraticCurveTo(w * 0.58, h * 0.6, w * 0.47, h); g.lineTo(w * 0.4, h); g.quadraticCurveTo(w * 0.5, h * 0.6, w * 0.47, h * 0.42); g.fill();
    g.fillStyle = grey(0.2); g.fillRect(w * 0.26, 0, 10, h * 0.1); g.fillRect(w * 0.42, 0, 10, h * 0.09);
    const R = rng(9); g.fillStyle = grey(1); for (let i = 0; i < 70; i++) g.fillRect(w * 0.45 + (R() - 0.5) * w * 0.6, h * (0.55 + R() * 0.45), 2, 2); },
  combine(g, w, h) { sky(g, w, h, 0.95, 0.75); g.fillStyle = lg(g, 0, h * 0.6, 0, h, [[0, grey(0.6)], [1, grey(0.35)]]); g.fillRect(0, h * 0.6, w, h * 0.4);
    g.strokeStyle = grey(0.45); g.lineWidth = 2; for (let k = 0; k < 14; k++) { g.beginPath(); g.moveTo(-20 + k * 40, h); g.lineTo(w * 0.5 + (k - 7) * 6, h * 0.6); g.stroke(); }
    g.fillStyle = grey(0.15); g.fillRect(w * 0.25, h * 0.42, w * 0.46, h * 0.2); g.fillRect(w * 0.52, h * 0.3, w * 0.16, h * 0.14);
    g.fillStyle = grey(0.8); g.fillRect(w * 0.55, h * 0.32, w * 0.1, h * 0.07);
    g.fillStyle = grey(0.25); g.fillRect(w * 0.08, h * 0.58, w * 0.3, h * 0.06); g.fillRect(w * 0.64, h * 0.36, w * 0.28, 7);
    g.fillStyle = grey(0.05); for (const [x, r] of [[0.33, 34], [0.62, 22]]) { g.beginPath(); g.arc(w * x, h * 0.64, r, 0, TAU); g.fill(); }
    g.fillStyle = grey(0.88); g.globalAlpha = 0.6; g.beginPath(); g.ellipse(w * 0.2, h * 0.52, w * 0.2, h * 0.08, 0, 0, TAU); g.fill(); g.globalAlpha = 1; },
  port(g, w, h) { sky(g, w, h, 0.9, 0.72); g.fillStyle = grey(0.5); g.fillRect(0, h * 0.78, w, h * 0.22);
    for (let k = 0; k < 3; k++) { const x = w * (0.18 + k * 0.32), s = 1 - k * 0.12; g.strokeStyle = grey(0.15); g.lineWidth = 6 * s;
      g.beginPath(); g.moveTo(x - 24 * s, h * 0.78); g.lineTo(x - 18 * s, h * 0.3); g.moveTo(x + 24 * s, h * 0.78); g.lineTo(x + 18 * s, h * 0.3); g.moveTo(x - 60 * s, h * 0.3); g.lineTo(x + 70 * s, h * 0.3); g.moveTo(x + 10 * s, h * 0.3); g.lineTo(x + 10 * s, h * 0.16); g.stroke(); }
    const R = rng(4); for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) { g.fillStyle = grey(0.2 + R() * 0.6); g.fillRect(8 + c * 27, h * 0.7 - r * 14, 25, 12); } },
  wafer(g, w, h) { g.fillStyle = grey(0.1); g.fillRect(0, 0, w, h); const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.46;
    const gr = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 5, cx, cy, r); gr.addColorStop(0, grey(1)); gr.addColorStop(1, grey(0.35)); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r - 4, 0, TAU); g.clip(); g.strokeStyle = grey(0.2); g.lineWidth = 1.5;
    for (let x = cx - r; x < cx + r; x += 18) { g.beginPath(); g.moveTo(x, cy - r); g.lineTo(x, cy + r); g.stroke(); }
    for (let y = cy - r; y < cy + r; y += 18) { g.beginPath(); g.moveTo(cx - r, y); g.lineTo(cx + r, y); g.stroke(); } g.restore(); },
  mill(g, w, h) { g.fillStyle = grey(0.12); g.fillRect(0, 0, w, h);
    for (const [y, r] of [[0.35, 60], [0.62, 60]]) { g.fillStyle = lg(g, 0, h * y - r, 0, h * y + r, [[0, grey(0.3)], [0.35, grey(0.95)], [1, grey(0.15)]]); g.fillRect(0, h * y - r, w, r * 2); }
    g.fillStyle = grey(1); g.fillRect(0, h * 0.485, w, 10);
    g.fillStyle = lg(g, 0, 0, w, 0, [[0, grey(0.9)], [1, grey(0.4)]]); g.fillRect(0, h * 0.495, w * 0.5, 16);
    g.fillStyle = grey(0.05); g.fillRect(w * 0.05, 0, 30, h); g.fillRect(w * 0.88, 0, 30, h); },
};
// the plates, in board order; real plates are cropped from the studio's plant renders
export async function machinePlates(pw, ph, loadImage) {
  const out = [];
  const real = [];
  try {
    const A = await loadImage('../assets/worlds_plates/plant_c2.jpg');
    const B = await loadImage('../assets/worlds_plates/shot4.jpg');
    const F = await loadImage('../assets/src/factory_ironbow.jpg');
    real.push([A, 120, 640, 760, 700 * ph / pw]); real.push([B, 150, 560, 720, 720 * ph / pw]); real.push([F, 200, 900, 900, 900 * ph / pw]);
  } catch (e) { console.warn('[meltdown8] plates missing', e); }
  const order = ['turbines', 'R0', 'press', 'arm', 'racks', 'ladle', 'R1', 'crane', 'combine', 'port', 'wafer', 'R2', 'mill'];
  for (const k of order) {
    const c = mk(pw, ph), g = c.getContext('2d');
    if (k[0] === 'R') { const r = real[+k[1]]; if (!r) continue; const [img, sx, sy, sw, sh] = r;
      g.filter = 'grayscale(1) contrast(1.35) brightness(1.15)'; g.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph); g.filter = 'none'; }
    else DRAWN[k](g, pw, ph);
    out.push({ key: k, tone: c, plate: halftone(c, { cell: 5.5 }), warm: null });
  }
  return out;
}
// the machines lit and running (the melt): a red-gold duotone of the same plates
export function warmPlate(p) {
  if (p.warm) return p.warm;
  p.warm = halftone(p.tone, { cell: 5.5, ink: '#2a0404', paper: '#ffb04a', gamma: 0.9 });
  return p.warm;
}

// ================================================================ the thinking lattice
export class Lattice {
  constructor(seed = 7) {
    const R = rng(seed), N = [], E = [];
    for (let i = 0; i < 340; i++) { let x, y, z; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; } while (x * x + y * y * 0.6 + z * z > 1); N.push([x * 11, y * 15, z * 11, R()]); }
    for (let i = 0; i < N.length; i++) { const d = N.map((q, j) => [j, (q[0] - N[i][0]) ** 2 + (q[1] - N[i][1]) ** 2 + (q[2] - N[i][2]) ** 2]).sort((a, b) => a[1] - b[1]);
      for (let k = 1; k <= 3; k++) if (d[k][0] > i || R() < 0.3) E.push([i, d[k][0], R()]); }
    for (let k = 0; k < 40; k++) E.push([Math.floor(R() * N.length), Math.floor(R() * N.length), R(), 1]);
    this.N = N; this.E = E;
  }
  // draw(g, t, o): o.yaw, o.pitch, o.dist, o.cx, o.cy, o.scale, o.col ('gold'|'ice'), o.think (pulse rate), o.alpha
  draw(g, t, o = {}) {
    const cy_ = Math.cos(o.yaw ?? t * 0.3), sy_ = Math.sin(o.yaw ?? t * 0.3), cp = Math.cos(o.pitch ?? 0.25), sp = Math.sin(o.pitch ?? 0.25);
    const D = o.dist ?? 40, F = o.focal ?? 1100, cx = o.cx ?? W / 2, cy = o.cy ?? H / 2, ice = o.col === 'ice';
    const P = this.N.map(([x, y, z]) => { const x1 = cy_ * x + sy_ * z, z1 = -sy_ * x + cy_ * z, y1 = cp * y - sp * z1, z2 = sp * y + cp * z1 + D;
      return [cx + x1 * F / z2, cy + y1 * F / z2, z2]; });
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = o.alpha ?? 1; g.lineCap = 'round';
    const base = ice ? [90, 170, 255] : [255, 130, 30], hot = ice ? [220, 240, 255] : [255, 225, 160];
    const ph = (o.pulse ?? t * (o.think ?? 1.2));
    for (const [a, b, s, ax] of this.E) {
      const A = P[a], B = P[b]; if (A[2] < 2 || B[2] < 2) continue;
      const depth = clamp(1.4 - (A[2] + B[2]) / 2 / D * 0.9), wdt = (ax ? 1.2 : 1.6) * F / ((A[2] + B[2]) / 2) * 0.04;
      g.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},${0.16 + 0.3 * depth})`; g.lineWidth = Math.max(0.8, wdt);
      g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
      const u = (ph * (0.6 + s) + s * 7) % 1;                               // the pulse packet racing along the edge
      if (s > 0.35) { const x = lerp(A[0], B[0], u), y = lerp(A[1], B[1], u), r = Math.max(1.5, wdt * 2.4);
        const gr = g.createRadialGradient(x, y, 0, x, y, r * 3); gr.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},0.95)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6); }
    }
    for (let i = 0; i < P.length; i++) { const [x, y, z] = P[i]; if (z < 2) continue; const fire = ((ph * 0.7 + this.N[i][3] * 5) % 1) < 0.12 ? 1 : 0;
      const r = (1.5 + 2.5 * fire) * F / z * 0.05;
      g.fillStyle = fire ? `rgb(${hot})` : `rgba(${base},0.8)`; g.beginPath(); g.arc(x, y, Math.max(1, r), 0, TAU); g.fill(); }
    g.restore();
  }
}

// ================================================================ the electric meter (too cheap to meter)
// u 0..1: the needle's run down (0 = mid-scale, 0.6 = on the zero pin, 1 = fallen off its scale); spin = disc turns
export function meter(g, cx, cy, R, u, spin, t) {
  g.save();
  // the socket and the glass dome
  const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R * 1.25);
  gr.addColorStop(0, '#3a3634'); gr.addColorStop(1, '#0c0a0a'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.22, 0, TAU); g.fill();
  g.strokeStyle = '#6e645a'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, TAU); g.stroke();
  // the dial face
  g.fillStyle = '#efe4cc'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;                        // the scale arc (240 degrees)
  g.strokeStyle = '#1a1414'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R * 0.78, a0, a1); g.stroke();
  g.font = `${Math.round(R * 0.11)}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1a1414';
  for (let k = 0; k <= 10; k++) { const a = lerp(a0, a1, k / 10), big = k % 2 === 0;
    g.lineWidth = big ? 5 : 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78); g.lineTo(cx + Math.cos(a) * R * (big ? 0.66 : 0.71), cy + Math.sin(a) * R * (big ? 0.66 : 0.71)); g.stroke();
    if (big) g.fillText(String(k * 10), cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56); }
  g.fillStyle = '#c4101f'; g.beginPath(); g.arc(cx, cy, R * 0.78, a0 - 0.02, a0 + 0.14); g.lineTo(cx, cy); g.fill();   // the red zero band
  g.font = `${Math.round(R * 0.09)}px "Anton"`; g.fillStyle = '#1a1414'; g.fillText('kWh', cx, cy + R * 0.34);
  // the disc behind its window
  const wy = cy + R * 0.58; g.fillStyle = '#0b0909'; g.fillRect(cx - R * 0.3, wy - R * 0.07, R * 0.6, R * 0.14);
  g.save(); g.beginPath(); g.rect(cx - R * 0.3, wy - R * 0.07, R * 0.6, R * 0.14); g.clip();
  const dg = g.createLinearGradient(cx - R * 0.3, 0, cx + R * 0.3, 0); dg.addColorStop(0, '#555'); dg.addColorStop(0.5, '#ddd'); dg.addColorStop(1, '#555'); g.fillStyle = dg; g.fillRect(cx - R * 0.3, wy - R * 0.02, R * 0.6, R * 0.04);
  g.fillStyle = '#c4101f'; const mx = cx + (((spin % 1) + 1) % 1 - 0.5) * R * 0.6; g.fillRect(mx - 6, wy - R * 0.02, 12, R * 0.04); g.restore();
  // the needle: from mid-scale down to the zero pin, then off its pivot and falling
  const pinA = a0 + 0.05, aN = lerp(lerp(a0, a1, 0.62), pinA, ease.inCubic(clamp(u / 0.6)));
  let px = cx, py = cy, rot = aN;
  if (u > 0.6) { const f = (u - 0.6) / 0.4; px = cx - f * R * 0.08; py = cy + f * f * R * 1.2; rot = aN - f * 2.4; }
  g.save(); g.translate(px, py); g.rotate(rot);
  g.fillStyle = '#c4101f'; g.beginPath(); g.moveTo(-R * 0.12, -6); g.lineTo(R * 0.74, -2); g.lineTo(R * 0.74, 2); g.lineTo(-R * 0.12, 6); g.fill(); g.restore();
  if (u <= 0.6) { g.fillStyle = '#1a1414'; g.beginPath(); g.arc(cx, cy, R * 0.06, 0, TAU); g.fill(); }
  else { g.strokeStyle = '#1a1414'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R * 0.05, 0, TAU); g.stroke(); }   // the empty pivot
  // glass: a curved highlight and the reflection of the room
  g.globalCompositeOperation = 'lighter'; const hl = g.createLinearGradient(cx - R, cy - R, cx + R * 0.2, cy);
  hl.addColorStop(0, 'rgba(255,255,255,0.28)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.05)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.beginPath(); g.ellipse(cx - R * 0.25, cy - R * 0.35, R * 0.75, R * 0.45, -0.6, 0, TAU); g.fill();
  g.restore();
}

// ================================================================ the cost curve on the glass (Kentridge)
// steps: [[t_hit, level 0..1]]; the line runs across (x0..x1) with its end falling to each level on its hit; every
// earlier end stays as a smudged ghost (erased, not gone)
export function charcoal(g, t, steps, box, o = {}) {
  const [x0, y0, x1, y1] = box, R = rng(o.seed ?? 5);
  const live = steps.filter(s => t >= s[0]);
  if (!live.length) return;
  const path = (lv, seed, jit) => { const r = rng(seed), pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40;
    const yb = lerp(0.05, lv, Math.pow(u, 1.8)); pts.push([lerp(x0, x1, u) + (r() - 0.5) * jit, lerp(y0, y1, yb) + (r() - 0.5) * jit]); } return pts; };
  const stroke = (pts, col, wdt, a) => { g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = wdt; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); };
  g.save();
  live.forEach((s, k) => {
    const last = k === live.length - 1, age = t - s[0];
    if (!last) { for (let j = 0; j < 3; j++) stroke(path(s[1], 40 + k * 7 + j, 14), 'rgba(235,228,214,1)', 9, 0.07); stroke(path(s[1], 40 + k * 7, 5), 'rgba(235,228,214,1)', 3, 0.18); return; }
    const draw = clamp(age / 0.18), pts = path(s[1], 40 + k * 7, 3).slice(0, Math.max(2, Math.round(41 * draw)));
    for (let j = 0; j < 4; j++) stroke(pts.map(p => [p[0] + (R() - 0.5) * 2.5, p[1] + (R() - 0.5) * 2.5]), '#f4eadb', 3 + j * 0.8, 0.5);
    stroke(pts, '#fff8ea', 5, 0.95);
    if (draw >= 1) { const e = pts[pts.length - 1]; g.globalAlpha = 1; g.fillStyle = '#fff8ea'; g.beginPath(); g.arc(e[0], e[1], 9, 0, TAU); g.fill(); }
  });
  g.restore();
}
