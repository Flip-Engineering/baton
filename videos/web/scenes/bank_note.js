// PEOPLE'S NATIONAL BANK: NOTE (READ YOUR DOLLAR). One banknote, first frame to last, read by a camera that is a loupe.
// The note is built here as a layered engraving (a constructed Federal Reserve note, not a scan): guilloche, seals, lathe-work
// oval, corner roundels, the note's own lettering (Cinzel, grey until read, then inked). Our voice is set apart: Anton on a
// black strip, never in the note's letters. The argument is the re-engraving: the 1914 face (the promise to pay, the Act's
// date) -> today's face (legal tender for all debts) -> the Fed struck, THE PEOPLE'S NATIONAL BANK cut in -> re-denominated ->
// a working face in the oval -> the same clause turned into the Jubilee -> the back, backed by what is made -> the mark
// rises out of the seal. Opening variants: window.__NOTE_OPEN = 'a' (macro sharpens into the clause), 'b' (the note is laid
// down), 'c' (1914 and today side by side).
import { W, H, loadFonts, loadBeats, clamp, lerp, ease, rng, line, Finish, loadImage, outCanvas } from '../lib/kit.js';
import { drawMark, drawLockup, lockupBox } from '../lib/closer.js';

const SCENE = globalThis.__NOTE_SCENE || 'bank_note';
const OPEN = globalThis.__NOTE_OPEN || 'a';
// V2 (take d, after the v1 execution critique, review/PEOPLES_BANK_NOTE_c19/EXECUTION_CRITIQUE.md): the whole 1920 is composed
// (strip as a lower third, the note framed in the area above it, whole-note views upright), the hinges get real pictures.
const V2 = !!globalThis.__NOTE_V2;
const ctx = outCanvas();
await loadFonts();
{ const FD = '../node_modules/@fontsource';
  const faces = [['Cinzel', `${FD}/cinzel/files/cinzel-latin-600-normal.woff2`, '600'], ['Cinzel', `${FD}/cinzel/files/cinzel-latin-800-normal.woff2`, '800'],
    ['Playfair Display', `${FD}/playfair-display/files/playfair-display-latin-700-normal.woff2`, '700'],
    ['Mr De Haviland', `${FD}/mr-de-haviland/files/mr-de-haviland-latin-400-normal.woff2`, '400']];
  await Promise.all(faces.map(async ([n, u, w]) => { const f = new FontFace(n, `url(${u})`, { weight: w }); document.fonts.add(await f.load()); })); }
const B = await loadBeats(SCENE);
const finish = new Finish(1913);
const IMG = {};
for (const k of ['portrait', 'v_steel', 'v_rail', 'v_grain', 'washington']) IMG[k] = await loadImage(`../assets/bank_note/${k}.png`);   // v4: washington = G.F.C. Smillie's BEP engraving (PD, Wikimedia Commons), in the note's ink

// ------------------------------------------------------------------ palette and space
const NW = 1080, NH = 460, S = 3;                         // the note, in note units; the plates are rasterised at S
const PAPER = '#e9e4cc', INK = '#16241b', GRN = 'rgba(46,86,60,0.55)', RED = '#b3121f', CREAM = '#F4E6D0', OURRED = '#d6283a';
const NOTE_FONT = 'Cinzel';
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
const u = (b, a, c) => clamp((b - a) / (c - a));
const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const sm5 = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };

