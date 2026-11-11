// stress_board.js (SCANSION c2): a sentence set as a LADDER on the split-flap board, from engine/score/place.py's data.
//
// What it does that a width-wrapped board does not (see research/capabilities/scansion.md):
//   * one stress group a row: a content word with the function words that lead into it; no row ends on a function word and none
//     is a function word alone;
//   * the stressed word at full flap height, the function words in HALF-HEIGHT flaps on the same baseline (El Lissitzky, For the
//     Voice, 1923: big type for the stressed and shouted words, small for the rest);
//   * the rows step down and to the right (Mayakovsky's lesenka), so the eye follows the line in its own order;
//   * each row's stressed word lands on its beat; the function words flip in, in order, in the speech time before it (about 110 ms
//     a weak syllable), not on one fixed cascade;
//   * the nuclear stress is a red letter on a cream flap (the board's own marking in v13); a FOCUS word (a contrast: LEAST, SAME)
//     is a solid red flap with a cream letter, one step louder.
//
//   import { stressBoard } from '../lib/fx/stress_board.js';
//   stressBoard(g, t, placed, [y0, y1], { spb, cite: 'HAZ, 3 JUN 2024', housing: '#0c1620' });
//     placed  engine.score.place.place(card) as JSON: rows[{words[{t, small, settle (beat), dur (s), stressed, nuclear, focus}], beat, start}]
//     t       seconds; o.spb seconds a beat; o.tw the widest flap; o.width the board's width; o.housing / o.housing2 / o.edge / o.citeCol
// It takes the flap tile from the MELTDOWN board's own module (scenes/meltdown8_flaps.js), so the object is the piece's own.
import { W } from '../kit.js';
import { TILE, tile, hsh, FLAPCH } from '../../scenes/meltdown8_flaps.js';

const TAU = Math.PI * 2;
const FLIP_S = 0.07;

