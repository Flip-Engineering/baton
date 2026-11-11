// LAB CIV ASSETS (STUDIO CIV ASSETS c1): proof sheets for the tools that feed CIVILIZATION's picture: plates.js (spot
// plates), signs.js (the Isotype family at three sizes), printkit.js (hard-edged depth and change), sil.js (vector
// silhouettes), mapkit.js (one label system), and the public-domain paintings (tools/pd_paintings.py).
//   ?sheet=signs1|signs2|count|kit|sil|art|plates   window.renderSheet(t) draws it
import { W, H, loadFonts } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { Plates } from '../lib/fx/plates.js';
import { sign, row, signOut, SIGNS, signPath, lodFor } from '../lib/fx/signs.js';
import { bandCloud, smoke, sunburst, lineTint, lineOut, dotOut, wipe, blinds, steps } from '../lib/fx/printkit.js';
import { loadSil } from '../lib/fx/sil.js';
import { placeLabels, drawLabels } from '../lib/fx/mapkit.js';

const ctx = document.getElementById('out').getContext('2d', { willReadFrequently: true });
await loadFonts();
try { const f = new FontFace('Oswald', 'url(../node_modules/@fontsource/oswald/files/oswald-latin-700-normal.woff2)'); document.fonts.add(await f.load()); } catch (e) {}
const RED = '#D11F24', BLK = '#111111', GOLD = '#C9A04A', PAPER = '#EFE2C4';
const STOCK = { base: PAPER, fib: 1.1, laid: 0, fleck: 0.6, mottle: 0.7, tooth: 0.5 };
const pr = new Print(); pr.preload([STOCK]);
const P = new Plates(pr, { paper: STOCK, inks: [
  { name: 'red', hex: RED, levels: [0.6, 1], tint: 'flat' },
  { name: 'black', hex: BLK, levels: [0.4, 0.72, 1], tint: ['flat', 'line'], pitch: 11, angle: 45 },
  { name: 'gold', hex: GOLD, levels: [0.55, 1], tint: 'flat' }] });
const SIL = await loadSil();
const sheet = new URLSearchParams(location.search).get('sheet') || 'signs1';
const ART = {};
for (const [k, f] of [['c', 'met437394_aristotle_with_a_bust_of_homer.jpg'], ['l', 'met437881_young_woman_with_a_water_pitcher.jpg'], ['r', 'met435809_the_harvesters.jpg'], ['s', 'met436105_the_death_of_socrates.jpg']]) {
  const im = new Image(); im.src = '../assets/art_pd/' + f; await im.decode(); ART[k] = im; }
const R = P.plate('red'), K = P.plate('black'), G = P.plate('gold');
const cr = (a = 1) => P.cov(a, 'red'), ck = (a = 1) => P.cov(a, 'black'), cg = (a = 1) => P.cov(a, 'gold');
function label(s, x, y, size = 26, al = 'left') { K.save(); K.fillStyle = ck(1); K.font = `700 ${size}px "Oswald"`; K.textAlign = al; K.fillText(s, x, y); K.restore(); }
const cover = (img, x, y, w, h) => { const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s; return [img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h]; };