// ------------------------------------------------------------------ engraving primitives (on any context)
function rosette(g, cx, cy, R, r, d, n, p, color, lw, rot = 0) {   // hypotrochoid guilloche, drawn up to p
  const steps = Math.floor(900 * n * clamp(p));
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
  for (let i = 0; i <= steps; i++) { const t = i / 900 * Math.PI * 2;
    const x = (R - r) * Math.cos(t + rot) + d * Math.cos((R - r) / r * t - rot), y = (R - r) * Math.sin(t + rot) - d * Math.sin((R - r) / r * t - rot);
    i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y); }
  g.stroke();
}
function waveBand(g, x, y, w, h, vertical, color, phase = 0, n = 9, lw = 0.45) {   // stacked sine strands that cross: the border guilloche
  g.strokeStyle = color; g.lineWidth = lw;
  const L = vertical ? h : w, T = vertical ? w : h;
  for (let k = 0; k < n; k++) { g.beginPath();
    for (let s = 0; s <= L; s += 1.2) { const o = T / 2 + Math.sin(s * 0.16 + k * 0.7 + phase) * T * 0.4 * Math.cos(s * 0.037 + k * 0.3);
      const px = vertical ? x + o : x + s, py = vertical ? y + s : y + o; s ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke(); }
}
function arcText(g, str, cx, cy, r, mid, size, bottom, color, spacing = 1.5, family = NOTE_FONT, weight = '700') {
  g.save(); g.font = `${weight} ${size}px "${family}"`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const ws = [...str].map(ch => g.measureText(ch).width + spacing), tot = ws.reduce((a, b) => a + b, 0) / r; let pos = 0;
  [...str].forEach((ch, i) => { const c = (pos + ws[i] / 2) / r; pos += ws[i];
    const ang = bottom ? mid + tot / 2 - c : mid - tot / 2 + c; g.save(); g.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    g.rotate(bottom ? ang - Math.PI / 2 : ang + Math.PI / 2); g.fillText(ch, 0, bottom ? size * 0.72 : 0); g.restore(); });
  g.restore();
}
function ellipsePath(g, cx, cy, rx, ry) { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }

// ------------------------------------------------------------------ paper
const paperBase = mk(NW * S, NH * S);
{ const g = paperBase.getContext('2d'), r = rng(9);
  g.fillStyle = PAPER; g.fillRect(0, 0, paperBase.width, paperBase.height);
  const id = g.getImageData(0, 0, paperBase.width, paperBase.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 11; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  g.putImageData(id, 0, 0);
  for (let k = 0; k < 340; k++) { g.strokeStyle = r() < 0.5 ? 'rgba(180,30,40,0.38)' : 'rgba(30,70,150,0.34)'; g.lineWidth = 1.4;   // security fibres
    const x = r() * paperBase.width, y = r() * paperBase.height, a = r() * 6;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18, x + Math.cos(a + 1) * 34, y + Math.sin(a + 1) * 34); g.stroke(); } }

// geometry shared by plate and live layers (note units)
const OV = { cx: 640, cy: 248, rx: 118, ry: 140 };            // the portrait oval
const SEAL = { cx: 222, cy: 250, r: 84 };                       // the issuer's seal (left)
const TSEAL = { cx: 905, cy: 250, r: 60 };                      // the Treasury seal (right)
const CORNERS = [[64, 66], [NW - 64, 66], [NW - 64, NH - 66], [64, NH - 66]];
const CLAUSE_Y = 420;

// ------------------------------------------------------------------ the front plate (static engraving)
function buildFront() {
  const c = mk(NW * S, NH * S), g = c.getContext('2d'); g.scale(S, S);
  g.drawImage(paperBase, 0, 0, NW, NH);
  g.fillStyle = 'rgba(150,185,140,0.22)'; g.fillRect(14, 14, NW - 28, NH - 28);      // the pale green wash
  // lathe work behind the oval
  rosette(g, OV.cx, OV.cy, 215, 19, 150, 19, 1, 'rgba(36,66,48,0.40)', 0.45, 0.2);
  rosette(g, OV.cx, OV.cy, 175, 13, 100, 13, 1, 'rgba(179,18,31,0.30)', 0.45, 0.6);
  // fine ruled field either side of the oval
  g.strokeStyle = 'rgba(36,66,48,0.25)'; g.lineWidth = 0.35;
  for (let y = 44; y < NH - 40; y += 2.4) { g.beginPath(); g.moveTo(44, y); g.lineTo(OV.cx - 190 + Math.sin(y * 0.1) * 6, y); g.moveTo(OV.cx + 190 + Math.sin(y * 0.1) * 6, y); g.lineTo(NW - 44, y); g.stroke(); }
  // borders
  g.strokeStyle = INK; g.lineWidth = 2.6; g.strokeRect(8, 8, NW - 16, NH - 16); g.lineWidth = 0.8; g.strokeRect(13, 13, NW - 26, NH - 26);
  waveBand(g, 16, 16, NW - 32, 20, false, 'rgba(22,36,27,0.8)', 0); waveBand(g, 16, NH - 36, NW - 32, 20, false, 'rgba(22,36,27,0.8)', 2);
  waveBand(g, 16, 36, 20, NH - 72, true, 'rgba(22,36,27,0.7)', 1, 7); waveBand(g, NW - 36, 36, 20, NH - 72, true, 'rgba(22,36,27,0.7)', 3, 7);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(36, 36, NW - 72, NH - 72);
  // microprint inside the inner frame
  g.fillStyle = 'rgba(22,36,27,0.55)'; g.font = '700 3.2px "Cinzel"'; g.textBaseline = 'alphabetic';
  let s = ''; while (s.length < 420) s += 'THE UNITED STATES OF AMERICA · ';
  g.save(); g.beginPath(); g.rect(40, 118, NW - 80, 6); g.clip(); g.fillText(s, 42, 122); g.restore();
  g.save(); g.beginPath(); g.rect(40, NH - 66, NW - 80, 6); g.clip(); g.fillText(s, 42, NH - 62); g.restore();
  // corner roundels
  for (const [x, y] of CORNERS) { g.fillStyle = PAPER; g.beginPath(); g.arc(x, y, 42, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 41, 0, 7); g.stroke(); g.lineWidth = 0.6; g.beginPath(); g.arc(x, y, 37, 0, 7); g.stroke();
    rosette(g, x, y, 36, 5, 22, 5, 1, 'rgba(46,86,60,0.65)', 0.4, 0.3); g.fillStyle = 'rgba(233,228,204,0.9)'; g.beginPath(); g.arc(x, y, 24, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 0.7; g.beginPath(); g.arc(x, y, 24.5, 0, 7); g.stroke(); }
  // oval frame: concentric lathe rings, then the ruled ground of the portrait
  g.fillStyle = PAPER; ellipsePath(g, OV.cx, OV.cy, OV.rx + 26, OV.ry + 26); g.fill();
  for (let k = 0; k < 9; k++) { g.strokeStyle = k % 3 === 0 ? INK : 'rgba(46,86,60,0.7)'; g.lineWidth = k % 3 === 0 ? 1.1 : 0.45; ellipsePath(g, OV.cx, OV.cy, OV.rx + 3 + k * 2.6, OV.ry + 3 + k * 2.6); g.stroke(); }
  rosette(g, OV.cx, OV.cy - 2, OV.rx + 22, 17, 5, 17, 1, 'rgba(22,36,27,0.5)', 0.35, 0);
  g.save(); ellipsePath(g, OV.cx, OV.cy, OV.rx, OV.ry); g.clip(); g.fillStyle = 'rgba(214,220,196,1)'; g.fillRect(OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2);
  if (V2) { const wg = g.createRadialGradient(OV.cx - 20, OV.cy - 30, 10, OV.cx, OV.cy, OV.ry * 1.1); wg.addColorStop(0, 'rgba(236,233,212,1)'); wg.addColorStop(1, 'rgba(205,212,186,1)');
    g.fillStyle = wg; g.fillRect(OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2);
    if (IMG.washington) { g.globalAlpha = 0.92; g.drawImage(IMG.washington, OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2); g.globalAlpha = 1; }   // v4 (client: 'cant have blank face on bill'): the face the dollar carries
    else { g.fillStyle = 'rgba(160,170,140,0.16)'; g.beginPath(); g.ellipse(OV.cx, OV.cy - 18, 46, 58, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(OV.cx, OV.cy + 92, 80, 46, 0, Math.PI, 0); g.fill(); } }
  else { g.strokeStyle = 'rgba(22,36,27,0.55)'; g.lineWidth = 0.5;
  for (let y = OV.cy - OV.ry; y < OV.cy + OV.ry; y += 2) { g.beginPath(); g.moveTo(OV.cx - OV.rx, y); g.lineTo(OV.cx + OV.rx, y); g.stroke(); } }
  g.restore(); g.strokeStyle = INK; g.lineWidth = 1.2; ellipsePath(g, OV.cx, OV.cy, OV.rx, OV.ry); g.stroke();
  // seals: the left (issuer) is a rosette disc with rings, text and emblem drawn live; the right (Treasury) is fixed
  for (const [S1, ink] of [[SEAL, 'rgba(22,36,27,0.85)'], [TSEAL, 'rgba(30,78,52,0.9)']]) {
    g.fillStyle = PAPER; g.beginPath(); g.arc(S1.cx, S1.cy, S1.r + 6, 0, 7); g.fill();
    g.strokeStyle = ink; g.lineWidth = 1.4; g.beginPath(); g.arc(S1.cx, S1.cy, S1.r, 0, 7); g.stroke(); g.lineWidth = 0.6; g.beginPath(); g.arc(S1.cx, S1.cy, S1.r - 3, 0, 7); g.stroke();
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, r0 = S1.r + 1, r1 = S1.r + (i % 2 ? 3.5 : 5.5); g.beginPath(); g.moveTo(S1.cx + Math.cos(a) * r0, S1.cy + Math.sin(a) * r0); g.lineTo(S1.cx + Math.cos(a) * r1, S1.cy + Math.sin(a) * r1); g.stroke(); }
    g.lineWidth = 0.6; g.beginPath(); g.arc(S1.cx, S1.cy, S1.r * 0.62, 0, 7); g.stroke();
    rosette(g, S1.cx, S1.cy, S1.r * 0.6, 7, S1.r * 0.34, 7, 1, ink, 0.35, 0.4); }
  g.fillStyle = 'rgba(30,78,52,0.95)'; g.font = '800 5.4px "Cinzel"';
  arcText(g, 'THE DEPARTMENT OF THE TREASURY', TSEAL.cx, TSEAL.cy, TSEAL.r - 8, -Math.PI / 2, 5.2, false, 'rgba(30,78,52,0.95)', 0.8);
  arcText(g, '1789', TSEAL.cx, TSEAL.cy, TSEAL.r - 8, Math.PI / 2, 5.2, true, 'rgba(30,78,52,0.95)', 1.5);
  // Treasury shield (scales and chevron, simplified) and WASHINGTON, D.C.
  g.strokeStyle = 'rgba(30,78,52,0.95)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(TSEAL.cx - 15, TSEAL.cy - 18); g.lineTo(TSEAL.cx + 15, TSEAL.cy - 18); g.lineTo(TSEAL.cx + 15, TSEAL.cy + 4);
  g.quadraticCurveTo(TSEAL.cx + 15, TSEAL.cy + 18, TSEAL.cx, TSEAL.cy + 22); g.quadraticCurveTo(TSEAL.cx - 15, TSEAL.cy + 18, TSEAL.cx - 15, TSEAL.cy + 4); g.closePath(); g.stroke();
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(TSEAL.cx - 12 + i * 6, TSEAL.cy - 18); g.lineTo(TSEAL.cx - 12 + i * 6, TSEAL.cy + 12 + (i === 2 ? 7 : 0)); g.stroke(); }
  g.fillStyle = INK; g.font = '600 6.5px "Cinzel"'; g.textAlign = 'center'; g.fillText('WASHINGTON, D.C.', 905, 340);
  g.fillText('SERIES OF', 905, 362); g.font = '800 11px "Cinzel"'; g.fillText('2021', 905, 376);
  // signatures (a hand, not names)
  g.font = '30px "Mr De Haviland"'; g.fillStyle = 'rgba(22,36,27,0.85)'; g.fillText('Treasurer', 330, 392); g.fillText('Secretary', 780, 392);
  g.font = '600 5.6px "Cinzel"'; g.fillText('TREASURER OF THE UNITED STATES', 330, 399); g.fillText('SECRETARY OF THE TREASURY', 780, 399);
  g.textAlign = 'left';
  return c;
}

// ------------------------------------------------------------------ the back plate: four lathe frames
const PANELS = [{ x: 50, key: 'v_steel', word: 'STEEL' }, { x: 300, key: 'v_rail', word: 'RAIL' }, { x: 550, key: 'v_grain', word: 'GRAIN' }, { x: 800, key: 'chips', word: 'CHIPS' }];
const PY0 = 106, PH = 288, PW = 230;
function drawChips(g, x, y, w, h) {                           // a silicon wafer, cut as line engraving (constructed, no photograph)
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(214,220,196,1)'; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.5, R = 98;
  g.strokeStyle = 'rgba(22,36,27,0.85)'; g.lineWidth = 0.55;                                    // the ground: dense ruled tone, darker to the foot
  for (let yy = y; yy < y + h; yy += 1.7) { const k = 0.25 + 0.75 * ((yy - y) / h); g.globalAlpha = k; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
  g.globalAlpha = 1;
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); g.fillStyle = 'rgba(224,228,206,1)'; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  const dw = 13, dh = 9;                                                                         // the die grid, each die shaded by its place on the disc
  for (let i = -9; i <= 9; i++) for (let j = -12; j <= 12; j++) { const dx = cx + i * dw, dy = cy + j * dh, dist = Math.hypot(i * dw, j * dh) / R, ang = Math.atan2(j * dh, i * dw);
    const tone = clamp(0.25 + 0.6 * dist + 0.35 * Math.cos(ang + 0.9) * dist); g.strokeStyle = INK; g.lineWidth = 0.35;
    g.strokeRect(dx - dw / 2 + 0.5, dy - dh / 2 + 0.5, dw - 1, dh - 1);
    const n = Math.round(2 + tone * 7); g.lineWidth = 0.3 + tone * 0.35; g.beginPath(); for (let k = 0; k < n; k++) { const yy = dy - dh / 2 + 1 + k * (dh - 2) / n; g.moveTo(dx - dw / 2 + 1, yy); g.lineTo(dx + dw / 2 - 1, yy); } g.stroke();
    g.beginPath(); g.moveTo(dx - 3, dy - 1); g.lineTo(dx - 1, dy - 1); g.lineTo(dx - 1, dy + 1); g.lineTo(dx + 3, dy + 1); g.stroke(); }
  g.restore();
  g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();   // edge, bevel and the flat
  g.lineWidth = 0.6; g.beginPath(); g.arc(cx, cy, R - 4, 0, 7); g.stroke();
  g.fillStyle = PAPER; g.beginPath(); g.moveTo(cx - 14, cy + R + 2); g.lineTo(cx + 14, cy + R + 2); g.lineTo(cx + 12, cy + R - 5); g.lineTo(cx - 12, cy + R - 5); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(22,36,27,0.85)'; g.lineWidth = 0.7;                                      // traces leaving the disc
  for (let k = 0; k < 7; k++) { const yy = y + 12 + k * 6; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 40 - k * 3, yy); g.lineTo(x + 52 - k * 3, yy + 8); g.lineTo(x + 78, yy + 8); g.stroke(); g.beginPath(); g.arc(x + 80, yy + 8, 1.2, 0, 7); g.stroke(); }
  g.restore();
}
function drawChipPkg(g, x, y, w, h) {                         // V2: a packaged chip on a board, engraved (a wafer grid read as a drain cover)
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(214,220,196,1)'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(22,36,27,0.5)'; g.lineWidth = 0.45;
  for (let yy = y; yy < y + h; yy += 2.2) { g.globalAlpha = 0.35 + 0.5 * ((yy - y) / h); g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
  g.globalAlpha = 1;
  const cx = x + w / 2, cy = y + h * 0.46, s = 116;
  g.strokeStyle = 'rgba(22,36,27,0.9)'; g.lineWidth = 0.9;                                          // traces: from every pin out to the frame
  for (let side = 0; side < 4; side++) for (let k = 0; k < 9; k++) { const o = -s / 2 + 8 + k * (s - 16) / 8;
    g.beginPath(); if (side === 0) { g.moveTo(cx + o, cy - s / 2 - 12); g.lineTo(cx + o * 1.5, cy - s / 2 - 34); g.lineTo(cx + o * 1.5, y); }
    else if (side === 1) { g.moveTo(cx + o, cy + s / 2 + 12); g.lineTo(cx + o * 1.5, cy + s / 2 + 34); g.lineTo(cx + o * 1.5, y + h); }
    else if (side === 2) { g.moveTo(cx - s / 2 - 12, cy + o); g.lineTo(cx - s / 2 - 30, cy + o * 1.6); g.lineTo(x, cy + o * 1.6); }
    else { g.moveTo(cx + s / 2 + 12, cy + o); g.lineTo(cx + s / 2 + 30, cy + o * 1.6); g.lineTo(x + w, cy + o * 1.6); } g.stroke(); }
  g.fillStyle = 'rgba(224,228,206,1)'; g.lineWidth = 0.8;                                          // the pins
  for (let k = 0; k < 9; k++) { const o = -s / 2 + 8 + k * (s - 16) / 8;
    for (const [px, py, pw, ph] of [[cx + o - 2.5, cy - s / 2 - 12, 5, 12], [cx + o - 2.5, cy + s / 2, 5, 12], [cx - s / 2 - 12, cy + o - 2.5, 12, 5], [cx + s / 2, cy + o - 2.5, 12, 5]]) { g.fillRect(px, py, pw, ph); g.strokeRect(px, py, pw, ph); } }
  g.fillStyle = 'rgba(30,40,34,1)'; g.fillRect(cx - s / 2, cy - s / 2, s, s);                      // the body: dense cross-hatch, lit from the top left
  g.strokeStyle = 'rgba(233,228,204,0.32)'; g.lineWidth = 0.5;
  for (let k = -s; k < s; k += 3.2) { g.beginPath(); g.moveTo(cx - s / 2 + Math.max(0, k), cy - s / 2 + Math.max(0, -k)); g.lineTo(cx - s / 2 + Math.min(s, s + k), cy - s / 2 + Math.min(s, s - k)); g.stroke(); }
  g.strokeStyle = 'rgba(233,228,204,0.8)'; g.lineWidth = 1; g.strokeRect(cx - s / 2 + 4, cy - s / 2 + 4, s - 8, s - 8);
  g.beginPath(); g.arc(cx - s / 2 + 15, cy - s / 2 + 15, 5, 0, 7); g.stroke();
  g.restore();
}
function buildBack() {
  const c = mk(NW * S, NH * S), g = c.getContext('2d'); g.scale(S, S);
  g.drawImage(paperBase, 0, 0, NW, NH);
  g.fillStyle = 'rgba(150,185,140,0.22)'; g.fillRect(14, 14, NW - 28, NH - 28);
  rosette(g, 540, 250, 260, 23, 170, 23, 1, 'rgba(36,66,48,0.30)', 0.45, 0.1);
  g.strokeStyle = INK; g.lineWidth = 2.6; g.strokeRect(8, 8, NW - 16, NH - 16); g.lineWidth = 0.8; g.strokeRect(13, 13, NW - 26, NH - 26);
  waveBand(g, 16, 16, NW - 32, 18, false, 'rgba(22,36,27,0.8)', 1); waveBand(g, 16, NH - 34, NW - 32, 18, false, 'rgba(22,36,27,0.8)', 3);
  waveBand(g, 16, 34, 18, NH - 68, true, 'rgba(22,36,27,0.7)', 2, 7); waveBand(g, NW - 34, 34, 18, NH - 68, true, 'rgba(22,36,27,0.7)', 4, 7);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(36, 36, NW - 72, NH - 72);
  for (const p of PANELS) {
    g.fillStyle = PAPER; g.fillRect(p.x - 12, PY0 - 12, PW + 24, PH + 24);
    for (let k = 0; k < 6; k++) { g.strokeStyle = k % 3 === 0 ? INK : 'rgba(46,86,60,0.7)'; g.lineWidth = k % 3 === 0 ? 1 : 0.4; g.strokeRect(p.x - 3 - k * 1.6, PY0 - 3 - k * 1.6, PW + 6 + k * 3.2, PH + 6 + k * 3.2); }
    for (const [cx, cy] of [[p.x - 6, PY0 - 6], [p.x + PW + 6, PY0 - 6], [p.x - 6, PY0 + PH + 6], [p.x + PW + 6, PY0 + PH + 6]]) rosette(g, cx, cy, 9, 4, 5, 4, 1, 'rgba(22,36,27,0.9)', 0.4, 0);
    g.save(); g.beginPath(); g.rect(p.x, PY0, PW, PH); g.clip();
    if (p.key === 'chips') (V2 ? drawChipPkg : drawChips)(g, p.x, PY0, PW, PH);
    else { const im = IMG[p.key], ins = 0.045, sw = im.width * (1 - 2 * ins), sh = sw * PH / PW, sy = (im.height - sh) / 2;
      g.fillStyle = 'rgba(224,228,206,1)'; g.fillRect(p.x, PY0, PW, PH); g.drawImage(im, im.width * ins, Math.max(0, sy), sw, Math.min(sh, im.height), p.x, PY0, PW, PH); }
    g.restore(); g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(p.x, PY0, PW, PH);
  }
  return c;
}
const FRONT = buildFront(), BACK = buildBack();

// ------------------------------------------------------------------ the desk (lamp pool on dark baize)
const desk = mk(W, H);
{ const g = desk.getContext('2d'), r = rng(4);
  const gr = V2 ? g.createRadialGradient(540, 820, 120, 540, 960, 1300) : g.createRadialGradient(540, 620, 80, 540, 760, 1250); gr.addColorStop(0, '#1d2a22'); gr.addColorStop(0.55, '#0f1813'); gr.addColorStop(1, '#050806');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.07; g.strokeStyle = '#8fb39b'; g.lineWidth = 1;
  for (let k = 0; k < 520; k++) { const y = r() * H, x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30 + r() * 60, y + (r() - 0.5) * 3); g.stroke(); }
  g.globalAlpha = 1; }

