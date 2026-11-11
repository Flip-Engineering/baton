// NOT A FOOTNOTE v6 (16 Oct 2026): the body is lifted and moves: the film is printed two stops lighter (v5's was near-black murk), every cut lands with a
// push on the beat, the page's torn head and foot are carried off between 22.5 and 30 s so the masses fill the whole screen (the page comes back at 42.5 with the
// masses as its body), the present (7 NOVEMBER 2026) is set large in the close's head, and the score (songs2/footnote_e4.py) keeps its weight to the end.
// NOT A FOOTNOTE v5 (15 Oct 2026, c20): the stamp close is gone (no dater, no ring); two closes, one per take: footnote_a.js sets
// FOOTNOTE_TAKE 'a' (the page re-set the other way round: the masses fill the body of the page, the survey's liberal paragraph has dropped into the
// footnote, the running head carries 7 NOVEMBER 2026) and footnote_b.js sets 'b' (the torn halves come back and cannot close: a seam of the masses
// stays open across the page). 13-29 s re-cut so the masses carry the screen while the words name the opponents (no Menshevik close-ups, no banquet,
// no palace ironwork); the film is printed as ink on the page (blacks lifted to the ink's own brown, the sheet's head and foot torn and kept in frame);
// the strip stacks alternate top and bottom so they leave the picture's subject. Score: songs2/footnote_e3.py (no stops, no reused hit, a pulse per
// section, the second summit at the transition, the ending on the A).
// NOT A FOOTNOTE v3 (8 Oct 2026: a new score, songs2/footnote_e2.py; the b60 and b74 strips set as the sources have them), on v2 (5 Oct 2026). The client on v1: "has an interesting opening, but the rest of the video, while a good script is visually and musically
// uninteresting - very dull ... no one will get the message because it is too dull". The opening is kept (the textbook page, the ringed 1, the dive into the
// footnote, its date in wood type). Then the footnote tears the page open, and behind it is the film of October itself: Eisenstein and Aleksandrov's October
// (1928) and Turin's Turksib (1929), both public domain in the US, inked onto the same paper. The Party's statements, every word of them, arrive a phrase at a
// time on strips torn from the page, one strip to a cut, stacking into the whole sentence: the falsifiers on the monument, the opportunists' faces, the
// chandeliers of bourgeois civilization; NOT A FOOTNOTE. struck in red as the monument comes down; the rupture is a gun; the real masses come through the
// palace gate; the transition of modern history is the clocks of the world capitals; the new paradigm of modernization is the railway across the steppe.
// Plates: footnote.bake.py -> assets/footnote/plates.  Score: songs2/footnote_e2.py (v3, 8 Oct; v2 was songs2/footnote_e.py).
// NOT A FOOTNOTE (4 Oct 2026, new piece for 7 November, the 109th anniversary of the October Revolution).
// A history textbook page; 1917 is a superscript ¹ and a line in small type at the foot of the page. The camera goes into the
// footnote, and the footnote takes the page: the Party's own statements, verbatim and at length (ACP, 7 Nov 2025 and 7 Nov 2024),
// set line by line on the sheet; NOT A FOOTNOTE. pulled in red; the mark.
// Sources: research/sources/texts/acp-d-commemorating-108th-anniversary-october-revolution.txt, ...-107th-....txt.
// Type and press from the shared libraries (type_world setBlock, print.js letterpress).
import { W, H, clamp, lerp, ease, loadFonts, closer } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { Print } from '../lib/fx/print.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = cpuOut();
await loadFonts();
const F = Object.fromEntries(await Promise.all(['anton', 'ultra', 'playfair', 'fell', 'oswald', 'shoulders'].map(async k => [k, await loadFace(k)])));
const finish = finishPlate({ seed: 1917 });
const INK = '#15110f', RED = '#b3141f', GREY = '#5b5650';
const TAKE = (window.FOOTNOTE_TAKE || 'a');

// the timeline, seconds (the song is 60 BPM, so these are its beats too)
// v2, kept in v3: the body is on the score's grid (120 BPM, a beat is 0.5 s; songs2/footnote_e2.py, v2's was songs2/footnote_e.py): a strip every two beats, three for the long phrases
export const TL = { page: 0, zoom: 2.6, date: 6.0, q1: 7.5, tear: 7.5, strike: 19.0, q2: 22.0, masses: 30.0, q3: 33.5, form: 38.5, close: 42.5, mark: 46.5, end: 50.0 };
const BT = b => b * 0.5;

