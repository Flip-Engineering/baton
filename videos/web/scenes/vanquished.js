// NEVER VANQUISHED v2 (8 Oct 2026; v1 4 Oct). Debs at the founding convention of the Industrial Workers of the World, Chicago, 29 June 1905:
// research/sources/texts/debs-iwwfound.txt (registry id debs-iwwfound). The words, verbatim:
//   l.11 "In this great struggle the working class are often defeated, but never vanquished. Even the defeats, ..."
//   l.15 "They charge us with being assembled here for the purpose of disrupting the union movement. It is already disrupted, and if it were not
//        disrupted we would not behold the spectacle here in the very city of a white policeman guarding a black scab, and a black policeman
//        guarding a white scab, while the trade unions stand by with their hands in their pockets wondering what is the matter with union labor in America."
//   l.19 "There is certainly something wrong with that form of unionism ... to chloroform the working class while the capitalist class go through their pockets."
//   l.27 "I believe it is possible ... broad enough to embrace every honest worker, yet narrow enough to exclude every fakir."
//   l.39 "We must have one organization that embraces the workers in every department of industrial activity. It must express the class struggle. ..."
//   l.41 "... a single union upon the economic field. ... a single party upon the political field; ... the two halves that represent the organic whole of the labor movement."
//   l.43 "We know that without solidarity nothing is possible, that with it nothing is impossible."
// v1 was a short type piece (a muddy woodcut, a nine-second wall of text, a sampled-orchestra score). v2's one idea is REGISTRATION, the
// printer's word for two plates landing on each other. The title is a two-colour pull (black, then red); the workers of 1904 (Westinghouse
// Works, Bitzer, public domain; assets/workday and assets/vanquished plates, lib/fx/reel.js) are printed as a two-plate halftone
// (lib/fx/repro.js duotone) whose red plate drifts off the black while the class is divided (the policemen, the old unions, the chloroform),
// steps back toward it with each IT MUST, and lands on the organic whole. The page itself splits into two halves at the policemen and closes at
// the two halves of the movement. The score (songs2/vanquished_e.py) phases two voices apart and back on the same curve (REG). 60 BPM: beats = seconds.
import { W, H, clamp, lerp, ease, loadFonts, closer } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { daterStamp } from '../lib/fx/type_press.js';
import { Print } from '../lib/fx/print.js';
import { Reel } from '../lib/fx/reel.js';
import { Repro } from '../lib/fx/repro.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = cpuOut();
await loadFonts();
const F = Object.fromEntries(await Promise.all(['anton', 'ultra', 'playfair', 'fell', 'oswald', 'shoulders'].map(async k => [k, await loadFace(k)])));
const finish = finishPlate({ seed: 1905 });
const INK = '#15110f', RED = '#b3141f', GREY = '#5b5650', CREAM = '#efe6d2';

// the timeline, seconds (the song is 60 BPM, so these are its beats too; songs2/vanquished_e.py keeps a copy). The groove's grid is 0.5 s from 4.0.
export const TL = { hook: 0, q1: 4.0, dis: 11.5, already: 14.5, spec: 16.0, pol1: 18.0, pol2: 20.0, pock: 22.0, w1: 26.5, w2: 31.0, w3: 34.5, chloro: 39.0,
  pockets: 40.5, card: 43.0, broad: 48.0, narrow: 49.5, admit: 51.0, cancel: 52.0, must: 53.0, m1: 56.0, m2: 57.5, m3: 59.0, m4: 60.5, m5: 62.0,
  union: 64.0, party: 66.0, whole: 68.0, solid: 71.0, title: 76.0, mark: 79.5, end: 82.5 };