// ------------------------------------------------------------------ note lettering: grey until read, inked as the loupe reads it
const GHOST = 'rgba(22,36,27,0.58)';
function ntext(g, str, x, y, o = {}) {
  const { size = 20, weight = '700', family = NOTE_FONT, sp = 1, align = 'center', read = 1, ink = INK, alpha = 1, ghost = GHOST, redUnder = 0 } = o;
  g.save(); g.font = `${weight} ${size}px "${family}"`; g.letterSpacing = `${sp}px`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const w = g.measureText(str).width, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.globalAlpha *= alpha;
  if (read < 1) { g.fillStyle = ghost; g.fillText(str, x0, y); }
  if (read > 0) { g.save(); g.beginPath(); g.rect(x0 - 4, y - size * 1.2, (w + 8) * clamp(read), size * 1.6); g.clip(); g.fillStyle = ink; g.fillText(str, x0, y); g.restore();
    if (read > 0 && read < 1) { g.fillStyle = 'rgba(214,40,58,0.85)'; g.fillRect(x0 + w * read - 0.6, y - size * 0.85, 1.2, size * 1.05); } }   // the loupe's read edge
  if (redUnder > 0) { g.fillStyle = RED; g.fillRect(x0, y + size * 0.16, w * clamp(redUnder), Math.max(1.1, size * 0.09)); }
  g.restore(); return { x0, w };
}
function wordSpans(str, y, o) {                                   // x-extent of each word of a centred line (note units)
  const g = ctx; g.save(); g.font = `${o.weight || '700'} ${o.size}px "${NOTE_FONT}"`; g.letterSpacing = `${o.sp}px`;
  const w = g.measureText(str).width, x0 = 540 - w / 2, out = [];
  for (const m of str.matchAll(/[^\s]+/g)) { const pre = g.measureText(str.slice(0, m.index)).width, ww = g.measureText(m[0].replace(/,$/, '')).width; out.push({ w: m[0], x0: x0 + pre, x1: x0 + pre + ww }); }
  g.restore(); return out;
}
const CLAUSE = 'THIS NOTE IS LEGAL TENDER FOR ALL DEBTS, PUBLIC AND PRIVATE', CLAUSE_O = { size: 19, sp: 1.1 };
const PROMISE = 'THE UNITED STATES WILL PAY TO THE BEARER ON DEMAND', PROMISE_O = { size: 17.5, sp: 1 };
const SPANS = wordSpans(CLAUSE, CLAUSE_Y, CLAUSE_O);
const span = (...ws) => { const a = SPANS.filter(s => ws.includes(s.w.replace(',', ''))); return [a[0].x0, a[a.length - 1].x1]; };