function layout(rows, tw, th, o) {
  const gap = Math.max(3, Math.round(tw * 0.07)), stw = Math.round(tw * 0.62), sth = (Math.round(th * 0.5)) & ~1, sp = Math.round(tw * 0.5);
  const wordW = w => { const n = [...w.t.replace(/[^A-Za-z0-9'’.,:!?$%&-]/g, '')].length; return n * ((w.small ? stw : tw) + gap) - gap; };
  const rw = rows.map(r => r.words.reduce((a, w, i) => a + wordW(w) + (i ? sp : 0), 0));
  return { gap, stw, sth, sp, wordW, rw };
}

export function stressBoard(g, t, pl, region, o = {}) {
  const rows = pl.rows, K = rows.length, spb = o.spb;
  const availW = (o.width ?? 1010) - 50;
  // the biggest flap that fits the widest row (the widest row in big-flap widths comes from place.py as `units`)
  const maxUnits = Math.max(...rows.map(r => r.units));
  let tw = Math.min(o.tw ?? 120, Math.floor(availW / (maxUnits * 1.09 + (K > 1 ? 0.7 : 0))));
  const [y0, y1] = region, pad = 28, creditH = o.cite ? 74 : 0, gy = Math.max(10, Math.round(tw * 0.12));
  const availH = y1 - y0 - pad * 2 - creditH;
  let th = Math.min(Math.round(tw * (o.aspect ?? 2.5)), Math.floor((availH - (K - 1) * gy) / K));
  if (th < tw * 1.4) { tw = Math.max(28, Math.floor(th / 1.4)); }
  th &= ~1;
  const L = layout(rows, tw, th, o);
  const maxW = Math.max(...L.rw);
  const slack = Math.max(0, availW - maxW);
  const step = K > 1 ? Math.min(Math.round(slack / (K - 1)), o.stair ?? 96) : 0;    // the lesenka: each row one step to the right
  const blockW = maxW + step * (K - 1);
  const hh = K * th + (K - 1) * gy, bw = blockW + 56, cy = (y0 + y1) / 2 - creditH / 2;
  const tNuc = (rows.find(r => r.nuclear) || rows[K - 1]).beat * spb;
  const punch = o.punch === false ? 1 : 1 + 0.04 * Math.exp(-Math.max(0, t - tNuc) * 14) * (t >= tNuc - 0.01 ? 1 : 0);
  g.save(); g.translate(W / 2, cy); if (o.rot) g.rotate(o.rot); g.scale(punch, punch); g.translate(-W / 2, -cy);
  const bx = W / 2 - bw / 2, by = cy - hh / 2 - pad, bh = hh + pad * 2 + creditH;
  const hg = g.createLinearGradient(0, by, 0, by + bh); hg.addColorStop(0, o.housing || '#12100e'); hg.addColorStop(1, o.housing2 || '#070505');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bx + 6, by + 8, bw, bh);
  g.fillStyle = hg; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = o.edge || 'rgba(255,240,220,0.12)'; g.lineWidth = 3; g.strokeRect(bx + 5, by + 5, bw - 10, bh - 10);
  g.fillStyle = 'rgba(200,190,170,0.32)'; for (const [rx, ry] of [[bx + 14, by + 14], [bx + bw - 14, by + 14], [bx + 14, by + bh - 14], [bx + bw - 14, by + bh - 14]]) { g.beginPath(); g.arc(rx, ry, 4, 0, TAU); g.fill(); }
  rows.forEach((r, i) => {
    const rowTop = by + pad + i * (th + gy), rowBase = rowTop + th;
    let x = bx + 28 + i * step + (blockW - (L.rw[i] + i * step)) * (K > 1 && slack < 1 ? 0.5 : 0);
    if (K === 1) x = W / 2 - L.rw[0] / 2;
    r.words.forEach((w, wi) => {
      const txt = w.t.replace(/[^A-Za-z0-9'’.,:!?$%&-]/g, '').toUpperCase(), n = txt.length;
      const big = !w.small, cw = big ? tw : L.stw, chh = big ? th : L.sth, ty = rowBase - chh;   // small flaps sit on the big flaps' baseline
      const pal = !big ? TILE.cream : w.focus ? TILE.red : (w.nuclear || w.stressed && w.nuclear) ? TILE.creamRed : (w.stressed && o.redAllStress) ? TILE.creamRed : TILE.cream;
      // finish time of the word's last char: a big word ends ON its stress (the beat), a small word at its own onset + length
      const stressT = r.beat * spb;
      const fin = big ? stressT : w.settle * spb + w.dur;
      const stag = big ? 0.012 : Math.min(0.03, w.dur / Math.max(n, 1));
      for (let c = 0; c < n; c++) {
        const done = fin - (n - 1 - c) * stag, a = t - (done - FLIP_S), cx = x + c * (cw + L.gap);
        if (a < 0) { tile(g, cx, ty, cw, chh, ' ', TILE.dim, {}); continue; }          // an empty flap, waiting
        let o2 = {};
        if (a < FLIP_S) o2 = { flip: 0.35 + 0.65 * a / FLIP_S, prev: FLAPCH[Math.floor(hsh(c + wi * 7, 7 + Math.floor(t * 30)) * FLAPCH.length)] };
        tile(g, cx, ty, cw, chh, txt[c], pal, o2);
      }
      x += n * (cw + L.gap) - L.gap + L.sp;
    });
  });
  if (o.cite) {
    g.font = '32px "Michroma"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = o.cite, fs = 32; while (g.measureText(s).width > bw - 60 && fs > 18) { fs -= 2; g.font = `${fs}px "Michroma"`; }
    const yy = by + pad + hh + pad * 0.4 + creditH / 2;
    g.fillStyle = o.citeCol || '#e8dcc0'; g.globalAlpha = 0.95; g.fillText(s, W / 2, yy); g.globalAlpha = 1;
    g.fillStyle = 'rgba(196,16,31,0.9)'; g.fillRect(W / 2 - 46, yy - 30, 92, 4);
  }
  g.restore();
  return { by, bottom: by + bh, th, tw };
}