// ---------------------------------------------------------------- stock and helpers
const paper = paperStock({ w: W, h: H, seed: 7, base: [238, 233, 220], tooth: 8, fibres: 1800, burn: 0.08 });
const strip = s => s.replace(/\*/g, '');
const PR = new Print();
function plateOf(draw, steps) { const src = canvas2d(W, H); src.g.fillStyle = '#fff'; src.g.fillRect(0, 0, W, H); draw(src.g);
  const out = canvas2d(W, H); PR.render(out.g, src.cv, steps, { paper: 'newsprint' }); out.g.getImageData(0, 0, 1, 1); return out.cv; }
const fillBlk = (g, b, col = '#000') => { g.fillStyle = col; for (const q of b.glyphs) { g.save(); g.translate(q.ox, q.oy); g.fill(q.path); g.restore(); } };
const LP = { ink: 'carbon', thr: 0.5, squeeze: 0.5, deboss: 0.15, mottle: 0.6, kiss: 0.7 };
function strike(g, img, age) {   // house strike: in from 116%, a two-frame squash, settle
  if (age < 0) return; const u = clamp(age / 0.11), sc = age < 0.11 ? lerp(1.16, 1, ease.outCubic(u)) : 1, sq = age >= 0.11 && age < 0.18 ? 0.965 : 1;
  g.save(); g.translate(W / 2, H / 2); g.scale(sc, sc * sq); g.drawImage(img, -W / 2, -H / 2, W, H); g.restore(); }