// ------------------------------------------------------------------ the story, by beat (120 bpm)
const T = {
  clause0: [0.6, 3.2], read: { banner: [8.4, 10.6], clause: [12.4, 15.2], date: [16.6, 18.2], promise: [18.6, 21.2] },
  rewind: [15.4, 16.5], unwind: [21.2, 22.2], cutClause: [22.4, 24.6],
  strike: V2 ? [28, 28.8] : [28, 28.4], burn: V2 ? [28.9, 29.7] : [28.7, 29.7], cutBanner: 29.6, cutSeal: [33, 35.2], deno: 36, face: [40.2, 44.4],
  jub: V2 ? 45 : 45.4, stamps: [48, 50, 52], clear: [54, 56.2], flip1: [57, 58.1], flip2: [69.2, 70.2], payoff: 70.2,   // V2: the Jubilee stamp lands on the downbeat with its caption (b45)
  markIn: [75, 77], stripes: [77, 79.6], lock: 80,
};
const CAPS1 = [[3.5, 'READ YOUR DOLLAR.', ['DOLLAR.']], [8, 'THE FED ISSUES IT.', ['FED']], [12, 'IT PAYS ANY DEBT.', ['ANY']], [16, 'THE FED, 1913.', ['1913.']],
  [18.4, 'IT PROMISED TO PAY.', ['PROMISED']], [22, 'THE PROMISE WAS DROPPED.', ['DROPPED.']], [25.3, 'THE POWER STAYED.', ['POWER']],
  [28, 'FED ABOLISHED.', ['ABOLISHED.']], [30.4, "A PEOPLE'S NATIONAL BANK.", ["PEOPLE'S"]], [35.4, null], [41, 'ISSUED BY THE WORKING CLASS.', ['WORKING', 'CLASS.']],
  [45, 'DEBT JUBILEE.', ['JUBILEE.']], [48, 'ALL DEBTS.', ['DEBTS.']], [50, 'PUBLIC.', ['PUBLIC.']], [52, 'PRIVATE.', ['PRIVATE.']], [54, 'CLEARED.', ['CLEARED.']], [56.6, null],
  [58, 'BACKED BY.', ['BACKED']], [60, 'STEEL.', ['STEEL.']], [62, 'RAIL.', ['RAIL.']], [64, 'GRAIN.', ['GRAIN.']], [66, 'CHIPS.', ['CHIPS.']], [68, null],
  [70.4, "THE PEOPLE'S MONEY.", ['MONEY.']], [77.6, null]];
// V2: caption only what the note can't say; the bank's name, the stamped clause and the back's nouns are read on the note itself
const CAPS2 = [[3.5, 'READ YOUR DOLLAR.', ['DOLLAR.']], [8, 'THE FED ISSUES IT.', ['FED']], [12, 'IT PAYS ANY DEBT.', ['ANY']],
  [16, 'YOUR DOLLAR USED TO PROMISE SOMETHING.', ['PROMISE']], [18.4, 'IT PROMISED TO PAY.', ['PROMISED']], [22, 'THE PROMISE WAS DROPPED.', ['DROPPED.']],
  [25.3, 'THE POWER STAYED.', ['POWER']], [28, 'FED ABOLISHED.', ['ABOLISHED.']], [30.4, null], [41, 'ISSUED BY THE WORKING CLASS.', ['WORKING', 'CLASS.']],
  [45, 'DEBT JUBILEE.', ['JUBILEE.']], [47.8, null], [54, 'CLEARED.', ['CLEARED.']], [56.4, null], [58.4, 'BACKED BY.', ['BACKED']], [60, null],
  [70.4, "THE PEOPLE'S MONEY.", ['MONEY.']], [77.6, null]];
const CAPS = V2 ? CAPS2 : CAPS1;
// camera keys: beat, note-x, note-y, zoom, rotation (rad). The loupe glides between them (smootherstep), never sits still.
const Q = Math.PI / 2;
const CAM = [
  [0, 330, 420, 4.4, 0], [3.2, 640, 420, 3.0, 0], [4.2, 540, 232, 0.97, 0], [7.4, 560, 214, 1.05, -0.015],
  [8.4, 540, 76, 1.62, 0], [11, 540, 82, 1.55, 0.01],
  [12.3, 300, 416, 2.55, 0], [15.2, 790, 416, 2.55, 0],
  [16.3, 190, 140, 3.1, 0], [18.4, 330, 150, 3.0, 0.012],
  [18.8, 290, 418, 2.45, 0], [21.2, 790, 418, 2.45, 0],
  [22.4, 300, 418, 2.45, 0], [24.6, 790, 418, 2.45, 0], [26.8, 540, 232, 0.99, 0],
  [28, 540, 76, 1.62, 0], [30.6, 540, 80, 1.5, 0], [32.4, 390, 150, 1.3, 0], [35, 330, 190, 1.3, 0],
  [35.9, 540, 230, 1.72, Q], [39, 540, 230, 1.72, Q], [40, 640, 248, 2.55, 0], [44.6, 650, 250, 2.7, 0],
  [45.8, 222, 250, 2.9, 0], [47.6, 480, 330, 2.0, 0],
  [48, 300, 418, 2.45, 0], [49.8, 580, 418, 2.45, 0], [51.8, 760, 418, 2.45, 0], [53.4, 540, 300, 1.35, 0], [55, 540, 232, 1.0, 0], [56.6, 540, 232, 0.98, 0],
  [58.4, 540, 232, 0.98, 0], [59.4, 165, 250, 2.62, 0], [61.4, 165, 250, 2.62, 0], [62.1, 415, 250, 2.62, 0], [63.4, 415, 250, 2.62, 0], [64.1, 665, 250, 2.62, 0],
  [65.4, 665, 250, 2.62, 0], [66.1, 915, 250, 2.62, 0], [67.6, 915, 250, 2.62, 0], [69.2, 540, 232, 0.98, 0],
  [70.8, 540, 232, 0.98, 0], [74.4, 540, 232, 1.05, 0], [76, 222, 250, 3.4, 0], [79.6, 222, 250, 6.4, 0], [90, 222, 250, 6.4, 0],
];
const mid = (...ws) => { const [a, c] = span(...ws); return (a + c) / 2; };
const CAM2 = [
  [0, 330, 420, 3.4, 0], [3.0, 600, 420, 2.7, 0], [4.2, 600, 230, 2.0, 0], [7.4, 580, 220, 2.1, -0.015],
  [8.4, 540, 76, 1.95, 0], [11, 540, 82, 1.9, 0.01],
  [12.3, 300, 416, 2.55, 0], [15.2, 790, 416, 2.55, 0],
  [16.3, 190, 140, 3.1, 0], [18.4, 330, 150, 3.0, 0.012],
  [18.8, 290, 418, 2.45, 0], [21.2, 790, 418, 2.45, 0],
  [22.4, 300, 418, 2.45, 0], [24.6, 790, 418, 2.45, 0],
  [25.4, 250, 250, 2.4, 0], [27.4, 230, 250, 2.85, 0],
  [28, 540, 72, 1.95, 0], [30.6, 540, 78, 1.95, 0], [32.6, 240, 245, 2.6, 0], [35, 230, 245, 2.8, 0],
  [35.9, 540, 230, 1.78, Q], [39, 540, 230, 1.78, Q], [40, 640, 248, 3.0, 0], [44.6, 645, 250, 3.6, 0],
  [44.99, 646, 251, 3.66, 0], [45.0, 335, 262, 1.75, 0], [45.9, 338, 264, 1.79, 0],   // v5: a cut on b45 (the Jubilee's downbeat) from his face to the seal as DEBT JUBILEE lands across it, then one glide down to the clause, arriving on the first stamp (b48)
  [48, mid('ALL', 'DEBTS'), 416, 3.4, 0], [49.8, mid('PUBLIC'), 416, 3.4, 0], [51.8, mid('PRIVATE'), 416, 3.4, 0],
  [53.4, 880, 128, 3.0, 0], [54.6, 900, 126, 4.0, 0], [55.4, 900, 126, 4.0, 0], [56.0, 540, 436, 4.9, 0], [56.9, 540, 436, 5.1, 0],
  [58.4, 540, 200, 1.6, 0], [59.4, 165, 250, 3.2, 0], [61.4, 165, 250, 3.2, 0], [62.1, 415, 250, 3.2, 0], [63.4, 415, 250, 3.2, 0], [64.1, 665, 250, 3.2, 0],
  [65.4, 665, 250, 3.2, 0], [66.1, 915, 250, 3.2, 0], [67.6, 915, 250, 3.2, 0], [69.2, 540, 232, 1.2, 0],
  [70.6, 540, 230, 1.75, Q], [74.4, 540, 230, 1.86, Q], [76, 222, 250, 3.4, 0], [79.6, 222, 250, 6.4, 0], [90, 222, 250, 6.4, 0],
];
const CAMB = [[0, 540, 232, 0.97, 0], [3.6, 540, 232, 0.97, 0], [4.0, 540, 232, 0.99, 0], [5.4, 330, 420, 3.0, 0], [7.6, 760, 420, 2.7, 0], [8.4, 540, 76, 1.62, 0]];
function cam(b) {
  const CAM_ = (OPEN === 'b' && b < 8.4) ? CAMB : (V2 ? CAM2 : CAM); let i = 0; while (i < CAM_.length - 2 && b >= CAM_[i + 1][0]) i++;
  const a = CAM_[i], c = CAM_[i + 1], k = sm5((b - a[0]) / (c[0] - a[0]));
  const lz = Math.log(a[3]) + (Math.log(c[3]) - Math.log(a[3])) * k;
  return { x: lerp(a[1], c[1], k), y: lerp(a[2], c[2], k), z: Math.exp(lz), rot: lerp(a[4], c[4], k) };
}

