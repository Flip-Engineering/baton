// 1776 / SECOND INDEPENDENCE (v5, parchment): 1776 again. Who fought? Farmers, mechanics, sailors: common people broke an empire.
// Chicago, July 21, 2024: when in the course of events. Same words, same people, one history. Who signs now? The ink is red.
// Who declares? The working class declares a second independence. The ACP mark pressed in as the seal.
// v6: the page is real engrossed lettering written by a quill: the 1776 preamble and signers, then (at CHICAGO) a second
// sheet with the Party Declaration's own words, then a wall of working-class signatures.
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, line,
  Finish, sigil, signoff, closer, outCanvas, seq, cue, BRAND, tinted } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const FD = '../node_modules/@fontsource';
const HAND = { fell: 'IM Fell English', sc: 'IM Fell English SC', copper: 'Pinyon Script',
  delafield: 'Mrs Saint Delafield', herr: 'Herr Von Muellerhoff', doulaise: 'Monsieur La Doulaise', aurore: 'La Belle Aurore',
  vibes: 'Great Vibes', apple: 'Homemade Apple' };
await Promise.all([
  ['IM Fell English', 'im-fell-english/files/im-fell-english-latin-400-normal.woff2', {}],
  ['IM Fell English', 'im-fell-english/files/im-fell-english-latin-400-italic.woff2', { style: 'italic' }],
  ['IM Fell English SC', 'im-fell-english-sc/files/im-fell-english-sc-latin-400-normal.woff2', {}],
  ['Pinyon Script', 'pinyon-script/files/pinyon-script-latin-400-normal.woff2', {}],
  ['Mrs Saint Delafield', 'mrs-saint-delafield/files/mrs-saint-delafield-latin-400-normal.woff2', {}],
  ['Herr Von Muellerhoff', 'herr-von-muellerhoff/files/herr-von-muellerhoff-latin-400-normal.woff2', {}],
  ['Monsieur La Doulaise', 'monsieur-la-doulaise/files/monsieur-la-doulaise-latin-400-normal.woff2', {}],
  ['La Belle Aurore', 'la-belle-aurore/files/la-belle-aurore-latin-400-normal.woff2', {}],
  ['Great Vibes', 'great-vibes/files/great-vibes-latin-400-normal.woff2', {}],
  ['Homemade Apple', 'homemade-apple/files/homemade-apple-latin-400-normal.woff2', {}],
  ['Playfair Display', 'playfair-display/files/playfair-display-latin-900-normal.woff2', { weight: '900' }],   // period display face for cues and stamps
].map(async ([name, file, desc]) => document.fonts.add(await new FontFace(name, `url(${FD}/${file})`, desc).load())));
const B = await loadBeats('unfinished2');
const logo = await loadImage('../assets/acp_logo_dark.png');
const finish = new Finish(1776);
const INKC = '#2b1a10', RED = C.red2, WAX = '#a3141f';

const CUES = [                      // ink over the fife and side drum; cream on red after the flood
  ...seq(0, [[2, '1776 AGAIN.', 1], [2, 'WHO FOUGHT?'], [1, 'FARMERS.'], [1, 'MECHANICS.'], [1, 'SAILORS.'], [2, 'COMMON PEOPLE.', 1],
    [1, 'BROKE'], [2, 'AN EMPIRE.', 1], [1, "A PEOPLE'S"], [2, 'REVOLUTION.', 1], [1, 'THE FIRST']]),
  ...seq(48, [[2, 'THE WORKING CLASS', 1], [2, 'DECLARES.', 1], [2, 'A SECOND'], [2, 'INDEPENDENCE.', 1], [4, '1776 AGAIN.', 1]]),
];
const STAMPS = [                    // letterpress words, stamped on the beat
  ...seq(16, [[2, 'INDEPENDENCE.', 1], [1, 'CHICAGO.', 1], [2, 'JULY 21, 2024.'], [1, 'WHEN IN'], [1, 'THE COURSE'], [1, 'OF EVENTS…'],
    [1, 'A LONG TRAIN'], [1, 'OF ABUSES.'], [1, 'INTOLERABLE.', 1], [1, 'SAME WORDS.'], [2, 'SAME PEOPLE.', 1], [2, 'ONE HISTORY.', 1]]),
  ...seq(32, [[1, 'WHO SIGNS NOW?', 1], [1, 'RAIL WORKERS.'], [1, 'TRUCKERS.'], [1, 'CODERS.'], [2, 'SMALL FARMERS.', 1]]),   // 38: no text, the crowd shouts SIGN!
  ...seq(39, [[1, 'THE INK'], [1, 'IS RED.', 1], [1, 'EVERY HAND.'], [1, 'EVERY TOWN.'], [1, 'EVERY STATE.'], [2, 'WHO DECLARES?'], [2, 'WHO DECLARES?', 1]]),
];
const CUE_Y = 1560, BAND = [1370, 1610];
const DISPLAY = { family: 'Playfair Display', weight: 900 };     // the cue/stamp band is kept clear of lettering until the tide takes it

