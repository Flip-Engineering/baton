// ASCENDED v1: every printed surface, baked once at load. The compass is a CMYK offset print (four AM screens with
// misregistration and dot gain, laid on newsprint, so the macro push finds real rosettes), its black line work and
// the spine words are solid ink (text is never screened), and the Fold-In artwork is drawn where it will LAND, then
// pulled back onto the sheet through the fold model (so the fragments are exactly where the paper puts them).
import { clamp, lerp, rng, BRAND } from '../lib/kit.js';
import { sheetPoint, planePoint, RHO, XA, XB, PA, PB, PW } from './ascended.paper.js';

export const INK = { C: [0, 158, 224], M: [236, 0, 140], Y: [255, 230, 0], K: [34, 30, 31], red: [189, 24, 24] };
// the meme compass in today's meme colours (lib-right yellow, not the dated purple), as a printer would separate them
export const QUAD = { TL: '#f77a74', TR: '#6fb6f2', BL: '#96e391', BR: '#f4ec6a' };
export const PAPER = { news: [232, 225, 208], ivory: [240, 233, 216], back: [236, 230, 214] };

export function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const g2 = c => c.getContext('2d', { willReadFrequently: true });

// ---------------------------------------------------------------- paper stock: base, mottle, fibres, flecks
export function stock(w, h, base, seed = 3) {
  const c = cv(w, h), g = g2(c), r = rng(seed);
  g.fillStyle = `rgb(${base.join(',')})`; g.fillRect(0, 0, w, h);
  const m = cv(64, 64), mg = g2(m), id = mg.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) { const v = 128 + (r() - 0.5) * 40; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  mg.putImageData(id, 0, 0);
  g.save(); g.globalAlpha = 0.22; g.globalCompositeOperation = 'overlay'; g.imageSmoothingEnabled = true; g.drawImage(m, 0, 0, w, h); g.restore();
  g.save(); g.lineCap = 'round';
  const nf = Math.round(w * h / 900);
  for (let i = 0; i < nf; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, L = 3 + r() * 14 * w / 2048;
    g.strokeStyle = r() < 0.5 ? `rgba(120,105,80,${0.05 + r() * 0.08})` : `rgba(255,252,240,${0.05 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 1.1; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.4) * L * 0.6, y + Math.sin(a + 0.4) * L * 0.6, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0; i < nf / 40; i++) { g.fillStyle = `rgba(60,50,40,${0.2 + r() * 0.3})`; g.beginPath(); g.arc(r() * w, r() * h, 0.5 + r() * 1.3, 0, 7); g.fill(); }
  g.restore();
  return c;
}

// ---------------------------------------------------------------- CMYK AM halftone (contone -> four screens, multiply)
export function halftone(dst, src, { cell = 16, angles = [15, 75, 0, 45], misreg = [[2, -1], [-2, 1], [1, 2], [0, 0]], gain = 1.12, rough = 0.12, seed = 5 } = {}) {
  const w = src.width, h = src.height, sd = g2(src).getImageData(0, 0, w, h).data, r = rng(seed);
  const g = dst.getContext('2d');
  const inks = [INK.C, INK.M, INK.Y, INK.K];
  const sample = (x, y) => { const xi = clamp(Math.round(x), 0, w - 1), yi = clamp(Math.round(y), 0, h - 1), i = (yi * w + xi) * 4; return [sd[i] / 255, sd[i + 1] / 255, sd[i + 2] / 255, sd[i + 3] / 255]; };
  g.save(); g.globalCompositeOperation = 'multiply';
  for (let p = 0; p < 4; p++) {
    const a = angles[p] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [ox, oy] = misreg[p];
    g.fillStyle = `rgb(${inks[p].join(',')})`;
    const R = Math.hypot(w, h) / cell + 2;
    g.beginPath();
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const x = w / 2 + (i * ca - j * sa) * cell, y = h / 2 + (i * sa + j * ca) * cell;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const [cR, cG, cB, al] = sample(x, y); if (al < 0.5) continue;
      const C = 1 - cR, M = 1 - cG, Y = 1 - cB, K0 = Math.min(C, M, Y), K = K0 * 0.7;
      const cov = [(C - K) / (1 - K + 1e-6), (M - K) / (1 - K + 1e-6), (Y - K) / (1 - K + 1e-6), K][p] * gain;
      if (cov < 0.02) continue;
      const rad = Math.min(cell * 0.74, cell * Math.sqrt(cov / Math.PI)) * (1 + (r() - 0.5) * rough);
      g.moveTo(x + ox + rad, y + oy); g.ellipse(x + ox, y + oy, rad, rad * (1 + (r() - 0.5) * rough), r() * 3, 0, Math.PI * 2);
    }
    g.fill();
  }
  g.restore();
}

// paper (u, v) -> canvas px for a canvas of size S covering [-1, 1]^2 (v up)
export const U2X = (u, S, lo = -1, hi = 1) => (u - lo) / (hi - lo) * S;
export const V2Y = (v, S, lo = -1, hi = 1) => (hi - v) / (hi - lo) * S;

// fit a block of lines (font px per cap) right/left aligned at an anchor so every glyph box stays inside a test
function fitLines(g, lines, family, test, { anchor, align = 'right', valign = 'bottom', gap = 0.16, capMax = 400, capMin = 20 } = {}) {
  let cap = capMax;
  for (; cap > capMin; cap *= 0.97) {
    const size = cap / 0.72; g.font = `${size}px "${family}"`;
    const ws = lines.map(l => g.measureText(l).width), H = lines.length * cap + (lines.length - 1) * gap * cap;
    const y0 = valign === 'bottom' ? anchor[1] - H : anchor[1];
    let ok = true;
    for (let i = 0; i < lines.length && ok; i++) {
      const x0 = align === 'right' ? anchor[0] - ws[i] : align === 'left' ? anchor[0] : anchor[0] - ws[i] / 2, yT = y0 + i * cap * (1 + gap);
      for (const [px, py] of [[x0, yT], [x0 + ws[i], yT], [x0, yT + cap], [x0 + ws[i], yT + cap]]) if (!test(px, py)) { ok = false; break; }
    }
    if (ok) return { cap, size, ws, y0, box: (() => { const xs = ws.map((w, i) => align === 'right' ? anchor[0] - w : align === 'left' ? anchor[0] : anchor[0] - w / 2);
        return [Math.min(...xs), y0, Math.max(...xs.map((x, i) => x + ws[i])), y0 + H]; })(), draw: (gg, fill = '#fff') => { gg.font = `${size}px "${family}"`; gg.fillStyle = fill; gg.textBaseline = 'alphabetic';
      lines.forEach((l, i) => { const x0 = align === 'right' ? anchor[0] - ws[i] : align === 'left' ? anchor[0] : anchor[0] - ws[i] / 2; gg.fillText(l, x0, y0 + i * cap * (1 + gap) + cap); }); } };
  }
  return null;
}

// ink starve: eat random voids and a rocked-stamp gradient out of a white-on-transparent mask
function starve(c, seed, amt = 0.5) {
  const g = g2(c), r = rng(seed), w = c.width, h = c.height;
  g.save(); g.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h / 260 * amt);
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; g.beginPath(); g.ellipse(r() * w, r() * h, 0.6 + r() * r() * 3.2, 0.5 + r() * 2, r() * 3, 0, 7); g.fill(); }
  g.restore();
}

// pack four white-on-transparent layers into one RGBA byte array (alpha of each layer -> one channel). Raw bytes, not a
// canvas: a canvas is premultiplied, so a channel under a zero alpha would be lost. Rows run bottom-up (DataTexture).
function pack(layers, S) {
  const data = new Uint8Array(S * S * 4), ds = layers.map(L => L ? g2(L).getImageData(0, 0, S, S).data : null);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, o = ((S - 1 - y) * S + x) * 4;
    for (let c = 0; c < 4; c++) data[o + c] = ds[c] ? ds[c][i + 3] : 0; }
  return { data, S };
}

// ---------------------------------------------------------------- the fold map: where each texel lands, and whether it is on top
// fn(u, v, P) -> P; returns { pos (Float32 x,y,z per texel), vis (Uint8) } for an S x S texel grid over [-1,1]^2
function foldMap(S, fn, box = 1.25, Z = 640) {
  const n = S * S, pos = new Float32Array(n * 3), zb = new Float32Array(Z * Z).fill(-1e9), P = [0, 0, 0];
  const zc = (x, y) => { const i = Math.floor((x + box) / (2 * box) * Z), j = Math.floor((box - y) / (2 * box) * Z); return i < 0 || j < 0 || i >= Z || j >= Z ? -1 : j * Z + i; };
  for (let j = 0; j < S; j++) { const v = 1 - (j + 0.5) / S * 2; for (let i = 0; i < S; i++) { const u = (i + 0.5) / S * 2 - 1, k = j * S + i;
    fn(u, v, P); pos[k * 3] = P[0]; pos[k * 3 + 1] = P[1]; pos[k * 3 + 2] = P[2]; const c = zc(P[0], P[1]); if (c >= 0 && P[2] > zb[c]) zb[c] = P[2]; } }
  const vis = new Uint8Array(n);
  for (let k = 0; k < n; k++) { const c = zc(pos[k * 3], pos[k * 3 + 1]); vis[k] = c >= 0 && pos[k * 3 + 2] >= zb[c] - RHO * 0.8 ? 1 : 0; }
  return { pos, vis, S };
}
// draw an art canvas (covering [-box, box]^2 in landed coordinates) back onto the sheet's texels where they are on top
function pullBack(map, art, box, into, { onlyVis = true, alpha = 1 } = {}) {
  const S = map.S, A = art.width, ad = g2(art).getImageData(0, 0, A, A).data, g = g2(into), od = g.getImageData(0, 0, S, S), o = od.data;
  for (let k = 0; k < S * S; k++) {
    if (onlyVis && !map.vis[k]) continue;
    const x = map.pos[k * 3], y = map.pos[k * 3 + 1];
    const ai = Math.floor((x + box) / (2 * box) * A), aj = Math.floor((box - y) / (2 * box) * A);
    if (ai < 0 || aj < 0 || ai >= A || aj >= A) continue;
    const q = (aj * A + ai) * 4, a = ad[q + 3] / 255 * alpha; if (a <= 0) continue;
    for (let c = 0; c < 3; c++) o[k * 4 + c] = o[k * 4 + c] * (1 - a) + ad[q + c] * a;
    o[k * 4 + 3] = Math.max(o[k * 4 + 3], ad[q + 3] * alpha);
  }
  g.putImageData(od, 0, 0);
}

// ================================================================ the front: the printed compass
export function frontArt(S = 2560, panels = []) {
  const cont = cv(S), cg = g2(cont), X = u => U2X(u, S), Y = v => V2Y(v, S), L = u => u / 2 * S;
  const m = 0.93;
  cg.fillStyle = '#fff'; cg.fillRect(0, 0, S, S);
  cg.fillStyle = QUAD.TL; cg.fillRect(X(-m), Y(m), L(m), L(m));
  cg.fillStyle = QUAD.TR; cg.fillRect(X(0), Y(m), L(m), L(m));
  cg.fillStyle = QUAD.BL; cg.fillRect(X(-m), Y(0), L(m), L(m));
  cg.fillStyle = QUAD.BR; cg.fillRect(X(0), Y(0), L(m), L(m));
  const out = stock(S, S, PAPER.news, 11), og = out.getContext('2d');
  halftone(out, cont, { cell: Math.round(S / 160) });
  // line work, solid K (a line is never screened): the grid, the axes, the frame
  og.save(); og.globalCompositeOperation = 'multiply';
  og.strokeStyle = 'rgba(34,30,31,0.42)'; og.lineWidth = S * 0.0011;
  for (let k = -9; k <= 9; k++) { if (!k) continue; const q = k * m / 10;
    og.beginPath(); og.moveTo(X(q), Y(m)); og.lineTo(X(q), Y(-m)); og.moveTo(X(-m), Y(q)); og.lineTo(X(m), Y(q)); og.stroke(); }
  og.strokeStyle = 'rgb(34,30,31)'; og.lineWidth = S * 0.0085;
  og.beginPath(); og.moveTo(X(0), Y(m)); og.lineTo(X(0), Y(-m)); og.moveTo(X(-m), Y(0)); og.lineTo(X(m), Y(0)); og.stroke();
  og.lineWidth = S * 0.0035; og.strokeRect(X(-m), Y(m), L(2 * m), L(2 * m));
  // the label panels: knocked out of the screens (paper only) with a keyline, where the corner words print
  { const pap = stock(S, S, PAPER.news, 12);
    for (const [x0, y0, x1, y1] of panels) { og.save(); og.globalCompositeOperation = 'source-over'; og.beginPath(); og.rect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S); og.clip(); og.drawImage(pap, 0, 0); og.restore();
      og.save(); og.globalCompositeOperation = 'multiply'; og.strokeStyle = 'rgb(34,30,31)'; og.lineWidth = S * 0.003; og.strokeRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S); og.restore(); } }
  // axis words in the margin, small (picture text: the chart's own labels)
  og.fillStyle = 'rgb(34,30,31)'; og.font = `${S * 0.024}px "Archivo Black"`; og.textAlign = 'center'; og.textBaseline = 'middle';
  og.fillText('AUTHORITARIAN', X(0), Y(0.965)); og.fillText('LIBERTARIAN', X(0), Y(-0.965));
  og.save(); og.translate(X(-0.965), Y(0)); og.rotate(-Math.PI / 2); og.fillText('LEFT', 0, 0); og.restore();
  og.save(); og.translate(X(0.965), Y(0)); og.rotate(Math.PI / 2); og.fillText('RIGHT', 0, 0); og.restore();
  og.restore();
  // the date stamp in the TR margin: the day the criss-cross was posted (8.11.21), a rubber dater in faded red
  {
    const L2 = cv(S), lg = g2(L2); lg.translate(X(0.74), Y(0.78)); lg.rotate(-0.16);
    lg.strokeStyle = '#fff'; lg.fillStyle = '#fff'; lg.lineWidth = S * 0.004;
    lg.beginPath(); lg.roundRect(-S * 0.075, -S * 0.03, S * 0.15, S * 0.06, S * 0.008); lg.stroke();
    lg.font = `${S * 0.03}px "Big Shoulders Display"`; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText('AUG 11 2021', 0, S * 0.002);
    starve(L2, 21, 0.9);
    og.save(); og.globalCompositeOperation = 'multiply'; og.globalAlpha = 0.85;
    const tint = cv(S), ttg = g2(tint); ttg.drawImage(L2, 0, 0); ttg.globalCompositeOperation = 'source-in'; ttg.fillStyle = 'rgb(176,40,48)'; ttg.fillRect(0, 0, S, S);
    og.drawImage(tint, 0, 0); og.restore();
  }
  return out;
}

// ================================================================ front masks: words and picture text that print on their hit
// maskA: R TOP / LEFT. (the TL half the fold swallows) | G BOTTOM / RIGHT. | B CRISS-CROSS. (drawn where the fold joins
//        the corners, pulled back through the fold) | A CAPITALIST. (on the bottom-right triangle, where it lands)
// maskB: R the bottom-right bubble | G the seal (STATE MACHINE. microtext) | B the fold guide, corner to corner | A COMMUNIST. (on the top-left triangle, where it lands)
export function frontMasks(SM = 1536, stage1) {
  const X = u => U2X(u, SM), Y = v => V2Y(v, SM), s = u => u / 2 * SM;
  const lay = () => { const c = cv(SM); return [c, g2(c)]; };
  // TOP / LEFT.: right-aligned on the vertical axis, sat on the horizontal axis, inside the inner half (x - y > -1)
  const [cTL, gTL] = lay();
  const inTL = (px, py) => { const u = px / SM * 2 - 1, v = 1 - py / SM * 2; return u - v > -0.93 && u < -0.02 && v > 0.02; };
  const fTL = fitLines(gTL, ['TOP', 'LEFT.'], 'Archivo Black', inTL, { anchor: [X(-0.07), Y(0.07)], align: 'right', valign: 'bottom', capMax: s(0.34) }); fTL?.draw(gTL);
  starve(cTL, 3, 0.12);
  const [cBR, gBR] = lay();
  const inBR = (px, py) => { const u = px / SM * 2 - 1, v = 1 - py / SM * 2; return u - v < 0.93 && u > 0.02 && v < -0.02; };
  const fBR = fitLines(gBR, ['BOTTOM', 'RIGHT.'], 'Archivo Black', inBR, { anchor: [X(0.07), Y(-0.07)], align: 'left', valign: 'top', capMax: s(0.34) }); fBR?.draw(gBR);
  starve(cBR, 4, 0.12);
  // CRISS-CROSS. across the join of the folded square [-1, 0] x [0, 1] (red above the / diagonal, yellow below)
  const BOX = 1.25, A = 1536, crissArt = cv(A), ca = g2(crissArt), AX = u => U2X(u, A, -BOX, BOX), AY = v => V2Y(v, A, -BOX, BOX);
  { const inSq = (px, py) => { const u = px / A * 2 * BOX - BOX, v = BOX - py / A * 2 * BOX; return u > -0.95 && u < -0.05 && v > 0.08 && v < 0.92; };
    fitLines(ca, ['CRISS-CROSS.'], 'Anton', inSq, { anchor: [AX(-0.5), AY(0.5) - A / (2 * BOX) * 0.09], align: 'center', valign: 'top', capMax: A * 0.2 })?.draw(ca); }
  starve(crissArt, 5, 0.3);
  const based = cv(A), ba = g2(based);          // CAPITALIST. on the yellow (bottom-right) triangle, where it lands
  { const inTri = (px, py) => { const u = px / A * 2 * BOX - BOX, v = BOX - py / A * 2 * BOX; return v - u - 1 < -0.07 && u < -0.03 && v > 0.03; };
    fitLines(ba, ['CAPITALIST.'], 'Anton', inTri, { anchor: [AX(-0.05), AY(0.05)], align: 'right', valign: 'bottom', capMax: A * 0.2 })?.draw(ba); }
  starve(based, 6, 0.3);
  const commie = cv(A), cm = g2(commie);        // COMMUNIST. on the red (top-left) triangle
  { const inRed = (px, py) => { const u = px / A * 2 * BOX - BOX, v = BOX - py / A * 2 * BOX; return v - u - 1 > 0.07 && u > -0.95 && v < 0.93; };
    fitLines(cm, ['COMMUNIST.'], 'Anton', inRed, { anchor: [AX(-0.93), AY(0.92)], align: 'left', valign: 'top', capMax: A * 0.2 })?.draw(cm); }
  starve(commie, 8, 0.3);
  const cC = cv(SM), cB = cv(SM), cK = cv(SM);
  pullBack(stage1, crissArt, BOX, cC); pullBack(stage1, based, BOX, cB); pullBack(stage1, commie, BOX, cK);
  const maskA = pack([cTL, cBR, cC, cB], SM);

  // picture text
  const [cBub, gB] = lay();
  { gB.save(); gB.translate(X(0.8), Y(-0.36)); gB.rotate(-0.05); gB.scale(0.6, 0.6); const w = s(0.46), h = s(0.13);
    gB.strokeStyle = '#fff'; gB.lineWidth = SM * 0.0022; gB.beginPath(); gB.roundRect(-w / 2, -h / 2, w, h, h * 0.4); gB.moveTo(-w * 0.2, h / 2); gB.lineTo(-w * 0.28, h * 0.95); gB.lineTo(-w * 0.08, h / 2); gB.stroke();
    gB.fillStyle = '#fff'; gB.font = `${s(0.034)}px "Archivo Black"`; gB.textAlign = 'center'; gB.textBaseline = 'middle';
    gB.fillText('SUPPORT THEIR', 0, -h * 0.17); gB.fillText('RIGHT TO WORK!', 0, h * 0.22);
    // the little laptop the bubble is aimed at
    gB.translate(-w * 0.34, h * 1.25); gB.lineWidth = SM * 0.0028; gB.strokeRect(-s(0.04), -s(0.028), s(0.08), s(0.05)); gB.beginPath(); gB.moveTo(-s(0.055), s(0.024)); gB.lineTo(s(0.055), s(0.024)); gB.stroke();
    gB.restore(); }
  const [cSeal, gS] = lay();
  { gS.save(); gS.translate(X(0), Y(0)); const R0 = s(0.125);
    gS.fillStyle = '#fff'; gS.beginPath();
    for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2, rr = R0 * (k % 2 ? 0.93 : 1); gS.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    gS.fill();
    gS.globalCompositeOperation = 'destination-out'; gS.lineWidth = SM * 0.0022; gS.strokeStyle = '#000';
    gS.beginPath(); gS.arc(0, 0, R0 * 0.8, 0, 7); gS.stroke(); gS.beginPath(); gS.arc(0, 0, R0 * 0.52, 0, 7); gS.stroke();
    gS.font = `${s(0.021)}px "Archivo Black"`; gS.fillStyle = '#000'; gS.textAlign = 'center'; gS.textBaseline = 'middle';
    const ring = 'STATE MACHINE. STATE MACHINE. STATE MACHINE. ';
    for (let k = 0; k < ring.length; k++) { const a = -Math.PI / 2 + k / ring.length * Math.PI * 2; gS.save(); gS.rotate(a); gS.translate(R0 * 0.66, 0); gS.rotate(Math.PI / 2); gS.fillText(ring[k], 0, 0); gS.restore(); }
    gS.font = `${s(0.05)}px "Archivo Black"`; gS.fillText('★', 0, 0);
    gS.restore(); }
  const [cGuide, gG] = lay();
  { gG.strokeStyle = '#fff'; gG.lineWidth = SM * 0.0034; gG.setLineDash([SM * 0.014, SM * 0.01]);
    gG.beginPath(); gG.moveTo(X(-0.93), Y(-0.93)); gG.lineTo(X(0.93), Y(0.93)); gG.stroke();
    gG.setLineDash([]); gG.fillStyle = '#fff'; gG.font = `${s(0.03)}px "Archivo Black"`; gG.save(); gG.translate(X(-0.74), Y(-0.8)); gG.rotate(-Math.PI / 4); gG.fillText('FOLD', 0, 0); gG.restore(); }
  const [cGly, gY] = lay();
  { // the crease glyph (right angle with a zigzag arrow down), along the corner-to-corner crease near the TR end
    gY.save(); gY.translate(X(0.5), Y(0.62)); gY.rotate(-Math.PI / 4); gY.strokeStyle = '#fff'; gY.lineWidth = SM * 0.004; const k = s(0.05);
    gY.beginPath(); gY.moveTo(-k, -k); gY.lineTo(-k, k); gY.lineTo(k, k); gY.stroke();
    gY.beginPath(); gY.moveTo(-k * 0.2, -k * 1.2); gY.lineTo(k * 0.25, -k * 0.5); gY.lineTo(-k * 0.25, -k * 0.1); gY.lineTo(k * 0.25, k * 0.45); gY.stroke();
    gY.beginPath(); gY.moveTo(k * 0.05, k * 0.2); gY.lineTo(k * 0.25, k * 0.45); gY.lineTo(k * 0.35, k * 0.15); gY.stroke(); gY.restore(); }
  const maskB = pack([cBub, cSeal, cGuide, cK], SM);
  // the label panels the two corner words print into (unscreened paper, fraction of the sheet), for frontArt
  const pad = 0.035 * SM, panel = f => f && [(f.box[0] - pad) / SM, (f.box[1] - pad * 0.8) / SM, (f.box[2] + pad) / SM, (f.box[3] + pad * 0.8) / SM];
  return { maskA, maskB, panels: [panel(fTL), panel(fBR)].filter(Boolean) };
}

// ================================================================ the back: show-through, the MAD marks, the Fold-In
// Landed coordinates (after the flip and the second pleat): the back of the top-left half lies as the triangle y <= x;
// the pleat hides XA..XB and brings the right part left by XB - XA. FULL / COMMUNISM. is drawn where it lands and
// pulled back: flat, it reads as broken strokes either side of the band; closed, it joins.
export function backArt(SB, front, preMap, finMap) {
  const out = stock(SB, SB, PAPER.back, 19), og = g2(out);
  // show-through: the front, faint, at the same texel (so it reads mirrored from this side)
  og.save(); og.globalAlpha = 0.07; og.filter = 'blur(2px)'; og.globalCompositeOperation = 'multiply'; og.drawImage(front, 0, 0, SB, SB); og.restore();
  const BOX = 1.25, A = 2048, AX = u => U2X(u, A, -BOX, BOX), AY = v => V2Y(v, A, -BOX, BOX), un = x => x / (2 * BOX) * A;
  const red = `rgb(${INK.red.join(',')})`;
  // the reveal, in landed coordinates
  const rev = cv(A), rg = g2(rev);
  const inShape = (px, py) => { const x = px / A * 2 * BOX - BOX, y = BOX - py / A * 2 * BOX; return y < x - 0.07 && y > -0.95 && x < 1 - (XB - XA) - 0.05; };
  const l2 = fitLines(rg, ['COMMUNISM.'], 'Anton', inShape, { anchor: [AX(-0.14), AY(-0.93)], align: 'center', valign: 'bottom', capMax: un(0.42) });
  let l1 = null;
  if (l2) { l2.draw(rg, red); const top = l2.y0; l1 = fitLines(rg, ['FULL'], 'Anton', inShape, { anchor: [AX(0.02), top - un(0.06)], align: 'center', valign: 'bottom', capMax: un(0.42) }); l1?.draw(rg, red); }
  // the MAD marks: A and B meet at the join
  rg.fillStyle = 'rgb(34,30,31)'; rg.font = `${un(0.07)}px "Archivo Black"`; rg.textAlign = 'center'; rg.textBaseline = 'middle';
  const yM = (l1 ? l1.y0 : AY(0)) - un(0.14);
  rg.fillText('A', AX(XA - 0.07), yM); rg.fillText('B', AX(XA + 0.07), yM);
  rg.beginPath(); rg.moveTo(AX(XA - 0.02), yM - un(0.05)); rg.lineTo(AX(XA), yM - un(0.075)); rg.lineTo(AX(XA + 0.02), yM - un(0.05)); rg.lineWidth = un(0.008); rg.strokeStyle = 'rgb(34,30,31)'; rg.stroke();
  starve(rev, 23, 0.25);
  // the band (only seen flat): decoy strokes that carry the letters' rhythm, and the fold-here rules at XA, XB
  const dec = cv(A), dg = g2(dec);
  dg.strokeStyle = 'rgb(34,30,31)'; dg.lineWidth = un(0.005); dg.setLineDash([un(0.02), un(0.014)]);
  for (const x of [XA, XB]) { dg.beginPath(); dg.moveTo(AX(x), AY(x - 0.02)); dg.lineTo(AX(x), AY(-1)); dg.stroke(); }
  dg.setLineDash([]);
  // the open page's own message sits in the band (it is what folds away): SOME / WELFARE. in black ink, where FULL / COMMUNISM.
  // is broken into strips either side of it; folded, the band goes under and the strips join
  { const inBand = (px, py) => { const x = px / A * 2 * BOX - BOX, y = BOX - py / A * 2 * BOX; return x > XA + 0.03 && x < XB - 0.03 && y < x - 0.05 && y > -0.95; };
    const bot = l2 ? l2.y0 + l2.cap * 1.0 + un(0.0) : AY(-0.9);
    const f2 = fitLines(dg, ['WELFARE.'], 'Anton', inBand, { anchor: [AX((XA + XB) / 2), bot], align: 'center', valign: 'bottom', capMax: un(0.5) });
    f2?.draw(dg, 'rgb(34,30,31)');
    if (f2) fitLines(dg, ['SOME'], 'Anton', inBand, { anchor: [AX((XA + XB) / 2), f2.y0 - un(0.05)], align: 'center', valign: 'bottom', capMax: f2.cap })?.draw(dg, 'rgb(34,30,31)'); }
  dg.fillStyle = 'rgb(34,30,31)'; dg.font = `${un(0.03)}px "Archivo Black"`; dg.textAlign = 'center';
  dg.fillText('FOLD SO A MEETS B', AX((XA + XB) / 2), yM - un(0.12));
  starve(dec, 29, 0.25);
  const mid = cv(SB); pullBack(preMap, dec, BOX, mid);
  pullBack(finMap, rev, BOX, mid);
  // (texels on top flat but under the band once folded keep the decoys; texels on top when closed carry the reveal)
  og.drawImage(mid, 0, 0);
  return out;
}

// ================================================================ the plane: top = the reveal as it stood, underside = the joined corners
// top (seen from +z): FULL / COMMUNISM. in red; underside: left half red, right half yellow (the two corners), the ACP
// mark knocked out cream on each wing (four stripes), printed through a halftone
export function planeArt(emblem) {
  const w = 1024, h = Math.round(w * PB / PA), top = stock(w, h, PAPER.back, 31), tg = g2(top);
  const Xp = x => (x + PA) / (2 * PA) * w, Yp = y => (PB - y) / (2 * PB) * h;
  tg.fillStyle = `rgb(${INK.red.join(',')})`; tg.textAlign = 'center'; tg.textBaseline = 'alphabetic';
  tg.font = `${w * 0.2}px Anton`; tg.fillText('FULL', w / 2, Yp(-0.02));
  tg.font = `${w * 0.19}px Anton`; const cw = tg.measureText('COMMUNISM.').width; tg.save(); tg.translate(w / 2, Yp(-0.3)); tg.scale(Math.min(1, w * 0.92 / cw), 1); tg.fillText('COMMUNISM.', 0, 0); tg.restore();
  // underside (u mirrored so it reads from below)
  const cont = cv(w, h), cg = g2(cont);
  cg.fillStyle = QUAD.TL; cg.fillRect(0, 0, w / 2, h); cg.fillStyle = QUAD.BR; cg.fillRect(w / 2, 0, w / 2, h);
  const bot = stock(w, h, PAPER.news, 37);
  halftone(bot, cont, { cell: 9, seed: 9 });
  const bg = g2(bot);
  // the mark, knocked out: the wings are |x| > PW; centre each mark on its wing, below the nose flaps
  for (const sx of [-1, 1]) {
    const cx = Xp(-sx * (PW + (PA - PW) / 2)), cy = Yp(-0.3), H = h * 0.2, Wd = emblem.width * H / emblem.height;
    bg.save(); bg.translate(cx, cy); bg.rotate(sx * Math.PI / 2); bg.scale(-1, 1);
    const k = cv(Math.round(Wd), Math.round(H)), kg = g2(k); kg.drawImage(emblem, 0, 0, k.width, k.height); kg.globalCompositeOperation = 'source-in'; kg.fillStyle = `rgb(${PAPER.news.join(',')})`; kg.fillRect(0, 0, k.width, k.height);
    bg.drawImage(k, -Wd / 2, -H / 2, Wd, H); bg.restore();
  }
  return { top, bot };
}

// ================================================================ the card: ANOTHER BANGER / BY / the logo, letterpress on the same stock
export function cardArt(S = 2048) {
  const c = stock(S, S, PAPER.ivory, 41), g = g2(c);
  const ink = `rgb(${INK.K.join(',')})`, red = `rgb(${INK.red.join(',')})`;
  const deboss = (draw, col) => {   // a letterpress impression: shadow toward the light's far side, a bright lip, the ink
    const L = cv(S), lg = g2(L); draw(lg, '#fff');
    const tint = (color, dx, dy, a, mode = 'source-over') => { const t = cv(S), tt = g2(t); tt.drawImage(L, 0, 0); tt.globalCompositeOperation = 'source-in'; tt.fillStyle = color; tt.fillRect(0, 0, S, S);
      g.save(); g.globalAlpha = a; g.globalCompositeOperation = mode; g.drawImage(t, dx, dy); g.restore(); };
    tint('rgb(255,252,240)', -3, -3, 0.9); tint('rgb(90,80,70)', 4, 4, 0.5, 'multiply');
    starve(L, 51, 0.35); tint(col, 0, 0, 1, 'multiply');
  };
  const X = S / 2;
  deboss((lg, f) => { lg.fillStyle = f; lg.textAlign = 'center'; lg.textBaseline = 'alphabetic'; lg.font = `${S * 0.15}px Anton`;
    const w = lg.measureText('ANOTHER BANGER').width; lg.save(); lg.translate(X, S * 0.27); lg.scale(Math.min(1, S * 0.84 / w), 1); lg.fillText('ANOTHER BANGER', 0, 0); lg.restore();
    lg.font = `${S * 0.07}px Anton`; lg.fillText('BY', X, S * 0.37); }, ink);
  const logo = BRAND.acp_logo, H = S * 0.44, Wd = logo.width * H / logo.height;
  const big = cv(Math.round(Wd), Math.round(H)), bgc = g2(big); bgc.imageSmoothingQuality = 'high'; bgc.drawImage(logo, 0, 0, big.width, big.height);
  deboss((lg) => { lg.drawImage(big, X - Wd / 2, S * 0.385); }, red);
  // the logo's own colours on top (red mark and stripes, black letters)
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(big, X - Wd / 2, S * 0.385); g.restore();
  // the imprint line: the ☭≡/acc lockup, small, in black (the movement's mark beside the Party's; no tagline)
  { const L = BRAND.acc_lockup, lh = S * 0.075, lw = L.width * lh / L.height;
    deboss((lg) => { lg.drawImage(L, X - lw / 2, S * 0.86, lw, lh); }, ink); }
  return c;
}

// ================================================================ the workbench and the paper's tooth
export function benchTex(S = 1024) {
  const c = cv(S), g = g2(c), r = rng(71);
  g.fillStyle = '#2a211a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 520; i++) { const y = r() * S, a = 0.05 + r() * 0.12; g.strokeStyle = r() < 0.5 ? `rgba(12,8,6,${a})` : `rgba(90,70,52,${a * 0.6})`; g.lineWidth = 1 + r() * 4;
    g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.006 + i) * 6 + (r() - 0.5) * 2); g.stroke(); }
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(150,130,110,${0.04 + r() * 0.06})`; g.lineWidth = 0.8; const x = r() * S, y = r() * S, a = r() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 80 * r(), y + Math.sin(a) * 80 * r()); g.stroke(); }
  for (let i = 0; i < 14; i++) { const x = r() * S, y = r() * S, R = 20 + r() * 90, gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(0,0,0,${0.1 + r() * 0.2})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
  return c;
}
export function toothNormal(S = 512) {
  const c = cv(S), g = g2(c), r = rng(83), hgt = new Float32Array(S * S);
  for (let i = 0; i < 2600; i++) { const x = r() * S, y = r() * S, a = r() * Math.PI, L = 4 + r() * 20, amp = (r() - 0.4) * 0.8;
    for (let t = 0; t < L; t++) { const xi = Math.floor(x + Math.cos(a) * t + S) % S, yi = Math.floor(y + Math.sin(a) * t + S) % S; hgt[yi * S + xi] += amp; } }
  for (let i = 0; i < S * S; i++) hgt[i] += (r() - 0.5) * 0.5;
  const id = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const h = (xx, yy) => hgt[((yy + S) % S) * S + (xx + S) % S];
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), k = 0.35, n = [-dx * k, -dy * k, 1], l = Math.hypot(...n), i = (y * S + x) * 4;
    id.data[i] = (n[0] / l * 0.5 + 0.5) * 255; id.data[i + 1] = (n[1] / l * 0.5 + 0.5) * 255; id.data[i + 2] = (n[2] / l * 0.5 + 0.5) * 255; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  return c;
}