// ------------------------------------------------------------------ live state of a note face at beat b
const SER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function serialText(b, t, era) {
  const rr = rng(Math.floor(t * 18) * 7 + 3), seed = rng(21);
  const base = `${SER_CHARS[Math.floor(seed() * 24)]}${SER_CHARS[Math.floor(seed() * 24)]} ${String(Math.floor(seed() * 1e8)).padStart(8, '0')} ${SER_CHARS[Math.floor(seed() * 24)]}`;
  const zero = 'PN 00000000 A';
  const rollIn = (b >= T.clear[0] - 0.4 && b < T.clear[1]);
  if (era > 0.5) return rollIn ? base : 'B ' + base.slice(3, 10) + ' A';
  if (b < T.clear[0] - 0.4) return base;
  if (b >= T.clear[1] + 0.2 || b > 100) return zero;
  // spin, then settle left to right onto zeros
  const settle = (b - (T.clear[0] - 0.4)) / (T.clear[1] - T.clear[0] + 0.4) * 13, out = [];
  for (let i = 0; i < zero.length; i++) out.push(i < settle ? zero[i] : (zero[i] === ' ' ? ' ' : (i < 2 || i === 12 ? SER_CHARS[Math.floor(rr() * 24)] : String(Math.floor(rr() * 10)))));
  return out.join('');
}