const SHEETS = {
  signs1: () => signSheet(SIGNS.slice(0, 8)),
  signs2: () => signSheet(SIGNS.slice(8)),
  count(t) {
    label('750 BASES ABROAD', 60, 120, 64); label('ONE SIGN = 10 INSTALLATIONS', 60, 165, 28);
    K.fillStyle = ck(1); row(K, 'base', 75, { x: 60, y: 260, h: 44, perRow: 15, gap: 0.12, lead: 0.3 });
    label('FACTORIES SHIP OUT', 60, 660, 52);
    for (let i = 0; i < 6; i++) { K.fillStyle = ck(1); signOut(K, 'factory', 130 + i * 165, 800, 92, steps(i / 5, 5), { pitch: 8 }); }
    label('SOLDIERS SHIP ABROAD', 60, 930, 52);
    K.fillStyle = ck(1); row(K, 'soldier', 20, { x: 60, y: 1060, h: 80, perRow: 20, gap: 0.05 });
    R.fillStyle = cr(1); sign(R, 'ship', 540, 1330, 190);
    label('PARASITIC RENTS', 60, 1460, 52);
    for (let i = 0; i < 7; i++) { K.fillStyle = ck(1); sign(K, 'rent', 110 + i * 140, 1640, 90); G.fillStyle = cg(1); for (let c = 0; c < i + 1; c++) sign(G, 'coin', 110 + i * 140, 1560 - c * 13 - 10, 16, { lod: 0 }); }
    label('ONE SIGN, THREE SIZES: NEVER A SHRUNKEN HERO', 60, 1800, 26);
  },
  kit(t) {
    // sky in cut bands (the plates snap a gradient to flat steps), WPA clouds, a sun, smoke from a stack
    for (let k = 0; k < 5; k++) { G.fillStyle = cg(0.25 + k * 0.2); G.fillRect(0, 140 + k * 120, W, 120); }
    const sun = sunburst(760, 520, 110, { rays: 20, turn: t * 0.05 }); P.knock(sun.disc); R.fillStyle = cr(1); R.fill(sun.disc); G.fillStyle = cg(1); G.save(); G.globalCompositeOperation = 'destination-out'; G.fill(sun.rays); G.restore();
    for (const [x, y, w, sd] of [[260, 420, 420, 3], [620, 700, 520, 7], [200, 820, 300, 11]]) { const c = bandCloud(x, y, w, w * 0.34, { seed: sd, lobes: 5 });
      c.draw(K, { key: ck(1), keyW: 2.5, light: p => P.knock(p), dark: ck(1), lines: { pitch: 11, angle: 0, weight: 0.42 } }); }
    K.fillStyle = ck(1); sign(K, 'factory', 300, 1180, 150);
    const sm = smoke(300 + 37, 1180 - 128, t, { rise: 320, drift: 190, r0: 10, r1: 52 }); sm.draw(K, { key: ck(1), keyW: 2.5, light: p => P.knock(p), dark: ck(1) });
    R.fillStyle = cr(1); R.fillRect(0, 1180, W, 30);
    label('A FADE, THE PRINT WAY: LINES THIN, DOTS SHRINK', 60, 1300, 28);
    for (let i = 0; i < 5; i++) { const q = new Path2D(); q.rect(60 + i * 200, 1330, 170, 150); lineOut(K, q, i / 4, { pitch: 10, style: ck(1) });
      const d = new Path2D(); d.rect(60 + i * 200, 1500, 170, 150); dotOut(R, d, i / 4, { pitch: 16, style: cr(1) }); }
    label('REVEALS: SAW WIPE · BLINDS', 60, 1720, 28);
    G.save(); G.clip(wipe(0.55, { angle: 20, edge: 'saw', box: [60, 1740, 520, 1880] })); G.fillStyle = cg(1); G.fillRect(60, 1740, 460, 140); G.restore();
    K.save(); K.clip(blinds(0.5, { n: 10, angle: 90, box: [560, 1740, 1020, 1880] })); K.fillStyle = ck(1); K.fillRect(560, 1740, 460, 140); K.restore();
  },
  sil() {
    // the same cell at 1.75x: the old raster blit vs the traced vector path, with a 3x crop of each
    const c = SIL.cell(2, 'standA') || SIL.meta.cells[0];
    K.fillStyle = ck(1); SIL.blit(K, c, 270, 1000, 410, { raster: true, color: ck(1) }); SIL.blit(K, c, 810, 1000, 410, { color: ck(1) });
    label('RASTER BLIT 1.75x (v10)', 270, 1080, 30, 'center'); label('VECTOR PATH (sil.js c1)', 810, 1080, 30, 'center');
    return { crop: [[200, 560, 140, 200], [740, 560, 140, 200]] };
  },
  art() {
    // the museum: an oxblood wall (red flat + black line tint), three gilt frames, real public-domain paintings in the photo layer
    R.fillStyle = cr(1); R.fillRect(0, 0, W, 1400); K.fillStyle = ck(0.45); K.fillRect(0, 0, W, 1400);
    G.fillStyle = cg(0.55); G.fillRect(0, 1400, W, 520);
    const frames = [['l', 30, 520, 300, 380], ['c', 300, 360, 480, 600], ['r', 760, 600, 300, 230]];
    for (const [k, x, y, w, h] of frames) { const th = Math.max(22, w * 0.07), q = new Path2D(); q.rect(x, y, w, h);
      P.knock(q); G.fillStyle = cg(1); G.fill(q); const inner = new Path2D(); inner.rect(x + th, y + th, w - 2 * th, h - 2 * th); P.knock(inner);
      K.strokeStyle = ck(1); K.lineWidth = 3; K.strokeRect(x, y, w, h); K.strokeRect(x + th, y + th, w - 2 * th, h - 2 * th); K.lineWidth = 2; K.strokeRect(x + th * 0.45, y + th * 0.45, w - th * 0.9, h - th * 0.9);
      P.photo(...cover(ART[k], x + th, y + th, w - 2 * th, h - 2 * th)); }
    label('REMBRANDT · VERMEER · BRUEGEL (THE MET, CC0)', 540, 1470, 30, 'center');
    return { inks: { black: { tint: 'line', pitch: 10 } } };
  },
};
function signSheet(names) {
  label('SIGNS · ONE DESIGN, THREE SIZES (lod 0 / 1 / 2)', 50, 80, 30);
  const rowH = (1920 - 140) / names.length;
  names.forEach((n, i) => { const y = 140 + (i + 1) * rowH - 24, w = signPath(n, 2).w;
    const hh = [40, 110, Math.min(rowH - 40, 520 * 100 / w)];
    K.fillStyle = ck(1); sign(K, n, 90, y, hh[0], { lod: 0 }); sign(K, n, 270, y, hh[1], { lod: 1 });
    (n === 'coin' ? G : n === 'ship' || n === 'bow' ? R : K).fillStyle = n === 'coin' ? cg(1) : n === 'ship' || n === 'bow' ? cr(1) : ck(1);
    sign(n === 'coin' ? G : n === 'ship' || n === 'bow' ? R : K, n, 720, y, hh[2], { lod: 2 });
    label(n.toUpperCase(), 1050, y - 6, 24, 'right'); });
}
window.renderSheet = (t = 0) => { P.begin(); const r = SHEETS[sheet](t) || {}; P.print(ctx, { t, misreg: 1.2, inks: r.inks });
  if (r.crop) for (const [i, [x, y, w, h]] of r.crop.entries()) ctx.drawImage(ctx.canvas, x, y, w, h, 60 + i * 540, 1180, w * 3, h * 3);
  return JSON.stringify(P.stats); };
window.sceneReady = true;