// the maps the art needs (built here so the scene only asks for surfaces)
export function foldMaps(S) {
  const st1 = { p1: 1 }, pre = { p1: 1, flip: 1 }, fin = { p1: 1, flip: 1, p2: 1 };
  return {
    stage1: foldMap(S, (u, v, P) => sheetPoint(u, v, st1, P)),
    pre: foldMap(S, (u, v, P) => sheetPoint(u, v, pre, P)),      // after the turn the top-left half's back is the top layer
    fin: foldMap(S, (u, v, P) => sheetPoint(u, v, fin, P)),
  };
}

// ================================================================ the badge: the ACP mark that rises (v7)
// a card, newsprint, a red field printed through a halftone with the emblem (the flag's four stripes, the gear, the hammer and
// sickle) knocked out of it, paper-coloured; it stands upright and level when it arrives. Back: the same stock, plain, the
// field's colour showing through faintly.
export function badgeArt(emblem, w = 1024) {
  const eh = emblem.height / emblem.width, h = Math.round(w * (eh * 0.78 + 0.34));
  const cont = cv(w, h), cg = g2(cont); cg.fillStyle = 'rgb(208,34,32)'; cg.fillRect(0, 0, w, h);
  const front = stock(w, h, PAPER.news, 61); halftone(front, cont, { cell: 8, seed: 12, gain: 1.25 });
  const fg = g2(front), Wd = w * 0.72, H = Wd * eh;
  const k = cv(Math.round(Wd), Math.round(H)), kg = g2(k); kg.imageSmoothingQuality = 'high'; kg.drawImage(emblem, 0, 0, k.width, k.height);
  kg.globalCompositeOperation = 'source-in'; kg.fillStyle = `rgb(${PAPER.ivory.join(',')})`; kg.fillRect(0, 0, k.width, k.height);
  fg.drawImage(k, (w - Wd) / 2, (h - H) / 2, Wd, H);
  // a printed border: the plate's edge, an unscreened margin with a keyline
  fg.save(); fg.strokeStyle = `rgb(${PAPER.ivory.join(',')})`; fg.lineWidth = w * 0.035; fg.strokeRect(w * 0.018, w * 0.018, w - w * 0.036, h - w * 0.036); fg.restore();
  const back = stock(w, h, PAPER.back, 63);
  return { front, back, aspect: h / w };
}