// registration: how far the red plate stands off the black, in the score's units (s of phase between its two voices; 0.125 s = 56 px).
// It opens through the division, is worst under the chloroform, steps back on each IT MUST and lands on the organic whole.
export const REG = [[0, 0], [4.0, 0.004], [11.5, 0.012], [14.5, 0.03], [18.0, 0.05], [20.0, 0.062], [26.5, 0.075], [31.0, 0.09], [34.5, 0.1], [39.0, 0.125],
  [42.9, 0.125], [43.0, 0.09], [53.0, 0.08], [56.0, 0.08], [56.12, 0.064], [57.5, 0.064], [57.62, 0.048], [59.0, 0.048], [59.12, 0.032], [60.5, 0.032],
  [60.62, 0.018], [62.0, 0.018], [62.12, 0.008], [67.9, 0.008], [68.08, 0], [82.5, 0]];
const regAt = t => { for (let i = 1; i < REG.length; i++) if (t < REG[i][0]) { const [a, va] = REG[i - 1], [b, vb] = REG[i]; return lerp(va, vb, (t - a) / (b - a)); } return 0; };
const regPx = t => regAt(t) / 0.125 * 56;

// ---------------------------------------------------------------- stock, plates, helpers (as ONE_IS_IN_PRESS / footnote / workday)
const paper = paperStock({ w: W, h: H, seed: 29, base: [236, 230, 214], tooth: 9, fibres: 2200, burn: 0.1 });
const news = paperStock({ w: W, h: H, seed: 1900, base: [222, 218, 205], tooth: 11, fibres: 2600, burn: 0.16 });
const strip = s => s.replace(/\*/g, '');
const PR = new Print();
function plateOf(draw, steps) { const src = canvas2d(W, H); src.g.fillStyle = '#fff'; src.g.fillRect(0, 0, W, H); draw(src.g);
  const out = canvas2d(W, H); PR.render(out.g, src.cv, steps, { paper: 'newsprint' }); out.g.getImageData(0, 0, 1, 1); return out.cv; }
const fillBlk = (g, b, col = '#000', dx = 0, dy = 0) => { g.fillStyle = col; for (const q of b.glyphs) { g.save(); g.translate(q.ox + dx, q.oy + dy); g.fill(q.path); g.restore(); } };
const LP = { ink: 'carbon', thr: 0.5, squeeze: 0.5, deboss: 0.15, mottle: 0.6, kiss: 0.7 };
function tintOf(pull, rgb, k = 130) { const c = canvas2d(W, H); c.g.drawImage(pull, 0, 0); const id = c.g.getImageData(0, 0, W, H), d = id.data;   // the press's paper made transparent
  for (let i = 0; i < d.length; i += 4) { const a = clamp((235 - d[i + 1] - 24) / k); d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255 * a * 0.97; }
  c.g.putImageData(id, 0, 0); return c.cv; }
const pullOf = (blk, rgb, dx = 0, dy = 0) => tintOf(plateOf(g => fillBlk(g, blk, '#000', dx, dy), [['letterpress', LP]]), rgb);
const BLACK = [21, 17, 15], REDC = [179, 20, 31];
function strike(g, img, age, { x = 0, y = 0, from = 1.16 } = {}) {   // house strike: in from 116%, a two-frame squash, settle
  if (age < 0) return; const u = clamp(age / 0.11), sc = age < 0.11 ? lerp(from, 1, ease.outCubic(u)) : 1, sq = age >= 0.11 && age < 0.18 ? 0.965 : 1;
  g.save(); g.translate(W / 2 + x, H / 2 + y); g.scale(sc, sc * sq); g.drawImage(img, -W / 2, -H / 2, W, H); g.restore(); }