function wrap(font, text, cap, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (measure(font, strip(t), cap) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function setting(text, { font = F.playfair, cap = 60, x = 70, y = 600, maxW = 940, lh = 1.6, col = INK } = {}) {
  const lines = wrap(font, text, cap, maxW), words = []; let red = false;
  lines.forEach((ln, li) => { let cx = x;
    for (const raw of ln.split(' ')) {
      const starts = raw.startsWith('*'), ends = raw.replace(/[.,;:—"”)-]+$/, '').endsWith('*'); if (starts) red = true;
      const w = strip(raw), blk = setBlock(font, [{ text: w, cap }], { role: 'micro', x: cx, y: y + li * cap * lh, align: 'left', maxW: 2000 });
      words.push({ w, blk, red, col }); if (ends) red = false;
      cx += measure(font, w, cap) + cap * 0.3; } });
  return { words, h: lines.length * cap * lh };
}
function inkWord(g, wd, a, kiss) { g.save(); g.globalAlpha = a; g.fillStyle = wd.red ? RED : wd.col;
  for (const G of wd.blk.glyphs) { g.save(); g.translate(G.ox, G.oy - kiss * 6); g.fill(G.path); g.restore(); } g.restore(); }
function drawSetting(g, S, u, span) { const n = S.words.length;
  S.words.forEach((wd, i) => { const a = u - (i / Math.max(1, n - 1)) * span; if (a < 0) return; inkWord(g, wd, clamp(a / 0.05), Math.max(0, 1 - a / 0.07)); }); }
function micro(g, s, y, { x = 70, cap = 30, col = GREY, align = 'left' } = {}) {
  const b = setBlock(F.oswald, [{ text: s, cap, tracking: 0.1 }], { role: 'micro', x, y, align, maxW: 2000 }); fillBlk(g, b, col); }

// ---------------------------------------------------------------- the textbook page (an unattributed survey text; the frame the Party's statement answers)
const BODY = [
  'The war placed an enormous strain on the Russian Empire. In February 1917 the monarchy fell, and a Provisional Government took its place. That autumn power passed to the soviets.¹ The years that followed brought civil war, foreign intervention and famine, and in 1922 the formation of a new state. Historians continue to debate how far these events shaped the century.',
  'Elsewhere in Europe, the end of the war brought new borders, new republics and the expansion of the franchise. The decade that followed was marked by economic recovery, the spread of radio and the motor car, and a growing faith in the institutions of parliamentary democracy and the market economy.',
];
const BCAP = 31, BLH = 58;
let SUP = null;
// v5 finish: the close's running head carries the date where the folio was; the chapter's 1914–1923 is dropped there (v5's farm takes set
// '1914–1923' and '7 NOVEMBER 2026' over each other), and the date is in the ink, not the grey
const HEAD = (g, right) => { const now = right !== '313';
  if (now) { micro(g, right, 158, { x: 70, cap: 56, col: INK }); g.fillStyle = RED; g.fillRect(70, 176, 190, 6); return; }   // v6: the present, set large in the head, in the page's own type
  micro(g, now ? 'CHAPTER 14  ·  WAR AND REVOLUTION' : 'CHAPTER 14  ·  WAR AND REVOLUTION, 1914–1923', 150, { cap: 26 });
  micro(g, right, 150, { x: 1010, cap: 26, align: 'right', col: now ? INK : GREY }); };
const PAGE = (() => { const c = canvas2d(W, H), g = c.g; g.drawImage(paper, 0, 0);
  HEAD(g, '313');
  const hd = setBlock(F.playfair, [{ text: 'The Russian Revolutions', cap: 58 }], { role: 'micro', x: 70, y: 290, align: 'left', maxW: 2000 }); fillBlk(g, hd, INK);
  let y = 400;
  for (const para of BODY) { for (const ln of wrap(F.fell, para.replace('¹', ''), BCAP, 930)) {          // the measure: lines wrap inside 70..1010
      const b = setBlock(F.fell, [{ text: ln, cap: BCAP }], { role: 'micro', x: 70, y, align: 'left', maxW: 2000 }); fillBlk(g, b, '#2a2522');
      const k = ln.indexOf('soviets.'); if (k >= 0 && para.includes('soviets.¹')) SUP = { x: 70 + measure(F.fell, ln.slice(0, k + 8), BCAP) + 3, y: y + BLH - BCAP * 0.9 - 21 };
      y += BLH; }
    y += BLH * 0.6; }
  g.fillStyle = '#2a2522'; g.fillRect(70, 1660, 300, 2);                                                   // the footnote rule
  const fn = setBlock(F.fell, [{ text: '1. 7 November 1917 (25 October, Old Style).', cap: 24 }], { role: 'micro', x: 70, y: 1705, align: 'left', maxW: 2000 }); fillBlk(g, fn, '#2a2522');
  return c.cv; })();
const SUP1 = setBlock(F.fell, [{ text: '1', cap: 20 }], { role: 'micro', x: SUP.x, y: SUP.y, align: 'left', maxW: 200 });
const FN = { x: 70, y: 1690 };   // the footnote, where the camera goes

// ---------------------------------------------------------------- the settings (verbatim; datelines name the statement)
const DATE = setting('7 NOVEMBER 1917.', { font: F.anton, cap: 150, y: 640, x: 70 });
const NOT = (() => { const b = setBlock(F.ultra, [{ text: 'NOT A', cap: 300 }, { text: 'FOOTNOTE.', cap: 300 }], { role: 'shout', x: 540, y: 900, maxW: 980, gap: 0.2 });
  const pull = plateOf(g => fillBlk(g, b), [['letterpress', LP]]), c = canvas2d(W, H); c.g.drawImage(pull, 0, 0);
  const id = c.g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { const a = clamp((235 - d[i + 1] - 28) / 130); d[i] = 179; d[i + 1] = 20; d[i + 2] = 31; d[i + 3] = 255 * a * 0.95; }
  c.g.putImageData(id, 0, 0); return c.cv; })();

function sheet(g) { g.drawImage(paper, 0, 0); }

// ---------------------------------------------------------------- v2: the film, inked onto the page
const IDX = await (await fetch('../assets/footnote/plates/index.json')).json();
const BMP = new Map();
async function frameBmp(shot, i) {
  const k = shot + '/' + i; if (BMP.has(k)) { const v = BMP.get(k); BMP.delete(k); BMP.set(k, v); return v; }
  const bm = await createImageBitmap(await (await fetch(`../assets/footnote/plates/${shot}/${String(i + 1).padStart(4, '0')}.jpg`)).blob());
  BMP.set(k, bm); if (BMP.size > 40) { const o = BMP.keys().next().value; BMP.get(o).close(); BMP.delete(o); }
  return bm;
}
const INKC = canvas2d(W, H);
// the cuts: [t, shot, off s, zoom from, zoom to, centre y (plate fraction)]; 'PAGE' is the textbook's footnote again
// v5 (c20): b25-38 and b51-67 re-cut; the words name the opponents, the picture is the masses (the faces of the Mensheviks, the banquet, the
// palace gate and its eagle are out); b85 on is the close's own shot (TAKE a: the workers across the land; b: the packed street)
const CUTS = [
  [15, 'oc_demo', 0.4, 1.04, 1.1, 0.5], [18, 'oc_banners', 0.3, 1.04, 1.12, 0.5], [20, 'oc_demo2', 0.4, 1.04, 1.1, 0.5], [22.5, 'oc_tsar', 0.0, 1.1, 1.22, 0.45],
  [25, 'oc_raised', 0.0, 1.04, 1.12, 0.5], [27, 'oc_ropes', 0.2, 1.04, 1.12, 0.5], [29, 'oc_steps', 0.2, 1.06, 1.14, 0.55], [31, 'oc_through', 0.0, 1.0, 1.08, 0.5],
  [33.5, 'PAGE', 0, 3.4, 3.7, 0], [35, 'oc_chand', 0.0, 1.04, 1.1, 0.5], [36, 'oc_ladder', 0.3, 1.04, 1.12, 0.5], [38, 'oc_topple', 0.0, 1.04, 1.12, 0.5],
  [44, 'oc_aurora', 0.0, 1.0, 1.08, 0.5], [46, 'oc_gun', 0.0, 1.04, 1.1, 0.5], [48.5, 'oc_storm', 0.0, 1.04, 1.12, 0.5], [51, 'oc_run', 0.0, 1.04, 1.12, 0.5],
  [54, 'oc_through2', 0.0, 1.04, 1.12, 0.5], [57, 'oc_stairs2', 0.0, 1.04, 1.1, 0.5],
  [60, 'oc_bayonets', 0.2, 1.0, 1.06, 0.5], [62, 'ts_line', 0.0, 1.0, 1.05, 0.5], [64, 'oc_crowd', 0.2, 1.06, 1.12, 0.45],
  [67, 'oc_clocks2', 0.0, 1.06, 1.14, 0.5], [69.5, 'oc_clock', 0.0, 1.5, 1.58, 0.3], [72, 'oc_clockny', 0.0, 1.5, 1.58, 0.3], [74, 'oc_clocks', 0.0, 1.06, 1.14, 0.45],
  [75.5, 'oc_clockp', 0.0, 1.5, 1.56, 0.3], [77, 'ts_dig', 0.2, 1.04, 1.1, 0.5], [79, 'ts_masses', 0.4, 1.04, 1.1, 0.55], [80, 'ts_sleepers', 0.0, 1.04, 1.1, 0.5],
  [81, 'ts_loco', 0.2, 1.04, 1.1, 0.5], [82, 'ts_bridge', 0.3, 1.04, 1.1, 0.5], [83, 'ts_rivets', 0.0, 1.04, 1.12, 0.5], [84, 'ts_excav', 0.0, 1.04, 1.1, 0.5], [84.5, 'ts_drive', 0.0, 1.04, 1.1, 0.5],
  [85, TAKE === 'b' ? 'oc_demo2' : 'ts_masses', 0.0, 1.0, 1.06, 0.5, 0.6],
].map(c => [BT(c[0]), ...c.slice(1)]);
function cutAt(t) { let c = null; for (const x of CUTS) if (t >= x[0]) c = x; return c; }
const PAPER_INK = 'rgb(46,38,33)';               // v5: the film's blacks are the ink's brown on the sheet, never crushed to black
async function inkFilm(g, t, density = 1, rect = null) {     // the frame in ink on the paper: white is the sheet, black is ink
  const c = cutAt(t), age = t - c[0], nxt = CUTS[CUTS.indexOf(c) + 1], len = (nxt ? nxt[0] : TL.end) - c[0], u = clamp(age / len);
  if (c[1] === 'PAGE') {                          // the textbook's footnote, close
    const s = lerp(c[3], c[4], u), fx = FN.x + 240, fy = Math.min(FN.y - 10, H - H / (2 * s));
    g.save(); g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-fx, -fy); g.drawImage(PAGE, 0, 0);
    g.strokeStyle = RED; g.lineWidth = 4.5; g.beginPath(); g.ellipse(FN.x + 10, FN.y + 8, 20, 18, -0.2, -1.2, -1.2 + Math.PI * 2.1); g.stroke(); g.restore(); return;
  }
  const n = IDX[c[1]].n, f = Math.min(n - 1, Math.floor((c[2] + age * (c[6] || 1)) * 24)), bm = await frameBmp(c[1], f);
  const R = rect || { x: 0, y: 0, w: W, h: H }, cov = Math.max(R.w / W, R.h / H);
  const z = lerp(c[3], c[4], u) * (1 + 0.035 * Math.exp(-age * 9)), dw = W * z * cov, dh = H * z * cov, dy = R.y + (R.h - dh) * (c[5] / 0.5) * 0.5;
  const jx = ((Math.round(t * 30) * 7) % 3) - 1;                                           // the press's registration, a pixel
  const ig = INKC.g; ig.save(); ig.fillStyle = '#fff'; ig.fillRect(0, 0, W, H); ig.beginPath(); ig.rect(R.x, R.y, R.w, R.h); ig.clip();
  ig.filter = 'grayscale(1) contrast(1.2) brightness(1.5)'; ig.drawImage(bm, R.x + (R.w - dw) / 2 + jx, dy, dw, dh); ig.filter = 'none';
  ig.globalCompositeOperation = 'lighten'; ig.fillStyle = PAPER_INK; ig.fillRect(R.x, R.y, R.w, R.h); ig.restore();   // the ink's own darkest
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = density; g.drawImage(INKC.cv, 0, 0); g.restore();
}
// v5: the page's head and foot stay in frame, torn: the film is printed inside the textbook's page, never a full-bleed screen
const RAG = (y0, seed) => { const pts = []; let y = y0; for (let x = -20; x <= W + 20; x += 24) { y += (Math.sin(x * 0.29 + seed) + Math.sin(x * 0.083 + seed * 3) * 1.3) * 4.5; y = lerp(y, y0, 0.12); pts.push([x, y]); } return pts; };
const RAG_TOP = RAG(178, 1.7), RAG_FOOT = RAG(1792, 4.2);
function pageFrame(g, right = '313', off = 0) {
  if (off >= 240) return;
  for (const [pts, top] of [[RAG_TOP, true], [RAG_FOOT, false]]) {
    g.save(); g.translate(0, top ? -off : off); g.beginPath(); g.moveTo(-40, top ? -40 : H + 40); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(W + 40, top ? -40 : H + 40); g.closePath();
    g.save(); g.shadowColor = 'rgba(10,6,4,0.55)'; g.shadowBlur = 16; g.shadowOffsetY = top ? 5 : -5; g.fillStyle = '#ece6d8'; g.fill(); g.restore();
    g.clip(); g.drawImage(paper, 0, 0);
    g.strokeStyle = 'rgba(255,252,244,0.85)'; g.lineWidth = 3; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y + (top ? -2 : 2)) : g.moveTo(x, y)); g.stroke();
    if (top) HEAD(g, right);
    else { g.fillStyle = '#2a2522'; g.fillRect(70, 1832, 300, 2); micro(g, '1.', 1885, { cap: 30, col: RED }); }
    g.restore();
  }
}

// ---------------------------------------------------------------- the strips: the statements, a phrase to a cut, each torn from the page
// v3 (8 Oct): both datelines confirmed on acp.us (the dispatch pages read "Nov 07, 2025" and "Nov 07, 2024" under their titles); the 2024 line is
// "from the liberal to post-liberal era." on the page and in the source text, so v2's "TO THE POST-LIBERAL ERA." lost its inserted THE
const D25 = 'AMERICAN COMMUNIST PARTY · 7 NOVEMBER 2025', D24 = 'AMERICAN COMMUNIST PARTY · 7 NOVEMBER 2024';
const GROUPS = [
  { t0: 16, t1: 27, date: D25, lines: [[16, 'NOW, MORE THAN EVER,'], [18, 'IT IS NECESSARY TO DEFEND'], [20, 'THE MEMORY OF THE OCTOBER REVOLUTION'], [22.5, 'FROM NOT ONLY THOSE FALSIFIERS OF HISTORY'], [25, 'WHICH VILIFY IT OUTRIGHT,']] },
  { t0: 27, t1: 38, date: D25, lines: [[27, 'BUT ALSO FROM THOSE'], [29, '“DEMOCRATIC SOCIALIST” OPPORTUNISTS'], [31, 'WHO ATTEMPT TO RELEGATE IT TO THE STATUS OF'], [33.5, '*A MERE FOOTNOTE*'], [35, 'IN THE HISTORY OF BOURGEOIS POLITICAL CIVILIZATION.']] },
  { t0: 44, t1: 51, date: D25, low: true, lines: [[44, 'THE OCTOBER REVOLUTION'], [46, 'HAS YET TO BE GIVEN APPROPRIATE CONSIDERATION'], [48.5, 'AS HAVING MARKED A *QUALITATIVE RUPTURE*']] },
  { t0: 51, t1: 60, date: D25, lines: [[51, 'WITH POLITICAL LIBERALISM,'], [53, '“SOCIAL DEMOCRACY”'], [54.5, '(INCLUDING ITS VARIOUS MUTATIONS IN “DEMOCRATIC SOCIALISM”),'], [57, 'AND ALL OTHER POLITICAL TRADITIONS OF BOURGEOIS CIVILIZATION.']] },
  { t0: 60, t1: 67, date: D25, big: true, low: true, lines: [[60, '…A REVOLUTION OF'], [62, '*THE REAL MASSES*'], [64, 'AND *THE REAL PEOPLE…*']] },   // mid-sentence in the source: ellipses, as at b67
  { t0: 67, t1: 77, date: D24, lines: [[67, '…IT WAS NONE OTHER THAN THE OCTOBER REVOLUTION'], [69.5, 'THAT MARKED THE TRANSITION OF MODERN HISTORY'], [72, 'FROM THE LIBERAL'], [74, 'TO *POST-LIBERAL ERA.*']] },
  { t0: 77, t1: 85, date: D24, big: true, low: true, lines: [[77, 'A FUNDAMENTALLY NEW FORM OF STATE POWER'], [80, 'AND PARADIGM OF MODERNIZATION.']] },
].map(G => ({ ...G, t0: BT(G.t0), t1: BT(G.t1), lines: G.lines.map(([b, x]) => [BT(b), x]) }));
const SX = 62, SMAXW = 880;
GROUPS.forEach((G, gi) => {
  let y = 330; const r = (k) => fr(Math.sin((gi * 31 + k) * 91.7) * 4375.5);
  G.strips = G.lines.map(([t, text], li) => {
    const cap = G.big ? 104 : 70;
    const S = setting(text, { font: F.anton, cap, x: SX + 24, y: y + cap * 0.92, maxW: SMAXW - 48, lh: 1.18 });
    let x1 = 1e9, x2 = -1e9, y1 = 1e9, y2 = -1e9; for (const wd of S.words) { x1 = Math.min(x1, wd.blk.bbox.x1); x2 = Math.max(x2, wd.blk.bbox.x2); y1 = Math.min(y1, wd.blk.bbox.y1); y2 = Math.max(y2, wd.blk.bbox.y2); }
    const box = { x1: x1 - 22, x2: x2 + 22, y1: y1 - 18, y2: y2 + 20 };
    const edge = []; for (let k = 0; k <= 24; k++) edge.push([(r(k) - 0.5) * 7, (r(k + 50) - 0.5) * 7]);
    const strip = { t, S, box, edge, rot: (r(li + 7) - 0.5) * 0.035 };
    y = box.y2 + 20; return strip;
  });
  const bottom = G.strips[G.strips.length - 1].box.y2;
  const lift = G.low ? bottom - 1730 : Math.max(0, bottom - 1660);                  // v5: some stacks sit low, off the picture's subject
  if (lift) { for (const st of G.strips) { st.box.y1 -= lift; st.box.y2 -= lift; for (const wd of st.S.words) wd.dy = -lift; } }
  G.dateY = G.low ? G.strips[0].box.y1 - 74 : 200;
});
function fr(x) { return x - Math.floor(x); }
function drawStrip(g, st, age) {
  if (age < 0) return;
  const sc = age < 0.09 ? lerp(1.07, 1, ease.outCubic(age / 0.09)) : 1, b = st.box, cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  g.save(); g.translate(cx, cy); g.rotate(st.rot); g.scale(sc, sc); g.translate(-cx, -cy);
  g.save(); g.shadowColor = 'rgba(10,6,4,0.45)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  g.beginPath(); const n = st.edge.length - 1;
  for (let k = 0; k <= n; k++) { const x = lerp(b.x1, b.x2, k / n); k ? g.lineTo(x, b.y1 + st.edge[k][0]) : g.moveTo(x, b.y1 + st.edge[k][0]); }
  for (let k = n; k >= 0; k--) g.lineTo(lerp(b.x1, b.x2, k / n), b.y2 + st.edge[k][1]);
  g.closePath(); g.fillStyle = '#ece6d8'; g.fill(); g.restore();
  g.save(); g.clip(); g.globalAlpha = 0.9; g.drawImage(paper, b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1, b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); g.restore();
  for (const wd of st.S.words) { g.save(); if (wd.dy) g.translate(0, wd.dy); inkWord(g, wd, clamp(age / 0.04), 0); g.restore(); }
  g.restore();
}
function datelineStrip(g, s, y0 = 200) {
  const b = setBlock(F.oswald, [{ text: s, cap: 26, tracking: 0.1 }], { role: 'micro', x: SX + 18, y: y0 + 38, align: 'left', maxW: 2000 });
  g.fillStyle = '#ece6d8'; g.fillRect(SX, y0, b.bbox.x2 - SX + 18, 54); fillBlk(g, b, GREY); g.fillStyle = RED; g.fillRect(SX, y0 + 52, 120, 5);
}
// the tear: the dated sheet opens along a ragged line and its halves fly apart
const TEAR = (() => { const pts = []; let y = 1010; for (let x = -20; x <= W + 20; x += 36) { y += (Math.sin(x * 0.37) + Math.sin(x * 0.11) * 1.4) * 9; pts.push([x, y]); } return pts; })();
function tearHalf(g, top, u) {
  g.save(); const dy = (top ? -1 : 1) * ease.inCubic(u) * 1300, rot = (top ? -1 : 1) * 0.08 * ease.inCubic(u);
  g.translate(W / 2, H / 2 + dy); g.rotate(rot); g.translate(-W / 2, -H / 2);
  g.beginPath(); g.moveTo(-40, top ? -40 : H + 40); for (const [x, y] of TEAR) g.lineTo(x, y); g.lineTo(W + 40, top ? -40 : H + 40); g.closePath(); g.clip();
  sheet(g); g.fillStyle = '#2a2522'; g.fillRect(70, 1010, 940, 3); drawSetting(g, DATE, 9, 0.5); micro(g, '1.', 470, { cap: 60, col: RED });
  g.restore();
}

// ---------------------------------------------------------------- v5: the close, no stamp. The date is the page's running head, in its own type.
const NOW = '7 NOVEMBER 2026';
// A: the page set the other way round. The film of the masses is the body of the page; the survey's paragraph on parliamentary democracy and the
// market economy has dropped below the rule into the small type where 1917 was.
const BLOCK = { x: 70, y: 340, w: 940, h: 1250 };
const RESET = (() => { const c = canvas2d(W, H), g = c.g; g.drawImage(paper, 0, 0); HEAD(g, NOW);
  const hd = setBlock(F.playfair, [{ text: 'The Russian Revolutions', cap: 58 }], { role: 'micro', x: 70, y: 290, align: 'left', maxW: 2000 }); fillBlk(g, hd, INK);
  g.fillStyle = '#2a2522'; g.fillRect(70, 1648, 300, 2); return c.cv; })();
const FOOT = setting('1. ' + BODY[1], { font: F.fell, cap: 22, x: 70, y: 1700, maxW: 930, lh: 1.62, col: '#2a2522' });
async function closeA(g, t) {
  const age = t - TL.close, o = ease.inOutCubic(clamp(age / 1.7));
  const s = lerp(Math.max(W / BLOCK.w, H / BLOCK.h) * 1.02, 1, o), cx = lerp(BLOCK.x + BLOCK.w / 2, W / 2, o), cy = lerp(BLOCK.y + BLOCK.h / 2, H / 2, o);
  g.fillStyle = '#0d0b09'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-cx, -cy);
  g.drawImage(RESET, 0, 0);
  await inkFilm(g, t, 1, BLOCK);                                                           // printed into the page's body (white outside it)
  drawSetting(g, FOOT, age - 1.1, 0.9);                                                    // the survey's paragraph sets itself in the footnote
  g.restore();
}
// B: the tear stays open. The textbook's two halves come back over the film and cannot close; the masses stay in the seam.
const PAGE_NOW = (() => { const c = canvas2d(W, H), g = c.g; g.drawImage(PAGE, 0, 0); g.drawImage(paper, 900, 120, 140, 50, 900, 120, 140, 50); HEAD(g, NOW); return c.cv; })();
function pageHalf(g, top, gap, rot) {
  g.save(); g.translate(W / 2, H / 2 + (top ? -1 : 1) * gap / 2); g.rotate((top ? -1 : 1) * rot); g.translate(-W / 2, -H / 2);
  g.beginPath(); g.moveTo(-40, top ? -40 : H + 40); for (const [x, y] of TEAR) g.lineTo(x, y); g.lineTo(W + 40, top ? -40 : H + 40); g.closePath();
  g.save(); g.shadowColor = 'rgba(10,6,4,0.6)'; g.shadowBlur = 22; g.shadowOffsetY = top ? 8 : -8; g.fillStyle = '#ece6d8'; g.fill(); g.restore();
  g.clip(); g.drawImage(PAGE_NOW, 0, 0);
  g.strokeStyle = 'rgba(255,252,244,0.9)'; g.lineWidth = 3; g.beginPath(); TEAR.forEach(([x, y], i) => i ? g.lineTo(x, y + (top ? -2 : 2)) : g.moveTo(x, y)); g.stroke();
  g.restore();
}
async function closeB(g, t) {
  const age = t - TL.close;
  sheet(g); await inkFilm(g, t, 1); pageFrame(g, NOW);
  // they come in, nearly meet, are pushed back, try again and hold apart: the seam never closes
  const k = [[0, 1500], [0.9, 150], [1.35, 330], [2.0, 210], [2.5, 270], [4.0, 250]];
  let gap = k[k.length - 1][1];
  for (let i = 0; i < k.length - 1; i++) if (age < k[i + 1][0]) { gap = lerp(k[i][1], k[i + 1][1], ease.inOutCubic((age - k[i][0]) / (k[i + 1][0] - k[i][0]))); break; }
  const tremble = Math.sin(age * 37) * Math.exp(-Math.max(0, age - 2) * 1.5) * 2.5;
  pageHalf(g, true, gap + tremble, 0.012 * (gap / 1500)); pageHalf(g, false, gap - tremble, 0.012 * (gap / 1500));
}