// draw one face of the note into note space. L = live state (era mix e: 0 today, 1 the 1914 note).
function drawFront(g, L, b, t) {
  g.drawImage(FRONT, 0, 0, NW, NH);
  const e = L.era;
  // era tint: the 1914 note is older stock
  if (e > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(190,160,100,${(V2 ? 0.55 : 0.34) * e})`; g.fillRect(0, 0, NW, NH);
    if (V2) { const fr = rng(14); g.fillStyle = `rgba(120,80,30,${0.22 * e})`; for (let k = 0; k < 60; k++) { g.beginPath(); g.arc(fr() * NW, fr() * NH, 1 + fr() * 5, 0, 7); g.fill(); }
      const eg = g.createRadialGradient(NW / 2, NH / 2, NH * 0.4, NW / 2, NH / 2, NW * 0.62); eg.addColorStop(0, 'rgba(90,60,20,0)'); eg.addColorStop(1, `rgba(90,60,20,${0.45 * e})`); g.fillStyle = eg; g.fillRect(0, 0, NW, NH); }
    g.restore(); }
  // ---- the issuer's banner
  const bannerAlpha = 1 - sm(u(b, T.burn[0], T.burn[1]));
  const bn = { size: 40, sp: 2.2, weight: '800' };
  if (b < T.burn[1] || L.forceFed) {
    g.save(); g.globalAlpha = L.forceFed ? 1 : bannerAlpha;
    ntext(g, 'FEDERAL RESERVE NOTE', 540, 82, { ...bn, read: L.read.banner });
    g.restore();
    if (!L.forceFed && b >= T.strike[0]) {                                          // the strike: a red bar runs through the Fed's line
      const p = ease.outExpo(u(b, T.strike[0], T.strike[1])), a = 1 - sm(u(b, T.burn[0] + 0.3, T.burn[1]));
      if (V2) { const q = ease.outCubic(u(b, T.strike[0], T.strike[1])), xe = 540 - 266 + 532 * q; g.save(); g.globalAlpha = a; g.fillStyle = RED;
        g.beginPath(); g.moveTo(540 - 266, 60); g.lineTo(xe, 58); g.lineTo(xe, 72); g.lineTo(540 - 266, 74); g.closePath(); g.fill();
        if (q < 1) { g.fillStyle = 'rgba(250,240,200,0.95)'; g.fillRect(xe - 2, 52, 4, 26); const r2 = rng(Math.floor(b * 40)); for (let k = 0; k < 14; k++) { const aa = -Math.PI * r2(), d = 6 + r2() * 26; g.fillStyle = k % 2 ? RED : 'rgba(30,40,34,0.8)'; g.fillRect(xe - d * 0.6 + Math.cos(aa) * d * 0.3, 64 + Math.sin(aa) * d, 2, 2); } }
        g.restore(); }
      else { g.save(); g.globalAlpha = a; g.fillStyle = RED; g.fillRect(540 - 262, 69, 524 * p, 5.5); g.restore(); }
      if (b > T.burn[0] && b < T.burn[1]) { g.save(); g.fillStyle = PAPER; g.globalAlpha = 0.9; const wipe = sm(u(b, T.burn[0], T.burn[1])); g.fillRect(540 - 270, 40, 540 * wipe, 52); g.restore(); }
    }
  }
  if (!L.forceFed && b >= T.cutBanner - 0.2) {                                      // THE PEOPLE'S NATIONAL BANK, cut by the burin, letter by letter
    const str = "THE PEOPLE'S NATIONAL BANK"; g.save(); g.font = `800 36px "${NOTE_FONT}"`; g.letterSpacing = '2px'; g.textBaseline = 'alphabetic';
    const tw = g.measureText(str).width; let x = 540 - tw / 2;
    for (let i = 0; i < str.length; i++) { const ch = str[i], cw = g.measureText(ch).width + 2, ti = T.cutBanner + i * 0.17, p = u(b, ti, ti + 0.3);
      if (p > 0) { const hot = 1 - sm(u(b, ti + 0.3, ti + 1.0)); g.save(); g.beginPath(); g.rect(x - 2, 40, (cw + 2) * ease.outCubic(p), 56); g.clip();
        g.fillStyle = hot > 0.02 ? `rgb(${Math.round(22 + 160 * hot)},${Math.round(36 - 20 * hot)},${Math.round(27 - 10 * hot)})` : INK; g.fillText(ch, x, 82); g.restore();
        if (p < 1) { g.fillStyle = 'rgba(250,240,200,0.95)'; g.fillRect(x + cw * ease.outCubic(p) - 1, 55, 1.4, 28);
          const r2 = rng(i * 13 + 7); for (let k = 0; k < 6; k++) { const a = r2() * 6.28, d = (0.4 + r2()) * 7 * p; g.fillStyle = 'rgba(30,40,34,0.75)'; g.fillRect(x + cw * p + Math.cos(a) * d, 70 + Math.sin(a) * d, 1.1, 1.1); } } }
      x += cw; }
    g.restore();
  }
  ntext(g, 'THE UNITED STATES OF AMERICA', 540, 104, { size: 11.5, sp: 3.2, read: 1, ink: 'rgba(22,36,27,0.85)' });
  // ---- 1914 lines: the Act's date and the series (left), kept to the old note
  if (e > 0.01) { g.save(); g.globalAlpha = e;
    ntext(g, 'AUTHORIZED BY FEDERAL RESERVE', 66, 126, { size: 10.5, sp: 0.9, align: 'left', read: L.read.date });
    ntext(g, 'ACT OF DECEMBER 23, 1913', 66, 141, { size: 10.5, sp: 0.9, align: 'left', read: clamp(L.read.date * 1.4 - 0.3) });
    ntext(g, 'SERIES OF 1914', 66, 157, { size: 9, sp: 1.6, align: 'left', read: 1, ink: 'rgba(22,36,27,0.8)' });
    g.restore(); }
  // ---- the bottom line: the promise (1914) becomes the clause (today)
  if (e > 0.01 || L.promiseWipe < 1) {
    g.save(); g.globalAlpha = Math.max(e, 0);
    if (L.promiseGone < 1) { g.globalAlpha = Math.max(0, 1 - L.promiseGone) * Math.max(e, L.promiseWipe < 1 ? 1 : 0); ntext(g, PROMISE, 540, CLAUSE_Y, { ...PROMISE_O, read: L.read.promise });
      ntext(g, 'ONE HUNDRED DOLLARS', 540, CLAUSE_Y + 14, { size: 8.5, sp: 3, read: L.read.promise, ink: 'rgba(22,36,27,0.85)' }); }
    g.restore();
    if (L.promiseGone > 0 && L.promiseGone < 1) { g.save(); g.fillStyle = PAPER; g.globalAlpha = 0.85; g.fillRect(540 - 420, CLAUSE_Y - 22, 840 * L.promiseGone, 38); g.restore(); }
  }
  if (e < 0.99 && !(L.noClause)) {
    const cutP = L.cutClause;                                              // 0..1 = how much of the clause has been cut in (after the promise went)
    g.save(); g.globalAlpha = (1 - e) * (L.clauseFade ?? 1);
    if (cutP >= 1 || !L.clauseCut) { const jub = L.jubilee;
      const base = ntext(g, CLAUSE, 540, CLAUSE_Y, { ...CLAUSE_O, read: L.read.clause, redUnder: L.clauseUnder });
      for (const s of jub) { if (s.p > 0) { const [xa, xb] = s.range; g.save(); g.globalAlpha = 1; g.beginPath(); g.rect(xa - 2, CLAUSE_Y - 20, xb - xa + 4, 28); g.clip();
        g.fillStyle = PAPER; g.fillRect(xa - 2, CLAUSE_Y - 20, xb - xa + 4, 28); g.restore(); ntext(g, CLAUSE.slice(0, 0), 0, 0, {});
        g.save(); g.font = `700 ${CLAUSE_O.size}px "${NOTE_FONT}"`; g.letterSpacing = `${CLAUSE_O.sp}px`; g.fillStyle = RED; g.textBaseline = 'alphabetic';
        const full = g.measureText(CLAUSE).width, x0 = 540 - full / 2; g.beginPath(); g.rect(xa - 2, CLAUSE_Y - 20, xb - xa + 4, 28); g.clip(); g.fillText(CLAUSE, x0, CLAUSE_Y); g.restore();
        // the stamp's frame lands on the printed words
        const sc = 1 + 0.55 * Math.exp(-s.age * 16), ox = (xa + xb) / 2, oy = CLAUSE_Y - 6;
        g.save(); g.translate(ox, oy); g.scale(sc, sc); g.rotate(s.rot * Math.exp(-s.age * 9)); g.globalAlpha = clamp(s.age * 12 + 0.2);
        g.strokeStyle = RED; g.lineWidth = 2.1; g.strokeRect(-(xb - xa) / 2 - 5, -17, xb - xa + 10, 28); g.lineWidth = 0.7; g.strokeRect(-(xb - xa) / 2 - 8, -20, xb - xa + 16, 34); g.restore(); } }
    } else {                                                               // cut in letter by letter where the promise stood
      g.font = `700 ${CLAUSE_O.size}px "${NOTE_FONT}"`; g.letterSpacing = `${CLAUSE_O.sp}px`; g.textBaseline = 'alphabetic';
      const full = g.measureText(CLAUSE).width; let x = 540 - full / 2;
      for (let i = 0; i < CLAUSE.length; i++) { const ch = CLAUSE[i], cw = g.measureText(ch).width + CLAUSE_O.sp, p = clamp(cutP * (CLAUSE.length + 4) - i) ;
        if (p > 0) { const hot = 1 - p; g.fillStyle = `rgb(${Math.round(22 + 150 * hot)},${Math.round(36 - 16 * hot)},${Math.round(27 - 8 * hot)})`; g.fillText(ch, x, CLAUSE_Y); } x += cw; }
    }
    g.restore();
  }
  // ---- the issuer's seal
  drawSeal(g, L, b, t);
  // ---- corner numerals: 100 -> 1
  CORNERS.forEach(([x, y], k) => {
    const tk = T.deno + k * 0.5, p = u(b, tk, tk + 0.55);
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p <= 0) { g.font = '700 25px "Playfair Display"'; g.fillStyle = INK; g.fillText('100', x, y + 1); }
    else { g.font = '700 25px "Playfair Display"'; g.globalAlpha = 1 - sm(u(p, 0, 0.45)); g.fillStyle = p < 0.3 ? RED : INK; g.fillText('100', x, y + 1); g.globalAlpha = 1;
      const q = ease.outBack(u(p, 0.35, 1)); g.font = `700 ${25 + 15 * q}px "Playfair Display"`; g.fillStyle = INK; g.globalAlpha = u(p, 0.35, 0.6); g.fillText('1', x, y + 1); }
    g.restore();
  });
  // ---- serials (red), and the balance printed on the plate
  const ser = serialText(b, t, e);
  g.save(); g.font = '500 14.5px "Plex Mono"'; g.fillStyle = RED; g.textAlign = 'right'; g.fillText(ser, 1016 - 38, 130); g.textAlign = 'left'; g.fillText(ser, 76 + 38, 396); g.restore();
  if (L.balance > 0) { const str = 'BALANCE DUE: $0.00'; g.save(); g.fillStyle = PAPER; g.fillRect(380, 428, 320, 18); g.font = '500 15px "Plex Mono"'; g.letterSpacing = '1.5px'; g.textAlign = 'center'; g.fillStyle = RED;
    g.fillText(str.slice(0, Math.ceil(str.length * L.balance)), 540, 442 - 1); g.restore(); }
  // ---- the portrait oval: ruled ground, then the engraved face cut in line by line
  if (L.face > 0) { g.save(); ellipsePath(g, OV.cx, OV.cy, OV.rx, OV.ry); g.clip();
    const im = IMG.portrait, sw = im.width * 0.94, sh = sw * (OV.ry * 2) / (OV.rx * 2), sy = clamp(im.height * 0.05, 0, im.height - sh), reveal = ease.outCubic(L.face);
    g.beginPath(); g.rect(OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2 * reveal); g.clip();
    g.fillStyle = 'rgba(224,228,206,1)'; g.fillRect(OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2);
    g.globalAlpha = 0.96; g.drawImage(im, im.width * 0.03, sy, sw, Math.min(sh, im.height - sy), OV.cx - OV.rx, OV.cy - OV.ry, OV.rx * 2, OV.ry * 2); g.restore();
    if (V2) { g.save(); g.strokeStyle = INK; g.lineWidth = 2.2; ellipsePath(g, OV.cx, OV.cy, OV.rx, OV.ry); g.stroke(); g.lineWidth = 0.6; ellipsePath(g, OV.cx, OV.cy, OV.rx + 3, OV.ry + 3); g.stroke(); g.restore(); }
    if (L.face < 1) { const yy = OV.cy - OV.ry + OV.ry * 2 * reveal; g.save(); ellipsePath(g, OV.cx, OV.cy, OV.rx, OV.ry); g.clip(); g.fillStyle = RED; g.fillRect(OV.cx - OV.rx, yy - 0.8, OV.rx * 2, 1.6); g.restore(); } }
  // ---- the Jubilee stamp across the issuer's seal
  if (L.bigStamp > 0 || L.bigStampAge >= 0) { const age = L.bigStampAge, a = clamp(age * 14 + 0.1) * (1 - sm(u(b, 56, 57))); if (age >= 0 && a > 0) {
    g.save(); if (V2) g.translate(262, 262); else g.translate(250, 300); g.rotate(-0.12 + 0.05 * Math.exp(-age * 10)); const sc = 1 + 0.9 * Math.exp(-age * 15); g.scale(sc, sc); g.globalAlpha = a * 0.93;
    // v5 (archive audit item 9): across the issuer's seal (x 58-466 at rest), 34 units clear of the portrait's lathe frame and inside the note's inner border (v4 set it under his face, and its comment swallowed the scale and the fade)
    g.strokeStyle = RED; g.fillStyle = RED; g.lineWidth = 3; g.strokeRect(-195, -34, 390, 68); g.lineWidth = 1; g.strokeRect(-201, -40, 402, 80);
    g.font = '800 40px "Cinzel"'; g.letterSpacing = '3px'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DEBT JUBILEE', 0, 2); g.restore(); } }
}
function drawSeal(g, L, b, t) {
  const c = SEAL, burn = 1 - sm(u(b, T.burn[0] + 0.2, T.burn[1] + 0.4)), cut = u(b, T.cutSeal[0], T.cutSeal[1]);
  g.save();
  if (b < T.burn[1] + 0.4 || L.forceFed) {
    const a = L.forceFed ? 1 : burn; g.globalAlpha = a;
    arcText(g, 'FEDERAL RESERVE', c.cx, c.cy, c.r - 9, -Math.PI / 2, 8.6, false, INK, 1.4, NOTE_FONT, '800');
    arcText(g, 'SYSTEM', c.cx, c.cy, c.r - 9, Math.PI / 2, 8.6, true, INK, 2.2, NOTE_FONT, '800');
    g.fillStyle = PAPER; g.beginPath(); g.arc(c.cx, c.cy, 34, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(c.cx, c.cy, 34, 0, 7); g.stroke();   // the shield
    g.beginPath(); g.moveTo(c.cx - 17, c.cy - 20); g.lineTo(c.cx + 17, c.cy - 20); g.lineTo(c.cx + 17, c.cy + 4); g.quadraticCurveTo(c.cx + 17, c.cy + 20, c.cx, c.cy + 26); g.quadraticCurveTo(c.cx - 17, c.cy + 20, c.cx - 17, c.cy + 4); g.closePath(); g.stroke();
    for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(c.cx - 14.5 + i * 4.8, c.cy - 20); g.lineTo(c.cx - 14.5 + i * 4.8, c.cy + 14); g.stroke(); }
    g.fillStyle = INK; g.font = '800 14px "Cinzel"'; g.textAlign = 'center'; g.fillText('A', c.cx, c.cy + 33);
  }
  if (!L.forceFed && b >= T.burn[0] + 0.2 && b < T.burn[1] + 0.6) { g.globalAlpha = 0.9; g.fillStyle = RED; const w = 2 * c.r * ease.outExpo(u(b, T.strike[0] + 0.1, T.strike[1] + 0.3)); g.save(); g.translate(c.cx, c.cy); g.rotate(-0.5); g.fillRect(-w / 2, -2.5, w, 5); g.restore(); }
  if (!L.forceFed && cut > 0) { g.globalAlpha = 1; const hot = 1 - sm(u(cut, 0.4, 1));
    const col = `rgb(${Math.round(22 + 160 * hot)},${Math.round(36 - 20 * hot)},${Math.round(27 - 10 * hot)})`;
    g.save(); g.beginPath(); g.rect(c.cx - c.r, c.cy - c.r, c.r * 2 * ease.outCubic(cut), c.r * 2); g.clip();
    arcText(g, "THE PEOPLE'S NATIONAL BANK", c.cx, c.cy, c.r - 9, -Math.PI / 2, 7.4, false, col, 1.1, NOTE_FONT, '800');
    arcText(g, 'UNITED STATES', c.cx, c.cy, c.r - 9, Math.PI / 2, 7.4, true, col, 2, NOTE_FONT, '800');
    g.fillStyle = col; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.0 + i * 0; }
    g.restore(); }
  if (L.markP > 0) { const q = L.markP; g.save(); g.beginPath(); g.arc(c.cx, c.cy, 52, 0, 7); g.clip(); g.fillStyle = PAPER; g.fillRect(c.cx - 60, c.cy - 60, 120, 120);
    drawMark(g, c.cx, c.cy, 78, { color: RED, alpha: 1, badge: ease.outCubic(q), stripes: [clamp(L.stripes * 1.6), clamp(L.stripes * 1.6 - 0.3), clamp(L.stripes * 1.6 - 0.6), clamp(L.stripes * 1.6 - 0.9)] }); g.restore(); }
  g.restore();
}
function drawBack(g, L, b, t) {
  g.drawImage(BACK, 0, 0, NW, NH);
  ntext(g, "THE PEOPLE'S NATIONAL BANK", 540, 72, { size: 33, sp: 2, weight: '800', read: u(b, 57.8, 59.2) });
  ntext(g, 'BACKED BY', 540, 92, { size: 11.5, sp: 7, read: u(b, 58, 59.6), ink: INK });
  PANELS.forEach((p, i) => { const r = u(b, 60 + i * 2 - 0.2, 60 + i * 2 + 1.2);
    ntext(g, p.word, p.x + PW / 2, 420, { size: 21, sp: 5, weight: '800', read: r, ink: i === 0 ? INK : INK });
    if (b > 60 + i * 2 - 0.3 && b < 60 + i * 2 + 1.6) { g.save(); g.strokeStyle = RED; g.lineWidth = 1.4; g.globalAlpha = 1 - u(b, 60 + i * 2 + 0.9, 60 + i * 2 + 1.6);
      const sc = 1 + 0.03 * Math.exp(-(b - 60 - i * 2) * 5); g.strokeRect(p.x - 9, PY0 - 9, PW + 18, PH + 18); g.restore(); } });
}

// ------------------------------------------------------------------ the state at a beat
function stateAt(b) {
  const L = { era: 0, read: { banner: 1, clause: 1, date: 0, promise: 0 }, promiseGone: 0, promiseWipe: 1, cutClause: 1, clauseCut: false, jubilee: [], clauseUnder: 0,
    balance: 0, face: 0, bigStamp: 0, bigStampAge: -1, markP: 0, stripes: 0, forceFed: false, clauseFade: 1 };
  // reading: items are grey until the loupe reads them
  L.read.banner = b < 28 ? u(b, ...T.read.banner) : 1;
  L.read.clause = b < 12 ? (b < 3.2 ? u(b, ...T.clause0) : 1) : (b < 22.4 ? 1 : 1);
  if (b >= T.read.banner[1] && b < T.rewind[0]) L.read.banner = 1;
  L.read.date = u(b, ...T.read.date); L.read.promise = u(b, ...T.read.promise);
  // era: the note rewinds to 1914 and comes forward again
  if (b >= T.rewind[0] && b < T.unwind[0]) L.era = sm5(u(b, ...T.rewind));
  else if (b >= T.unwind[0] && b < T.unwind[1] + 0.2) L.era = 1 - sm5(u(b, T.unwind[0], T.unwind[1]));
  if (b >= T.unwind[0]) { L.promiseGone = sm(u(b, T.unwind[0] - 0.2, T.unwind[1] + 0.6)); }
  if (b >= T.unwind[0] - 0.2) L.promiseWipe = 0;
  if (b >= T.rewind[0] && b < T.unwind[1] + 1) { L.promiseWipe = 0; }
  if (b >= T.unwind[1] + 0.2 && b < T.cutClause[1]) { L.clauseCut = true; L.cutClause = u(b, ...T.cutClause); }
  if (b >= T.unwind[1] + 0.2 && b < T.cutClause[0]) L.clauseFade = 0;
  if (b >= T.cutClause[1] || b < T.rewind[0]) L.clauseCut = false;
  // the clause's red underline on its second reading and again after the claim stayed
  if (b >= 13.2 && b < 15.6) L.clauseUnder = ease.outCubic(u(b, 13.2, 15.2));
  if (b >= 24.8) L.clauseUnder = 1;
  if (b >= T.stamps[0] - 0.3) L.clauseUnder = 0;
  // Jubilee: stamps land on the printed words
  const ranges = [span('ALL', 'DEBTS'), span('PUBLIC'), span('PRIVATE')];
  ranges[0] = span('ALL', 'DEBTS');
  T.stamps.forEach((tb, i) => { if (b >= tb) L.jubilee.push({ p: 1, range: ranges[i], age: (b - tb) * B.spb, rot: (i % 2 ? 1 : -1) * 0.06 }); });
  if (b >= T.jub) { L.bigStamp = 1; L.bigStampAge = (b - T.jub) * B.spb; }
  L.balance = u(b, T.clear[0] + 1.2, T.clear[1] + 0.3);
  L.face = u(b, ...T.face);
  L.markP = u(b, ...T.markIn); L.stripes = u(b, ...T.stripes);
  if (L.face > 0) L.face = clamp(L.face);
  return L;
}

// ------------------------------------------------------------------ captions: our voice (Anton on a black strip), never the note's lettering
const CAP_Y0 = V2 ? 1430 : 1010, CAP_H = 236;
function breakLines(str, maxW, size) {
  ctx.font = `${size}px "Anton"`; const words = str.split(' '); if (ctx.measureText(str).width <= maxW) return [str];
  let best = null; for (let i = 1; i < words.length; i++) { const a = words.slice(0, i).join(' '), c = words.slice(i).join(' '); const w = Math.max(ctx.measureText(a).width, ctx.measureText(c).width); if (!best || w < best.w) best = { w, l: [a, c] }; }
  return best.l;
}
function caption(b, t) {
  let c = null; for (const k of CAPS) if (b >= k[0]) c = k; if (!c || !c[1]) return;
  const age = (b - c[0]) * B.spb; if (age < 0) return;
  const a = ease.outExpo(clamp(age / 0.12)), sc = 1 + 0.12 * Math.exp(-age * 14);
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#0a0c0a'; ctx.fillRect(0, CAP_Y0, W, CAP_H);
  ctx.fillStyle = CREAM; ctx.fillRect(0, CAP_Y0, W, 2); ctx.fillRect(0, CAP_Y0 + CAP_H - 2, W, 2);
  let size = 168; let lines = breakLines(c[1], W - 130, size);
  while (lines.length > 1 && size > 90) { ctx.font = `${size}px "Anton"`; if (lines.every(l => ctx.measureText(l).width <= W - 130) && size * lines.length * 1.04 <= CAP_H - 30) break; size -= 6; lines = breakLines(c[1], W - 130, size); }
  while (size > 70) { ctx.font = `${size}px "Anton"`; if (lines.every(l => ctx.measureText(l).width <= W - 130) && size * lines.length * 1.04 <= CAP_H - 26) break; size -= 4; }
  const lh = size * 1.02, y0 = CAP_Y0 + CAP_H / 2 - (lines.length - 1) * lh / 2 + size * 0.36;
  ctx.translate(W / 2, CAP_Y0 + CAP_H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -(CAP_Y0 + CAP_H / 2));
  lines.forEach((l, i) => { ctx.font = `${size}px "Anton"`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const full = ctx.measureText(l).width; let x = W / 2 - full / 2;
    for (const w of l.split(' ')) { const red = c[2].includes(w); ctx.fillStyle = red ? OURRED : CREAM; ctx.fillText(w, x, y0 + i * lh); x += ctx.measureText(w + ' ').width; } });
  ctx.restore();
}

// ------------------------------------------------------------------ the frame
function shadowPlate(w, h) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 20; ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h); ctx.restore(); }
function drawStack(b) {                                              // two more notes under the one being read: a desk, not a void
  if (b >= 70 || b < 0) return;
  for (const [dx, dy, r, back] of [[-70, 120, 0.13, true], [90, -135, -0.09, false]]) {
    ctx.save(); ctx.translate(NW / 2 + dx, NH / 2 + dy); ctx.rotate(r); ctx.translate(-NW / 2, -NH / 2); shadowPlate(NW, NH); ctx.drawImage(back ? BACK : FRONT, 0, 0, NW, NH);
    ctx.fillStyle = 'rgba(8,12,9,0.55)'; ctx.fillRect(0, 0, NW, NH); ctx.restore(); }
}
function noteTransform(b, t) {
  const c = cam(b), kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const drift = Math.sin(t * 0.7) * 0.004, hx = Math.sin(t * 1.9) * 1.6, hy = Math.cos(t * 1.4) * 1.6;
  let ay = 600;
  if (V2) { const area = CAP_Y0, h = NH * c.z; let ah;
    if (h >= area) ah = clamp(area / 2, area - (NH - c.y) * c.z, c.y * c.z); else ah = area / 2 + (c.y - NH / 2) * c.z;
    const s2 = Math.sin(c.rot) ** 2; ay = lerp(ah, H / 2, s2); }
  ctx.translate(W / 2 + hx + Math.sin(t * 83) * 5 * imp, ay + hy + Math.cos(t * 71) * 5 * imp);
  const z = c.z * (1 + 0.012 * kick + 0.035 * imp); ctx.rotate(c.rot + drift); ctx.scale(z, z); ctx.translate(-c.x, -c.y);
  return c;
}
function drawNoteSide(L, b, t, back) { ctx.save(); shadowPlate(NW, NH); if (back) drawBack(ctx, L, b, t); else drawFront(ctx, L, b, t); ctx.restore(); }

window.renderFrame = async (t) => {
  const b = B.beat(t), fr = Math.round(t * 30);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(desk, 0, 0);
  const L = stateAt(b);
  const flipping = (b >= T.flip1[0] && b < T.flip1[1]) || (b >= T.flip2[0] && b < T.flip2[1]);
  let showBack = b >= T.flip1[1] && b < T.flip2[0];
  ctx.save();
  // ---- opening variants
  let blur = 0, dropY = 0, dropRot = 0, dropS = 1, two = false;
  if (OPEN === 'a' && b < 3.4) blur = (V2 ? 8 : 16) * (1 - sm5(u(b, V2 ? 0.05 : 0.15, V2 ? 1.4 : 2.6)));
  if (OPEN === 'b' && b < 3.6) { const p = u(b, 0, 2.4); dropY = -1500 * (1 - ease.outCubic(p)) + (b > 2.4 ? -26 * Math.exp(-(b - 2.4) * 7) * Math.sin((b - 2.4) * 16) : 0); dropRot = 0.22 * (1 - ease.outCubic(p)); dropS = 1 + 0.18 * (1 - ease.outCubic(p)); }
  if (OPEN === 'c' && b < 7.6) two = true;
  if (two) {
    // two notes, 1914 above and today below: the promise line is missing from the second
    const p = sm5(u(b, 5.6, 7.6)), q = ease.outCubic(u(b, 0, 1.2));
    const place = (cy, zz, drawIt) => { ctx.save(); ctx.translate(W / 2, cy); ctx.scale(zz, zz); ctx.translate(-NW / 2, -NH / 2); drawIt(); ctx.restore(); };
    const La = stateAt(17.5); La.era = 1; La.read = { banner: 1, clause: 1, date: 1, promise: u(b, 1.2, 3.4) };
    La.promiseWipe = 0; La.promiseGone = 0; La.forceFed = true;
    const Lb = stateAt(1); Lb.read = { banner: 1, clause: u(b, 3.2, 5.2), date: 0, promise: 0 }; Lb.forceFed = true;
    place(lerp(380, -260, p) - (1 - q) * 300, 0.93, () => { shadowPlate(NW, NH); drawFront(ctx, La, 17.5, t); });
    ctx.save(); ctx.translate(lerp(0, -21, p), 0); place(lerp(800, 617, p) + (1 - q) * 500, lerp(0.93, 1.05, p), () => { shadowPlate(NW, NH); drawFront(ctx, Lb, 1, t); }); ctx.restore();
    ctx.restore();
    caption2(b);
  } else {
    if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    if (dropY || dropRot) { ctx.translate(540, 600 + dropY); ctx.rotate(dropRot); ctx.scale(dropS, dropS); ctx.translate(-540, -600); }
    const c = noteTransform(b, t);
    if (!two) drawStack(b);
    if (flipping) {
      const [f0, f1] = b < 60 ? T.flip1 : T.flip2, p = sm5(u(b, f0, f1)), a = p * Math.PI, sx = Math.cos(a), front = (b < 60 ? a < Q : a >= Q);
      ctx.translate(NW / 2, NH / 2); ctx.scale(Math.max(0.02, Math.abs(sx)), 1 + 0.03 * Math.sin(a)); ctx.translate(-NW / 2, -NH / 2);
      const Lf = stateAt(b < 60 ? 56.9 : 69.2);
      drawNoteSide(Lf, b, t, b < 60 ? !(a < Q) : (a < Q));
      ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - Math.abs(sx))})`; ctx.fillRect(0, 0, NW, NH);
    } else drawNoteSide(L, b, t, showBack);
    ctx.restore();
    // a raking lamp: a soft band of light slides across the paper
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; const lx = ((t * 120) % (W + 900)) - 450, lg = ctx.createLinearGradient(lx - 300, 0, lx + 300, H);
    lg.addColorStop(0, 'rgba(255,245,215,0)'); lg.addColorStop(0.5, 'rgba(255,245,215,0.30)'); lg.addColorStop(1, 'rgba(255,245,215,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, CAP_Y0); ctx.restore();
  }
  ctx.filter = 'none';
  // the ending: the note dims, the lockup rises out of the seal
  if (b >= 78) { const a = sm5(u(b, 78.4, 80)); ctx.fillStyle = `rgba(7,10,8,${0.92 * a})`; ctx.fillRect(0, 0, W, H);
    if (b >= T.lock) { const age = (b - T.lock) * B.spb, k = Math.exp(-age * 9), aa = ease.outExpo(clamp(age / 0.3));
      drawLockup(ctx, W / 2, 800, (900 / (lockupBox(0, 0, 100).w / 100)) * (1 + 0.05 * k), { color: CREAM, accent: OURRED, alpha: aa });
      line(ctx, 'ACP.US', W / 2, 1010, { family: 'Archivo Black', size: 58, color: CREAM, alpha: clamp((age - 0.35) * 5) }); } }
  else caption(b, t);
  // the strip is ours; finishing grain covers all
  finish.apply(ctx, fr, { grain: 0.05, vignette: 0.5, flash: b >= T.strike[0] && b < T.strike[0] + 0.25 ? 0.5 : 0 });
};
function caption2(b) {                                                  // opening c: the two-note view's own words
  const lines = [[0, 'YOUR DOLLAR USED TO PROMISE SOMETHING.', ['PROMISE']], [3.4, 'READ YOUR DOLLAR.', ['DOLLAR.']]]; let c = lines[0]; for (const k of lines) if (b >= k[0]) c = k;
  const age = (b - c[0]) * B.spb; const a = ease.outExpo(clamp(age / 0.12));
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#0a0c0a'; ctx.fillRect(0, CAP_Y0, W, CAP_H); ctx.fillStyle = CREAM; ctx.fillRect(0, CAP_Y0, W, 2); ctx.fillRect(0, CAP_Y0 + CAP_H - 2, W, 2);
  let size = 160, ls = breakLines(c[1], W - 130, size);
  while (size > 70) { ctx.font = `${size}px "Anton"`; if (ls.every(l => ctx.measureText(l).width <= W - 130) && size * ls.length * 1.04 <= CAP_H - 26) break; size -= 4; ls = breakLines(c[1], W - 130, size); }
  const lh = size * 1.02, y0 = CAP_Y0 + CAP_H / 2 - (ls.length - 1) * lh / 2 + size * 0.36;
  ls.forEach((l, i) => { ctx.font = `${size}px "Anton"`; ctx.textAlign = 'left'; let x = W / 2 - ctx.measureText(l).width / 2;
    for (const w of l.split(' ')) { ctx.fillStyle = c[2].includes(w) ? OURRED : CREAM; ctx.fillText(w, x, y0 + i * lh); x += ctx.measureText(w + ' ').width; } });
  ctx.restore();
}
window.sceneReady = true;