function wrap(font, text, cap, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (measure(font, strip(t), cap) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function setting(text, { font = F.playfair, cap = 60, x = 70, y = 600, maxW = 940, lh = 1.6, col = INK, hot = RED } = {}) {
  const lines = wrap(font, text, cap, maxW), words = []; let red = false;
  lines.forEach((ln, li) => { let cx = x;
    for (const raw of ln.split(' ')) {
      const starts = raw.startsWith('*'), ends = raw.replace(/[.,;:—"”)-]+$/, '').endsWith('*'); if (starts) red = true;
      const w = strip(raw), blk = setBlock(font, [{ text: w, cap }], { role: 'micro', x: cx, y: y + li * cap * lh, align: 'left', maxW: 2000 });
      words.push({ w, blk, red, col, hot }); if (ends) red = false;
      cx += measure(font, w, cap) + cap * 0.3; } });
  return { words, h: lines.length * cap * lh, lines: lines.length, y0: y, cap, lh };
}
function inkWord(g, wd, a, kiss) { g.save(); g.globalAlpha *= a; g.fillStyle = wd.red ? wd.hot : wd.col;
  for (const G of wd.blk.glyphs) { g.save(); g.translate(G.ox, G.oy - kiss * 6); g.fill(G.path); g.restore(); } g.restore(); }
function drawSetting(g, S, u, span) { const n = S.words.length;
  S.words.forEach((wd, i) => { const a = u - (i / Math.max(1, n - 1)) * span; if (a < 0) return; inkWord(g, wd, clamp(a / 0.05), Math.max(0, 1 - a / 0.07)); }); }
function micro(g, s, y, { x = 70, cap = 30, col = GREY, align = 'left', font = F.oswald, tracking = 0.1 } = {}) {
  const b = setBlock(font, [{ text: s, cap, tracking }], { role: 'micro', x, y, align, maxW: 2000 }); fillBlk(g, b, col); return b; }
function dateline(g, s, y = 200, col = INK) { micro(g, s, y, { cap: 34, col, tracking: 0.12 }); g.fillStyle = col; g.fillRect(70, y + 26, 940, 3); }
const below = (S, gap) => S.y0 + (S.lines - 1) * S.cap * S.lh + gap;
const fits = (name, S, yMax = 1880) => { const last = S.y0 + (S.lines - 1) * S.cap * S.lh + S.cap * 0.5; if (last > yMax) throw new Error(`vanquished: ${name} runs off the page (${Math.round(last)} > ${yMax})`); };

// ---------------------------------------------------------------- the film: 1904, printed as a two-plate halftone, off register by REG
const reel = await Reel.load(['../assets/workday/plates', '../assets/vanquished/plates']);
const RP = new Repro(W, H);
const FILM = canvas2d(W, H);
const CUTS = Reel.cuts([
  [TL.q1, 'hammer1', { z: [1.0, 1.08] }],
  [TL.spec, 'castw', { z: [1.0, 1.06] }],
  [TL.w1, 'motor1', { z: [1.04, 1.1], rate: 0.5 }], [TL.w2, 'gen2', { z: [1.04, 1.1], rate: 0.5 }], [TL.w3, 'aisle2', { z: [1.04, 1.12], rate: 0.35 }],
  [TL.card, 'cast2', { z: [1.1, 1.14], rate: 0.29 }],
  [TL.must, 'coil1', { z: [1.0, 1.08] }], [TL.m1, 'hammer2', { z: [1.0, 1.06] }], [TL.m2, 'cast1', { z: [1.0, 1.06] }], [TL.m3, 'coil2', { z: [1.0, 1.06] }],
  [TL.m4, 'gen2', { z: [1.0, 1.06] }], [TL.m5, 'motor1', { z: [1.0, 1.06] }],
  [TL.union, 'hammer3', { z: [1.0, 1.04] }],
  [TL.solid, 'gen1', { z: [1.0, 1.1] }],
], x => x, TL.end);
const DEPT = { [TL.must]: 'COIL WINDING', [TL.m1]: 'THE STEAM HAMMER', [TL.m2]: 'THE CASTING FLOOR', [TL.m3]: 'COIL WINDING', [TL.m4]: 'ASSEMBLING A GENERATOR', [TL.m5]: 'THE MOTOR ROOM' };
async function film(g, t, o = {}) {
  const Fg = FILM.g; Fg.setTransform(1, 0, 0, 1, 0, 0); Fg.globalAlpha = 1; Fg.fillStyle = '#fff'; Fg.fillRect(0, 0, W, H);
  Fg.save(); if (o.clip) { Fg.beginPath(); Fg.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h); Fg.clip(); }
  if (o.mirror) { Fg.translate(W, 0); Fg.scale(-1, 1); }
  const r = await reel.draw(Fg, t, CUTS, { rect: o.rect, ease: ease.outCubic }); Fg.restore(); if (!r) return null;
  const d = regPx(t) * (o.regk ?? 1);
  RP.duotone(FILM.cv, t, { reg: [[-d * 0.3, -d * 0.12], [d, d * 0.42]], cell: o.cell ?? 6, blur: o.blur || 0, pres: o.pres, curves: o.curves });
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha *= o.alpha ?? 1;
  if (o.clip) { g.beginPath(); g.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h); g.clip(); }
  g.drawImage(RP.canvas, 0, 0); g.restore();
  return r;
}
function panel(g, y, { sheet = paper, rule = true } = {}) {   // the page under the type: paper from y down, a printer's double rule on its edge
  g.save(); g.beginPath(); g.rect(0, y, W, H - y); g.clip(); g.drawImage(sheet, 0, 0); g.restore();
  if (rule) { g.fillStyle = INK; g.fillRect(0, y, W, 6); g.fillRect(0, y + 12, W, 2); }
}

// ---------------------------------------------------------------- the hook: the title as a two-colour pull (reads at frame 0)
const T1 = setBlock(F.anton, [{ text: 'OFTEN', cap: 220 }, { text: 'DEFEATED,', cap: 220 }], { role: 'shout', x: 540, y: 520, maxW: 960, gap: 0.22 });
const T2 = setBlock(F.anton, [{ text: 'BUT NEVER', cap: 250 }, { text: 'VANQUISHED.', cap: 250 }], { role: 'shout', x: 540, y: 1110, maxW: 960, gap: 0.2 });
const PULL_BLACK = pullOf(T1, BLACK), PULL_RED = pullOf(T2, REDC, 4, -3);

// ---------------------------------------------------------------- the settings (verbatim; red marked *so*)
const Q1 = setting('In this great struggle the working class are often defeated, but *never vanquished.* Even the defeats, if we are wise enough to profit by them, but hasten the day of the final victory.', { cap: 58, y: 1150, lh: 1.5 });
// the division: the page splits; the top half black on paper, the bottom half paper on black
const DIS = setting('They charge us with being assembled here for the purpose of disrupting the union movement.', { cap: 52, y: 330, lh: 1.5 });
const ALREADY = setBlock(F.anton, [{ text: 'IT IS ALREADY', cap: 150 }, { text: 'DISRUPTED,', cap: 150 }], { role: 'shout', x: 540, y: 1180, maxW: 960, gap: 0.18 });
const PULL_ALREADY = pullOf(ALREADY, REDC);
const SPEC = setting('and if it were not disrupted we would not behold the spectacle here in the very city of', { font: F.playfair, cap: 34, x: 70, y: 150, lh: 1.45, maxW: 940 });
const POL1 = setting('a white policeman guarding a black scab,', { font: F.playfair, cap: 84, x: 70, y: 590, lh: 1.2, maxW: 940 });
const POL2 = setting('and a black policeman guarding a white scab,', { font: F.playfair, cap: 84, x: 70, y: 1180, lh: 1.2, maxW: 940, col: CREAM });
const POCK = setting('while the trade unions stand by with their *hands in their pockets* wondering what is the matter with union labor in America.', { font: F.playfair, cap: 40, x: 90, y: 0, lh: 1.42, maxW: 900 });
// the old unions: the capitalist press; three times SOMETHING WRONG, each on its hit; the chloroform; their pockets
const WR1 = setting('There is certainly *something wrong* with that form of unionism which has its chief support in the press that represents capitalism;', { cap: 38, y: 840, lh: 1.36 });
const WR2 = setting('*something wrong* in that form of unionism whose leaders are the lieutenants of capitalism;', { cap: 38, y: below(WR1, 38 * 1.36 + 26), lh: 1.36 });
const WR3 = setting('*something wrong* with that form of unionism that forms an alliance with such a capitalist combination as the Civic Federation, whose sole purpose it is to', { cap: 38, y: below(WR2, 38 * 1.36 + 26), lh: 1.36 });
const CHLORO = setting('*chloroform the working class*', { font: F.playfair, cap: 56, y: below(WR3, 56 * 1.3 + 10), lh: 1.3 });
const POCKETS = setting('while the capitalist class go through their pockets.', { font: F.playfair, cap: 56, y: below(CHLORO, 56 * 1.3), lh: 1.3, col: RED });
// the card: the sentence runs on into its two display lines
const CARD = { x: 50, y: 100, w: 980, h: 1720 };
const cardStock = paperStock({ w: CARD.w, h: CARD.h, seed: 1905, base: [238, 226, 196], tooth: 12, fibres: 1600, burn: 0.14 });
const BODY = setting('I believe it is possible for the delegates here assembled to form a great, sound, economic organization of the working class based upon the class struggle, that shall be', { cap: 36, x: 110, y: 370, maxW: 860, lh: 1.55 });
const BROAD = setting('broad enough to embrace every honest worker,', { font: F.playfair, cap: 84, x: 110, y: BODY.y0 + BODY.h + 70, maxW: 860, lh: 1.24 });
const NARROW = setting('yet narrow enough to exclude every fakir.', { font: F.playfair, cap: 84, x: 110, y: BROAD.y0 + BROAD.h + 30, maxW: 860, lh: 1.24 });
const FAKIR = (() => { const b = NARROW.words.slice(-1).map(x => x.blk.bbox); return { x1: Math.min(...b.map(q => q.x1)) - 14, x2: Math.max(...b.map(q => q.x2)) + 14, y: (Math.min(...b.map(q => q.y1)) + Math.max(...b.map(q => q.y2))) / 2 }; })();
const ADMIT = daterStamp({ faces: { ring: F.oswald, word: F.shoulders }, word: 'ADMITTED.', ring: ['CHICAGO', ''], rcap: 62, date: '1905', cx: 800, cy: 1660, R0: 470, cap: 190, sx: 0.8, rot: -0.12 });
const ADMIT_K = 0.4;                                                                              // drawn at 0.4: a 188 px ring, the word at about a 76 px cap
// the program: one organization, every department; five times IT MUST, the film coming into register with each
const MUST = setting('We must have *one organization* that embraces the workers in every department of industrial activity.', { cap: 40, y: 1130, lh: 1.42 });
const MUSTS = (() => { let y = below(MUST, 40 * 1.42 + 50); return ['It must express the class struggle.', 'It must recognize the class lines.', 'It must of course be class-conscious.',
  'It must be totally uncompromising.', 'It must be an organization of the *rank and file.*'].map(s => { const S = setting(s, { font: F.playfair, cap: 40, y, lh: 1.2 }); y = below(S, 40 * 1.2 + 12); return S; }); })();
const MT = [TL.m1, TL.m2, TL.m3, TL.m4, TL.m5];
// the two halves
const UNION = setBlock(F.anton, [{ text: 'A SINGLE UNION', cap: 132 }, { text: 'UPON THE ECONOMIC FIELD.', cap: 64, tracking: 0.04 }], { role: 'shout', x: 540, y: 690, maxW: 960, gap: 0.3 });
const PARTY = setBlock(F.anton, [{ text: 'A SINGLE PARTY', cap: 132 }, { text: 'UPON THE POLITICAL FIELD;', cap: 64, tracking: 0.04 }], { role: 'shout', x: 540, y: 1180, maxW: 960, gap: 0.3 });
const PULL_UNION = pullOf(UNION, BLACK), PULL_PARTY = pullOf(PARTY, REDC);
const WHOLE = setting('the two halves that represent the *organic whole* of the labor movement.', { font: F.playfair, cap: 46, x: 90, y: 1500, lh: 1.4, maxW: 900 });
const SOLID = setting('We know that without solidarity nothing is possible, that with it *nothing is impossible.*', { font: F.playfair, cap: 66, y: 1320, lh: 1.32 });
const ATTR = setBlock(F.oswald, [{ text: 'EUGENE V. DEBS · CHICAGO · 1905', cap: 50, tracking: 0.08 }], { role: 'micro', x: 540, y: 1560, maxW: 940 });
const CREDIT = 'WESTINGHOUSE WORKS, 1904 · BIOGRAPH';
fits('POCKETS', POCKETS); fits('IT MUST 5', MUSTS[4]); fits('Q1', Q1); fits('SOLID', SOLID); fits('NARROW', NARROW, 1760);   // after every setting is declared (a guard above SOLID's declaration threw at load)

function sheet(g, s = paper) { g.drawImage(s, 0, 0); }
function card(g, u) {   // the card on the bench, ruled like a membership book's page
  const k = ease.outCubic(clamp(u / 0.35)), y = lerp(200, 0, k);
  g.save(); g.translate(0, y); g.globalAlpha = clamp(u / 0.2);
  g.drawImage(cardStock, CARD.x, CARD.y);
  g.fillStyle = INK; g.fillRect(CARD.x + 40, CARD.y + 40, CARD.w - 80, 6); g.fillRect(CARD.x + 40, CARD.y + 54, CARD.w - 80, 2);
  micro(g, 'CHICAGO, JUNE 29, 1905.', CARD.y + 140, { x: 110, cap: 34, col: INK, tracking: 0.12 });
  micro(g, 'No. 1', CARD.y + 140, { x: 970, cap: 34, col: INK, align: 'right', tracking: 0.12 });
  g.fillRect(CARD.x + 40, CARD.y + 196, CARD.w - 80, 2);
  g.fillRect(CARD.x + 40, CARD.y + CARD.h - 56, CARD.w - 80, 2); g.fillRect(CARD.x + 40, CARD.y + CARD.h - 46, CARD.w - 80, 6);
  g.restore(); return y;
}
const HALF = 960;
const CURV_SPLIT = [[0.42, 0.95, 0.9], [0.06, 0.8, 0.7]];
// the split page: the top half paper, the bottom half black; the seam opens as the division goes on
async function split(g, t, gap) {
  g.fillStyle = '#0d0b0a'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(0, -gap / 2); g.beginPath(); g.rect(0, 0, W, HALF); g.clip(); sheet(g);
  await film(g, t, { rect: { x: 0, y: 0, w: W, h: HALF }, curves: CURV_SPLIT });
  g.globalAlpha = 0.5; g.drawImage(paper, 0, 0); g.globalAlpha = 1; g.restore();
  g.save(); g.translate(0, gap / 2); g.beginPath(); g.rect(0, HALF, W, H - HALF); g.clip(); sheet(g);
  g.save(); g.translate(0, HALF); await film(g, t, { rect: { x: 0, y: 0, w: W, h: HALF }, mirror: true, regk: -1, curves: CURV_SPLIT }); g.restore();
  g.fillStyle = 'rgba(13,11,10,0.84)'; g.fillRect(0, HALF, W, H - HALF); g.restore();
}

window.renderFrame = async (t) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  if (t < TL.q1) {
    // the hook: the black impression is already on the sheet at frame 0; the red second impression lands on the second beat
    sheet(ctx); strike(ctx, PULL_BLACK, t + 0.3);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; strike(ctx, PULL_RED, t - 1.0); ctx.restore();
  } else if (t < TL.dis) {
    // the struggle: the crew at the steam hammer, in register; the sentence on the page below
    sheet(ctx); await film(ctx, t); panel(ctx, 1010);
    dateline(ctx, 'CHICAGO, JUNE 29, 1905. EUGENE V. DEBS.', 1080); drawSetting(ctx, Q1, t - TL.q1, 3.6);
    micro(ctx, CREDIT, 980, { x: 1010, align: 'right', cap: 22, col: CREAM });
  } else if (t < TL.spec) {
    // the charge, and the answer struck in red
    sheet(ctx); dateline(ctx, 'THE SAME SPEECH.'); drawSetting(ctx, DIS, t - TL.dis, 1.6);
    if (t >= TL.already) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; strike(ctx, PULL_ALREADY, t - TL.already); ctx.restore(); }
  } else if (t < TL.w1) {
    // the page splits: the casting floor in both halves, the bottom one mirrored and in the dark; the seam opens from the second line on
    const gap = 140 * ease.inOutCubic(clamp((t - TL.pol2) / (TL.w1 - TL.pol2)));
    await split(ctx, t, gap);
    ctx.save(); ctx.translate(0, -gap / 2); drawSetting(ctx, SPEC, t - TL.spec, 1.2); drawSetting(ctx, POL1, t - TL.pol1, 0.8); ctx.restore();
    ctx.save(); ctx.translate(0, gap / 2); drawSetting(ctx, POL2, t - TL.pol2, 0.8); ctx.restore();
    if (t >= TL.pock) {   // the trade unions, set on a slip at the foot of the dark half
      const u = ease.outCubic(clamp((t - TL.pock) / 0.3)), y0 = 1640 + gap / 2;
      ctx.save(); ctx.globalAlpha = u; ctx.translate(0, lerp(30, 0, u));
      ctx.drawImage(paper, 0, 0, W, 300, 50, y0 - 70, W - 100, 280); ctx.fillStyle = INK; ctx.fillRect(50, y0 - 70, W - 100, 4);
      ctx.translate(0, y0); drawSetting(ctx, POCK, t - TL.pock, 1.8); ctx.restore();
    }
  } else if (t < TL.card) {
    // the old unions: the capitalist press. The page goes under on the chloroform; their pockets are struck sharp
    const lull = ease.inOutCubic(clamp((t - TL.chloro) / 1.3));
    sheet(ctx, news);
    ctx.save(); if (lull > 0) ctx.filter = `blur(${(lull * 7).toFixed(2)}px)`;
    await film(ctx, t, { rect: { x: 0, y: 380 - H / 2, w: W, h: H }, clip: { x: 0, y: 0, w: W, h: 760 }, blur: lull * 2.5, curves: [[0.4, 0.95, 0.85], [0.05, 0.8, 0.75]] });   // the plate at its own aspect, cropped to the band
    ctx.fillStyle = INK; ctx.fillRect(0, 760, W, 6); ctx.fillRect(0, 772, W, 2);
    dateline(ctx, 'THE SAME SPEECH. ON THE OLD UNIONS.', 200, CREAM);
    drawSetting(ctx, WR1, t - TL.w1 + 0.52, 2.6); drawSetting(ctx, WR2, t - TL.w2, 1.6); drawSetting(ctx, WR3, t - TL.w3, 2.8);
    drawSetting(ctx, CHLORO, t - TL.chloro, 0.5);
    ctx.restore();
    if (lull > 0) { ctx.fillStyle = `rgba(40,34,30,${(lull * 0.42).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    drawSetting(ctx, POCKETS, t - TL.pockets, 0.9);
  } else if (t < TL.must) {
    // the card on the bench (the casting floor dim under it, in the dark)
    sheet(ctx); await film(ctx, t, { pres: [1, 0.6] });
    ctx.fillStyle = 'rgba(28,25,22,0.76)'; ctx.fillRect(0, 0, W, H);
    const u = t - TL.card, y = card(ctx, u); ctx.save(); ctx.translate(0, y);
    drawSetting(ctx, BODY, u - 0.3, 3.4);
    drawSetting(ctx, BROAD, t - TL.broad, 0.9); drawSetting(ctx, NARROW, t - TL.narrow, 0.9);
    const c = clamp((t - TL.cancel) / 0.18);                                                           // the printer's cancel rule through EVERY FAKIR.
    if (c > 0) { ctx.fillStyle = INK; ctx.fillRect(FAKIR.x1, FAKIR.y - 6, (FAKIR.x2 - FAKIR.x1) * ease.outCubic(c), 12); }
    ctx.save(); ctx.translate(800, 1660); ctx.scale(ADMIT_K, ADMIT_K); ctx.translate(-800, -1660); ADMIT.draw(ctx, t - TL.admit); ctx.restore();
    ctx.restore();
  } else if (t < TL.union) {
    // every department: a shop a line, the plates stepping into register on each IT MUST
    sheet(ctx); const r = await film(ctx, t); panel(ctx, 1060);
    if (r && DEPT[r.cut.t]) { const a = clamp(r.age / 0.12); ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = INK; ctx.fillRect(56, 982, 12, 36);
      micro(ctx, DEPT[r.cut.t], 1000, { x: 84, cap: 30, col: CREAM, tracking: 0.14 }); ctx.restore(); }
    micro(ctx, CREDIT, 1040, { x: 1010, align: 'right', cap: 20, col: CREAM });
    drawSetting(ctx, MUST, t - TL.must, 1.8);
    MUSTS.forEach((S, i) => { const age = t - MT[i]; if (age < 0) return; drawSetting(ctx, S, age, 0.35);
      if (i === MUSTS.length - 1 || t < MT[i + 1]) { ctx.fillStyle = RED; ctx.fillRect(48, S.y0 - S.cap / 2 - 3, 8, S.cap + 6); } });
  } else if (t < TL.solid) {
    // the two halves: the page that split at the policemen closes; black impression and red impression meet on the organic whole
    const k = ease.inOutCubic(clamp((t - (TL.whole - 0.6)) / 0.6)), gap = lerp(140, 0, k), dx = lerp(46, 0, k);
    ctx.fillStyle = '#0d0b0a'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-dx, -gap / 2); ctx.beginPath(); ctx.rect(0, 0, W, HALF); ctx.clip(); sheet(ctx);
    ctx.globalCompositeOperation = 'multiply'; strike(ctx, PULL_UNION, t - TL.union); ctx.restore();
    ctx.save(); ctx.translate(dx, gap / 2); ctx.beginPath(); ctx.rect(0, HALF, W, H - HALF); ctx.clip(); sheet(ctx);
    ctx.globalCompositeOperation = 'multiply'; strike(ctx, PULL_PARTY, t - TL.party); ctx.restore();
    if (t >= TL.whole) { const a = t - TL.whole; ctx.fillStyle = INK; ctx.fillRect(240, 1420, 600 * ease.outCubic(clamp(a / 0.3)), 3); drawSetting(ctx, WHOLE, a - 0.2, 1.2); }
  } else if (t < TL.title) {
    // solidarity: the generator crew, in register
    sheet(ctx); await film(ctx, t); panel(ctx, 1160);
    dateline(ctx, 'THE SAME SPEECH. IN CLOSING.', 1240); drawSetting(ctx, SOLID, t - TL.solid, 1.6);
    micro(ctx, CREDIT, 1130, { x: 1010, align: 'right', cap: 22, col: CREAM });
  } else if (t < TL.mark) {
    // the title again, both impressions, and the attribution set under it
    sheet(ctx); strike(ctx, PULL_BLACK, t - TL.title); ctx.save(); ctx.globalCompositeOperation = 'multiply'; strike(ctx, PULL_RED, t - TL.title - 0.5); ctx.restore();
    if (t >= TL.title + 1.0) { ctx.fillStyle = INK; ctx.fillRect(240, 1480, 600, 3); fillBlk(ctx, ATTR, INK); }
  } else { const age = t - TL.mark; sheet(ctx); ctx.drawImage(PULL_BLACK, 0, 0); ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(PULL_RED, 0, 0); ctx.restore();
    ctx.fillStyle = `rgba(10,8,6,${clamp(age * 4, 0, 0.94)})`; ctx.fillRect(0, 0, W, H); closer(ctx, age); }
  ctx.filter = 'none';
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.3 });
  return {};
};
ready = true;