window.renderFrame = async (t) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  if (t < TL.date) {
    // the page; the ¹ ringed in red pencil; the camera goes into the footnote
    // frame 0 is close on the ringed ¹ (phone size), easing back to the page; then the dive into the footnote
    const o = ease.inOutCubic(clamp(t / TL.zoom)), z = ease.inOutCubic(clamp((t - TL.zoom) / (TL.date - TL.zoom - 0.3)));
    const s0 = lerp(2.6, 1.15, o), fx0 = lerp(SUP.x - 120, W / 2, o), fy0 = lerp(SUP.y + 10, H / 2 - 120, o);
    const s = lerp(s0, 3.4, z), fx = lerp(fx0, FN.x + 240, z), fy = Math.min(lerp(fy0, FN.y - 10, z), H - H / (2 * s));   // never past the page's foot (it showed black)
    ctx.fillStyle = '#0d0b09'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-fx, -fy);
    ctx.drawImage(PAGE, 0, 0); fillBlk(ctx, SUP1, t > 0.3 ? RED : INK);
    const ring = clamp((t + 0.15) / 0.5);                                                    // the red pencil ring, drawn
    if (ring > 0) { ctx.strokeStyle = RED; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.ellipse(SUP.x + 6, SUP.y - 9, 30, 25, -0.2, -1.2, -1.2 + ring * Math.PI * 2.1); ctx.stroke(); }
    const ring2 = clamp((t - (TL.zoom + 1.6)) / 0.6);                                       // and the footnote's own number
    if (ring2 > 0) { ctx.beginPath(); ctx.ellipse(FN.x + 10, FN.y + 8, 20, 18, -0.2, -1.2, -1.2 + ring2 * Math.PI * 2.1); ctx.stroke(); }
    ctx.restore();
  } else if (t < TL.tear) {
    // the footnote's date takes the page: 7 NOVEMBER 1917. set in wood type above the rule
    sheet(ctx); ctx.fillStyle = '#2a2522'; ctx.fillRect(70, 1010, 940, 3);
    drawSetting(ctx, DATE, t - TL.date, 0.5);
    micro(ctx, '1.', 470, { cap: 60, col: RED });
  } else if (t < TL.close) {
    sheet(ctx);
    const slam = t >= TL.strike && t < TL.q2;
    await inkFilm(ctx, t, slam ? 0.6 : 1);
    if (cutAt(t)[1] !== 'PAGE') pageFrame(ctx, '313', 240 * ease.inOutCubic(clamp((t - 22.5) / 7.5)));   // v6: the page's head and foot are torn away as the masses come on; the film takes the page
    if (t < TL.tear + 0.55) { const u = (t - TL.tear) / 0.55; tearHalf(ctx, true, u); tearHalf(ctx, false, u); }
    if (slam) strike(ctx, NOT, t - TL.strike - 0.02);
    const G = GROUPS.find(G => t >= G.t0 && t < G.t1);
    if (G) { datelineStrip(ctx, G.date, G.dateY); for (const st of G.strips) drawStrip(ctx, st, t - st.t); }
  }
  else if (t < TL.mark) await (TAKE === 'b' ? closeB : closeA)(ctx, t);
  else { const age = t - TL.mark; await (TAKE === 'b' ? closeB : closeA)(ctx, TL.mark); ctx.fillStyle = `rgba(10,8,6,${clamp(age * 4, 0, 0.94)})`; ctx.fillRect(0, 0, W, H); closer(ctx, age); }
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.3 });
  return {};
};
ready = true;
