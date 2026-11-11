// MELTDOWN v13: the one type system. Every sentence of the piece is set on the split-flap board's own big rows.
// A frame is a few short rows (function words and small nouns); the stressed word is marked with * in the script and is set in
// red. Its rows come in Godard/Mayakovsky order: the small rows settle on the PICKUP (a beat's fraction before the hit), the row
// with the stressed word flips ON the hit (that is the frame's beat, the song's hit), any rows after it follow on. One stress
// per frame, and the hit is on it.
import { W, H, clamp, ease } from '../lib/kit.js';
import { TILE, flapRow, hsh } from './meltdown8_flaps.js';

const TAU = Math.PI * 2;
export const PICKUP = 0.3;
export const NOPICK = new Set([99]);                                 // b79: the silence (b78-79) stays dead; POST-ECONOMICS. comes on the hit, not before it
export function parseRow(r) {                                          // 'A *B* C' -> { txt, red: [bool per char] }
  let txt = '', red = [], on = false;
  for (const ch of r) { if (ch === '*') { on = !on; continue; } txt += ch; red.push(on); }
  return { txt, red };
}
export function keyRow(rows) { const k = rows.findIndex(r => r.includes('*')); return k < 0 ? rows.length - 1 : k; }
export function frameOf(w) { const [b0, rows, hold, face, cite] = w; return { b0, rows, hold, face, cite, text: rows.map(r => r.replace(/\*/g, '')).join(' ') }; }

// the frame visible at beat b (its pickup counts), or null. `words` is sorted by beat.
export function frameNow(words, b, spb) {
  let q = null;
  for (const w of words) { const lead = w[3] === 'hook' || NOPICK.has(w[0]) ? 0 : PICKUP / spb; if (b >= w[0] - lead - 1e-6) q = w; }
  if (!q) return null;
  const f = frameOf(q);
  return b < f.b0 + f.hold ? { ...f, age: (b - f.b0) * spb } : null;
}

// cardBoard(g, t, f, region, o): the frame's rows on big flaps, centred in region [y0, y1].
// o.tw max tile width; o.housing colour; o.aspect cap (th <= tw * aspect); o.punch on the hit; o.credit style; o.rot tilt (rad)
export function cardBoard(g, t, f, region, o = {}) {
  const rows = f.rows.map(parseRow), n = rows.length, k = keyRow(f.rows), t0 = f.b0 * o.spb;
  const maxN = Math.max(...rows.map(r => r.txt.length));
  const availW = (o.width ?? 1000) - 40;
  let tw = Math.min(o.tw ?? 120, Math.floor(availW / maxN / 1.08)), gap = Math.max(3, Math.round(tw * 0.07));
  const [y0, y1] = region, pad = 26, gy = Math.round(Math.max(10, tw * 0.13)), creditH = f.cite ? 74 : 0;
  const availH = y1 - y0 - pad * 2 - creditH;
  let th = Math.min(Math.round(tw * (o.aspect ?? 2.9)), Math.floor((availH - (n - 1) * gy) / n));
  if (th < tw * 1.5) { tw = Math.max(30, Math.floor(th / 1.5)); gap = Math.max(3, Math.round(tw * 0.07)); }
  th &= ~1;
  const hh = n * th + (n - 1) * gy, bw = maxN * (tw + gap) + 52, cy = (y0 + y1) / 2 - creditH / 2;
  const punch = o.punch === false ? 1 : 1 + 0.045 * Math.exp(-Math.max(0, t - t0) * 14);
  g.save(); g.translate(W / 2, cy); if (o.rot) g.rotate(o.rot); g.scale(punch, punch); g.translate(-W / 2, -cy);
  const bx = W / 2 - bw / 2, by = cy - hh / 2 - pad;
  // the housing: a steel strip, rivets, the credit on its foot
  const hg = g.createLinearGradient(0, by, 0, by + hh + pad * 2 + creditH); hg.addColorStop(0, o.housing || '#12100e'); hg.addColorStop(1, o.housing2 || '#070505');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bx + 6, by + 8, bw, hh + pad * 2 + creditH);
  g.fillStyle = hg; g.fillRect(bx, by, bw, hh + pad * 2 + creditH);
  g.strokeStyle = o.edge || 'rgba(255,240,220,0.12)'; g.lineWidth = 3; g.strokeRect(bx + 5, by + 5, bw - 10, hh + pad * 2 + creditH - 10);
  g.fillStyle = 'rgba(200,190,170,0.32)'; for (const [rx, ry] of [[bx + 14, by + 14], [bx + bw - 14, by + 14], [bx + 14, by + hh + pad * 2 + creditH - 14], [bx + bw - 14, by + hh + pad * 2 + creditH - 14]]) { g.beginPath(); g.arc(rx, ry, 4, 0, TAU); g.fill(); }
  rows.forEach((r, i) => {
    const start = i < k ? t0 - (o.nopick ? 0.02 : PICKUP) + i * 0.045 : i === k ? t0 - 0.01 : t0 + 0.11 * (i - k);
    const s = r.txt, pals = r.red.map(x => x ? TILE.creamRed : TILE.cream);
    flapRow(g, s, W / 2, by + pad + th / 2 + i * (th + gy), tw, th, { gap, pal: TILE.cream, pals, t, t0: start, stagger: 0.008, dur: 0.07, hideBefore: true });
  });
  if (f.cite) {                                                          // the credit: real type on the housing's foot, never on flaps
    g.font = '32px "Michroma"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = f.cite, fs = 32; while (g.measureText(s).width > bw - 60 && fs > 18) { fs -= 2; g.font = `${fs}px "Michroma"`; }
    const yy = by + pad + hh + pad * 0.4 + creditH / 2;
    g.fillStyle = o.citeCol || '#e8dcc0'; g.globalAlpha = 0.95; g.fillText(s, W / 2, yy); g.globalAlpha = 1;
    g.fillStyle = 'rgba(196,16,31,0.9)'; g.fillRect(W / 2 - 46, yy - 30, 92, 4);
  }
  g.restore();
  return { by: cy - hh / 2 - pad, bottom: cy + hh / 2 + pad + creditH, th, tw };
}