// ---------------------------------------------------------------- parchment
function parchment(seed, c0, c1, c2) {
  const p = document.createElement('canvas'); p.width = W; p.height = H;
  const g = p.getContext('2d'), r = rng(seed);
  const gr = g.createRadialGradient(W / 2, H * 0.45, 200, W / 2, H / 2, H * 0.78);
  gr.addColorStop(0, c0); gr.addColorStop(0.65, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const lo = document.createElement('canvas'); lo.width = 108; lo.height = 192; const gl = lo.getContext('2d');   // mottling, drawn small
  for (let i = 0; i < 260; i++) { gl.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${30 + r() * 20},${0.015 + r() * 0.03})`;   // and scaled up soft
    gl.beginPath(); gl.ellipse(r() * 108, r() * 192, lerp(3, 22, r() ** 2), lerp(2, 14, r() ** 2), r() * 3, 0, 7); gl.fill(); }
  g.imageSmoothingQuality = 'high'; g.drawImage(lo, 0, 0, W, H);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${100 + r() * 50},${70 + r() * 30},${35 + r() * 20},${0.03 + r() * 0.05})`;
    g.beginPath(); g.arc(r() * W, r() * H, lerp(1, 5, r() ** 2), 0, 7); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {                                   // fibres
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 4 + r() * 22;
    g.strokeStyle = r() < 0.5 ? `rgba(110,80,45,${0.05 + r() * 0.08})` : `rgba(255,248,228,${0.06 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 14; i++) {                                     // foxing
    const x = r() * W, y = r() * H, rad = 6 + r() * 26, fg = g.createRadialGradient(x, y, 0, x, y, rad);
    fg.addColorStop(0, 'rgba(140,90,40,0.22)'); fg.addColorStop(1, 'rgba(140,90,40,0)'); g.fillStyle = fg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return p;
}
const PAPER1 = parchment(4, '#f0e2c2', '#dfc89c', '#8a6a3c');
const PAPER2 = parchment(21, '#f5ead2', '#e6d4ae', '#9a7a4c');     // the 2024 sheet: same skin, a little fresher

// ---------------------------------------------------------------- inked items: text pre-rendered once, revealed by the quill
const INK = { iron: '#24150b', brown: '#3a2414', black: '#16100c' };
function inkItem({ text, family, size, x, y, align = 'left', color = INK.iron, t0, t1, rot = 0, weight = 0, style = '', paraph = null, red = false, alpha = 1, dry = true, blot = 0 }) {
  const m = document.createElement('canvas').getContext('2d');
  const font = `${style} ${size}px "${family}"`.trim();
  m.font = font;
  const mt = m.measureText(text);
  const padX = size * 0.5, asc = Math.max(mt.actualBoundingBoxAscent, size * 0.8) + 12, desc = Math.max(mt.actualBoundingBoxDescent, size * 0.3) + 12;
  const tw = Math.max(mt.width, mt.actualBoundingBoxRight) + Math.max(0, mt.actualBoundingBoxLeft);
  const extraW = paraph ? paraph.w : 0, extraH = paraph ? paraph.h : 0;
  const cw = Math.ceil(tw + padX * 2 + extraW), ch = Math.ceil(asc + desc + extraH);
  const ox = padX + Math.max(0, mt.actualBoundingBoxLeft), oy = asc;                   // text origin inside the item canvas
  const draw = col => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.font = font; g.fillStyle = col; g.strokeStyle = col; g.lineJoin = 'round'; g.lineCap = 'round';
    g.globalAlpha = alpha;
    g.shadowColor = col; g.shadowBlur = 1.6;                                           // ink wicking into the skin
    g.fillText(text, ox, oy);
    if (weight) { g.lineWidth = weight; g.strokeText(text, ox, oy); }
    if (paraph) paraph.draw(g, ox, oy, tw, col);
    if (blot) {                                                                        // fresh dip: the first strokes run full and pool darker
      g.save(); g.globalCompositeOperation = 'source-atop'; g.shadowBlur = 0;
      const bx = ox + size * 0.15, by = oy - size * 0.25, pg = g.createRadialGradient(bx, by, 0, bx, by, size * 0.32);
      pg.addColorStop(0, 'rgba(4,2,1,0.4)'); pg.addColorStop(1, 'rgba(4,2,1,0)');
      g.fillStyle = pg; g.fillRect(bx - size * 0.5, by - size * 0.5, size, size); g.restore();
    }
    g.globalAlpha = 1;
    if (dry) {
      g.shadowBlur = 0; g.globalCompositeOperation = 'source-atop';                   // the quill runs dry along the line
      const lg = g.createLinearGradient(0, 0, cw, 0);
      lg.addColorStop(0, 'rgba(10,5,2,0.25)'); lg.addColorStop(0.5, 'rgba(10,5,2,0)'); lg.addColorStop(1, 'rgba(150,110,70,0.22)');
      g.fillStyle = lg; g.fillRect(0, 0, cw, ch);
    }
    return c;
  };
  const cv = draw(color), cvRed = red ? draw('#b3121e') : null;
  // per-column ink: where the nib sits, and how long each column takes to write
  const id = cv.getContext('2d').getImageData(0, 0, cw, ch).data;
  const nibY = new Float32Array(cw), cum = new Float32Array(cw + 1);
  let lastY = oy - size * 0.2;
  for (let xx = 0; xx < cw; xx++) {
    let s = 0, sy = 0;
    for (let yy = 0; yy < ch; yy += 2) { const a = id[(yy * cw + xx) * 4 + 3]; if (a > 60) { s++; sy += yy; } }
    if (s) lastY = lerp(lastY, sy / s, 0.6);
    nibY[xx] = lastY; cum[xx + 1] = cum[xx] + 0.35 + Math.min(s, 20);            // blank columns still take a little time
  }
  let left = x - ox;
  if (align === 'center') left = x - ox - tw / 2 - extraW / 2; else if (align === 'right') left = x - ox - tw;
  return { cv, cvRed, cw, ch, left, top: y - oy, rot, t0, t1, nibY, cum, total: cum[cw], redK: 0, text, ox, oy, tw };
}
function revealCol(it, u) {                                             // column reached at progress u (ink-weighted)
  const target = u * it.total; let lo = 0, hi = it.cw;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (it.cum[mid] < target) lo = mid + 1; else hi = mid; }
  return lo;
}
function toPage(it, lx, ly) {                                           // item-local -> page coords
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  return [it.left + lx * c - ly * s, it.top + lx * s + ly * c];
}
// the reveal edge is feathered: solid up to col-FE, then a FE+2 px strip faded through a horizontal alpha ramp
const FE = 8, STRIP = document.createElement('canvas'); STRIP.width = FE + 2; STRIP.height = 640;
const gStrip = STRIP.getContext('2d'), RAMP = gStrip.createLinearGradient(0, 0, FE + 2, 0);
RAMP.addColorStop(0, 'rgba(0,0,0,1)'); RAMP.addColorStop(1, 'rgba(0,0,0,0)');
function reveal(g, cv, col, cw, ch, live, alpha) {
  g.globalAlpha = alpha;
  const solid = live ? Math.max(0, col - FE) : col;
  if (solid > 0) g.drawImage(cv, 0, 0, solid, ch, 0, 0, solid, ch);
  if (live) {
    const sw = Math.min(FE + 2, cw - solid);
    if (sw > 0) {
      gStrip.globalCompositeOperation = 'copy'; gStrip.drawImage(cv, solid, 0, sw, ch, 0, 0, sw, ch);
      gStrip.globalCompositeOperation = 'destination-in'; gStrip.fillStyle = RAMP; gStrip.fillRect(0, 0, FE + 2, ch);
      g.drawImage(STRIP, 0, 0, sw, ch, solid, 0, sw, ch);
    }
  }
  g.globalAlpha = 1;
}
// draw a page's items at beat b into g; returns the live nib (page coords) or null
function drawItems(g, items, b) {
  let nib = null;
  for (const it of items) {
    if (b < it.t0) continue;
    const u = b >= it.t1 ? 1 : clamp((b - it.t0) / (it.t1 - it.t0));
    const col = u >= 1 ? it.cw : revealCol(it, u);
    if (col <= 0) continue;
    g.save(); g.translate(it.left, it.top); if (it.rot) g.rotate(it.rot);
    const rm = it.cvRed ? it.redK : 0;
    if (rm < 1) reveal(g, it.cv, col, it.cw, it.ch, u < 1, 1);
    if (rm > 0) reveal(g, it.cvRed, col, it.cw, it.ch, u < 1, rm);
    if (u < 1) {                                                        // wet ink at the nib: a small dark bead with a glint
      const ny = it.nibY[Math.min(col, it.cw - 1)];
      const wg = g.createRadialGradient(col, ny, 0, col, ny, 5);
      wg.addColorStop(0, rm > 0.5 ? 'rgba(110,6,14,0.6)' : 'rgba(10,5,2,0.6)'); wg.addColorStop(1, 'rgba(10,5,2,0)');
      g.fillStyle = wg; g.fillRect(col - 5, ny - 5, 10, 10);
      g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(col - 2, ny - 2, 1, 1);
      nib = { p: toPage(it, col, ny), it, u };
    }
    g.restore();
  }
  return nib;
}
function quill(g, nib, b) {                                             // the feather and its shadow
  if (!nib) return;
  if (nib.p[1] > BAND[0] - 20 && nib.p[1] < BAND[1]) return;         // never under a cue or stamp
  const [x, y] = nib.p, wob = Math.sin(b * 11.3) * 0.05 + Math.sin(b * 4.1) * 0.04;
  const ang = -0.82 + wob, L = 400;
  const draw = (dx, dy, shadow) => {
    g.save(); g.translate(x + dx, y + dy); g.rotate(ang);
    g.beginPath(); g.moveTo(L * 0.22, 0);                             // vane
    g.bezierCurveTo(L * 0.45, -34, L * 0.8, -40, L * 1.02, -10);
    g.lineTo(L * 1.0, 4);
    g.bezierCurveTo(L * 0.8, 22, L * 0.5, 20, L * 0.22, 0); g.closePath();
    if (shadow) { g.fillStyle = 'rgba(40,20,5,0.16)'; g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(40,20,5,0.16)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(L, 0); g.stroke(); }
    else {
      const vg = g.createLinearGradient(0, -40, 0, 22); vg.addColorStop(0, '#fbf7ee'); vg.addColorStop(0.55, '#e9e0cf'); vg.addColorStop(1, '#b9ab93');
      g.fillStyle = vg; g.fill(); g.strokeStyle = 'rgba(90,70,45,0.55)'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(120,105,80,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < 26; k++) { const px = L * (0.28 + k * 0.028); g.beginPath(); g.moveTo(px, 0); g.lineTo(px + 22, -30 + Math.abs(k - 18) * 0.6); g.stroke();
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px + 18, 16 - Math.abs(k - 18) * 0.3); g.stroke(); }
      g.strokeStyle = '#d8ccb4'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 0); g.lineTo(L * 1.01, -3); g.stroke();   // shaft
      g.strokeStyle = '#5a4630'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(24, 0); g.stroke();       // cut nib, inked
    }
    g.restore();
  };
  draw(26, 34, true); draw(0, 0, false);
}
function wrap(text, family, size, maxW, style = '') {
  const m = document.createElement('canvas').getContext('2d'); m.font = `${style} ${size}px "${family}"`.trim();
  const out = []; let cur = '';
  for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (m.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}
// lay out a block of copperplate, written word by word between beats b0 and b1. Each word is its own stroke of the pen:
// a hair off the ruled baseline, a hair off square, and inked by a quill that is dipped every 5-7 words (black and wet
// just after the dip, drying toward brown before the next one, a small bead where each dip lands).
const mixHex = (a, b, u) => '#' + [1, 3, 5].map(i => Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), u)).toString(16).padStart(2, '0')).join('');
const DIP = { r: rng(1787), left: 0, n: 0 }, MEAS = document.createElement('canvas').getContext('2d');
function block(items, lines, { x, y, lh, size, family = HAND.copper, b0, b1, indent = 0 }) {
  const n = lines.length, per = (b1 - b0) / n, r = DIP.r;
  MEAS.font = `${size}px "${family}"`; const sp = MEAS.measureText(' ').width;
  lines.forEach((ln, i) => {
    const words = ln.split(' '), ws = words.map(w => MEAS.measureText(w).width);
    const tot = ws.reduce((a, c) => a + c, 0) + sp * (words.length - 1), lt0 = b0 + i * per, ldur = 0.9 * per;
    let wx = x + (i === 0 ? indent : 0), acc = 0;
    words.forEach((w, j) => {
      let blot = 0;
      if (DIP.left <= 0) { DIP.left = 5 + Math.floor(r() * 3); DIP.n = 0; blot = 1 + r(); }
      const fade = DIP.n < 2 ? 0 : clamp((DIP.n - 1) / (DIP.left + DIP.n - 2));
      DIP.left--; DIP.n++;
      items.push(inkItem({ text: w, family, size, x: wx, y: y + i * lh + (r() - 0.5) * 2.5, rot: (r() - 0.5) * 0.006,
        color: mixHex(INK.black, INK.brown, fade), alpha: lerp(1, 0.82, fade), dry: false, blot,
        t0: lt0 + ldur * acc / tot, t1: lt0 + ldur * (acc + ws[j]) / tot }));
      acc += ws[j] + sp; wx += ws[j] + sp * (1 + (r() - 0.5) * 0.18);
    });
  });
  return y + n * lh;
}
// an underscore pulled with the pen: pressure swells through the middle, drawn as the nib travels; returns the tip
function underline(g, x0, x1, yb, seed, u, col = INK.black) {
  if (u <= 0) return null;
  const r = rng(seed), bend = (r() - 0.5) * 10, N = 40, f = t => [lerp(x0, x1, t), yb + bend * Math.sin(t * Math.PI) - t * 5];
  const m = Math.min(N, u * N);
  g.save(); g.strokeStyle = col; g.lineCap = 'round'; g.shadowColor = col; g.shadowBlur = 1.2;
  for (let i = 1; i <= Math.ceil(m); i++) {
    const ta = (i - 1) / N, tb = Math.min(i, m) / N, a = f(ta), b = f(tb);
    g.lineWidth = 1.2 + 3.2 * Math.sin(tb * Math.PI); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  g.restore();
  return f(m / N);
}
function paraphHancock(g, ox, oy, tw, col) {                           // the looping flourish under the name
  g.save(); g.shadowBlur = 0; g.strokeStyle = col;
  const pts = [], y0 = oy + 34;
  for (let t = 0; t <= 1; t += 0.004) {
    const x = ox - 10 + t * (tw + 30), yy = y0 + 22 * Math.sin(t * Math.PI * 9) * (1 - t) + 18 * t;
    pts.push([x + 26 * Math.cos(t * Math.PI * 9) * (1 - t) * 0.6, yy]);
  }
  for (let i = 1; i < pts.length; i++) { const t = i / pts.length; g.lineWidth = 1.2 + 4.2 * Math.abs(Math.sin(t * Math.PI * 9)) * (1 - t * 0.7);
    g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke(); }
  g.restore();
}
function paraphSwash(seed) {                                           // an underline swash for an ordinary signature
  return (g, ox, oy, tw, col) => {
    const r = rng(seed); g.save(); g.shadowBlur = 0; g.strokeStyle = col; g.lineCap = 'round';
    const x0 = ox + tw * lerp(0.0, 0.2, r()), x1 = ox + tw * lerp(0.85, 1.05, r()), yb = oy + 16 + r() * 10, bend = (r() - 0.5) * 24;
    const N = 40, f = t => [lerp(x0, x1, t), yb + bend * Math.sin(t * Math.PI) - t * 8];
    for (let i = 1; i <= N; i++) { const a = f((i - 1) / N), b = f(i / N);
      g.lineWidth = 1 + 3 * Math.sin(i / N * Math.PI); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.restore();
  };
}

// ---------------------------------------------------------------- PAGE 1: In Congress, July 4, 1776
const P1 = [];
P1.push(inkItem({ text: 'IN CONGRESS, JULY 4, 1776.', family: HAND.sc, size: 50, x: W / 2, y: 150, align: 'center', color: INK.black, t0: -3, t1: -2.9 }));
P1.push(inkItem({ text: 'The unanimous Declaration', family: HAND.fell, size: 78, x: W / 2, y: 245, align: 'center', color: INK.black, t0: -3, t1: -2.9 }));
P1.push(inkItem({ text: 'of the thirteen united States of America,', family: HAND.fell, style: 'italic', size: 44, x: W / 2, y: 305, align: 'center', color: INK.iron, t0: -3, t1: -2.9 }));
P1.push(inkItem({ text: 'When in the Course of human events,', family: HAND.copper, size: 72, x: 70, y: 410, color: INK.iron, t0: -1.5, t1: 2.1 }));
const PREAMBLE = 'it becomes necessary for one people to dissolve the political bands which have connected them with another, and to assume among the powers of the earth, the separate and equal station to which the Laws of Nature and of Nature’s God entitle them, a decent respect to the opinions of mankind requires that they should declare the causes which impel them to the separation.';
const TRUTHS = 'We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness.';
{
  const size = 48, lh = 57, a = wrap(PREAMBLE, HAND.copper, size, 910);
  const y = block(P1, a, { x: 90, y: 488, lh, size, b0: 2.3, b1: 2.3 + a.length * 0.52 });
  block(P1, wrap(TRUTHS, HAND.copper, size, 870), { x: 90, y: y + 6, lh, size, b0: 2.4 + a.length * 0.52, b1: 9.0, indent: 40 });
}
// the signers: Hancock large on BROKE / AN EMPIRE, then the others below the cue band
P1.push(inkItem({ text: 'John Hancock', family: HAND.delafield, size: 136, x: W / 2 + 20, y: 1290, align: 'center', color: INK.black, weight: 1.2,
  t0: 9.0, t1: 11.0, paraph: { w: 30, h: 70, draw: paraphHancock } }));
const SIGNERS = [['Saml. Adams', HAND.herr], ['John Adams', HAND.delafield], ['Benj. Franklin', HAND.doulaise], ['Th. Jefferson', HAND.herr],
  ['Roger Sherman', HAND.delafield], ['Robt. Morris', HAND.herr], ['Benja. Rush', HAND.delafield], ['R. H. Lee', HAND.herr],
  ['Btn. Gwinnett', HAND.delafield], ['Josiah Bartlett', HAND.herr], ['Step. Hopkins', HAND.delafield], ['Geo. Wythe', HAND.herr]];
{ const r = rng(1776);                                              // 3 rows x 4 columns, inside the safe area (zoom + shake never crop)
  const sz = fam => fam === HAND.doulaise ? 40 : 50, wd = ([n, f]) => (MEAS.font = `${sz(f)}px "${f}"`, MEAS.measureText(n).width);
  for (let row = 0; row < 3; row++) {                              // each row justified across 70..W-70: even gaps, no collisions
    const names = SIGNERS.slice(row * 4, row * 4 + 4), ws = names.map(wd);
    const gap = (W - 140 - ws.reduce((a, c) => a + c, 0)) / 3;
    let gx = 70 + (row === 1 ? 18 : row === 2 ? -10 : 0);
    names.forEach(([name, fam], c) => {
      const i = row * 4 + c, y = Math.min(1840, 1680 + row * 78 + (r() - 0.5) * 8);
      const it = inkItem({ text: name, family: fam, size: sz(fam), x: gx + (r() - 0.5) * 10, y, color: [INK.iron, INK.brown, INK.black][i % 3],
        rot: (r() - 0.5) * 0.03, t0: 11.0 + i * 0.45, t1: 11.0 + i * 0.45 + 0.42 });
      it.left = clamp(it.left, 40 - it.ox, W - 40 - it.ox - it.tw);
      P1.push(it); gx += ws[c] + gap;
    });
  }
}

// ---------------------------------------------------------------- PAGE 2: Chicago, July 21, 2024 (DECL's own words, same hand)
const P2 = [];
P2.push(inkItem({ text: 'Chicago, July 21, 2024.', family: HAND.copper, size: 84, x: W / 2 - 30, y: 215, align: 'center', color: INK.black, t0: 18.0, t1: 19.6 }));
P2.push(inkItem({ text: 'THE DECLARATION', family: HAND.sc, size: 58, x: W / 2, y: 300, align: 'center', color: INK.black, t0: 19.6, t1: 20.3 }));
P2.push(inkItem({ text: 'of the American Communist Party', family: HAND.fell, style: 'italic', size: 44, x: W / 2, y: 356, align: 'center', color: INK.iron, t0: 20.3, t1: 20.95 }));
P2.push(inkItem({ text: 'When in the course of events,', family: HAND.copper, size: 84, x: 80, y: 470, color: INK.iron, t0: 21.0, t1: 23.2 }));
{
  const size = 54, lh = 66;
  let y = block(P2, wrap('a Communist Party proves itself to be incapable of meeting a new development of history, it evidently must be reconstituted…', HAND.copper, size, 910),
    { x: 90, y: 550, lh, size, b0: 23.2, b1: 24.1 });
  y = block(P2, wrap('…a long train of abuse, corruption and usurpations…', HAND.copper, 62, 900), { x: 90, y: y + 22, lh: 74, size: 62, b0: 24.1, b1: 25.3, indent: 40 });
  y = block(P2, wrap('In a given country there can only exist one Communist Party, insofar as a given country can only have one history.', HAND.copper, 62, 900),
    { x: 90, y: y + 30, lh: 74, size: 62, b0: 25.3, b1: 26.95, indent: 40 });   // the sheet is full before SAME WORDS
}
// the pen goes back over the words: SAME WORDS underscores the 1776 cadence, ONE HISTORY underscores 'one history.'
const UNDER = [];
{ const span = its => [Math.min(...its.map(i => i.left + i.ox)) - 4, Math.max(...its.map(i => i.left + i.ox + i.tw)) + 6, Math.max(...its.map(i => i.top + i.oy))];
  const head = P2.find(i => i.text === 'When in the course of events,');
  const [a0, a1, ay] = span([head]); UNDER.push({ x0: a0, x1: a1, y: ay + 20, b0: 27.0, b1: 27.7, seed: 7 });
  const hi = P2.findIndex(i => i.text === 'history.'), one = P2[hi - 1];
  if (hi > 0 && one.text === 'one') { const [c0, c1, cy] = span([one, P2[hi]]); UNDER.push({ x0: c0, x1: c1, y: cy + 18, b0: 30.0, b1: 30.5, seed: 11 }); }
}
// WHO SIGNS NOW?: the trades sign, one per shout, then faster and faster into a wall of hands; the ink turns red on 40
const TRADES = ['Rail Worker', 'Trucker', 'Coder', 'Small Farmer', 'Teamster', 'Machinist', 'Nurse', 'Welder', 'Lineman', 'Farmer', 'Electrician',
  'Steelworker', 'Carpenter', 'Mechanic', 'Sailor', 'Teacher', 'Pipefitter', 'Autoworker', 'Bricklayer', 'Millwright', 'Ironworker', 'Plumber',
  'Miner', 'Line Cook', 'Warehouse Worker', 'Boilermaker', 'Roofer', 'Driver', 'Engineer', 'Printer', 'Baker', 'Surveyor', 'Seamstress', 'Operator',
  'Machinist', 'Nurse', 'Rail Worker', 'Coder', 'Farmer', 'Welder', 'Trucker', 'Teamster', 'Lineman', 'Electrician', 'Mechanic', 'Steelworker',
  'Carpenter', 'Janitor', 'Mason', 'Glazier', 'Tool & Die Maker', 'Fisherman', 'Rancher', 'Cashier', 'Pilot', 'Sailor', 'Coder', 'Small Farmer',
  'Machinist', 'Nurse', 'Welder', 'Rail Worker', 'Trucker', 'Teacher', 'Miner', 'Farmer', 'Lineman', 'Autoworker', 'Pipefitter', 'Ironworker'];
const SIGFONTS = [[HAND.aurore, 0.95], [HAND.delafield, 1.25], [HAND.apple, 0.62], [HAND.vibes, 0.95], [HAND.herr, 1.25], [HAND.copper, 0.9]];
const SIGN_T = [];                                          // start beat of each signature
{ let b = 33; for (let i = 0; i < TRADES.length; i++) { SIGN_T.push(b); const k = b - 32; b += k < 5 ? 1 : k < 8 ? 0.5 : Math.max(0.09, 0.34 - (k - 8) * 0.035); } }
// the declaration's body is never signed over: every hand goes below the text block (y > 1130), the stamp band stays clear
// until the tide takes it (39), and until 41 no hand touches another; after that the wall may pile up, but never on the words
const KEEP = P2.map(it => [it.left - 10, it.top + it.ch * 0.15, it.left + it.cw + 10, it.top + it.ch * 0.85]);
const TEXT_END = Math.max(1115, ...P2.map(it => it.top + it.ch * 0.85));
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const SIGS = [];
{ const r = rng(2024), placed = [];
  const slots = [[270, 1215], [790, 1210], [300, 1325], [790, 1330], [260, 1700], [800, 1705], [540, 1800], [250, 1830], [830, 1825], [560, 1250], [540, 1690]];
  const boxOf = (trade, fam, size, cx, cy, rot, par) => {             // real glyph extents, plus the rise or fall a rotated line makes
    MEAS.font = `${size}px "${fam}"`; const m = MEAS.measureText(trade), w = m.width, l = clamp(cx - w / 2, 40, W - 40 - w);
    const tilt = Math.abs(Math.sin(rot)) * (w + size * 0.5);
    return [l - 6, cy - m.actualBoundingBoxAscent - 4 - (rot < 0 ? tilt : 0), l + w + 6, cy + Math.max(m.actualBoundingBoxDescent, par ? 34 : 0) + 4 + (rot > 0 ? tilt : 0)];
  };
  const ok = (bx, t) => bx[1] > TEXT_END + 8 && bx[3] < 1855 && !KEEP.some(k => hit(bx, k)) &&
    !(t < 39 && bx[3] > BAND[0] - 40 && bx[1] < BAND[1] + 30);
  TRADES.forEach((trade, i) => {
    const [fam, k] = SIGFONTS[(i * 7 + 3) % SIGFONTS.length], t = SIGN_T[i];
    let size = (i < slots.length ? 74 : t < 41 ? lerp(44, 62, r()) : lerp(34, 52, r())) * k, x, y, box = null;
    const rot = (r() - 0.6) * 0.07, par = r() < 0.5, wt = [0, 0.8, 1.6, 2.4][Math.floor(r() * 4)];
    if (i < slots.length) { [x, y] = slots[i]; box = boxOf(trade, fam, size, x, y, rot, par); if (!ok(box, t) || placed.some(p => hit(p, box))) box = null; }
    if (!box) {                                             // otherwise the emptiest spot in the signing zone
      let best = null, bs = -1e9;
      for (let tries = 0; tries < 240 && !(best && tries >= 80); tries++) {
        if (tries && tries % 80 === 0) size *= 0.85;            // nowhere free: sign smaller, as a late hand squeezes in
        const cx = 170 + r() * (W - 340), cy = TEXT_END + 15 + r() * (H - (TEXT_END + 15) - 70);
        const bx = boxOf(trade, fam, size, cx, cy, rot, par);
        if (!ok(bx, t)) continue;
        const clash = placed.filter(p => hit(p, bx)).length;
        if (t < 41 && clash) continue;
        let d = 1e9; for (const p of placed) d = Math.min(d, Math.hypot(((p[0] + p[2]) - (bx[0] + bx[2])) * 0.3, ((p[1] + p[3]) - (bx[1] + bx[3])) * 0.5));
        const sc = Math.min(d, 400) - clash * 200;
        if (sc > bs) { bs = sc; best = [cx, cy, bx]; }
      }
      for (let tries = 0; !best && tries < 200; tries++) {     // last resort: any legal spot, touching another hand but never the words
        const cx = 170 + r() * (W - 340), cy = 1660 + r() * 190, bx = boxOf(trade, fam, size, cx, cy, rot, par);
        if (ok(bx, t)) best = [cx, cy, bx];
      }
      [x, y, box] = best;
    }
    placed.push(box);
    const it = inkItem({ text: trade, family: fam, size, x, y, align: 'center', color: [INK.black, INK.iron, INK.brown, '#1b1b2a'][i % 4],
      weight: wt * size / 74, rot, t0: t, t1: t + (i < slots.length ? 0.8 : 0.45),
      paraph: par ? { w: 0, h: 30, draw: paraphSwash(i * 13 + 5) } : null, red: true });
    it.left = box[0] + 6 - it.ox;                              // the glyphs land exactly in the box that was checked
    if (rot < 0) it.top += Math.sin(-rot) * it.ox;             // (the item pivots on its corner; keep the first letter on the baseline)
    it.ry = y;
    SIGS.push(it);
  });
}

const sheetA = document.createElement('canvas'); sheetA.width = W; sheetA.height = H; const gA = sheetA.getContext('2d');
const sheetB = document.createElement('canvas'); sheetB.width = W; sheetB.height = H; const gB = sheetB.getContext('2d');
function page1(b) {
  gA.drawImage(PAPER1, 0, 0);
  const nib = drawItems(gA, P1, b);
  if (b < 17.4) quill(gA, nib, b);
}
function page2(b) {
  gB.drawImage(PAPER2, 0, 0);
  let nib = drawItems(gB, P2, b);
  for (const L of UNDER) {                                       // underscores pulled in fresh ink, the quill riding the tip
    const u = clamp((b - L.b0) / (L.b1 - L.b0)), tip = underline(gB, L.x0, L.x1, L.y, L.seed, ease.inOutCubic(u));
    if (tip && u < 1) nib = { p: tip, u };
  }
  if (b >= 33) {
    for (const s of SIGS) s.redK = clamp((b - 40 - (H - s.ry) / H * 0.35) / 0.25);   // the ink turns red, rippling up from the bottom
    const n2 = drawItems(gB, SIGS, b);
    if (n2) nib = n2;
  }
  if (b < 48) quill(gB, nib, b);
}

// ---------------------------------------------------------------- the red tide, letterpress stamps, wax
function bleed(u, t) {                                        // red ink tide rising through the page: ragged edge, crisp drops
  if (u <= 0) return;
  const top = H - u * (H + 120), r = rng(12);
  const edge = x => top + 28 * Math.sin(x * 0.011 + 1.3) + 16 * Math.sin(x * 0.037 + t * 0.9) + 9 * Math.sin(x * 0.093 - t * 1.7);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(176,18,28)';
  ctx.beginPath(); ctx.moveTo(-40, H + 40);
  for (let x = -40; x <= W + 40; x += 12) ctx.lineTo(x, edge(x));
  ctx.lineTo(W + 40, H + 40); ctx.fill();
  for (let i = 0; i < 120 * Math.min(1, u * 3); i++) {       // wicking fingers and drops above the tide
    const x = r() * W, d = r() ** 2 * 260, rad = lerp(3, 16, r() ** 2);
    ctx.beginPath(); ctx.arc(x, edge(x) - d, rad, 0, 7); ctx.fill();
    if (r() < 0.25) { ctx.fillRect(x - rad * 0.35, edge(x) - d, rad * 0.7, d + 10); }
  }
  ctx.restore();
}
const stampC = document.createElement('canvas'); stampC.width = W + 200; stampC.height = 420; const gS = stampC.getContext('2d');
const rimR = document.createElement('canvas'), rimE = document.createElement('canvas');
rimR.width = rimE.width = stampC.width; rimR.height = rimE.height = stampC.height;
const gR = rimR.getContext('2d'), gE = rimE.getContext('2d');
function stamp(text, age, red, onRed) {                              // letterpress: slams in, slight rotation, broken ink
  const a = ease.outExpo(clamp(age / 0.12));
  const sc = lerp(1.35, 1, a);
  gS.clearRect(0, 0, stampC.width, stampC.height);
  const fill = onRed ? (red ? C.cream : INKC) : red ? '#7e0a14' : INKC;
  const { size: fs } = line(gS, text, stampC.width / 2, 300, { ...DISPLAY, size: 210, color: fill, stroke: onRed ? 12 : 0, strokeColor: onRed && !red ? C.cream : C.black, maxW: W - 90 });
  const r = rng(text.length * 7 + text.charCodeAt(0));
  // letterpress: the rim of each letter squashed thin. The rim is the glyph minus its 1px erosion (a stroke would also
  // trace the face's overlapping inner contours and leave dashes across the crossbars)
  const tx = stampC.width / 2, font = `900 ${fs}px "Playfair Display"`;
  gR.globalCompositeOperation = 'copy'; gR.font = font; gR.textAlign = 'center'; gR.fillStyle = '#000'; gR.fillText(text, tx, 300);
  gR.globalCompositeOperation = 'destination-in'; for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) gR.fillText(text, tx + dx, 300 + dy);
  gE.globalCompositeOperation = 'copy'; gE.font = font; gE.textAlign = 'center'; gE.fillStyle = '#f0e2c2'; gE.fillText(text, tx, 300);
  gE.globalCompositeOperation = 'destination-out'; gE.drawImage(rimR, 0, 0);
  gS.save(); gS.globalCompositeOperation = 'source-atop'; gS.globalAlpha = 0.25; gS.drawImage(rimE, 0, 0);
  gS.globalCompositeOperation = 'destination-out'; gS.globalAlpha = 0.55;   // and a light speckle where the ink missed the paper
  for (let i = 0; i < 90; i++) { gS.beginPath(); gS.arc(stampC.width / 2 + (r() - 0.5) * 900, 300 - r() * 170, 0.8 + r() ** 3 * 3, 0, 7); gS.fill(); }
  gS.restore();
  ctx.save(); ctx.translate(W / 2, 1520); ctx.rotate(-0.03 + (text.length % 3) * 0.02); ctx.scale(sc, sc);
  ctx.globalAlpha = a; ctx.drawImage(stampC, -stampC.width / 2, -300); ctx.restore();
}
function waxSeal(cx, cy, u, t) {                              // red wax drops; the ACP mark is pressed in
  if (u <= 0) return;
  const drop = ease.outBack(clamp(u * 2.5)), press = ease.outExpo(clamp((u - 0.35) * 3));
  const rad = 250 * drop;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(10, 18, rad * 1.02, rad, 0, 0, 7); ctx.fill();
  ctx.fillStyle = WAX; ctx.beginPath();
  for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2, rr = rad * (1 + 0.06 * Math.sin(a * 7) + 0.04 * Math.sin(a * 13 + 1)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.fill();
  ctx.strokeStyle = '#6d0a12'; ctx.lineWidth = 16 * press; ctx.beginPath(); ctx.arc(0, 0, rad * 0.78, 0, 7); ctx.stroke();
  if (press > 0) {
    const M = BRAND.acp_mark, h = rad * 1.05 * press, w = M.width * h / M.height;
    ctx.globalAlpha = press; ctx.drawImage(tinted(M, '#5e0810'), -w / 2 + 3, -h / 2 + 4, w, h); ctx.drawImage(tinted(M, '#d8404c'), -w / 2 - 2, -h / 2 - 2, w, h);
    ctx.drawImage(tinted(M, '#8e101b'), -w / 2, -h / 2, w, h); ctx.globalAlpha = 1;
  }
  const hl = ctx.createRadialGradient(-rad * 0.4, -rad * 0.45, 5, -rad * 0.4, -rad * 0.45, rad * 0.7);
  hl.addColorStop(0, 'rgba(255,230,230,0.45)'); hl.addColorStop(1, 'rgba(255,230,230,0)');
  ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(0, 0, rad, 0, 7); ctx.fill();
  ctx.restore();
}
function lockup(beat) {
  ctx.fillStyle = '#d4101c'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 800, 50, W / 2, 800, 700);
  g.addColorStop(0, '#2a0205'); g.addColorStop(1, '#120102');
  ctx.fillStyle = g; ctx.fillRect(110, 330, W - 220, 1000);
  ctx.fillStyle = '#d4101c'; ctx.fillRect(330, 560, 420, 460);
  const a = ease.outExpo(clamp((beat - 64) / 1.2));
  sigil(ctx, W / 2, 800, 220 * lerp(1.3, 1, a), { color: C.cream, alpha: a, tagline: true });
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30), kick = Math.max(B.env('kick', t, 10), B.env('taiko', t, 8));
  ctx.globalAlpha = 1;
  if (beat >= 72) { closer(ctx, (beat - 72) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.6 }); return; }
  if (beat >= 64) { lockup(beat); finish.apply(ctx, frame, { grain: 0.07, vignette: 0.5 }); return; }
  const turn = ease.outCubic(clamp((beat - 17.35) / 0.65));        // CHICAGO: a fresh sheet is laid over the 1776 one
  if (turn < 1) page1(beat);
  if (beat >= 17.35) page2(beat);
  // the page: shakes with the drums once they come in
  ctx.save();
  ctx.fillStyle = '#1a0f07'; ctx.fillRect(0, 0, W, H);
  if (beat >= 16) ctx.translate(Math.sin(t * 77) * 8 * kick, Math.cos(t * 63) * 8 * kick);
  if (beat >= 48 && beat < 60) { const z = 1 + (beat - 48) * 0.012 + 0.03 * kick; ctx.translate(W / 2, 760); ctx.rotate(Math.sin(beat * 0.7) * 0.01); ctx.scale(z, z); ctx.translate(-W / 2, -760); }
  ctx.translate(W / 2, H / 2); ctx.scale(1.035, 1.035); ctx.translate(-W / 2, -H / 2);   // bleed past the frame edge for the shake
  if (turn < 1) { ctx.save(); ctx.translate(-turn * 140, 0); ctx.drawImage(sheetA, 0, 0);
    ctx.fillStyle = `rgba(20,8,2,${0.35 * turn})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  if (beat >= 17.35) {
    ctx.save();
    if (turn < 1) { ctx.translate((1 - turn) * W * 1.08, (1 - turn) * 160); ctx.rotate((1 - turn) * 0.1);
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 50; ctx.shadowOffsetX = -18; }
    ctx.drawImage(sheetB, 0, 0); ctx.restore();
  }
  const tide = beat >= 48 ? lerp(0.42, 1.05, ease.outExpo(clamp((beat - 48) / 1))) : beat >= 12 ? 0.42 * ease.inCubic(clamp((beat - 12) / 36)) : 0;
  bleed(tide, t);
  if (beat >= 48) {                                           // the drop: seals stamped across the page, two per beat
    const r = rng(56), n = Math.floor((beat - 48) * 2) + 1;
    for (let i = 0; i < n; i++) { const x = 170 + r() * (W - 340), y = 260 + r() * 1100, sc = lerp(0.35, 0.55, r());
      if (Math.hypot(x - W / 2, y - 760) < 330) continue;
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); waxSeal(0, 0, 0.4 + (beat - 48 - i / 2) / 2, t); ctx.restore(); }
  }
  if (beat >= 48) {
    const push = ease.inExpo(clamp((beat - 60) / 4));          // into the seal: match cut to the mark
    ctx.save(); ctx.translate(W / 2, 760); ctx.scale(1 + push * 5 + 0.05 * kick, 1 + push * 5 + 0.05 * kick); ctx.translate(-W / 2, -760);
    waxSeal(W / 2, 760, (beat - 48) / 5, t); ctx.restore();
  }
  ctx.restore();
  const onRed = H - tide * (H + 120) < 1600;
  for (const s of STAMPS) if (beat >= s.s && beat < s.e) stamp(s.text, (beat - s.s) * B.spb, s.red, onRed);
  if (beat >= 48) { if (beat < 60) cue(ctx, CUES, beat, B.spb, { y: CUE_Y, size: 250, color: C.cream, red: C.cream, shadow: 0, stroke: 14, ...DISPLAY }); }
  else cue(ctx, CUES, Math.max(beat, 0.36),   /* frame 0 is a hard cut: the hook is already up */ B.spb, { y: CUE_Y, size: 240, color: INKC, red: RED, shadow: 0, ...DISPLAY });
  if (beat >= 16) { ctx.globalAlpha = 0.85; ctx.drawImage(tinted(logo, INKC), W - 150, 60, 96, 96); ctx.globalAlpha = 1; }   // corner bug enters with the first stamp (drift #20)
  let flash = 0; for (const c of [16, 48]) if (beat >= c && beat < c + 0.3) flash = 0.6 * (1 - (beat - c) / 0.3);
  finish.apply(ctx, frame, { grain: 0.1, vignette: 0.5, flash });
};
window.sceneReady = true;
